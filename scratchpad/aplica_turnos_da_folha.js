/**
 * Faz as QUATRO copias da geracao de folha consolidarem apenas os turnos que a frente da folha
 * representa (turnosDaFolha), para o Plantao emendado parar de virar hora extra.
 * Aborta se a contagem divergir — mesma disciplina das migrations (armadilha 1 do CLAUDE.md).
 */
const fs = require('fs')
const path = require('path')

const IMPORT_ALVO = "import { resolverMarcacaoDoDia"
const ALVOS = [
  { arquivo: 'src/app/(dashboard)/folha-ponto/actions.ts', copias: 2 },
  { arquivo: 'src/app/consultar-escala/actions.ts', copias: 2 },
]

const TROCAS = [
  {
    de: 'const dayShifts = escalaDiaria?.filter((d: any) => d.dia === day) || []',
    para: 'const dayShifts = turnosDaFolha(escalaDiaria?.filter((d: any) => d.dia === day) || [])',
  },
  {
    de: 'const dayShifts = currentShifts.filter(d => d.dia === day)',
    para: 'const dayShifts = turnosDaFolha(currentShifts.filter(d => d.dia === day))',
  },
]

let total = 0
for (const alvo of ALVOS) {
  const p = path.join(__dirname, '..', alvo.arquivo)
  let src = fs.readFileSync(p, 'utf8')

  let trocas = 0
  for (const t of TROCAS) {
    const n = src.split(t.de).length - 1
    if (n === 0) continue
    src = src.split(t.de).join(t.para)
    trocas += n
  }
  if (trocas !== alvo.copias) {
    console.error(`ABORTADO: ${alvo.arquivo} — esperava ${alvo.copias} montagens de dayShifts, troquei ${trocas}.`)
    process.exit(1)
  }

  if (src.includes('turnosDaFolha,') || src.includes(', turnosDaFolha')) {
    console.error(`ABORTADO: ${alvo.arquivo} ja importa turnosDaFolha — script rodado duas vezes?`)
    process.exit(1)
  }
  const iImport = src.indexOf(IMPORT_ALVO)
  if (iImport < 0) { console.error(`ABORTADO: ${alvo.arquivo} — nao achei o import de resolverMarcacaoDoDia.`); process.exit(1) }
  src = src.replace(IMPORT_ALVO, IMPORT_ALVO.replace('resolverMarcacaoDoDia', 'resolverMarcacaoDoDia, turnosDaFolha'))

  fs.writeFileSync(p, src)
  console.log(`OK ${alvo.arquivo}: ${trocas} trocas + import`)
  total += trocas
}

if (total !== 4) { console.error(`ABORTADO: esperava 4 trocas no total, fiz ${total}.`); process.exit(1) }
console.log('total: ' + total + ' trocas nas 4 copias da geracao de folha')
