/**
 * Portao da paginacao da folha de ponto (armadilha 8).
 *
 * Nao existe framework de teste no projeto, e o defeito nao e de logica pura: e uma CONSULTA que
 * devolve 1.000 linhas em silencio. O que da para garantir por portao e que os cinco sitios que
 * varrem a competencia inteira continuem paginados, ordenados, e que os dois que ESCREVEM
 * continuem abortando quando a busca nao veio inteira.
 *
 * Medido em producao em 15/09/2026, competencia 09/2026: 1.639 escalas ativas e 1.289 folhas.
 */
const fs = require('fs')
let falhas = 0
const ok = (c, m) => { console.log(`${c ? '  OK  ' : ' FALHA'} ${m}`); if (!c) falhas++ }
const ler = p => fs.readFileSync(p, 'utf8')

// Recorta o corpo de uma funcao/arquivo a partir de uma ancora, ate a proxima ancora.
function trecho(src, de, ate) {
  const i = src.indexOf(de)
  if (i < 0) return ''
  const j = ate ? src.indexOf(ate, i + de.length) : -1
  return src.slice(i, j < 0 ? src.length : j)
}

const ACTIONS = 'src/app/(dashboard)/folha-ponto/actions.ts'
const PAGE = 'src/app/(dashboard)/folha-ponto/page.tsx'
const AUTOCLOSE = 'src/utils/autoClose.ts'
const REGERAR = 'src/app/api/folha-ponto/regerar-competencia/route.ts'

const actions = ler(ACTIONS)

// --- 1. getServidoresFolhaPonto: a listagem que mostrava "Nao Gerada" para folha existente
const listagem = trecho(actions, 'export async function getServidoresFolhaPonto', 'export async function buscarServidoresFolhaPonto')
ok(listagem.length > 0, 'getServidoresFolhaPonto encontrada')
ok((listagem.match(/await buscarTodasPaginas<any>\(/g) || []).length === 2,
   'listagem pagina AS DUAS buscas (escalas e folhas)')
ok(!/\.from\('folha_ponto'\)[\s\S]{0,400}?\.eq\('ano', ano\)\s*\r?\n\s*\r?\n/.test(listagem),
   'nao sobrou busca de folha_ponto terminando sem range')
ok((listagem.match(/\.order\('id', \{ ascending: true \}\)/g) || []).length === 2,
   'as duas paginacoes ordenam por id (sem ordem estavel a pagina repete/omite linha)')
ok(/return \{ servidores: result, completo: escalasCompletas && folhasCompletas \}/.test(listagem),
   'a listagem devolve `completo` para a tela poder avisar (armadilha 22)')
ok(/escala_mensal!inner\(unidade_id, setor_id\)/.test(listagem),
   'filtra por unidade/setor no embed !inner antes de paginar')

// --- 2. a tela avisa quando a listagem nao veio inteira
const page = ler(PAGE)
ok(/AvisoDadosIncompletos/.test(page), 'a tela importa e usa o aviso de dados incompletos')
ok(/setListagemCompleta\(res\.completo !== false\)/.test(page),
   'a tela le o `completo` devolvido pela action')
ok(/completo=\{listagemCompleta\}/.test(page), 'o aviso e ligado ao estado da listagem')

// --- 3. gerarFolhasEmLote
const lote = trecho(actions, 'export async function gerarFolhasEmLote', 'export async function sincronizarFolhaPonto')
ok(/await buscarTodasPaginas<any>\(/.test(lote), 'gerarFolhasEmLote pagina as escalas')
ok(/completo/.test(lote) && /ATENÇÃO/.test(lote),
   'gerarFolhasEmLote ressalva no relato quando a busca falhou no meio')

// --- 4. autoCorrigirTodasFolhasPonto
const autocorr = trecho(actions, 'export async function autoCorrigirTodasFolhasPonto')
ok(/await buscarTodasPaginas<any>\(/.test(autocorr), 'autoCorrigirTodasFolhasPonto pagina as folhas')
ok(/completo,/.test(autocorr) && /totalFolhasAnalisadas/.test(autocorr),
   'autoCorrigir relata quantas folhas ANALISOU, nao so quantas corrigiu')

// --- 5. os dois caminhos DESTRUTIVOS: incompleto tem de abortar, nunca seguir
const autoclose = trecho(ler(AUTOCLOSE), 'export async function autoGenerateMissingTimesheets')
ok((autoclose.match(/await buscarTodasPaginas<any>\(/g) || []).length === 2,
   'autoGenerateMissingTimesheets pagina escalas E folhas')
ok(/if \(!scalesCompleto \|\| !sheetsCompleto\)[\s\S]{0,300}?return \{ success: false/.test(autoclose),
   'autoGenerateMissingTimesheets ABORTA sem gerar quando a busca veio parcial')
ok(autoclose.indexOf('scalesCompleto || !sheetsCompleto') < autoclose.indexOf('const sheetsMap'),
   'o aborto vem ANTES de montar o mapa que decide quem "nao tem folha"')

const regerar = ler(REGERAR)
ok((regerar.match(/await buscarTodasPaginas<any>\(/g) || []).length === 2,
   'regerar-competencia pagina escalas E folhas')
ok(/if \(!escalasCompleto \|\| !folhasCompleto\)[\s\S]{0,300}?status: 503/.test(regerar),
   'regerar-competencia recusa com 503 quando a busca veio parcial')
ok(regerar.indexOf('!escalasCompleto || !folhasCompleto') < regerar.indexOf('const statusPorEscala'),
   'o aborto vem ANTES de montar o mapa de status')

// --- 6. nenhum dos cinco sitios pode voltar a varrer a competencia sem paginar
for (const [arq, src] of [[ACTIONS, actions], [AUTOCLOSE, ler(AUTOCLOSE)], [REGERAR, regerar]]) {
  const cru = /\.from\('folha_ponto'\)\s*\r?\n\s*\.select\([^)]*\)\s*\r?\n\s*\.eq\('mes'[\s\S]{0,120}?\.eq\('ano'[^\r\n]*\r?\n(?!\s*\.(order|range|limit))/g
  ok(!cru.test(src), `${arq}: nenhuma busca de folha_ponto por mes/ano sem order/range`)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
process.exit(falhas ? 1 : 0)
