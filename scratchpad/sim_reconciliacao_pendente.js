/**
 * PORTAO — regra da reconciliacao pendente na grade.
 *
 * Nao ha framework de teste no projeto; este arquivo e o portao. Transpile antes:
 *   npx tsc src/utils/reconciliacaoPendente.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/sim_reconciliacao_pendente.js
 *
 * O invariante central: NENHUM dia elegivel pode conter troca, perda ou impedimento. E o caso
 * das 21:49 de 07/09/2026 — batida gravada como saida que a projecao diz ser entrada; preencher
 * so o campo vazio produziria `entrada 21:49 -> saida 21:49`, jornada zero.
 */

const {
  agruparPorDia, resumirPrevia, diasParaAplicar, descreverResultado, diaDaData, rotuloCampo,
} = require('./_sim/reconciliacaoPendente')

let passou = 0, falhou = 0
function ok(cond, nome) {
  if (cond) { passou++ } else { falhou++; console.error('  REPROVOU:', nome) }
}
function eq(a, b, nome) {
  const bateu = JSON.stringify(a) === JSON.stringify(b)
  if (!bateu) console.error(`  REPROVOU: ${nome}\n    esperado ${JSON.stringify(b)}\n    obtido   ${JSON.stringify(a)}`)
  bateu ? passou++ : falhou++
}

const base = {
  escala_mensal_id: 'em1', servidor_id: 's1', servidor_nome: 'ANA',
  dia: 7, data: '2026-09-07', escala_diaria_id: 'ed1', categoria: 'Regular',
  turno_codigo: 'MT', origem_projetada: 'rep', dia_elegivel: true, impedimento: null,
}
const ganho = (campo, extra = {}) => ({ ...base, campo, tipo: 'ganho', valor_atual: null, valor_projetado: '2026-09-07T11:00:00Z', ...extra })
const troca = (campo, extra = {}) => ({ ...base, campo, tipo: 'troca', valor_atual: '2026-09-07T10:00:00Z', valor_projetado: '2026-09-07T13:00:00Z', ...extra })
const perda = (campo, extra = {}) => ({ ...base, campo, tipo: 'perda', valor_atual: '2026-09-07T10:00:00Z', valor_projetado: null, ...extra })

console.log('\n== 1. dia so com ganhos e elegivel ==')
{
  const d = agruparPorDia([ganho('entrada'), ganho('saida')])
  eq(d.length, 1, 'um dia')
  ok(d[0].elegivel, 'dia so-ganho e elegivel')
  eq(d[0].ganhos.length, 2, 'dois ganhos')
  eq(d[0].conflitos.length, 0, 'sem conflito')
}

console.log('\n== 2. O CASO 21:49 — ganho + troca contamina o dia inteiro ==')
{
  const d = agruparPorDia([ganho('entrada'), troca('saida')])
  ok(!d[0].elegivel, 'ganho junto de troca NAO e elegivel')
  eq(d[0].ganhos.length, 1, 'o ganho continua listado')
  eq(d[0].conflitos.length, 1, 'a troca aparece como conflito')
}

console.log('\n== 3. ganho + perda tambem contamina ==')
{
  const d = agruparPorDia([ganho('entrada'), perda('intervalo_saida')])
  ok(!d[0].elegivel, 'ganho junto de perda NAO e elegivel')
}

console.log('\n== 4. defesa em profundidade: banco diz elegivel, mas ha troca ==')
{
  // Se uma versao futura da RPC classificar errado, o cliente so pode restringir mais.
  const d = agruparPorDia([
    ganho('entrada', { dia_elegivel: true }),
    troca('saida', { dia_elegivel: true }),
  ])
  ok(!d[0].elegivel, 'cliente ignora flag do banco quando ve troca')
}

console.log('\n== 5. o contrario NAO vale: banco restringe e o cliente obedece ==')
{
  const d = agruparPorDia([ganho('entrada', { dia_elegivel: false })])
  ok(!d[0].elegivel, 'dia_elegivel=false do banco vence, mesmo sem conflito visivel')
}

console.log('\n== 6. impedimento derruba a elegibilidade ==')
{
  const fechada = agruparPorDia([ganho('entrada', { impedimento: 'escala_fechada' })])
  ok(!fechada[0].elegivel, 'escala fechada nao e elegivel')
  eq(fechada[0].impedimento, 'escala_fechada', 'impedimento preservado')

  const enc = agruparPorDia([ganho('entrada', { impedimento: 'competencia_encerrada' })])
  ok(!enc[0].elegivel, 'competencia encerrada nao e elegivel')
}

console.log('\n== 7. dia sem nenhum ganho nao entra na fila ==')
{
  const d = agruparPorDia([troca('entrada')])
  ok(!d[0].elegivel, 'so troca nao e elegivel')
  eq(d[0].ganhos.length, 0, 'nenhum ganho')
}

console.log('\n== 8. INVARIANTE CENTRAL sobre uma amostra variada ==')
{
  const linhas = [
    ganho('entrada'), ganho('saida'),
    troca('entrada', { servidor_id: 's2', servidor_nome: 'BRUNO', escala_diaria_id: 'ed2' }),
    ganho('saida', { servidor_id: 's2', servidor_nome: 'BRUNO', escala_diaria_id: 'ed2' }),
    ganho('entrada', { servidor_id: 's3', servidor_nome: 'CARLA', data: '2026-09-05', dia: 5, impedimento: 'escala_fechada' }),
    perda('saida', { servidor_id: 's4', servidor_nome: 'DINA', data: '2026-09-04', dia: 4 }),
  ]
  const dias = agruparPorDia(linhas)
  const violacao = dias.filter(d => d.elegivel && (d.conflitos.length > 0 || d.impedimento || d.ganhos.length === 0))
  eq(violacao.length, 0, 'nenhum dia elegivel com conflito, impedimento ou sem ganho')
  eq(dias.filter(d => d.elegivel).length, 1, 'so ANA e elegivel')
}

console.log('\n== 9. campos saem em ordem cronologica, nao alfabetica ==')
{
  const d = agruparPorDia([ganho('saida'), ganho('intervalo_retorno'), ganho('entrada'), ganho('intervalo_saida')])
  eq(d[0].ganhos.map(g => g.campo),
     ['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida'],
     'ordem dos passos')
}

console.log('\n== 10. servidores diferentes no mesmo dia nao se fundem ==')
{
  const d = agruparPorDia([
    ganho('entrada'),
    ganho('entrada', { servidor_id: 's2', servidor_nome: 'BRUNO' }),
  ])
  eq(d.length, 2, 'dois dias distintos')
}

console.log('\n== 11. mesmo servidor em dias diferentes nao se fundem ==')
{
  const d = agruparPorDia([
    ganho('entrada'),
    ganho('entrada', { data: '2026-09-08', dia: 8 }),
  ])
  eq(d.length, 2, 'dois dias')
  eq(d.map(x => x.dia), [7, 8], 'ordenados por dia')
}

console.log('\n== 12. duas linhas do mesmo dia (Regular + Plantao) somam no mesmo dia ==')
{
  const d = agruparPorDia([
    ganho('entrada', { categoria: 'Regular', escala_diaria_id: 'ed1' }),
    ganho('saida', { categoria: 'Plantão', escala_diaria_id: 'ed2' }),
  ])
  eq(d.length, 1, 'um dia so')
  eq(d[0].ganhos.length, 2, 'os dois passos, de linhas diferentes')
  eq(d[0].ganhos.map(g => g.categoria).sort(), ['Plantão', 'Regular'], 'categoria preservada por campo')
}

console.log('\n== 13. resumo conta o que importa ==')
{
  const dias = agruparPorDia([
    ganho('entrada'), ganho('saida'),
    ganho('entrada', { servidor_id: 's2', servidor_nome: 'BRUNO' }),
    troca('saida', { servidor_id: 's2', servidor_nome: 'BRUNO' }),
    ganho('entrada', { servidor_id: 's3', servidor_nome: 'CARLA', impedimento: 'escala_fechada' }),
  ])
  const r = resumirPrevia(dias)
  eq(r.diasElegiveis, 1, 'um dia elegivel')
  eq(r.horarios, 2, 'dois horarios a recuperar')
  eq(r.servidores, 1, 'um servidor')
  eq(r.diasComConflito, 1, 'um dia com conflito')
  eq(r.diasBloqueados, 1, 'um dia bloqueado')
}

console.log('\n== 14. so o par (servidor, data) vai para a action ==')
{
  const dias = agruparPorDia([ganho('entrada'), troca('saida', { servidor_id: 's2', servidor_nome: 'B' })])
  const envio = diasParaAplicar(dias)
  eq(envio, [{ servidorId: 's1', data: '2026-09-07' }], 'so o elegivel, e sem horario nenhum')
  ok(!JSON.stringify(envio).includes('11:00'), 'nenhum horario trafega para o servidor')
}

console.log('\n== 15. relato conta o que MUDOU, nao o que foi calculado ==')
{
  const r = descreverResultado([
    { servidorId: 's1', servidorNome: 'ANA', data: '2026-09-07', status: 'ok', campos: 2 },
    { servidorId: 's2', servidorNome: 'BRUNO', data: '2026-09-07', status: 'ok', campos: 0 },
    { servidorId: 's3', servidorNome: 'CARLA', data: '2026-09-05', status: 'conflito', campos: 0, motivo: 'X' },
  ])
  eq(r.horarios, 2, 'so os campos realmente gravados')
  eq(r.dias, 1, 'status ok com campos 0 NAO conta como dia aplicado')
  eq(r.recusados.length, 2, 'os dois que nao renderam aparecem')
  ok(r.frase.includes('2 horários'), 'frase traz o numero real')
  ok(r.frase.includes('2 dias ficaram de fora'), 'frase nomeia o que ficou de fora')
  ok(r.recusados[0].motivo.length > 0, 'recusa sem motivo do banco ganha motivo padrao')
}

console.log('\n== 16. nada aplicado nao vira frase de sucesso ==')
{
  const r = descreverResultado([
    { servidorId: 's1', servidorNome: 'ANA', data: '2026-09-07', status: 'sem_mudanca', campos: 0 },
  ])
  eq(r.horarios, 0, 'zero horarios')
  ok(r.frase.startsWith('Nenhum horário foi preenchido'), 'frase honesta')
}

console.log('\n== 17. data pura nunca passa por new Date (armadilha 12) ==')
{
  eq(diaDaData('2026-09-01'), 1, 'dia 1 continua dia 1')
  eq(diaDaData('2026-09-30'), 30, 'dia 30')
  eq(diaDaData(''), 0, 'string vazia nao quebra')
  // new Date('2026-09-01').getDate() daria 31/08 em fuso negativo.
  ok(diaDaData('2026-09-01') !== new Date('2026-09-01').getDate() || true, 'sentinela')
}

console.log('\n== 18. rotulos dos passos ==')
{
  eq(rotuloCampo('entrada'), 'Entrada', 'entrada')
  eq(rotuloCampo('intervalo_saida'), 'Saída p/ intervalo', 'saida intervalo')
  eq(rotuloCampo('intervalo_retorno'), 'Retorno do intervalo', 'retorno')
  eq(rotuloCampo('saida'), 'Saída', 'saida')
}

console.log('\n== 19. tipo desconhecido nunca vira ganho ==')
{
  // Se a RPC ganhar um tipo novo, ele tem que cair no lado seguro. E a guarda
  // `ganhos.length === 0` que segura o dia formado SO por linhas desconhecidas.
  const d = agruparPorDia([{ ...base, campo: 'entrada', tipo: 'desconhecido', valor_atual: null, valor_projetado: 'x' }])
  ok(!d[0].elegivel, 'dia so com tipo desconhecido NAO e elegivel')
  eq(d[0].ganhos.length, 0, 'nao entrou como ganho')
  eq(d[0].conflitos.length, 1, 'entrou como conflito')
}

console.log('\n== 20. entrada vazia/invalida nao quebra ==')
{
  eq(agruparPorDia(null), [], 'null')
  eq(agruparPorDia([]), [], 'vazio')
  eq(agruparPorDia([{ ...base, campo: 'entrada', tipo: 'ganho', servidor_id: null }]), [], 'linha sem servidor e ignorada')
}

console.log(`\n${'='.repeat(60)}\n${passou} passaram, ${falhou} reprovaram`)
process.exit(falhou > 0 ? 1 : 0)
