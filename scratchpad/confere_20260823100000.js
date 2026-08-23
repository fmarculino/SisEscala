/** SO LEITURA. Portao da 20260823100000 contra PRODUCAO. Nao escreve nada. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const rpc = async (f, b) => { const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : ' -- '

;(async () => {
  const [s] = await get('servidores?select=id,nome&matricula=eq.205')
  console.log('servidor: ' + s.nome)

  // 1) a chave "turnos" existe?
  const a10 = await rpc('fn_alocar_marcacoes_dia', { p_servidor_id: s.id, p_data: '2026-08-10' })
  const t = a10.turnos
  if (!Array.isArray(t)) { console.log('FALHOU 1: chave "turnos" ausente -> migration NAO aplicada'); process.exit(1) }
  console.log('1) turnos (10/08): ' + t.map(x => 'ordem ' + x.ordem + '/' + x.total + ' ' + F(x.inicio) + '-' + F(x.fim)).join('  |  '))

  // 2/3) projecao por linha, nos dias que importam
  const em = await get('escala_mensal?select=id&servidor_id=eq.' + s.id + '&mes=eq.8&ano=eq.2026')
  const ids = em.map(e => e.id).join(',')
  const ed = await get('escala_diaria?select=id,dia,categoria,dicionario_turnos(codigo),presenca_entrada_em,presenca_intervalo_saida_em,presenca_intervalo_retorno_em,presenca_saida_em&escala_mensal_id=in.(' + ids + ')&order=dia')

  for (const dia of [3, 4, 5, 10, 11, 12, 14, 17, 20]) {
    const linhas = ed.filter(x => x.dia === dia)
    if (linhas.length < 2) continue
    const data = '2026-08-' + String(dia).padStart(2, '0')
    const proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: s.id, p_data: data })
    const P = new Map(proj.map(p => [p.escala_diaria_id, p]))
    console.log('\n-- dia ' + dia)
    for (const d of linhas) {
      const p = P.get(d.id)
      const g = [d.presenca_entrada_em, d.presenca_intervalo_saida_em, d.presenca_intervalo_retorno_em, d.presenca_saida_em].map(F).join(' ')
      const n = p ? [p.entrada_em, p.int_saida_em, p.int_ret_em, p.saida_em].map(F).join(' ') : '(FORA DA PROJECAO — nao seria limpo)'
      console.log('   ' + d.categoria.padEnd(8) + ' ' + String(d.dicionario_turnos && d.dicionario_turnos.codigo || '-').padEnd(3) +
        ' gravado: ' + g + '  ->  projetado: ' + n + (g !== n ? '   <<< MUDA' : ''))
    }
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
