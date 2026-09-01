/**
 * Portão de `src/utils/autorizacaoCarga.ts` — não há framework de teste no projeto.
 *
 * Transpile antes:
 *   npx tsc src/utils/autorizacaoCarga.ts --outDir scratchpad/_sim --module commonjs --target es2020
 * Rode:
 *   node scratchpad/sim_autorizacao_carga.js
 *
 * O que ele defende, e por quê:
 *  - RH Geral e RH da Unidade AUTORIZAM (decisão do usuário, 31/08/2026). Se alguém "simplificar"
 *    de volta para admin-only, 15 pessoas voltam a depender de 5.
 *  - Coordenador e Ass. Administrativo SOLICITAM — e nunca autorizam. Autorizar aqui esvazia o
 *    teto: vira um clique de quem está lançando.
 *  - Papéis do Portal (`servidor`, `comum`) não fazem nem uma coisa nem outra.
 *  - ⚠️ Nenhum texto pode mandar "solicite a um Administrador": era a instrução que o sistema
 *    não cumpria, e é o defeito que esta mudança inteira existe para fechar.
 */
const {
  podeAutorizarCarga,
  podeSolicitarCarga,
  acaoParaTetoExcedido,
  mensagemTetoExcedido,
  instrucaoSalvarBloqueado,
  rotuloStatusSolicitacao,
} = require('./_sim/autorizacaoCarga')

let falhas = 0
let total = 0
function ok(nome, cond) {
  total++
  if (!cond) { falhas++; console.error('  FALHOU:', nome) }
}

// --- quem autoriza -----------------------------------------------------------
for (const r of ['super_admin', 'admin', 'rh', 'rh_unidade']) {
  ok(`${r} autoriza`, podeAutorizarCarga(r) === true)
  ok(`${r} -> acao autorizar`, acaoParaTetoExcedido(r) === 'autorizar')
}
for (const r of ['coordenador', 'ass_adm', 'servidor', 'comum', '', null, undefined, 'papel_inventado']) {
  ok(`${r} NAO autoriza`, podeAutorizarCarga(r) === false)
}

// --- quem solicita -----------------------------------------------------------
for (const r of ['super_admin', 'admin', 'rh', 'rh_unidade', 'coordenador', 'ass_adm', 'papel_novo_qualquer']) {
  ok(`${r} pode solicitar`, podeSolicitarCarga(r) === true)
}
for (const r of ['servidor', 'comum', null, undefined, '']) {
  ok(`${r} NAO solicita`, podeSolicitarCarga(r) === false)
}
ok('coordenador -> acao solicitar', acaoParaTetoExcedido('coordenador') === 'solicitar')
ok('ass_adm -> acao solicitar', acaoParaTetoExcedido('ass_adm') === 'solicitar')
ok('servidor -> acao nada', acaoParaTetoExcedido('servidor') === 'nada')

// ⚠️ Denylist e não allowlist: papel que ainda não existe tem de nascer podendo SOLICITAR (o
// caminho seguro) e sem poder AUTORIZAR (o caminho que amplia teto). Foi a allowlist que deixou
// rh/rh_unidade/ass_adm de fora por três meses.
ok('papel novo solicita', podeSolicitarCarga('papel_que_sera_criado_em_2027') === true)
ok('papel novo nao autoriza', podeAutorizarCarga('papel_que_sera_criado_em_2027') === false)

// --- textos ------------------------------------------------------------------
const DET = 'FULANO soma 409h no mês.'
const textos = [
  mensagemTetoExcedido(DET, 'coordenador'),
  mensagemTetoExcedido(DET, 'rh'),
  mensagemTetoExcedido(DET, 'rh_unidade'),
  mensagemTetoExcedido(DET, 'ass_adm'),
  mensagemTetoExcedido(DET, 'servidor'),
  mensagemTetoExcedido(DET, 'coordenador', { id: 'x', solicitado_por_nome: 'MARIA', solicitado_em: '2026-08-30T12:00:00Z' }),
  mensagemTetoExcedido(DET, 'rh', { id: 'x', solicitado_por_nome: 'MARIA' }),
]
for (const t of textos) {
  ok('texto nao manda pedir a um Administrador', !/[Ss]olicite a um Administrador/.test(t.mensagem))
  ok('texto carrega o detalhe medido', t.mensagem.includes(DET))
  ok('texto tem titulo', typeof t.titulo === 'string' && t.titulo.length > 0)
}
for (const r of ['coordenador', 'rh', 'rh_unidade', 'ass_adm', 'servidor', 'admin']) {
  ok(`instrucaoSalvarBloqueado(${r}) sem "um Administrador"`,
    !/[Ss]olicite a um Administrador/.test(instrucaoSalvarBloqueado(r)))
}

ok('coordenador e convidado a solicitar', /solicitar ao RH/i.test(mensagemTetoExcedido(DET, 'coordenador').mensagem))
ok('rh e convidado a conceder', /conceder uma Autorização/i.test(mensagemTetoExcedido(DET, 'rh').mensagem))
ok('portal nao e convidado a nada', /Reduza a escala/i.test(mensagemTetoExcedido(DET, 'servidor').mensagem))

// Pedido em aberto: a tela NÃO pode convidar a pedir de novo -- a RPC recusaria com "já existe
// pedido pendente", e a tela teria mandado fazer algo que ela mesma nega.
const comPedido = mensagemTetoExcedido(DET, 'coordenador', {
  id: 'x', solicitado_por_nome: 'MARIA', solicitado_em: '2026-08-30T12:00:00Z',
})
ok('pedido pendente nomeia quem pediu', comPedido.mensagem.includes('MARIA'))
ok('pedido pendente nao convida a pedir de novo', !/Deseja abrir o pedido agora/.test(comPedido.mensagem))
ok('pedido pendente muda o titulo', comPedido.titulo.includes('em análise'))

// --- rótulos -----------------------------------------------------------------
ok('rotulo pendente', rotuloStatusSolicitacao('pendente') === 'Pendente')
ok('rotulo aprovada', rotuloStatusSolicitacao('aprovada') === 'Aprovada')
ok('rotulo desconhecido devolve o proprio valor', rotuloStatusSolicitacao('xpto') === 'xpto')

console.log(`${total - falhas}/${total} casos OK`)
if (falhas) { console.error(`${falhas} FALHA(S)`); process.exit(1) }
