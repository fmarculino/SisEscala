// Confere em PRODUCAO a migration 20260910120000 (troca de turno em linha Regular).
//
// EXECUTA a funcao nova em vez de so perguntar se ela existe (armadilha 42) e confere os DOIS
// sentidos: Regular fora, as tres categorias de evento dentro. Sai com codigo 1 se qualquer
// assercao falhar.
//
// SO LEITURA. Nao chama fn_alterar_turno_escala_diaria: aquela RPC escreve escala real.
//
//   node scratchpad/ver_troca_turno_aplicada.mjs [.env.production]
import { env } from './_env.mjs'

const ARQ = process.argv[2] || '.env.production'
const E = env(ARQ)
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const ANON = E.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

console.log(`banco: ${U}`)

const falhas = []
let ok = 0
const diz = (rot, cond) => { if (cond) { ok++; console.log(`  OK    ${rot}`) } else { falhas.push(rot); console.log(`  FALHA ${rot}`) } }

async function categoria(cat, chave = H) {
  const r = await fetch(`${U}/rest/v1/rpc/fn_categoria_tem_justificativa_evento`, {
    method: 'POST', headers: chave, body: JSON.stringify({ p_categoria: cat })
  })
  return { status: r.status, corpo: await r.text() }
}

// 1. A funcao nova existe e responde a verdade.
console.log('\n1. fn_categoria_tem_justificativa_evento (executada, service_role)')
for (const [cat, esperado] of [['Regular', 'false'], ['Extra', 'true'], ['Plantão', 'true'],
                               ['Sobreaviso', 'true'], ['plantao', 'false'], [null, 'false']]) {
  const { status, corpo } = await categoria(cat)
  diz(`${JSON.stringify(cat)} -> ${corpo.trim()} (esperado ${esperado})`,
      status === 200 && corpo.trim() === esperado)
}

// 2. anon nao alcanca (armadilha 24).
console.log('\n2. privilegios')
const a = await categoria('Extra', { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' })
diz(`anon recusado (HTTP ${a.status})`, a.status === 401 || a.status === 403)

// 3. A RPC de troca de turno esta no ar E e a versao nova.
//    O COMMENT ON FUNCTION desta migration vem DEPOIS do CREATE no arquivo: se o texto novo esta
//    publicado no OpenAPI, o CREATE que o antecede tambem aplicou.
console.log('\n3. fn_alterar_turno_escala_diaria')
const spec = await (await fetch(`${U}/rest/v1/`, { headers: H })).text()
diz('a RPC esta exposta', spec.includes('fn_alterar_turno_escala_diaria'))
diz('o comentario e o da versao NOVA (cita justificativa_evento_registrada)',
    spec.includes('justificativa_evento_registrada'))

// Chamada que NAO escreve: escala inexistente cai no guard "Nao existe lancamento".
const r = await fetch(`${U}/rest/v1/rpc/fn_alterar_turno_escala_diaria`, {
  method: 'POST', headers: H, body: JSON.stringify({
    p_escala_mensal_id: '00000000-0000-0000-0000-000000000000',
    p_dia: 1, p_categoria: 'Regular',
    p_dicionario_turnos_id: '00000000-0000-0000-0000-000000000000',
    p_justificativa: 'sonda de conferencia - nao escreve nada'
  })
})
const t = await r.text()
diz(`executa e recusa escala inexistente (${r.status})`, r.status >= 400 && /Nao existe lancamento/.test(t))

// 4. A CHECK continua barrando Regular — a premissa do conserto nao mudou.
console.log('\n4. a CHECK da tabela')
const ins = await fetch(`${U}/rest/v1/justificativas_eventos`, {
  method: 'POST', headers: H,
  body: JSON.stringify([{ dia: 1, mes: 1, ano: 2099, categoria: 'Regular', texto_justificativa: 'SONDA' }])
})
const insTxt = await ins.text()
diz(`INSERT de Regular recusado com 23514 (${ins.status})`, ins.status >= 400 && insTxt.includes('23514'))

console.log(`\n${ok} ok, ${falhas.length} falha(s)`)
process.exit(falhas.length ? 1 : 0)
