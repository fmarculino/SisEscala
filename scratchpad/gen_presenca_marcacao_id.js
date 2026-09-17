/**
 * Acrescenta `*_marcacao_id` ao objeto de presenca da grade, nos TRES sitios que o montam.
 *
 * ⚠️ Por que um script e nao tres edicoes a mao: os tres blocos sao copias um do outro e ja
 * divergiram antes no projeto (foi o que criou sequenciaDia.ts). O script conta as ocorrencias e
 * ABORTA na divergencia -- se um dos tres tiver mudado de forma, e melhor falhar aqui do que
 * deixar a grade com dois formatos de presenca e o modal de correcao lendo undefined em um deles.
 */
const fs = require('fs')
const path = require('path')

const ARQ = path.join(__dirname, '..', 'src', 'app', '(dashboard)', 'escalas', 'unidade',
  '[unidadeId]', 'ScaleGrid.tsx')

const abortar = (m) => { console.error('ABORTADO: ' + m); process.exit(1) }

let s = fs.readFileSync(ARQ, 'utf8')

// ---------------------------------------------------------------------------
// 1. Os tres blocos que montam o objeto (a ultima propriedade e a ancora)
// ---------------------------------------------------------------------------
const ALVOS = [
  {
    nome: 'is_saida_manual com fallback (2 blocos de carga inicial/refetch)',
    de: 'is_saida_manual: ed.presenca_saida_manual !== undefined ? !!ed.presenca_saida_manual : !!ed.confirmado_por_id',
    esperado: 3,
  },
]

for (const alvo of ALVOS) {
  const n = s.split(alvo.de).length - 1
  if (n !== alvo.esperado) {
    abortar(`esperava ${alvo.esperado} ocorrencias de "${alvo.nome}", achei ${n}. ` +
      'Os blocos de presenca divergiram -- confira os tres antes de seguir.')
  }
}

// Ja aplicado? (idempotente)
if (s.includes('entrada_marcacao_id:')) {
  console.log('nada a fazer: os campos de marcacao_id ja estao nos tres blocos.')
  process.exit(0)
}

const EXTRA = [
  '',
  '                  entrada_marcacao_id: ed.presenca_entrada_marcacao_id || null,',
  '                  intervalo_saida_marcacao_id: ed.presenca_intervalo_saida_marcacao_id || null,',
  '                  intervalo_retorno_marcacao_id: ed.presenca_intervalo_retorno_marcacao_id || null,',
  '                  saida_marcacao_id: ed.presenca_saida_marcacao_id || null',
].join('\n')

// A indentacao difere entre os blocos; normaliza pelo que vem antes da propriedade ancora.
const partes = s.split(ALVOS[0].de)
let out = partes[0]
for (let i = 1; i < partes.length; i++) {
  // recupera a indentacao da linha da ancora
  const antes = out.slice(out.lastIndexOf('\n') + 1)
  const ind = antes.match(/^\s*/)[0]
  const extra = EXTRA.split('\n').map(l => (l ? ind + l.trim() : l)).join('\n')
  out += ALVOS[0].de + ',' + extra + partes[i]
}
s = out

// ---------------------------------------------------------------------------
// 2. O TIPO do estado, nas tres assinaturas onde ele aparece escrito por extenso
// ---------------------------------------------------------------------------
const TIPO_DE = 'is_saida_manual?: boolean }'
const TIPO_PARA = 'is_saida_manual?: boolean, entrada_marcacao_id?: string | null, '
  + 'intervalo_saida_marcacao_id?: string | null, intervalo_retorno_marcacao_id?: string | null, '
  + 'saida_marcacao_id?: string | null }'
const nTipo = s.split(TIPO_DE).length - 1
if (nTipo < 1) abortar('nao achei o tipo do estado de presenca para estender')
s = s.split(TIPO_DE).join(TIPO_PARA)
console.log(`tipo do estado estendido em ${nTipo} assinatura(s)`)

fs.writeFileSync(ARQ, s, 'utf8')

// ---------------------------------------------------------------------------
// 3. Conferencia
// ---------------------------------------------------------------------------
const depois = fs.readFileSync(ARQ, 'utf8')
const n = depois.split('entrada_marcacao_id: ed.presenca_entrada_marcacao_id').length - 1
if (n !== 3) abortar(`esperava 3 blocos com marcacao_id depois da edicao, achei ${n}`)
console.log('ok: 3 blocos de presenca passaram a carregar os 4 marcacao_id')
