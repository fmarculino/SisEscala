/** SO LEITURA. Reune o panorama da implantacao para o painel de acompanhamento. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
async function page(q, tam = 1000) {
  q += (q.includes('?') ? '&' : '?') + 'order=id'
  const out = []
  for (let f = 0; ; f += tam) {
    const r = await fetch(U + '/rest/v1/' + q, { headers: { ...H, Range: f + '-' + (f + tam - 1) } })
    if (!r.ok) throw new Error(q.slice(0, 40) + ' ' + r.status + ' ' + await r.text())
    const p = await r.json(); out.push(...p); if (p.length < tam) break
  }
  return out
}

;(async () => {
  const unidades = await page('unidades?select=id,nome,ativo,endereco,localizacao,latitude,longitude,fonte_ponto_oficial,created_at')
  const setores = await page('setores?select=id,unidade_id,ativo')
  const servidores = await page('servidores?select=id,unidade_id,setor_id,status,cpf,pis_pasep')
  const disp = await page('dispositivos_rep?select=id,nome,unidade_id,setor_id,ativo,created_at,ponto_valido_desde,ultimo_contato_em,modelo,coletor_versao,ultimo_nsr')
  const term = await page('terminais_locais?select=*')

  // escalas por competencia
  const em = []
  for (const [m, a] of [[7, 2026], [8, 2026], [9, 2026]]) {
    const r = await page('escala_mensal?select=id,servidor_id,unidade_id,mes,ano,ativo&mes=eq.' + m + '&ano=eq.' + a)
    em.push(...r)
  }
  const folhas = await page('folha_ponto?select=id,servidor_id,mes,ano,status&ano=eq.2026')

  // marcacoes por origem e mes (so contagem)
  const marc = { }
  for (const [ini, fim, rot] of [['2026-06-01','2026-07-01','06'],['2026-07-01','2026-08-01','07'],['2026-08-01','2026-09-01','08']]) {
    const rows = await page('marcacoes_ponto?select=id,origem&ocorrido_em=gte.' + ini + '&ocorrido_em=lt.' + fim)
    marc[rot] = rows.reduce((a, x) => { a[x.origem] = (a[x.origem] || 0) + 1; return a }, {})
    marc[rot].total = rows.length
  }

  // sincronizacoes REP
  let sincs = []
  try { sincs = await page('rep_sincronizacoes?select=id,dispositivo_id,status,iniciada_em,marcacoes_criadas,linhas_novas') } catch (e) { sincs = [] }
  let afd = 0
  try {
    const r = await fetch(U + '/rest/v1/rep_afd_registros?select=id&limit=1', { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
    afd = Number((r.headers.get('content-range') || '/0').split('/')[1]) || 0
  } catch (e) {}

  const dados = { unidades, setores, servidores, disp, term, em, folhas, marc, sincs, afd, coletadoEm: new Date().toISOString() }
  fs.writeFileSync(path.join(__dirname, 'implantacao.json'), JSON.stringify(dados))

  // resumo em tela
  const un = unidades.filter(u => u.ativo !== false)
  console.log('unidades: ' + unidades.length + ' (ativas ' + un.length + ')')
  console.log('setores: ' + setores.length + ' | servidores: ' + servidores.length + ' (ativos ' + servidores.filter(s => s.status === 'Ativo').length + ')')
  console.log('dispositivos REP: ' + disp.length + ' (ativos ' + disp.filter(d => d.ativo !== false).length + ')')
  console.log('terminais locais: ' + term.length)
  console.log('escala_mensal 07: ' + em.filter(e=>e.mes===7).length + ' | 08: ' + em.filter(e=>e.mes===8).length + ' | 09: ' + em.filter(e=>e.mes===9).length)
  console.log('folhas 2026: ' + folhas.length)
  console.log('AFD registros: ' + afd + ' | sincronizacoes: ' + sincs.length)
  console.log('marcacoes: ' + JSON.stringify(marc))
  console.log('')
  console.log('=== unidades com dispositivo REP ===')
  const porUn = new Map(unidades.map(u => [u.id, u.nome]))
  for (const d of disp) console.log('  ' + String(porUn.get(d.unidade_id) || '(sem unidade)').slice(0,42).padEnd(44) + ' ' + (d.ativo !== false ? 'ATIVO ' : 'inativo') + ' desde ' + String(d.created_at).slice(0,10) + '  ult.contato ' + String(d.ultimo_contato_em || '-').slice(0,16))
  console.log('')
  console.log('=== unidades COM escala em 08 ou 09 e SEM relogio ===')
  const comDisp = new Set(disp.map(d => d.unidade_id))
  const comEsc = new Set(em.filter(e => e.mes >= 8).map(e => e.unidade_id))
  let n = 0
  for (const u of unidades) if (comEsc.has(u.id) && !comDisp.has(u.id)) { n++; console.log('  ' + u.nome) }
  console.log('  total: ' + n)
  console.log('')
  console.log('=== unidades SEM escala nenhuma ===')
  let n2 = 0
  for (const u of unidades) if (!comEsc.has(u.id)) { n2++; if (n2 <= 40) console.log('  ' + u.nome) }
  console.log('  total: ' + n2)
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
