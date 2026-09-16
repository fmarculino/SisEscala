/**
 * Valida o portao sim_paginacao_folha.js injetando regressoes REAIS nos arquivos e exigindo
 * reprovacao em cada uma. Restaura tudo ao fim, inclusive se algo falhar no meio.
 *
 * ⚠️ Cada injecao confere que a substituicao foi de fato APLICADA (armadilha 48): injecao que
 *   vira no-op faz o validador "passar" sem ter testado nada.
 */
const fs = require('fs')
const { execFileSync } = require('child_process')

const ACTIONS = 'src/app/(dashboard)/folha-ponto/actions.ts'
const PAGE = 'src/app/(dashboard)/folha-ponto/page.tsx'
const AUTOCLOSE = 'src/utils/autoClose.ts'
const REGERAR = 'src/app/api/folha-ponto/regerar-competencia/route.ts'

const REGRESSOES = [
  ['listagem volta a buscar folha_ponto sem paginar', ACTIONS,
   `    const { linhas: folhas, completo: folhasCompletas } = await buscarTodasPaginas<any>(montarQueryFolhas)`,
   `    const { data: folhas } = await supabase.from('folha_ponto').select('id, status, servidor_id, escala_mensal_id').eq('mes', mes).eq('ano', ano)
    const folhasCompletas = true`],

  ['paginacao da listagem perde o .order (pagina repete/omite linha)', ACTIONS,
   `      return q.order('id', { ascending: true }).range(from, to)
    }

    const { linhas: folhas, completo: folhasCompletas }`,
   `      return q.range(from, to)
    }

    const { linhas: folhas, completo: folhasCompletas }`],

  ['listagem deixa de devolver `completo` para a tela', ACTIONS,
   `    return { servidores: result, completo: escalasCompletas && folhasCompletas }`,
   `    return { servidores: result }`],

  ['tela para de ler o `completo` da action', PAGE,
   `      setListagemCompleta(res.completo !== false)`,
   `      // (regressao injetada)`],

  ['auto-gerar do cron volta a seguir com busca parcial', AUTOCLOSE,
   `    if (!scalesCompleto || !sheetsCompleto) {`,
   `    if (false && (!scalesCompleto || !sheetsCompleto)) {`],

  ['auto-gerar do cron volta a buscar as folhas sem paginar', AUTOCLOSE,
   `    const { linhas: sheets, completo: sheetsCompleto } = await buscarTodasPaginas<any>(`,
   `    const { data: sheets } = await supabase.from('folha_ponto').select('escala_mensal_id').eq('mes', mes).eq('ano', ano)
    const sheetsCompleto = true
    const _naoUsado = ((`],

  ['regerar-competencia volta a seguir com busca parcial', REGERAR,
   `    if (!escalasCompleto || !folhasCompleto) {`,
   `    if (false && (!escalasCompleto || !folhasCompleto)) {`],

  ['auto-corrigir lote volta a buscar tudo de uma vez', ACTIONS,
   `    const { linhas: folhas, completo } = await buscarTodasPaginas<any>(montarQueryFolhas, 200)`,
   `    const { data: folhas } = await montarQueryFolhas(0, 999)
    const completo = true`],
]

const original = new Map()
for (const arq of [ACTIONS, PAGE, AUTOCLOSE, REGERAR]) original.set(arq, fs.readFileSync(arq, 'utf8'))
const restaurar = () => { for (const [arq, txt] of original) fs.writeFileSync(arq, txt) }

const crlf = t => t.replace(/\n/g, '\r\n')
let falhas = 0

try {
  // 1) sem injecao, o portao TEM de passar
  try {
    execFileSync('node', ['scratchpad/sim_paginacao_folha.js'], { stdio: 'pipe' })
    console.log('  OK   portao passa no codigo corrigido')
  } catch {
    console.log(' FALHA portao reprova o codigo corrigido — o portao esta errado')
    falhas++
  }

  // 2) cada regressao tem de reprovar
  for (const [rotulo, arq, velho, novo] of REGRESSOES) {
    const src = original.get(arq)
    const usaCrlf = src.includes('\r\n')
    const v = usaCrlf ? crlf(velho) : velho
    const n = usaCrlf ? crlf(novo) : novo
    const ocorr = src.split(v).length - 1
    if (ocorr !== 1) {
      console.log(` FALHA ${rotulo}: ancora com ${ocorr} ocorrencias — injecao nao testaria nada`)
      falhas++
      continue
    }
    const mutado = src.replace(v, () => n)
    if (mutado === src) {
      console.log(` FALHA ${rotulo}: substituicao virou no-op`)
      falhas++
      continue
    }
    fs.writeFileSync(arq, mutado)
    let reprovou = false
    try { execFileSync('node', ['scratchpad/sim_paginacao_folha.js'], { stdio: 'pipe' }) }
    catch { reprovou = true }
    fs.writeFileSync(arq, src)
    console.log(`${reprovou ? '  OK  ' : ' FALHA'} regressao detectada: ${rotulo}`)
    if (!reprovou) falhas++
  }
} finally {
  restaurar()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : `\nTUDO OK — ${REGRESSOES.length} regressoes injetadas, ${REGRESSOES.length} reprovadas`)
process.exit(falhas ? 1 : 0)
