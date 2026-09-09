import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
async function q(p){ const r = await fetch(`${U}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error('ERRO',p,r.status,(await r.text()).slice(0,200)); process.exit(1)} return r.json() }

console.log('agora (UTC):', new Date().toISOString())
const d = await q(`dispositivos_rep?select=nome,endereco_ip,coletor_ip,coletor_versao,coletor_host,ultimo_contato_em,ativo&coletor_ip=eq.10.110.4.123&order=nome`)
console.log('\n=== relogios da maquina 10.110.4.123 ===')
for (const x of d) console.log(`${x.nome} | rele=${x.endereco_ip} | host=${x.coletor_host} | v=${x.coletor_versao} | contato=${x.ultimo_contato_em}`)

const f = await q(`rep_cadastros_fila?select=erro,processado_em&status=eq.falhou&erro=ilike.*connectex*&limit=1`)
console.log('\n=== mensagem completa de uma falha de rede ===')
console.log(f[0]?.erro)

const s = await q(`rep_sincronizacoes?select=dispositivo_id,status,iniciada_em,registros_recebidos,erro&order=iniciada_em.desc&limit=12`)
const nm = Object.fromEntries((await q(`dispositivos_rep?select=id,nome`)).map(x=>[x.id,x.nome]))
console.log('\n=== ultimas 12 sincronizacoes do parque ===')
for (const x of s) console.log(`${x.iniciada_em} | ${nm[x.dispositivo_id]} | ${x.status} | reg=${x.registros_recebidos}`)
