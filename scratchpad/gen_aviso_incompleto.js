// Insere o aviso de relatorio incompleto nas 4 telas (05/09/2026).
// Sem isto, `dadosCompletos` seria variavel morta e a falha de paginacao voltaria a ser
// silenciosa — trocar um numero errado por outro numero errado nao resolve nada.
const fs = require('fs')
const CR = String.fromCharCode(13), NL = String.fromCharCode(10)

const IMPORT_DE = {
  'consolidado': "import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'",
  'rh': "import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'",
  'distribuicao': "import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'",
  'plantao-sobreaviso': "import { DiagnosticsTable } from './_components/DiagnosticsTable'"
}
const ABERTURA = {
  'consolidado': '    <div className="p-8 max-w-7xl mx-auto space-y-8">',
  'rh': '    <div className="space-y-8">',
  'distribuicao': '    <div className="p-8 max-w-7xl mx-auto space-y-8">',
  'plantao-sobreaviso': '    <div className="p-8 max-w-7xl mx-auto space-y-8">'
}

let total = 0
for (const tela of Object.keys(IMPORT_DE)) {
  const P = 'src/app/(dashboard)/relatorios/' + tela + '/page.tsx'
  let s = fs.readFileSync(P, 'utf8')
  const CRLF = s.indexOf(CR + NL) >= 0
  if (CRLF) s = s.split(CR + NL).join(NL)

  const imp = IMPORT_DE[tela]
  let c = s.split(imp).length - 1
  if (c !== 1) { console.error('ABORTA ' + P + ': import ancora ' + c + 'x'); process.exit(1) }
  s = s.split(imp).join(imp + NL + "import { AvisoDadosIncompletos } from '@/app/(dashboard)/relatorios/_components/AvisoDadosIncompletos'")

  const ab = ABERTURA[tela]
  c = s.split(ab).length - 1
  if (c !== 1) { console.error('ABORTA ' + P + ': abertura do JSX ' + c + 'x'); process.exit(1) }
  s = s.split(ab).join(ab + NL + '      <AvisoDadosIncompletos completo={dadosCompletos} />')

  fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
  console.log(P + ': aviso inserido')
  total++
}
console.log('TOTAL: ' + total + ' telas')
