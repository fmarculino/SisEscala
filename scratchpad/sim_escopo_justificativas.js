/**
 * PORTAO: alcancaEvento tem de concordar com applyAccessFilters, caso a caso.
 * Transpile antes:
 *   npx tsc src/utils/gestaoJustificativas.ts --outDir scratchpad/_sim --module commonjs --target es2020
 */
const { alcancaEvento } = require('./_sim/gestaoJustificativas.js')

let passou = 0
const falhas = []
const ok = (nome, real, esperado) => {
  if (real === esperado) passou++
  else falhas.push(`${nome}  esperado=${esperado} obtido=${real}`)
}

const U1 = 'u1', U2 = 'u2', S1 = 's1', S2 = 's2'
const ator = (o) => ({ acesso_todas_unidades: false, acesso_todos_setores: false,
                       permitted_unidades: [], permitted_setores: [], ...o })
const evU1 = { unidade_id: U1, setor_id: S1 }
const evU2 = { unidade_id: U2, setor_id: S2 }

// --- Papeis irrestritos -----------------------------------------------------
ok('super_admin alcanca qualquer unidade', alcancaEvento(ator({ role: 'super_admin' }), evU2), true)
ok('rh (RH Geral) alcanca qualquer unidade', alcancaEvento(ator({ role: 'rh' }), evU2), true)

// --- rh_unidade: so as unidades dele ----------------------------------------
ok('rh_unidade na unidade dele', alcancaEvento(ator({ role: 'rh_unidade', permitted_unidades: [U1] }), evU1), true)
ok('rh_unidade fora da unidade dele', alcancaEvento(ator({ role: 'rh_unidade', permitted_unidades: [U1] }), evU2), false)

// --- 🚨 O BURACO: as 24 contas medidas em producao --------------------------
// coordenador / ass_adm / admin com acesso_todos_setores, sem acesso_todas_unidades,
// 1 unidade vinculada e ZERO setores. Era `true` para a rede inteira.
for (const papel of ['coordenador', 'ass_adm', 'admin']) {
  const a = ator({ role: papel, acesso_todos_setores: true, permitted_unidades: [U1] })
  ok(`${papel} c/ flag: alcanca a PROPRIA unidade (nao pode regredir)`, alcancaEvento(a, evU1), true)
  ok(`${papel} c/ flag: NAO alcanca outra unidade (buraco fechado)`, alcancaEvento(a, evU2), false)
}

// O caso concreto: ass_adm sem NENHUM vinculo (VICTOR, medido em producao).
// applyAccessFilters devolvia zero linha; alcancaEvento devolvia a rede inteira.
const semVinculo = ator({ role: 'ass_adm', acesso_todos_setores: true })
ok('ass_adm sem vinculo nenhum nao alcanca nada (era TUDO)', alcancaEvento(semVinculo, evU1), false)
ok('ass_adm sem vinculo nenhum nao alcanca outra unidade', alcancaEvento(semVinculo, evU2), false)

// --- Os 53 coordenadores SEM flag, todos com setor vinculado ----------------
const porSetor = ator({ role: 'coordenador', permitted_setores: [S1] })
ok('coordenador sem flag alcanca o setor dele', alcancaEvento(porSetor, evU1), true)
ok('coordenador sem flag nao alcanca outro setor', alcancaEvento(porSetor, evU2), false)

// Coordenador so por setor, sem a unidade-pai vinculada (piloto da TI).
const soSetor = ator({ role: 'coordenador', permitted_setores: [S2] })
ok('acesso vindo so de profile_setores continua valendo', alcancaEvento(soSetor, evU2), true)

// Sem flag e COM unidade vinculada: a unidade sozinha nunca bastou.
const unidSemFlag = ator({ role: 'coordenador', permitted_unidades: [U1] })
ok('unidade vinculada SEM a flag nao alcanca a unidade', alcancaEvento(unidSemFlag, evU1), false)

// --- acesso_todas_unidades: o unico alcance global de papel escopado --------
ok('admin c/ todas as unidades + todos os setores alcanca tudo',
  alcancaEvento(ator({ role: 'admin', acesso_todas_unidades: true, acesso_todos_setores: true }), evU2), true)
ok('admin c/ todas as unidades e SEM setor vinculado alcanca tudo',
  alcancaEvento(ator({ role: 'admin', acesso_todas_unidades: true }), evU2), true)
ok('admin c/ todas as unidades mas setores recortados: dentro',
  alcancaEvento(ator({ role: 'admin', acesso_todas_unidades: true, permitted_setores: [S2] }), evU2), true)
ok('admin c/ todas as unidades mas setores recortados: fora',
  alcancaEvento(ator({ role: 'admin', acesso_todas_unidades: true, permitted_setores: [S2] }), evU1), false)

// --- Papeis do Portal e evento sem escopo -----------------------------------
ok('servidor nunca alcanca', alcancaEvento(ator({ role: 'servidor' }), evU1), false)
ok('comum nunca alcanca', alcancaEvento(ator({ role: 'comum' }), evU1), false)
ok('evento sem unidade/setor nao vaza por undefined',
  alcancaEvento(ator({ role: 'coordenador', acesso_todos_setores: true, permitted_unidades: [U1] }),
                { unidade_id: undefined, setor_id: undefined }), false)

console.log(`\n  ${passou} de ${passou + falhas.length} casos passaram\n`)
if (falhas.length) { falhas.forEach(f => console.log(`  FALHOU  ${f}`)); process.exit(1) }
console.log('  Portao OK\n')
