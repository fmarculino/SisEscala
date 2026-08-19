/** SO LEITURA. Portao de seguranca: a projecao nova nao pode produzir linha com saida antes da entrada. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const rpc = async (f, b) => { const r = await fetch(U + '/rest/v1/rpc/' + f, { method: 'POST', headers: H, body: JSON.stringify(b) }); if (!r.ok) throw new Error(f + ' ' + r.status + ' ' + await r.text()); return r.json() }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

;(async () => {
  const divs = JSON.parse(fs.readFileSync(path.join(__dirname, 'portao_dono_piso_divergencias.json'), 'utf8'))
  const dias = Array.from(new Set(divs.map(d => d.servidor_id + '|' + d.data)))
  console.log('conferindo ' + dias.length + ' dias divergentes...')

  const serv = await get('servidores?select=id,nome')
  const SN = new Map(serv.map(s => [s.id, s.nome]))

  let invertidas = 0, longas = 0, ok = 0
  for (const k of dias) {
    const [sid, data] = k.split('|')
    let proj
    try { proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: sid, p_data: data }) } catch (e) { console.error('  ! ' + k + ': ' + e.message.slice(0, 90)); continue }
    for (const p of proj) {
      const passos = [p.entrada_em, p.int_saida_em, p.int_ret_em, p.saida_em].filter(Boolean).map(t => new Date(t).getTime())
      for (let i = 1; i < passos.length; i++) {
        if (passos[i] < passos[i - 1]) {
          invertidas++
          console.log('  INVERSAO ' + (SN.get(sid) || sid) + ' ' + data + ': ' +
            [p.entrada_em, p.int_saida_em, p.int_ret_em, p.saida_em].map(F).join(' '))
          break
        }
      }
      if (p.entrada_em && p.saida_em) {
        const h = (new Date(p.saida_em) - new Date(p.entrada_em)) / 3600000
        if (h > 26 || h < 0) { longas++; console.log('  DURACAO ' + h.toFixed(1) + 'h  ' + (SN.get(sid) || sid) + ' ' + data) }
        else ok++
      }
    }
  }
  console.log('\nlinhas com entrada e saida coerentes: ' + ok)
  console.log('linhas invertidas                   : ' + invertidas)
  console.log('linhas com duracao impossivel       : ' + longas)
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
