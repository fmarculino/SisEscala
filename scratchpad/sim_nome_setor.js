/**
 * Portao de src/utils/setores/nomeSetor.ts — deteccao de nome de setor parecido.
 *
 * Transpile antes:
 *   npx tsc src/utils/setores/nomeSetor.ts --outDir scratchpad/_sim --module commonjs --target es2020
 * Rode:
 *   node scratchpad/sim_nome_setor.js
 *
 * Os numeros dos comentarios sao medicao de producao em 14/09/2026 (248 entradas no dicionario),
 * nao estimativa: `scratchpad/an_ruido_nome_setor.mjs` os reproduz.
 */
const {
  normalizarNomeSetor,
  palavrasSignificativas,
  encontrarNomeIdentico,
  sugerirNomesParecidos,
  descreverNomesParecidos,
} = require('./_sim/nomeSetor.js')

let passou = 0
const falhas = []
function ok(cond, descricao) {
  if (cond) passou++
  else falhas.push(descricao)
}
const motivos = (nome, lista) => sugerirNomesParecidos(nome, lista).map(p => `${p.nome}:${p.motivo}`)
const nomes = (nome, lista) => sugerirNomesParecidos(nome, lista).map(p => p.nome)

// ---------------------------------------------------------------- normalizacao
ok(normalizarNomeSetor('SERVIÇOS GERAIS') === 'SERVICOS GERAIS', 'normaliza cedilha')
ok(normalizarNomeSetor('serviços gerais') === 'SERVICOS GERAIS', 'normaliza caixa')
ok(normalizarNomeSetor('  SERVIÇOS   GERAIS  ') === 'SERVICOS GERAIS', 'colapsa espaco e faz trim')
ok(normalizarNomeSetor('ASG/ALMOXARIFE') === 'ASG ALMOXARIFE', 'pontuacao vira separador')
ok(normalizarNomeSetor('ALA - PSICOSSOCIAL') === 'ALA PSICOSSOCIAL', 'hifen vira separador')
ok(normalizarNomeSetor('') === '', 'vazio continua vazio')
ok(normalizarNomeSetor(null) === '', 'nulo nao quebra')

// palavras de ligacao nao contam; A e O contam (BLOCO A x BLOCO B)
ok(palavrasSignificativas('ASG AGENTE DE SERVIÇOS GERAIS').join('|') === 'ASG|AGENTE|SERVICOS|GERAIS', 'tira "DE"')
ok(palavrasSignificativas('BLOCO A').join('|') === 'BLOCO|A', 'A e palavra significativa, nao ligacao')

// ---------------------------------------------------------------- identico
const catalogo = ['ASG AGENTE DE SERVIÇOS GERAIS', 'RECEPÇÃO', 'FARMÁCIA', 'TEC ENFERMAGEM', 'ENFERMAGEM']
ok(encontrarNomeIdentico('RECEPCAO', catalogo) === 'RECEPÇÃO', 'acha sem acento')
ok(encontrarNomeIdentico('recepção', catalogo) === 'RECEPÇÃO', 'acha em minuscula')
ok(encontrarNomeIdentico('  RECEPÇÃO ', catalogo) === 'RECEPÇÃO', 'acha com espaco sobrando')
ok(encontrarNomeIdentico('RECEPCAO GERAL', catalogo) === null, 'nome diferente nao e identico')
ok(encontrarNomeIdentico('', catalogo) === null, 'vazio nao casa com nada')

// ---------------------------------------------------------------- o caso real (14/09/2026)
// SERVIÇOS GERAIS convivia com ASG AGENTE DE SERVIÇOS GERAIS em 27 unidades; na USF Pedro
// Cavalcante os dois existiam, e uma servidora transferida foi parar sozinha no errado.
ok(motivos('SERVIÇOS GERAIS', catalogo).join() === 'ASG AGENTE DE SERVIÇOS GERAIS:contido',
   'CASO REAL: SERVIÇOS GERAIS acusa ASG AGENTE DE SERVIÇOS GERAIS')
ok(motivos('SERVICOS GERAIS', catalogo).join() === 'ASG AGENTE DE SERVIÇOS GERAIS:contido',
   'CASO REAL: vale tambem sem cedilha')
ok(motivos('serviços gerais', catalogo).length === 1, 'CASO REAL: vale em minuscula')

// ---------------------------------------------------------------- ruido que NAO pode voltar
// 1. lado menor com 1 palavra pegaria a familia inteira (medido: 94 de 248 nomes alertavam)
ok(nomes('ENFERMAGEM', catalogo).length === 0, 'ENFERMAGEM nao acusa TEC ENFERMAGEM (1 palavra)')
ok(nomes('PEDIATRIA', ['PEDIATRIA - INTERNAÇÃO', 'PEDIATRIA - OBSERVAÇÃO']).length === 0,
   'PEDIATRIA nao acusa as PEDIATRIA - * (1 palavra)')
ok(nomes('ASG', ['ASG AGENTE DE SERVIÇOS GERAIS']).length === 0, 'sigla de 1 palavra nao acusa')

// 2. distancia de edicao sobre o nome inteiro acusava setores legitimos
ok(nomes('CARDIOLOGIA', ['RADIOLOGIA']).length === 0, 'CARDIOLOGIA nao acusa RADIOLOGIA')
ok(nomes('MAMOGRAFIA', ['TOMOGRAFIA']).length === 0, 'MAMOGRAFIA nao acusa TOMOGRAFIA')
ok(nomes('PORTARIA EXTERNA', ['PORTARIA INTERNA']).length === 0, 'PORTARIA EXTERNA nao acusa INTERNA')

// 3. em nome curto, uma letra distingue o setor — nao e' engano de digitacao
ok(nomes('BLOCO A', ['BLOCO B']).length === 0, 'BLOCO A nao acusa BLOCO B')
ok(nomes('BLOCO A SHL', ['BLOCO B SHL']).length === 0, 'BLOCO A SHL nao acusa BLOCO B SHL')
ok(nomes('SALA 1', ['SALA 2']).length === 0, 'SALA 1 nao acusa SALA 2')

// ---------------------------------------------------------------- o que TEM que acusar
ok(motivos('MAQUEIROS', ['MAQUEIRO']).join() === 'MAQUEIRO:digitacao', 'plural de palavra longa e digitacao')
ok(motivos('PANEJAMENTOS', ['PANEJAMENTO']).join() === 'PANEJAMENTO:digitacao', 'plural, outro caso real do dicionario')
ok(motivos('LABORATÓRIOS', ['LABORATORIO']).join() === 'LABORATORIO:digitacao', 'plural com acento')
ok(motivos('RECURSOS HUMANOS', ['RECURSOS HUMANOS DAB']).join() === 'RECURSOS HUMANOS DAB:contido',
   'nome contido no outro acusa nos dois sentidos')
ok(motivos('RECURSOS HUMANOS DAB', ['RECURSOS HUMANOS']).join() === 'RECURSOS HUMANOS:contido',
   'e tambem no sentido inverso')
ok(nomes('ASG AGENTE DE SERVICOS GERAIS', ['ASG AGENTE DE SERVIÇOS GERAIS']).length === 0,
   'identico nao entra na lista de parecidos (tem caminho proprio)')

// ---------------------------------------------------------------- bordas
ok(sugerirNomesParecidos('', catalogo).length === 0, 'nome vazio nao sugere nada')
ok(sugerirNomesParecidos('QUALQUER COISA', []).length === 0, 'catalogo vazio nao sugere nada')
ok(sugerirNomesParecidos('DE DA DO', catalogo).length === 0, 'so ligacoes nao sugere nada')
ok(sugerirNomesParecidos('PRONTO SOCORRO', Array.from({ length: 20 }, (_, i) => `PRONTO SOCORRO ${i} XYZ`)).length === 5,
   'respeita o limite de 5 sugestoes')

// ---------------------------------------------------------------- texto da recusa
const texto = descreverNomesParecidos('SERVIÇOS GERAIS', sugerirNomesParecidos('SERVIÇOS GERAIS', catalogo))
ok(texto.includes('ASG AGENTE DE SERVIÇOS GERAIS'), 'a recusa nomeia o setor que ja existe')
ok(texto.includes('SERVIÇOS GERAIS'), 'a recusa repete o nome digitado')
ok(/transferir/i.test(texto), 'a recusa explica a CONSEQUENCIA (transferencia com duas opcoes)')
ok(descreverNomesParecidos('QUALQUER', []) === '', 'sem parecidos nao ha texto')

console.log(`${passou} asserções passaram`)
if (falhas.length) {
  console.log(`\n${falhas.length} FALHA(S):`)
  for (const f of falhas) console.log('  - ' + f)
  process.exit(1)
}
