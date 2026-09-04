/**
 * Portao da mesclagem de cadastros duplicados (04/09/2026).
 *
 *   npx tsc src/utils/mesclagemCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/sim_mesclagem_cadastro.js
 *
 * O que ele protege, e por que cada um vale um caso:
 *
 *   - a SUGESTAO de qual cadastro fica nunca pode virar decisao automatica quando o criterio
 *     empata. Chutar ali move ponto de servidor publico para o cadastro errado;
 *   - matricula temporaria (T26xxxxx) e o sinal que resolveu o caso relatado - se a regra 1 cair,
 *     a sugestao passa a se apoiar so em volume de dado, que aponta para o lado errado justamente
 *     no caso comum (a unidade que cadastrou errado escalou e bateu ponto por um mes);
 *   - o relato precisa dizer o que MUDOU (armadilha 22): cadastro duplicado vazio move zero
 *     vinculo, e a tela nao pode anunciar movimentacao que nao houve;
 *   - validarEscolha e o que impede a tela de mandar par invalido para a RPC.
 *
 * Validado injetando regressao de proposito (ver o fim do arquivo).
 */
const path = require('path')
const M = require(path.join(__dirname, '_sim', 'mesclagemCadastro.js'))

let falhas = 0
let casos = 0

function checa(nome, real, esperado) {
  casos++
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  if (a !== b) {
    falhas++
    console.error(`FALHOU: ${nome}\n  esperado: ${b}\n  recebido: ${a}`)
  }
}

function cadastro(over) {
  return Object.assign({
    id: 'id-' + Math.random().toString(36).slice(2, 8),
    nome: 'FULANO DE TAL',
    matricula: '11111',
    status: 'Ativo',
    cargo: 'TEC.ENFERM.',
    vinculo: 'Efetiva',
    unidade: 'USF A',
    setor: 'TEC ENFERMAGEM',
    vinculo_multiplo_confirmado: false,
    criado_em: '2026-08-25T14:35:11Z',
    escalas: 0, batidas: 0, folhas: 0, vinculos_rep: 0,
  }, over)
}

function grupo(cadastros) {
  return {
    cpf: '93052707272',
    quantidade: cadastros.length,
    todos_confirmados: cadastros.every(c => c.vinculo_multiplo_confirmado),
    cadastros,
  }
}

// ---------------------------------------------------------------- matricula temporaria
checa('T26 e temporaria', M.ehMatriculaTemporaria('T2600103'), true)
checa('minuscula tambem', M.ehMatriculaTemporaria('t2600103'), true)
checa('com espaco', M.ehMatriculaTemporaria('  T2600103 '), true)
checa('numerica e definitiva', M.ehMatriculaTemporaria('65567'), false)
checa('nula e definitiva', M.ehMatriculaTemporaria(null), false)
// "TEC" nao e matricula temporaria: a convencao e T seguido de DIGITO.
checa('T seguido de letra nao conta', M.ehMatriculaTemporaria('TEC123'), false)

// ---------------------------------------------------------------- sugestao
{
  // O caso relatado: 65567 definitiva (com historico) x T2600103 temporaria (vazia).
  const definitiva = cadastro({ id: 'a', matricula: '65567', vinculos_rep: 1 })
  const temporaria = cadastro({ id: 'b', matricula: 'T2600103' })
  const s = M.sugerirDestino(grupo([definitiva, temporaria]))
  checa('sugere a definitiva', s && s.destinoId, 'a')
  checa('e diz por que', !!(s && /definitiva/.test(s.razao)), true)
}
{
  // ⚠️ O caso que a regra 1 existe para resolver: o cadastro ERRADO tem mais dado que o certo.
  // Se a ordem das regras inverter, a sugestao passa a apontar para a matricula temporaria.
  const definitiva = cadastro({ id: 'a', matricula: '65567' })
  const temporaria = cadastro({ id: 'b', matricula: 'T2600103', escalas: 2, batidas: 67, folhas: 1 })
  const s = M.sugerirDestino(grupo([definitiva, temporaria]))
  checa('definitiva vence mesmo com menos dado', s && s.destinoId, 'a')
}
{
  // Duas definitivas: decide o peso.
  const magra = cadastro({ id: 'a', matricula: '111', batidas: 1 })
  const gorda = cadastro({ id: 'b', matricula: '222', batidas: 46, escalas: 2 })
  const s = M.sugerirDestino(grupo([magra, gorda]))
  checa('sem temporaria, vence o peso', s && s.destinoId, 'b')
}
{
  // Duas TEMPORARIAS (existe em producao: ANA LUCIA, T2600020 x T2600056): a regra 1 nao separa,
  // e o peso decide.
  const a = cadastro({ id: 'a', matricula: 'T2600020', batidas: 46, escalas: 2 })
  const b = cadastro({ id: 'b', matricula: 'T2600056', batidas: 5, escalas: 1 })
  const s = M.sugerirDestino(grupo([a, b]))
  checa('duas temporarias caem no peso', s && s.destinoId, 'a')
}
{
  // Empate real: NAO sugere. Este e o caso que nao pode virar palpite.
  const a = cadastro({ id: 'a', matricula: '111', batidas: 3 })
  const b = cadastro({ id: 'b', matricula: '222', batidas: 3 })
  checa('empate nao sugere nada', M.sugerirDestino(grupo([a, b])), null)
}
{
  // Duas definitivas e ambas vazias: tambem e empate.
  const a = cadastro({ id: 'a', matricula: '111' })
  const b = cadastro({ id: 'b', matricula: '222' })
  checa('dois vazios nao sugerem', M.sugerirDestino(grupo([a, b])), null)
}
checa('grupo de um nao sugere', M.sugerirDestino(grupo([cadastro({})])), null)
checa('grupo vazio nao quebra', M.sugerirDestino({ cpf: 'x', quantidade: 0, todos_confirmados: false, cadastros: [] }), null)
{
  // Tres cadastros, so um definitivo.
  const a = cadastro({ id: 'a', matricula: '65567' })
  const b = cadastro({ id: 'b', matricula: 'T2600103', batidas: 9 })
  const c = cadastro({ id: 'c', matricula: 'T2600104', batidas: 9 })
  const s = M.sugerirDestino(grupo([a, b, c]))
  checa('unica definitiva entre tres', s && s.destinoId, 'a')
}

// ---------------------------------------------------------------- peso
checa('peso soma tudo', M.pesoDoCadastro(cadastro({ escalas: 2, batidas: 67, folhas: 1, vinculos_rep: 3 })), 73)
checa('cadastro vazio e dito por extenso', M.descreverPeso(cadastro({})), 'nenhum vínculo — cadastro vazio')
checa('singular e plural', M.descreverPeso(cadastro({ escalas: 1, batidas: 2 })), '1 escala · 2 batidas')

// ---------------------------------------------------------------- rotulos e relato
checa('rotulo conhecido', M.rotularVinculo('marcacoes_ponto.servidor_id'), 'marcações de ponto')
checa('tabela desconhecida cai na chave crua', M.rotularVinculo('tabela_nova.servidor_id'), 'tabela_nova.servidor_id')
checa('troca como solicitante', M.rotularVinculo('solicitacoes_troca.solicitante_id'), 'pedidos de troca (como solicitante)')
checa('troca como destinatario', M.rotularVinculo('solicitacoes_troca.destinatario_id'), 'pedidos de troca (como destinatário)')

checa('relato vazio quando nada moveu', M.descreverMovimentacao({}), [])
checa('relato nulo nao quebra', M.descreverMovimentacao(null), [])
checa(
  'relato ordena pelo maior',
  M.descreverMovimentacao({ 'escala_mensal.servidor_id': 2, 'marcacoes_ponto.servidor_id': 67 }),
  ['67 marcações de ponto', '2 escalas mensais'],
)
// O proprio rastro da mesclagem nao e "vinculo movido" - ele e o efeito de ter mesclado.
checa(
  'rastro nao entra no relato',
  M.descreverMovimentacao({ 'servidores.mesclado_em_servidor_id': 1, 'folha_ponto.servidor_id': 2 }),
  ['2 folhas de ponto'],
)

// ---------------------------------------------------------------- validarEscolha
{
  const a = cadastro({ id: 'a' })
  const b = cadastro({ id: 'b' })
  const g = grupo([a, b])
  checa('par valido passa', M.validarEscolha(g, { origemId: 'a', destinoId: 'b' }).ok, true)
  checa('sem destino recusa', M.validarEscolha(g, { origemId: 'a' }).ok, false)
  checa('sem origem recusa', M.validarEscolha(g, { destinoId: 'b' }).ok, false)
  checa('iguais recusa', M.validarEscolha(g, { origemId: 'a', destinoId: 'a' }).ok, false)
  checa('id de fora recusa', M.validarEscolha(g, { origemId: 'z', destinoId: 'b' }).ok, false)
  checa('escolha vazia recusa', M.validarEscolha(g, {}).ok, false)
  const erro = M.validarEscolha(g, { origemId: 'a', destinoId: 'a' })
  checa('recusa explica', !erro.ok && erro.erro.length > 10, true)
}

// ---------------------------------------------------------------- avisos
{
  const origem = cadastro({ id: 'a', matricula: 'T2600103', escalas: 2, batidas: 67, setor: 'TEC ENFERMAGEM' })
  const destino = cadastro({ id: 'b', matricula: '65567' })
  const avisos = M.avisosDaMesclagem(origem, destino)
  checa('avisa sobre escala e sobre ponto', avisos.length, 2)
  checa('escala continua no setor', /continuam no setor/.test(avisos[0]), true)
  checa('batida so muda de dono', /só o dono/.test(avisos[1]), true)
}
{
  // Cadastro duplicado vazio: nao ha o que avisar sobre escala nem ponto.
  const avisos = M.avisosDaMesclagem(cadastro({ id: 'a' }), cadastro({ id: 'b' }))
  checa('duplicado vazio nao inventa aviso', avisos.length, 0)
}
{
  // Destino Inativo e um alerta: pode ser o cadastro errado sendo escolhido para ficar.
  const avisos = M.avisosDaMesclagem(cadastro({ id: 'a' }), cadastro({ id: 'b', status: 'Inativo', matricula: '999' }))
  checa('destino inativo avisa', avisos.length, 1)
  checa('e diz a situacao', /Inativo/.test(avisos[0]), true)
}

// ----------------------------------------------------------------
console.log(`${casos - falhas}/${casos} casos passaram`)
if (falhas) {
  console.error(`\n${falhas} FALHA(S).`)
  process.exit(1)
}

/*
 * REGRESSOES INJETADAS PARA VALIDAR O PORTAO (04/09/2026) - as tres reprovam:
 *
 *   1. sugerirDestino passando a olhar peso ANTES de matricula definitiva
 *      -> "definitiva vence mesmo com menos dado" falha (aponta para a temporaria);
 *   2. sugerirDestino devolvendo o primeiro cadastro quando o criterio empata
 *      -> "empate nao sugere nada" e "dois vazios nao sugerem" falham;
 *   3. descreverMovimentacao deixando de filtrar servidores.mesclado_em_servidor_id
 *      -> "rastro nao entra no relato" falha (a tela anunciaria "1 cadastros que apontam
 *         para este" como se fosse vinculo movido).
 */
