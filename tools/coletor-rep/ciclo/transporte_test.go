package ciclo

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"syscall"
	"testing"
)

// As mensagens abaixo NAO sao inventadas: sao as formas que existem em rep_cadastros_fila em
// producao em 09/09/2026 (387 falhas de rede e 2.395 recusas de equipamento). O caso que motivou
// este teste e' o `connectex` do Windows, que a versao anterior classificava como recusa
// DEFINITIVA - foi assim que 277 pessoas ficaram permanentemente fora do REP-iDClass-HMM-04.
func TestEhFalhaDeTransporte(t *testing.T) {
	// Erro real do Windows, com o tipo preservado: e' assim que ele chega de http.Client.Do.
	connectex := &url.Error{
		Op:  "Post",
		URL: "https://10.110.4.19:443/login.fcgi",
		Err: &net.OpError{
			Op:  "dial",
			Net: "tcp",
			Err: &net.AddrError{Err: "connectex: A connection attempt failed because the connected party did not properly respond after a period of time", Addr: "10.110.4.19:443"},
		},
	}

	casos := []struct {
		nome     string
		err      error
		esperado bool
	}{
		// --- transporte: o item volta para 'pendente' e sera tentado de novo ---
		{"nil nao e transporte", nil, false},
		{"url.Error tipado (connectex do Windows)", connectex, true},
		{"url.Error tipado embrulhado", fmt.Errorf("falha ao criar usuario: %w", connectex), true},
		{"net.OpError nu", &net.OpError{Op: "read", Net: "tcp", Err: syscall.ECONNRESET}, true},
		{"DNSError", &net.DNSError{Err: "no such host", Name: "rep.local"}, true},
		// Mesmas mensagens, mas achatadas em texto (perderam o tipo em algum fmt.Errorf("%v")).
		{"connectex so como texto", errors.New(`Post "https://10.110.4.19:443/login.fcgi": dial tcp 10.110.4.19:443: connectex: A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond.`), true},
		{"connectex actively refused so como texto", errors.New(`Post "https://10.110.4.51:443/login.fcgi": dial tcp 10.110.4.51:443: connectex: No connection could be made because the target machine actively refused it.`), true},
		{"wsarecv so como texto", errors.New(`Post "https://10.110.0.20:443/add_users.fcgi?session=X&mode=671": read tcp 10.110.0.9:5100->10.110.0.20:443: wsarecv: An existing connection was forcibly closed by the remote host.`), true},
		{"timeout classico", errors.New("context deadline exceeded (Client.Timeout exceeded while awaiting headers)"), true},

		// --- recusa do equipamento: definitiva, NAO pode voltar para a fila ---
		// Se qualquer um destes virar true, a trava de 20260905110000 cai e a entrada condenada
		// volta a consumir a vaga de quem e novo, no teto de 20 cadastros por ciclo.
		{"PIS ja cadastrado", errors.New("add_users.fcgi recusou (formato users:[{pis}]): PIS já cadastrado: 36491268268"), false},
		{"matricula ja cadastrada", errors.New("add_users.fcgi recusou (formato users:[{pis}]): Matrícula já cadastrada"), false},
		{"CPF ja cadastrado", errors.New("add_users.fcgi recusou (formato users:[{cpf}]): CPF já cadastrado: 12345678901"), false},
		{"pis em formato incorreto", errors.New("add_users.fcgi recusou: 'pis' em formato incorreto"), false},
		{"nenhum formato funcionou", errors.New("nenhum formato de add_users.fcgi funcionou neste equipamento; tentativas: users:[{cpf}] -> add_users.fcgi recusou (formato users:[{cpf}]): CPF já cadastrado"), false},
		{"matricula nao numerica", errors.New(`matricula "67.255" (sem prefixo: "67.255") nao e numerica - este rele so aceita 'registration' numerico`), false},
		{"credencial errada", errors.New("login.fcgi nao devolveu sessao valida: map[code:401 error:Invalid user or password]"), false},
	}

	for _, c := range casos {
		if got := ehFalhaDeTransporte(c.err); got != c.esperado {
			t.Errorf("%s: ehFalhaDeTransporte = %v, esperado %v", c.nome, got, c.esperado)
		}
	}
}

// A guarda de "recusou" tem que vencer a deteccao estrutural: um erro do equipamento que por
// acaso chegue embrulhado num *url.Error nao pode virar transitorio, senao o ciclo automatico
// bate no mesmo erro a cada 5 minutos, para sempre.
func TestRecusaVenceDeteccaoEstrutural(t *testing.T) {
	err := fmt.Errorf("add_users.fcgi recusou: %w", &url.Error{Op: "Post", URL: "https://x/", Err: errors.New("x")})
	if ehFalhaDeTransporte(err) {
		t.Fatal("recusa do equipamento foi classificada como transporte")
	}
}
