/**
 * Troca a preservacao cega das QUATRO copias da geracao de folha pela fonte unica
 * `preservarCampo` (src/utils/folha/preservacao.ts). Aborta se a contagem divergir —
 * mesma disciplina das migrations (armadilha 1 do CLAUDE.md).
 */
const fs = require('fs')
const path = require('path')

const ALVOS = [
  { arquivo: 'src/app/(dashboard)/folha-ponto/actions.ts', copias: 2, importDepois: "import { sequenciarDia, PASSOS_FOLHA } from '@/utils/folha/sequenciaDia'" },
  { arquivo: 'src/app/consultar-escala/actions.ts', copias: 2, importDepois: null },
]

const CAMPOS = ['entrada', 'saida', 'saida_intervalo', 'retorno_intervalo']
const IMPORT = "import { preservarCampo } from '@/utils/folha/preservacao'"

let totalTrocas = 0
for (const alvo of ALVOS) {
  const p = path.join(__dirname, '..', alvo.arquivo)
  let src = fs.readFileSync(p, 'utf8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'

  let trocas = 0
  for (const campo of CAMPOS) {
    const de = `if (shouldPreserve && registroExistente?.${campo}) {`
    const para = `if (shouldPreserve && preservarCampo(registroExistente, '${campo}')) {`
    const n = src.split(de).length - 1
    if (n !== alvo.copias) {
      console.error(`ABORTADO: ${alvo.arquivo} — esperava ${alvo.copias}x "${de}", achei ${n}.`)
      process.exit(1)
    }
    src = src.split(de).join(para)
    trocas += n
  }

  if (src.includes(IMPORT)) {
    console.error(`ABORTADO: ${alvo.arquivo} ja importa preservarCampo — script rodado duas vezes?`)
    process.exit(1)
  }
  if (alvo.importDepois) {
    if (!src.includes(alvo.importDepois)) {
      console.error(`ABORTADO: ${alvo.arquivo} — nao achei a linha de import de referencia.`)
      process.exit(1)
    }
    src = src.replace(alvo.importDepois, alvo.importDepois + eol + IMPORT)
  } else {
    // insere depois do ultimo import do topo do arquivo
    const linhas = src.split(eol)
    let ultimo = -1
    for (let i = 0; i < linhas.length && i < 60; i++) if (/^import .*from ['"]/.test(linhas[i])) ultimo = i
    if (ultimo < 0) { console.error(`ABORTADO: ${alvo.arquivo} — nenhum import encontrado no topo.`); process.exit(1) }
    linhas.splice(ultimo + 1, 0, IMPORT)
    src = linhas.join(eol)
  }

  fs.writeFileSync(p, src)
  console.log(`OK ${alvo.arquivo}: ${trocas} trocas + import`)
  totalTrocas += trocas
}

if (totalTrocas !== 16) { console.error(`ABORTADO: esperava 16 trocas no total, fiz ${totalTrocas}.`); process.exit(1) }
console.log('total: ' + totalTrocas + ' trocas nas 4 copias da geracao de folha')
