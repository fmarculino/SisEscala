/**
 * PORTAO: quem pode mexer numa batida REAL, e em que circunstancia.
 *
 * Transpile antes:
 *   npx tsc src/utils/folha/correcaoBatidaReal.ts src/utils/gestaoJustificativas.ts \
 *     --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * 🚨 O QUE ESTE PORTAO EXISTE PARA IMPEDIR
 *   1. que o RH volte a nao alcancar a correcao (o beco de 17/09/2026: 5 contas passavam no
 *      gate contra 18 de RH e 124 coordenadores);
 *   2. que o RH passe a DIGITAR horario por cima de batida real -- e a vedacao 4 da Portaria
 *      671/2021, e a unica coisa que separa "apurar" de "substituir o registro do empregado";
 *   3. que o coordenador perca a validacao de passo VAZIO, que ele sempre teve;
 *   4. que a fila de justificativas deixe de oferecer falta em plantao `registrado` -- era o
 *      caso sem saida nenhuma (1.286 plantoes em 09/2026);
 *   5. que lancar falta contra o ponto volte a sair de um clique.
 */
const {
  podeValidarPassoVazio, podeRearranjarBatidaReal, podeDigitarSobreBatidaReal,
  ehBatidaReal, acaoNoPasso, podeExecutar, mensagemRecusa,
} = require('./_sim/folha/correcaoBatidaReal.js')
const {
  pedeDecisaoDeDesfecho, exigeConfirmacaoContraRegistro, validarGravacaoDesfecho,
} = require('./_sim/gestaoJustificativas.js')

let passou = 0
const falhas = []
const ok = (nome, real, esperado) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado)
  if (bate) passou++
  else falhas.push(`${nome}\n    esperado=${JSON.stringify(esperado)} obtido=${JSON.stringify(real)}`)
}

// ===========================================================================
// 1. A MATRIZ DE PAPEIS
// ===========================================================================
const TODOS = ['super_admin', 'admin', 'rh', 'rh_unidade', 'coordenador', 'ass_adm']

for (const r of TODOS) {
  ok(`${r} valida passo vazio`, podeValidarPassoVazio(r), true)
}
ok('servidor (Portal) NAO valida passo vazio', podeValidarPassoVazio('servidor'), false)
ok('comum (Portal) NAO valida passo vazio', podeValidarPassoVazio('comum'), false)
ok('papel desconhecido NAO valida', podeValidarPassoVazio('inventado'), false)
ok('null NAO valida', podeValidarPassoVazio(null), false)
ok('undefined NAO valida', podeValidarPassoVazio(undefined), false)

ok('super_admin rearranja batida real', podeRearranjarBatidaReal('super_admin'), true)
ok('admin (Diretor) rearranja batida real', podeRearranjarBatidaReal('admin'), true)
ok('rh (Geral) rearranja batida real', podeRearranjarBatidaReal('rh'), true)
ok('rh_unidade rearranja batida real', podeRearranjarBatidaReal('rh_unidade'), true)
ok('coordenador NAO rearranja batida real', podeRearranjarBatidaReal('coordenador'), false)
ok('ass_adm NAO rearranja batida real', podeRearranjarBatidaReal('ass_adm'), false)

ok('super_admin digita sobre batida real', podeDigitarSobreBatidaReal('super_admin'), true)
ok('admin digita sobre batida real', podeDigitarSobreBatidaReal('admin'), true)
// 🚨 O limite que nao pode ser afrouxado.
ok('rh NAO digita sobre batida real', podeDigitarSobreBatidaReal('rh'), false)
ok('rh_unidade NAO digita sobre batida real', podeDigitarSobreBatidaReal('rh_unidade'), false)
ok('coordenador NAO digita sobre batida real', podeDigitarSobreBatidaReal('coordenador'), false)

// ===========================================================================
// 2. O QUE CONTA COMO BATIDA REAL
// ===========================================================================
// Os DOIS vocabularios: escala_diaria diz rep/terminal, a folha diz 'real'. Tratar so um
// deixaria metade do sistema sem protecao.
ok('rep e batida real', ehBatidaReal('rep'), true)
ok('terminal e batida real', ehBatidaReal('terminal'), true)
ok("'real' (vocabulario da folha) e batida real", ehBatidaReal('real'), true)
ok('ajuste_coordenador NAO e batida real', ehBatidaReal('ajuste_coordenador'), false)
ok('ajuste_servidor NAO e batida real', ehBatidaReal('ajuste_servidor'), false)
ok('pre_assinalado NAO e batida real', ehBatidaReal('pre_assinalado'), false)
ok('null NAO e batida real', ehBatidaReal(null), false)

// ===========================================================================
// 3. A ACAO DERIVADA DO ESTADO DO PASSO
// ===========================================================================
ok('passo vazio -> preencher_vazio',
  acaoNoPasso({ preenchido: false, origemAtual: null, novoHorarioDigitado: false }),
  'preencher_vazio')
ok('passo vazio com horario digitado -> preencher_vazio (ainda e o trabalho normal)',
  acaoNoPasso({ preenchido: false, origemAtual: null, novoHorarioDigitado: true }),
  'preencher_vazio')
ok('passo com declaracao do coordenador -> preencher_vazio (refazer declaracao nao e mexer em batida)',
  acaoNoPasso({ preenchido: true, origemAtual: 'ajuste_coordenador', novoHorarioDigitado: true }),
  'preencher_vazio')
ok('passo com pre-assinalacao -> preencher_vazio',
  acaoNoPasso({ preenchido: true, origemAtual: 'pre_assinalado', novoHorarioDigitado: false }),
  'preencher_vazio')
ok('batida real + escolher outra batida -> rearranjar',
  acaoNoPasso({ preenchido: true, origemAtual: 'rep', novoHorarioDigitado: false }),
  'rearranjar')
ok('batida real + digitar horario -> digitar_sobre_real',
  acaoNoPasso({ preenchido: true, origemAtual: 'rep', novoHorarioDigitado: true }),
  'digitar_sobre_real')
ok('batida de terminal + digitar -> digitar_sobre_real',
  acaoNoPasso({ preenchido: true, origemAtual: 'terminal', novoHorarioDigitado: true }),
  'digitar_sobre_real')

// ===========================================================================
// 4. podeExecutar amarra os dois
// ===========================================================================
ok('coordenador executa preencher_vazio', podeExecutar('preencher_vazio', 'coordenador'), true)
ok('coordenador NAO executa rearranjar', podeExecutar('rearranjar', 'coordenador'), false)
ok('rh executa rearranjar', podeExecutar('rearranjar', 'rh'), true)
ok('rh NAO executa digitar_sobre_real', podeExecutar('digitar_sobre_real', 'rh'), false)
ok('admin executa digitar_sobre_real', podeExecutar('digitar_sobre_real', 'admin'), true)

// ===========================================================================
// 5. A RECUSA DIZ O QUE FAZER (armadilha 31/44)
// ===========================================================================
ok('quem pode nao recebe recusa', mensagemRecusa('rearranjar', 'rh'), null)

const recusaCoord = mensagemRecusa('rearranjar', 'coordenador')
ok('coordenador recebe recusa', typeof recusaCoord === 'string' && recusaCoord.length > 0, true)
ok('a recusa ao coordenador aponta o caminho que sobra (passo VAZIO)',
  /vazio/i.test(recusaCoord || ''), true)
ok('a recusa ao coordenador NAO repete o texto antigo, que nao dizia nada',
  /Apenas administradores podem alterar ou reverter/.test(recusaCoord || ''), false)

const recusaDigitar = mensagemRecusa('digitar_sobre_real', 'rh')
ok('RH recebe recusa ao tentar digitar sobre batida', typeof recusaDigitar === 'string', true)
ok('a recusa ao RH explica que escolher OUTRA batida continua possivel',
  /outra batida/i.test(recusaDigitar || ''), true)

// ===========================================================================
// 6. FASE 3 -- a fila oferece a decisao onde ela existe
// ===========================================================================
ok('em_avaliacao pede decisao',
  pedeDecisaoDeDesfecho({ estado: 'em_avaliacao', ehReversao: false }), true)
// 🚨 O caso que nao tinha saida nenhuma antes de 17/09/2026.
ok('registrado PASSA a pedir decisao',
  pedeDecisaoDeDesfecho({ estado: 'registrado', ehReversao: false }), true)
ok('previsto (dia futuro) NAO pede decisao',
  pedeDecisaoDeDesfecho({ estado: 'previsto', ehReversao: false }), false)
ok('estado desconhecido NAO pede decisao',
  pedeDecisaoDeDesfecho({ estado: null, ehReversao: false }), false)
ok('nao_aplicavel NAO pede decisao',
  pedeDecisaoDeDesfecho({ estado: 'nao_aplicavel', ehReversao: false }), false)
ok('reversao pede decisao mesmo em estado que nao pediria',
  pedeDecisaoDeDesfecho({ estado: 'previsto', ehReversao: true }), true)

// ===========================================================================
// 7. FASE 3 -- falta CONTRA o ponto exige confirmacao
// ===========================================================================
ok('falta com registro exige confirmacao',
  exigeConfirmacaoContraRegistro({ desfechoNovo: 'falta', temRegistro: true }), true)
ok('falta SEM registro nao exige confirmacao',
  exigeConfirmacaoContraRegistro({ desfechoNovo: 'falta', temRegistro: false }), false)
ok('validar com registro nao exige confirmacao',
  exigeConfirmacaoContraRegistro({ desfechoNovo: 'validado', temRegistro: true }), false)
ok('limpar desfecho nao exige confirmacao',
  exigeConfirmacaoContraRegistro({ desfechoNovo: null, temRegistro: true }), false)

// ===========================================================================
// 8. FASE 3 -- a validacao do servidor amarra tudo
// ===========================================================================
const atorRh = {
  role: 'rh', acesso_todas_unidades: true, acesso_todos_setores: true,
  permitted_unidades: [], permitted_setores: [],
}
const ev = { unidade_id: 'u1', setor_id: 's1' }
const TXT = 'a servidora nao cumpriu o plantao; a batida foi a chegada antecipada do noturno'

ok('falta contra registro SEM confirmacao e recusada',
  validarGravacaoDesfecho({
    ator: atorRh, evento: ev, desfechoAtual: null, desfechoNovo: 'falta',
    texto: TXT, temRegistro: true, confirmaContraRegistro: false,
  }).ok, false)

ok('falta contra registro COM confirmacao passa',
  validarGravacaoDesfecho({
    ator: atorRh, evento: ev, desfechoAtual: null, desfechoNovo: 'falta',
    texto: TXT, temRegistro: true, confirmaContraRegistro: true,
  }).ok, true)

ok('falta SEM registro passa sem confirmacao (o caso comum nao ganhou atrito)',
  validarGravacaoDesfecho({
    ator: atorRh, evento: ev, desfechoAtual: null, desfechoNovo: 'falta',
    texto: TXT, temRegistro: false,
  }).ok, true)

ok('validar com registro passa sem confirmacao',
  validarGravacaoDesfecho({
    ator: atorRh, evento: ev, desfechoAtual: null, desfechoNovo: 'validado',
    texto: TXT, temRegistro: true,
  }).ok, true)

ok('texto curto continua recusado',
  validarGravacaoDesfecho({
    ator: atorRh, evento: ev, desfechoAtual: null, desfechoNovo: 'falta',
    texto: 'nao veio', temRegistro: false,
  }).ok, false)

// A reversao continua sendo do RH -- nada disso afrouxou aquela regra.
const atorCoord = {
  role: 'coordenador', acesso_todas_unidades: true, acesso_todos_setores: true,
  permitted_unidades: [], permitted_setores: [],
}
ok('coordenador NAO reverte desfecho ja gravado',
  validarGravacaoDesfecho({
    ator: atorCoord, evento: ev, desfechoAtual: 'falta', desfechoNovo: 'validado',
    texto: TXT, temRegistro: false,
  }).ok, false)

ok('coordenador DECLARA falta onde nao havia desfecho',
  validarGravacaoDesfecho({
    ator: atorCoord, evento: ev, desfechoAtual: null, desfechoNovo: 'falta',
    texto: TXT, temRegistro: false,
  }).ok, true)

// ===========================================================================
console.log(`\nsim_correcao_batida_real: ${passou} asercoes OK, ${falhas.length} falha(s)`)
if (falhas.length) {
  falhas.forEach(f => console.error('  REPROVADO: ' + f))
  process.exit(1)
}
