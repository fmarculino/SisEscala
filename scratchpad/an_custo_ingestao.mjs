import { env } from './_env.mjs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const D = '19454bce-aa64-45af-865f-df2b18e0a205'
const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(p+' '+r.status+' '+await r.text()); return r.json() }
const rpc = async (fn, b) => { const t=Date.now(); const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method:'POST', headers:H, body:JSON.stringify(b) }); const txt=await r.text(); return { ms: Date.now()-t, status:r.status, txt: txt.slice(0,300) } }

// estado do dispositivo
const d = await q(`dispositivos_rep?select=nome,ultimo_nsr,ultimo_contato_em,coletor_versao,coletor_versao_em,coletor_host,coletor_ip,updated_at&id=eq.${D}`)
console.log('DISPOSITIVO:', JSON.stringify(d[0], null, 1))

// quantas batidas os 3 relogios tiveram por dia (16..19)
const disp = { '19454bce-aa64-45af-865f-df2b18e0a205':'HMI-01', '4208f8f4-3596-45a6-ac0d-7e76da241043':'HMI-02', '4e0ca06b-d123-4223-a740-fba7ff921e9f':'HMI-03' }
console.log('\n=== BATIDAS POR DIA (marcacoes_ponto, origem rep) ===')
for (const [id, nome] of Object.entries(disp)) {
  const linha = []
  for (const dia of ['16','17','18','19']) {
    const r = await fetch(`${U}/rest/v1/marcacoes_ponto?select=id&dispositivo_id=eq.${id}&ocorrido_em=gte.2026-09-${dia}T03:00:00Z&ocorrido_em=lt.2026-09-${Number(dia)+1}T03:00:00Z`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
    linha.push(`${dia}/09=${(r.headers.get('content-range')||'').split('/')[1]}`)
  }
  console.log(`${nome}: ${linha.join('  ')}`)
}

// custo de uma alocacao (STABLE, nao escreve)
console.log('\n=== CUSTO DE fn_alocar_marcacoes_dia (amostra) ===')
const alvos = await q(`marcacoes_ponto?select=servidor_id,ocorrido_em&dispositivo_id=eq.${D}&servidor_id=not.is.null&ocorrido_em=gte.2026-09-17T03:00:00Z&ocorrido_em=lt.2026-09-18T03:00:00Z&limit=8`)
let soma = 0
for (const a of alvos) {
  const dia = new Date(new Date(a.ocorrido_em).getTime() - 3*3600*1000).toISOString().slice(0,10)
  const r = await rpc('fn_alocar_marcacoes_dia', { p_servidor_id: a.servidor_id, p_data: dia })
  soma += r.ms
  console.log(`  ${dia} ${a.servidor_id.slice(0,8)} -> ${r.status} ${r.ms}ms`)
}
console.log(`  media: ${Math.round(soma/alvos.length)}ms  |  extrapolado p/ 250 pares: ${Math.round(soma/alvos.length*250/1000)}s`)
