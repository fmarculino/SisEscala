/** SO LEITURA. Classifica as divergencias do portao antes de escrever nada. */
const fs = require('fs'), path = require('path')
const env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = env.NEXT_PUBLIC_SUPABASE_URL
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const get = async q => { const r = await fetch(U + '/rest/v1/' + q, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json() }
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

const CAMPO = {
  entrada: 'entrada', intervalo_saida: 'intervalo_saida',
  intervalo_retorno: 'intervalo_retorno', saida: 'saida',
}

;(async () => {
  const divs = JSON.parse(fs.readFileSync(path.join(__dirname, 'portao_dono_piso_divergencias.json'), 'utf8'))
  const ids = Array.from(new Set(divs.map(d => d.escala_diaria_id)))
  const ed = []
  for (let i = 0; i < ids.length; i += 40) {
    ed.push(...await get('escala_diaria?select=id,dia,categoria,presenca_entrada_origem,presenca_intervalo_saida_origem,presenca_intervalo_retorno_origem,presenca_saida_origem,presenca_entrada_manual,presenca_intervalo_saida_manual,presenca_intervalo_retorno_manual,presenca_saida_manual,confirmacao_manual&id=in.(' + ids.slice(i, i + 40).join(',') + ')'))
  }
  const ED = new Map(ed.map(e => [e.id, e]))

  // 1. o que se perde, por origem do valor gravado hoje
  const perde = {}
  const perdeManual = []
  for (const d of divs) {
    if (d.tipo_divergencia !== 'ausente_na_projecao') continue
    const e = ED.get(d.escala_diaria_id) || {}
    const o = e['presenca_' + CAMPO[d.campo] + '_origem'] || '(sem origem)'
    perde[o] = (perde[o] || 0) + 1
    if (o === 'ajuste_coordenador' || o === 'ajuste_servidor') perdeManual.push({ ...d, origem: o })
  }
  console.log('AUSENTE_NA_PROJECAO (o valor gravado seria APAGADO) — por origem atual:')
  for (const k of Object.keys(perde).sort()) console.log('   ' + k.padEnd(22) + perde[k])

  // 2. horario_diferente: quem estava mais perto do previsto, o gravado ou o projetado?
  //    usa a propria distancia ao passo previsto nao disponivel aqui; entao so lista trocas
  //    em que o gravado e de OUTRO dia civil (o bug) x mesmo dia (merece olhar).
  const diaDe = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(t))
  let outroDia = 0, mesmoDia = 0
  const mesmoDiaEx = []
  for (const d of divs) {
    if (d.tipo_divergencia !== 'horario_diferente') continue
    if (diaDe(d.valor_atual) !== d.data) outroDia++
    else { mesmoDia++; if (mesmoDiaEx.length < 15) mesmoDiaEx.push(d) }
  }
  console.log('\nHORARIO_DIFERENTE (' + (outroDia + mesmoDia) + '):')
  console.log('   gravado era de OUTRO dia civil (o bug) : ' + outroDia)
  console.log('   gravado era do MESMO dia (revisar)     : ' + mesmoDia)
  for (const d of mesmoDiaEx) console.log('      ' + d.nome + ' ' + d.data + ' ' + d.campo.padEnd(18) + F(d.valor_atual) + ' -> ' + F(d.valor_projetado))

  // 3. dias que ficam SEM nenhuma presenca projetada (a batida sai e nao volta em lugar nenhum)
  const porDia = new Map()
  for (const d of divs) {
    const k = d.servidor_id + '|' + d.data + '|' + d.nome
    if (!porDia.has(k)) porDia.set(k, [])
    porDia.get(k).push(d)
  }
  const zerados = []
  for (const [k, lista] of porDia) {
    const temProjetado = lista.some(d => d.valor_projetado)
    const eraTudoAusente = lista.every(d => d.tipo_divergencia === 'ausente_na_projecao')
    if (eraTudoAusente && !temProjetado) zerados.push({ k, lista })
  }
  console.log('\nDIAS QUE PERDEM TODA A PRESENCA (nada projetado no lugar): ' + zerados.length)
  for (const z of zerados.slice(0, 20)) {
    const [, data, nome] = z.k.split('|')
    console.log('   ' + nome + ' ' + data + ': ' + z.lista.map(d => d.campo + '=' + F(d.valor_atual)).join('  '))
  }

  if (perdeManual.length) {
    console.log('\n!! APAGARIA HORARIO DE ORIGEM MANUAL (decisao de coordenador/servidor): ' + perdeManual.length)
    for (const d of perdeManual.slice(0, 20)) console.log('   ' + d.nome + ' ' + d.data + ' ' + d.campo + ' ' + F(d.valor_atual) + ' [' + d.origem + ']')
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
