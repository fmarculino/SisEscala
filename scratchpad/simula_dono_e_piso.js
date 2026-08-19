/**
 * SO LEITURA. Simula duas regras novas em fn_alocar_marcacoes_dia sobre agosto/2026 real:
 *
 *   (A) REGRA DO DONO  - uma batida pertence ao dia cujo passo previsto esta mais proximo.
 *       Slots-sombra = passos dos blocos dos dias vizinhos que NAO entram nos slots reais.
 *       Se a sombra esta mais perto que qualquer slot real, a batida nao e candidata do dia.
 *   (B) PISO DE MEIA-NOITE - um passo nunca casa com batida anterior a meia-noite do dia
 *       civil em que o BLOCO comeca.
 *
 * O DP e copia fiel do SQL (mesmo custo de pular tol*2, mesma condicao dist <= tol,
 * mesmo backtracking) - copiado de simula_teto_alocacao.js.
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

function alocarUmaOrigem(slots, marcacoes, tol, usarPiso) {
  const nS = slots.length, nM = marcacoes.length
  if (nS === 0 || nM === 0) return []
  const SKIP = tol * 2
  const custo = new Float64Array((nM + 1) * (nS + 1)), escolha = new Int8Array((nM + 1) * (nS + 1))
  const ix = (k, s) => k * (nS + 1) + s
  for (let k = 0; k <= nM; k++) custo[ix(k, 0)] = k * SKIP
  for (let s = 0; s <= nS; s++) custo[ix(0, s)] = s * SKIP
  for (let k = 1; k <= nM; k++) for (let s = 1; s <= nS; s++) {
    const dist = Math.abs(marcacoes[k - 1].ms - slots[s - 1].ms) / 60000
    const okPiso = !usarPiso || marcacoes[k - 1].ms >= slots[s - 1].piso
    let melhor = custo[ix(k - 1, s)] + SKIP, op = 1
    if (custo[ix(k, s - 1)] + SKIP < melhor) { melhor = custo[ix(k, s - 1)] + SKIP; op = 2 }
    if (dist <= tol && okPiso && custo[ix(k - 1, s - 1)] + dist < melhor) { melhor = custo[ix(k - 1, s - 1)] + dist; op = 3 }
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

function alocarDia(slots, sombras, todas, tol, novo) {
  if (!slots.length) return {}
  const prev = slots.map(s => s.ms)
  const ini = Math.min.apply(null, prev) - tol * 60000, fim = Math.max.apply(null, prev) + tol * 60000
  const vencedor = {}, pesos = {}
  for (const origem of Object.keys(PRECEDENCIA)) {
    let cand = todas.filter(m => m.origem === origem && m.ms >= ini && m.ms <= fim).sort((a, b) => a.ms - b.ms)
    if (novo && sombras.length) {
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
    for (const par of alocarUmaOrigem(slots, dedup, tol, novo)) {
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
  console.log('escalas mensais 07-09/2026:', ids.length)
  const blocos = []
  for (let i = 0; i < ids.length; i += 40) {
    blocos.push.apply(blocos, await rpc('fn_blocos_previstos_mes', { p_escala_mensal_ids: ids.slice(i, i + 40) }))
  }
  console.log('blocos previstos:', blocos.length)
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
  console.log('servidores com bloco previsto:', servidores.length)

  const desloca = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

  let mudou = 0, dupAntes = 0, dupDepois = 0, ruimAntes = 0, ruimDepois = 0, perdeuBoa = 0
  const exemplos = [], perdas = [], restantes = []

  for (const sid of servidores) {
    const mp = (await pag('marcacoes_ponto?select=id,ocorrido_em,origem&servidor_id=eq.' + sid + '&ocorrido_em=gte.2026-07-30&ocorrido_em=lt.2026-09-02&order=ocorrido_em'))
      .map(m => ({ id: m.id, ocorrido_em: m.ocorrido_em, origem: m.origem, ms: new Date(m.ocorrido_em).getTime() }))
    if (!mp.length) continue
    const usoAntes = new Map(), usoDepois = new Map()

    for (let dia = 1; dia <= 31; dia++) {
      const data = '2026-08-' + String(dia).padStart(2, '0')
      const mn = new Date(data + 'T00:00:00-03:00').getTime()
      const bHoje = porDia.get(sid + '|' + data) || []
      const bOntem = porDia.get(sid + '|' + desloca(data, -1)) || []
      const bAmanha = porDia.get(sid + '|' + desloca(data, 1)) || []
      const reais = bOntem.filter(b => new Date(b.fim_previsto).getTime() > mn).concat(bHoje)
      if (!reais.length) continue
      const sombraBlocos = bOntem.filter(b => new Date(b.fim_previsto).getTime() <= mn).concat(bAmanha)
      const slots = slotsDe(reais), sombras = slotsDe(sombraBlocos)

      const A = alocarDia(slots, sombras, mp, TETO, false)
      const B = alocarDia(slots, sombras, mp, TETO, true)

      // duplicacao REAL = mesma batida gravada em linhas/passos diferentes de escala_diaria.
      // Um bloco que cruza a meia-noite aparece na alocacao de dois p_data, mas escreve
      // sempre nas MESMAS linhas - por isso a chave e escala_diaria_ids + passo, nao a data.
      for (const i of Object.keys(A)) { const m = A[i]; if (!usoAntes.has(m.id)) usoAntes.set(m.id, new Set()); usoAntes.get(m.id).add(slots[i].ed + '#' + slots[i].passo) }
      for (const i of Object.keys(B)) { const m = B[i]; if (!usoDepois.has(m.id)) usoDepois.set(m.id, new Set()); usoDepois.get(m.id).add(slots[i].ed + '#' + slots[i].passo) }

      const pega = (v, p) => { const i = slots.findIndex(s => s.passo === p); return i >= 0 && v[i] ? v[i] : null }
      const eA = pega(A, 'entrada'), sA = pega(A, 'saida'), eB = pega(B, 'entrada'), sB = pega(B, 'saida')
      const dur = (e, s) => e && s ? (s.ms - e.ms) / 3600000 : null
      const durA = dur(eA, sA), durB = dur(eB, sB)
      if (durA !== null && (durA < 0 || durA > 26)) ruimAntes++
      if (durB !== null && (durB < 0 || durB > 26)) ruimDepois++

      const chave = v => slots.map((s, i) => v[i] ? v[i].id : '-').join('|')
      if (chave(A) !== chave(B)) {
        mudou++
        for (let i = 0; i < slots.length; i++) {
          if (A[i] && !B[i]) {
            const d = Math.abs(A[i].ms - slots[i].ms) / 60000
            if (d <= 120) { perdeuBoa++; if (perdas.length < 12) perdas.push({ nome: SN.get(sid), data, passo: slots[i].passo, marc: F(A[i].ocorrido_em), prev: F(slots[i].ms), d }) }
          }
        }
        if (exemplos.length < 12) exemplos.push({ nome: SN.get(sid), data, eA, sA, durA, eB, sB, durB })
      }
    }
    for (const par of usoAntes) if (par[1].size > 1) dupAntes++
    for (const par of usoDepois) if (par[1].size > 1) {
      dupDepois++
      if (restantes.length < 10) restantes.push({ nome: SN.get(sid), marc: par[0], onde: Array.from(par[1]) })
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('  batida usada em 2 PASSOS/LINHAS     antes :', dupAntes)
  console.log('  batida usada em 2 PASSOS/LINHAS     depois:', dupDepois)
  console.log('  dias com duracao impossivel         antes :', ruimAntes)
  console.log('  dias com duracao impossivel         depois:', ruimDepois)
  console.log('  dias em que a alocacao muda               :', mudou)
  console.log('  alocacoes PLAUSIVEIS (<=120min) perdidas  :', perdeuBoa)
  console.log('='.repeat(70))
  if (restantes.length) {
    console.log('\nDUPLICACOES QUE RESTAM (mesma batida em 2 passos):')
    for (const r of restantes) { console.log('  ' + r.nome + ' ' + r.marc); for (const o of r.onde) console.log('        ' + o) }
  }
  if (perdas.length) { console.log('\nPERDAS PLAUSIVEIS (revisar uma a uma):'); for (const p of perdas) console.log('  ' + p.nome + ' ' + p.data + ' ' + p.passo + ': batida ' + p.marc + ' x previsto ' + p.prev + ' (' + p.d.toFixed(0) + ' min)') }
  console.log('\nExemplos do que muda:')
  for (const e of exemplos) {
    console.log('\n  ' + e.nome + ' — ' + e.data)
    console.log('    HOJE : ' + (e.eA ? F(e.eA.ocorrido_em) : '-') + ' -> ' + (e.sA ? F(e.sA.ocorrido_em) : '-') + '  (' + (e.durA !== null ? e.durA.toFixed(1) + 'h' : '-') + ')')
    console.log('    NOVO : ' + (e.eB ? F(e.eB.ocorrido_em) : '-') + ' -> ' + (e.sB ? F(e.sB.ocorrido_em) : '-') + '  (' + (e.durB !== null ? e.durB.toFixed(1) + 'h' : '-') + ')')
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
