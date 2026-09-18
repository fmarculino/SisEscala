// Mede o caso do duplo vinculo: batida que chega no cadastro A e o passo esta no cadastro B.
// LEITURA PURA. Nao escreve nada.
import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}` }

async function get(path) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

// 1. Os dois cadastros do caso relatado
const alvo = await get('servidores?select=id,nome,matricula,cpf,pis_pasep,status,unidade_id,setor_id,mesclado_em_servidor_id&matricula=in.(53729,68152)')
console.log('=== 1. CADASTROS DO CASO ===')
for (const s of alvo) {
  console.log(`  mat ${s.matricula} | ${s.nome} | ${s.status} | cpf ${s.cpf} | pis ${s.pis_pasep} | id ${s.id}`)
}

const cpf = alvo[0] && (alvo[0].cpf || '').replace(/\D/g, '').slice(-11)
const ids = alvo.map(s => s.id)

// 2. Vinculos REP daquele CPF
console.log('\n=== 2. VINCULOS REP DOS DOIS CADASTROS ===')
const vinc = await get(`rep_vinculos_servidor?select=id,dispositivo_id,servidor_id,identificador_afd,vigente_de,vigente_ate,tem_biometria&servidor_id=in.(${ids.join(',')})`)
const disps = await get('dispositivos_rep?select=id,nome,unidade_id,ponto_valido_desde')
const nomeDisp = Object.fromEntries(disps.map(d => [d.id, d.nome]))
for (const v of vinc) {
  const s = alvo.find(x => x.id === v.servidor_id)
  console.log(`  ${nomeDisp[v.dispositivo_id] || v.dispositivo_id} -> mat ${s?.matricula} | ident ${v.identificador_afd} | de ${v.vigente_de} ate ${v.vigente_ate ?? '-'} | bio ${v.tem_biometria}`)
}
if (vinc.length === 0) console.log('  (nenhum vinculo)')

// 3. Marcacoes de 17/09 dos dois
console.log('\n=== 3. MARCACOES 16-18/09 DOS DOIS CADASTROS ===')
const marc = await get(`marcacoes_ponto?select=id,servidor_id,origem,ocorrido_em,dispositivo_id,nsr,unidade_id&servidor_id=in.(${ids.join(',')})&ocorrido_em=gte.2026-09-16T00:00:00-03:00&ocorrido_em=lt.2026-09-19T00:00:00-03:00&order=ocorrido_em`)
for (const m of marc) {
  const s = alvo.find(x => x.id === m.servidor_id)
  console.log(`  ${m.ocorrido_em} | mat ${s?.matricula} | ${m.origem} | ${nomeDisp[m.dispositivo_id] || '-'} | nsr ${m.nsr ?? '-'}`)
}
if (marc.length === 0) console.log('  (nenhuma)')

// 4. Escala diaria 17/09 dos dois
console.log('\n=== 4. ESCALA DIARIA 17/09 ===')
const em = await get(`escala_mensal?select=id,servidor_id,unidade_id,setor_id,mes,ano,status&servidor_id=in.(${ids.join(',')})&mes=eq.9&ano=eq.2026`)
for (const e of em) {
  const s = alvo.find(x => x.id === e.servidor_id)
  const ed = await get(`escala_diaria?select=id,dia,categoria,presenca_entrada_em,presenca_entrada_origem,presenca_saida_em,presenca_saida_origem,reconciliado_em&escala_mensal_id=eq.${e.id}&dia=eq.17`)
  console.log(`  escala ${e.id} | mat ${s?.matricula} | status ${e.status}`)
  for (const d of ed) {
    console.log(`     dia ${d.dia} ${d.categoria} | entrada ${d.presenca_entrada_em ?? '-'} (${d.presenca_entrada_origem ?? '-'}) | saida ${d.presenca_saida_em ?? '-'} (${d.presenca_saida_origem ?? '-'}) | reconciliado ${d.reconciliado_em ?? 'NUNCA'}`)
  }
  if (ed.length === 0) console.log('     (sem linha no dia 17)')
}
