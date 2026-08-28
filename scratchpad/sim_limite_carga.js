// Portao de src/utils/limiteCargaMensal.ts (28/08/2026). Nao ha framework de teste.
// Transpile antes:
//   npx tsc src/utils/limiteCargaMensal.ts --outDir scratchpad/_sim --module commonjs --target es2020
const {
  avaliarCarga,
  tetoEfetivo,
  descreverExcesso,
  descreverEscalas,
  avisoAoAdicionar,
  formatarHoras,
  TETO_HORAS_PADRAO,
  TETO_SOBREAVISOS_PADRAO,
} = require('./_sim/limiteCargaMensal')

let falhas = 0
function ok(nome, cond, detalhe) {
  if (cond) { console.log('  ok   ' + nome); return }
  falhas++
  console.log('  FALHA ' + nome + (detalhe !== undefined ? '  -> ' + JSON.stringify(detalhe) : ''))
}

// Caso real medido em producao em 28/08/2026: JEANE, 09/2026, HMI.
const ACOLHIMENTO = {
  escala_mensal_id: 'em-acolhimento',
  unidade_nome: 'HMI - Hospital Materno Infantil',
  setor_caminho: 'SHL \\ ACOLHIMENTO',
  status: 'Rascunho',
  horas: 289,
  sobreavisos: 0,
}
const LAVANDERIA = {
  escala_mensal_id: 'em-lavanderia',
  unidade_nome: 'HMI - Hospital Materno Infantil',
  setor_caminho: 'SHL \\ LAVANDERIA',
  status: 'Rascunho',
  horas: 120,
  sobreavisos: 0,
}
const TETO = {
  teto_horas: 300,
  teto_sobreavisos: 20,
  limite_global_horas: 300,
  limite_global_sobreavisos: 20,
  horas_autorizadas: 0,
  sobreavisos_autorizados: 0,
  motivo_justificativa: null,
}

console.log('\n== o caso que motivou tudo ==')
{
  // Grade da LAVANDERIA (120h lancadas ali), com a carga das DUAS escalas vinda do banco.
  const a = avaliarCarga({
    horasLocais: 120,
    sobreavisosLocais: 0,
    cargas: [ACOLHIMENTO, LAVANDERIA],
    escalaMensalIdAtual: 'em-lavanderia',
    teto: TETO,
  })
  ok('a propria escala nao soma duas vezes (409h, nao 529h)', a.totalHoras === 409, a.totalHoras)
  ok('horasOutras = so o ACOLHIMENTO', a.horasOutras === 289, a.horasOutras)
  ok('excede o teto de 300h', a.excedeHoras === true)
  ok('nao excede sobreaviso', a.excedeSobreavisos === false)
  ok('lista uma escala externa', a.outras.length === 1 && a.outras[0].escala_mensal_id === 'em-acolhimento')

  const txt = descreverExcesso(a, 'JEANE CONCEICAO SILVA')
  ok('o texto diz o total', txt.includes('409h'))
  ok('o texto diz o teto', txt.includes('300h'))
  ok('o texto diz ONDE estao as outras horas', txt.includes('SHL \\ ACOLHIMENTO') && txt.includes('289h'))
  ok('o texto diz quanto e desta escala', txt.includes('Nesta escala: 120h'))
}

console.log('\n== a mesma grade, vista do outro lado ==')
{
  const a = avaliarCarga({
    horasLocais: 289,
    sobreavisosLocais: 0,
    cargas: [ACOLHIMENTO, LAVANDERIA],
    escalaMensalIdAtual: 'em-acolhimento',
    teto: TETO,
  })
  ok('total identico dos dois lados', a.totalHoras === 409, a.totalHoras)
  ok('agora a externa e a LAVANDERIA', a.outras.length === 1 && a.outras[0].horas === 120)
}

console.log('\n== sem carga externa: resultado identico ao comportamento antigo ==')
{
  const a = avaliarCarga({
    horasLocais: 289,
    sobreavisosLocais: 0,
    cargas: [ACOLHIMENTO],
    escalaMensalIdAtual: 'em-acolhimento',
    teto: TETO,
  })
  ok('total = so a grade', a.totalHoras === 289, a.totalHoras)
  ok('nao excede', a.excedeHoras === false)
  ok('nenhuma externa listada', a.outras.length === 0)
  ok('descreverExcesso nao inventa secao "o restante esta em"', !descreverExcesso(a, 'X').includes('restante'))
}

console.log('\n== a grade viva manda sobre o que o banco tem daquela escala ==')
{
  // O coordenador apagou meio mes e ainda nao salvou: o banco diz 289h, a grade diz 10h.
  const a = avaliarCarga({
    horasLocais: 10,
    sobreavisosLocais: 0,
    cargas: [ACOLHIMENTO, LAVANDERIA],
    escalaMensalIdAtual: 'em-acolhimento',
    teto: TETO,
  })
  ok('usa as 10h da grade, nao as 289h salvas', a.totalHoras === 130, a.totalHoras)
  ok('deixou de exceder', a.excedeHoras === false)
}

console.log('\n== escala externa VAZIA nao vira linha ==')
{
  const vazia = { ...LAVANDERIA, escala_mensal_id: 'em-vazia', horas: 0, sobreavisos: 0 }
  const a = avaliarCarga({
    horasLocais: 100,
    sobreavisosLocais: 0,
    cargas: [vazia],
    escalaMensalIdAtual: 'em-atual',
    teto: TETO,
  })
  // Dos 49 servidores em 2+ escalas em 09/2026, so 14 tinham carga nas duas. Listar as vazias
  // encheria o tooltip de linhas "0h" que nao dizem nada.
  ok('escala externa sem carga e ignorada', a.outras.length === 0)
  ok('total inalterado', a.totalHoras === 100)
}

console.log('\n== a Autorizacao Extraordinaria eleva o teto ==')
{
  const tetoComExcecao = { ...TETO, teto_horas: 450, horas_autorizadas: 150 }
  const a = avaliarCarga({
    horasLocais: 120,
    sobreavisosLocais: 0,
    cargas: [ACOLHIMENTO, LAVANDERIA],
    escalaMensalIdAtual: 'em-lavanderia',
    teto: tetoComExcecao,
  })
  ok('409h passa a caber em 450h', a.excedeHoras === false)
  ok('o total nao muda, so o teto', a.totalHoras === 409 && a.tetoHoras === 450)
}

console.log('\n== sobreaviso e eixo proprio: nao entra nas horas ==')
{
  const sobExterno = {
    escala_mensal_id: 'em-ti',
    unidade_nome: 'SMS - Secretaria Municipal de Saúde',
    setor_caminho: 'ADMINISTRAÇÃO \\ TECNOLOGIA DA INFORMAÇÃO',
    status: 'Rascunho',
    horas: 0,
    sobreavisos: 15,
  }
  const a = avaliarCarga({
    horasLocais: 100,
    sobreavisosLocais: 8,
    cargas: [sobExterno],
    escalaMensalIdAtual: 'em-atual',
    teto: TETO,
  })
  ok('horas nao contam sobreaviso', a.totalHoras === 100, a.totalHoras)
  ok('sobreavisos somam entre escalas', a.totalSobreavisos === 23, a.totalSobreavisos)
  ok('excede o teto de 20 un', a.excedeSobreavisos === true)
  ok('nao excede horas', a.excedeHoras === false)
  ok('escala so com sobreaviso entra na lista', a.outras.length === 1)
  ok('o texto do sobreaviso cita unidades', descreverExcesso(a, 'X').includes('23 unidades'))
  ok('a linha da escala cita as unidades', descreverEscalas(a.outras)[0].includes('15 un de sobreaviso'))
}

console.log('\n== teto ausente cai no padrao, nunca em NaN ==')
{
  const t = tetoEfetivo(null)
  ok('padrao 300h', t.horas === TETO_HORAS_PADRAO && t.horas === 300)
  ok('padrao 10 un', t.sobreavisos === TETO_SOBREAVISOS_PADRAO && t.sobreavisos === 10)
  const a = avaliarCarga({ horasLocais: 301, sobreavisosLocais: 0, cargas: null, escalaMensalIdAtual: null, teto: null })
  ok('sem teto do banco ainda recusa acima de 300h', a.excedeHoras === true)
}

console.log('\n== fronteira: igual ao teto PASSA, um a mais NAO ==')
{
  const base = { horasLocais: 0, sobreavisosLocais: 0, cargas: [], escalaMensalIdAtual: null, teto: TETO }
  ok('300h cabe', avaliarCarga({ ...base, horasLocais: 300 }).excedeHoras === false)
  ok('300,5h nao cabe', avaliarCarga({ ...base, horasLocais: 300.5 }).excedeHoras === true)
  ok('20 un cabe', avaliarCarga({ ...base, sobreavisosLocais: 20 }).excedeSobreavisos === false)
  ok('21 un nao cabe', avaliarCarga({ ...base, sobreavisosLocais: 21 }).excedeSobreavisos === true)
}

console.log('\n== numeros vindos como string do PostgREST (numeric vira string) ==')
{
  const comoTexto = { ...ACOLHIMENTO, horas: '289', sobreavisos: '0' }
  const a = avaliarCarga({
    horasLocais: '120',
    sobreavisosLocais: '0',
    cargas: [comoTexto],
    escalaMensalIdAtual: 'em-lavanderia',
    teto: { ...TETO, teto_horas: '300' },
  })
  // PostgREST devolve `numeric` como string; concatenar em vez de somar daria "120289".
  ok('soma numerica, nao concatenacao', a.totalHoras === 409, a.totalHoras)
  ok('teto tambem convertido', a.tetoHoras === 300 && a.excedeHoras === true)
}

console.log('\n== aviso ao ADICIONAR o servidor na grade ==')
{
  const aviso = avisoAoAdicionar('JEANE CONCEICAO SILVA', [ACOLHIMENTO], TETO)
  ok('avisa antes de lancar qualquer turno', aviso !== null)
  ok('diz quanto ja tem', aviso.includes('289h'))
  ok('diz onde', aviso.includes('SHL \\ ACOLHIMENTO'))
  ok('diz quanto ainda cabe', aviso.includes('Restam 11h'))

  const semNada = avisoAoAdicionar('FULANO', [], TETO)
  ok('sem carga externa nao avisa nada', semNada === null)

  const estourado = avisoAoAdicionar('X', [ACOLHIMENTO, { ...LAVANDERIA, horas: 20 }], TETO)
  ok('teto ja alcancado avisa que exige autorizacao', estourado.includes('Autorização Extraordinária'))
  ok('nao promete horas negativas', !estourado.includes('Restam -'))
}

console.log('\n== formatacao ==')
{
  ok('inteiro sem casa decimal', formatarHoras(309) === '309')
  ok('meia hora com virgula', formatarHoras(309.5) === '309,5')
  ok('zero', formatarHoras(0) === '0')
}

console.log('\n' + (falhas === 0 ? 'TODOS OS CASOS PASSARAM' : falhas + ' FALHA(S)'))
process.exit(falhas === 0 ? 0 : 1)
