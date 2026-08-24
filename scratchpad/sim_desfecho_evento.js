/**
 * Portao da fase 0 do plano docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md
 *
 * Nao ha framework de teste no projeto, e migrations nao sao aplicadas por quem escreve o SQL.
 * Este script REPLICA fn_desfecho_evento_dia (20260824120000) em JS e roda sobre os dados reais
 * de producao, para conferir - ANTES de aplicar - os numeros escritos no bloco de CONFERENCIA
 * daquela migration. Se os dois discordarem, o errado e o SQL, nao a medicao.
 *
 * Leitura apenas. Nao escreve nada em lugar nenhum.
 *
 *   node scratchpad/sim_desfecho_evento.js
 *
 * A chave vem de .env.production (nunca embutida - CLAUDE.md, armadilha 18: o repositorio e
 * publico e um segredo em commit e um segredo publicado).
 */

const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.production')
if (!fs.existsSync(envPath)) {
  console.error('Faltou .env.production. Este script nao embute chave nenhuma.')
  process.exit(1)
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')])
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env.production.')
  process.exit(1)
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

/** PostgREST corta em 1000 linhas em silencio (CLAUDE.md, armadilha 8). Sempre paginar. */
async function all(pathAndQuery) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, {
      headers: { ...H, Range: `${from}-${from + 999}` }
    })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

/** Espelha public.fn_status_acionamento_sobreaviso. Prazos de producao: 30 e 90 minutos. */
const LIM_ACEITE = 30
const LIM_CHEGADA = 90
function statusAcionamento(log, agoraMs) {
  if (log.status === 'Chegou') return { estado: 'atendido', motivo: null }
  if (log.status === 'Recusado') return { estado: 'recusado', motivo: 'O servidor recusou o acionamento' }
  if (log.status === 'Cancelado') return { estado: 'cancelado', motivo: null }

  if (log.status === 'Aceito') {
    const aceite = log.data_hora_aceite ? new Date(log.data_hora_aceite).getTime() : null
    if (!log.data_hora_chegada && aceite !== null && aceite + LIM_CHEGADA * 60000 < agoraMs) {
      return { estado: 'falhou_chegada', motivo: 'Tempo limite de deslocamento excedido' }
    }
    return { estado: 'em_andamento', motivo: null }
  }

  if (log.status === 'Aguardando') {
    const bruto = log.created_at || log.data_hora_acionamento
    const inicio = bruto ? new Date(bruto).getTime() : null
    if (inicio !== null && inicio + LIM_ACEITE * 60000 < agoraMs) {
      return { estado: 'falhou_aceite', motivo: 'Tempo limite para aceite excedido' }
    }
    return { estado: 'em_andamento', motivo: null }
  }

  return { estado: 'em_andamento', motivo: null }
}

/** Espelha public.fn_acionamento_sobreaviso_real. */
function acionamentoReal(log) {
  if (log.acionado_por) return true
  const m = log.motivo_acionamento || ''
  return !(/^O próprio usuário confirmou/i.test(m)
        || /^Validação Manual/i.test(m)
        || /^REVERSÃO/i.test(m))
}

/** Espelha public.fn_desfecho_evento_dia, na mesma ordem de precedencia. */
function desfecho(ed, ctx) {
  const horas = Number(ed.dicionario_turnos?.horas_computadas || 0)
  const cat = ed.categoria

  if (cat !== 'Plantão' && cat !== 'Sobreaviso') {
    return { estado: 'nao_aplicavel', horas, fonte: 'categoria' }
  }

  // 1. dia futuro
  const dataEvento = `${ctx.ano}-${String(ctx.mes).padStart(2, '0')}-${String(ed.dia).padStart(2, '0')}`
  if (dataEvento >= ctx.hoje) return { estado: 'previsto', horas, fonte: 'calendario' }

  // 2. desfecho explicito vence tudo
  const je = ctx.justMap.get(`${ctx.servidorId}|${ed.dia}|${cat.toLowerCase()}`)
  if (je && je.resultado === 'falta') return { estado: 'falta', horas, fonte: je.resultado_origem || 'coordenador' }
  if (je && je.resultado === 'validado') return { estado: 'validado', horas, fonte: 'coordenador' }

  // 3-A. sobreaviso
  if (cat === 'Sobreaviso') {
    const logs = (ctx.logsPorDia.get(ed.dia) || [])
      .filter(l => l.categoria === 'Sobreaviso' || l.categoria === null)
      .filter(acionamentoReal)
    if (logs.length === 0) return { estado: 'validado', horas, fonte: 'sem_acionamento' }
    const estados = logs.map(l => statusAcionamento(l, ctx.agoraMs).estado)
    if (estados.some(e => e === 'falhou_aceite' || e === 'falhou_chegada' || e === 'recusado')) {
      return { estado: 'falta', horas, fonte: 'acionamento' }
    }
    if (estados.some(e => e === 'em_andamento')) return { estado: 'previsto', horas, fonte: 'acionamento' }
    return { estado: 'validado', horas, fonte: 'acionamento' }
  }

  // 3-B. plantao
  if (ed.presenca_entrada_em && ed.presenca_saida_em) {
    const algumManual = ed.presenca_entrada_manual || ed.presenca_saida_manual
    if (algumManual && /^Ajuste autom/i.test(ed.justificativa_manual || '')) {
      return { estado: 'em_avaliacao', horas, fonte: 'ajuste_automatico' }
    }
    return { estado: 'registrado', horas, fonte: algumManual ? 'validacao_manual' : 'ponto' }
  }

  return { estado: 'em_avaliacao', horas, fonte: 'ponto' }
}

async function competencia(mes, ano, hoje) {
  const mensais = await all(`escala_mensal?select=id,servidor_id,mes,ano&mes=eq.${mes}&ano=eq.${ano}&ativo=is.true`)
  const ids = mensais.map(m => m.id)
  const porId = new Map(mensais.map(m => [m.id, m]))

  const diarias = []
  const logs = []
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60).join(',')
    diarias.push(...await all(
      'escala_diaria?select=id,dia,categoria,escala_mensal_id,presenca_entrada_em,presenca_saida_em,' +
      'presenca_entrada_manual,presenca_saida_manual,justificativa_manual,' +
      'dicionario_turnos(horas_computadas)' +
      `&categoria=in.(Plant%C3%A3o,Sobreaviso)&escala_mensal_id=in.(${chunk})`))
    logs.push(...await all(
      'logs_sobreaviso?select=escala_mensal_id,dia,categoria,status,acionado_por,motivo_acionamento,' +
      `created_at,data_hora_acionamento,data_hora_aceite,data_hora_chegada&escala_mensal_id=in.(${chunk})`))
  }

  // A coluna `resultado` so existe depois de 20260824100000. O simulador precisa rodar ANTES
  // (para conferir os numeros que a migration promete) e DEPOIS (para conferir que ela nao
  // inventou desfecho nenhum), entao a ausencia da coluna nao pode ser erro.
  let justificativas
  try {
    justificativas = await all(
      `justificativas_eventos?select=servidor_id,dia,categoria,resultado,resultado_origem&mes=eq.${mes}&ano=eq.${ano}`)
  } catch (e) {
    if (!String(e.message).includes('resultado does not exist')) throw e
    console.log('  (coluna `resultado` ainda nao existe - migration 1 nao aplicada; tratando tudo como NULL)')
    justificativas = await all(
      `justificativas_eventos?select=servidor_id,dia,categoria&mes=eq.${mes}&ano=eq.${ano}`)
  }
  const justMap = new Map()
  justificativas.forEach(j => justMap.set(`${j.servidor_id}|${j.dia}|${String(j.categoria).toLowerCase()}`, j))

  const logsPorEscala = new Map()
  logs.forEach(l => {
    if (!logsPorEscala.has(l.escala_mensal_id)) logsPorEscala.set(l.escala_mensal_id, new Map())
    const porDia = logsPorEscala.get(l.escala_mensal_id)
    if (!porDia.has(l.dia)) porDia.set(l.dia, [])
    porDia.get(l.dia).push(l)
  })

  const agoraMs = new Date(`${hoje}T12:00:00-03:00`).getTime()
  const resumo = {}
  diarias.forEach(ed => {
    const em = porId.get(ed.escala_mensal_id)
    const r = desfecho(ed, {
      mes, ano, hoje, agoraMs,
      servidorId: em.servidor_id,
      justMap,
      logsPorDia: logsPorEscala.get(ed.escala_mensal_id) || new Map()
    })
    const k = `${ed.categoria} | ${r.estado}`
    if (!resumo[k]) resumo[k] = { n: 0, horas: 0, fontes: {} }
    resumo[k].n++
    resumo[k].horas += r.horas
    resumo[k].fontes[r.fonte] = (resumo[k].fontes[r.fonte] || 0) + 1
  })

  console.log(`\n=== ${String(mes).padStart(2, '0')}/${ano}  (hoje = ${hoje}) ===`)
  Object.keys(resumo).sort().forEach(k => {
    const v = resumo[k]
    const fontes = Object.entries(v.fontes).map(([f, n]) => `${f}:${n}`).join(' ')
    console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(4)}  ${String(v.horas).padStart(6)}h   [${fontes}]`)
  })
  return resumo
}

;(async () => {
  const ago = await competencia(8, 2026, '2026-08-23')
  await competencia(7, 2026, '2026-08-01')
  await competencia(6, 2026, '2026-07-01')

  console.log('\n=== PORTAO DA FASE 0 (competencia 08/2026) ===')
  const reg = ago['Plantão | registrado'] || { n: 0, horas: 0 }
  const ava = ago['Plantão | em_avaliacao'] || { n: 0, horas: 0 }
  const falta = ago['Plantão | falta'] || { n: 0 }
  const faltaS = ago['Sobreaviso | falta'] || { n: 0 }

  const checa = (rotulo, real, esperado) => {
    const ok = real === esperado
    console.log(`  ${ok ? 'OK  ' : 'FALHOU'} ${rotulo}: ${real} (esperado ${esperado})`)
    return ok
  }

  let ok = true
  ok = checa('plantoes julgados (registrado + em_avaliacao) = 217', reg.n + ava.n, 217) && ok
  ok = checa('horas julgadas = 2107 (o total que o anexo imprime hoje)', reg.horas + ava.horas, 2107) && ok
  ok = checa('nenhuma falta de plantao nasce da migration', falta.n, 0) && ok
  ok = checa('nenhuma falta de sobreaviso nasce da migration', faltaS.n, 0) && ok
  console.log(`\n  registrado = ${reg.n} (${reg.horas}h) | em_avaliacao = ${ava.n} (${ava.horas}h)`)
  console.log(ok ? '\nPORTAO OK\n' : '\nPORTAO FALHOU - corrigir o SQL antes de aplicar\n')
  process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
