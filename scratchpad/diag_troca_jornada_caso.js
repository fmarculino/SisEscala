/** SO LEITURA. Abre um caso do proxy B dia a dia, para separar troca de jornada de artefato. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
const pag = async rec => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + rec, { headers: { ...H, Range: f + '-' + (f + 999) } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }
const L = t => t ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(t)) : '-'

const ALVOS = [['69043', 6, 2026], ['69142', 6, 2026], ['69335', 7, 2026]]

;(async () => {
  for (const [matricula, mes, ano] of ALVOS) {
    const sv = (await pag(`servidores?select=id,nome,matricula&matricula=eq.${matricula}`))[0]
    if (!sv) { console.log(`\n${matricula}: servidor nao encontrado`); continue }
    const em = (await pag(`escala_mensal?select=id,jornada_id,status,jornadas(nome)&servidor_id=eq.${sv.id}&mes=eq.${mes}&ano=eq.${ano}`))[0]
    if (!em) { console.log(`\n${matricula}: sem escala em ${mes}/${ano}`); continue }
    const ed = await pag(`escala_diaria?select=dia,categoria,presenca_entrada_em,presenca_saida_em,presenca_entrada_origem,presenca_entrada_manual,dicionario_turnos(codigo)&escala_mensal_id=eq.${em.id}&order=dia`)
    console.log(`\n===== ${sv.nome} (${matricula}) — ${String(mes).padStart(2, '0')}/${ano} — jornada ${em.jornadas?.nome} — escala ${em.status} =====`)
    for (const d of ed) {
      if (!d.presenca_entrada_em && !d.presenca_saida_em) continue
      console.log(`  dia ${String(d.dia).padStart(2)} ${String(d.categoria).padEnd(9)} ${String(d.dicionario_turnos?.codigo || '-').padEnd(5)} entrada=${L(d.presenca_entrada_em).padEnd(20)} saida=${L(d.presenca_saida_em).padEnd(20)} origem=${d.presenca_entrada_origem || '-'} manual=${d.presenca_entrada_manual}`)
    }
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
