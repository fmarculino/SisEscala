/**
 * Reconcilia os dias afetados pelo NIVEL 2-B — RODAR SO DEPOIS DE APLICAR a migration
 * 20260903100000_ancora_do_plantao_que_nao_colide_com_o_regular.sql.
 *
 * ⚠️ NAO E RECONCILIACAO EM MASSA, E NAO PODE VIRAR UMA. Medido em producao em 03/09/2026 sobre
 *   09/2026 (1.614 pares servidor/dia): reprojetar tudo daria 4 ganhos contra 43 trocas e 7
 *   PERDAS — uma delas tirava 4h34 de uma saida ja gravada. O CLAUDE.md ja registrava o mesmo em
 *   19/08/2026 ("corrigia 4 dias e PIORAVA 11"). Aqui a lista e fechada: sao os (servidor, dia)
 *   cujo plantao MUDA de horario por causa da migration, medidos por scratchpad/sim_nivel2b.mjs.
 *
 * ⚠️ COMPETENCIAS FECHADAS NAO SAO TOCADAS (decisao do usuario, 03/09/2026). Alem da lista so
 *   conter 09/2026, fn_reconciliar_marcacoes_dia recusa competencia encerrada por conta propria.
 *
 * Uso:
 *   node scratchpad/fix_pos_nivel2b.mjs           -> ENSAIO: so mostra o que mudaria
 *   node scratchpad/fix_pos_nivel2b.mjs --aplicar -> reconcilia de verdade
 */
import fs from 'fs'
import { get, rpc } from './q.mjs'

const APLICAR = process.argv.includes('--aplicar')
const F = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const afetados = JSON.parse(fs.readFileSync('scratchpad/_afetados.json', 'utf8'))
const pares = [...new Set(afetados.map(a => `${a.sv}|2026-09-${String(a.dia).padStart(2, '0')}`))]
console.log(`${APLICAR ? 'APLICANDO' : 'ENSAIO (nada sera escrito)'} — ${pares.length} par(es) (servidor, dia)\n`)

const CAMPOS = [
  ['entrada', 'presenca_entrada_em', 'presenca_entrada_origem'],
  ['int_saida', 'presenca_intervalo_saida_em', 'presenca_intervalo_saida_origem'],
  ['int_retorno', 'presenca_intervalo_retorno_em', 'presenca_intervalo_retorno_origem'],
  ['saida', 'presenca_saida_em', 'presenca_saida_origem'],
]

const sv = await get(`servidores?select=id,nome,matricula`)
const SV = Object.fromEntries(sv.map(s => [s.id, s]))

async function estado(servidorId, dia) {
  const ems = await get(`escala_mensal?servidor_id=eq.${servidorId}&ano=eq.2026&mes=eq.9&ativo=eq.true&select=id`)
  const out = {}
  for (const em of ems) {
    const linhas = await get(`escala_diaria?escala_mensal_id=eq.${em.id}&dia=eq.${dia}&select=id,categoria,${CAMPOS.map(c => c[1] + ',' + c[2]).join(',')}`)
    for (const l of linhas) out[l.id] = l
  }
  return out
}

let ganhos = 0, trocas = 0, perdas = 0
for (const par of pares) {
  const [servidorId, data] = par.split('|')
  const dia = Number(data.slice(-2))
  const s = SV[servidorId] || {}
  const antes = await estado(servidorId, dia)

  // A projecao diz o que a reconciliacao GRAVARIA — sem escrever nada.
  const proj = await rpc('fn_projecao_marcacoes_dia', { p_servidor_id: servidorId, p_data: data })
  if (!Array.isArray(proj)) { console.log(`  ERRO na projecao de ${s.nome}: ${JSON.stringify(proj)}`); continue }
  const porLinha = Object.fromEntries(proj.map(p => [p.escala_diaria_id, p]))

  console.log(`${String(s.matricula).padEnd(6)} ${(s.nome || '').slice(0, 26).padEnd(26)} dia ${dia}`)
  const mapa = { entrada: 'entrada_em', int_saida: 'int_saida_em', int_retorno: 'int_ret_em', saida: 'saida_em' }
  for (const [id, l] of Object.entries(antes)) {
    const p = porLinha[id]
    for (const [nome, col] of CAMPOS) {
      const a = l[col] ? new Date(l[col]).getTime() : null
      const d = p && p[mapa[nome]] ? new Date(p[mapa[nome]]).getTime() : null
      if (a === d) continue
      const tipo = a === null ? 'GANHO ' : d === null ? 'PERDA ' : 'TROCA '
      if (tipo === 'GANHO ') ganhos++; else if (tipo === 'PERDA ') perdas++; else trocas++
      console.log(`   ${tipo} ${l.categoria.padEnd(8)} ${nome.padEnd(11)} ${F(l[col])} -> ${F(p && p[mapa[nome]])}`)
    }
  }

  if (APLICAR) {
    const r = await rpc('fn_reconciliar_marcacoes_dia', { p_servidor_id: servidorId, p_data: data })
    console.log(`   => ${JSON.stringify(r)}`)
  }
}

console.log(`\nresumo: ${ganhos} ganho(s), ${trocas} troca(s), ${perdas} perda(s)`)
if (perdas > 0) {
  console.log('\n⚠️ HA PERDAS. Uma perda e um horario JA GRAVADO que a projecao esvaziaria — confira')
  console.log('   uma a uma antes de aplicar. Perda legitima existe (batida que so o bloco errado')
  console.log('   fazia caber), mas cada uma tem de ser uma decisao, nunca um efeito colateral.')
}
if (!APLICAR) console.log('\nEnsaio. Para aplicar: node scratchpad/fix_pos_nivel2b.mjs --aplicar')
