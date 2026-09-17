/**
 * Portao do "Voltar a lista" da folha de ponto.
 *
 * O botao sempre montou a URL certa (`urlDaListaDeFolhas(origem)`), e a lista sempre soube
 * ler filtros da URL. O que quebrava era QUANDO a lista lia: no inicializador de `useState`,
 * ou seja, durante o RENDER. No App Router quem atualiza a barra de enderecos e o
 * `HistoryUpdater`, num `useInsertionEffect` — depois do render. Entao no primeiro render de
 * quem chega por `router.push`, `window.location.search` ainda era a URL DA FOLHA
 * (`?origem=...`): a condicao dava verdadeira, `lerFiltrosFolha` nao achava `mes`/`unidade`
 * ali, devolvia o PADRAO, e o sessionStorage nem era consultado — a lista voltava zerada.
 *
 * Duas metades sao testadas aqui: a semantica (o que cada query produz) e a estrutura
 * (a tela le a query do ROTEADOR, nunca do `window`, e passa a mesma query a cada filtro).
 *
 * Transpile antes:
 *   npx tsc src/utils/folhaNavegacao.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Rode:  node scratchpad/sim_volta_a_lista_folha.js
 */
const fs = require('fs')
const path = require('path')
const {
  escreverFiltrosFolha, lerFiltrosFolha, filtrosPadraoFolha, urlDaFolha, urlDaListaDeFolhas,
} = require(path.join(__dirname, '_sim', 'folhaNavegacao.js'))

const TELA = path.join(__dirname, '..', 'src', 'app', '(dashboard)', 'folha-ponto', 'page.tsx')
const fonte = fs.readFileSync(TELA, 'utf8')

let falhas = 0, total = 0
function ok(cond, nome) {
  total++
  if (!cond) { falhas++; console.error(`  REPROVADO: ${nome}`) }
}

// ── A ida e a volta, ponta a ponta ───────────────────────────────────────────────────
// CAPS III, setembro/2026, pagina 3 — o caso da tela do usuario.
const filtros = {
  ...filtrosPadraoFolha(),
  mes: '9', ano: '2026',
  unidade: 'uuid-caps-iii', setor: 'uuid-setor',
  folhaStatus: 'Rascunho', pagina: '3',
}
const origem = escreverFiltrosFolha(filtros)
const urlFolha = urlDaFolha('uuid-folha', origem)
const queryDaFolha = urlFolha.slice(urlFolha.indexOf('?'))
const urlVolta = urlDaListaDeFolhas(origem)
const queryDaVolta = urlVolta.slice(urlVolta.indexOf('?'))

ok(queryDaFolha.startsWith('?origem='), 'a folha carrega os filtros na query origem')
const devolvidos = lerFiltrosFolha(queryDaVolta)
for (const campo of ['mes', 'ano', 'unidade', 'setor', 'folhaStatus', 'pagina']) {
  ok(devolvidos[campo] === filtros[campo], `a volta devolve ${campo} (${filtros[campo]})`)
}

// ── A CAUSA, fixada: a query da folha NAO e uma query de filtros ─────────────────────
// Se alguem voltar a alimentar a leitura com `window.location.search`, e este valor que
// chegara la — e ele responde com o padrao, calado.
const lidoDaFolha = lerFiltrosFolha(queryDaFolha)
const padrao = filtrosPadraoFolha()
ok(lidoDaFolha.unidade === '', 'a query da folha nao carrega unidade')
ok(lidoDaFolha.setor === '', 'a query da folha nao carrega setor')
ok(lidoDaFolha.folhaStatus === padrao.folhaStatus, 'a query da folha nao carrega status')
ok(lidoDaFolha.pagina === padrao.pagina, 'a query da folha nao carrega a pagina')
ok(queryDaFolha !== '', 'a query da folha e TRUTHY — por isso ela vencia o sessionStorage')

// Sem origem (link direto, entrada pela grade) a volta cai na lista sem filtro, e isso e
// o comportamento correto: nao ha o que restaurar.
ok(urlDaListaDeFolhas('') === '/folha-ponto', 'sem origem, a volta e a lista sem filtro')
ok(urlDaFolha('uuid-folha', '') === '/folha-ponto/uuid-folha', 'sem origem, a folha abre sem query')

// A pagina 1 e o status "todos" nao sujam a URL, mas a competencia vai SEMPRE: guardar o
// link hoje e abri-lo no mes que vem nao pode trocar de competencia.
const soCompetencia = escreverFiltrosFolha({ ...filtrosPadraoFolha(), mes: '9', ano: '2026' })
ok(soCompetencia === 'mes=9&ano=2026', 'competencia sempre na URL, o resto so quando difere do padrao')

// ── A estrutura da tela ──────────────────────────────────────────────────────────────
// 1. A query vem do ROTEADOR. `useSearchParams` e avaliado no render e ja reflete a URL de
//    destino; `window.location`, nao.
ok(/useSearchParams/.test(fonte), 'a tela usa useSearchParams')
ok(/const\s+paramsDaEntrada\s*=\s*useSearchParams\(\)/.test(fonte), 'a query de entrada sai de useSearchParams')
ok(/useRef\(paramsDaEntrada\.toString\(\)\)\.current/.test(fonte), 'a query de entrada e congelada na montagem')

// 2. Nenhuma leitura de `window.location.search` volta a esta tela. O comentario acima de
//    `filtroInicial` cita a expressao de proposito, entao a varredura e sobre CODIGO: linhas
//    de comentario saem antes. (`window.location.pathname`, na sincronizacao da URL, fica.)
const codigo = fonte
  .split('\n')
  .filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n')
ok(!/window\.location\.search/.test(codigo), 'a tela nao le window.location.search')

// 3. `filtroInicial` recebe a query, nunca a descobre sozinha.
ok(/function filtroInicial\(query: string,/.test(fonte), 'filtroInicial recebe a query por parametro')

// 4. E TODA chamada passa a mesma query — uma esquecida devolveria o padrao so naquele campo,
//    que e o modo de falha mais silencioso possivel.
const chamadas = fonte.match(/filtroInicial\(([^)]*)\)/g) || []
const usos = chamadas.filter(c => !/^filtroInicial\(query: string/.test(c))
ok(usos.length >= 11, `a tela tem as 11 chamadas de filtroInicial (achou ${usos.length})`)
ok(usos.every(c => c.startsWith('filtroInicial(queryDeEntrada,')), 'toda chamada passa queryDeEntrada')

// 5. A precedencia continua URL > sessionStorage > padrao: com query, o sessionStorage nao
//    e nem consultado (outra aba pode te-lo sobrescrito).
const corpo = fonte.slice(fonte.indexOf('function filtroInicial('), fonte.indexOf('function FolhaPontoPageConteudo'))
const posQuery = corpo.indexOf('if (query) return')
const posSessao = corpo.indexOf('sessionStorage.getItem')
ok(posQuery > -1 && posSessao > posQuery, 'a URL e consultada ANTES do sessionStorage')

// 6. `useSearchParams` exige limite de Suspense no App Router.
ok(/<Suspense fallback={null}>\s*<FolhaPontoPageConteudo \/>/.test(fonte), 'o conteudo fica dentro de um Suspense')

// 7. A folha continua sendo aberta COM a origem — sem isso nao ha o que restaurar na volta.
ok((fonte.match(/urlDaFolha\(s\.folha_id, origemAtual\)/g) || []).length === 2,
  'os dois caminhos de abertura da folha (linha e botao Editar) levam a origem')

console.log(`\n${total - falhas}/${total} asseracoes`)
process.exit(falhas ? 1 : 0)
