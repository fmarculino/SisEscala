import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()]}))
export const U = env.NEXT_PUBLIC_SUPABASE_URL
export const K = env.SUPABASE_SERVICE_ROLE_KEY

// ⚠️ O repositorio e PUBLICO (armadilha 18). A chave e LIDA do ambiente, nunca colada aqui — e a
// ausencia dela e falha explicita, nunca fallback. Foi um `service_role` literal em scripts/ que
// o GitGuardian pegou em 21/08/2026, e apagar do git nao desfaz vazamento: so rotacionar desfaz.
if (!U || !K) {
  throw new Error('Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY em .env.production.')
}

export const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type':'application/json' }
export async function get(path){
  const out=[]
  for(let from=0;;from+=1000){
    const r=await fetch(`${U}/rest/v1/${path}`,{headers:{...H,Range:`${from}-${from+999}`}})
    if(!r.ok){ throw new Error(`${r.status} ${await r.text()}`) }
    const p=await r.json(); out.push(...p); if(p.length<1000) break
  }
  return out
}
export async function rpc(fn, body){
  const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(body||{})})
  const t=await r.text(); try{return JSON.parse(t)}catch{return t}
}
