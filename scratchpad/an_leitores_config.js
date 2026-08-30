// Quem le' configuracoes_globais, e com QUAL cliente? Decide o desenho da policy de 1.3.
const fs=require('fs'), path=require('path')
const alvos=[]
;(function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name)
  if(e.isDirectory()){ if(!/node_modules|\.next/.test(e.name)) walk(p) }
  else if(/\.(ts|tsx)$/.test(e.name)) alvos.push(p.replace(/\/g,'/'))
}})('src')

const achados=[]
for(const p of alvos){
  const s=fs.readFileSync(p,'utf8')
  if(!s.includes('configuracoes_globais')) continue
  const linhas=s.split(/\r?\n/)
  linhas.forEach((l,i)=>{
    if(!l.includes('configuracoes_globais')) return
    // olha 25 linhas ao redor para achar o cliente e as chaves filtradas
    const jan=linhas.slice(Math.max(0,i-25), i+25).join('\n')
    const admin=/createAdminClient/.test(jan)
    const user=/createClient\(/.test(jan)
    const chaves=[...jan.matchAll(/chave['"]?\s*[,)]?\s*['"]([a-z0-9_]+)['"]/gi)].map(m=>m[1])
    const eqChave=[...jan.matchAll(/\.eq\(\s*['"]chave['"]\s*,\s*['"]([^'"]+)['"]/g)].map(m=>m[1])
    const inChave=[...jan.matchAll(/\.in\(\s*['"]chave['"]\s*,\s*\[([^\]]+)\]/g)].map(m=>m[1])
    achados.push({p,i:i+1,cliente: admin&&!user?'ADMIN':(user&&!admin?'USUARIO':(admin&&user?'ambos':'?')),
                  chaves:[...new Set([...eqChave,...inChave.flatMap(x=>x.split(',').map(y=>y.trim().replace(/['"]/g,'')))])]})
  })
}
console.log('sitios que leem/escrevem configuracoes_globais: '+achados.length+'\n')
const porCliente={}
for(const a of achados){ (porCliente[a.cliente] ||= []).push(a) }
for(const [c,list] of Object.entries(porCliente)){
  console.log(`\n########## cliente = ${c}  (${list.length} sitios)`)
  for(const a of list) console.log(`   ${a.p}:${a.i}   ${a.chaves.length?'chaves: '+a.chaves.join(', '):'(sem filtro de chave — le TUDO)'}`)
}
