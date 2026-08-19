/**
 * SO LEITURA. Portao da correcao dos totais da folha (entrega 2b).
 *
 * O recalculo de totais em salvarFolhaPonto e autoCorrigirFolhaPonto usa horas_totais da
 * jornada do MES para todo dia com turno, ignorando a vigencia por data - enquanto o registro
 * de cada dia ja grava jornada_nome resolvido corretamente. Servidor com jornada reduzida por
 * vigencia tem o total contado pela jornada cheia.
 *
 * Mede duas coisas antes de mexer:
 *   1. jornada_nome serve como chave? (nomes duplicados em jornadas quebrariam a resolucao)
 *   2. quais folhas mudam de total, e em quanto.
 */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }
const pag = async rec => { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(U + '/rest/v1/' + rec, { headers: { ...H, Range: f + '-' + (f + 999) } }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); const p = await r.json(); o.push(...p); if (p.length < 1000) break } return o }

;(async () => {
  const jor = await pag('jornadas?select=id,nome,horas_totais,ativo')
  const porNome = {}
  jor.forEach(j => (porNome[j.nome] = porNome[j.nome] || []).push(j))
  const dup = Object.entries(porNome).filter(([, v]) => v.length > 1)
  console.log('=== 1. jornada_nome serve como chave? ===')
  console.log('jornadas:', jor.length, '| nomes distintos:', Object.keys(porNome).length)
  if (dup.length) {
    console.log('NOMES DUPLICADOS (resolucao por nome seria ambigua):')
    dup.forEach(([n, v]) => console.log(`  "${n}" -> ${v.map(x => `${x.horas_totais}h${x.ativo ? '' : ' (inativa)'}`).join(' | ')}`))
  } else {
    console.log('sem duplicatas: resolver por nome e seguro')
  }
  console.log('horas por jornada:', JSON.stringify(Object.fromEntries(jor.map(j => [j.nome, j.horas_totais]))))

  console.log('\n=== 2. folhas afetadas pela vigencia ===')
  const jt = await pag('servidores_jornadas_temporarias?select=servidor_id,jornada_id,data_inicio,data_fim,motivo')
  const servIds = [...new Set(jt.map(r => r.servidor_id))]
  const serv = await pag(`servidores?select=id,nome,matricula&id=in.(${servIds.join(',')})`)
  const S = new Map(serv.map(s => [s.id, s]))
  const J = new Map(jor.map(j => [j.id, j]))

  const folhas = await pag(`folha_ponto?select=id,servidor_id,mes,ano,status,total_horas_normais,registros,escala_mensal(jornada_id)&servidor_id=in.(${servIds.join(',')})`)
  console.log('folhas desses servidores:', folhas.length)

  for (const f of folhas) {
    const regs = Array.isArray(f.registros) ? f.registros : []
    const jMes = J.get(f.escala_mensal?.jornada_id)
    const horasMes = jMes?.horas_totais ?? 8
    let atual = 0, corrigido = 0, diasComVigencia = 0
    for (const r of regs) {
      if (!r.turno_codigo) continue
      atual += horasMes
      const jDia = r.jornada_nome ? (porNome[r.jornada_nome] || [])[0] : null
      const h = jDia?.horas_totais ?? horasMes
      corrigido += h
      if (r.jornada_temporaria) diasComVigencia++
    }
    const s = S.get(f.servidor_id)
    const delta = +(corrigido - atual).toFixed(2)
    const flag = Math.abs(delta) > 0.001 ? '  <<< MUDA' : ''
    console.log(`  ${String(f.mes).padStart(2, '0')}/${f.ano} ${(s?.matricula || '?').padEnd(8)} ${(s?.nome || '?').slice(0, 26).padEnd(26)} status=${String(f.status).padEnd(9)} jornada_mes=${(jMes?.nome || '-').padEnd(13)} dias_vigencia=${String(diasComVigencia).padStart(2)} gravado=${f.total_horas_normais} recalc_atual=${atual.toFixed(2)} corrigido=${corrigido.toFixed(2)} delta=${delta}${flag}`)
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
