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

// Gravar acrescenta um lote pendente ao diretório de fila.
func Gravar(diretorio string, lote Lote) error {
	if err := os.MkdirAll(diretorio, 0o755); err != nil {
		return err
	}

	caminho := filepath.Join(diretorio, lote.LoteID+".jsonl")
	f, err := os.OpenFile(caminho, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	dados, err := json.Marshal(lote)
	if err != nil {
		return err
	}
	_, err = f.Write(append(dados, '\n'))
	return err
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
