const { avaliarPermissaoTransferencia, ehAvaliadorDeTransferencia } = require('./_sim/avaliacaoTransferencia')
const U1 = 'u-hmi', U2 = 'u-crismu'
const casos = [
  ['super_admin avalia qualquer', { role: 'super_admin', unidadesPermitidas: [] }, { unidadeOrigemId: U1, unidadeDestinoId: U2 }, 'aprovar', true],
  ['rh avalia qualquer', { role: 'rh', unidadesPermitidas: [] }, { unidadeOrigemId: U1, unidadeDestinoId: U2 }, 'aprovar', true],
  ['rh_unidade aprova dentro da unidade', { role: 'rh_unidade', unidadesPermitidas: [U1] }, { unidadeOrigemId: U1, unidadeDestinoId: U1 }, 'aprovar', true],
  ['rh_unidade NAO aprova saida da unidade', { role: 'rh_unidade', unidadesPermitidas: [U1] }, { unidadeOrigemId: U1, unidadeDestinoId: U2 }, 'aprovar', false],
  ['rh_unidade NAO aprova entrada de fora', { role: 'rh_unidade', unidadesPermitidas: [U1] }, { unidadeOrigemId: U2, unidadeDestinoId: U1 }, 'aprovar', false],
  ['rh_unidade NAO aprova destino indefinido', { role: 'rh_unidade', unidadesPermitidas: [U1] }, { unidadeOrigemId: U1, unidadeDestinoId: null }, 'aprovar', false],
  ['rh_unidade rejeita da propria unidade', { role: 'rh_unidade', unidadesPermitidas: [U1] }, { unidadeOrigemId: U1, unidadeDestinoId: null }, 'rejeitar', true],
  ['rh_unidade NAO rejeita de outra unidade', { role: 'rh_unidade', unidadesPermitidas: [U1] }, { unidadeOrigemId: U2, unidadeDestinoId: U2 }, 'rejeitar', false],
  ['rh_unidade com duas unidades move entre elas', { role: 'rh_unidade', unidadesPermitidas: [U1, U2] }, { unidadeOrigemId: U1, unidadeDestinoId: U2 }, 'aprovar', true],
  ['coordenador nao avalia', { role: 'coordenador', unidadesPermitidas: [U1] }, { unidadeOrigemId: U1, unidadeDestinoId: U1 }, 'aprovar', false],
  ['admin nao avalia', { role: 'admin', unidadesPermitidas: [U1] }, { unidadeOrigemId: U1, unidadeDestinoId: U1 }, 'aprovar', false],
  ['ass_adm nao avalia', { role: 'ass_adm', unidadesPermitidas: [U1] }, { unidadeOrigemId: U1, unidadeDestinoId: U1 }, 'aprovar', false],
  ['sem papel nao avalia', { role: null, unidadesPermitidas: [] }, { unidadeOrigemId: U1, unidadeDestinoId: U1 }, 'aprovar', false],
  ['origem nula nao passa', { role: 'rh_unidade', unidadesPermitidas: [U1] }, { unidadeOrigemId: null, unidadeDestinoId: U1 }, 'aprovar', false],
]
let falhas = 0
for (const [nome, escopo, alvo, acao, esperado] of casos) {
  const r = avaliarPermissaoTransferencia(escopo, alvo, acao)
  const ok = r.ok === esperado
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${r.ok ? '' : ' :: ' + r.erro.slice(0, 60)}`)
}
console.log(`\nehAvaliadorDeTransferencia: super_admin=${ehAvaliadorDeTransferencia('super_admin')} rh=${ehAvaliadorDeTransferencia('rh')} rh_unidade=${ehAvaliadorDeTransferencia('rh_unidade')} coordenador=${ehAvaliadorDeTransferencia('coordenador')}`)
console.log(falhas === 0 ? `\n${casos.length} casos, todos OK` : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
