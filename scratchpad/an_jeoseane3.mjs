import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function one(path){ const r = await fetch(`${U}/rest/v1/${path}`,{headers:H}); if(!r.ok){console.error(path,r.status,await r.text());return null} return r.json() }
const m = await one(`marcacoes_ponto?select=*&limit=1`)
console.log('COLUNAS marcacoes_ponto:', Object.keys(m[0]).join(', '))
const t = await one(`dicionario_turnos?select=*&limit=1`)
console.log('\nCOLUNAS dicionario_turnos:', Object.keys(t[0]).join(', '))
const d = await one(`dispositivos_rep?select=*&limit=1`)
console.log('\nCOLUNAS dispositivos_rep:', Object.keys(d[0]).join(', '))
const ed = await one(`escala_diaria?select=*&limit=1`)
console.log('\nCOLUNAS escala_diaria:', Object.keys(ed[0]).join(', '))
