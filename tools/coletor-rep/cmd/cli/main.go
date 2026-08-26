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
		if err := comTodos(cfg, ciclo.Sync, ciclo.SyncTodos); err != nil {
			fmt.Fprintf(os.Stderr, "Falha na sincronizacao: %v\n", err)
			os.Exit(1)
		}
	case "heartbeat":
		if err := comTodos(cfg, ciclo.Heartbeat, ciclo.HeartbeatTodos); err != nil {
			fmt.Fprintf(os.Stderr, "Falha no heartbeat: %v\n", err)
			os.Exit(1)
		}
	case "diagnostico":
		rodarDiagnostico(cfg)
	case "afd-raw":
		rodarAfdRaw(cfg, escolherDispositivo(cfg))
	case "afd-exportar":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Uso: coletor-rep afd-exportar <caminho-do-arquivo-de-saida.sisrep>")
			os.Exit(1)
		}
		rodarAfdExportar(cfg, escolherDispositivo(cfg), caminhoCfg, os.Args[2])
	case "cadastros":
		resultado, err := comTodosResultado(cfg,
			func(d *config.DispositivoRepConfig) (ciclo.ResultadoCadastros, error) {
				return ciclo.SincronizarCadastros(cfg, d, 0)
			},
			func() (ciclo.ResultadoCadastros, error) { return ciclo.SincronizarCadastrosTodos(cfg, 0) })
		if err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao sincronizar cadastros: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("pendentes=%d enviados=%d falhas=%d\n", resultado.Pendentes, resultado.Enviados, resultado.Falhas)
	case "cadastros-exportar":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Uso: coletor-rep cadastros-exportar <caminho-do-arquivo-de-saida>")
			os.Exit(1)
		}
		rodarCadastrosExportar(cfg, escolherDispositivo(cfg), os.Args[2])
	case "cadastros-testar":
		rodarCadastrosTestar(cfg, escolherDispositivo(cfg))
	case "remocao-testar":
		rodarRemocaoTestar(cfg, escolherDispositivo(cfg))
	case "higiene":
		resultado, err := comTodosResultado(cfg,
			func(d *config.DispositivoRepConfig) (ciclo.ResultadoHigiene, error) {
				return ciclo.HigienizarListagem(cfg, d)
			},
			func() (ciclo.ResultadoHigiene, error) { return ciclo.HigienizarListagemTodos(cfg) })
		if err != nil {
			fmt.Fprintf(os.Stderr, "Falha ao listar cadastros do rele: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("usuarios_lidos=%d\n", resultado.UsuariosLidos)
	case "higiene-remover":
		_, err := comTodosResultado(cfg,
			func(d *config.DispositivoRepConfig) (ciclo.ResultadoRemocao, error) {
				return ciclo.HigienizarRemocoes(cfg, d, 0)
			},
			func() (ciclo.ResultadoRemocao, error) { return ciclo.HigienizarRemocoesTodos(cfg, 0) })
		if err != nil {
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
  coletor-rep cadastros-exportar <arq>  exporta a fila de push de identidade (Fase 7) para um
                                   arquivo texto no formato que o menu "Receber usuarios" do
                                   equipamento aceita - unidade sem rede ate o SisEscala, ver README
  coletor-rep cadastros-testar    cria UM usuario de teste no rele e lista biometria (diagnostico - GRAVA no equipamento, ver aviso)
  coletor-rep remocao-testar      cria UM usuario de teste e o APAGA - descobre qual formato de remove_users.fcgi este rele aceita, sem tocar em cadastro real
  coletor-rep higiene             le todos os usuarios do rele e reporta ao SisEscala (Fase 7b) - so' leitura, seguro rodar sempre
  coletor-rep higiene-remover     aplica no rele quem foi selecionado na tela de higiene - GRAVA/APAGA no equipamento, ver aviso em rep/client.go
  coletor-rep terminal abrir      abre a tela de presenca local no navegador (uma vez)

Flags:
  --config <caminho>       caminho do config.yaml (default: config.yaml ao lado do executavel)
  --dispositivo <ref>      qual relogio usar, por nome, ip ou id (maquinas com mais de um).
                           Sem a flag, os comandos de rotina (sync/heartbeat/cadastros/higiene/
                           higiene-remover) rodam em TODOS; os que falam com um equipamento so'
                           (afd-raw, afd-exportar, cadastros-exportar, cadastros-testar,
                           remocao-testar) recusam ate' voce escolher.`)
}

// referenciaDispositivo le a flag --dispositivo <ref> (ou --dispositivo=<ref>). Fica fora do
// switch de comandos porque vale para todos, e os comandos ja usam os argumentos posicionais.
func referenciaDispositivo() string {
	for i, arg := range os.Args {
		if arg == "--dispositivo" && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
		if strings.HasPrefix(arg, "--dispositivo=") {
			return strings.TrimPrefix(arg, "--dispositivo=")
		}
	}
	return ""
}

// escolherDispositivo resolve O relogio dos comandos de equipamento unico. Com varios
// configurados e nenhuma escolha, config.Dispositivo devolve erro listando os disponiveis - e
// aqui isso encerra o comando, de proposito: adivinhar qual dos quatro seria escrever num
// equipamento de producao por conta propria.
func escolherDispositivo(cfg *config.Config) *config.DispositivoRepConfig {
	d, err := cfg.Dispositivo(referenciaDispositivo())
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	return d
}

// comTodos roda um comando de rotina: no relogio escolhido, se houve --dispositivo; em todos,
// se nao houve.
func comTodos(cfg *config.Config, um func(*config.Config, *config.DispositivoRepConfig) error, todos func(*config.Config) error) error {
	if ref := referenciaDispositivo(); ref != "" {
		d, err := cfg.Dispositivo(ref)
		if err != nil {
			return err
		}
		return um(cfg, d)
	}
	return todos(cfg)
}

// comTodosResultado e' comTodos para os comandos que devolvem contadores somaveis.
func comTodosResultado[T any](cfg *config.Config, um func(*config.DispositivoRepConfig) (T, error), todos func() (T, error)) (T, error) {
	if ref := referenciaDispositivo(); ref != "" {
		d, err := cfg.Dispositivo(ref)
		if err != nil {
			var zero T
			return zero, err
		}
		return um(d)
	}
	return todos()
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

	dispositivos := cfg.Dispositivos()
	if len(dispositivos) == 0 {
		fmt.Println("dispositivo_rep: nao configurado nesta maquina")
	}
	for _, d := range dispositivos {
		fmt.Printf("relogio %s: %s (%s:%d)\n", d.Rotulo(), d.ID, d.Endereco, d.Porta)

		rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)
		if err := rc.Login(); err != nil {
			fmt.Printf("  login no REP: FALHOU (%v)\n", err)
		} else {
			fmt.Println("  login no REP: OK")
		}

		sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)
		if err := sc.Heartbeat(nil, ciclo.Versao, ciclo.Hostname()); err != nil {
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
func rodarAfdRaw(cfg *config.Config, d *config.DispositivoRepConfig) {
	// Pede sempre do NSR 1, ou seja o arquivo inteiro: precisa do teto folgado de get_afd.fcgi,
	// senao este comando falha por timeout exatamente no relogio de alto volume onde ele e' mais
	// necessario.
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint).
		ComTimeoutAFD(d.TimeoutAfdSegundos)

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
func rodarAfdExportar(cfg *config.Config, d *config.DispositivoRepConfig, caminhoCfg, caminhoSaida string) {
	// A PRIMEIRA exportacao de um relogio ja usado traz o arquivo inteiro (estado local zerado),
	// entao vale o mesmo teto folgado de get_afd.fcgi usado pelo sync.
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint).
		ComTimeoutAFD(d.TimeoutAfdSegundos)

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

// rodarCadastrosExportar busca a fila de push de identidade (Fase 7, mesma fonte que o comando
// "cadastros" online usa) e grava num arquivo texto CSV ';' - descoberto em 14/08/2026 examinando
// o par exportar/importar do menu "Enviar usuarios"/"Receber usuarios" do proprio equipamento
// (REP-iDClass-CEI), confirmado por um ciclo real de exportar+importar sem erro no rele:
//
//	cpf;nome;administrador;matricula;rfid;codigo;senha;barras;digitais
//
// So GERA o arquivo - nao toca no rele (essa maquina pode nao ter rede ate ele) nem confirma nada
// no SisEscala (essa maquina pode nao ter rede ate o SisEscala tambem, e mesmo tendo, a aplicacao
// de verdade so acontece depois, fisicamente, no equipamento - confirmar antes seria inventar
// sucesso, o mesmo erro que a confirmacao de AFD ja evita).
//
// "digitais" fica sempre vazio - biometria continua so' podendo ser cadastrada presencialmente no
// equipamento (nunca por API, ver CLAUDE.md), e o campo aceita vazio (confirmado: 19 dos 67
// usuarios do export de teste nao tinham biometria e vieram assim mesmo).
//
// cpf/matricula replicam EXATAMENTE a mesma conversao que CriarUsuario (rep/client.go) ja faz
// para o caminho online — nao inventa uma segunda regra para o mesmo dado. Formato numerico (sem
// zero a esquerda) e' o oposto da convencao do AFD (identificador_afd, 12 digitos com zero de
// preenchimento, armadilha 10 do CLAUDE.md) - confirmado batendo com o "cpf" real visto no export
// do proprio equipamento (ex.: CPF terminado em ...094233 comecando com zero saiu como
// "1533094233", sem o zero).
//
// Nao fecha o loop de confirmacao sozinho: depois de aplicar no rele com "Receber usuarios",
// quando esse relogio tiver rede, rode "coletor-rep higiene" (reporta o snapshot ao SisEscala) e
// use fn_vincular_cadastros_por_cpf (ja existe, tela /marcacoes) para criar o rep_vinculos_servidor
// a partir do CPF batido - o mesmo mecanismo que ja resolve o caso dominante de "bate e nao
// registra" (CLAUDE.md, "Cobertura de ponto"). rep_cadastros_fila continua "pendente" ate la; rodar
// este comando de novo antes disso so reexporta a mesma lista, o que e' seguro (reaplicar no rele
// nao gerou erro no teste real).
func rodarCadastrosExportar(cfg *config.Config, d *config.DispositivoRepConfig, caminhoSaida string) {
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)

	pendentes, err := sc.ListarCadastrosPendentes()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao listar cadastros pendentes: %v\n", err)
		os.Exit(1)
	}
	if len(pendentes) == 0 {
		fmt.Println("Nenhum cadastro pendente para exportar.")
		return
	}

	linhas := []string{"cpf;nome;administrador;matricula;rfid;codigo;senha;barras;digitais"}
	pulados := 0

	for _, p := range pendentes {
		matriculaLimpa := strings.TrimPrefix(strings.ToUpper(p.Matricula), "T")
		matriculaNum, err := strconv.ParseInt(matriculaLimpa, 10, 64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "aviso: matricula %q (%s) nao e numerica apos remover prefixo - pulando\n", p.Matricula, p.Nome)
			pulados++
			continue
		}

		cpfStr := p.IdentificadorAFD
		if len(cpfStr) > 11 {
			cpfStr = cpfStr[len(cpfStr)-11:]
		}
		cpfNum, err := strconv.ParseInt(cpfStr, 10, 64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "aviso: identificador_afd %q (%s) nao produziu cpf numerico - pulando\n", p.IdentificadorAFD, p.Nome)
			pulados++
			continue
		}

		nome := strings.ReplaceAll(p.Nome, ";", " ")
		linhas = append(linhas, fmt.Sprintf("%d;%s;0;%d;0;0;;;", cpfNum, nome, matriculaNum))
	}

	if len(linhas) == 1 {
		fmt.Fprintln(os.Stderr, "Nenhum cadastro pendente pode ser exportado (todos pulados por erro de formato).")
		os.Exit(1)
	}

	conteudo := strings.Join(linhas, "\n") + "\n"
	if err := os.WriteFile(caminhoSaida, []byte(conteudo), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "Falha ao gravar %s: %v\n", caminhoSaida, err)
		os.Exit(1)
	}

	fmt.Printf("Exportado: %s (%d cadastro(s), %d pulado(s) por erro de formato)\n", caminhoSaida, len(linhas)-1, pulados)
	fmt.Println(`Leve este arquivo ate o relogio e aplique pelo menu do equipamento: "Receber usuarios".`)
	fmt.Println("Nada foi confirmado no SisEscala por este comando - depois de aplicar no rele,")
	fmt.Println(`quando este relogio tiver rede, rode "coletor-rep higiene" e depois vincule por CPF`)
	fmt.Println("na tela /marcacoes para fechar o loop.")
}

// rodarCadastrosTestar cria UM usuario de teste diretamente no rele (nome bem marcado, para
// achar e apagar na mao pela interface do equipamento depois) e lista quem tem biometria - sem
// tocar na fila real do SisEscala (nunca chama sisescala.ConfirmarCadastro). Existe porque
// create_objects.fcgi/load_objects.fcgi (rep/client.go) NUNCA foram confirmados contra hardware
// real - rodar isto uma vez, contra o rele de teste, e o que decide se e seguro habilitar
// `cadastros`/o botao da bandeja em producao. Se o formato de campo estiver errado, o erro
// impresso abaixo traz a resposta crua do equipamento (ver %v em rep/client.go).
func rodarCadastrosTestar(cfg *config.Config, d *config.DispositivoRepConfig) {
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	fmt.Println("ATENCAO: isto vai GRAVAR um usuario de teste no rele de verdade.")
	fmt.Println("Nome usado: 'SISESCALA TESTE - PODE APAGAR' / matricula '900000' — apague pela")
	fmt.Println("interface do proprio equipamento depois de conferir o resultado abaixo.")
	fmt.Println()

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
	identNoDevice, err := rc.CriarUsuario("900000", "SISESCALA TESTE - PODE APAGAR", "011144477735")
	if err != nil {
		fmt.Printf("CriarUsuario: FALHOU — %v\n", err)
		fmt.Println("\nA mensagem acima, se tiver a resposta crua do rele, e o que decide o proximo passo.")
	} else {
		fmt.Println("CriarUsuario: OK")
		// O formato aceito e o identificador atribuido sao o RESULTADO deste comando: decidem se
		// este modelo precisa de PIS em vez de CPF, e qual numero vai aparecer na marcacao do AFD
		// (logo, qual numero precisa virar rep_vinculos_servidor).
		fmt.Printf("  formato aceito pelo add_users.fcgi: %s\n", rc.FormatoCadastroUsado())
		fmt.Printf("  identificador que o RELOGIO atribuiu: %q\n", identNoDevice)
	}

	comBiometria, err := rc.ListarUsuariosComBiometria()
	if err != nil {
		fmt.Printf("ListarUsuariosComBiometria: FALHOU — %v\n", err)
	} else {
		fmt.Printf("ListarUsuariosComBiometria: OK — %d usuario(s) com template cadastrado: %v\n", len(comBiometria), comBiometria)
	}
}

// identificadorTeste e' o CPF de teste (011144477735 -> right(11) = 11144477735, sintaticamente
// valido e nunca emitido) ja usado por rodarCadastrosTestar. Mesmo usuario nos dois comandos: se
// remocao-testar falhar no meio, o cadastro que sobra e' o mesmo "SISESCALA TESTE - PODE APAGAR"
// que ja se sabe apagar na mao pela interface do equipamento.
const identificadorTeste = "011144477735"

// rodarRemocaoTestar cria o usuario de teste e tenta APAGA-LO, so' para descobrir qual formato de
// corpo o remove_users.fcgi deste equipamento aceita — o formato original foi reprovado em campo
// (13/08/2026, LACEM: "'users' em formato incorreto" nas 31 remocoes da fila). Nao toca na fila
// real do SisEscala: nenhuma chamada a sisescala.ConfirmarRemocao aqui.
//
// Roda contra um cadastro descartavel de proposito. rep.RemoverUsuario confere por relistagem se
// o alvo certo (e so' ele) sumiu, entao o custo de um formato errado e' um usuario de teste que
// continua no rele, nunca cadastro de servidor real.
func rodarRemocaoTestar(cfg *config.Config, d *config.DispositivoRepConfig) {
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	fmt.Println("ATENCAO: isto GRAVA e depois APAGA um usuario de teste no rele de verdade.")
	fmt.Println("Nome usado: 'SISESCALA TESTE - PODE APAGAR' / matricula '900000'. Nenhum cadastro")
	fmt.Println("real e' tocado, e a fila de remocao do SisEscala nao e' consultada nem alterada.")
	fmt.Println()

	if err := rc.Login(); err != nil {
		fmt.Fprintf(os.Stderr, "Falha no login: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("login no REP: OK")

	if _, err := rc.CriarUsuario("900000", "SISESCALA TESTE - PODE APAGAR", identificadorTeste); err != nil {
		// Ja existir de uma rodada anterior de cadastros-testar nao impede o teste de remocao —
		// a busca abaixo decide.
		fmt.Printf("CriarUsuario: FALHOU — %v\n", err)
		fmt.Println("(seguindo mesmo assim: se o usuario de teste ja existir de uma rodada anterior, da' para remover)")
	} else {
		fmt.Println("CriarUsuario: OK")
	}

	usuarios, err := rc.ListarUsuarios()
	if err != nil {
		fmt.Fprintf(os.Stderr, "ListarUsuarios: FALHOU — %v\n", err)
		os.Exit(1)
	}
	var alvo *rep.UsuarioDispositivo
	for i := range usuarios {
		if usuarios[i].IdentificadorAFD == identificadorTeste {
			alvo = &usuarios[i]
			break
		}
	}
	if alvo == nil {
		fmt.Fprintf(os.Stderr, "O usuario de teste (%s) nao apareceu em load_users.fcgi — sem alvo seguro para testar a remocao.\n", identificadorTeste)
		os.Exit(1)
	}
	fmt.Printf("alvo de teste no rele: %q pis=%d code=%d(conhecido=%v) registration=%d(conhecido=%v)\n",
		alvo.Nome, alvo.Pis, alvo.Code, alvo.CodeConhecido, alvo.Registration, alvo.RegistrationConh)

	if err := rc.RemoverUsuario(*alvo); err != nil {
		fmt.Printf("RemoverUsuario: FALHOU — %v\n", err)
		fmt.Println("\nA lista de tentativas acima e' o que decide o proximo passo: se NENHUM formato")
		fmt.Println("foi aceito, o campo de identidade esperado por remove_users.fcgi neste modelo e'")
		fmt.Println("outro. Apague o usuario de teste pela interface do equipamento.")
		os.Exit(1)
	}
	fmt.Printf("RemoverUsuario: OK — formato aceito por este equipamento: %s\n", rc.FormatoRemocaoUsado())
	fmt.Println("Confirmado por relistagem: so' o usuario de teste sumiu do cadastro.")
	fmt.Println("Pode rodar 'coletor-rep higiene-remover' para aplicar a fila real.")
}
