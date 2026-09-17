// Roda a montagem da apuracao sobre os dados REAIS dos 4 medicos do Mais Medicos.
//
// E a medicao obrigatoria da Fase 2 (plano, §7): se a montagem divergir do recorte medido,
// e defeito de montagem — e esta e a unica fase em que ele e barato de achar.
//
// Transpile antes:
//   npx tsc src/utils/folha/apuracaoPeriodo.ts --outDir scratchpad/_sim --module commonjs --target es2020 --skipLibCheck
//
// Uso: node scratchpad/an_apuracao_mais_medicos.mjs [mes] [ano]
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const A = require('./_sim/apuracaoPeriodo.js')
const P = require('./_sim/periodoApuracao.js')

const env = Object.fromEntries(fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const j = async u => (await fetch(u, { headers: H })).json()

const MES = Number(process.argv[2] || 9)
const ANO = Number(process.argv[3] || 2026)
const MM = 'a465e8bd-c455-440b-840b-b94483a13d2a'

// As vigencias das regras de folha, do banco — nunca o default do codigo.
const cfg = await j(`${U}/rest/v1/configuracoes_globais?select=chave,valor&chave=in.(horas_normais_liquidas_desde,compensacao_atraso_vigente_desde,autorizacao_extra_vigente_desde,competencias_encerradas)`)
const val = c => { const x = cfg.find(k => k.chave === c)?.valor; return typeof x === 'string' ? x : x }
const OPC = {
  horasLiquidasDesde: val('horas_normais_liquidas_desde'),
  compensacaoVigenteDesde: val('compensacao_atraso_vigente_desde'),
  autorizacaoExtraVigenteDesde: val('autorizacao_extra_vigente_desde'),
  competenciasEncerradas: (val('competencias_encerradas') || []).map(c => ({ mes: c.mes, ano: c.ano })),
}
console.log('vigencias lidas do banco:', JSON.stringify({
  horasLiquidasDesde: OPC.horasLiquidasDesde,
  compensacaoVigenteDesde: OPC.compensacaoVigenteDesde,
  autorizacaoExtraVigenteDesde: OPC.autorizacaoExtraVigenteDesde,
  encerradas: OPC.competenciasEncerradas.map(c => `${c.mes}/${c.ano}`),
}))

// O regime de cada servidor vem do BANCO (fn_periodo_apuracao_servidor), nunca recalculado aqui.
const srv = await j(`${U}/rest/v1/servidores?select=id,matricula,nome&setor_id=eq.${MM}&order=matricula`)

// As competencias que podem entrar: a do periodo e a anterior.
const ant = P.competenciaAnterior(MES, ANO)
const compsFiltro = `(${MES},${ant.mes})`
const anosFiltro = ANO === ant.ano ? `${ANO}` : `${ANO},${ant.ano}`

const fmt = m => `${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`

let divergencias = 0

for (const s of srv) {
  const { regime_id, regime_nome, inicio, fim, atravessa_mes } =
    (await (await fetch(`${U}/rest/v1/rpc/fn_periodo_apuracao_servidor`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_servidor_id: s.id, p_mes: MES, p_ano: ANO })
    })).json())[0]

  // A janela vem do banco; o TS so confere que o espelho concorda.
  const regime = (await j(`${U}/rest/v1/folha_regimes?select=id,nome,dia_corte&id=eq.${regime_id}`))[0]
  const janelaBanco = P.janelaDoPeriodo(regime, MES, ANO)
  const espelhoOk = janelaBanco.inicio === inicio && janelaBanco.fim === fim
  if (!espelhoOk) divergencias++

  // ENSAIO: com --corte20, monta como SE o servidor estivesse no regime 21->20, sem escrever
  // nada. E a unica forma de exercitar o caso real antes de alguem atribuir o regime na tela —
  // e e ele que prova a soma por metade contra dado de producao.
  const forcar20 = process.argv.includes('--corte20')
  const regimeUsado = forcar20
    ? (await j(`${U}/rest/v1/folha_regimes?select=id,nome,dia_corte&dia_corte=eq.20`))[0]
    : regime
  const janela = forcar20 ? P.janelaDoPeriodo(regimeUsado, MES, ANO) : janelaBanco

  const folhasRaw = await j(
    `${U}/rest/v1/folha_ponto?select=id,mes,ano,status,registros,escala_mensal_id,`
    + `escala_mensal(unidades(nome),setores(dicionario_setores(nome)),jornadas(nome,horas_totais,intervalo_minutos))`
    + `&servidor_id=eq.${s.id}&ano=in.(${anosFiltro})&mes=in.${compsFiltro}`
  )

  const folhas = (folhasRaw || []).map(f => {
    const em = f.escala_mensal
    const setor = Array.isArray(em?.setores) ? em.setores[0] : em?.setores
    const dic = setor ? (Array.isArray(setor.dicionario_setores) ? setor.dicionario_setores[0] : setor.dicionario_setores) : null
    const jor = Array.isArray(em?.jornadas) ? em.jornadas[0] : em?.jornadas
    const uni = Array.isArray(em?.unidades) ? em.unidades[0] : em?.unidades
    return {
      id: f.id, mes: f.mes, ano: f.ano, status: f.status, registros: f.registros || [],
      escala_mensal_id: f.escala_mensal_id,
      unidade_nome: uni?.nome || null,
      setor_nome: dic?.nome || null,
      jornada: jor || null,
    }
  })

  const r = A.montarApuracao(janela, folhas, OPC)

  console.log(`\n${'='.repeat(78)}`)
  console.log(`${s.matricula}  ${s.nome}`)
  console.log(`regime no banco: ${regime_nome} | janela: ${inicio} a ${fim}`
    + ` | espelho TS: ${espelhoOk ? 'concorda' : 'DIVERGE (' + janelaBanco.inicio + ' a ' + janelaBanco.fim + ')'}`
    + ` | atravessa: ${atravessa_mes}`)
  if (forcar20) {
    console.log(`ENSAIO com "${regimeUsado.nome}" (nada foi gravado): `
      + `${janela.inicio} a ${janela.fim}`)
  }

  for (const m of r.metades) {
    console.log(
      `  ${m.competencia}: dias ${m.diaInicio}..${m.diaFim}`
      + ` | ${m.diasComRegistro}/${m.diasNoPeriodo} com linha`
      + ` | ${m.horasNormaisPorDia}h/dia (${m.descontaIntervalo ? 'liquido' : 'vao bruto'})`
      + ` | jornada ${m.jornadaNome || '(sem)'}`
      + ` | folha ${m.folhas.map(f => f.status).join(',') || 'NENHUMA'}`
      + `${m.congelada ? ' | CONGELADA' : ''}`
      + `${m.totais ? ` | normais ${fmt(m.totais.normaisMinutos)} extra50 ${fmt(m.totais.extra50Minutos)}` : ''}`
    )
  }

  console.log(`  TOTAL do periodo: normais ${fmt(r.totais.normaisMinutos)}`
    + ` | extra 50% ${fmt(r.totais.extra50Minutos)} | extra 100% ${fmt(r.totais.extra100Minutos)}`
    + ` | atraso ${fmt(r.totais.atrasoMinutos)} | abono ${fmt(r.totais.abonoMinutos)}`
    + ` | faltas ${r.totais.faltas}`)

  // A conta que o documento NAO deve fazer: uma regua so para o periodo inteiro.
  //
  // ⚠️ O divisor e DIA COM TURNO, nunca dia com linha na folha: `diasComRegistro` conta as 31
  // linhas do periodo (inclusive folga e fim de semana), e usa-lo aqui inflaria a diferenca de
  // 12h para 100h. Numero errado em script de medicao e o que produz relatorio falso.
  if (r.metades.length === 2 && r.metades.every(m => m.totais)) {
    const [m1, m2] = r.metades
    if (m1.horasNormaisPorDia !== m2.horasNormaisPorDia) {
      const diasTurno = m =>
        m.horasNormaisPorDia > 0 ? m.totais.normaisMinutos / (m.horasNormaisPorDia * 60) : 0
      const totalDiasTurno = diasTurno(m1) + diasTurno(m2)
      const errado = totalDiasTurno * m2.horasNormaisPorDia * 60
      console.log(`  >>> ${totalDiasTurno} dia(s) com turno.`
        + ` Com a regua de ${m2.competencia} para todos (${m2.horasNormaisPorDia}h/dia):`
        + ` ${fmt(errado)} — o documento perderia ${fmt(r.totais.normaisMinutos - errado)}`)
    }
  }

  for (const l of r.lacunas) console.log(`  LACUNA  ${l.descricao}`)
  for (const p of r.pendencias) {
    console.log(`  PENDENTE ${p.competencia} ${p.tipo}: dia(s) ${p.dias.join(', ')}`)
  }
  if (r.lotacoes.length > 1) {
    console.log('  LOTACAO muda: ' + r.lotacoes.map(l => `${l.setor_nome} (${l.competencia})`).join(' -> '))
  }
  const conf = A.requerConfirmacao(r)
  console.log(`  emitir exige confirmacao? ${conf.precisa ? 'SIM' : 'nao'}`
    + (conf.precisa ? ' -> ' + conf.motivos.join(' | ') : ''))
}

console.log(`\n${'='.repeat(78)}`)
console.log(divergencias === 0
  ? 'OK: o espelho TypeScript concorda com a janela do banco em todos os servidores.'
  : `REPROVADO: ${divergencias} servidor(es) com janela divergente entre banco e TypeScript.`)
process.exit(divergencias === 0 ? 0 : 1)
