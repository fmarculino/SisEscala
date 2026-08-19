/**
 * SO LEITURA. Compara variantes de fn_alocar_marcacoes_dia sobre agosto/2026 real.
 *
 *   V0  hoje              : teto 720, custo de pular = tol*2 (1440)
 *   V1  + piso            : passo nunca casa com batida anterior a meia-noite do dia
 *                           civil em que o BLOCO comeca
 *   V2  + dono            : batida cujo passo previsto mais proximo pertence a um bloco de
 *                           dia VIZINHO (que nao entra nos slots deste dia) nao e candidata
 *   V3  + pular = teto/2  : o custo de deixar de casar deixa de ser sempre maior que o pior
 *                           casamento possivel, entao casar mal para de compensar
 *
 * O DP e copia fiel do SQL (mesma janela de busca, mesma dedupe, mesmo backtracking).
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const rpc = async (fn, b) => { const r = await fetch(U + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(fn + ' ' + r.status + ' ' + await r.text()); return r.json() }
const pag = async r0 => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + r0, { headers: { ...H, Range: `${f}-${f + 999}` } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const F = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const TZ = 'America/Sao_Paulo'
const diaCivil = ms => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
const meiaNoiteDe = ms => new Date(diaCivil(ms) + 'T00:00:00-03:00').getTime()

const DUP_SEG = 60, TETO = 720
const PRECEDENCIA = { rep: 1, terminal: 2, ajuste_coordenador: 3, ajuste_servidor: 4 }

const VARIANTES = {
  V0: { piso: false, dono: false, skip: TETO * 2 },
  V1: { piso: true, dono: false, skip: TETO * 2 },
  V2: { piso: true, dono: true, skip: TETO * 2 },
  V3: { piso: true, dono: true, skip: TETO / 2 },
}

function alocarUmaOrigem(slots, marcacoes, cfg) {
  const nS = slots.length, nM = marcacoes.length
  if (nS === 0 || nM === 0) return []
  const SKIP = cfg.skip
  const custo = new Float64Array((nM + 1) * (nS + 1)), escolha = new Int8Array((nM + 1) * (nS + 1))
  const ix = (k, s) => k * (nS + 1) + s
  for (let k = 0; k <= nM; k++) custo[ix(k, 0)] = k * SKIP
  for (let s = 0; s <= nS; s++) custo[ix(0, s)] = s * SKIP
  for (let k = 1; k <= nM; k++) for (let s = 1; s <= nS; s++) {
    const dist = Math.abs(marcacoes[k - 1].ms - slots[s - 1].ms) / 60000
    const okPiso = !cfg.piso || marcacoes[k - 1].ms >= slots[s - 1].piso
    let melhor = custo[ix(k - 1, s)] + SKIP, op = 1
    if (custo[ix(k, s - 1)] + SKIP < melhor) { melhor = custo[ix(k, s - 1)] + SKIP; op = 2 }
    if (dist <= TETO && okPiso && custo[ix(k - 1, s - 1)] + dist < melhor) { melhor = custo[ix(k - 1, s - 1)] + dist; op = 3 }
    custo[ix(k, s)] = melhor; escolha[ix(k, s)] = op
  }
  const res = []; let k = nM, s = nS
  while (k > 0 || s > 0) {
    const op = escolha[ix(k, s)]
    if (op === 3) { res.push({ slot: s - 1, marcacao: marcacoes[k - 1] }); k--; s-- }
    else if (op === 1) k--; else if (op === 2) s--; else { if (k > 0) k--; if (s > 0) s-- }
  }
  return res
}

function alocarDia(slots, sombras, todas, cfg) {
  if (!slots.length) return {}
  const prev = slots.map(s => s.ms)
  const ini = Math.min.apply(null, prev) - TETO * 60000, fim = Math.max.apply(null, prev) + TETO * 60000
  const vencedor = {}, pesos = {}
  for (const origem of Object.keys(PRECEDENCIA)) {
    let cand = todas.filter(m => m.origem === origem && m.ms >= ini && m.ms <= fim).sort((a, b) => a.ms - b.ms)
    if (cfg.dono && sombras.length) {
      cand = cand.filter(m => {
        let dR = Infinity, tR = null
        for (const s of slots) { const d = Math.abs(m.ms - s.ms); if (d < dR) { dR = d; tR = s.ms } }
        let dS = Infinity, tS = null
        for (const s of sombras) { const d = Math.abs(m.ms - s.ms); if (d < dS) { dS = d; tS = s.ms } }
        if (dS < dR) return false
        if (dS === dR && tS < tR) return false
        return true
      })
    }
    const dedup = []
    for (const m of cand) { if (dedup.length && (m.ms - dedup[dedup.length - 1].ms) / 1000 < DUP_SEG) continue; dedup.push(m) }
    for (const par of alocarUmaOrigem(slots, dedup, cfg)) {
      const p = PRECEDENCIA[origem]
      if (pesos[par.slot] === undefined || p < pesos[par.slot]) { vencedor[par.slot] = par.marcacao; pesos[par.slot] = p }
    }
  }
  return vencedor
}

function slotsDe(blocos) {
  const out = []
  const ord = blocos.slice().sort((a, x) => new Date(a.inicio_previsto) - new Date(x.inicio_previsto))
  for (const b of ord) {
    const piso = meiaNoiteDe(new Date(b.inicio_previsto).getTime())
    const ed = (b.escala_diaria_ids || []).slice().sort().join(',')
    out.push({ passo: 'entrada', ms: new Date(b.inicio_previsto).getTime(), piso, ed })
    if (b.permite_intervalo && b.intervalo_inicio_previsto) {
      out.push({ passo: 'intervalo_saida', ms: new Date(b.intervalo_inicio_previsto).getTime(), piso, ed })
      out.push({ passo: 'intervalo_retorno', ms: new Date(b.intervalo_fim_previsto || b.intervalo_inicio_previsto).getTime(), piso, ed })
    }
    out.push({ passo: 'saida', ms: new Date(b.fim_previsto).getTime(), piso, ed })
  }
  return out
}

;(async () => {
  const em = await pag('escala_mensal?select=id,servidor_id,mes,ano&ano=eq.2026&mes=in.(7,8,9)')
  const ids = em.map(e => e.id)
  const blocos = []
  for (let i = 0; i < ids.length; i += 40) blocos.push.apply(blocos, await rpc('fn_blocos_previstos_mes', { p_escala_mensal_ids: ids.slice(i, i + 40) }))
  const EM = new Map(em.map(e => [e.id, e]))
  const porDia = new Map()
  for (const b of blocos) {
    const e = EM.get(b.escala_mensal_id); if (!e) continue
    const k = b.servidor_id + '|' + e.ano + '-' + String(e.mes).padStart(2, '0') + '-' + String(b.dia).padStart(2, '0')
    if (!porDia.has(k)) porDia.set(k, [])
    porDia.get(k).push(b)
  }
  const servidores = Array.from(new Set(blocos.map(b => b.servidor_id)))
  const serv = await pag('servidores?select=id,nome')
  const SN = new Map(serv.map(s => [s.id, s.nome]))
  console.log('servidores: ' + servidores.length + ' | blocos previstos: ' + blocos.length + '\n')

  const desloca = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const NOMES = Object.keys(VARIANTES)
  const DIF23 = []
  const stat = {}
  for (const v of NOMES) stat[v] = { dup: 0, ruim: 0, mudou: 0, perdeuBoa: 0, perdas: [], dups: [] }

  for (const sid of servidores) {
    const mp = (await pag('marcacoes_ponto?select=id,ocorrido_em,origem&servidor_id=eq.' + sid + '&ocorrido_em=gte.2026-07-30&ocorrido_em=lt.2026-09-02&order=ocorrido_em'))
      .map(m => ({ id: m.id, ocorrido_em: m.ocorrido_em, origem: m.origem, ms: new Date(m.ocorrido_em).getTime() }))
    if (!mp.length) continue
    const uso = {}; for (const v of NOMES) uso[v] = new Map()

    for (let dia = 1; dia <= 31; dia++) {
      const data = '2026-08-' + String(dia).padStart(2, '0')
      const mn = new Date(data + 'T00:00:00-03:00').getTime()
      const bHoje = porDia.get(sid + '|' + data) || []
      const bOntem = porDia.get(sid + '|' + desloca(data, -1)) || []
      const bAmanha = porDia.get(sid + '|' + desloca(data, 1)) || []
      const reais = bOntem.filter(b => new Date(b.fim_previsto).getTime() > mn).concat(bHoje)
      if (!reais.length) continue
      const slots = slotsDe(reais)
      const sombras = slotsDe(bOntem.filter(b => new Date(b.fim_previsto).getTime() <= mn).concat(bAmanha))

      const res = {}
      for (const v of NOMES) res[v] = alocarDia(slots, sombras, mp, VARIANTES[v])
      const chave = x => slots.map((s, i) => x[i] ? x[i].id : '-').join('|')
      const pega = (x, p) => { const i = slots.findIndex(s => s.passo === p); return i >= 0 && x[i] ? x[i] : null }

      for (const v of NOMES) {
        const R = res[v]
        for (const i of Object.keys(R)) {
          const m = R[i]
          if (!uso[v].has(m.id)) uso[v].set(m.id, new Set())
          uso[v].get(m.id).add(slots[i].ed + '#' + slots[i].passo)
        }
        const e = pega(R, 'entrada'), s = pega(R, 'saida')
        const dur = e && s ? (s.ms - e.ms) / 3600000 : null
        if (dur !== null && (dur < 0 || dur > 26)) stat[v].ruim++
        if (v === 'V3' && chave(res.V2) !== chave(res.V3) && DIF23.length < 25) {
          DIF23.push('  ' + SN.get(sid) + ' ' + data + '\n' +
            '      V2: ' + slots.map((s, i) => s.passo.slice(0, 5) + '=' + (res.V2[i] ? F(res.V2[i].ocorrido_em) : '-')).join('  ') + '\n' +
            '      V3: ' + slots.map((s, i) => s.passo.slice(0, 5) + '=' + (res.V3[i] ? F(res.V3[i].ocorrido_em) : '-')).join('  '))
        }
        if (v !== 'V0' && chave(res.V0) !== chave(R)) {
          stat[v].mudou++
          for (let i = 0; i < slots.length; i++) {
            if (res.V0[i] && !R[i]) {
              const d = Math.abs(res.V0[i].ms - slots[i].ms) / 60000
              if (d <= 120) {
                stat[v].perdeuBoa++
                if (stat[v].perdas.length < 8) stat[v].perdas.push(SN.get(sid) + ' ' + data + ' ' + slots[i].passo + ': batida ' + F(res.V0[i].ocorrido_em) + ' x previsto ' + F(slots[i].ms) + ' (' + d.toFixed(0) + ' min)')
              }
            }
          }
        }
      }
    }
    for (const v of NOMES) for (const par of uso[v]) if (par[1].size > 1) {
      stat[v].dup++
      if (stat[v].dups.length < 6) stat[v].dups.push({ nome: SN.get(sid), marc: par[0], onde: Array.from(par[1]) })
    }
  }

  console.log('variante | dup | dias impossiveis | dias que mudam | boas perdidas')
  for (const v of NOMES) {
    const s = stat[v]
    console.log('   ' + v + '    | ' + String(s.dup).padStart(3) + ' | ' + String(s.ruim).padStart(16) + ' | ' + String(s.mudou).padStart(14) + ' | ' + String(s.perdeuBoa).padStart(13))
  }
  for (const v of NOMES) {
    if (!stat[v].perdas.length) continue
    console.log('\n' + v + ' - alocacoes plausiveis perdidas:')
    for (const p of stat[v].perdas) console.log('   ' + p)
  }
  console.log('\nV2 x V3 - dias em que diferem:')
  for (const d of DIF23) console.log(d)
  const alvo = process.env.DETALHE || 'V3'
  console.log('\n' + alvo + ' - duplicacoes que restam:')
  for (const d of stat[alvo].dups) { console.log('  ' + d.nome + ' ' + d.marc); for (const o of d.onde) console.log('        ' + o) }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
