package fila

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Cache local do cursor de coleta (o `initial_nsr` a pedir ao relógio). Vive ao lado da fila
// offline porque serve exatamente o mesmo momento: a máquina consegue falar com o RELÓGIO mas não
// com o SisEscala. Sem isso, um servidor fora do ar faria o coletor voltar a pedir o AFD inteiro
// justamente quando ele precisa juntar dado para a fila — e num relógio reaproveitado o arquivo
// inteiro é o que não caberia no timeout.
//
// ⚠️ Este arquivo é CACHE, não fonte de verdade. Só guarda o último cursor que o SISESCALA
// informou, e nunca é avançado localmente. É essa regra que faz o cache não poder causar perda de
// marcação: o pior que um valor velho provoca é rebaixar dado já ingerido (de graça —
// fn_ingerir_afd é idempotente por dispositivo+nsr). Avançá-lo aqui, por conta própria, com base
// em lote que talvez nunca tenha sido aceito, é que criaria o risco de pular NSR.
//
// Apagar este arquivo é sempre seguro: o coletor volta a perguntar ao servidor.

type cursorPersistido struct {
	DispositivoID string `json:"dispositivo_id"`
	ProximoNsr    int64  `json:"proximo_nsr"`
}

func caminhoCursor(diretorio, dispositivoID string) string {
	return filepath.Join(diretorio, "cursor-"+dispositivoID+".json")
}

// GravarCursor guarda o cursor que o SisEscala informou. Chamar SÓ com valor vindo do servidor.
func GravarCursor(diretorio, dispositivoID string, proximoNsr int64) error {
	if proximoNsr < 1 {
		return nil // nunca persiste cursor invalido
	}
	if err := os.MkdirAll(diretorio, 0o755); err != nil {
		return err
	}
	dados, err := json.Marshal(cursorPersistido{DispositivoID: dispositivoID, ProximoNsr: proximoNsr})
	if err != nil {
		return err
	}
	return os.WriteFile(caminhoCursor(diretorio, dispositivoID), dados, 0o644)
}

// LerCursor devolve o último cursor conhecido e se ele existe. Arquivo ausente, ilegível ou de
// outro dispositivo devolve (0, false) — o chamador cai para o NSR 1, que erra para o lado de
// baixar demais.
func LerCursor(diretorio, dispositivoID string) (int64, bool) {
	dados, err := os.ReadFile(caminhoCursor(diretorio, dispositivoID))
	if err != nil {
		return 0, false
	}
	var c cursorPersistido
	if err := json.Unmarshal(dados, &c); err != nil {
		return 0, false
	}
	if c.DispositivoID != dispositivoID || c.ProximoNsr < 1 {
		return 0, false
	}
	return c.ProximoNsr, true
}
