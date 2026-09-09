// Prova, em PRODUCAO, que 20260909120000 esta valendo: falha transitoria em item novo com muitas
// tentativas tem que continuar 'pendente' (com o teto antigo de 5 tentativas viraria 'falhou').
// Cria UMA linha de fila e a APAGA no fim, inclusive se der erro. Usa um dispositivo INATIVO
// sempre que houver um, para que nenhum coletor possa pegar o item na janela do ensaio.
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] }))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey:K, Authorization:`Bearer ${K}`, 'Content-Type':'application/json' }
const q = async p => { const r=await fetch(`${U}/rest/v1/${p}`,{headers:H}); if(!r.ok){console.error(r.status,(await r.text()).slice(0,200));process.exit(1)} return r.json() }
const rpc = async (f,b) => { const r=await fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)}); const txt = await r.text(); let body = txt.slice(0,200); if (r.ok && txt) { try { body = JSON.parse(txt) } catch {} } return { status: r.status, body } }

let disp = (await q(`dispositivos_rep?select=id,nome,ativo,ultimo_contato_em&ativo=eq.false&limit=1`))[0]
// Sem dispositivo inativo, use o de contato MAIS ANTIGO: quanto mais tempo o coletor esta fora,
// menor a chance de ele pedir pendencias na janela de segundos deste ensaio.
if (!disp) disp = (await q(`dispositivos_rep?select=id,nome,ativo,ultimo_contato_em&order=ultimo_contato_em.asc.nullsfirst&limit=1`))[0]
const serv = (await q(`servidores?select=id,nome&order=created_at&limit=1`))[0]
console.log(`ensaio em: ${disp.nome} (ativo=${disp.ativo}) / ${serv.nome}`)

let filaId = null, falhas = 0
const ok = (c,m) => { console.log(`${c?'  ok  ':'FALHA '} ${m}`); if(!c) falhas++ }
try {
  const ins = await fetch(`${U}/rest/v1/rep_cadastros_fila`, { method:'POST',
    headers:{...H, Prefer:'return=representation'},
    body: JSON.stringify({ dispositivo_id: disp.id, servidor_id: serv.id, status:'pendente',
                           tentativas: 100, erro: 'ENSAIO 20260909120000 - apagar' }) })
  const linha = (await ins.json())[0]
  filaId = linha.id
  console.log(`  linha de ensaio criada: ${filaId} (tentativas=100)`)

  // (A) transitorio em item NOVO: com o teto antigo de 5 tentativas, viraria 'falhou'.
  const r = await rpc('fn_confirmar_cadastro_rep', {
    p_fila_id: filaId, p_sucesso: false, p_device_user_id: null,
    p_erro: 'Post "https://10.110.4.19:443/login.fcgi": dial tcp: connectex: A connection attempt failed',
    p_identificador_afd: '', p_transitorio: true, p_dispositivo_id: disp.id })
  ok((r.status === 200 || r.status === 204), `RPC respondeu ok (${r.status} ${r.status>=300?r.body:''})`)
  const dep = (await q(`rep_cadastros_fila?select=status,tentativas,proxima_tentativa_em&id=eq.${filaId}`))[0]
  ok(dep.status === 'pendente', `101a tentativa transitoria continua 'pendente' (veio '${dep.status}')`)
  ok(dep.tentativas === 101, `contador avancou para 101 (veio ${dep.tentativas})`)
  const espera = dep.proxima_tentativa_em ? (new Date(dep.proxima_tentativa_em) - Date.now())/60000 : null
  // Sem o teto, 101 tentativas dariam 505 min. Com teto, 60. A folga de 15 min cobre o desvio
  // entre o relogio desta maquina e o now() do banco sem deixar de distinguir os dois casos.
  ok(espera !== null && espera <= 75, `espera com teto (${espera === null ? 'nula' : espera.toFixed(1)+' min'}; sem teto seriam 505)`)

  // (B) RECUSA do equipamento continua definitiva no primeiro erro.
  await fetch(`${U}/rest/v1/rep_cadastros_fila?id=eq.${filaId}`, { method:'PATCH', headers:H,
    body: JSON.stringify({ status:'pendente', tentativas:0, proxima_tentativa_em:null }) })
  const r2 = await rpc('fn_confirmar_cadastro_rep', {
    p_fila_id: filaId, p_sucesso: false, p_device_user_id: null,
    p_erro: 'add_users.fcgi recusou (formato users:[{pis}]): PIS ja cadastrado: 1',
    p_identificador_afd: '', p_transitorio: false, p_dispositivo_id: disp.id })
  ok((r2.status === 200 || r2.status === 204), `RPC recusa respondeu ok (${r2.status})`)
  const dep2 = (await q(`rep_cadastros_fila?select=status&id=eq.${filaId}`))[0]
  ok(dep2.status === 'falhou', `recusa do equipamento continua definitiva (veio '${dep2.status}')`)

  // (C) guard de dono da fila (item 10 da auditoria) sobreviveu a copia?
  await fetch(`${U}/rest/v1/rep_cadastros_fila?id=eq.${filaId}`, { method:'PATCH', headers:H,
    body: JSON.stringify({ status:'pendente' }) })
  const r3 = await rpc('fn_confirmar_cadastro_rep', {
    p_fila_id: filaId, p_sucesso: true, p_device_user_id: null, p_erro: '',
    p_identificador_afd: '', p_transitorio: false,
    p_dispositivo_id: '00000000-0000-0000-0000-000000000000' })
  ok(r3.status !== 200 && String(r3.body).includes('nao pertence ao dispositivo'),
     `guard de dono da fila intacto (HTTP ${r3.status})`)
} finally {
  if (filaId) {
    // Apaga qualquer vinculo que o ensaio possa ter aberto, e a linha de fila.
    await fetch(`${U}/rest/v1/rep_cadastros_fila?id=eq.${filaId}`, { method:'DELETE', headers:H })
    const resto = await q(`rep_cadastros_fila?select=id&id=eq.${filaId}`)
    console.log(resto.length === 0 ? '  linha de ensaio apagada' : '  ATENCAO: linha de ensaio NAO foi apagada: '+filaId)
    if (resto.length) falhas++
  }
}
console.log(`\nfalhas=${falhas}`)
process.exit(falhas ? 1 : 0)
