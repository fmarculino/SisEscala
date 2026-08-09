const fs = require('fs')
const env = fs.readFileSync('c:/Users/Cliente/Projetos/SisEscala/.env.production', 'utf8')
const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : null }
const U = g('NEXT_PUBLIC_SUPABASE_URL'), K = g('SUPABASE_SERVICE_ROLE_KEY')
const H = { apikey: K, Authorization: 'Bearer ' + K }

// Espelha fn_classificar_tentativa_negada. ILIKE '%matr_cula%' → _ casa 1 caractere.
const ilike = (s, pat) => new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i').test(s || '')
const classificar = (servidorId, msg) => {
  if (!servidorId || ilike(msg, '%matr_cula ou pin%')) return 'identidade'
  if (ilike(msg, '%j_ registrou%')) return 'ja_registrado'
  if (ilike(msg, '%nenhum plant_o%') || ilike(msg, '%sem escala%')) return 'sem_escala'
  if (ilike(msg, '%janela%')) return 'horario_divergente'
  if (ilike(msg, '%erro interno%') || ilike(msg, '%sem permiss_o%')) return 'erro_sistema'
  return 'outro'
}
const elegivel = (servidorId, msg) =>
  !!servidorId && !!msg && (ilike(msg, '%janela%') || ilike(msg, '%erro interno%')) && !ilike(msg, '%matr_cula ou pin%')

const min = t => { const [h, m] = String(t || '').split(':'); return /^\d{1,2}$/.test(h) ? +h * 60 + (+m || 0) : null }
const desvio = (horaMin, ini, fim) => {
  const i = min(ini), f = min(fim)
  const d = x => x == null ? null : Math.min(Math.abs(horaMin - x), 1440 - Math.abs(horaMin - x))
  const a = d(i), b = d(f)
  if (a == null && b == null) return null
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}

;(async () => {
  const o = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${U}/rest/v1/logs_tentativas_presenca?select=*`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    const j = await r.json(); o.push(...j); if (j.length < 1000) break
  }
  console.log('tentativas:', o.length)

  const porClasse = {}
  o.forEach(x => { const c = classificar(x.servidor_id, x.mensagem_erro); porClasse[c] = (porClasse[c] || 0) + 1 })
  console.log('\n=== CLASSIFICAÇÃO PREVISTA ===')
  Object.entries(porClasse).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`))
  const soma = Object.values(porClasse).reduce((a, b) => a + b, 0)
  console.log(`  ${String(soma).padStart(4)}  TOTAL  ${soma === o.length ? '✓ bate' : '✗ NÃO BATE'}`)
  if (porClasse.outro) {
    console.log('\n  ⚠️ caíram em "outro":')
    o.filter(x => classificar(x.servidor_id, x.mensagem_erro) === 'outro')
      .slice(0, 5).forEach(x => console.log('     ', JSON.stringify(x.mensagem_erro)))
  }

  // agrupamento por (servidor, dia, classe)
  const grupos = {}
  o.forEach(x => {
    const dia = new Date(new Date(x.data_hora_tentativa).getTime() - 3 * 3600e3).toISOString().slice(0, 10)
    const c = classificar(x.servidor_id, x.mensagem_erro)
    const k = `${x.servidor_id}|${dia}|${c}`
    const hora = new Date(new Date(x.data_hora_tentativa).getTime() - 3 * 3600e3)
    const hm = hora.getUTCHours() * 60 + hora.getUTCMinutes()
    const d = desvio(hm, x.escala_prevista_inicio, x.escala_prevista_fim)
    if (!grupos[k]) grupos[k] = { n: 0, classe: c, nome: x.nome_servidor_detectado, dia, desvio: d, ini: x.escala_prevista_inicio, fim: x.escala_prevista_fim, eleg: false }
    grupos[k].n++
    if (d != null && (grupos[k].desvio == null || d < grupos[k].desvio)) grupos[k].desvio = d
    grupos[k].eleg = grupos[k].eleg || elegivel(x.servidor_id, x.mensagem_erro)
  })
  const gs = Object.values(grupos)
  console.log(`\n=== AGRUPAMENTO ===`)
  console.log(`  ${o.length} tentativas  →  ${gs.length} casos  (redução de ${(100 - 100 * gs.length / o.length).toFixed(0)}%)`)

  const hd = gs.filter(x => x.classe === 'horario_divergente')
  console.log(`\n=== horario_divergente: ${hd.length} casos ===`)
  const comDesvio = hd.filter(x => x.desvio != null)
  console.log(`  com previsão registrada: ${comDesvio.length} | sem: ${hd.length - comDesvio.length}`)
  if (comDesvio.length) {
    const ds = comDesvio.map(x => x.desvio).sort((a, b) => a - b)
    const p = q => ds[Math.floor(ds.length * q)]
    console.log(`  desvio: mín ${ds[0]}  p50 ${p(.5)}  p90 ${p(.9)}  máx ${ds[ds.length - 1]} min`)
    console.log('\n  PIORES (escala provavelmente errada):')
    comDesvio.sort((a, b) => b.desvio - a.desvio).slice(0, 8).forEach(x =>
      console.log(`    ${String(x.desvio).padStart(4)} min  ${x.dia}  previsto ${x.ini}–${x.fim}  ${x.n}x  ${String(x.nome || '').slice(0, 32)}`))
  }
  console.log('\n  elegíveis para virar batida real:', hd.filter(x => x.eleg).length, 'de', hd.length)
})()
