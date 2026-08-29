/**
 * PORTAO da correcao de 28/08/2026 no modulo de justificativas.
 *
 * Nao ha framework de teste no projeto; este arquivo e o portao, no mesmo padrao de
 * sim_gestao_usuarios.js / sim_limite_carga.js.
 *
 * Transpile antes:
 *   npx tsc src/utils/gestaoJustificativas.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Cobre os tres sintomas relatados e os dois achados colaterais:
 *   1. salvar justificativa em Sobreaviso nao mudava nada na linha (parecia nao gravar)
 *   2. card PENDENTES = 0 com sobreaviso sem justificativa na lista
 *   3. filtro "Pendentes de Justificativa" vazio -> lote sem recorte para selecionar
 *   4. coordenador nao conseguia editar texto de evento ja decidido
 *   5. o lote apagava desfecho ja gravado, sem checagem nenhuma
 */
const {
  classificarEvento,
  resolverDesfecho,
  validarGravacaoDesfecho,
  PAPEIS_REVERTEM_DESFECHO,
} = require('./_sim/gestaoJustificativas.js')

let passou = 0
const falhas = []

function ok(nome, real, esperado) {
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  if (a === b) passou++
  else falhas.push(`${nome}\n     esperado: ${b}\n     obtido:   ${a}`)
}

// ---------------------------------------------------------------------------
// 1. CLASSIFICACAO — os dois eixos nunca se apagam
// ---------------------------------------------------------------------------

// O caso do relatorio: FERNANDO, 16/08, SOBREAVISO N12, com justificativa gravada.
// ANTES: status virava 'auto_validado' -> botao continuava "Justificar", selo "Cumprido".
ok('sobreaviso cumprido COM justificativa mantem o status gravado',
  classificarEvento({ categoria: 'Sobreaviso', estado: 'validado', statusGravado: 'aprovada' }),
  { status: 'aprovada', semAcaoNecessaria: true })

// O outro caso do relatorio: LUCIA, 16/08, SOBREAVISO D12, "Nenhuma justificativa".
ok('sobreaviso cumprido SEM justificativa fica pendente no eixo do texto',
  classificarEvento({ categoria: 'Sobreaviso', estado: 'validado', statusGravado: null }),
  { status: 'pendente', semAcaoNecessaria: true })

ok('sobreaviso com falha de acionamento NAO e sem-acao',
  classificarEvento({ categoria: 'Sobreaviso', estado: 'falta', statusGravado: null }),
  { status: 'pendente', semAcaoNecessaria: false })

ok('plantao validado nao herda a regra do sobreaviso',
  classificarEvento({ categoria: 'Plantao', estado: 'validado', statusGravado: null }),
  { status: 'pendente', semAcaoNecessaria: false })

ok('extra em avaliacao continua cobrando texto',
  classificarEvento({ categoria: 'Extra', estado: 'em_avaliacao', statusGravado: null }),
  { status: 'pendente', semAcaoNecessaria: false })

// RPC indisponivel: o comentario da action diz "na duvida nao decide".
ok('estado desconhecido nunca vira sem-acao',
  classificarEvento({ categoria: 'Sobreaviso', estado: null, statusGravado: null }),
  { status: 'pendente', semAcaoNecessaria: false })

ok('sugestao do servidor sobrevive a classificacao',
  classificarEvento({ categoria: 'Sobreaviso', estado: 'validado', statusGravado: 'sugestao_pendente' }),
  { status: 'sugestao_pendente', semAcaoNecessaria: true })

ok('categoria com acento e caixa diferente casa igual',
  classificarEvento({ categoria: 'SOBREAVISO', estado: 'validado', statusGravado: null }),
  { status: 'pendente', semAcaoNecessaria: true })

// ---------------------------------------------------------------------------
// 2. KPIs E FILTROS — reproduzindo a tela do relatorio
// ---------------------------------------------------------------------------

// 40 eventos, como no print: 8 plantoes justificados, 2 plantoes pendentes,
// 20 sobreavisos cumpridos justificados, 10 sobreavisos cumpridos sem justificativa.
const fila = [
  ...Array.from({ length: 8 },  () => ({ categoria: 'Plantao',    estado: 'registrado', statusGravado: 'aprovada' })),
  ...Array.from({ length: 2 },  () => ({ categoria: 'Plantao',    estado: 'registrado', statusGravado: null })),
  ...Array.from({ length: 20 }, () => ({ categoria: 'Sobreaviso', estado: 'validado',   statusGravado: 'aprovada' })),
  ...Array.from({ length: 10 }, () => ({ categoria: 'Sobreaviso', estado: 'validado',   statusGravado: null })),
].map(classificarEvento)

const kpis = {
  total: fila.length,
  justificados: fila.filter(i => i.status === 'aprovada').length,
  pendentes: fila.filter(i => i.status === 'pendente' && !i.semAcaoNecessaria).length,
  cumpridosSemJustificativa: fila.filter(i => i.status === 'pendente' && i.semAcaoNecessaria).length,
  resolvidos: fila.filter(i => i.status === 'aprovada' || i.semAcaoNecessaria).length,
}

ok('KPIs separam os dois eixos', kpis,
  { total: 40, justificados: 28, pendentes: 2, cumpridosSemJustificativa: 10, resolvidos: 38 })

// O card de progresso continua medindo "nada pendente de acao" (decisao de 23/08/2026):
// os 10 sobreavisos sem texto NAO derrubam a barra, mas agora aparecem com nome proprio.
ok('progresso mede resolvidos, nao textos escritos',
  Math.round((kpis.resolvidos / kpis.total) * 100), 95)

// ANTES: pendentes somava 0 e justificados somava 40 -> 100%, com 10 linhas
// "Nenhuma justificativa" na lista. Era essa a contradicao relatada.
ok('a contradicao antiga nao volta: pendentes+cumpridos_sem = todo texto que falta',
  kpis.pendentes + kpis.cumpridosSemJustificativa,
  fila.filter(i => i.status === 'pendente').length)

// O recorte que a Validacao em Massa nao tinha.
ok('filtro "cumpridos sem justificativa" devolve um grupo homogeneo e nao vazio',
  fila.filter(i => i.status === 'pendente' && i.semAcaoNecessaria).length, 10)

ok('filtro "pendentes" nao mistura o opcional com o cobrado',
  fila.filter(i => i.status === 'pendente' && !i.semAcaoNecessaria).length, 2)

// ---------------------------------------------------------------------------
// 3. BOTAO E SELO DA LINHA — o que fazia parecer que nao gravou
// ---------------------------------------------------------------------------

// Espelha JustificativasClient.tsx: isJustificado = status === 'aprovada'.
const rotuloBotao = c => (c.status === 'aprovada' ? 'Editar' : 'Justificar')
const botaoEhCta   = c => !(c.status === 'aprovada' || c.semAcaoNecessaria)

const sobrJust = classificarEvento({ categoria: 'Sobreaviso', estado: 'validado', statusGravado: 'aprovada' })
const sobrVazio = classificarEvento({ categoria: 'Sobreaviso', estado: 'validado', statusGravado: null })
const plantVazio = classificarEvento({ categoria: 'Plantao', estado: 'registrado', statusGravado: null })

ok('sobreaviso justificado passa a mostrar "Editar"', rotuloBotao(sobrJust), 'Editar')
ok('sobreaviso sem texto continua oferecendo "Justificar"', rotuloBotao(sobrVazio), 'Justificar')
ok('sobreaviso cumprido nunca pinta CTA azul de pendencia', botaoEhCta(sobrVazio), false)
ok('plantao sem justificativa continua sendo CTA azul', botaoEhCta(plantVazio), true)

// ---------------------------------------------------------------------------
// 4. DESFECHO — undefined (nao opinei) x null (limpar)
// ---------------------------------------------------------------------------

ok('nao opinar preserva o desfecho gravado',
  resolverDesfecho({ opinou: false, desfechoInformado: null, desfechoAtual: 'validado' }),
  { desfechoNovo: 'validado', mudou: false })

ok('nao opinar sobre evento sem desfecho continua sem desfecho',
  resolverDesfecho({ opinou: false, desfechoInformado: null, desfechoAtual: null }),
  { desfechoNovo: null, mudou: false })

ok('limpar de proposito continua sendo possivel',
  resolverDesfecho({ opinou: true, desfechoInformado: null, desfechoAtual: 'falta' }),
  { desfechoNovo: null, mudou: true })

ok('reafirmar o mesmo valor nao conta como mudanca (autoria preservada)',
  resolverDesfecho({ opinou: true, desfechoInformado: 'falta', desfechoAtual: 'falta' }),
  { desfechoNovo: 'falta', mudou: false })

ok('reverter falta para validado e mudanca',
  resolverDesfecho({ opinou: true, desfechoInformado: 'validado', desfechoAtual: 'falta' }),
  { desfechoNovo: 'validado', mudou: true })

ok('decidir onde nao havia nada e mudanca',
  resolverDesfecho({ opinou: true, desfechoInformado: 'validado', desfechoAtual: null }),
  { desfechoNovo: 'validado', mudou: true })

// ---------------------------------------------------------------------------
// 5. O BUG 4 — coordenador editando texto de evento ja decidido
// ---------------------------------------------------------------------------

const coordenador = {
  role: 'coordenador', acesso_todas_unidades: false, acesso_todos_setores: true,
  permitted_unidades: ['u1'], permitted_setores: ['s1'],
}
const rhGeral = { role: 'rh', permitted_unidades: [], permitted_setores: [] }
const evento = { unidade_id: 'u1', setor_id: 's1' }
const texto = 'Permanencia de prontidao tecnica em sobreaviso durante o periodo.'

// Fluxo real: modal nao pede decisao (podeReverter=false) -> manda undefined.
const semOpiniao = resolverDesfecho({ opinou: false, desfechoInformado: null, desfechoAtual: 'validado' })
ok('coordenador EDITA TEXTO de evento ja decidido sem levar recusa',
  validarGravacaoDesfecho({
    ator: coordenador, evento,
    desfechoAtual: 'validado', desfechoNovo: semOpiniao.desfechoNovo, texto,
  }),
  { ok: true })

// A trava de verdade continua de pe: reverter exige RH.
ok('coordenador continua sem poder reverter falta',
  validarGravacaoDesfecho({
    ator: coordenador, evento, desfechoAtual: 'falta', desfechoNovo: 'validado', texto,
  }).ok, false)

ok('RH reverte falta normalmente',
  validarGravacaoDesfecho({
    ator: rhGeral, evento, desfechoAtual: 'falta', desfechoNovo: 'validado', texto,
  }),
  { ok: true })

ok('coordenador decide onde nao havia desfecho',
  validarGravacaoDesfecho({
    ator: coordenador, evento, desfechoAtual: null, desfechoNovo: 'falta', texto,
  }),
  { ok: true })

ok('texto curto continua recusado',
  validarGravacaoDesfecho({
    ator: coordenador, evento, desfechoAtual: null, desfechoNovo: 'falta', texto: 'faltou',
  }).ok, false)

// ---------------------------------------------------------------------------
// 6. O BUG 5 — o lote apagando desfecho ja gravado
// ---------------------------------------------------------------------------

/** Espelha o laco de salvarJustificativasBulk. */
function simularLote(eventos, role) {
  const podeReverter = PAPEIS_REVERTEM_DESFECHO.includes(role)
  let validados = 0, preservados = 0
  const recusas = []
  const gravados = eventos.map(e => {
    const valida = e.estado === 'em_avaliacao'
    const { desfechoNovo, mudou } = resolverDesfecho({
      opinou: valida, desfechoInformado: 'validado', desfechoAtual: e.desfechoAtual,
    })
    if (valida && mudou) validados++
    if (!mudou && e.desfechoAtual !== null) preservados++
    if (mudou && e.desfechoAtual !== null && !podeReverter) recusas.push(e.nome)
    return { nome: e.nome, resultado: desfechoNovo }
  })
  return recusas.length ? { recusado: true, recusas } : { gravados, validados, preservados }
}

// O cenario perigoso: "selecionar todos" + "Justificar 20" com uma falta do RH no meio.
const loteComFalta = [
  { nome: 'plantao_em_avaliacao', estado: 'em_avaliacao', desfechoAtual: null },
  { nome: 'falta_do_rh',          estado: 'validado',     desfechoAtual: 'falta' },
  { nome: 'sobreaviso_cumprido',  estado: 'validado',     desfechoAtual: null },
]

ok('LOTE: falta ja registrada NAO e apagada (era o furo)',
  simularLote(loteComFalta, 'coordenador'),
  { gravados: [
      { nome: 'plantao_em_avaliacao', resultado: 'validado' },
      { nome: 'falta_do_rh',          resultado: 'falta' },
      { nome: 'sobreaviso_cumprido',  resultado: null },
    ], validados: 1, preservados: 1 })

// Mesmo para quem PODE reverter, o lote nao reverte: ele so valida o que esta em avaliacao.
ok('LOTE: nem o RH reverte falta pelo caminho do lote',
  simularLote(loteComFalta, 'rh').gravados.find(g => g.nome === 'falta_do_rh').resultado,
  'falta')

// Um lote que de fato tentaria mudar desfecho existente e recusado inteiro para quem nao pode.
const loteReversor = [{ nome: 'validado_virando', estado: 'em_avaliacao', desfechoAtual: 'falta' }]
ok('LOTE: tentativa de validar por cima de falta recusa o lote inteiro',
  simularLote(loteReversor, 'coordenador'),
  { recusado: true, recusas: ['validado_virando'] })

ok('LOTE: o mesmo caso passa para o RH',
  simularLote(loteReversor, 'rh').validados, 1)

// Nenhum evento em avaliacao -> nada de desfecho e escrito, so texto.
ok('LOTE: so texto quando nao ha nada a validar',
  simularLote([{ nome: 'a', estado: 'registrado', desfechoAtual: null }], 'coordenador'),
  { gravados: [{ nome: 'a', resultado: null }], validados: 0, preservados: 0 })

// ---------------------------------------------------------------------------

console.log(`\n  ${passou} de ${passou + falhas.length} casos passaram\n`)
if (falhas.length) {
  falhas.forEach(f => console.log(`  FALHOU  ${f}\n`))
  process.exit(1)
}
console.log('  Portao OK\n')
