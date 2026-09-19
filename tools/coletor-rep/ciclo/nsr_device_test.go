package ciclo

import "testing"

// O last_nsr do equipamento e o sinal que teria detectado o REP-iDClass-HMI-01 no primeiro ciclo
// em vez de em 38 horas. A regra que estes testes protegem e uma so, e ela e' sutil:
//
// 🚨 AUSENCIA NUNCA VIRA ZERO. "nao consegui ler" e "o equipamento nao tem batida" levam a acoes
// opostas -- o primeiro manda investigar a maquina, o segundo diz que esta tudo em dia. Se o
// coletor mandasse 0 quando nao sabe, o servidor calcularia `presas = 0 - ultimo_nsr` (negativo,
// tratado como zero) e o relogio apareceria PERFEITO justamente quando ninguem o esta lendo.
func TestExtrairUltimoNsr(t *testing.T) {
	i64 := func(n int64) *int64 { return &n }

	casos := []struct {
		nome string
		info map[string]interface{}
		quer *int64
	}{
		// Payload real do iDClass (encoding/json entrega numero como float64).
		{"resposta real do equipamento",
			map[string]interface{}{"user_count": float64(504), "template_count": float64(455), "last_nsr": float64(131199)},
			i64(131199)},

		// 🚨 Os quatro casos de "nao sei". Todos precisam devolver nil, nunca 0.
		{"campo ausente (firmware que nao devolve last_nsr)", map[string]interface{}{"user_count": float64(10)}, nil},
		{"payload vazio", map[string]interface{}{}, nil},
		{"nulo", map[string]interface{}{"last_nsr": nil}, nil},
		{"tipo inesperado", map[string]interface{}{"last_nsr": []interface{}{1, 2}}, nil},

		// Zero e negativo tambem sao "nao sei": equipamento sem NSR nenhum nao produz sinal, e
		// deixar passar faria o servidor gravar um numero que nao significa nada.
		{"zero", map[string]interface{}{"last_nsr": float64(0)}, nil},
		{"negativo", map[string]interface{}{"last_nsr": float64(-5)}, nil},

		// Firmware que mandasse string continua entrando -- o que nao pode e' virar 0 em silencio.
		{"string numerica", map[string]interface{}{"last_nsr": "131199"}, i64(131199)},
		{"string com espaco", map[string]interface{}{"last_nsr": " 42 "}, i64(42)},
		{"string nao numerica", map[string]interface{}{"last_nsr": "n/a"}, nil},
		{"string vazia", map[string]interface{}{"last_nsr": ""}, nil},
	}

	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			got := extrairUltimoNsr(c.info)
			switch {
			case c.quer == nil && got != nil:
				t.Fatalf("esperava nil (nao sei), veio %d -- ausencia virou numero", *got)
			case c.quer != nil && got == nil:
				t.Fatalf("esperava %d, veio nil", *c.quer)
			case c.quer != nil && *got != *c.quer:
				t.Fatalf("esperava %d, veio %d", *c.quer, *got)
			}
		})
	}
}
