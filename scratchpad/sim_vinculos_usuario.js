// Portao de src/utils/vinculosDoUsuario.ts
// Transpile antes:
//   npx tsc src/utils/vinculosDoUsuario.ts --outDir scratchpad/_sim --module commonjs --target es2020
const { vinculosForaDoEscopo, descreverVinculosForaDoEscopo } = require('./_sim/vinculosDoUsuario')

let ok = 0, bad = 0
function t(rot, cond) { if (cond) { ok++ } else { bad++; console.log('FALHA:', rot) } }

const U_SMS = 'u-sms', U_HMI = 'u-hmi', U_HMM = 'u-hmm'
const S_CAF = 's-caf', S_FARM = 's-farm', S_OUTRO = 's-outro'
const mapa = new Map([[S_CAF, U_SMS], [S_FARM, U_HMI], [S_OUTRO, U_HMM]])

// o caso real: LUCILIA, vinculo na SMS/CAF e no HMI, conta com escopo so do HMI
const LUCILIA_HMI = { id: 'v-hmi', cpf: '60230746268', matricula: '10960', unidade_id: U_HMI, unidade_nome: 'HMI' }
const LUCILIA_SMS = { id: 'v-sms', cpf: '60230746268', matricula: '67384', unidade_id: U_SMS, unidade_nome: 'SMS' }
const OUTRA_PESSOA = { id: 'v-x', cpf: '11122233344', matricula: '999', unidade_id: U_SMS, unidade_nome: 'SMS' }
const TODOS = [LUCILIA_HMI, LUCILIA_SMS, OUTRA_PESSOA]

const escopo = (u, s = [], todas = false) => ({ acessoTodasUnidades: todas, unidadeIds: u, setorIds: s })

// --- o caso que motivou -----------------------------------------------------
let r = vinculosForaDoEscopo('v-hmi', TODOS, escopo([U_HMI]), mapa)
t('acusa o vinculo da SMS que o escopo do HMI nao alcanca', r.length === 1 && r[0].id === 'v-sms')
t('a frase nomeia a unidade e a matricula',
  descreverVinculosForaDoEscopo(r) === 'Esta pessoa também tem vínculo em SMS (mat. 67384), que não está no escopo desta conta.')

// --- o OUTRO SENTIDO: nao acusar quando o escopo cobre ----------------------
t('escopo com as duas unidades nao acusa',
  vinculosForaDoEscopo('v-hmi', TODOS, escopo([U_HMI, U_SMS]), mapa).length === 0)
t('escopo por SETOR da outra unidade tambem cobre',
  vinculosForaDoEscopo('v-hmi', TODOS, escopo([U_HMI], [S_CAF]), mapa).length === 0)
t('acesso total nunca acusa',
  vinculosForaDoEscopo('v-hmi', TODOS, escopo([], [], true), mapa).length === 0)
t('sem servidor selecionado nao acusa',
  vinculosForaDoEscopo(null, TODOS, escopo([U_HMI]), mapa).length === 0)
t('pessoa com um vinculo so nao acusa',
  vinculosForaDoEscopo('v-x', TODOS, escopo([U_SMS]), mapa).length === 0)
t('nao confunde pessoas diferentes',
  vinculosForaDoEscopo('v-x', TODOS, escopo([]), mapa).every(v => v.cpf === '11122233344'))

// --- na duvida, nao acusa ---------------------------------------------------
const SEM_CPF = [{ id: 'a', cpf: null, unidade_id: U_HMI }, { id: 'b', cpf: null, unidade_id: U_SMS }]
t('sem CPF nao acusa (nao da para saber se e a mesma pessoa)',
  vinculosForaDoEscopo('a', SEM_CPF, escopo([U_HMI]), mapa).length === 0)
const SEM_UNIDADE = [LUCILIA_HMI, { id: 'v-nu', cpf: '60230746268', unidade_id: null }]
t('vinculo sem unidade nao acusa (lugar desconhecido)',
  vinculosForaDoEscopo('v-hmi', SEM_UNIDADE, escopo([U_HMI]), mapa).length === 0)

// --- CPF formatado x cru ----------------------------------------------------
const FORMATADO = [
  { id: 'f1', cpf: '602.307.462-68', unidade_id: U_HMI, unidade_nome: 'HMI' },
  { id: 'f2', cpf: '60230746268', unidade_id: U_SMS, unidade_nome: 'SMS', matricula: '67384' },
]
t('CPF com e sem pontuacao sao a mesma pessoa',
  vinculosForaDoEscopo('f1', FORMATADO, escopo([U_HMI]), mapa).length === 1)

// --- tres vinculos, dois fora ----------------------------------------------
const TRES = [LUCILIA_HMI, LUCILIA_SMS, { id: 'v-hmm', cpf: '60230746268', unidade_id: U_HMM, unidade_nome: 'HMM' }]
r = vinculosForaDoEscopo('v-hmi', TRES, escopo([U_HMI]), mapa)
t('acusa os dois vinculos de fora', r.length === 2)
t('a frase no plural lista os dois',
  descreverVinculosForaDoEscopo(r) === 'Esta pessoa também tem vínculos em SMS (mat. 67384) e HMM, que não estão no escopo desta conta.')

// --- nada a dizer -----------------------------------------------------------
t('lista vazia devolve null', descreverVinculosForaDoEscopo([]) === null)

console.log(`\n${ok} assercoes passaram, ${bad} falharam`)
process.exit(bad ? 1 : 0)
