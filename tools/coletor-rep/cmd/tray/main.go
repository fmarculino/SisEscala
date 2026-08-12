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

// garantirInstanciaUnica evita duas bandejas do mesmo app rodando ao mesmo tempo (ex.: usuario
// clica no .exe baixado de novo depois de ja estar instalado). Mutex nomeado e o jeito padrao
// do Windows para isso - se ja existe, so sair.
func garantirInstanciaUnica() {
	nome, err := windows.UTF16PtrFromString(nomeMutexUnico)
	if err != nil {
		return
	}
	_, err = windows.CreateMutex(nil, false, nome)
	if err == windows.ERROR_ALREADY_EXISTS {
		os.Exit(0)
	}
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
	itemVerLogs := systray.AddMenuItem("Ver logs", "Abre a pasta de logs e configuracao")
	systray.AddSeparator()
	itemSair := systray.AddMenuItem("Sair", "Encerra o coletor-rep")

	estado := &estadoApp{}

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
		}

		falhasAntes, falhasDepois := estado.registrarResultado(ok)
		if falhasAntes >= falhasParaAvisar && falhasDepois == 0 {
			_ = beeep.Notify("SisEscala - Coletor", "Sincronizacao voltou ao normal.", nil)
		} else if falhasDepois == falhasParaAvisar {
			_ = beeep.Notify("SisEscala - Coletor",
				"Falha ao sincronizar ha varias tentativas seguidas. Verifique a conexao com a rede e com o SisEscala.", nil)
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
				executarCiclo()
			case <-itemAbrirTerminal.ClickedCh:
				abrirTerminalSeConfigurado()
			case <-itemVerLogs.ClickedCh:
				exec.Command("explorer", dirInstalado).Start() //nolint:errcheck
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
