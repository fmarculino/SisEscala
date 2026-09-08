import { env } from './_env.mjs'
const E=env('.env.production');const U=E.NEXT_PUBLIC_SUPABASE_URL,K=E.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,Authorization:`Bearer ${K}`}
const sel='id,servidor_id,ocorrido_em,observacao,origem,unidade_id,dispositivo_id,unidades(nome),dispositivos_rep(nome)'
const r=await fetch(`${U}/rest/v1/marcacoes_ponto?select=${encodeURIComponent(sel)}&origem=eq.rep&dispositivo_id=not.is.null&limit=2`,{headers:H})
console.log('HTTP', r.status)
console.log((await r.text()).slice(0,700))
