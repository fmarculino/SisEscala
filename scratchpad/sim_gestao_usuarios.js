// Simulacao das regras de src/utils/gestaoUsuarios.ts sobre os casos que importam.
// Nao ha framework de teste no projeto (CLAUDE.md), entao o portao e este script.
// Transpile antes:
//   npx tsc src/utils/gestaoUsuarios.ts --outDir scratchpad/_sim --module commonjs --target es2020
const { alcancaUsuario, validarPayload, PAPEIS_ATRIBUIVEIS, podeExcluirUsuarios } = require('./_sim/gestaoUsuarios.js')


const U1 = 'unidade-do-rh', U2 = 'outra-unidade'
const S1 = 'setor-da-u1', S2 = 'setor-da-u2'
const mapa = new Map([[S1, U1], [S2, U2]])

const superAdmin = { id: 'g0', role: 'super_admin', unidades: [] }
const rhGeral    = { id: 'g1', role: 'rh', unidades: [] }
const rhUnidade  = { id: 'g2', role: 'rh_unidade', unidades: [U1] }

const alvo = (role, o = {}) => ({
  role,
  acesso_todas_unidades: o.todas || false,
  permitted_unidades: o.u || [],
  permitted_setores: o.s || [],
})

let falhas = 0
function checa(nome, obtido, esperado) {
  const ok = obtido === esperado
  if (!ok) falhas++
  console.log(`${ok ? 'ok  ' : 'FALHA'} | ${nome} => ${obtido}`)
}

console.log('--- VER / ADMINISTRAR ---')
checa('super_admin ve Administrador Geral', alcancaUsuario(superAdmin, alvo('super_admin'), mapa), true)
checa('RH Geral NAO ve Administrador Geral', alcancaUsuario(rhGeral, alvo('super_admin'), mapa), false)
checa('RH Geral ve Diretor de qualquer unidade', alcancaUsuario(rhGeral, alvo('admin', { u: [U2] }), mapa), true)
checa('RH Geral ve outro RH Geral', alcancaUsuario(rhGeral, alvo('rh', { todas: true }), mapa), true)
checa('RH Unidade ve coordenador da unidade dele', alcancaUsuario(rhUnidade, alvo('coordenador', { u: [U1] }), mapa), true)
checa('RH Unidade ve coordenador so por SETOR da unidade dele', alcancaUsuario(rhUnidade, alvo('coordenador', { s: [S1] }), mapa), true)
checa('RH Unidade NAO ve coordenador de outra unidade', alcancaUsuario(rhUnidade, alvo('coordenador', { u: [U2] }), mapa), false)
checa('RH Unidade NAO ve coordenador por setor de outra unidade', alcancaUsuario(rhUnidade, alvo('coordenador', { s: [S2] }), mapa), false)
checa('RH Unidade NAO ve conta que pega as duas unidades', alcancaUsuario(rhUnidade, alvo('coordenador', { u: [U1, U2] }), mapa), false)
checa('RH Unidade NAO ve conta com Acesso Total', alcancaUsuario(rhUnidade, alvo('coordenador', { todas: true, u: [U1] }), mapa), false)
checa('RH Unidade NAO ve RH Geral', alcancaUsuario(rhUnidade, alvo('rh', { u: [U1] }), mapa), false)
checa('RH Unidade NAO ve Diretor', alcancaUsuario(rhUnidade, alvo('admin', { u: [U1] }), mapa), false)
checa('RH Unidade NAO ve Administrador Geral', alcancaUsuario(rhUnidade, alvo('super_admin', { u: [U1] }), mapa), false)
checa('RH Unidade NAO ve conta orfa (sem perfil)', alcancaUsuario(rhUnidade, alvo('comum'), mapa), false)
checa('super_admin ve conta orfa', alcancaUsuario(superAdmin, alvo('comum'), mapa), true)
checa('RH Geral ve conta orfa', alcancaUsuario(rhGeral, alvo('comum'), mapa), true)
checa('RH Unidade sem unidade vinculada nao ve ninguem',
  alcancaUsuario({ id: 'g3', role: 'rh_unidade', unidades: [] }, alvo('coordenador', { u: [U1] }), mapa), false)

console.log('\n--- CRIAR / EDITAR (payload) ---')
const pl = (role, o = {}) => ({
  role,
  acesso_todas_unidades: o.todas || false,
  unidade_ids: o.u || [],
  setor_ids: o.s || [],
  acesso_todos_setores: o.todosSetores || false,
})
const okPayload = (g, p) => validarPayload(g, p, mapa) === null

checa('super_admin cria Administrador Geral', okPayload(superAdmin, pl('super_admin', { todas: true })), true)
checa('RH Geral NAO cria Administrador Geral', okPayload(rhGeral, pl('super_admin', { todas: true })), false)
checa('RH Geral cria Diretor com Acesso Total', okPayload(rhGeral, pl('admin', { todas: true })), true)
checa('RH Geral cria RH da Unidade', okPayload(rhGeral, pl('rh_unidade', { u: [U2] })), true)
checa('RH Unidade cria coordenador na unidade dele', okPayload(rhUnidade, pl('coordenador', { u: [U1] })), true)
checa('RH Unidade cria ass_adm por setor da unidade dele', okPayload(rhUnidade, pl('ass_adm', { s: [S1] })), true)
checa('RH Unidade cria outro RH da Unidade', okPayload(rhUnidade, pl('rh_unidade', { u: [U1], todosSetores: true })), true)
checa('RH Unidade NAO cria RH Geral', okPayload(rhUnidade, pl('rh', { u: [U1] })), false)
checa('RH Unidade NAO cria Diretor', okPayload(rhUnidade, pl('admin', { u: [U1] })), false)
checa('RH Unidade NAO cria Administrador Geral', okPayload(rhUnidade, pl('super_admin', { u: [U1] })), false)
checa('RH Unidade NAO concede Acesso Total', okPayload(rhUnidade, pl('coordenador', { todas: true })), false)
checa('RH Unidade NAO cria em outra unidade', okPayload(rhUnidade, pl('coordenador', { u: [U2] })), false)
checa('RH Unidade NAO cria sem vinculo nenhum', okPayload(rhUnidade, pl('coordenador')), false)
checa('RH Unidade NAO cria pegando a unidade dele + outra', okPayload(rhUnidade, pl('coordenador', { u: [U1, U2] })), false)

console.log('\n--- EXCLUSAO ---')
checa('super_admin exclui', podeExcluirUsuarios('super_admin'), true)
checa('RH Geral NAO exclui', podeExcluirUsuarios('rh'), false)
checa('RH Unidade NAO exclui', podeExcluirUsuarios('rh_unidade'), false)

console.log(`\n${falhas === 0 ? 'TODOS OS CASOS PASSARAM' : falhas + ' FALHA(S)'}`)
process.exit(falhas === 0 ? 0 : 1)
