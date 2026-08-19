/**
 * SO LEITURA. Terceiro sinal: jornada cadastrada que NAO corresponde ao horario praticado
 * durante o mes inteiro (sem quebra no meio).
 *
 * POR QUE IMPORTA: a quebra (proxy B) so pega quem mudou de horario NO MEIO do mes. Uma troca
 * de jornada feita por ENGANO — ou uma troca correta feita tarde demais — deixa outro rastro:
 * a jornada vigente aponta um inicio e todas as batidas reais do mes ficam longe dele, de
 * ponta a ponta. E o estado em que o previsto e a folha ja estao errados o mes todo.
 *
 * Mede so 08/2026: e a unica competencia com presenca_entrada_origem preenchida
 * (coluna criada em 20260808020000). Em 06 e 07/2026 a validacao em massa gravou o INSTANTE
 * DA VALIDACAO como se fosse batida (medido: dias 1..17 de junho todos com "18/06 20:3x"),
 * entao qualquer heuristica de horario ali mede o artefato, nao o fato.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
const pag = async rec => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + rec, { headers: { ...H, Range: f + '-' + (f + 999) } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const hm = t => { const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t)).split(':'); return (+d[0]) * 60 + (+d[1]) }
const HH = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const REAL = new Set(['rep', 'terminal'])
const iniJornada = nome => { const m = (nome || '').match(/^([0-9]+)/); return m ? (+m[1]) * 60 : null }

;(async () => {
  const jor = await pag('jornadas?select=id,nome'); const J = new Map(jor.map(j => [j.id, j]))
  const serv = await pag('servidores?select=id,nome,matricula'); const S = new Map(serv.map(s => [s.id, s]))
  const uni = await pag('unidades?select=id,nome'); const UN = new Map(uni.map(u => [u.id, u.nome]))
  const em = await pag('escala_mensal?select=id,servidor_id,unidade_id,jornada_id&mes=eq.8&ano=eq.2026')
  const ids = em.map(e => e.id)
  let ed = []
  for (let i = 0; i < ids.length; i += 50)
    ed.push(...await pag(`escala_diaria?select=escala_mensal_id,dia,presenca_entrada_em,presenca_entrada_origem&escala_mensal_id=in.(${ids.slice(i, i + 50).join(',')})&categoria=eq.Regular`))

  const porEm = new Map()
  for (const d of ed) {
    if (!d.presenca_entrada_em || !REAL.has(d.presenca_entrada_origem)) continue
    if (!porEm.has(d.escala_mensal_id)) porEm.set(d.escala_mensal_id, [])
    porEm.get(d.escala_mensal_id).push(hm(d.presenca_entrada_em))
  }

  const linhas = []
  for (const e of em) {
    const arr = porEm.get(e.id); if (!arr || arr.length < 4) continue
    const j = J.get(e.jornada_id); const ini = iniJornada(j?.nome)
    if (ini == null) { linhas.push({ e, j, ini: null, n: arr.length, mediana: med(arr), desvio: null }); continue }
    linhas.push({ e, j, ini, n: arr.length, mediana: med(arr), desvio: med(arr) - ini })
  }
  const comIni = linhas.filter(l => l.desvio != null)
  const faixa = d => { const a = Math.abs(d); return a <= 15 ? '<=15min' : a <= 30 ? '16-30min' : a <= 60 ? '31-60min' : a <= 120 ? '61-120min' : '>120min' }
  const dist = {}
  comIni.forEach(l => dist[faixa(l.desvio)] = (dist[faixa(l.desvio)] || 0) + 1)

  console.log('=== 08/2026: entrada real mediana vs inicio da jornada vigente ===')
  console.log('escalas com >=4 batidas reais e jornada com hora no nome:', comIni.length)
  console.log('sem hora no nome da jornada (nivel 3 nao resolve):', linhas.length - comIni.length)
  console.log('distribuicao do desvio:', JSON.stringify(dist))
  const graves = comIni.filter(l => Math.abs(l.desvio) > 60).sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio))
  console.log('\nDESALINHADOS (> 60 min o mes inteiro):', graves.length)
  for (const l of graves) {
    const s = S.get(l.e.servidor_id)
    console.log(`  ${(s?.matricula || '?').padEnd(8)} ${(s?.nome || '?').slice(0, 30).padEnd(30)} ${(UN.get(l.e.unidade_id) || '?').slice(0, 22).padEnd(22)} jornada=${(l.j?.nome || '-').padEnd(13)} diz ${HH(l.ini)} | pratica ${HH(l.mediana)} (n=${l.n}) desvio=${l.desvio > 0 ? '+' : ''}${l.desvio}min`)
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
