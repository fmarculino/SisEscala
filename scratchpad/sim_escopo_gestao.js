// Portao de src/utils/escopoGestao.ts — a regra compartilhada por /marcacoes e
// /servidores/pendencias.
//
// Transpile antes:
//   npx tsc src/utils/escopoGestao.ts --outDir scratchpad/_sim --module commonjs --target es2020
//   node scratchpad/sim_escopo_gestao.js
const E = require('./_sim/escopoGestao')

let ok = 0
let falhas = 0
function eq(real, esperado, rotulo) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado)
  if (bate) { ok++ } else { falhas++; console.error(`  FALHA  ${rotulo}\n         esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`) }
}

const HMI = 'u-hmi'
const HMM = 'u-hmm'
const SMS = 'u-sms'

const irrestritos = ['super_admin', 'admin', 'rh']
const escopado = { role: 'rh_unidade', unidadesPermitidas: [HMI] }
const coord = { role: 'coordenador', unidadesPermitidas: [HMI] }
const assAdm = { role: 'ass_adm', unidadesPermitidas: [HMI] }
const portal = { role: 'servidor', unidadesPermitidas: [] }

// ---------------------------------------------------------------- papeis
console.log('=== quem gerencia ===')
for (const r of irrestritos) {
  eq(E.podeGerirMarcacoes(r), true, `${r} gerencia marcacoes`)
  eq(E.gerenciaSemEscopo(r), true, `${r} e irrestrito`)
  eq(E.ehEscopadoPorUnidade(r), false, `${r} nao e escopado`)
  eq(E.podeVerDiagnosticoCadastro(r), true, `${r} ve diagnostico de cadastro`)
}
eq(E.podeGerirMarcacoes('rh_unidade'), true, 'rh_unidade gerencia marcacoes')
eq(E.gerenciaSemEscopo('rh_unidade'), false, 'rh_unidade NAO e irrestrito')
eq(E.ehEscopadoPorUnidade('rh_unidade'), true, 'rh_unidade e escopado')
eq(E.podeVerDiagnosticoCadastro('rh_unidade'), true, 'rh_unidade ve diagnostico')

// 🚨 O ponto da mudanca: coordenador e ass_adm NAO ganharam nada. Abrir a tela "para os
// gestores" em vez de "para os RHs" e o erro que este portao existe para pegar.
for (const r of ['coordenador', 'ass_adm', 'servidor', 'comum', null, undefined, '']) {
  eq(E.podeGerirMarcacoes(r), false, `${r} NAO gerencia marcacoes`)
  eq(E.podeVerDiagnosticoCadastro(r), false, `${r} NAO ve diagnostico`)
  eq(E.podeMesclarCadastros(r), false, `${r} NAO mescla`)
}

// ---------------------------------------------------------------- mesclagem
console.log('=== quem mescla ===')
eq(E.podeMesclarCadastros('super_admin'), true, 'super_admin mescla')
eq(E.podeMesclarCadastros('rh'), true, 'RH Geral mescla (novo em 10/09/2026)')
// Decisao do usuario com o numero na frente: 27 dos 62 grupos atravessam unidade e 31 ja tem
// ponto/escala/folha. RH da Unidade VE e nao executa.
eq(E.podeMesclarCadastros('rh_unidade'), false, 'RH da Unidade NAO mescla')
eq(E.podeMesclarCadastros('admin'), false, 'Diretor NAO mescla')

// ---------------------------------------------------------------- unidade
console.log('=== alcance por unidade ===')
for (const r of irrestritos) {
  const esc = { role: r, unidadesPermitidas: [] }
  eq(E.unidadeNoEscopo(esc, HMM), true, `${r} alcanca unidade sem vinculo nenhum`)
  eq(E.unidadeNoEscopo(esc, null), true, `${r} alcanca unidade nula`)
}
eq(E.unidadeNoEscopo(escopado, HMI), true, 'rh_unidade alcanca a propria')
eq(E.unidadeNoEscopo(escopado, HMM), false, 'rh_unidade NAO alcanca a de fora')
// Na duvida, fecha: item sem unidade nao pode passar por omissao.
eq(E.unidadeNoEscopo(escopado, null), false, 'rh_unidade NAO alcanca unidade nula')
eq(E.unidadeNoEscopo(escopado, undefined), false, 'rh_unidade NAO alcanca unidade indefinida')
eq(E.unidadeNoEscopo(coord, HMI), false, 'coordenador nao alcanca nada, nem a propria unidade')
eq(E.unidadeNoEscopo(portal, HMI), false, 'papel do Portal nao alcanca nada')

// ⚠️ acesso_todas_unidades NAO amplia rh_unidade — o modulo nem le a flag. Se um dia ela entrar
// aqui, a tela passaria a mostrar o que a policy de servidores recusa.
eq(
  E.unidadeNoEscopo({ role: 'rh_unidade', unidadesPermitidas: [HMI], acesso_todas_unidades: true }, HMM),
  false,
  'acesso_todas_unidades nao amplia rh_unidade',
)

// ---------------------------------------------------------------- listas
console.log('=== filtro de lista ===')
const relogios = [
  { id: 'r1', unidade_id: HMI },
  { id: 'r2', unidade_id: HMM },
  { id: 'r3', unidade_id: SMS },
  { id: 'r4', unidade_id: null },
]
const porUnidade = (x) => x.unidade_id
eq(E.filtrarPorUnidade({ role: 'rh', unidadesPermitidas: [] }, relogios, porUnidade).length, 4, 'RH Geral ve os 4')
eq(E.filtrarPorUnidade(escopado, relogios, porUnidade).map((x) => x.id), ['r1'], 'rh_unidade ve so o dele')
eq(E.filtrarPorUnidade(coord, relogios, porUnidade), [], 'coordenador ve lista vazia')
eq(E.filtrarPorUnidade(escopado, [], porUnidade), [], 'lista vazia continua vazia')

// ---------------------------------------------------------------- grupos
console.log('=== grupo de duplicidade ===')
// Basta UM cadastro no escopo, e o grupo vem INTEIRO. No HMI, 40 dos 52 grupos tem membro de
// outra unidade — exigir o grupo todo dentro do escopo deixaria o RH com 12 de 52.
eq(E.grupoNoEscopo(escopado, [HMI, HMM]), true, 'grupo cruzado aparece (um lado e dele)')
eq(E.grupoNoEscopo(escopado, [HMM, SMS]), false, 'grupo inteiramente de fora nao aparece')
eq(E.grupoNoEscopo(escopado, [HMI]), true, 'grupo so dele aparece')
eq(E.grupoNoEscopo(escopado, [null, HMI]), true, 'membro sem unidade nao atrapalha')
eq(E.grupoNoEscopo(escopado, [null, null]), false, 'grupo so com membro sem unidade nao aparece')
eq(E.grupoNoEscopo(escopado, []), false, 'grupo vazio nao aparece')
eq(E.grupoNoEscopo({ role: 'rh', unidadesPermitidas: [] }, [HMM, SMS]), true, 'RH Geral ve qualquer grupo')
eq(E.grupoNoEscopo(coord, [HMI]), false, 'coordenador nao ve grupo nenhum')

// ---------------------------------------------------------------- montagem
console.log('=== montagem do escopo ===')
eq(
  E.montarEscopoGestao({ role: 'rh_unidade', profile_unidades: [{ unidade_id: HMI }], profile_setores: [] }),
  { role: 'rh_unidade', unidadesPermitidas: [HMI] },
  'profile_unidades vira alcance',
)
// A uniao com profile_setores nao e zelo: perfil cujo acesso vem so de setor abriria a tela
// vazia sem nenhuma mensagem.
eq(
  E.montarEscopoGestao({
    role: 'rh_unidade',
    profile_unidades: [],
    profile_setores: [{ setores: { unidade_id: HMM } }],
  }),
  { role: 'rh_unidade', unidadesPermitidas: [HMM] },
  'unidade alcancada so por setor entra',
)
// O embed do PostgREST as vezes chega como array — as duas formas tem que funcionar.
eq(
  E.montarEscopoGestao({
    role: 'rh_unidade',
    profile_unidades: [{ unidade_id: HMI }],
    profile_setores: [{ setores: [{ unidade_id: HMM }] }],
  }),
  { role: 'rh_unidade', unidadesPermitidas: [HMI, HMM] },
  'embed em array tambem e lido',
)
eq(
  E.montarEscopoGestao({
    role: 'rh_unidade',
    profile_unidades: [{ unidade_id: HMI }],
    profile_setores: [{ setores: { unidade_id: HMI } }],
  }).unidadesPermitidas,
  [HMI],
  'unidade repetida nao duplica',
)
eq(E.montarEscopoGestao(null), { role: null, unidadesPermitidas: [] }, 'perfil nulo nao levanta')
eq(E.montarEscopoGestao({ role: 'rh' }), { role: 'rh', unidadesPermitidas: [] }, 'perfil sem embeds nao levanta')
eq(
  E.montarEscopoGestao({ role: 'rh_unidade', profile_setores: [{ setores: null }] }).unidadesPermitidas,
  [],
  'setor sem unidade nao vira undefined na lista',
)

// ---------------------------------------------------------------- mensagens
console.log('=== mensagens ===')
for (const m of ['ERRO_SEM_GESTAO_MARCACOES', 'ERRO_UNIDADE_FORA_DO_ESCOPO', 'ERRO_SEM_DIAGNOSTICO_CADASTRO', 'ERRO_SEM_MESCLAGEM']) {
  eq(typeof E[m] === 'string' && E[m].length > 20, true, `${m} existe e explica`)
}
// Mensagem que so diz "sem permissao" manda investigar papel quando a causa e unidade — foi
// exatamente o que custou um dia de diagnostico na armadilha 59.
eq(/unidade/i.test(E.ERRO_UNIDADE_FORA_DO_ESCOPO), true, 'a recusa por unidade DIZ que e unidade')
eq(/RH Geral|Administrador/i.test(E.ERRO_UNIDADE_FORA_DO_ESCOPO), true, 'a recusa diz a quem recorrer')
eq(/ponto|escala|folha/i.test(E.ERRO_SEM_MESCLAGEM), true, 'a recusa de mesclar diz o que a mesclagem move')

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
