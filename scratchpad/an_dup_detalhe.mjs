import { U, H, all } from './an_duplicados.mjs'
const spec = await (await fetch(`${U}/rest/v1/`, { headers: H })).json()
const cols = []
for (const [tab, def] of Object.entries(spec.definitions||{}))
  for (const [col, c] of Object.entries(def.properties||{}))
    if (typeof c.description === 'string' && /servidores\.id/.test(c.description)) cols.push([tab,col])
async function count(tab,col,id){
  const r = await fetch(`${U}/rest/v1/${tab}?${col}=eq.${id}&select=${col}&limit=1`,{headers:{...H,Prefer:'count=exact'}})
  return r.ok ? Number((r.headers.get('content-range')||'/0').split('/')[1]) : -1
}
const sv = await all('servidores?select=id,nome,matricula,cpf,status,vinculo_multiplo_confirmado,created_at')
const norm = s => (s||'').replace(/\D/g,'')
const m = new Map()
for(const s of sv){ const c=norm(s.cpf); if(!c) continue; (m.get(c)||m.set(c,[]).get(c)).push(s) }
for (const [cpf, grp] of [...m].filter(([,v])=>v.length>1)) {
  const linhas = []
  for (const s of grp) {
    const usos = []
    for (const [t,c] of cols){ const n = await count(t,c,s.id); if(n>0) usos.push(`${t}=${n}`) }
    linhas.push(`   ${s.matricula.padEnd(10)} ${s.status.padEnd(7)} vm=${s.vinculo_multiplo_confirmado?'S':'n'} criado ${s.created_at.slice(0,10)} | ${usos.join(' ')||'(sem vinculo nenhum)'}`)
  }
  console.log(`\n${grp[0].nome.trim()}  cpf ${cpf}`)
  console.log(linhas.join('\n'))
}
