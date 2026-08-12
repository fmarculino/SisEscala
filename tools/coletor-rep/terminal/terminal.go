// Package terminal abre o navegador na tela de presença local. Não existe UI própria em Go —
// o navegador é a interface; este pacote só monta a URL de ativação e a abre no navegador
// padrão do sistema operacional.
package terminal

import (
	"fmt"
	"net/url"
	"os/exec"
	"runtime"
)

// Abrir monta a URL de ativação do terminal local (`/presenca-local/ativar`) e abre no
// navegador padrão. Recomenda-se abrir em modo kiosk (--kiosk do Chrome/Edge) como camada
// extra — isso não é o que fecha o vazamento de sessão de coordenador (o cookie assinado de
// terminal_local_session é o que fecha), mas reduz a superfície de navegação indevida.
func Abrir(baseURL, terminalID, token string) error {
	if terminalID == "" || token == "" {
		return fmt.Errorf("terminal_local.id e terminal_local.token precisam estar no config.yaml")
	}

	destino := fmt.Sprintf(
		"%s/presenca-local/ativar?terminal_id=%s&token=%s",
		baseURL, url.QueryEscape(terminalID), url.QueryEscape(token),
	)

	return abrirNoNavegador(destino)
}

func abrirNoNavegador(destino string) error {
	switch runtime.GOOS {
	case "windows":
		// NAO usar `cmd /c start` aqui: cmd.exe trata `&` como separador de comando, e a URL
		// de ativacao tem `?terminal_id=...&token=...` - o token inteiro era cortado antes de
		// chegar no navegador. rundll32 passa a URL direto para o handler de protocolo do
		// Windows sem reinterpretar o `&`.
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", destino).Start()
	case "darwin":
		return exec.Command("open", destino).Start()
	default:
		return exec.Command("xdg-open", destino).Start()
	}
}
