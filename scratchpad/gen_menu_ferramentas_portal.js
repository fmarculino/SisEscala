/**
 * O menu "Ferramentas" passa a ser desenhado em PORTAL (issue #5, segunda parte).
 *
 * O dropdown era `position: absolute` dentro do card da grade, que tem `overflow-hidden` — com
 * um servidor so o card e baixo e o menu era CORTADO na terceira opcao, sem barra de rolagem e
 * sem nada dizendo que havia mais. Fora do card, o recorte deixa de existir; a posicao vem de
 * src/utils/ui/posicaoFlutuante.ts.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

if (src.includes('posicaoMenuFerramentas')) {
  console.log('JA APLICADO — nada a fazer')
  process.exit(0)
}

function trocarUnica(de, para, nome) {
  const alvo = Array.isArray(de) ? L(...de) : de
  const novo = Array.isArray(para) ? L(...para) : para
  const n = src.split(alvo).length - 1
  if (n !== 1) {
    console.error('ABORTADO: ' + nome + ' — esperava 1 ocorrencia, achei ' + n)
    process.exit(1)
  }
  src = src.split(alvo).join(novo)
}

// 1. Imports.
trocarUnica(
  "import React from 'react'",
  L(
    "import React from 'react'",
    "import { createPortal } from 'react-dom'",
    "import { calcularPosicaoFlutuante, type PosicaoFlutuante } from '@/utils/ui/posicaoFlutuante'"
  ),
  'imports do portal'
)

// 2. Estado e posicionamento do menu, junto do estado que ja existia.
trocarUnica(
  L(
    "  const [ferramentasAbertas, setFerramentasAbertas] = useState(false)",
    "  const ferramentasRef = useRef<HTMLDivElement | null>(null)"
  ),
  L(
    "  const [ferramentasAbertas, setFerramentasAbertas] = useState(false)",
    "  const ferramentasRef = useRef<HTMLDivElement | null>(null)",
    "  const ferramentasBotaoRef = useRef<HTMLButtonElement | null>(null)",
    "  const ferramentasMenuRef = useRef<HTMLDivElement | null>(null)",
    "",
    "  // `createPortal` toca em `document`: so depois de montar no cliente.",
    "  const [montado, setMontado] = useState(false)",
    "  useEffect(() => { setMontado(true) }, [])",
    "",
    "  /**",
    "   * Posicao do menu na TELA.",
    "   *",
    "   * ⚠️ O menu e desenhado em portal, fora do card da grade. O card tem `overflow-hidden` (o",
    "   * arredondamento e a rolagem do cabecalho fixo dependem dele) e recortava o dropdown",
    "   * `absolute`: com um servidor so, o card e baixo e o menu sumia na terceira opcao, sem barra",
    "   * de rolagem e sem nenhum sinal de que havia mais. `maxHeight` sai da mesma conta, entao o",
    "   * menu ROLA por dentro em vez de esconder item.",
    "   */",
    "  const [posicaoMenuFerramentas, setPosicaoMenuFerramentas] = useState<PosicaoFlutuante | null>(null)",
    "",
    "  const reposicionarMenuFerramentas = useCallback(() => {",
    "    const botao = ferramentasBotaoRef.current",
    "    if (!botao) return",
    "    const rect = botao.getBoundingClientRect()",
    "    setPosicaoMenuFerramentas(calcularPosicaoFlutuante(",
    "      rect,",
    "      { largura: 320, altura: 520 },",
    "      { largura: window.innerWidth, altura: window.innerHeight }",
    "    ))",
    "  }, [])",
    "",
    "  useEffect(() => {",
    "    if (!ferramentasAbertas) return",
    "    reposicionarMenuFerramentas()",
    "    // `true` na captura: a grade rola num container proprio e o scroll dele nao borbulha ate",
    "    // a window. Sem isso o menu ficaria parado enquanto a barra sai de baixo dele.",
    "    window.addEventListener('scroll', reposicionarMenuFerramentas, true)",
    "    window.addEventListener('resize', reposicionarMenuFerramentas)",
    "    return () => {",
    "      window.removeEventListener('scroll', reposicionarMenuFerramentas, true)",
    "      window.removeEventListener('resize', reposicionarMenuFerramentas)",
    "    }",
    "  }, [ferramentasAbertas, reposicionarMenuFerramentas])"
  ),
  'estado e posicionamento do menu'
)

// 3. Clicar fora precisa conhecer o menu do PORTAL.
//
// ⚠️ Sem isto o menu para de funcionar: o painel deixou de ser descendente de `ferramentasRef`,
// entao o `mousedown` sobre um item conta como "clique fora", o menu e desmontado antes do
// `mouseup` e o `click` do item NUNCA dispara. O sintoma seria pior que o bug original — menu
// visivel, itens inertes.
trocarUnica(
  L(
    "    const aoClicarFora = (e: MouseEvent) => {",
    "      if (ferramentasRef.current && !ferramentasRef.current.contains(e.target as Node)) {",
    "        setFerramentasAbertas(false)",
    "      }",
    "    }"
  ),
  L(
    "    const aoClicarFora = (e: MouseEvent) => {",
    "      const alvo = e.target as Node",
    "      const noBotao = ferramentasRef.current?.contains(alvo)",
    "      // O painel vive em portal, fora de `ferramentasRef`: sem consultar o ref dele, o",
    "      // mousedown num item contaria como clique fora, o menu seria desmontado antes do mouseup",
    "      // e o clique nunca chegaria ao item.",
    "      const noMenu = ferramentasMenuRef.current?.contains(alvo)",
    "      if (!noBotao && !noMenu) {",
    "        setFerramentasAbertas(false)",
    "      }",
    "    }"
  ),
  'clicar fora considerando o portal'
)

// 4. O botao ganha ref.
trocarUnica(
  L(
    "              <button",
    "                type=\"button\"",
    "                onClick={() => setFerramentasAbertas(v => !v)}",
    "                disabled={loading || isClosed}",
    "                aria-haspopup=\"menu\""
  ),
  L(
    "              <button",
    "                ref={ferramentasBotaoRef}",
    "                type=\"button\"",
    "                onClick={() => setFerramentasAbertas(v => !v)}",
    "                disabled={loading || isClosed}",
    "                aria-haspopup=\"menu\""
  ),
  'ref no botao de ferramentas'
)

// 5. O painel sai do fluxo do card e vai para o portal.
trocarUnica(
  L(
    "              {ferramentasAbertas && (",
    "                <div",
    "                  role=\"menu\"",
    "                  className=\"absolute left-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl ring-1 ring-black/5 py-1 animate-in fade-in\"",
    "                >"
  ),
  L(
    "              {/* ⚠️ PORTAL, nao `absolute`: ver o comentario de `posicaoMenuFerramentas`. O card",
    "                  da grade tem `overflow-hidden` e cortava o menu quando a escala tinha poucos",
    "                  servidores — as ferramentas de baixo simplesmente nao existiam para o usuario. */}",
    "              {ferramentasAbertas && montado && posicaoMenuFerramentas && createPortal(",
    "                <div",
    "                  role=\"menu\"",
    "                  ref={ferramentasMenuRef}",
    "                  style={{",
    "                    position: 'fixed',",
    "                    top: posicaoMenuFerramentas.top,",
    "                    left: posicaoMenuFerramentas.left,",
    "                    maxHeight: posicaoMenuFerramentas.maxHeight,",
    "                    zIndex: 99999",
    "                  }}",
    "                  className=\"w-80 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl ring-1 ring-black/5 py-1 animate-in fade-in\"",
    "                >"
  ),
  'abertura do painel em portal'
)

trocarUnica(
  L(
    "                    </button>",
    "                  ))}",
    "                </div>",
    "              )}",
    "            </div>",
    "",
    "            {/* Ações principais. `ml-auto` mantém o grupo colado à direita mesmo quando ele"
  ),
  L(
    "                    </button>",
    "                  ))}",
    "                </div>,",
    "                document.body",
    "              )}",
    "            </div>",
    "",
    "            {/* Ações principais. `ml-auto` mantém o grupo colado à direita mesmo quando ele"
  ),
  'fechamento do portal'
)

const invariantes = [
  ['barra larga com os botoes lado a lado preservada', 'hidden @min-[1800px]:flex items-center gap-2'],
  ['fechar com Escape preservado', "if (e.key === 'Escape') setFerramentasAbertas(false)"],
  ['lista de ferramentas preservada', 'ferramentasEscala.map(f => ('],
  ['reconciliar continua filtrado por permissao', "f.chave !== 'reconciliar' || podeValidarPresenca"],
  ['menu continua fechando ao escolher uma ferramenta', 'onClick={() => { setFerramentasAbertas(false); f.onClick() }}']
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error('ABORTADO: invariante perdida — ' + nome)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: menu de ferramentas em portal (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ')')
