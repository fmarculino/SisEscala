// Portao de src/utils/conflitoEscala.ts — sobreposicao de escala POR PESSOA (duplo vinculo).
//
// Transpile antes:
//   npx tsc src/utils/conflitoEscala.ts --outDir scratchpad/_sim --module commonjs --target es2020
//
// Rodar: node scratchpad/sim_conflito_pessoa.js
const path = require('path')
const { encontrarConflitoExterno, diasComConflitoExterno } = require(path.join(__dirname, '_sim', 'conflitoEscala.js'))

let ok = 0, falhas = 0
function t(nome, cond) {
  if (cond) { ok++ } else { falhas++; console.error(`  FALHA: ${nome}`) }
}

// --- cenario: EDILEUZA, duas matriculas da mesma pessoa no HMI -------------
const A = 'srv-A'   // mat 67454
const B = 'srv-B'   // mat 15892
const C = 'srv-C'   // pessoa sem irmao
const ESCALA_A = 'em-A'
const ESCALA_B = 'em-B'
const PESSOA = { [A]: [A, B], [B]: [B, A] }

const noite = ['N']
const manha = ['M', 'T']

const ocupacao = [
  { servidor_id: B, dia: 1, escala_mensal_id: ESCALA_B, slots: ['N'], descricao_conflito: 'Regular N no BLOCO B (HMI)' },
  { servidor_id: B, dia: 5, escala_mensal_id: ESCALA_B, slots: ['M', 'T'], descricao_conflito: 'Regular MT no BLOCO B (HMI)' },
  { servidor_id: C, dia: 9, escala_mensal_id: 'em-C', slots: ['N'], descricao_conflito: 'Regular N no PATRIMONIO' },
]

console.log('== o caso que motivou: sobreposicao entre matriculas da mesma pessoa ==')
{
  // A quer lancar N no dia 1; B ja tem N no dia 1. Mesma pessoa -> CONFLITO.
  const c = encontrarConflitoExterno(ocupacao, A, ESCALA_A, 1, noite, PESSOA)
  t('acusa sobreposicao entre matriculas irmas', c !== null)
  t('marca que veio da outra matricula', c && c.outraMatricula === true)
  t('a mensagem diz que e outra matricula', c && /outra matr/i.test(c.descricao))
  t('a mensagem preserva a descricao original', c && /BLOCO B/.test(c.descricao))
}

console.log('== turnos COMPLEMENTARES continuam permitidos (o arranjo real do duplo vinculo) ==')
{
  // A quer MT no dia 1; B tem N no dia 1. Slots disjuntos -> SEM conflito.
  t('MT x N no mesmo dia nao conflita', encontrarConflitoExterno(ocupacao, A, ESCALA_A, 1, manha, PESSOA) === null)
  // A quer N no dia 5; B tem MT no dia 5.
  t('N x MT no mesmo dia nao conflita', encontrarConflitoExterno(ocupacao, A, ESCALA_A, 5, noite, PESSOA) === null)
}

console.log('== sem mapa de pessoa, comportamento ANTIGO preservado ==')
{
  t('sem idsDaPessoa nao acusa a irma', encontrarConflitoExterno(ocupacao, A, ESCALA_A, 1, noite) === null)
  t('mapa vazio nao acusa a irma', encontrarConflitoExterno(ocupacao, A, ESCALA_A, 1, noite, {}) === null)
  t('mapa sem entrada para o servidor nao acusa', encontrarConflitoExterno(ocupacao, A, ESCALA_A, 1, noite, { [C]: [C] }) === null)
}

console.log('== quem NAO tem irmao nao muda em nada ==')
{
  const oc = [{ servidor_id: C, dia: 9, escala_mensal_id: 'em-outra', slots: ['N'], descricao_conflito: 'Regular N no PATRIMONIO' }]
  const c = encontrarConflitoExterno(oc, C, 'em-C', 9, noite, PESSOA)
  t('conflito proprio em outro setor continua acusando', c !== null)
  t('nao e marcado como outra matricula', c && !c.outraMatricula)
  t('mensagem continua a original', c && c.descricao === 'Regular N no PATRIMONIO')
}

console.log('== a celula nao conflita com ELA MESMA (armadilha 15) ==')
{
  const oc = [{ servidor_id: A, dia: 3, escala_mensal_id: ESCALA_A, slots: ['M', 'T'], descricao_conflito: 'ela mesma' }]
  t('mesma escala do proprio servidor e excluida', encontrarConflitoExterno(oc, A, ESCALA_A, 3, manha, PESSOA) === null)
}

console.log('== mas a linha da IRMA nunca e excluida pela escala ==')
{
  // Caso limite: a irma na MESMA escala_mensal_id (nao acontece hoje, mas a exclusao nao pode
  // ser por escala — foi exatamente esse o ajuste no trigger).
  const oc = [{ servidor_id: B, dia: 4, escala_mensal_id: ESCALA_A, slots: ['N'], descricao_conflito: 'irma' }]
  const c = encontrarConflitoExterno(oc, A, ESCALA_A, 4, noite, PESSOA)
  t('irma com o mesmo escala_mensal_id ainda conflita', c !== null && c.outraMatricula === true)
}

console.log('== simetria: os dois lados enxergam ==')
{
  const ocA = [{ servidor_id: A, dia: 7, escala_mensal_id: ESCALA_A, slots: ['N'], descricao_conflito: 'A' }]
  const ocB = [{ servidor_id: B, dia: 7, escala_mensal_id: ESCALA_B, slots: ['N'], descricao_conflito: 'B' }]
  t('B ve o lancamento de A', encontrarConflitoExterno(ocA, B, ESCALA_B, 7, noite, PESSOA) !== null)
  t('A ve o lancamento de B', encontrarConflitoExterno(ocB, A, ESCALA_A, 7, noite, PESSOA) !== null)
}

console.log('== varredura de dias (Aplicar Template / Gerador) ==')
{
  const dias = diasComConflitoExterno(ocupacao, A, ESCALA_A, 1, 10, noite, PESSOA)
  t('varredura acha o dia 1', dias.some(d => d.dia === 1))
  t('varredura nao acha o dia 5 (MT x N)', !dias.some(d => d.dia === 5))
  t('varredura nao acha dia de OUTRA pessoa', !dias.some(d => d.dia === 9))
  const semMapa = diasComConflitoExterno(ocupacao, A, ESCALA_A, 1, 10, noite)
  t('varredura sem mapa preserva o antigo', semMapa.length === 0)
}

console.log('== entradas degeneradas nao explodem ==')
{
  t('ocupacao nula', encontrarConflitoExterno(null, A, ESCALA_A, 1, noite, PESSOA) === null)
  t('ocupacao vazia', encontrarConflitoExterno([], A, ESCALA_A, 1, noite, PESSOA) === null)
  t('slots nulos', encontrarConflitoExterno(ocupacao, A, ESCALA_A, 1, null, PESSOA) === null)
  t('slots vazios', encontrarConflitoExterno(ocupacao, A, ESCALA_A, 1, [], PESSOA) === null)
  const ocSemSlots = [{ servidor_id: B, dia: 1, escala_mensal_id: ESCALA_B, slots: null }]
  t('linha sem slots e ignorada', encontrarConflitoExterno(ocSemSlots, A, ESCALA_A, 1, noite, PESSOA) === null)
  t('mapa com o proprio id ausente ainda inclui o proprio',
    encontrarConflitoExterno([{ servidor_id: A, dia: 2, escala_mensal_id: 'outra', slots: ['N'], descricao_conflito: 'x' }],
      A, ESCALA_A, 2, noite, { [A]: [B] }) !== null)
}

console.log(`\n${ok} asserções ok, ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
