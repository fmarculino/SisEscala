/**
 * Levantamento de dano da regressao do Auto-Corrigir (commit 64d8863, 19/08/2026 02:40).
 *
 * SO LEITURA. Nao escreve nada, nao chama RPC. Rode com:
 *   node scratchpad/audita_inversao_autocorrigir.js
 *
 * O QUE PROCURA
 *   A versao de 64d8863 de normalizarHorarios ordenava as marcacoes do dia com pivo fixo nas
 *   12:00 sempre que o dia tivesse uma batida antes e outra depois do meio-dia — ou seja, em
 *   todo dia de trabalho normal. No ramo de 2 batidas isso rodava SEM guard de inversao, entao
 *   08:00 -> 17:00 era gravado como 17:00 -> 08:00, levando origem_entrada/origem_saida junto.
 *
 *   Assinatura do dia corrompido:
 *     - exatamente 2 marcacoes preenchidas (intervalo vazio) — era o ramo afetado;
 *     - entrada > saida em minutos crus;
 *     - jornada_nome que termina DEPOIS de comecar (diurna) — uma jornada diurna nunca deveria
 *       ter entrada > saida, enquanto num plantao 18H AS 06H isso e o normal.
 *
 *   O terceiro criterio e o que separa dano de dado legitimo. Sem ele, todo plantao noturno da
 *   base entraria na lista.
 *
 * PAGINACAO
 *   PostgREST corta em 1000 linhas em silencio (armadilha 8 do CLAUDE.md) — dai o header Range.
 */

const fs = require('fs')
const path = require('path')

// Carrega .env.production sem depender de dotenv
const envPath = path.join(__dirname, '..', '.env.production')
const env = {}
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Faltando NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.production')
  process.exit(1)
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

/** Deploy do commit que introduziu a regressao. Dias tocados antes disso nao vieram dela. */
const INICIO_JANELA = '2026-08-19T02:40:00-03:00'

const timeToMin = (t) => {
  if (!t || typeof t !== 'string' || !t.includes(':')) return null
  const [h, m] = t.split(':').map(Number)
  return isNaN(h) || isNaN(m) ? null : h * 60 + m
}

/** A jornada, pelo nome, termina no mesmo dia? (so ela pode denunciar inversao por entrada>saida) */
function jornadaDiurna(nome) {
  if (!nome) return false
  const m = nome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
  if (!m) return false
  const ini = parseInt(m[1], 10)
  const fim = parseInt(m[3], 10)
  return !isNaN(ini) && !isNaN(fim) && fim > ini
}

async function paginar(recurso) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL}/rest/v1/${recurso}`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const pagina = await r.json()
    out.push(...pagina)
    if (pagina.length < 1000) break
  }
  return out
}

;(async () => {
  const folhas = await paginar(
    'folha_ponto?select=id,servidor_id,mes,ano,status,ultima_edicao_em,registros,' +
      'servidores(nome,matricula),escala_mensal(unidade_id,setor_id)'
  )
  console.log(`Folhas lidas: ${folhas.length}\n`)

  const suspeitas = []
  for (const f of folhas) {
    if (!Array.isArray(f.registros)) continue
    const diasRuins = []

    for (const r of f.registros) {
      if (!r.turno_codigo || r.afastamento || r.feriado) continue
      if (r.saida_intervalo || r.retorno_intervalo) continue // o bug vivia no ramo de 2 batidas

      const e = timeToMin(r.entrada)
      const s = timeToMin(r.saida)
      if (e === null || s === null || e <= s) continue
      if (!jornadaDiurna(r.jornada_nome)) continue // plantao noturno: entrada>saida e normal

      diasRuins.push({
        dia: r.dia,
        jornada: r.jornada_nome,
        gravado: `${r.entrada} -> ${r.saida}`,
        provavel_correto: `${r.saida} -> ${r.entrada}`,
        origens: `${r.origem_entrada || '-'} / ${r.origem_saida || '-'}`,
      })
    }

    if (diasRuins.length) {
      suspeitas.push({
        folha_id: f.id,
        servidor: f.servidores?.nome,
        matricula: f.servidores?.matricula,
        competencia: `${String(f.mes).padStart(2, '0')}/${f.ano}`,
        status: f.status,
        ultima_edicao_em: f.ultima_edicao_em,
        na_janela_da_regressao: f.ultima_edicao_em >= INICIO_JANELA,
        dias: diasRuins,
      })
    }
  }

  const naJanela = suspeitas.filter((s) => s.na_janela_da_regressao)
  const fora = suspeitas.filter((s) => !s.na_janela_da_regressao)

  console.log('='.repeat(72))
  console.log(`FOLHAS COM DIA SUSPEITO: ${suspeitas.length}`)
  console.log(`  editadas apos ${INICIO_JANELA} (compativel com a regressao): ${naJanela.length}`)
  console.log(`  editadas antes (outra causa, provavelmente pre-existente):   ${fora.length}`)
  console.log(
    `TOTAL DE DIAS: ${suspeitas.reduce((a, s) => a + s.dias.length, 0)}` +
      ` (na janela: ${naJanela.reduce((a, s) => a + s.dias.length, 0)})`
  )
  console.log('='.repeat(72))

  for (const s of naJanela) {
    console.log(`\n[NA JANELA] ${s.servidor} (mat. ${s.matricula}) — ${s.competencia} — ${s.status}`)
    console.log(`  folha_id: ${s.folha_id}   ultima_edicao_em: ${s.ultima_edicao_em}`)
    for (const d of s.dias) {
      console.log(
        `    dia ${String(d.dia).padStart(2, '0')} [${d.jornada}]  gravado ${d.gravado}` +
          `  =>  provavel ${d.provavel_correto}  (origens ${d.origens})`
      )
    }
  }

  if (fora.length) {
    console.log(`\n--- fora da janela (${fora.length} folhas, conferir a parte) ---`)
    for (const s of fora) {
      console.log(
        `  ${s.servidor} — ${s.competencia} — ${s.dias.length} dia(s) — editada ${s.ultima_edicao_em}`
      )
    }
  }

  fs.writeFileSync(
    path.join(__dirname, 'resultado_inversao_autocorrigir.json'),
    JSON.stringify({ gerado_em: new Date().toISOString(), suspeitas }, null, 2)
  )
  console.log('\nDetalhe completo em scratchpad/resultado_inversao_autocorrigir.json')
})().catch((e) => {
  console.error('ERRO:', e.message)
  process.exit(1)
})
