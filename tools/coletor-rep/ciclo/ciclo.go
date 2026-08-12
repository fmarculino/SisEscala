// Package ciclo é o "fazer um sync" e "fazer um heartbeat" — extraído de cmd/cli para que
// cmd/tray rode exatamente a mesma lógica em loop, sem duplicar código entre os dois binários.
package ciclo

import (
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/fila"
	"github.com/sms-maraba/sisescala-coletor-rep/rep"
	"github.com/sms-maraba/sisescala-coletor-rep/sisescala"
)

const Versao = "0.2.0"

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

// Sync reenvia primeiro o que ficou na fila offline, depois busca o AFD novo do relógio.
func Sync(cfg *config.Config) error {
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
		resultado, err := sc.EnviarLote(lote.LoteID, lote.Linhas, lote.ArquivoSHA256, Versao, hostname())
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

		resultado, err := sc.EnviarLote(loteID, trecho, arquivoSHA256, Versao, hostname())
		if err != nil {
			log.Printf("falha ao enviar lote %s, gravando na fila offline: %v", loteID, err)
			erroFila := fila.Gravar(cfg.Fila.Diretorio, fila.Lote{
				LoteID: loteID, Linhas: trecho, ArquivoSHA256: arquivoSHA256,
				ColetorVersao: Versao, ColetorHost: hostname(),
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

// Heartbeat reporta versão e deriva de relógio. Devolve erro só quando a chamada ao SisEscala
// falha — não saber a hora do relógio (get_system_information sem campo reconhecido) não é
// erro, só segue sem deriva.
func Heartbeat(cfg *config.Config) error {
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
// confirmado contra hardware real ainda — ver aviso no topo de rep/client.go.
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
