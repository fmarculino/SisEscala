import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const APLICAR = process.argv.includes('--aplicar')

const q = async p => { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H }); if(!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`); return r.json() }
const patch = async (p, body) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { method:'PATCH', headers:{...H, Prefer:'return=representation'}, body: JSON.stringify(body) })
  if(!r.ok) throw new Error(`PATCH ${p} ${r.status} ${await r.text()}`); return r.json()
}

const fila = await q('avisos_ponto_fila?select=id,servidor_id,telefone,destino,canal,tentativas,criado_em&tipo=eq.confirmacao_optin&status=eq.pendente&order=criado_em.asc')
const corrigir = [], encerrar = []

for (const f of fila) {
  const s = (await q(`servidores?select=nome,matricula,aviso_ponto_status,telefone&id=eq.${f.servidor_id}`))[0]
  const alvo = { ...f, nome: s?.nome, matricula: s?.matricula, st: s?.aviso_ponto_status }
  // Valida = o pedido ainda esta de pe no cadastro. So essas devem receber "responda SIM".
  // Exige telefone na propria linha: e o numero gravado no momento do pedido.
  if (s?.aviso_ponto_status === 'pendente_confirmacao' && f.telefone && f.tentativas < 3) corrigir.push(alvo)
  else encerrar.push(alvo)
}

console.log(`\n=== (1) CORRIGIR destino -> telefone  [${corrigir.length} linha(s)] ===`)
console.table(corrigir.map(f=>({nome:f.nome?.slice(0,28),mat:f.matricula,de:f.destino||'(null)',para:f.telefone,tent:f.tentativas})))

console.log(`=== (2) ENCERRAR como falha  [${encerrar.length} linha(s)] ===`)
console.table(encerrar.map(f=>({nome:f.nome?.slice(0,28),mat:f.matricula,status_servidor:f.st,destino:(f.destino||'(null)').slice(0,28),tent:f.tentativas})))

if (!APLICAR) { console.log('\n>>> ENSAIO. Nada foi escrito. Rode com --aplicar.'); process.exit(0) }

let ok1 = 0, ok2 = 0
for (const f of corrigir) { await patch(`avisos_ponto_fila?id=eq.${f.id}`, { destino: f.telefone, canal: 'whatsapp' }); ok1++ }
for (const f of encerrar) {
  await patch(`avisos_ponto_fila?id=eq.${f.id}`, {
    status: 'falha', tentativas: 3, processado_em: new Date().toISOString(),
    motivo_falha: 'Encerrado em 11/09/2026: pedido de opt-in expirado enquanto o despachador estava parado (cron em formato antigo desde 30/08). Nao reenviado de proposito.',
  }); ok2++
}
console.log(`\n>>> APLICADO: ${ok1} corrigida(s), ${ok2} encerrada(s).`)
