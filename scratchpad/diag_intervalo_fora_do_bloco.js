/**
 * SO LEITURA. Mede blocos cuja janela de INTERVALO cai fora do proprio bloco.
 *
 * fn_blocos_previstos_dia usa jornadas.intervalo_inicio_padrao (absoluto, ex. 12:00) mesmo para
 * um turno que comeca as 19:00 — a janela de intervalo do plantao noturno fica ANTES da entrada.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const rpc = async (f, b) => { const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text()); return r.json() }
const pag = async r0 => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + r0, { headers: { ...H, Range: `${f}-${f + 999}` } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

;(async () => {
  const em = await pag('escala_mensal?select=id,servidor_id&ano=eq.2026&mes=eq.8')
  const ids = em.map(e => e.id)
  const blocos = []
  for (let i = 0; i < ids.length; i += 40) blocos.push(...await rpc('fn_blocos_previstos_mes', { p_escala_mensal_ids: ids.slice(i, i + 40) }))
  const serv = await pag('servidores?select=id,nome')
  const SN = new Map(serv.map(s => [s.id, s.nome]))

  let fora = 0, dentro = 0
  const exemplos = []
  for (const b of blocos) {
    if (!b.permite_intervalo || !b.intervalo_inicio_previsto) continue
    const ini = new Date(b.inicio_previsto).getTime()
    const fim = new Date(b.fim_previsto).getTime()
    const iIni = new Date(b.intervalo_inicio_previsto).getTime()
    const iFim = new Date(b.intervalo_fim_previsto || b.intervalo_inicio_previsto).getTime()
    if (iIni < ini || iFim > fim) {
      fora++
      if (exemplos.length < 12) exemplos.push(
        (SN.get(b.servidor_id) || b.servidor_id) + ' dia ' + String(b.dia).padStart(2, '0') + ' ' + b.categoria +
        '  bloco ' + F(b.inicio_previsto) + '->' + F(b.fim_previsto) +
        '   intervalo ' + F(b.intervalo_inicio_previsto) + '/' + F(b.intervalo_fim_previsto))
    } else dentro++
  }
  console.log('blocos com intervalo previsto DENTRO do bloco : ' + dentro)
  console.log('blocos com intervalo previsto FORA  do bloco  : ' + fora)
  if (exemplos.length) { console.log('\nexemplos:'); for (const e of exemplos) console.log('  ' + e) }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
