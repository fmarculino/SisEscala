// coletor-rep é a CLI de diagnóstico/uso manual do coletor local do SisEscala — login no
// relógio, sync avulso, e abrir o terminal local uma vez. Para rodar continuamente numa
// unidade, use o app de bandeja (cmd/tray) em vez desta CLI: ele faz o mesmo ciclo
// (pacote ciclo/, compartilhado pelos dois) sozinho, com ícone de status e sem depender de
// ninguém lembrar de rodar um comando.
package main

import (
	"fmt"
	"os"
	"path/filepath"

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
	case "cadastros":
		if err := ciclo.SincronizarCadastros(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao sincronizar cadastros: %v\n", err)
			os.Exit(1)
		}
	case "cadastros-testar":
		rodarCadastrosTestar(cfg)
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
  coletor-rep cadastros           aplica a fila de push de identidade real no rele (Fase 7) - GRAVA no equipamento
  coletor-rep cadastros-testar    cria UM usuario de teste no rele e lista biometria (diagnostico - GRAVA no equipamento, ver aviso)
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
