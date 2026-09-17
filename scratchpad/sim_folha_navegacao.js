/**
 * Portao da navegacao entre folhas de ponto (src/utils/folhaNavegacao.ts).
 *
 * Nao ha framework de teste no projeto. Transpile antes com:
 *   npx tsc src/utils/folhaNavegacao.ts --outDir scratchpad/_sim --module commonjs --target es2020
 */
const nav = require('./_sim/folhaNavegacao.js')

let ok = 0
let falhas = 0

function eq(nome, obtido, esperado) {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    ok++
  } else {
    falhas++
    console.error('FALHOU: ' + nome + '\n  obtido:   ' + a + '\n  esperado: ' + b)
  }
}

function verdade(nome, cond) {
  eq(nome, !!cond, true)
}

// ---------------------------------------------------------------- filtros / URL

const padrao = nav.filtrosPadraoFolha()
eq('padrao: unidade vazia', padrao.unidade, '')
eq('padrao: status todos', [padrao.escalaStatus, padrao.folhaStatus], ['todos', 'todos'])
eq('padrao: pagina 1', padrao.pagina, '1')
verdade('padrao: mes do relogio do navegador', padrao.mes === String(new Date().getMonth() + 1))

eq('ler: entrada vazia devolve o padrao', nav.lerFiltrosFolha(''), padrao)
eq('ler: entrada nula devolve o padrao', nav.lerFiltrosFolha(null), padrao)

const lido = nav.lerFiltrosFolha('?mes=9&ano=2026&unidade=U1&setor=S1&busca=airton&q=fontes&escala=Fechada&folha=Revisada&pagina=7')
eq('ler: mes', lido.mes, '9')
eq('ler: unidade', lido.unidade, 'U1')
eq('ler: busca local', lido.busca, 'airton')
eq('ler: busca global vem de q', lido.buscaGlobal, 'fontes')
eq('ler: status da escala vem de escala', lido.escalaStatus, 'Fechada')
eq('ler: status da folha vem de folha', lido.folhaStatus, 'Revisada')
eq('ler: pagina', lido.pagina, '7')

// Ida e volta: o que a lista escreve, a folha le de volta igual.
eq('ida e volta preserva todos os campos', nav.lerFiltrosFolha(nav.escreverFiltrosFolha(lido)), lido)

// Mes e ano vao SEMPRE — o padrao e "hoje", entao omiti-los abriria outra competencia amanha.
const so_periodo = nav.escreverFiltrosFolha(padrao)
verdade('escrever: mes sempre presente', so_periodo.includes('mes='))
verdade('escrever: ano sempre presente', so_periodo.includes('ano='))
verdade('escrever: status no padrao nao polui a URL', !so_periodo.includes('escala=') && !so_periodo.includes('folha='))
verdade('escrever: pagina 1 nao polui a URL', !so_periodo.includes('pagina='))
eq('ida e volta do padrao', nav.lerFiltrosFolha(so_periodo), padrao)

// Campo ausente na URL cai no padrao, nunca em undefined.
const parcial = nav.lerFiltrosFolha('mes=3&ano=2026')
eq('ler: campos ausentes caem no padrao', [parcial.unidade, parcial.escalaStatus, parcial.pagina], ['', 'todos', '1'])

// ---------------------------------------------------------------- URLs

eq('url da folha sem origem', nav.urlDaFolha('F1', ''), '/folha-ponto/F1')
eq(
  'url da folha com origem codificada',
  nav.urlDaFolha('F1', 'mes=9&ano=2026&unidade=U1'),
  '/folha-ponto/F1?origem=' + encodeURIComponent('mes=9&ano=2026&unidade=U1')
)
verdade(
  'url da folha: a origem nao vaza & para a query externa',
  nav.urlDaFolha('F1', 'mes=9&ano=2026').split('&').length === 1
)
// A folha decodifica o que a lista codificou.
eq(
  'origem sobrevive a ida e volta pela URL',
  nav.lerFiltrosFolha(decodeURIComponent(nav.urlDaFolha('F1', nav.escreverFiltrosFolha(lido)).split('origem=')[1])),
  lido
)

eq('url da lista sem origem', nav.urlDaListaDeFolhas(''), '/folha-ponto')
eq('url da lista com origem', nav.urlDaListaDeFolhas('mes=9&ano=2026'), '/folha-ponto?mes=9&ano=2026')

// ---------------------------------------------------------------- busca global

eq('busca global: vazia nao ativa', nav.buscaGlobalAtiva({ ...padrao, buscaGlobal: '' }), false)
eq('busca global: 2 caracteres nao ativa', nav.buscaGlobalAtiva({ ...padrao, buscaGlobal: 'ai' }), false)
eq('busca global: 3 caracteres ativa', nav.buscaGlobalAtiva({ ...padrao, buscaGlobal: 'air' }), true)
eq('busca global: espaco nao conta como caractere', nav.buscaGlobalAtiva({ ...padrao, buscaGlobal: ' ai ' }), false)

// ---------------------------------------------------------------- ordem

function item(nome, extras) {
  return Object.assign({
    servidor_id: 's-' + nome,
    nome,
    matricula: null,
    cargo: null,
    escala_mensal_id: 'e-' + nome,
    escala_status: 'Em Andamento',
    folha_id: 'f-' + nome,
    folha_status: 'Gerada'
  }, extras || {})
}

eq(
  'ordem: alfabetica por nome',
  nav.ordenarServidoresFolha([item('CARLOS'), item('AIRTON'), item('BEATRIZ')]).map(s => s.nome),
  ['AIRTON', 'BEATRIZ', 'CARLOS']
)

// DUPLO VINCULO: a mesma pessoa em duas matriculas tem NOME IDENTICO (armadilha 59). Sem
// desempate a ordem fica indefinida, e a seta "proxima" pularia ou repetiria uma folha.
// O id da escala e o da matricula apontam para lados OPOSTOS de proposito: assim so o
// desempate por matricula produz o resultado esperado, e anula-lo reprova o portao.
const duplo = [
  item('PAULINO', { matricula: '67469', escala_mensal_id: 'e-a', servidor_id: 's-a', folha_id: 'f-a' }),
  item('PAULINO', { matricula: '65562', escala_mensal_id: 'e-b', servidor_id: 's-b', folha_id: 'f-b' })
]
eq(
  'ordem: nome identico desempata por matricula',
  nav.ordenarServidoresFolha(duplo).map(s => s.matricula),
  ['65562', '67469']
)
eq(
  'ordem: desempate e estavel nas duas direcoes de entrada',
  nav.ordenarServidoresFolha([...duplo].reverse()).map(s => s.matricula),
  nav.ordenarServidoresFolha(duplo).map(s => s.matricula)
)

// Nome E matricula identicos: ainda assim a ordem tem de ser a mesma nas duas visitas.
// Escala e servidor tambem apontam para lados opostos: isola o desempate pela escala.
const gemeos = [
  item('ANA', { matricula: '1', escala_mensal_id: 'e-2', servidor_id: 's-1', folha_id: 'f-2' }),
  item('ANA', { matricula: '1', escala_mensal_id: 'e-1', servidor_id: 's-2', folha_id: 'f-1' })
]
eq(
  'ordem: empate total desempata pela escala',
  nav.ordenarServidoresFolha(gemeos).map(s => s.escala_mensal_id),
  ['e-1', 'e-2']
)

// Ordenar NAO pode mutar o array recebido: ele pode ser o estado do React.
const original = [item('CARLOS'), item('AIRTON')]
const copiaAntes = original.map(s => s.nome)
nav.ordenarServidoresFolha(original)
eq('ordem: nao muta o array recebido', original.map(s => s.nome), copiaAntes)

eq('ordem: lista vazia', nav.ordenarServidoresFolha([]), [])

// ---------------------------------------------------------------- visibilidade

const semFiltro = { ...padrao }
verdade('visivel: sem filtro tudo passa', nav.servidorVisivelNaFolha(item('AIRTON'), semFiltro))

verdade(
  'visivel: casa por nome, sem caixa',
  nav.servidorVisivelNaFolha(item('AIRTON JUNIOR'), { ...padrao, busca: 'junior' })
)
verdade(
  'visivel: casa por matricula',
  nav.servidorVisivelNaFolha(item('AIRTON', { matricula: '64885' }), { ...padrao, busca: '6488' })
)
verdade(
  'visivel: casa por cargo',
  nav.servidorVisivelNaFolha(item('AIRTON', { cargo: 'EDUCADOR FISICO' }), { ...padrao, busca: 'educador' })
)
eq(
  'visivel: termo que nao casa nada e recusado',
  nav.servidorVisivelNaFolha(item('AIRTON'), { ...padrao, busca: 'zzz' }),
  false
)
// Matricula e cargo ausentes nao podem estourar nem casar por acidente.
eq(
  'visivel: matricula/cargo nulos nao quebram a busca',
  nav.servidorVisivelNaFolha(item('AIRTON', { matricula: null, cargo: null }), { ...padrao, busca: 'zzz' }),
  false
)

eq(
  'visivel: status da escala filtra',
  nav.servidorVisivelNaFolha(item('A', { escala_status: 'Fechada' }), { ...padrao, escalaStatus: 'Em Andamento' }),
  false
)
verdade(
  'visivel: status da escala igual passa',
  nav.servidorVisivelNaFolha(item('A', { escala_status: 'Fechada' }), { ...padrao, escalaStatus: 'Fechada' })
)
eq(
  'visivel: status da folha filtra',
  nav.servidorVisivelNaFolha(item('A', { folha_status: 'Rascunho' }), { ...padrao, folhaStatus: 'Revisada' }),
  false
)
verdade(
  'visivel: Nao Gerada e um status como outro qualquer',
  nav.servidorVisivelNaFolha(
    item('A', { folha_id: null, folha_status: 'Não Gerada' }),
    { ...padrao, folhaStatus: 'Não Gerada' }
  )
)

// ---------------------------------------------------------------- sequencia

const base = [
  item('CARLOS'),
  item('AIRTON'),
  item('BRUNA', { folha_id: null, folha_status: 'Não Gerada' }),
  item('DANIEL', { escala_status: 'Fechada' })
]

eq(
  'sequencia: ordenada e sem quem nao tem folha',
  nav.sequenciaDeFolhas(base, padrao).map(s => s.nome),
  ['AIRTON', 'CARLOS', 'DANIEL']
)
verdade(
  'sequencia: todo item tem folha para onde navegar',
  nav.sequenciaDeFolhas(base, padrao).every(s => !!s.folha_id)
)
eq(
  'sequencia: respeita o filtro de status',
  nav.sequenciaDeFolhas(base, { ...padrao, escalaStatus: 'Fechada' }).map(s => s.nome),
  ['DANIEL']
)
eq('sequencia: base vazia', nav.sequenciaDeFolhas([], padrao), [])
eq(
  'sequencia: filtro que nao casa ninguem',
  nav.sequenciaDeFolhas(base, { ...padrao, busca: 'zzz' }),
  []
)

// ---------------------------------------------------------------- indice

const seq = nav.sequenciaDeFolhas(base, padrao)
eq('indice: primeiro', nav.indiceDaFolha(seq, 'f-AIRTON'), 0)
eq('indice: ultimo', nav.indiceDaFolha(seq, 'f-DANIEL'), 2)
eq('indice: folha fora do filtro devolve -1', nav.indiceDaFolha(seq, 'f-BRUNA'), -1)
eq('indice: folha inexistente devolve -1', nav.indiceDaFolha(seq, 'f-NINGUEM'), -1)
eq('indice: sequencia vazia devolve -1', nav.indiceDaFolha([], 'f-AIRTON'), -1)

// A ponta da sequencia nao pode ter vizinho: e o que desabilita a seta.
eq('vizinho: nao ha anterior do primeiro', nav.indiceDaFolha(seq, 'f-AIRTON') > 0, false)
eq('vizinho: nao ha proxima do ultimo', nav.indiceDaFolha(seq, 'f-DANIEL') < seq.length - 1, false)

// ---------------------------------------------------------------- travessia completa

// Percorrer a sequencia inteira com as setas passa por CADA folha exatamente uma vez.
const visitados = []
let i = nav.indiceDaFolha(seq, 'f-AIRTON')
while (i >= 0 && i < seq.length) {
  visitados.push(seq[i].folha_id)
  i = i < seq.length - 1 ? i + 1 : -1
}
eq('travessia: visita cada folha uma unica vez', visitados, ['f-AIRTON', 'f-CARLOS', 'f-DANIEL'])
eq('travessia: nenhuma repeticao', new Set(visitados).size, visitados.length)

console.log('\n' + ok + ' assercoes passaram, ' + falhas + ' falharam')
process.exit(falhas === 0 ? 0 : 1)
