import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const g = async p => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()

const a = await g('autorizacoes_ponto_coletivo?select=id,passos,vigencia_inicio,vigencia_fim,documento,motivo,created_at,revogado_em,criado_por_id,servidores(nome,matricula,unidades(nome))&order=created_at.desc')
console.log(`autorizacoes_ponto_coletivo: ${a.length} linha(s)`)
const porUnid = {}, porDoc = {}
for (const x of a) {
  const u = x.servidores?.unidades?.nome || '(sem unidade)'
  porUnid[u] = (porUnid[u] || 0) + 1
  porDoc[x.documento] = (porDoc[x.documento] || 0) + 1
}
console.log('  por unidade:', JSON.stringify(porUnid))
console.log('  por documento:', JSON.stringify(porDoc))
console.log(`  vigentes (sem revogacao): ${a.filter(x => !x.revogado_em).length}`)
for (const x of a.slice(0, 5)) console.log(`   - ${x.servidores?.nome?.slice(0,26)} | ${x.servidores?.unidades?.nome?.slice(0,30)} | ${x.vigencia_inicio}..${x.vigencia_fim} | doc ${x.documento} | ${String(x.motivo).slice(0,40)}`)
const criadores = [...new Set(a.map(x => x.criado_por_id).filter(Boolean))]
if (criadores.length) {
  const p = await g(`profiles?select=id,full_name,role&id=in.(${criadores.join(',')})`)
  console.log('  quem concedeu:', p.map(x => `${x.full_name} (${x.role})`).join(' | '))
}
