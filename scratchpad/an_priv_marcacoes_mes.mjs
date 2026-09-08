import { env } from './_env.mjs'
for (const [rot, arq] of [['PRODUCAO','.env.production'],['HOMOLOG','.env.local']]) {
  const E=env(arq); const U=E.NEXT_PUBLIC_SUPABASE_URL, K=E.SUPABASE_SERVICE_ROLE_KEY, A=E.NEXT_PUBLIC_SUPABASE_ANON_KEY
  for (const [quem,key] of [['anon',A],['service',K]]) {
    const r=await fetch(`${U}/rest/v1/rpc/fn_marcacoes_mes`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_servidor_ids:[],p_mes:9,p_ano:2026})})
    console.log(rot, quem, '->', r.status)
  }
}
