// Portao da mesclagem de config.yaml na instalacao (`go test ./config/`).
//
// O caso 1 e' um bug real que existiria na primeira unidade a receber o "pacote da unidade" por
// cima de uma instalacao antiga: a maquina do HMI ja tem `dispositivo_rep` (singular) do relogio
// que ja coletava, o pacote traz `dispositivos_rep` (lista) com esse mesmo relogio + o novo. Sem
// dedup, o relogio 1 fica nas duas chaves — na lista com o token novo e no singular com o token
// que o download acabou de invalidar — e `Carregar` recusa o arquivo por id repetido: o app de
// bandeja nao abre, na maquina da unidade, sem ninguem por perto para diagnosticar.
package config

import "testing"

func TestMesclarNaoDuplicaRelogioQueVeioNaLista(t *testing.T) {
	existente := &Config{
		DispositivoRep: &DispositivoRepConfig{ID: "relogio-1", Token: "token-VELHO", Endereco: "10.110.5.5"},
	}
	novo := &Config{
		DispositivosRep: []DispositivoRepConfig{
			{ID: "relogio-1", Token: "token-novo", Endereco: "10.110.5.5"},
			{ID: "relogio-2", Token: "token-novo-2", Endereco: "10.110.5.6"},
		},
	}

	m := Mesclar(existente, novo)
	todos := m.Dispositivos()
	if len(todos) != 2 {
		t.Fatalf("esperados 2 relogios, vieram %d", len(todos))
	}
	vistos := map[string]string{}
	for _, d := range todos {
		if anterior, repetido := vistos[d.ID]; repetido {
			t.Fatalf("id %s repetido (%s e %s) — Carregar recusaria o arquivo inteiro", d.ID, anterior, d.Token)
		}
		vistos[d.ID] = d.Token
	}
	if vistos["relogio-1"] != "token-novo" {
		t.Fatalf("o token velho sobreviveu: %q", vistos["relogio-1"])
	}
}

func TestMesclarNaoPerdeRelogioQueNaoVeioNoDownload(t *testing.T) {
	// Baixar o pacote de UM relogio numa maquina que atende quatro nao pode apagar os outros
	// tres: a unidade pararia de coletar sem nada reclamar.
	existente := &Config{
		DispositivosRep: []DispositivoRepConfig{
			{ID: "relogio-1", Token: "t1"},
			{ID: "relogio-2", Token: "t2"},
			{ID: "relogio-3", Token: "t3"},
		},
	}
	novo := &Config{
		DispositivoRep: &DispositivoRepConfig{ID: "relogio-2", Token: "t2-novo"},
	}

	m := Mesclar(existente, novo)
	if len(m.Dispositivos()) != 3 {
		t.Fatalf("esperados 3 relogios, vieram %d", len(m.Dispositivos()))
	}
	for _, d := range m.Dispositivos() {
		if d.ID == "relogio-2" && d.Token != "t2-novo" {
			t.Fatalf("o download novo devia vencer no relogio-2, veio %q", d.Token)
		}
	}
}

func TestMesclarPreservaTerminalLocalEOSingularDeOutroRelogio(t *testing.T) {
	existente := &Config{
		DispositivoRep: &DispositivoRepConfig{ID: "relogio-9", Token: "t9"},
		TerminalLocal:  &TerminalLocalConfig{ID: "terminal-1", Token: "tt"},
	}
	novo := &Config{
		DispositivosRep: []DispositivoRepConfig{{ID: "relogio-1", Token: "t1"}},
	}

	m := Mesclar(existente, novo)
	if m.TerminalLocal == nil || m.TerminalLocal.ID != "terminal-1" {
		t.Fatalf("terminal_local da instalacao anterior se perdeu")
	}
	if len(m.Dispositivos()) != 2 {
		t.Fatalf("o relogio 9 (que o download nao mencionou) devia continuar: %d relogio(s)", len(m.Dispositivos()))
	}
}
