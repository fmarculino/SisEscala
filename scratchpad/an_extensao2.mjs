import fs from 'node:fs'
const multi = JSON.parse(fs.readFileSync('scratchpad/_multi.json','utf8'))
let padraoEuz=0, exemplos=[]
for (const p of multi){
  const parciais = p.v.filter(d=>(!!d.e)!==(!!d.s))
  const completas = p.v.filter(d=>d.e&&d.s)
  const soSaida = parciais.filter(d=>!d.e&&d.s)
  if (soSaida.length>=1 && completas.length>=1){ padraoEuz++; if(exemplos.length<6) exemplos.push(p) }
}
console.log('PADRAO "uma linha so com SAIDA + outra linha COMPLETA no mesmo dia":', padraoEuz, 'de', multi.length)
console.log(JSON.stringify(exemplos,null,1).slice(0,2200))
