import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()]}))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}` }
export async function all(path){
  const out=[]
  for(let from=0;;from+=1000){
    const r = await fetch(`${U}/rest/v1/${path}`, { headers:{...H, Range:`${from}-${from+999}`} })
    if(!r.ok) throw new Error(path+' -> '+r.status+' '+await r.text())
    const p = await r.json(); out.push(...p); if(p.length<1000) break
  }
  return out
}
export { U, K, H }
