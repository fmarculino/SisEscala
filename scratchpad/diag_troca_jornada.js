/**
 * SO LEITURA. Impacto de trocar a jornada Regular no meio do mes.
 *
 * PERGUNTA: com que frequencia a jornada de escala_mensal e trocada depois que o mes ja
 * comecou a ser executado (ja existem batidas reais)?
 *
 * LIMITE DO METODO: escala_mensal NAO tem auditoria de jornada_id. A troca nao deixa rastro
 * alem de updated_at, e o handleSave da grade faz upsert de TODAS as linhas a cada "Salvar
 * Previsao" — entao updated_at sobe mesmo sem troca de jornada. A medicao direta e impossivel.
 * Dois proxies:
 *   A) escalas editadas depois da 1a batida real do mes -> limite SUPERIOR da exposicao
 *   B) QUEBRA no horario praticado dentro do mes: as entradas reais dos primeiros dias
 *      concentradas num horario e as dos ultimos noutro, com distancia > 90 min. E a
 *      assinatura de "mudou de horario no meio do mes", medida no fato (batida), nao no
 *      cadastro. Cruzada com a jornada vigente hoje para dizer QUAL metade ficou orfa.
 *
 * BATIDA REAL = presenca_entrada_origem in ('rep','terminal').
 * 'ajuste_coordenador' e declaracao do coordenador, nao serve para inferir horario praticado.
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
const co = (a, f) => { const o = {}; for (const x of a) { const k = f(x) ?? '(null)'; o[k] = (o[k] || 0) + 1 } return o }
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const REAL = new Set(['rep', 'terminal'])
// regex do nivel 3 da cadeia de precedencia (jornadas.nome -> hora de inicio)
const iniJornada = nome => { const m = (nome || '').match(/^([0-9]+)/); return m ? (+m[1]) * 60 : null }

async function competencia(mes, ano) {
  const em = await pag(`escala_mensal?select=id,servidor_id,unidade_id,setor_id,jornada_id,status,created_at,updated_at&mes=eq.${mes}&ano=eq.${ano}`)
  const ids = em.map(e => e.id)
  let ed = []
  for (let i = 0; i < ids.length; i += 50)
    ed.push(...await pag(`escala_diaria?select=escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_entrada_origem&escala_mensal_id=in.(${ids.slice(i, i + 50).join(',')})&categoria=eq.Regular`))
  return { em, ed }
}

;(async () => {
  const jor = await pag('jornadas?select=id,nome,horas_totais,intervalo_minutos,ativo')
  const J = new Map(jor.map(j => [j.id, j]))
  const serv = await pag('servidores?select=id,nome,matricula')
  const S = new Map(serv.map(s => [s.id, s]))

  console.log('=== 1. JORNADAS TEMPORARIAS (o instrumento datado) ===')
  const jt = await pag('servidores_jornadas_temporarias?select=id,servidor_id,jornada_id,data_inicio,data_fim,motivo,created_at')
  console.log('total em producao:', jt.length, '| servidores distintos:', new Set(jt.map(r => r.servidor_id)).size)
  console.log('por mes de inicio:', JSON.stringify(co(jt, r => r.data_inicio.slice(0, 7))))
  const porServ = {}
  jt.forEach(r => (porServ[r.servidor_id] = porServ[r.servidor_id] || []).push(r))
  let sobrep = 0
  for (const lista of Object.values(porServ))
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++)
      if (lista[i].data_inicio <= lista[j].data_fim && lista[j].data_inicio <= lista[i].data_fim) sobrep++
  console.log('pares SOBREPOSTOS no mesmo servidor (LIMIT 1 sem ORDER BY = nao deterministico):', sobrep)

  for (const [mes, ano] of [[8, 2026], [7, 2026]]) {
    console.log(`\n\n########## COMPETENCIA ${String(mes).padStart(2, '0')}/${ano} ##########`)
    const { em, ed } = await competencia(mes, ano)
    const M = new Map(em.map(e => [e.id, e]))
    console.log('escala_mensal:', em.length, '| sem jornada:', em.filter(r => !r.jornada_id).length, '| status:', JSON.stringify(co(em, r => r.status)))

    // --- PROXY A ---
    const primeira = new Map()
    for (const d of ed) {
      if (!d.presenca_entrada_em || !REAL.has(d.presenca_entrada_origem)) continue
      const at = primeira.get(d.escala_mensal_id)
      if (!at || d.presenca_entrada_em < at) primeira.set(d.escala_mensal_id, d.presenca_entrada_em)
    }
    const comBatida = em.filter(e => primeira.has(e.id))
    const editadaDepois = comBatida.filter(e => e.updated_at && e.updated_at > primeira.get(e.id))
    console.log('\n-- PROXY A: janela de exposicao --')
    console.log('escalas com >=1 batida REAL:', comBatida.length, '| editadas depois da 1a batida:', editadaDepois.length,
      `(${(editadaDepois.length / Math.max(comBatida.length, 1) * 100).toFixed(0)}%)`)

    // --- PROXY B: quebra de horario dentro do mes ---
    console.log('\n-- PROXY B: quebra no horario praticado (evidencia no fato) --')
    const achados = []
    for (const [emId, e] of M) {
      const dias = ed.filter(d => d.escala_mensal_id === emId && d.presenca_entrada_em && REAL.has(d.presenca_entrada_origem))
        .map(d => ({ dia: d.dia, min: hm(d.presenca_entrada_em) }))
        .sort((a, b) => a.dia - b.dia)
      if (dias.length < 6) continue
      // melhor ponto de corte: maximiza |mediana(antes) - mediana(depois)|, com >=3 de cada lado
      let best = null
      for (let k = 3; k <= dias.length - 3; k++) {
        const a = med(dias.slice(0, k).map(x => x.min)), b = med(dias.slice(k).map(x => x.min))
        const delta = Math.abs(a - b)
        if (!best || delta > best.delta) best = { k, a, b, delta, diaCorte: dias[k].dia }
      }
      if (!best || best.delta < 90) continue
      // consistencia: cada lado tem que ser homogeneo (dispersao menor que o salto)
      const disp = arr => { const m = med(arr); return med(arr.map(x => Math.abs(x - m))) }
      const dA = disp(dias.slice(0, best.k).map(x => x.min)), dB = disp(dias.slice(best.k).map(x => x.min))
      if (dA > best.delta / 3 || dB > best.delta / 3) continue
      const j = J.get(e.jornada_id), ini = iniJornada(j?.nome)
      achados.push({ e, j, ini, ...best, n: dias.length })
    }
    console.log('servidores com QUEBRA >=90min no horario de entrada dentro do mes:', achados.length,
      `de ${comBatida.length} com batida real`)
    achados.sort((x, y) => y.delta - x.delta)
    for (const a of achados) {
      const s = S.get(a.e.servidor_id)
      const compatA = a.ini != null ? Math.abs(a.a - a.ini) <= 60 : null
      const compatB = a.ini != null ? Math.abs(a.b - a.ini) <= 60 : null
      const veredito = a.ini == null ? 'jornada sem hora no nome'
        : compatA && compatB ? 'ambos compativeis'
          : compatB ? `dias 1..${a.diaCorte - 1} ORFAOS (praticado ${HH(a.a)}, jornada diz ${HH(a.ini)})`
            : compatA ? `dias ${a.diaCorte}..fim ORFAOS (praticado ${HH(a.b)}, jornada diz ${HH(a.ini)})`
              : `NENHUM lado bate com a jornada (${HH(a.ini)})`
      console.log(`  ${(s?.matricula || '?').padEnd(8)} ${(s?.nome || '?').slice(0, 30).padEnd(30)} jornada=${(a.j?.nome || '(nenhuma)').padEnd(13)} n=${String(a.n).padStart(2)} corte=dia ${String(a.diaCorte).padStart(2)} ${HH(a.a)}->${HH(a.b)} (${a.delta}min) | ${veredito}`)
    }
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
