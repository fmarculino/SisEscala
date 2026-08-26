// Portao do isolamento da fila por dispositivo (v0.9.0). Nao ha framework de teste no SisEscala,
// mas aqui o invariante e' testavel sem hardware e sem banco: `go test ./fila/`.
//
// O que ele impede de voltar: ate a v0.8.0 os lotes ficavam soltos num diretorio unico e
// Pendentes devolvia TODOS. Com varios relogios na mesma maquina (unidades com 4 equipamentos),
// o lote coletado do relogio A seria reenviado com o token do relogio B — e o AFD de um
// equipamento entraria no SisEscala como sendo do outro, sem erro nenhum em lugar nenhum.
package fila

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPendentesNaoVazaEntreDispositivos(t *testing.T) {
	dir := t.TempDir()
	const relogioA = "11111111-1111-1111-1111-111111111111"
	const relogioB = "22222222-2222-2222-2222-222222222222"

	if err := Gravar(dir, relogioA, Lote{LoteID: "lote-a", Linhas: []string{"linha do A"}}); err != nil {
		t.Fatalf("gravar lote do A: %v", err)
	}
	if err := Gravar(dir, relogioB, Lote{LoteID: "lote-b", Linhas: []string{"linha do B"}}); err != nil {
		t.Fatalf("gravar lote do B: %v", err)
	}

	doA, err := Pendentes(dir, relogioA)
	if err != nil {
		t.Fatalf("pendentes do A: %v", err)
	}
	if len(doA) != 1 || doA[0].LoteID != "lote-a" {
		t.Fatalf("A deveria ver so' o proprio lote, viu: %+v", doA)
	}

	doB, err := Pendentes(dir, relogioB)
	if err != nil {
		t.Fatalf("pendentes do B: %v", err)
	}
	if len(doB) != 1 || doB[0].LoteID != "lote-b" {
		t.Fatalf("B deveria ver so' o proprio lote, viu: %+v", doB)
	}

	// Remover pelo dono certo nao pode alcancar a fila do outro.
	if err := Remover(dir, relogioA, "lote-a"); err != nil {
		t.Fatalf("remover lote do A: %v", err)
	}
	doB, _ = Pendentes(dir, relogioB)
	if len(doB) != 1 {
		t.Fatalf("remover no A mexeu na fila do B: %+v", doB)
	}
}

func TestAdotarLotesLegadosMoveOQueEstavaNaRaiz(t *testing.T) {
	dir := t.TempDir()
	const relogio = "33333333-3333-3333-3333-333333333333"

	// Como a v0.8.0 gravava: solto na raiz, sem dizer de quem e'.
	legado := filepath.Join(dir, "lote-antigo.jsonl")
	if err := os.WriteFile(legado, []byte(`{"lote_id":"lote-antigo","linhas":["x"]}`+"\n"), 0o644); err != nil {
		t.Fatalf("preparar lote legado: %v", err)
	}

	movidos, err := AdotarLotesLegados(dir, relogio)
	if err != nil {
		t.Fatalf("adotar: %v", err)
	}
	if movidos != 1 {
		t.Fatalf("esperado 1 lote adotado, veio %d", movidos)
	}
	if _, err := os.Stat(legado); !os.IsNotExist(err) {
		t.Fatalf("o lote legado continua na raiz")
	}

	pendentes, err := Pendentes(dir, relogio)
	if err != nil {
		t.Fatalf("pendentes: %v", err)
	}
	if len(pendentes) != 1 || pendentes[0].LoteID != "lote-antigo" {
		t.Fatalf("lote legado nao ficou visivel para o dono: %+v", pendentes)
	}
}

func TestCursorContinuaSeparadoPorDispositivo(t *testing.T) {
	dir := t.TempDir()
	const relogioA = "44444444-4444-4444-4444-444444444444"
	const relogioB = "55555555-5555-5555-5555-555555555555"

	if err := GravarCursor(dir, relogioA, 900); err != nil {
		t.Fatalf("gravar cursor do A: %v", err)
	}
	if _, ok := LerCursor(dir, relogioB); ok {
		t.Fatalf("o cursor do A apareceu como sendo do B — errar o cursor para cima e' a unica " +
			"forma de PERDER marcacao")
	}
	if valor, ok := LerCursor(dir, relogioA); !ok || valor != 900 {
		t.Fatalf("cursor do A voltou errado: %d (ok=%v)", valor, ok)
	}
}
