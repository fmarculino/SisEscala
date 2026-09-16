// Varre consultas PostgREST que podem estourar o teto de 1000 sem paginar.
// Heuristica: bloco .from('X') ... ate o `await`/`;`, com filtro de LISTA (mes/ano/ativo/in)
// e sem .range/.limit/.single/.maybeSingle/buscarTodasPaginas.
const fs=require('fs'),path=require('path')
const alvos=['folha_ponto','escala_mensal','escala_diaria','servidores','marcacoes_ponto','servidores_eventos']
const arquivos=[]
;(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name)
  if(e.isDirectory())walk(f);else if(/\.(ts|tsx)$/.test(e.name))arquivos.push(f)}})('src')
let n=0
for(const f of arquivos){
  const s=fs.readFileSync(f,'utf8'),linhas=s.split(/\r?\n/)
  for(let i=0;i<linhas.length;i++){
    const m=linhas[i].match(/\.from\('(\w+)'\)/)
    if(!m||!alvos.includes(m[1]))continue
    const bloco=linhas.slice(i,i+14).join('\n').split(/\n\s*\n/)[0]
    const corte=bloco.search(/\n\s*(const|let|if|return|\})/)
    const b=corte>0?bloco.slice(0,corte):bloco
    if(/\.(single|maybeSingle|range|limit)\(/.test(b))continue
    if(/buscarTodasPaginas/.test(linhas.slice(Math.max(0,i-8),i+2).join('\n')))continue
    if(!/\.(eq|in|gte|lte|neq|is)\(/.test(b))continue
    // ignora filtro por id unico
    if(/\.eq\('id'/.test(b))continue
    const filtros=[...b.matchAll(/\.(eq|in|gte|lte|neq|is)\('([\w.]+)'/g)].map(x=>x[2])
    const ehLista=filtros.some(c=>/mes|ano|ativo|status|unidade_id|setor_id|servidor_id|escala_mensal_id|dispositivo_id/.test(c))
    if(!ehLista)continue
    n++
    console.log(`${f}:${i+1}  ${m[1]}  filtros: ${filtros.join(',')}`)
  }
}
console.log(`\n${n} candidatos`)
