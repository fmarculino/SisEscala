// Package fila implementa a fila offline de lotes que falharam por rede — JSONL append-only
// em %PROGRAMDATA%\SisEscala\fila, reenviada no próximo `sync`. Reenviar é sempre seguro: o
// servidor (fn_ingerir_afd) é idempotente por (dispositivo_id, lote_id).
package fila

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
)

type Lote struct {
	LoteID        string   `json:"lote_id"`
	Linhas        []string `json:"linhas"`
	ArquivoSHA256 string   `json:"arquivo_sha256"`
	ColetorVersao string   `json:"coletor_versao"`
	ColetorHost   string   `json:"coletor_host"`
}

// Gravar registra um lote pendente no diretório de fila, SUBSTITUINDO o arquivo daquele lote.
//
// ⚠️ Substituir, não acrescentar. O arquivo é nomeado pelo `lote_id`, e o `lote_id` é um hash
// determinístico do próprio conteúdo (`loteIDDeterministico`, em ciclo) — então um mesmo arquivo só
// pode descrever um mesmo lote, e `Pendentes` lê CADA LINHA como um lote a reenviar. Com
// `O_APPEND` (como era até 17/08/2026) cada ciclo que falhava acrescentava outra cópia idêntica do
// mesmo lote, e a fila se multiplicava sozinha: na máquina do RH da SMS, ~12 ciclos recusados por
// desvio de relógio transformaram ~80 lotes em ~1.000 reenvios por ciclo.
//
// Não era só desperdício de rede. O ciclo passava vários minutos percorrendo essa fila inflada, e o
// menu da bandeja **para de responder** durante um ciclo (evento e ciclo dividem uma goroutine só,
// ver cmd/tray/main.go) — foi por isso que "Verificar atualizacao" parecia não fazer nada. Um bug de
// duplicação em disco virou "o app travou" para quem estava na frente da máquina.
func Gravar(diretorio string, lote Lote) error {
	if err := os.MkdirAll(diretorio, 0o755); err != nil {
		return err
	}

	dados, err := json.Marshal(lote)
	if err != nil {
		return err
	}

	caminho := filepath.Join(diretorio, lote.LoteID+".jsonl")
	return os.WriteFile(caminho, append(dados, '\n'), 0o644)
}

// Pendentes lê todos os lotes que ainda estão na fila (não removidos após ACK).
func Pendentes(diretorio string) ([]Lote, error) {
	entradas, err := os.ReadDir(diretorio)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var lotes []Lote
	for _, entrada := range entradas {
		if entrada.IsDir() || filepath.Ext(entrada.Name()) != ".jsonl" {
			continue
		}

		caminho := filepath.Join(diretorio, entrada.Name())
		f, err := os.Open(caminho)
		if err != nil {
			continue
		}

		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)
		for scanner.Scan() {
			var lote Lote
			if json.Unmarshal(scanner.Bytes(), &lote) == nil {
				lotes = append(lotes, lote)
			}
		}
		f.Close()
	}
	return lotes, nil
}

// Remover apaga o arquivo do lote depois de confirmado (ACK) pelo SisEscala.
func Remover(diretorio, loteID string) error {
	return os.Remove(filepath.Join(diretorio, loteID+".jsonl"))
}
