// coletor-rep-tray é o app de bandeja do coletor local do SisEscala: sincroniza o relógio de
// ponto (quando `dispositivo_rep` está configurado) e mantém a tela de presença do terminal
// local aberta (quando `terminal_local` está configurado) — sem exigir Agendador de Tarefas
// nem instalação como serviço do Windows. Um serviço de verdade roda na Sessão 0, isolada da
// área de trabalho desde o Windows Vista, e por isso NUNCA pode mostrar ícone de bandeja nem
// abrir navegador na sessão do usuário — é por isso que esta versão abandonou
// `kardianos/service` (usado pela CLI antiga) em favor de um processo comum, iniciado na
// sessão do usuário logado via autostart do próprio Windows (HKCU\...\Run).
//
// Auto-instalável: baixado do SisEscala como um .zip com este executável + um config.yaml já
// preenchido, ao rodar pela primeira vez ele se copia para %LOCALAPPDATA%\SisEscala\coletor-rep\,
// registra o autostart e relança a si mesmo de lá — não existe passo de "instalação" separado
// do primeiro clique.
package main

import (
	_ "embed"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	"fyne.io/systray"
	"github.com/gen2brain/beeep"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"gopkg.in/yaml.v3"

	"github.com/sms-maraba/sisescala-coletor-rep/ciclo"
	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/terminal"
)

//go:embed assets/icon_green.ico
var iconGreen []byte

//go:embed assets/icon_red.ico
var iconRed []byte

//go:embed assets/icon_gray.ico
var iconGray []byte

const (
	nomeExecutavel   = "coletor-rep-tray.exe"
	nomeMutexUnico   = `Global\SisEscalaColetorRepTray`
	chaveAutostart   = "SisEscalaColetorRep"
	intervaloCiclo   = 5 * time.Minute
	falhasParaAvisar = 3
)

func main() {
	garantirInstanciaUnica()

	// Atalho de desenvolvimento SO para `go run` - detectado pelo caminho do binario, nunca
	// pela presenca de config.yaml. BUG CORRIGIDO EM 12/08/2026: a versao anterior checava so
	// "existe config.yaml no diretorio de trabalho atual", e o Explorer do Windows abre um .exe
	// com o CWD igual a pasta do proprio executavel - exatamente onde o .zip baixado sempre
	// deixa o config.yaml ao lado do .exe. Resultado: TODO usuario real que dava duplo-clique
	// caia neste atalho, rodava direto da pasta extraida, e NUNCA se auto-instalava (nunca
	// copiava para %LOCALAPPDATA%, nunca registrava autostart, nunca mesclava config.yaml) -
	// "reinstalar" rodando o mesmo .exe de novo era sempre um no-op, sempre lendo o mesmo
	// arquivo estatico da extracao original. `go run` compila para um binario temporario dentro
	// de um diretorio "go-build..." em os.TempDir() - isso sim e um sinal confiavel de que nao
	// e um .exe baixado de verdade.
	dirInstalado := diretorioInstalado()
	if rodandoViaGoRun() {
		if _, err := os.Stat("config.yaml"); err == nil {
			dirInstalado, _ = filepath.Abs(".")
		} else {
			mostrarErroFatal("Modo de desenvolvimento (go run): crie um config.yaml no diretorio atual.")
			os.Exit(1)
		}
	} else if !estaRodandoDe(dirInstalado) {
		autoInstalarERelancar(dirInstalado)
		return
	}

	configurarLog(dirInstalado)
	log.Printf("coletor-rep-tray %s iniciando em %s", ciclo.Versao, dirInstalado)

	cfg, err := config.Carregar(filepath.Join(dirInstalado, "config.yaml"))
	if err != nil {
		mostrarErroFatal(fmt.Sprintf("config.yaml invalido ou ausente em %s:\n%v", dirInstalado, err))
		os.Exit(1)
	}

	systray.Run(func() { aoIniciar(cfg, dirInstalado) }, func() {})
}

// handleMutexUnico e' o mutex nomeado que garantirInstanciaUnica segura enquanto o processo esta
// vivo. Guardado num var de pacote (em vez de descartado) porque aplicarAtualizacao precisa
// libera-lo explicitamente ANTES de iniciar o processo novo - ver comentario la.
var handleMutexUnico windows.Handle

// garantirInstanciaUnica evita duas bandejas do mesmo app rodando ao mesmo tempo (ex.: usuario
// clica no .exe baixado de novo depois de ja estar instalado). Mutex nomeado e o jeito padrao
// do Windows para isso - se ja existe, so sair.
func garantirInstanciaUnica() {
	nome, err := windows.UTF16PtrFromString(nomeMutexUnico)
	if err != nil {
		return
	}
	h, err := windows.CreateMutex(nil, false, nome)
	if err == windows.ERROR_ALREADY_EXISTS {
		os.Exit(0)
	}
	handleMutexUnico = h
}

// liberarInstanciaUnica libera o mutex nomeado sem encerrar o processo - usado so' por
// aplicarAtualizacao (ver comentario la) para o processo novo nao brigar pelo mutex com este
// que ja vai sair em seguida.
func liberarInstanciaUnica() {
	if handleMutexUnico == 0 {
		return
	}
	windows.ReleaseMutex(handleMutexUnico)
	windows.CloseHandle(handleMutexUnico)
	handleMutexUnico = 0
}

// aguardarNovoProcessoAssumirMutex sonda (a cada 200ms, ate durTotal) se algum processo passou a
// segurar o mutex nomeado - e' o sinal de que o processo relancado por aplicarAtualizacao chegou
// de verdade a rodar main()/garantirInstanciaUnica(), nao so' que o Windows aceitou criar o
// processo (o que exec.Command().Start() sem erro so' garante). Usa OpenMutex (nunca CRIA o
// objeto, so' verifica se ja existe) de proposito - se usasse CreateMutex feito
// garantirInstanciaUnica, a propria sondagem poderia criar o mutex entre duas tentativas e fazer
// o processo novo, chegando nesse instante, achar que ja existe outra instancia (nos mesmos, so'
// que sondando) e desistir - a sondagem causando exatamente a falha que ela existe pra detectar.
func aguardarNovoProcessoAssumirMutex(durTotal time.Duration) bool {
	nome, err := windows.UTF16PtrFromString(nomeMutexUnico)
	if err != nil {
		return false
	}
	intervalo := 200 * time.Millisecond
	for decorrido := time.Duration(0); decorrido < durTotal; decorrido += intervalo {
		h, err := windows.OpenMutex(windows.SYNCHRONIZE, false, nome)
		if err == nil {
			windows.CloseHandle(h)
			return true
		}
		time.Sleep(intervalo)
	}
	return false
}

// rodandoViaGoRun detecta `go run` pelo caminho do binario compilado, nunca por arquivos ao
// lado dele - ver comentario em main() sobre o bug que essa distincao corrige.
func rodandoViaGoRun() bool {
	exePath, err := os.Executable()
	if err != nil {
		return false
	}
	return strings.Contains(exePath, "go-build")
}

func diretorioInstalado() string {
	base, err := os.UserCacheDir() // %LOCALAPPDATA% no Windows
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "SisEscala", "coletor-rep")
}

func estaRodandoDe(dir string) bool {
	exePath, err := os.Executable()
	if err != nil {
		return false
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return false
	}
	alvo := filepath.Join(dir, nomeExecutavel)
	return strings.EqualFold(exePath, alvo)
}

// autoInstalarERelancar copia o executavel + config.yaml (que vieram juntos no .zip baixado)
// para o diretorio permanente, registra o autostart, e relanca a copia instalada - o processo
// atual (rodando da pasta de download/extracao) sempre termina depois desta funcao.
func autoInstalarERelancar(dirInstalado string) {
	exeAtual, err := os.Executable()
	if err != nil {
		mostrarErroFatal("Nao foi possivel localizar o proprio executavel: " + err.Error())
		os.Exit(1)
	}
	dirOrigem := filepath.Dir(exeAtual)
	configOrigem := filepath.Join(dirOrigem, "config.yaml")

	if _, err := os.Stat(configOrigem); err != nil {
		mostrarErroFatal(
			"config.yaml nao encontrado ao lado do aplicativo (pasta: " + dirOrigem + ").\n\n" +
				"Baixe o aplicativo novamente em Marcacoes, no SisEscala, e extraia o .zip " +
				"inteiro antes de executar - o executavel sozinho, sem o config.yaml junto, " +
				"nao sabe a qual terminal/dispositivo pertence.")
		os.Exit(1)
	}

	if err := os.MkdirAll(dirInstalado, 0o755); err != nil {
		mostrarErroFatal("Nao foi possivel criar " + dirInstalado + ": " + err.Error())
		os.Exit(1)
	}

	exeDestino := filepath.Join(dirInstalado, nomeExecutavel)
	if err := copiarArquivo(exeAtual, exeDestino); err != nil {
		mostrarErroFatal("Falha ao instalar o executavel em " + dirInstalado + ": " + err.Error())
		os.Exit(1)
	}
	if err := instalarConfig(configOrigem, filepath.Join(dirInstalado, "config.yaml")); err != nil {
		mostrarErroFatal("Falha ao instalar config.yaml: " + err.Error())
		os.Exit(1)
	}

	if err := registrarAutostart(exeDestino); err != nil {
		// Nao fatal: o app funciona nesta sessao mesmo sem autostart - so nao volta sozinho
		// depois de um reboot. Registrado em HKCU (nao HKLM): nao exige administrador, o que
		// importa porque quem instala numa unidade de saude provavelmente nao e admin da maquina.
		mostrarErroFatal(
			"Instalado em " + dirInstalado + ", mas nao foi possivel registrar a inicializacao " +
				"automatica (" + err.Error() + "). O aplicativo vai funcionar nesta sessao, mas " +
				"nao vai reabrir sozinho se o computador reiniciar - abra manualmente pela pasta " +
				"acima, ou peca ajuda para registrar isso.")
	}

	cmd := exec.Command(exeDestino)
	if err := cmd.Start(); err != nil {
		mostrarErroFatal(
			"Instalado em " + dirInstalado + ", mas falhou ao iniciar automaticamente (" + err.Error() + "). " +
				"Abra o aplicativo manualmente por essa pasta.")
		os.Exit(1)
	}
	os.Exit(0)
}

func copiarArquivo(origem, destino string) error {
	src, err := os.Open(origem)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(destino)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	return err
}

// instalarConfig copia o config.yaml recém-baixado para o destino — MESCLANDO com um
// config.yaml que já esteja instalado ali, em vez de sobrescrever. Cada download do SisEscala
// só preenche a seção que o admin pediu (terminal_local OU dispositivo_rep); uma máquina que
// precisa das duas modalidades roda os dois instaladores em sequência, e é isto que evita que
// o segundo apague a seção que o primeiro já tinha gravado. Ninguém edita YAML na mão.
func instalarConfig(configOrigem, configDestino string) error {
	novoConteudo, err := os.ReadFile(configOrigem)
	if err != nil {
		return err
	}

	existenteConteudo, err := os.ReadFile(configDestino)
	if err != nil {
		// Nada instalado ainda (ou erro de leitura irrelevante aqui) - so copia.
		return os.WriteFile(configDestino, novoConteudo, 0o644)
	}

	var existente, novo config.Config
	if yaml.Unmarshal(existenteConteudo, &existente) != nil || yaml.Unmarshal(novoConteudo, &novo) != nil {
		// Um dos dois nao parseou - nao arrisca mesclar dado que pode estar corrompido.
		log.Printf("aviso: config.yaml existente ou novo nao parseou como YAML valido; sobrescrevendo sem mesclar")
		return os.WriteFile(configDestino, novoConteudo, 0o644)
	}

	mesclado := novo
	if novo.DispositivoRep == nil && existente.DispositivoRep != nil {
		mesclado.DispositivoRep = existente.DispositivoRep
		log.Println("config.yaml: preservada a secao dispositivo_rep de uma instalacao anterior")
	}
	if novo.TerminalLocal == nil && existente.TerminalLocal != nil {
		mesclado.TerminalLocal = existente.TerminalLocal
		log.Println("config.yaml: preservada a secao terminal_local de uma instalacao anterior")
	}

	saida, err := yaml.Marshal(&mesclado)
	if err != nil {
		return err
	}
	return os.WriteFile(configDestino, saida, 0o644)
}

func registrarAutostart(exePath string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(chaveAutostart, `"`+exePath+`"`)
}

// mostrarErroFatal usa MessageBoxW direto (sem cgo) porque um app de bandeja nao tem console -
// escrever em stderr some no vazio. E o unico canal garantido de chegar ao usuario antes do
// log/tooltip existirem.
func mostrarErroFatal(msg string) {
	titulo, errT := windows.UTF16PtrFromString("SisEscala - Coletor")
	texto, errM := windows.UTF16PtrFromString(msg)
	if errT != nil || errM != nil {
		return
	}
	user32 := windows.NewLazySystemDLL("user32.dll")
	messageBoxW := user32.NewProc("MessageBoxW")
	const mbIconError = 0x10
	messageBoxW.Call(0, uintptr(unsafe.Pointer(texto)), uintptr(unsafe.Pointer(titulo)), mbIconError)
}

func configurarLog(dir string) {
	f, err := os.OpenFile(filepath.Join(dir, "coletor-rep.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(f)
}

// estadoApp guarda o resultado do ultimo ciclo - lido pela bandeja (icone/tooltip/status) e
// escrito pela goroutine do ciclo. Protegido por mutex porque os dois lados rodam em
// goroutines diferentes.
type estadoApp struct {
	mu             sync.Mutex
	ultimoSucesso  time.Time
	falhasSeguidas int
}

func (e *estadoApp) registrarResultado(ok bool) (falhasAntes, falhasDepois int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	falhasAntes = e.falhasSeguidas
	if ok {
		e.ultimoSucesso = time.Now()
		e.falhasSeguidas = 0
	} else {
		e.falhasSeguidas++
	}
	return falhasAntes, e.falhasSeguidas
}

func (e *estadoApp) snapshot() (ultimoSucesso time.Time, falhas int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.ultimoSucesso, e.falhasSeguidas
}

func aoIniciar(cfg *config.Config, dirInstalado string) {
	systray.SetIcon(iconGray)
	systray.SetTooltip("SisEscala - iniciando...")

	itemStatus := systray.AddMenuItem("Status: iniciando...", "")
	itemStatus.Disable()
	systray.AddSeparator()
	itemSyncAgora := systray.AddMenuItem("Sincronizar agora", "Roda o ciclo de sincronizacao imediatamente")
	itemAbrirTerminal := systray.AddMenuItem("Abrir tela de presenca", "Abre a tela de presenca local no navegador")
	if cfg.TerminalLocal == nil {
		itemAbrirTerminal.Disable()
	}
	// So manual, nunca no ticker automatico: rep.CriarUsuario/ListarUsuariosComBiometria ainda
	// nao foram validadas contra hardware real (ver aviso em rep/client.go) - um clique errado
	// e recuperavel, um loop automatico escrevendo errado no rele de producao nao seria.
	itemSincronizarCadastros := systray.AddMenuItem("Sincronizar cadastros agora", "Envia identidade (matricula/nome/CPF) pendente para o rele")
	if cfg.DispositivoRep == nil {
		itemSincronizarCadastros.Disable()
	}
	// So' leitura no rele (load_users.fcgi, ja confirmado contra hardware real) - seguro no menu.
	// A remocao (destrutiva, rep.RemoverUsuario nunca confirmada contra hardware real) fica so'
	// na CLI (`coletor-rep higiene-remover`), nao na bandeja - ver aviso em ciclo.HigienizarRemocoes.
	itemHigienizarCadastros := systray.AddMenuItem("Atualizar lista de cadastros do relogio", "Le todos os usuarios do rele e envia ao SisEscala, para a tela de higiene em Marcacoes")
	if cfg.DispositivoRep == nil {
		itemHigienizarCadastros.Disable()
	}
	itemVerLogs := systray.AddMenuItem("Ver logs", "Abre a pasta de logs e configuracao")
	systray.AddSeparator()
	// Sempre visivel, nunca clicavel - so' pra quem abrir o menu ja saber de cara qual versao
	// esta instalada, sem precisar clicar em "Verificar atualizacao" pra descobrir.
	itemVersaoInstalada := systray.AddMenuItem("Versao instalada: v"+ciclo.Versao, "")
	itemVersaoInstalada.Disable()
	itemAtualizar := systray.AddMenuItem("Verificar atualizacao", "Confere se ha uma versao mais nova do coletor-rep-tray")
	itemSair := systray.AddMenuItem("Sair", "Encerra o coletor-rep")

	estado := &estadoApp{}

	// Estado da atualizacao — lido e escrito SO dentro da goroutine unica do loop de eventos
	// abaixo (executarCiclo e os case dos ClickedCh rodam todos ali, nunca em paralelo entre si),
	// entao nao precisa de mutex. "avisa e espera clique, nunca aplica sozinho": verificarAtualizacao
	// so troca o titulo do item e manda uma notificacao; quem baixa e substitui o executavel e'
	// sempre o clique em itemAtualizar.ClickedCh, nunca o ticker automatico.
	var (
		infoAtualizacao   ciclo.InfoVersaoServidor
		atualizacaoPronta bool
		ultimaChecagem    time.Time
	)

	verificarAtualizacao := func(manual bool) {
		info, temNova, err := ciclo.VersaoDisponivel(cfg)
		ultimaChecagem = time.Now()
		if err != nil {
			log.Printf("erro ao verificar atualizacao: %v", err)
			// O titulo do item fica valendo ate a proxima checagem - diferente da notificacao
			// (beeep), que depende do Windows entregar o toast e pode passar despercebida. Quem
			// abrir o menu depois ve o resultado sem precisar ter visto o aviso na hora.
			itemAtualizar.SetTitle("Verificar atualizacao (falha ao checar - ver log)")
			if manual {
				_ = beeep.Notify("SisEscala - Coletor", "Nao foi possivel verificar atualizacoes agora. Ver log.", nil)
			}
			return
		}

		jaAvisado := atualizacaoPronta && infoAtualizacao.Versao == info.Versao
		infoAtualizacao = info

		if !temNova {
			atualizacaoPronta = false
			itemAtualizar.SetTitle("Verificar atualizacao (voce esta atualizado)")
			if manual {
				_ = beeep.Notify("SisEscala - Coletor", "Voce ja esta na versao mais recente (v"+ciclo.Versao+").", nil)
			}
			return
		}

		atualizacaoPronta = true
		itemAtualizar.SetTitle("Atualizar para v" + info.Versao)
		if !jaAvisado {
			_ = beeep.Notify("SisEscala - Coletor",
				"Nova versao disponivel: v"+info.Versao+". Clique em 'Atualizar para v"+info.Versao+"' no menu da bandeja.", nil)
		}
	}

	aplicarAtualizacao := func() {
		exeTemp, err := ciclo.BaixarNovaVersao(cfg, infoAtualizacao.SHA256)
		if err != nil {
			log.Printf("erro ao baixar atualizacao: %v", err)
			_ = beeep.Notify("SisEscala - Coletor", "Falha ao baixar a atualizacao. Ver log.", nil)
			return
		}
		defer os.Remove(exeTemp)

		exeAtual := filepath.Join(dirInstalado, nomeExecutavel)
		exeAntigo := exeAtual + ".antigo"
		_ = os.Remove(exeAntigo) // sobra de uma tentativa anterior, melhor esforco

		// Windows permite renomear um .exe em execucao (nao permite sobrescrever com o mesmo
		// nome) — e o mesmo truque que autoInstalarERelancar usa para instalar por cima de uma
		// instalacao anterior, aqui aplicado ao proprio processo rodando.
		if err := os.Rename(exeAtual, exeAntigo); err != nil {
			log.Printf("erro ao renomear executavel atual para aplicar atualizacao: %v", err)
			_ = beeep.Notify("SisEscala - Coletor", "Falha ao aplicar a atualizacao (nao foi possivel substituir o executavel). Ver log.", nil)
			return
		}

		if err := copiarArquivo(exeTemp, exeAtual); err != nil {
			log.Printf("erro ao instalar nova versao: %v", err)
			_ = os.Rename(exeAntigo, exeAtual) // desfaz - segue rodando a versao antiga em vez de ficar sem nenhuma
			_ = beeep.Notify("SisEscala - Coletor", "Falha ao instalar a atualizacao. Ver log.", nil)
			return
		}

		// Libera o mutex nomeado ANTES de iniciar o processo novo - do contrario o processo novo
		// nasce, chama garantirInstanciaUnica() e encontra o mutex ainda em maos deste processo
		// (que so' vai solta-lo alguns instantes depois, em systray.Quit()), conclui que ja existe
		// outra instancia rodando e sai em silencio (os.Exit(0), sem log, sem notificacao - e' um
		// app GUI, nao escreve nada em lugar nenhum antes de configurarLog rodar). Resultado
		// observado em campo: a bandeja some depois de "Atualizar" e o app nao reabre sozinho, so'
		// manualmente. E' uma corrida quase garantida, nao uma falha eventual, porque Start() aqui
		// sempre vinha ANTES do Quit() la embaixo.
		liberarInstanciaUnica()
		log.Printf("atualizado de v%s para v%s, reiniciando", ciclo.Versao, infoAtualizacao.Versao)
		if err := exec.Command(exeAtual).Start(); err != nil {
			log.Printf("erro ao relancar apos atualizar: %v", err)
			_ = beeep.Notify("SisEscala - Coletor", "Atualizado para v"+infoAtualizacao.Versao+", mas falhou ao reiniciar sozinho. Abra o app manualmente.", nil)
			garantirInstanciaUnica() // este processo continua rodando (nao chegou no Quit abaixo) - reocupa o mutex
			return
		}

		// exec.Command().Start() com erro nil so' confirma que o Windows aceitou CRIAR o processo -
		// nao que ele chegou a executar de verdade. Observado em campo em 13/08/2026 mesmo depois
		// do fix acima (mutex liberado a tempo, sem erro nenhum no log): a bandeja sumiu e nao
		// voltou sozinha. Hipotese mais provavel, dado o historico ja documentado deste projeto:
		// Smart App Control/Defender inspecionando o .exe recem-escrito (sem assinatura/reputacao)
		// antes de deixar rodar, e podendo bloquear ou atrasar a execucao sem aviso nenhum pra quem
		// nao esta olhando a tela naquele instante. Em vez de confiar cegamente, espera ate 3s por
		// sinal de que o processo novo assumiu o mutex nomeado - se nao assumir, mante'm ESTA
		// instancia (versao antiga) rodando e avisa, em vez de sumir e deixar ninguem rodando.
		if !aguardarNovoProcessoAssumirMutex(3 * time.Second) {
			log.Printf("aviso: processo novo (v%s) nao assumiu o mutex de instancia unica em 3s - "+
				"provavel bloqueio/atraso do Windows (Smart App Control ou Defender) ao executar o "+
				".exe recem-escrito. Mantendo esta instancia (v%s) rodando.", infoAtualizacao.Versao, ciclo.Versao)
			_ = beeep.Notify("SisEscala - Coletor",
				"Atualizado para v"+infoAtualizacao.Versao+", mas o novo aplicativo nao chegou a iniciar sozinho "+
					"(o Windows pode ter bloqueado o executavel novo). Abra manualmente pela pasta de instalacao, "+
					"ou tente 'Verificar atualizacao' de novo em alguns minutos.", nil)
			garantirInstanciaUnica() // reocupa - esta instancia (versao antiga) continua sendo a "unica" valida
			return
		}
		_ = os.Remove(exeAntigo)
		systray.Quit()
	}

	abrirTerminalSeConfigurado := func() {
		if cfg.TerminalLocal == nil {
			return
		}
		if err := terminal.Abrir(cfg.SisEscala.URL, cfg.TerminalLocal.ID, cfg.TerminalLocal.Token); err != nil {
			log.Printf("falha ao abrir terminal local: %v", err)
		}
	}

	// Abre a tela de presenca sozinho ao iniciar - e o que faz ela "ficar aberta la" depois de
	// um reboot, sem precisar que alguem clique em nada.
	abrirTerminalSeConfigurado()

	executarCiclo := func() {
		itemStatus.SetTitle("Status: sincronizando...")
		ok := true
		if cfg.DispositivoRep != nil {
			if err := ciclo.Sync(cfg); err != nil {
				log.Printf("erro no sync: %v", err)
				ok = false
			}
			if err := ciclo.Heartbeat(cfg); err != nil {
				log.Printf("erro no heartbeat: %v", err)
				ok = false
			}

			// Cadastro de identidade e leitura do cadastro do relogio entram no ciclo desde a
			// v0.6.0, para nao depender de alguem clicar no menu numa maquina que fica sozinha.
			//
			// O que autoriza isso agora, e nao antes:
			//   * a fila e' o gatilho. Sem ninguem enfileirado, ListarCadastrosPendentes devolve
			//     lista vazia e NADA e' escrito no equipamento - o custo em repouso e um GET.
			//     E' isso que faz o botao "Sincronizar cadastros" da tela valer como comando
			//     remoto: ele enfileira, e o proximo ciclo aplica (o servidor nao tem caminho de
			//     rede ate esta maquina, entao push de verdade nao existe).
			//   * recusa do equipamento agora e' definitiva e falha de transporte volta para a
			//     fila com espera (migration 20260817180000). Sem essa separacao, automatizar
			//     transformaria um blecaute de um minuto em cadastro queimado sem alarme.
			//   * ha teto por ciclo, porque o ciclo e os cliques do menu dividem UMA goroutine:
			//     escrever centenas de cadastros de uma vez deixaria a bandeja sem resposta.
			//
			// Falha aqui NAO derruba o status para vermelho: sincronizar AFD (o ponto) e' a
			// funcao essencial; cadastro pendente e' assunto da tela de Cobertura da Escala.
			if resultado, err := ciclo.SincronizarCadastros(cfg, ciclo.LimiteCadastrosPorCiclo); err != nil {
				log.Printf("aviso: cadastros nao sincronizados neste ciclo: %v", err)
			} else if resultado.Enviados > 0 || resultado.Falhas > 0 {
				log.Printf("cadastros no ciclo: enviados=%d falhas=%d (pendentes na fila: %d)",
					resultado.Enviados, resultado.Falhas, resultado.Pendentes)
			}
		}

		falhasAntes, falhasDepois := estado.registrarResultado(ok)
		if falhasAntes >= falhasParaAvisar && falhasDepois == 0 {
			_ = beeep.Notify("SisEscala - Coletor", "Sincronizacao voltou ao normal.", nil)
		} else if falhasDepois == falhasParaAvisar {
			_ = beeep.Notify("SisEscala - Coletor",
				"Falha ao sincronizar ha varias tentativas seguidas. Verifique a conexao com a rede e com o SisEscala.", nil)
		}

		// No maximo 1x por dia — e' so' um GET pequeno, mas nao ha necessidade de checar a cada
		// 5 minutos. A primeira chamada do app (ultimaChecagem ainda zero) sempre checa.
		if time.Since(ultimaChecagem) > 24*time.Hour {
			verificarAtualizacao(false)
		}

		atualizarBandeja(estado, itemStatus)
	}

	go func() {
		executarCiclo()
		ticker := time.NewTicker(intervaloCiclo)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				executarCiclo()
			case <-itemSyncAgora.ClickedCh:
				itemSyncAgora.SetTitle("Sincronizando...")
				itemSyncAgora.Disable()
				executarCiclo()
				itemSyncAgora.SetTitle("Sincronizar agora")
				itemSyncAgora.Enable()
			case <-itemAbrirTerminal.ClickedCh:
				abrirTerminalSeConfigurado()
			case <-itemSincronizarCadastros.ClickedCh:
				itemSincronizarCadastros.SetTitle("Enviando cadastros...")
				itemSincronizarCadastros.Disable()
				_ = beeep.Notify("SisEscala - Coletor", "Enviando cadastros pendentes para o rele...", nil)
				resultado, err := ciclo.SincronizarCadastros(cfg, 0)
				if err != nil {
					log.Printf("erro ao sincronizar cadastros: %v", err)
					_ = beeep.Notify("SisEscala - Coletor", "Falha ao sincronizar cadastros com o rele. Ver log.", nil)
				} else if resultado.Pendentes == 0 {
					_ = beeep.Notify("SisEscala - Coletor", "Nenhum cadastro pendente para enviar.", nil)
				} else {
					_ = beeep.Notify("SisEscala - Coletor",
						fmt.Sprintf("%d cadastro(s) enviado(s) ao rele, %d falha(s).", resultado.Enviados, resultado.Falhas), nil)
				}
				itemSincronizarCadastros.SetTitle("Sincronizar cadastros agora")
				itemSincronizarCadastros.Enable()
			case <-itemHigienizarCadastros.ClickedCh:
				itemHigienizarCadastros.SetTitle("Lendo cadastros do relogio...")
				itemHigienizarCadastros.Disable()
				_ = beeep.Notify("SisEscala - Coletor", "Lendo cadastros do rele...", nil)
				resultado, err := ciclo.HigienizarListagem(cfg)
				if err != nil {
					log.Printf("erro ao listar cadastros do rele: %v", err)
					_ = beeep.Notify("SisEscala - Coletor", "Falha ao ler cadastros do rele. Ver log.", nil)
				} else {
					_ = beeep.Notify("SisEscala - Coletor",
						fmt.Sprintf("%d usuario(s) lido(s) do rele e enviado(s) ao SisEscala.", resultado.UsuariosLidos), nil)
				}
				itemHigienizarCadastros.SetTitle("Atualizar lista de cadastros do relogio")
				itemHigienizarCadastros.Enable()
			case <-itemVerLogs.ClickedCh:
				exec.Command("explorer", dirInstalado).Start() //nolint:errcheck
			case <-itemAtualizar.ClickedCh:
				if atualizacaoPronta {
					tituloAntes := "Atualizar para v" + infoAtualizacao.Versao
					itemAtualizar.SetTitle("Baixando atualizacao...")
					itemAtualizar.Disable()
					aplicarAtualizacao() // sucesso encerra o processo (systray.Quit) antes de chegar aqui
					itemAtualizar.SetTitle(tituloAntes)
					itemAtualizar.Enable()
				} else {
					itemAtualizar.SetTitle("Verificando...")
					itemAtualizar.Disable()
					verificarAtualizacao(true) // ja reescreve o titulo (Verificar atualizacao / Atualizar para vX)
					itemAtualizar.Enable()
				}
			case <-itemSair.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func atualizarBandeja(estado *estadoApp, itemStatus *systray.MenuItem) {
	ultimoSucesso, falhas := estado.snapshot()

	if falhas == 0 {
		systray.SetIcon(iconGreen)
		systray.SetTooltip("SisEscala - tudo certo")
	} else {
		systray.SetIcon(iconRed)
		systray.SetTooltip(fmt.Sprintf("SisEscala - falhou %d vez(es) seguida(s)", falhas))
	}

	texto := "Status: "
	if ultimoSucesso.IsZero() {
		texto += "aguardando primeira sincronizacao"
	} else {
		texto += "ultima OK em " + ultimoSucesso.Format("02/01 15:04")
	}
	if falhas > 0 {
		texto += fmt.Sprintf(" (%d falha(s) seguida(s))", falhas)
	}
	itemStatus.SetTitle(texto)
}
