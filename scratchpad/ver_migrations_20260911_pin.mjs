import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, A = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const HA = { apikey: A, Authorization: `Bearer ${A}`, 'Content-Type': 'application/json' }
let falhou = false
const ok = (c, m) => { console.log((c ? '  OK   ' : '  FALHA') + '  ' + m); if (!c) falhou = true }
const rpc = async (n, b, h = H) => { const r = await fetch(`${U}/rest/v1/rpc/${n}`, { method:'POST', headers:h, body: JSON.stringify(b||{}) }); return { status: r.status, body: await r.text() } }

console.log('=== estrutura ===')
const spec = await (await fetch(`${U}/rest/v1/`, { headers: H })).json()
ok(!!spec.definitions?.tokens_portal, 'tabela tokens_portal existe')
const fila = spec.definitions?.avisos_ponto_fila
ok(fila && !(fila.required || []).includes('telefone'), 'avisos_ponto_fila.telefone deixou de ser obrigatorio')

console.log('\n=== as funcoes novas EXECUTAM (nao so existem) ===')
let r = await rpc('fn_solicitar_redefinicao_pin', { p_matricula: '__NAO_EXISTE__' })
ok(r.status === 200 && r.body.includes('nao_encontrado'), `fn_solicitar_redefinicao_pin responde a matricula inexistente (${r.status} ${r.body.slice(0,60)})`)

r = await rpc('fn_consumir_token_portal', { p_token: 'token_que_nao_existe', p_finalidade: 'redefinir_pin' })
ok(r.status === 200 && r.body.includes('invalido'), `fn_consumir_token_portal recusa token inexistente (${r.status})`)

r = await rpc('fn_confirmar_aviso_ponto_token', { p_token: 'token_que_nao_existe' })
ok(r.status === 200 && r.body.includes('invalido'), `fn_confirmar_aviso_ponto_token recusa token inexistente (${r.status})`)

r = await rpc('fn_redefinir_pin_com_token', { p_token: 'x'.repeat(64), p_pin_novo: '111111' })
ok(r.status === 200 && r.body.includes('pin_recusado'), `PIN repetido recusado ANTES de olhar o token (${r.body.slice(0,60)})`)

console.log('\n=== anon nao alcanca nenhuma delas ===')
for (const f of ['fn_solicitar_redefinicao_pin','fn_redefinir_pin_com_token','fn_consumir_token_portal','fn_emitir_token_portal','fn_confirmar_aviso_ponto_token','fn_solicitar_aviso_ponto']) {
  const a = await rpc(f, {}, HA)
  ok(a.status === 401 || a.status === 404, `${f}: anon recebe ${a.status}`)
}

console.log('\n=== a fila nao tem mais linha pendente com destino errado ===')
const pend = await (await fetch(`${U}/rest/v1/avisos_ponto_fila?select=tipo,canal,destino,tentativas&status=eq.pendente`, { headers: H })).json()
ok(!pend.some(f => f.canal === 'whatsapp' && (f.destino||'').includes('@')), `nenhuma linha manda WhatsApp para e-mail (${pend.length} pendentes)`)

process.exit(falhou ? 1 : 0)
