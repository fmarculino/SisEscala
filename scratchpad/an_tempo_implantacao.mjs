// Quanto tempo obterPainel() realmente leva contra PRODUCAO?
//
// Necessario para escolher o teto de tempo: a v2.27.1 pos 15s e isso REPROVOU a pagina em
// producao (ela passou a mostrar "dados indisponiveis" sempre). Teto tem que ser medido, nao
// chutado.
//
// Replica o padrao de consulta de src/app/implantacao/dados.ts. So leitura.
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }

const t0 = Date.now()
const marcos = []
const marcar = (n) => { marcos.push([n, Date.now() - t0]); }

async function todas(tabela, colunas, filtro = '') {
  const out = []
  for (let de = 0; ; de += 1000) {
    const r = await fetch(`${U}/rest/v1/${tabela}?select=${colunas}${filtro}`,
      { headers: { ...H, Range: `${de}-${de + 999}` } })
    const p = await r.json()
    if (!Array.isArray(p)) break
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}
async function contar(tabela, filtro = '') {
  const r = await fetch(`${U}/rest/v1/${tabela}?select=id${filtro}`,
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
  return parseInt((r.headers.get('content-range') || '/0').split('/')[1], 10) || 0
}

await fetch(`${U}/rest/v1/unidades?select=id,nome,ativo,fonte_ponto_oficial`, { headers: H }).then(r => r.json())
marcar('unidades')

const setores = await todas('setores', 'id,unidade_id');            marcar(`setores (${setores.length})`)
const servidores = await todas('servidores', 'id,unidade_id,status'); marcar(`servidores (${servidores.length})`)

await fetch(`${U}/rest/v1/dispositivos_rep?select=id,unidade_id,ativo,created_at,ultimo_contato_em`, { headers: H }).then(r => r.json())
marcar('dispositivos_rep')

const hoje = new Date()
const comps = []
for (let i = 2; i >= 0; i--) { const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1); comps.push({ mes: d.getMonth() + 1, ano: d.getFullYear() }) }

for (const c of comps) {
  const e = await todas('escala_mensal', 'id,unidade_id,servidor_id', `&mes=eq.${c.mes}&ano=eq.${c.ano}`)
  marcar(`escala_mensal ${c.mes}/${c.ano} (${e.length})`)
}

for (const c of comps) {
  const prox = new Date(c.ano, c.mes, 1)
  const ini = `${c.ano}-${String(c.mes).padStart(2, '0')}-01`
  const fim = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}-01`
  const j = `&ocorrido_em=gte.${ini}&ocorrido_em=lt.${fim}`
  const n = await Promise.all([
    contar('marcacoes_ponto', j),
    contar('marcacoes_ponto', j + '&origem=eq.rep'),
    contar('marcacoes_ponto', j + '&origem=eq.terminal'),
    contar('marcacoes_ponto', j + '&origem=eq.ajuste_coordenador'),
    contar('marcacoes_ponto', j + '&origem=eq.ajuste_servidor'),
  ])
  marcar(`marcacoes ${c.mes}/${c.ano} (total ${n[0]})`)
}

console.log('  etapa                                    acumulado')
console.log('  ' + '-'.repeat(60))
let ant = 0
for (const [n, ms] of marcos) {
  console.log(`  ${n.padEnd(40)} ${String(ms).padStart(6)}ms   (+${ms - ant}ms)`)
  ant = ms
}
const total = Date.now() - t0
console.log(`\n  TOTAL: ${total}ms  (${(total / 1000).toFixed(1)}s)`)
console.log(`\n  Teto atual na v2.27.1: 15000ms  ->  ${total > 15000 ? '🚨 ESTOURA' : 'cabe'}`)
