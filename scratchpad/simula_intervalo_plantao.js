/**
 * Simula 20260822120000 + 20260822130000 sobre os dados REAIS de producao, antes de aplicar
 * qualquer coisa. Reproduz em JS exatamente o que as funcoes novas fazem e compara o antes com
 * o depois, lancamento a lancamento.
 *
 * Nao escreve nada. So SELECT.
 */
const fs = require('fs')
const env = fs.readFileSync('.env.production', 'utf8')
const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim()
const U = g('NEXT_PUBLIC_SUPABASE_URL'), K = g('SUPABASE_SERVICE_ROLE_KEY')
const H = { apikey: K, Authorization: 'Bearer ' + K }

async function all(p) {
  const o = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(U + '/rest/v1/' + p, { headers: { ...H, Range: `${f}-${f + 999}` } })
    if (!r.ok) throw new Error(r.status + await r.text())
    const q = await r.json(); o.push(...q)
    if (q.length < 1000) break
  }
  return o
}

// --- as funcoes novas, transcritas ---------------------------------------
const intervaloMinimoLegal = dur => (dur || 0) > 360 ? 60 : 0
const intervaloPrevisto = (cat, dur, jor, tur) =>
  Math.max(cat === 'Regular' ? Number(jor ?? 60) : Number(tur ?? 0), intervaloMinimoLegal(dur))
const temIntervalo = (dur, int) => (dur || 0) > 360 && (int || 0) > 0

// --- o comportamento ANTIGO ----------------------------------------------
const intervaloAntigo = (cat, dur, jor) => Number(jor ?? 60)

;(async () => {
  const J = Object.fromEntries((await all('jornadas?select=id,nome,horas_totais,intervalo_minutos')).map(x => [x.id, x]))
  // dicionario_turnos.intervalo_minutos ainda nao existe em producao, e a migration a cria
  // NULL para TODOS os codigos de proposito (NULL = nao regulamentado -> vale o piso legal).
  // Simular com null e simular exatamente o estado logo depois de aplicar.
  const T = Object.fromEntries((await all('dicionario_turnos?select=id,codigo,horas_computadas'))
    .map(x => [x.id, { ...x, intervalo_minutos: null }]))
  const Un = Object.fromEntries((await all('unidades?select=id,nome,permite_marca_intervalo')).map(x => [x.id, x]))
  const EM = Object.fromEntries((await all('escala_mensal?select=id,servidor_id,unidade_id,mes,ano,jornada_id,status')).map(x => [x.id, x]))
  const S = Object.fromEntries((await all('servidores?select=id,nome')).map(x => [x.id, x]))
  const temp = await all('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim')
  const ed = await all('escala_diaria?select=id,escala_mensal_id,dia,categoria,dicionario_turnos_id')

  const jornadaDoDia = (s, a, m, d, jm) => {
    const k = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const t = temp.find(x => x.servidor_id === s && x.data_inicio <= k && x.data_fim >= k)
    return J[t ? t.jornada_id : jm]
  }

  const transicoes = {}
  const ganharam = [], perderam = [], mudaramDuracao = []

  for (const l of ed) {
    if (l.categoria === 'Sobreaviso') continue
    const e = EM[l.escala_mensal_id]; if (!e) continue
    const t = T[l.dicionario_turnos_id]; if (!t) continue
    const u = Un[e.unidade_id]
    const j = jornadaDoDia(e.servidor_id, e.ano, e.mes, l.dia, e.jornada_id)

    // Mesma escolha de duracao que fn_confirmar_presenca/fn_blocos_previstos_dia fazem.
    const dur = (l.categoria === 'Regular' && j?.horas_totais > 0
      ? Number(j.horas_totais) : Number(t.horas_computadas || 0)) * 60

    const permite = !!u?.permite_marca_intervalo
    const antesInt = intervaloAntigo(l.categoria, dur, j?.intervalo_minutos)
    const depoisInt = intervaloPrevisto(l.categoria, dur, j?.intervalo_minutos, t.intervalo_minutos)
    const antes = permite && temIntervalo(dur, antesInt)
    const depois = permite && temIntervalo(dur, depoisInt)

    const chave = `${l.categoria.padEnd(8)} ${antes ? 'COM' : 'sem'} -> ${depois ? 'COM' : 'sem'}`
    transicoes[chave] = (transicoes[chave] || 0) + 1

    const linha = {
      comp: `${e.ano}-${String(e.mes).padStart(2, '0')}`, dia: l.dia, st: e.status,
      cat: l.categoria, cod: t.codigo, h: t.horas_computadas,
      serv: (S[e.servidor_id]?.nome || '').slice(0, 24), jorn: j?.nome,
      uni: (u?.nome || '').slice(0, 12), antes: antesInt, depois: depoisInt
    }
    if (!antes && depois) ganharam.push(linha)
    else if (antes && !depois) perderam.push(linha)
    else if (antes && depois && antesInt !== depoisInt) mudaramDuracao.push(linha)
  }

  console.log('=== TRANSICOES (todas as ' + ed.length + ' linhas de escala_diaria) ===')
  for (const [k, v] of Object.entries(transicoes).sort()) console.log('  ' + String(v).padStart(5) + '  ' + k)

  console.log('\n=== GANHARAM passo de intervalo: ' + ganharam.length + ' ===')
  const porGrupo = {}
  for (const x of ganharam) {
    const k = `${x.cat} ${x.cod} (${x.h}h) · jornada ${x.jorn} · ${x.comp} ${x.st}`
    porGrupo[k] = (porGrupo[k] || 0) + 1
  }
  for (const [k, v] of Object.entries(porGrupo).sort((a, b) => b[1] - a[1])) console.log('  ' + String(v).padStart(4) + '  ' + k)

  console.log('\n=== PERDERAM passo de intervalo: ' + perderam.length + ' (esperado: 0) ===')
  if (perderam.length) console.table(perderam.slice(0, 30))

  console.log('\n=== mantiveram o passo, mas a DURACAO prevista mudou: ' + mudaramDuracao.length + ' ===')
  const porDur = {}
  for (const x of mudaramDuracao) {
    const k = `${x.cat} ${x.cod} (${x.h}h) · jornada ${x.jorn} · ${x.antes} -> ${x.depois} min`
    porDur[k] = (porDur[k] || 0) + 1
  }
  for (const [k, v] of Object.entries(porDur).sort((a, b) => b[1] - a[1])) console.log('  ' + String(v).padStart(4) + '  ' + k)

  // O caso do print
  console.log('\n=== os dois casos do print (22/08/2026) ===')
  console.table(ganharam.filter(x => x.dia === 22 && x.comp === '2026-08' &&
    (x.serv.startsWith('INGRID') || x.serv.startsWith('GISELE') || x.serv.startsWith('AGNES'))))
})()
