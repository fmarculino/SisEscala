// Medicoes que embasam docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md
//
// Le PRODUCAO (somente leitura, nenhuma escrita). Reproduz:
//   1. folha_ponto por competencia + quantos servidores tem 2+ folhas no mesmo mes
//   2. o setor MAIS MEDICOS, quem esta nele, e se algum relogio o atende
//   3. em que setor a escala de cada competencia foi lancada
//   4. batidas reais no periodo 21/08 -> 20/09
//   5. o recorte 21->20 sobre as folhas que ja existem (dias >20 do mes A + <=20 do mes B)
//
// Uso: node scratchpad/an_periodo_apuracao.mjs
import fs from 'node:fs'

const env = Object.fromEntries(fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.production'); process.exit(1) }
const H = { apikey: K, Authorization: `Bearer ${K}` }

// PostgREST corta em 1000 linhas em silencio (armadilha 8)
async function pag(url) {
  const out = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(url, { headers: { ...H, Range: `${f}-${f + 999}` } })
    const p = await r.json()
    if (!Array.isArray(p)) { console.error('ERRO', JSON.stringify(p).slice(0, 400)); process.exit(1) }
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}

const DIA_CORTE = 20
const MM_DIC = 'c11a9d66-a086-4a45-bde2-8d25bd86f03a' // dicionario_setores: MAIS MEDICOS

// ---------------------------------------------------------------- 1. folhas
const folhas = await pag(`${U}/rest/v1/folha_ponto?select=id,servidor_id,mes,ano,status&order=id`)
const porComp = {}, porStatus = {}, dup = {}
for (const f of folhas) {
  porComp[`${f.ano}-${String(f.mes).padStart(2, '0')}`] = (porComp[`${f.ano}-${String(f.mes).padStart(2, '0')}`] || 0) + 1
  porStatus[f.status] = (porStatus[f.status] || 0) + 1
  const k = `${f.servidor_id}|${f.ano}-${f.mes}`
  dup[k] = (dup[k] || 0) + 1
}
console.log('=== 1. folha_ponto ===')
console.log('total:', folhas.length)
console.log('por competencia:', Object.entries(porComp).sort().map(([k, v]) => `${k}=${v}`).join('  '))
console.log('por status:', JSON.stringify(porStatus))
console.log('servidores com 2+ folhas na MESMA competencia:', Object.values(dup).filter(v => v > 1).length)
console.log('  (a chave da folha e unique_escala_mensal_id, nao (servidor, mes, ano) — 20260612100000)')

// ------------------------------------------------- 2. setor e relogio do grupo
const dicN = Object.fromEntries((await pag(`${U}/rest/v1/dicionario_setores?select=id,nome`)).map(d => [d.id, d.nome]))
const unidN = Object.fromEntries((await pag(`${U}/rest/v1/unidades?select=id,nome`)).map(u => [u.id, u.nome]))
const setores = await pag(`${U}/rest/v1/setores?select=id,unidade_id,parent_id,dicionario_setor_id,ativo`)
const setN = Object.fromEntries(setores.map(s => [s.id, dicN[s.dicionario_setor_id] || '?']))
const mmSet = setores.filter(s => s.dicionario_setor_id === MM_DIC)

console.log('\n=== 2. setor MAIS MEDICOS ===', mmSet.length, 'setor(es)')
for (const s of mmSet) {
  console.log(` ${s.id}  ${unidN[s.unidade_id]}  pai: ${s.parent_id ? setN[s.parent_id] : '(raiz)'}  ativo: ${s.ativo}`)
  const disp = await pag(`${U}/rest/v1/dispositivos_rep?select=id,nome,ativo&unidade_id=eq.${s.unidade_id}`)
  const vinc = disp.length
    ? await pag(`${U}/rest/v1/dispositivos_rep_setores?select=dispositivo_id,setor_id&dispositivo_id=in.(${disp.map(d => d.id).join(',')})`)
    : []
  console.log(`   relogios da unidade: ${disp.length} | vinculos dispositivo-setor: ${vinc.length}`)
  console.log(`   este setor e atendido por algum relogio explicitamente? ${vinc.some(v => v.setor_id === s.id)}`)
  if (vinc.length === 0 && disp.length > 0) {
    console.log('   >>> ATENCAO: zero vinculos = o relogio atende a unidade inteira. Vincular setores')
    console.log('       aquele relogio tira este setor da Cobertura de Ponto em silencio (ponto cego HMM-03).')
  }
}

const srv = mmSet.length
  ? await pag(`${U}/rest/v1/servidores?select=id,nome,matricula,cargo,vinculo,status,unidade_id&setor_id=in.(${mmSet.map(s => s.id).join(',')})`)
  : []
const mat = Object.fromEntries(srv.map(s => [s.id, s.matricula]))
console.log('\n lotados no setor:', srv.length)
for (const s of srv) console.log(`   ${s.matricula}  ${s.nome.slice(0, 34).padEnd(34)} ${s.status}  ${s.cargo}  ${s.vinculo}`)
if (srv.length === 0) { console.log('\n(sem servidores no setor — nada mais a medir)'); process.exit(0) }

const IDS = srv.map(s => s.id).join(',')

// -------------------------------------------- 3. setor da escala por competencia
const em = await pag(`${U}/rest/v1/escala_mensal?select=id,servidor_id,mes,ano,status,setor_id,jornadas(nome,horas_totais,intervalo_minutos)&servidor_id=in.(${IDS})&order=ano,mes`)
console.log('\n=== 3. em que setor a escala foi lancada ===')
for (const e of em) {
  const j = e.jornadas
  console.log(`   ${mat[e.servidor_id]}  ${String(e.mes).padStart(2, '0')}/${e.ano}  ${String(e.status).padEnd(10)} -> ${setN[e.setor_id] || e.setor_id.slice(0, 8)}  | ${j?.nome} (${j?.horas_totais}h, int ${j?.intervalo_minutos}min)`)
}

// ------------------------------------------------------------ 4. batidas reais
const mp = await pag(`${U}/rest/v1/marcacoes_ponto?select=servidor_id,ocorrido_em,origem&servidor_id=in.(${IDS})&ocorrido_em=gte.2026-08-21&ocorrido_em=lt.2026-09-21&order=ocorrido_em`)
const porDia = {}, porOrigem = {}
for (const m of mp) {
  porDia[m.ocorrido_em.slice(0, 10)] = (porDia[m.ocorrido_em.slice(0, 10)] || 0) + 1
  porOrigem[m.origem] = (porOrigem[m.origem] || 0) + 1
}
console.log('\n=== 4. marcacoes de 21/08 a 20/09 ===', mp.length)
console.log('  por dia:', Object.entries(porDia).map(([k, v]) => `${k.slice(5)}=${v}`).join(' '))
console.log('  por origem:', JSON.stringify(porOrigem))

// --------------------------------- 5. o recorte 21->20 sobre as folhas que existem
const fp = await pag(`${U}/rest/v1/folha_ponto?select=servidor_id,mes,ano,status,registros&servidor_id=in.(${IDS})&ano=eq.2026&mes=in.(8,9)`)
console.log(`\n=== 5. recorte dias >${DIA_CORTE} de 08/2026 + <=${DIA_CORTE} de 09/2026 ===`)
const temHorario = r => !!(r.entrada || r.saida || r.saida_intervalo || r.retorno_intervalo)
for (const s of srv) {
  const f8 = fp.find(f => f.servidor_id === s.id && f.mes === 8)
  const f9 = fp.find(f => f.servidor_id === s.id && f.mes === 9)
  const a = (f8?.registros || []).filter(r => r.dia > DIA_CORTE)
  const b = (f9?.registros || []).filter(r => r.dia <= DIA_CORTE)
  const he = [...a, ...b].reduce((t, r) => t + (r.hora_extra_minutos || 0), 0)
  const faltas = [...a, ...b].filter(r => /FALTA/i.test(r.observacao || '')).length
  console.log(`   ${mat[s.id]}  08/2026[${f8?.status || 'sem folha'}] ${a.length} dias (${a.filter(temHorario).length} com horario)`
    + `  |  09/2026[${f9?.status || 'sem folha'}] ${b.length} dias (${b.filter(temHorario).length} com horario)`
    + `  |  HE ${he} min  |  ${faltas} dia(s) com FALTA`)
  // os numeros de dia nunca colidem num corte fixo — conferido, nao suposto
  const dias = [...a, ...b].map(r => r.dia)
  if (new Set(dias).size !== dias.length) console.log('   >>> COLISAO de numero de dia: o recorte nao e seguro para este corte')
}
console.log('\n  (o `dia` nunca colide, mas a ORDEM por `dia` poe setembro antes de agosto —')
console.log('   por isso o snapshot da apuracao carrega a data ISO e ordena por ela)')
