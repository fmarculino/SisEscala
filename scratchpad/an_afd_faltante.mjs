import fs from 'fs'
const raw = fs.readFileSync('scratchpad/_afd/hmi01_130690.afd', 'latin1')
const linhas = raw.split(/\r?\n/).filter(l => l.trim().length > 0)
console.log(`linhas nao vazias: ${linhas.length}`)
const tipos = {}
const porDia = {}
const idents = new Set()
let nsrMin = Infinity, nsrMax = -Infinity
for (const l of linhas) {
  const nsr = Number(l.slice(0,9))
  const tipo = l.slice(9,10)
  if (!Number.isFinite(nsr) || l.length < 12) { tipos['(rodape)'] = (tipos['(rodape)']||0)+1; continue }
  tipos[tipo] = (tipos[tipo]||0)+1
  if (nsr < nsrMin) nsrMin = nsr
  if (nsr > nsrMax) nsrMax = nsr
  if (tipo === '3') {
    const dt = l.slice(10,22) // DDMMYYYYHHMM
    const dia = `${dt.slice(4,8)}-${dt.slice(2,4)}-${dt.slice(0,2)}`
    porDia[dia] = (porDia[dia]||0)+1
    idents.add(l.slice(22,34))
  }
}
console.log('tipos:', JSON.stringify(tipos))
console.log(`NSR ${nsrMin}..${nsrMax}`)
console.log('batidas por dia:', JSON.stringify(porDia, null, 1))
console.log(`identificadores distintos: ${idents.size}`)
fs.writeFileSync('scratchpad/_afd/idents.json', JSON.stringify([...idents]))
// lote de 500 vs resto
console.log(`\nfatiamento do coletor: lote1=${Math.min(500,linhas.length)} linhas, lote2=${Math.max(0,linhas.length-500)}`)
