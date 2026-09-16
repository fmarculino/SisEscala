// Acha texto JSX com ${...} escrito como se fosse template literal: o $ sai LITERAL na tela.
// Heuristica: linha com ${ e SEM crase em lugar nenhum dela (template literal de verdade tem).
const fs=require('fs'),path=require('path')
const arqs=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name)
  if(e.isDirectory())w(f);else if(/\.tsx$/.test(e.name))arqs.push(f)}})('src')
let n=0
for(const f of arqs){
  const linhas=fs.readFileSync(f,'utf8').split(/\r?\n/)
  linhas.forEach((l,i)=>{
    if(!l.includes('${'))return
    if(l.includes('`'))return          // template literal legitimo
    if(/^\s*(\/\/|\*|\/\*)/.test(l))return
    if(/(className|href|src|key|id|title|alt|placeholder)=/.test(l) && !/>\s*\$\{/.test(l)) {
      // atributo com ${ fora de crase tambem e suspeito, mas reporta separado
    }
    n++; console.log(`${f}:${i+1}  ${l.trim()}`)
  })
}
console.log(`\n${n} suspeitos`)
