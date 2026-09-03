import fs from 'fs'
import { get } from './q.mjs'
const casos = JSON.parse(fs.readFileSync('scratchpad/_sobrep.json','utf8'))
console.log('casos:',casos.length)
// classificacao
const cls = {}
for(const c of casos){
  const [ri,rf]=c.reg.split('-'), [pi,pf]=c.pl.split('-')
  const k = pi.trim()===ri.trim() ? 'inicio IGUAL ao Regular (empilhado)' : 'inicio dentro do Regular'
  cls[k]=(cls[k]||0)+1
}
console.log(cls)
const st={}; for(const c of casos) st[c.status]=(st[c.status]||0)+1
console.log('status da escala:',st)
const comPonto = casos.filter(c=>c.ponto)
console.log('com ponto:',comPonto.length,'| dos quais em competencia Fechada:',comPonto.filter(c=>c.status==='Fechada').length)
console.log('\ncom ponto, por competencia/unidade:')
const t={}; for(const c of comPonto){const k=`${c.comp} ${c.un}`; t[k]=(t[k]||0)+1}
console.log(t)
