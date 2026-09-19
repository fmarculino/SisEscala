package ciclo

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/sms-maraba/sisescala-coletor-rep/sisescala"
)

// O caso que motivou: em 18/09/2026 o REP-iDClass-HMI-01 ficou 38h com 509 batidas presas na
// memoria do equipamento. O lote de 500 linhas estourava os 60s de timeout deste cliente, a
// conexao caia, o Postgres revertia a transacao INTEIRA (sem deixar linha em rep_sincronizacoes)
// e o ciclo seguinte remontava EXATAMENTE o mesmo lote de 500. Laco eterno, silencioso.
//
// O que estes testes protegem e' a saida desse laco: falha de TRANSPORTE divide o trecho e tenta
// de novo; recusa que o SERVIDOR respondeu nao divide nada.

type servidorFalso struct {
	mu       sync.Mutex
	chamadas []int // quantas linhas cada chamada trouxe, na ordem
	// aceitaAte: trecho maior que isto "estoura o timeout" (conexao derrubada, sem resposta).
	aceitaAte int
	// statusFixo != 0: responde sempre este status, sem olhar o tamanho (recusa do servidor).
	statusFixo int
}

func (s *servidorFalso) handler(w http.ResponseWriter, r *http.Request) {
	corpo, _ := io.ReadAll(r.Body)
	var p struct {
		Linhas []string `json:"linhas"`
	}
	_ = json.Unmarshal(corpo, &p)

	s.mu.Lock()
	s.chamadas = append(s.chamadas, len(p.Linhas))
	s.mu.Unlock()

	if s.statusFixo != 0 {
		w.WriteHeader(s.statusFixo)
		fmt.Fprint(w, `{"error":"Dispositivo ou token invalido"}`)
		return
	}
	if len(p.Linhas) > s.aceitaAte {
		// Derruba a conexao sem responder: e' o que o cliente ve quando o servidor leva mais que o
		// timeout. Chega como *url.Error, que ehFalhaDeTransporte reconhece estruturalmente.
		hj, ok := w.(http.Hijacker)
		if !ok {
			panic("httptest sem Hijacker")
		}
		conn, _, err := hj.Hijack()
		if err != nil {
			panic(err)
		}
		_ = conn.Close()
		return
	}
	fmt.Fprintf(w, `{"reenvio":false,"novas":%d,"marcacoes":%d,"nsr_max_aceito":1}`, len(p.Linhas), len(p.Linhas))
}

func (s *servidorFalso) totalLinhasAceitas() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := 0
	for _, n := range s.chamadas {
		if n <= s.aceitaAte && s.statusFixo == 0 {
			t += n
		}
	}
	return t
}

func linhasFalsas(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("%09d3010920261200%012d0000", i+1, i+1)
	}
	return out
}

// Um servidor que so aguenta 40 linhas por vez recebe um trecho de 150: sem fatiamento nada
// entraria (era o estado ate a v0.18.0). Com fatiamento, TODAS as 150 entram.
func TestFatiamentoEntregaTudoQuandoOLoteEGrandeDemais(t *testing.T) {
	s := &servidorFalso{aceitaAte: 40}
	srv := httptest.NewServer(http.HandlerFunc(s.handler))
	defer srv.Close()

	sc := sisescala.NovoClient(srv.URL, "disp-1", "token-1")
	falhados := enviarComFatiamento(sc, "disp-1", linhasFalsas(150), "sha")

	if len(falhados) != 0 {
		t.Fatalf("esperava nenhum trecho falhado, veio %d", len(falhados))
	}
	if got := s.totalLinhasAceitas(); got != 150 {
		t.Fatalf("esperava as 150 linhas aceitas, entraram %d", got)
	}
	// Nenhuma chamada aceita pode ter passado do que o servidor aguenta — prova que a divisao
	// aconteceu de verdade, e nao que o servidor simplesmente engoliu tudo.
	for _, n := range s.chamadas {
		if n > 40 && n != 150 && n != 75 {
			t.Fatalf("chamada com tamanho inesperado: %d (chamadas=%v)", n, s.chamadas)
		}
	}
}

// 🚨 Recusa que o SERVIDOR respondeu (401 de token) nao pode ser refatiada: dividir nao muda o
// resultado, so multiplica as tentativas de uma falha sistematica e prende o ciclo, que divide
// uma goroutine com o menu da bandeja.
func TestRecusaDoServidorNaoRefatia(t *testing.T) {
	s := &servidorFalso{statusFixo: http.StatusUnauthorized}
	srv := httptest.NewServer(http.HandlerFunc(s.handler))
	defer srv.Close()

	sc := sisescala.NovoClient(srv.URL, "disp-1", "token-1")
	falhados := enviarComFatiamento(sc, "disp-1", linhasFalsas(150), "sha")

	if len(falhados) != 1 || len(falhados[0]) != 150 {
		t.Fatalf("esperava 1 trecho falhado de 150 linhas, veio %v", len(falhados))
	}
	if len(s.chamadas) != 1 {
		t.Fatalf("esperava UMA tentativa (sem fatiar), houve %d: %v", len(s.chamadas), s.chamadas)
	}
}

// O piso existe para nao dividir ate o infinito: se nem o menor trecho entra, o problema nao e
// tamanho. Com um servidor que nao aceita nada, o trecho volta como falhado em vez de virar
// centenas de tentativas.
func TestFatiamentoParaNoPiso(t *testing.T) {
	s := &servidorFalso{aceitaAte: 0}
	srv := httptest.NewServer(http.HandlerFunc(s.handler))
	defer srv.Close()

	sc := sisescala.NovoClient(srv.URL, "disp-1", "token-1")
	falhados := enviarComFatiamento(sc, "disp-1", linhasFalsas(100), "sha")

	total := 0
	for _, f := range falhados {
		total += len(f)
	}
	if total != 100 {
		t.Fatalf("esperava as 100 linhas devolvidas como falhadas, vieram %d", total)
	}
	for _, f := range falhados {
		if len(f) > tamanhoLoteMinimo {
			t.Fatalf("trecho falhado de %d linhas acima do piso %d", len(f), tamanhoLoteMinimo)
		}
	}
	// Divisao binaria de 100 ate <=25: no maximo 2*(100/25)-1 = 7 nos da arvore.
	if len(s.chamadas) > 7 {
		t.Fatalf("fatiamento tentou demais: %d chamadas (%v)", len(s.chamadas), s.chamadas)
	}
}

// O tamanho padrao nao pode voltar a ser grande. 500 era o valor que estourava o timeout; o
// numero exato importa menos que ele estar bem abaixo disso.
func TestTamanhoLotePadraoContinuaModesto(t *testing.T) {
	if tamanhoLotePadrao > 200 {
		t.Fatalf("tamanhoLotePadrao=%d: acima de 200 o lote volta a nao caber no timeout de ingestao", tamanhoLotePadrao)
	}
	if tamanhoLoteMinimo >= tamanhoLotePadrao {
		t.Fatalf("piso (%d) precisa ser menor que o padrao (%d), senao nunca ha divisao", tamanhoLoteMinimo, tamanhoLotePadrao)
	}
}
