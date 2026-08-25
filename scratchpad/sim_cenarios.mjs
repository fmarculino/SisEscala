/**
 * Backtest do motor NOVO, de ponta a ponta, contra a producao.
 *
 * Nao reimplementa nada do gerador: carrega o modulo transpilado e chama
 * gerarEscalaInteligente com um cliente Supabase falso. O que a RPC devolveria e calculado
 * aqui com a MESMA semantica do SQL (peso por recencia, denominador contando dia vazio,
 * so meses em que o servidor tinha escala) -- essa aritmetica ja foi conferida a mao
 * contra o Postgres (20/33 = 0.6061).
 *
 * Alvo: prever 08/2026 a partir do que os coordenadores lancaram, e comparar com o que
 * eles de fato lancaram em 08/2026.
 */
import { q } from './prod.mjs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const G = require('./_sim/intelligentScaleGenerator.js')

const ALVO_MES = 8, ALVO_ANO = 2026
const dim = (m, a) => new Date(a, m, 0).getDate()
const dow = (a, m, d) => new Date(a, m - 1, d).getDay()

// ---------- dados reais ----------
const em = await q(`escala_mensal?select=id,servidor_id,setor_id,unidade_id,mes,ano,jornada_id`)
const ed = await q(`escala_diaria?dicionario_turnos_id=not.is.null&select=escala_mensal_id,dia,categoria,dicionario_turnos_id`)
const turnos = await q(`dicionario_turnos?select=id,codigo,slots,tipo,horas_computadas`)
const servidores = await q(`servidores?select=id,nome,preferenca_turno`)
const eventos = await q(`servidores_eventos?select=*,tipos_eventos(*)`)

const emById = new Map(em.map(e => [e.id, e]))
const edPorEm = new Map()
for (const d of ed) {
  if (!edPorEm.has(d.escala_mensal_id)) edPorEm.set(d.escala_mensal_id, [])
  edPorEm.get(d.escala_mensal_id).push(d)
}

// ---------- a RPC, em JS ----------
function estatistica(setorId, mes, ano, meses) {
  const origens = []
  for (let o = 1; o <= meses; o++) {
    let m = mes - o, a = ano
    while (m < 1) { m += 12; a -= 1 }
    origens.push({ ordinal: o, mes: m, ano: a, peso: o === 1 ? 5 : o === 2 ? 2 : 1 })
  }
  const escalas = []
  for (const o of origens) {
    for (const e of em) {
      if (e.setor_id === setorId && e.mes === o.mes && e.ano === o.ano && e.servidor_id) {
        escalas.push({ emId: e.id, sid: e.servidor_id, mes: o.mes, ano: o.ano, peso: o.peso, ordinal: o.ordinal })
      }
    }
  }
  const den = new Map()      // sid|dow -> {peso, meses:Set}
  const num = new Map()      // sid|cat|dow|turno -> peso
  const trab = new Map()     // sid|cat -> [dias] (so ordinal 1)
  for (const e of escalas) {
    const linhas = edPorEm.get(e.emId) || []
    const porDia = new Map()
    for (const l of linhas) {
      if (!porDia.has(l.dia)) porDia.set(l.dia, [])
      porDia.get(l.dia).push(l)
    }
    for (let d = 1; d <= dim(e.mes, e.ano); d++) {
      const w = dow(e.ano, e.mes, d)
      const kd = `${e.sid}|${w}`
      if (!den.has(kd)) den.set(kd, { peso: 0, meses: new Set() })
      const reg = den.get(kd); reg.peso += e.peso; reg.meses.add(e.emId)
      for (const l of (porDia.get(d) || [])) {
        const kn = `${e.sid}|${l.categoria}|${w}|${l.dicionario_turnos_id}`
        num.set(kn, (num.get(kn) || 0) + e.peso)
        if (e.ordinal === 1) {
          const kt = `${e.sid}|${l.categoria}`
          if (!trab.has(kt)) trab.set(kt, new Set())
          trab.get(kt).add(d)
        }
      }
    }
  }
  // ciclo do mes mais recente
  const ciclo = new Map()
  for (const [kt, set] of trab) {
    const dias = [...set].sort((a, b) => a - b)
    const gaps = {}
    for (let i = 1; i < dias.length; i++) { const g = dias[i] - dias[i - 1]; gaps[g] = (gaps[g] || 0) + 1 }
    const ent = Object.entries(gaps).sort((a, b) => b[1] - a[1] || (+a[0]) - (+b[0]))[0]
    ciclo.set(kt, {
      ciclo_passo: ent ? +ent[0] : null,
      ciclo_consistencia: ent && dias.length > 1 ? ent[1] / (dias.length - 1) : null,
      ciclo_ultimo_dia: dias[dias.length - 1] ?? null,
      ciclo_dias_no_mes: dias.length
    })
  }
  // vencedor por (sid, cat, dow)
  const melhor = new Map()
  for (const [k, peso] of num) {
    const [sid, cat, w, turno] = k.split('|')
    const kk = `${sid}|${cat}|${w}`
    const atual = melhor.get(kk)
    if (!atual || peso > atual.peso || (peso === atual.peso && turno < atual.turno)) {
      melhor.set(kk, { sid, cat, dow: +w, turno, peso })
    }
  }
  const out = []
  for (const v of melhor.values()) {
    const d = den.get(`${v.sid}|${v.dow}`)
    const c = ciclo.get(`${v.sid}|${v.cat}`) || {}
    out.push({
      servidor_id: v.sid, categoria: v.cat, dia_semana: v.dow,
      dicionario_turnos_id: v.turno, peso: v.peso, peso_total: d.peso,
      confianca: +(v.peso / d.peso).toFixed(4), meses_com_escala: d.meses.size,
      ciclo_passo: c.ciclo_passo ?? null,
      ciclo_consistencia: c.ciclo_consistencia ?? null,
      ciclo_ultimo_dia: c.ciclo_ultimo_dia ?? null,
      ciclo_dias_no_mes: c.ciclo_dias_no_mes ?? null
    })
  }
  return out
}

// ---------- cliente Supabase falso ----------
function fake(setorId) {
  const build = (tabela) => {
    const f = {}
    const api = {
      select() { return api }, eq(c, v) { f[c] = v; return api }, in(c, v) { f[c + '_in'] = v; return api },
      lte(c, v) { f[c + '_lte'] = v; return api }, gte(c, v) { f[c + '_gte'] = v; return api },
      then(res) { res(resolver(tabela, f)) }
    }
    return api
  }
  const resolver = (tabela, f) => {
    if (tabela === 'escala_mensal') {
      return { data: em.filter(e => e.setor_id === f.setor_id && e.mes === f.mes && e.ano === f.ano
        && (!f.servidor_id_in || f.servidor_id_in.includes(e.servidor_id))), error: null }
    }
    if (tabela === 'servidores_jornadas_temporarias') return { data: [], error: null }
    if (tabela === 'servidores_eventos') {
      return { data: eventos.filter(ev => f.servidor_id_in.includes(ev.servidor_id)
        && ev.data_inicio <= f.data_inicio_lte && ev.data_fim >= f.data_fim_gte), error: null }
    }
    if (tabela === 'servidores') {
      return { data: servidores.filter(s => f.id_in.includes(s.id)), error: null }
    }
    throw new Error('tabela nao prevista: ' + tabela)
  }
  return {
    from: build,
    rpc: async (nome, a) => {
      if (nome !== 'fn_estatistica_escala_setor') throw new Error('rpc inesperada ' + nome)
      return { data: estatistica(a.p_setor_id, a.p_mes, a.p_ano, a.p_meses), error: null }
    }
  }
}

// ---------- roda o motor de verdade ----------
const setores = [...new Set(em.filter(e => e.mes === ALVO_MES && e.ano === ALVO_ANO).map(e => e.setor_id))]
const CATS = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']

async function cenario(rotulo, { continuity, meses, cats }) {
  const usar = cats || CATS
  const acc = {}; CATS.forEach(c => acc[c] = { previu: 0, real: 0, acertou: 0 })
  for (const setorId of setores) {
    const doSetor = em.filter(e => e.setor_id === setorId && e.mes === ALVO_MES && e.ano === ALVO_ANO)
    if (!doSetor.length) continue
    const r = await G.gerarEscalaInteligente(fake(setorId), {
      unidadeId: doSetor[0].unidade_id, setorId, mes: ALVO_MES, ano: ALVO_ANO,
      escalaMensal: doSetor.map(e => ({ ...e, servidores: {} })), turnos,
      options: { respectContinuity: continuity, respectEvents: true, respectPreferences: true,
                 categorias: usar, mesesHistorico: meses },
      quantidadeMeses: 1
    })
    const g = r.meses[0]
    if (!g || r.mesesDeOrigemEncontrados === 0) continue
    for (const e of doSetor) {
      const real = {}
      for (const l of (edPorEm.get(e.id) || [])) real[`${l.categoria}|${l.dia}`] = l.dicionario_turnos_id
      for (const c of CATS) acc[c].real += Object.keys(real).filter(k => k.startsWith(c + '|')).length
      const prev = g.grid[e.servidor_id] || {}
      for (const c of CATS) for (const [d, t] of Object.entries(prev[c] || {})) {
        acc[c].previu++; if (real[`${c}|${d}`] === t) acc[c].acertou++
      }
    }
  }
  console.log(rotulo)
  for (const c of CATS) {
    const a = acc[c]
    console.log(`   ${c.padEnd(11)} sugeriu=${String(a.previu).padStart(5)} cobertura=${a.real?(a.acertou/a.real*100).toFixed(1):'0.0'}%  precisao=${a.previu?(a.acertou/a.previu*100).toFixed(1):'0.0'}%`)
  }
}

// Exatamente o que a tela manda por padrao: Regular + Plantao, 1 mes, tudo marcado.
await cenario('PADRAO DE FABRICA (Regular+Plantao, 1 mes)', { continuity: true, meses: 1, cats: ['Regular','Plantão'] })
await cenario('todas as 4 linhas, 1 mes             ', { continuity: true, meses: 1, cats: CATS })
