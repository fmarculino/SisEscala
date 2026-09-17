/**
 * Validador do portao do "Voltar a lista" da folha.
 *
 * Portao que nunca falha nao vale nada: aqui cada regressao e INJETADA de proposito nos
 * arquivos reais e o portao tem que reprovar. Toda substituicao e conferida (armadilha 48):
 * um `replace` que nao casa por uma diferenca de espaco "passaria" sem ter testado nada.
 *
 * Rode:  node scratchpad/val_sim_volta_a_lista_folha.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const TELA = path.join(__dirname, '..', 'src', 'app', '(dashboard)', 'folha-ponto', 'page.tsx')
const NAV = path.join(__dirname, '_sim', 'folhaNavegacao.js')
const PORTAO = path.join(__dirname, 'sim_volta_a_lista_folha.js')

if (!fs.existsSync(NAV)) {
  console.error('Transpile antes: npx tsc src/utils/folhaNavegacao.ts --outDir scratchpad/_sim --module commonjs --target es2020')
  process.exit(1)
}

const regressoes = [
  {
    nome: 'filtroInicial volta a ler window.location.search (a causa original)',
    arquivo: TELA,
    de: '  if (query) return lerFiltrosFolha(query)[campo] as string\n  if (typeof window === \'undefined\' || !chaveSessao) return padrao',
    para: '  if (typeof window === \'undefined\') return padrao\n  if (window.location.search) return lerFiltrosFolha(window.location.search)[campo] as string\n  if (!chaveSessao) return padrao',
  },
  {
    nome: 'uma chamada esquece a query (a unidade volta a vir do padrao)',
    arquivo: TELA,
    de: "filtroInicial(queryDeEntrada, 'unidade', 'folha_ponto_filtro_unidade'))\n  const [selectedSetor",
    para: "filtroInicial('', 'unidade', 'folha_ponto_filtro_unidade'))\n  const [selectedSetor",
  },
  {
    nome: 'a query deixa de sair do roteador',
    arquivo: TELA,
    de: '  const paramsDaEntrada = useSearchParams()',
    para: '  const paramsDaEntrada = new URLSearchParams(typeof window === \'undefined\' ? \'\' : window.location.search)',
  },
  {
    nome: 'a query de entrada deixa de ser congelada',
    arquivo: TELA,
    de: 'const queryDeEntrada = useRef(paramsDaEntrada.toString()).current',
    para: 'const queryDeEntrada = paramsDaEntrada.toString()',
  },
  {
    nome: 'o sessionStorage volta a vencer a URL',
    arquivo: TELA,
    de: "  if (query) return lerFiltrosFolha(query)[campo] as string\n  if (typeof window === 'undefined' || !chaveSessao) return padrao\n  const salvo = sessionStorage.getItem(chaveSessao)\n  return salvo === null ? padrao : salvo",
    para: "  if (typeof window === 'undefined' || !chaveSessao) return query ? lerFiltrosFolha(query)[campo] as string : padrao\n  const salvo = sessionStorage.getItem(chaveSessao)\n  if (salvo !== null) return salvo\n  return query ? lerFiltrosFolha(query)[campo] as string : padrao",
  },
  {
    nome: 'o Suspense de useSearchParams some',
    arquivo: TELA,
    de: '    <Suspense fallback={null}>\n      <FolhaPontoPageConteudo />\n    </Suspense>',
    para: '    <FolhaPontoPageConteudo />',
  },
  {
    nome: 'o botao Editar abre a folha sem a origem',
    arquivo: TELA,
    de: '              href={urlDaFolha(s.folha_id, origemAtual)}',
    para: '              href={urlDaFolha(s.folha_id, \'\')}',
  },
  {
    nome: 'urlDaListaDeFolhas descarta a origem',
    arquivo: NAV,
    de: "    return origem ? '/folha-ponto?' + origem : '/folha-ponto';",
    para: "    return '/folha-ponto';",
  },
]

const original = new Map([TELA, NAV].map(f => [f, fs.readFileSync(f, 'utf8')]))
let falhas = 0

function rodarPortao() {
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
    return 0
  } catch (e) {
    return e.status || 1
  }
}

try {
  if (rodarPortao() !== 0) {
    console.error('REPROVADO: o portao ja falha com o codigo intacto — corrija antes de validar')
    process.exit(1)
  }

  for (const r of regressoes) {
    const antes = original.get(r.arquivo)
    const ocorrencias = antes.split(r.de).length - 1
    if (ocorrencias !== 1) {
      console.error(`ABORTA: a ancora de "${r.nome}" casou ${ocorrencias} vezes (esperado 1)`)
      process.exit(1)
    }
    const depois = antes.replace(r.de, r.para)
    if (depois === antes) {
      console.error(`ABORTA: a injecao de "${r.nome}" nao mudou nada`)
      process.exit(1)
    }
    fs.writeFileSync(r.arquivo, depois)
    const saida = rodarPortao()
    fs.writeFileSync(r.arquivo, antes)
    if (saida === 0) {
      falhas++
      console.error(`  NAO REPROVOU: ${r.nome}`)
    } else {
      console.log(`  reprovou: ${r.nome}`)
    }
  }
} finally {
  for (const [f, conteudo] of original) fs.writeFileSync(f, conteudo)
}

console.log(`\n${regressoes.length - falhas}/${regressoes.length} regressoes reprovadas`)
process.exit(falhas ? 1 : 0)
