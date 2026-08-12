// coletor-rep é a CLI de diagnóstico/uso manual do coletor local do SisEscala — login no
// relógio, sync avulso, e abrir o terminal local uma vez. Para rodar continuamente numa
// unidade, use o app de bandeja (cmd/tray) em vez desta CLI: ele faz o mesmo ciclo
// (pacote ciclo/, compartilhado pelos dois) sozinho, com ícone de status e sem depender de
// ninguém lembrar de rodar um comando.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/sms-maraba/sisescala-coletor-rep/ciclo"
	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/rep"
	"github.com/sms-maraba/sisescala-coletor-rep/sisescala"
	"github.com/sms-maraba/sisescala-coletor-rep/terminal"
)

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
		if err := ciclo.Sync(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha na sincronizacao: %v\n", err)
			os.Exit(1)
		}
	case "heartbeat":
		if err := ciclo.Heartbeat(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha no heartbeat: %v\n", err)
			os.Exit(1)
		}
	case "diagnostico":
		rodarDiagnostico(cfg)
	case "afd-raw":
		rodarAfdRaw(cfg)
	case "afd-exportar":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Uso: coletor-rep afd-exportar <caminho-do-arquivo-de-saida.sisrep>")
			os.Exit(1)
		}
		rodarAfdExportar(cfg, caminhoCfg, os.Args[2])
	case "cadastros":
		if err := ciclo.SincronizarCadastros(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao sincronizar cadastros: %v\n", err)
			os.Exit(1)
		}
	case "cadastros-testar":
		rodarCadastrosTestar(cfg)
	case "higiene":
		if err := ciclo.HigienizarListagem(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao listar cadastros do rele: %v\n", err)
			os.Exit(1)
		}
	case "higiene-remover":
		if err := ciclo.HigienizarRemocoes(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao aplicar remocoes no rele: %v\n", err)
			os.Exit(1)
		}
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
	default:
		imprimirUso()
		os.Exit(1)
	}
}

func imprimirUso() {
	fmt.Println(`coletor-rep — CLI de diagnostico do app local do SisEscala

Para rodar continuamente numa unidade, use o app de bandeja (baixado em Marcacoes no
SisEscala), nao esta CLI - ela e para configurar/depurar uma unidade na mao.

Uso:
  coletor-rep sync                sincroniza AFD do relogio REP configurado (uma vez)
  coletor-rep heartbeat           reporta versao e deriva de relogio ao SisEscala (uma vez)
  coletor-rep diagnostico         testa conexao com o REP e com o SisEscala
  coletor-rep afd-raw             so imprime a resposta crua do relogio (diagnostico, nao grava nada)
  coletor-rep afd-exportar <arq>  exporta so o AFD novo (desde a ultima exportacao) para um arquivo .sisrep - unidade sem rede ate o SisEscala, ver README
  coletor-rep cadastros           aplica a fila de push de identidade real no rele (Fase 7) - GRAVA no equipamento
  coletor-rep cadastros-testar    cria UM usuario de teste no rele e lista biometria (diagnostico - GRAVA no equipamento, ver aviso)
  coletor-rep higiene             le todos os usuarios do rele e reporta ao SisEscala (Fase 7b) - so' leitura, seguro rodar sempre
  coletor-rep higiene-remover     aplica no rele quem foi selecionado na tela de higiene - GRAVA/APAGA no equipamento, ver aviso em rep/client.go
  coletor-rep terminal abrir      abre a tela de presenca local no navegador (uma vez)

Flags:
  --config <caminho>   caminho do config.yaml (default: config.yaml ao lado do executavel)`)
}

func caminhoConfig() string {
	for i, arg := range os.Args {
		if arg == "--config" && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
	}

	// Prioriza o diretorio de trabalho atual: e como o binario roda na pratica (cd na pasta e
	// executa), e e o unico jeito de funcionar sob `go run`, que compila para um diretorio
	// temporario - os.Executable() ali aponta para dentro do Temp, nunca para o projeto.
	if _, err := os.Stat("config.yaml"); err == nil {
		return "config.yaml"
	}

	// Fallback para o lado do executavel - cobre o caso de duplo-clique/atalho com working
	// directory diferente (ex.: agendado pelo Windows a partir de outra pasta).
	exePath, err := os.Executable()
	if err != nil {
		return "config.yaml"
	}
	return filepath.Join(filepath.Dir(exePath), "config.yaml")
}

func rodarDiagnostico(cfg *config.Config) {
	fmt.Printf("coletor-rep versao %s\n", ciclo.Versao)
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

// rodarAfdRaw so busca e imprime a resposta do relogio - nunca chama sisescala.EnviarLote.
// Existe para diagnosticar o formato real de get_afd.fcgi sem risco de gravar nada em
// producao. %q escapa bytes nao imprimiveis, entao chaves/aspas/newlines ficam visiveis em
// vez de baguncar o terminal.
func rodarAfdRaw(cfg *config.Config) {
	if cfg.DispositivoRep == nil {
		fmt.Fprintln(os.Stderr, "Secao dispositivo_rep ausente no config.yaml.")
		os.Exit(1)
	}
	d := cfg.DispositivoRep
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	if err := rc.Login(); err != nil {
		fmt.Fprintf(os.Stderr, "Falha no login: %v\n", err)
		os.Exit(1)
	}

	bruto, err := rc.GetAFD(1)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao buscar AFD: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Total de bytes recebidos: %d\n\n", len(bruto))

	limite := 500
	if len(bruto) < limite {
		limite = len(bruto)
	}
	fmt.Println("--- Primeiros bytes CRUS (antes de qualquer decode), escapados ---")
	fmt.Printf("%q\n\n", bruto[:limite])

	afdUTF8, err := rep.DecodificarLatin1(bruto)
	if err != nil {
		fmt.Printf("Falha ao decodificar latin1: %v\n", err)
		return
	}

	limite2 := 500
	if len(afdUTF8) < limite2 {
		limite2 = len(afdUTF8)
	}
	fmt.Println("--- Apos decodificar latin1, escapados ---")
	fmt.Printf("%q\n\n", afdUTF8[:limite2])

	linhas := rep.DividirLinhas(afdUTF8)
	fmt.Printf("--- DividirLinhas encontrou %d linhas ---\n", len(linhas))
	for i, l := range linhas {
		if i >= 10 {
			fmt.Println("...")
			break
		}
		fmt.Printf("linha %d (%d chars): %q\n", i+1, len(l), l)
	}
}

// arquivoEstadoPendrive fica ao lado do config.yaml carregado — é o único lugar onde "até onde
// já exportei por pendrive" pode viver, porque a exportação acontece numa máquina sem rede até o
// SisEscala (não há como usar dispositivos_rep.ultimo_nsr, que é o do canal online).
func arquivoEstadoPendrive(caminhoCfg string) string {
	return filepath.Join(filepath.Dir(caminhoCfg), "estado-pendrive.json")
}

type estadoPendrive struct {
	UltimoNsrExportado int64 `json:"ultimo_nsr_exportado"`
}

func lerEstadoPendrive(caminho string) estadoPendrive {
	dados, err := os.ReadFile(caminho)
	if err != nil {
		return estadoPendrive{} // primeira exportacao deste dispositivo - comeca do NSR 1
	}
	var e estadoPendrive
	if json.Unmarshal(dados, &e) != nil {
		return estadoPendrive{}
	}
	return e
}

func gravarEstadoPendrive(caminho string, e estadoPendrive) error {
	dados, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(caminho, dados, 0o644)
}

// rodarAfdExportar busca do rele so' o que ainda nao foi exportado por pendrive antes (retomando
// do estado local em estado-pendrive.json, ao lado do config.yaml) e grava num arquivo .sisrep -
// pensado pra ser levado fisicamente ate' uma maquina com rede e importado em Marcacoes ->
// Importar por Pendrive. Preserva os bytes CRUS do AFD (latin1, sem decodificar) - mesmo motivo
// de linha_bruta ser o artefato legal em rep_afd_registros: quem decodifica e' a rota de import,
// no mesmo ponto em que este coletor decodificaria se estivesse online.
func rodarAfdExportar(cfg *config.Config, caminhoCfg, caminhoSaida string) {
	if cfg.DispositivoRep == nil {
		fmt.Fprintln(os.Stderr, "Secao dispositivo_rep ausente no config.yaml.")
		os.Exit(1)
	}
	d := cfg.DispositivoRep
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	caminhoEstado := arquivoEstadoPendrive(caminhoCfg)
	estado := lerEstadoPendrive(caminhoEstado)

	fmt.Printf("Buscando AFD a partir do NSR %d...\n", estado.UltimoNsrExportado+1)
	bruto, err := rc.GetAFD(estado.UltimoNsrExportado + 1)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao buscar AFD: %v\n", err)
		os.Exit(1)
	}

	afdUTF8, err := rep.DecodificarLatin1(bruto)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao decodificar AFD para achar o NSR maximo: %v\n", err)
		os.Exit(1)
	}
	linhas := rep.DividirLinhas(afdUTF8)
	if len(linhas) == 0 {
		fmt.Println("Nenhuma marcacao nova desde a ultima exportacao por pendrive.")
		return
	}

	// O NSR ocupa os 9 primeiros caracteres da linha - mesma convencao ja usada por
	// ciclo.go para ordenar lotes (`ORDER BY substring(x from 1 for 9)`), so' que aqui lida
	// localmente, sem depender do banco.
	nsrMax := estado.UltimoNsrExportado
	for _, l := range linhas {
		if len(l) < 9 {
			continue
		}
		if n, err := strconv.ParseInt(strings.TrimSpace(l[:9]), 10, 64); err == nil && n > nsrMax {
			nsrMax = n
		}
	}

	cabecalho := fmt.Sprintf(
		"SISREP-V1\ndispositivo_id: %s\nnsr_de: %d\nnsr_ate: %d\ngerado_em: %s\n---\n",
		d.ID, estado.UltimoNsrExportado+1, nsrMax, time.Now().Format(time.RFC3339))

	conteudo := append([]byte(cabecalho), bruto...)
	if err := os.WriteFile(caminhoSaida, conteudo, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao gravar %s: %v\n", caminhoSaida, err)
		os.Exit(1)
	}

	// So' avanca o estado local DEPOIS de gravar o arquivo com sucesso - se a gravacao falhar
	// (pendrive cheio, sem permissao), a proxima tentativa pede o mesmo intervalo de novo.
	if err := gravarEstadoPendrive(caminhoEstado, estadoPendrive{UltimoNsrExportado: nsrMax}); err != nil {
		fmt.Fprintf(os.Stderr, "aviso: arquivo gravado, mas falha ao atualizar %s: %v\n", caminhoEstado, err)
		fmt.Println("A proxima exportacao vai repetir este intervalo de NSR (seguro: reimportar so' descarta duplicado, nunca duplica).")
	}

	fmt.Printf("Exportado: %s (NSR %d a %d, %d linha(s), %d bytes)\n",
		caminhoSaida, estado.UltimoNsrExportado+1, nsrMax, len(linhas), len(bruto))
	fmt.Println("Leve este arquivo ate uma maquina com acesso ao SisEscala e importe em Marcacoes -> Importar por Pendrive.")
}

// rodarCadastrosTestar cria UM usuario de teste diretamente no rele (nome bem marcado, para
// achar e apagar na mao pela interface do equipamento depois) e lista quem tem biometria - sem
// tocar na fila real do SisEscala (nunca chama sisescala.ConfirmarCadastro). Existe porque
// create_objects.fcgi/load_objects.fcgi (rep/client.go) NUNCA foram confirmados contra hardware
// real - rodar isto uma vez, contra o rele de teste, e o que decide se e seguro habilitar
// `cadastros`/o botao da bandeja em producao. Se o formato de campo estiver errado, o erro
// impresso abaixo traz a resposta crua do equipamento (ver %v em rep/client.go).
func rodarCadastrosTestar(cfg *config.Config) {
	if cfg.DispositivoRep == nil {
		fmt.Fprintln(os.Stderr, "Secao dispositivo_rep ausente no config.yaml.")
		os.Exit(1)
	}
	d := cfg.DispositivoRep
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	fmt.Println("ATENCAO: isto vai GRAVAR um usuario de teste no rele de verdade.")
	fmt.Println("Nome usado: 'SISESCALA TESTE - PODE APAGAR' / matricula '900000' — apague pela")
	fmt.Println("interface do proprio equipamento depois de conferir o resultado abaixo.\n")

	if err := rc.Login(); err != nil {
		fmt.Fprintf(os.Stderr, "Falha no login: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("login no REP: OK")

	// matricula precisa ser numerica - confirmado em 12/08/2026 que 'registration' no device e
	// numero (visto real: 2.600005e+06). CPF de teste valido (passa no digito verificador) -
	// "00000000000" foi recusado com "'cpf' em formato incorreto". 011144477735 -> right(11) =
	// 11144477735, um CPF de teste sintaticamente valido e amplamente usado em QA de sistemas
	// brasileiros (nunca emitido de verdade).
	err := rc.CriarUsuario("900000", "SISESCALA TESTE - PODE APAGAR", "011144477735")
	if err != nil {
		fmt.Printf("CriarUsuario: FALHOU — %v\n", err)
		fmt.Println("\nA mensagem acima, se tiver a resposta crua do rele, e o que decide o proximo passo.")
	} else {
		fmt.Println("CriarUsuario: OK")
	}

	comBiometria, err := rc.ListarUsuariosComBiometria()
	if err != nil {
		fmt.Printf("ListarUsuariosComBiometria: FALHOU — %v\n", err)
	} else {
		fmt.Printf("ListarUsuariosComBiometria: OK — %d usuario(s) com template cadastrado: %v\n", len(comBiometria), comBiometria)
	}
}
