/**
 * SO LEITURA. Simula fn_alocar_marcacoes_dia com teto 1440 (hoje) x 720 (migration
 * 20260819120000), usando os blocos previstos REAIS (via RPC) e as marcacoes REAIS.
 *
 * O DP abaixo reproduz o do SQL passo a passo: mesma janela de busca, mesma dedupe por
 * v_dup_seg, mesmo custo de pular (tol*2), mesma condicao de casamento (dist <= tol) e mesmo
 * backtracking. Se divergir do SQL, a validacao nao vale nada — por isso e copia fiel, nao
 * "algo equivalente".
 */
const fs = require('fs')
const path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const rpc = async (fn, body) => { const r = await fetch(U + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const pag = async r0 => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + r0, { headers: { ...H, Range: `${f}-${f + 999}` } }); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const F = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const DUP_SEG = 60
const PRECEDENCIA = { rep: 1, terminal: 2, ajuste_coordenador: 3, ajuste_servidor: 4 }

/** Copia fiel do DP do SQL, para UMA origem. Devolve vencedor por slot. */
function alocarUmaOrigem(slots, marcacoes, tol) {
  const nS = slots.length, nM = marcacoes.length
  if (nS === 0 || nM === 0) return []
  const SKIP = tol * 2
  const custo = new Float64Array((nM + 1) * (nS + 1))
  const escolha = new Int8Array((nM + 1) * (nS + 1))
  const ix = (k, s) => k * (nS + 1) + s
  for (let k = 0; k <= nM; k++) custo[ix(k, 0)] = k * SKIP
  for (let s = 0; s <= nS; s++) custo[ix(0, s)] = s * SKIP
  for (let k = 1; k <= nM; k++) {
    for (let s = 1; s <= nS; s++) {
      const dist = Math.abs(marcacoes[k - 1].ms - slots[s - 1].ms) / 60000
      let melhor = custo[ix(k - 1, s)] + SKIP, op = 1
      if (custo[ix(k, s - 1)] + SKIP < melhor) { melhor = custo[ix(k, s - 1)] + SKIP; op = 2 }
      if (dist <= tol && custo[ix(k - 1, s - 1)] + dist < melhor) { melhor = custo[ix(k - 1, s - 1)] + dist; op = 3 }
      custo[ix(k, s)] = melhor; escolha[ix(k, s)] = op
    }
  }
  const res = []
  let k = nM, s = nS
  while (k > 0 || s > 0) {
    const op = escolha[ix(k, s)]
    if (op === 3) { res.push({ slot: s - 1, marcacao: marcacoes[k - 1] }); k--; s-- }
    else if (op === 1) k--
    else if (op === 2) s--
    else { if (k > 0) k--; if (s > 0) s-- }
  }
  return res
}

/** Roda todas as origens e aplica precedencia, como o SQL faz. */
function alocarDia(slots, todasMarcacoes, tol) {
  if (!slots.length) return {}
  const prevMs = slots.map(s => s.ms)
  const ini = Math.min(...prevMs) - tol * 60000
  const fim = Math.max(...prevMs) + tol * 60000
  const vencedor = {}
  const pesos = {}
  for (const origem of Object.keys(PRECEDENCIA)) {
    const cand = todasMarcacoes
      .filter(m => m.origem === origem && m.ms >= ini && m.ms <= fim)
      .sort((a, b) => a.ms - b.ms)
    const dedup = []
    for (const m of cand) {
      if (dedup.length && (m.ms - dedup[dedup.length - 1].ms) / 1000 < DUP_SEG) continue
      dedup.push(m)
    }
    for (const { slot, marcacao } of alocarUmaOrigem(slots, dedup, tol)) {
      const p = PRECEDENCIA[origem]
      if (pesos[slot] === undefined || p < pesos[slot]) { vencedor[slot] = marcacao; pesos[slot] = p }
    }
  }
  return vencedor
}

;(async () => {
  const em = await pag('escala_mensal?select=id,servidor_id&mes=eq.8&ano=eq.2026')
  const ids = em.map(e => e.id), M = new Map(em.map(e => [e.id, e]))
  let ed = []
  for (let i = 0; i < ids.length; i += 50)
    ed.push(...await pag(`escala_diaria?select=id,escala_mensal_id,dia,categoria,presenca_entrada_em,presenca_saida_em&escala_mensal_id=in.(${ids.slice(i, i + 50).join(',')})`))

  const comH = ed.filter(d => d.presenca_entrada_em && d.presenca_saida_em)
    .map(d => ({ ...d, h: (new Date(d.presenca_saida_em) - new Date(d.presenca_entrada_em)) / 3600000 }))
  const ruins = comH.filter(d => d.h < 0 || d.h > 26)
  const servAfetados = [...new Set(ruins.map(d => M.get(d.escala_mensal_id)?.servidor_id))]
  const diasRuins = new Set(ruins.map(d => M.get(d.escala_mensal_id)?.servidor_id + '|' + d.dia))
  const serv = await pag('servidores?select=id,nome')
  const SN = new Map(serv.map(s => [s.id, s.nome]))

  console.log(`servidores afetados: ${servAfetados.length} | dias ruins: ${diasRuins.size}\n`)

  let corrigidos = 0, aindaRuins = 0, quebrouSaudavel = 0, iguais = 0, slotsAntes=0, slotsDepois=0
  const exemplos = []

  for (const sid of servAfetados) {
    const mp = (await get(`marcacoes_ponto?select=id,ocorrido_em,origem&servidor_id=eq.${sid}&ocorrido_em=gte.2026-07-30&ocorrido_em=lt.2026-09-02&order=ocorrido_em`))
      .map(m => ({ ...m, ms: new Date(m.ocorrido_em).getTime() }))

    for (let dia = 1; dia <= 31; dia++) {
      const data = `2026-08-${String(dia).padStart(2, '0')}`
      let blocos
      try { blocos = await rpc('fn_blocos_previstos_dia', { p_servidor_id: sid, p_data: data }) } catch { continue }
      if (!blocos || !blocos.length) continue

      // slots na mesma ordem do SQL: entrada, [int_saida, int_retorno], saida
      const slots = []
      for (const b of blocos.sort((a, x) => new Date(a.inicio_previsto) - new Date(x.inicio_previsto))) {
        slots.push({ passo: 'entrada', ms: new Date(b.inicio_previsto).getTime() })
        if (b.permite_intervalo && b.intervalo_inicio_previsto) {
          slots.push({ passo: 'intervalo_saida', ms: new Date(b.intervalo_inicio_previsto).getTime() })
          slots.push({ passo: 'intervalo_retorno', ms: new Date(b.intervalo_fim_previsto || b.intervalo_inicio_previsto).getTime() })
        }
        slots.push({ passo: 'saida', ms: new Date(b.fim_previsto).getTime() })
      }

      const antes = alocarDia(slots, mp, 1440)
      const TETO = parseInt(process.env.TETO||"720",10)
      const depois = alocarDia(slots, mp, TETO)

      const pega = (v, passo) => { const i = slots.findIndex(s => s.passo === passo); return i >= 0 && v[i] ? v[i] : null }
      const eA = pega(antes, 'entrada'), sA = pega(antes, 'saida')
      const eD = pega(depois, 'entrada'), sD = pega(depois, 'saida')
      const durA = eA && sA ? (sA.ms - eA.ms) / 3600000 : null
      const durD = eD && sD ? (sD.ms - eD.ms) / 3600000 : null

      slotsAntes+=Object.keys(antes).length; slotsDepois+=Object.keys(depois).length;
      const eraRuim = diasRuins.has(sid + '|' + dia)
      const ruimAntes = durA !== null && (durA < 0 || durA > 26)
      const ruimDepois = durD !== null && (durD < 0 || durD > 26)

      if (ruimAntes && !ruimDepois) {
        corrigidos++
        if (exemplos.length < 6) exemplos.push({ nome: SN.get(sid), dia, eA, sA, durA, eD, sD, durD })
      } else if (ruimAntes && ruimDepois) aindaRuins++
      else if (!ruimAntes && ruimDepois) {
        quebrouSaudavel++
        console.log(`  !! REGRESSAO  ${SN.get(sid)} dia ${dia}: ${durA?.toFixed(1)}h -> ${durD?.toFixed(1)}h`)
      } else if (durA !== null && durD !== null &&
                 eA?.id === eD?.id && sA?.id === sD?.id) iguais++
    }
  }

  console.log('\n' + '='.repeat(64))
  console.log('  slots casados: ' + slotsAntes + ' (hoje 1440) -> ' + slotsDepois + ' (com teto)  PERDA: ' + (slotsAntes - slotsDepois))
  console.log('  dias que o teto 720 CORRIGE          :', corrigidos)
  console.log('  dias que continuam impossiveis        :', aindaRuins)
  console.log('  dias saudaveis que o teto QUEBRARIA   :', quebrouSaudavel)
  console.log('  dias com alocacao identica (sem efeito):', iguais)
  console.log('='.repeat(64))
  console.log('\nExemplos do que muda:')
  for (const e of exemplos) {
    console.log(`\n  ${e.nome} — dia ${String(e.dia).padStart(2, '0')}`)
    console.log(`    HOJE (1440): ${e.eA ? F(e.eA.ocorrido_em) : '-'} -> ${e.sA ? F(e.sA.ocorrido_em) : '-'}  (${e.durA?.toFixed(1)}h)`)
    console.log(`    COM  ( 720): ${e.eD ? F(e.eD.ocorrido_em) : '-'} -> ${e.sD ? F(e.sD.ocorrido_em) : '-'}  (${e.durD !== null ? e.durD.toFixed(1) + 'h' : 'passo vira PENDENCIA'})`)
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
