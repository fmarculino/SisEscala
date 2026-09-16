import { env } from './_env.mjs'
for (const amb of ['.env.production','.env.local']) {
  let E; try { E=env(amb) } catch(e){ console.log(amb,'-> sem arquivo'); continue }
  const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
  if(!U||!K){console.log(amb,'-> sem credencial');continue}
  const H={apikey:K,Authorization:`Bearer ${K}`}
  const r=await fetch(`${U}/rest/v1/dispositivos_rep?select=*&limit=1`,{headers:H})
  if(!r.ok){console.log(amb,r.status,(await r.text()).slice(0,120));continue}
  const j=await r.json()
  console.log(`\n=== ${amb}  (${U.replace('https://','').slice(0,40)}) ===`)
  console.log(' colunas dispositivos_rep:', Object.keys(j[0]||{}).join(', '))
  console.log(' tem atende_toda_unidade?', Object.keys(j[0]||{}).includes('atende_toda_unidade'))
  const r2=await fetch(`${U}/rest/v1/dispositivos_rep_setores?select=*&limit=1`,{headers:H})
  const j2=r2.ok?await r2.json():[]
  console.log(' colunas dispositivos_rep_setores:', Object.keys(j2[0]||{}).join(', '))
}
