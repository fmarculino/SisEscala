// coletor-rep é o app local do SisEscala: sincroniza o relógio de ponto REP-C (quando
// configurado) e/ou abre a tela de presença do terminal local (quando configurado). O mesmo
// binário atende as duas funções — uma máquina pode ter só uma seção no config.yaml, ou as
// duas.
package main

import (
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/fila"
	"github.com/sms-maraba/sisescala-coletor-rep/rep"
	"github.com/sms-maraba/sisescala-coletor-rep/sisescala"
	"github.com/sms-maraba/sisescala-coletor-rep/terminal"
)

const versao = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		imprimirUso()
		os.Exit(1)
	}

	caminhoCfg := caminhoConfig()
	cfg, err := config.Carregar(caminhoCfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Erro ao carregar %s: %v\n", caminhoCfg, err)
		os.Exit(1)
	}

	comando := os.Args[1]
	switch comando {
	case "sync":
		if err := rodarSync(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha na sincronizacao: %v\n", err)
			os.Exit(1)
		}
	case "heartbeat":
		if err := rodarHeartbeat(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha no heartbeat: %v\n", err)
			os.Exit(1)
		}
	case "diagnostico":
		rodarDiagnostico(cfg)
	case "terminal":
		if len(os.Args) < 3 || os.Args[2] != "abrir" {
			fmt.Fprintln(os.Stderr, "Uso: coletor-rep terminal abrir")
			os.Exit(1)
		}
		if cfg.TerminalLocal == nil {
			fmt.Fprintln(os.Stderr, "Secao terminal_local ausente no config.yaml.")
			os.Exit(1)
		}
		if err := terminal.Abrir(cfg.SisEscala.URL, cfg.TerminalLocal.ID, cfg.TerminalLocal.Token); err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao abrir terminal: %v\n", err)
			os.Exit(1)
		}
	case "install", "start", "stop", "uninstall", "run":
		if err := gerenciarServico(comando, cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha no comando de servico: %v\n", err)
			os.Exit(1)
		}
	default:
		imprimirUso()
		os.Exit(1)
	}
}

func imprimirUso() {
	fmt.Println(`coletor-rep — app local do SisEscala (relogio de ponto + terminal local)

Uso:
  coletor-rep sync                            sincroniza AFD do relogio REP configurado
  coletor-rep heartbeat                       reporta versao e deriva de relogio ao SisEscala
  coletor-rep diagnostico                     testa conexao com o REP e com o SisEscala
  coletor-rep terminal abrir                  abre a tela de presenca local no navegador
  coletor-rep install|start|stop|uninstall    gerencia o servico do Windows
  coletor-rep run                             roda o ciclo continuo em primeiro plano (usado pelo servico)

Flags:
  --config <caminho>   caminho do config.yaml (default: config.yaml ao lado do executavel)`)
}

func caminhoConfig() string {
	for i, arg := range os.Args {
		if arg == "--config" && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
	}
	exePath, err := os.Executable()
	if err != nil {
		return "config.yaml"
	}
	return filepath.Join(filepath.Dir(exePath), "config.yaml")
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "desconhecido"
	}
	return h
}

// loteIDDeterministico gera um identificador em formato UUID (8-4-4-4-12 hex) a partir do
// conteúdo do lote. rep_sincronizacoes.lote_id é uuid NOT NULL, e precisa ser ESTÁVEL entre
// reenvios do mesmo lote — é isso que faz fn_ingerir_afd tratar reenvio como no-op.
func loteIDDeterministico(dispositivoID string, linhas []string) string {
	h := sha256.New()
	h.Write([]byte(dispositivoID))
	for _, l := range linhas {
		h.Write([]byte(l))
	}
	soma := h.Sum(nil)
	return fmt.Sprintf("%x-%x-%x-%x-%x", soma[0:4], soma[4:6], soma[6:8], soma[8:10], soma[10:16])
}

// rodarSync reenvia primeiro o que ficou na fila offline, depois busca o AFD novo do relógio.
func rodarSync(cfg *config.Config) error {
	if cfg.DispositivoRep == nil {
		return fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para sincronizar")
	}
	d := cfg.DispositivoRep
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)

	// Reenvio de fila é sempre seguro: fn_ingerir_afd é idempotente por (dispositivo_id, lote_id).
	pendentes, err := fila.Pendentes(cfg.Fila.Diretorio)
	if err != nil {
		log.Printf("aviso: falha ao ler fila offline: %v", err)
	}
	for _, lote := range pendentes {
		resultado, err := sc.EnviarLote(lote.LoteID, lote.Linhas, lote.ArquivoSHA256, versao, hostname())
		if err != nil {
			log.Printf("lote %s continua na fila: %v", lote.LoteID, err)
			continue
		}
		log.Printf("lote %s da fila reenviado: novas=%d duplicadas=%d marcacoes=%d orfas=%d",
			lote.LoteID, resultado.Novas, resultado.Duplicadas, resultado.Marcacoes, resultado.Orfas)
		if err := fila.Remover(cfg.Fila.Diretorio, lote.LoteID); err != nil {
			log.Printf("aviso: nao foi possivel remover lote %s da fila apos ACK: %v", lote.LoteID, err)
		}
	}

	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	// TODO(operacional): o "ultimo NSR aceito" vive no SisEscala (dispositivos_rep.ultimo_nsr),
	// nao neste binario. Esta primeira versao sempre pede a partir do NSR 1 e deixa a
	// idempotencia de fn_ingerir_afd (UNIQUE dispositivo_id+nsr) descartar o que ja foi
	// ingerido — funciona, mas reenvia o arquivo inteiro do relogio a cada ciclo. Antes de
	// ligar em producao com relogios de alto volume, troque por uma leitura previa do
	// ultimo_nsr (nova rota GET, ou consulta direta) para pedir so o incremento.
	bruto, err := rc.GetAFD(1)
	if err != nil {
		return fmt.Errorf("falha ao buscar AFD do relogio: %w", err)
	}

	afdUTF8, err := rep.DecodificarLatin1(bruto)
	if err != nil {
		return fmt.Errorf("falha ao decodificar AFD (latin1): %w", err)
	}

	linhas := rep.DividirLinhas(afdUTF8)
	if len(linhas) == 0 {
		log.Println("nenhuma linha no AFD")
		return nil
	}

	arquivoSHA256 := rep.SHA256Hex(bruto)
	const tamanhoLote = 500
	for inicio := 0; inicio < len(linhas); inicio += tamanhoLote {
		fim := inicio + tamanhoLote
		if fim > len(linhas) {
			fim = len(linhas)
		}
		trecho := linhas[inicio:fim]
		loteID := loteIDDeterministico(d.ID, trecho)

		resultado, err := sc.EnviarLote(loteID, trecho, arquivoSHA256, versao, hostname())
		if err != nil {
			log.Printf("falha ao enviar lote %s, gravando na fila offline: %v", loteID, err)
			erroFila := fila.Gravar(cfg.Fila.Diretorio, fila.Lote{
				LoteID: loteID, Linhas: trecho, ArquivoSHA256: arquivoSHA256,
				ColetorVersao: versao, ColetorHost: hostname(),
			})
			if erroFila != nil {
				log.Printf("erro: falha tambem ao gravar na fila: %v", erroFila)
			}
			continue
		}
		log.Printf("lote %s: novas=%d duplicadas=%d marcacoes=%d orfas=%d nsr_max_aceito=%d",
			loteID, resultado.Novas, resultado.Duplicadas, resultado.Marcacoes, resultado.Orfas, resultado.NsrMaxAceito)
	}
	return nil
}

func rodarHeartbeat(cfg *config.Config) error {
	if cfg.DispositivoRep == nil {
		return fmt.Errorf("secao dispositivo_rep ausente no config.yaml")
	}
	d := cfg.DispositivoRep
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)

	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)
	info, err := rc.InformacoesSistema()
	if err != nil {
		log.Printf("aviso: nao foi possivel ler o relogio do REP (%v); heartbeat sem deriva", err)
		return sc.Heartbeat(nil)
	}

	relogioDevice := extrairRelogioDevice(info)
	if relogioDevice.IsZero() {
		log.Println("aviso: get_system_information.fcgi nao trouxe um campo de hora reconhecido; heartbeat sem deriva")
		return sc.Heartbeat(nil)
	}
	return sc.Heartbeat(&relogioDevice)
}

// extrairRelogioDevice tenta os nomes de campo mais prováveis da API Control iD. Não
// confirmado contra hardware real nesta sessão — ver aviso no topo de rep/client.go.
func extrairRelogioDevice(info map[string]interface{}) time.Time {
	for _, chave := range []string{"device_time", "system_time", "datetime"} {
		if v, ok := info[chave].(string); ok {
			if t, err := time.Parse(time.RFC3339, v); err == nil {
				return t
			}
		}
	}
	return time.Time{}
}

func rodarDiagnostico(cfg *config.Config) {
	fmt.Printf("coletor-rep versao %s\n", versao)
	fmt.Printf("SisEscala: %s\n", cfg.SisEscala.URL)

	if cfg.DispositivoRep == nil {
		fmt.Println("dispositivo_rep: nao configurado nesta maquina")
	} else {
		d := cfg.DispositivoRep
		fmt.Printf("dispositivo_rep: %s (%s:%d)\n", d.ID, d.Endereco, d.Porta)

		rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)
		if err := rc.Login(); err != nil {
			fmt.Printf("  login no REP: FALHOU (%v)\n", err)
		} else {
			fmt.Println("  login no REP: OK")
		}

		sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)
		if err := sc.Heartbeat(nil); err != nil {
			fmt.Printf("  heartbeat no SisEscala: FALHOU (%v)\n", err)
		} else {
			fmt.Println("  heartbeat no SisEscala: OK (token e dispositivo_id validos)")
		}
	}

	if cfg.TerminalLocal == nil {
		fmt.Println("terminal_local: nao configurado nesta maquina")
	} else {
		fmt.Printf("terminal_local: %s (rode `coletor-rep terminal abrir` para testar)\n", cfg.TerminalLocal.ID)
	}
}
