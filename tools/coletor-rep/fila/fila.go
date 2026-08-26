// Package fila implementa a fila offline de lotes que falharam por rede — JSONL em
// %PROGRAMDATA%\SisEscala\fila\<dispositivo_id>\, reenviada no próximo `sync`. Reenviar é sempre
// seguro: o servidor (fn_ingerir_afd) é idempotente por (dispositivo_id, lote_id).
//
// ⚠️ O SUBDIRETÓRIO POR DISPOSITIVO NÃO É ORGANIZAÇÃO, É CORREÇÃO. Até a v0.8.0 os lotes ficavam
// soltos num diretório único e `Pendentes` devolvia todos eles — desenho correto enquanto uma
// máquina só podia ter um relógio. Com a unidade de 4 equipamentos no mesmo coletor, o lote do
// relógio A seria reenviado com o TOKEN do relógio B (o client é montado por dispositivo, a fila
// não era), e o AFD de um equipamento entraria em dispositivos_rep como sendo do outro: NSR de
// dois relógios misturados na mesma linha, cursor embaralhado, e nada reclamando em lugar nenhum.
package fila

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type Lote struct {
	LoteID        string   `json:"lote_id"`
	Linhas        []string `json:"linhas"`
	ArquivoSHA256 string   `json:"arquivo_sha256"`
	ColetorVersao string   `json:"coletor_versao"`
	ColetorHost   string   `json:"coletor_host"`
}

// Diretorio devolve a pasta de fila de UM dispositivo. O id é um uuid, mas a sanitização fica
// porque o valor vem de um config.yaml editável à mão e viraria caminho no disco.
func Diretorio(diretorio, dispositivoID string) string {
	return filepath.Join(diretorio, sanitizar(dispositivoID))
}

func sanitizar(nome string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			return r
		default:
			return '_'
		}
	}, nome)
}

// Gravar registra um lote pendente na fila DAQUELE dispositivo, SUBSTITUINDO o arquivo do lote.
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
func Gravar(diretorio, dispositivoID string, lote Lote) error {
	destino := Diretorio(diretorio, dispositivoID)
	if err := os.MkdirAll(destino, 0o755); err != nil {
		return err
	}

	dados, err := json.Marshal(lote)
	if err != nil {
		return err
	}

	caminho := filepath.Join(destino, lote.LoteID+".jsonl")
	return os.WriteFile(caminho, append(dados, '\n'), 0o644)
}

// Pendentes lê os lotes daquele dispositivo que ainda estão na fila (não removidos após ACK).
func Pendentes(diretorio, dispositivoID string) ([]Lote, error) {
	origem := Diretorio(diretorio, dispositivoID)
	entradas, err := os.ReadDir(origem)
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

		caminho := filepath.Join(origem, entrada.Name())
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
func Remover(diretorio, dispositivoID, loteID string) error {
	return os.Remove(filepath.Join(Diretorio(diretorio, dispositivoID), loteID+".jsonl"))
}

// AdotarLotesLegados move para a pasta do dispositivo os .jsonl que ficaram soltos na raiz da
// fila por uma versão anterior do coletor.
//
// ⚠️ Só pode ser chamada quando a máquina coleta UM ÚNICO relógio, e é o chamador que garante
// isso (ciclo.SyncTodos). Lote solto na raiz não diz de quem é: com dois relógios configurados,
// adotar seria chutar autoria de marcação já coletada. Com um só, a autoria é certa — e não
// adotar deixaria esse lote preso para sempre, que é o único jeito de PERDER batida aqui.
func AdotarLotesLegados(diretorio, dispositivoID string) (int, error) {
	entradas, err := os.ReadDir(diretorio)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}

	destino := Diretorio(diretorio, dispositivoID)
	var movidos int
	for _, entrada := range entradas {
		if entrada.IsDir() || filepath.Ext(entrada.Name()) != ".jsonl" {
			continue
		}
		if err := os.MkdirAll(destino, 0o755); err != nil {
			return movidos, err
		}
		origem := filepath.Join(diretorio, entrada.Name())
		if err := os.Rename(origem, filepath.Join(destino, entrada.Name())); err != nil {
			return movidos, err
		}
		movidos++
	}
	return movidos, nil
}
