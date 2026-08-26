// Percorrer TODOS os relógios que esta máquina coleta.
//
// Motivação (25/08/2026): existem unidades com 4 equipamentos — e podem ser mais. Até a v0.8.0 o
// coletor era um-relógio-por-máquina por construção (config singular, mutex nomeado único, pasta
// de instalação fixa), então cobrir a unidade exigiria 4 instalações no mesmo computador, cada uma
// com seu autostart, seu ícone de bandeja e sua atualização — e as quatro dividindo a MESMA fila
// offline, que é o que faria o AFD de um relógio ser enviado com o token de outro.
//
// A regra que não pode mudar aqui: relógio fora do ar NÃO interrompe os demais. Cada equipamento é
// independente (token, cursor de NSR e fila próprios), e uma unidade não pode parar de registrar
// ponto em três relógios porque o quarto está desligado. Por isso os erros são acumulados e
// devolvidos juntos, nunca com `return` no primeiro.
package ciclo

import (
	"errors"
	"fmt"
	"log"

	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/fila"
)

// paraCada roda `acao` em cada relógio configurado, seguindo em frente quando um falha.
func paraCada(cfg *config.Config, oQue string, acao func(d *config.DispositivoRepConfig) error) error {
	dispositivos := cfg.Dispositivos()
	if len(dispositivos) == 0 {
		return fmt.Errorf("nenhum relogio configurado (secoes dispositivo_rep/dispositivos_rep ausentes no config.yaml)")
	}

	var erros []error
	for _, d := range dispositivos {
		if len(dispositivos) > 1 {
			log.Printf("=== %s: relogio %s (%d de %d) ===", oQue, d.Rotulo(), indice(dispositivos, d), len(dispositivos))
		}
		if err := acao(d); err != nil {
			// Logar aqui, e nao so' devolver, porque o chamador da bandeja resume tudo numa
			// notificacao curta: sem esta linha o log nao diria QUAL relogio falhou.
			log.Printf("relogio %s: falha em %s: %v", d.Rotulo(), oQue, err)
			erros = append(erros, fmt.Errorf("%s: %w", d.Rotulo(), err))
		}
	}
	return errors.Join(erros...)
}

func indice(todos []*config.DispositivoRepConfig, alvo *config.DispositivoRepConfig) int {
	for i, d := range todos {
		if d == alvo {
			return i + 1
		}
	}
	return 0
}

// SyncTodos coleta o AFD de cada relógio da máquina.
func SyncTodos(cfg *config.Config) error {
	// Fila de uma versao anterior ficou solta na raiz do diretorio. Adotar so' e' possivel com um
	// unico relogio configurado: com dois, o arquivo nao diz de quem e', e chutar autoria de
	// marcacao ja coletada seria pior que o problema. Ver fila.AdotarLotesLegados.
	if dispositivos := cfg.Dispositivos(); len(dispositivos) == 1 {
		if movidos, err := fila.AdotarLotesLegados(cfg.Fila.Diretorio, dispositivos[0].ID); err != nil {
			log.Printf("aviso: falha ao migrar a fila antiga para a pasta do dispositivo: %v", err)
		} else if movidos > 0 {
			log.Printf("fila: %d lote(s) da versao anterior migrado(s) para a pasta do relogio %s",
				movidos, dispositivos[0].Rotulo())
		}
	}
	return paraCada(cfg, "sync", func(d *config.DispositivoRepConfig) error { return Sync(cfg, d) })
}

// HeartbeatTodos reporta versão e deriva de relógio de cada equipamento.
func HeartbeatTodos(cfg *config.Config) error {
	return paraCada(cfg, "heartbeat", func(d *config.DispositivoRepConfig) error { return Heartbeat(cfg, d) })
}

// SincronizarCadastrosTodos aplica a fila de identidade em cada relógio. O `limite` é POR
// EQUIPAMENTO — é o teto de escrita de um ciclo automático, e cada relógio tem a sua fila.
func SincronizarCadastrosTodos(cfg *config.Config, limite int) (ResultadoCadastros, error) {
	var total ResultadoCadastros
	err := paraCada(cfg, "cadastros", func(d *config.DispositivoRepConfig) error {
		r, err := SincronizarCadastros(cfg, d, limite)
		total.Pendentes += r.Pendentes
		total.Enviados += r.Enviados
		total.Falhas += r.Falhas
		return err
	})
	return total, err
}

// HigienizarListagemTodos lê o cadastro de cada relógio e reporta o snapshot ao SisEscala.
//
// ⚠️ O snapshot é POR DISPOSITIVO no servidor (fn_registrar_snapshot_usuarios_dispositivo), e é
// ele que encerra vínculo de quem não está mais no equipamento. Relatar a leitura de um relógio
// como se fosse a de outro encerraria vínculo de quem está cadastrado — daí cada chamada sair com
// o token do próprio equipamento, nunca uma lista somada.
func HigienizarListagemTodos(cfg *config.Config) (ResultadoHigiene, error) {
	var total ResultadoHigiene
	err := paraCada(cfg, "higiene", func(d *config.DispositivoRepConfig) error {
		r, err := HigienizarListagem(cfg, d)
		total.UsuariosLidos += r.UsuariosLidos
		return err
	})
	return total, err
}

// HigienizarRemocoesTodos aplica as remoções pendentes em cada relógio.
func HigienizarRemocoesTodos(cfg *config.Config, limite int) (ResultadoRemocao, error) {
	var total ResultadoRemocao
	err := paraCada(cfg, "remocoes", func(d *config.DispositivoRepConfig) error {
		r, err := HigienizarRemocoes(cfg, d, limite)
		total.Pendentes += r.Pendentes
		total.Removidos += r.Removidos
		total.Falhas += r.Falhas
		return err
	})
	return total, err
}
