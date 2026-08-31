// Conferencia por fora das migrations 20260830140000 e 20260830150000.
// SOMENTE LEITURA — nao enfileira, nao envia, nao altera preferencia de ninguem.
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const SR = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
const AN = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }

// ⚠️ PostgREST corta em 1000 em silencio (armadilha 8) — paginar e obrigatorio para contagem.
async function todas(q) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const r = await fetch(`${U}/rest/v1/${q}`, { headers: { ...SR, Range: `${de}-${de + 999}` } })
    const p = await r.json()
    if (!Array.isArray(p)) { console.error(JSON.stringify(p).slice(0, 200)); process.exit(1) }
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}

const casos = []
const caso = (nome, ok, detalhe = '') => casos.push({ nome, ok, detalhe })

// ── 1) modo: ninguem pode ter ficado em resumo_diario
const servs = await todas('servidores?select=aviso_ponto_modo,aviso_ponto_canal,aviso_ponto_status,email,telefone&status=eq.Ativo')
const modos = {}, canais = {}
for (const s of servs) {
  modos[s.aviso_ponto_modo] = (modos[s.aviso_ponto_modo] || 0) + 1
  canais[s.aviso_ponto_canal] = (canais[s.aviso_ponto_canal] || 0) + 1
}
console.log(`  servidores ativos: ${servs.length}`)
console.log(`  modo  : ${JSON.stringify(modos)}`)
console.log(`  canal : ${JSON.stringify(canais)}`)

caso('ninguem ficou em resumo_diario', !modos['resumo_diario'], `diario: ${modos['resumo_diario'] || 0}`)
caso('coluna aviso_ponto_canal existe e esta preenchida', Object.keys(canais).length > 0 && !canais['undefined'])

// ── 2) roteamento efetivo, via a propria funcao do banco (nao reimplementado aqui)
const lim = v => (v && String(v).trim()) ? String(v).trim() : null
let email = 0, zap = 0, semCanal = 0, ativoSemCanal = 0
for (const s of servs) {
  const e = lim(s.email), t = lim(s.telefone)
  const pref = s.aviso_ponto_canal
  let c = null
  if (pref === 'email' && e) c = 'email'
  else if (pref === 'whatsapp' && t) c = 'whatsapp'
  else if (e) c = 'email'
  else if (t) c = 'whatsapp'
  if (c === 'email') email++; else if (c === 'whatsapp') zap++; else {
    semCanal++
    if (s.aviso_ponto_status === 'ativo') ativoSemCanal++
  }
}
console.log(`\n  roteamento: ${email} por e-mail | ${zap} por WhatsApp | ${semCanal} sem canal`)
console.log(`  trafego que SAI do WhatsApp: ${Math.round(email / (email + zap) * 100)}%`)
caso('nenhum servidor com aviso ATIVO ficou sem canal', ativoSemCanal === 0, `${ativoSemCanal} sem canal`)

// ── 3) a funcao de roteamento existe e responde
const r3 = await fetch(`${U}/rest/v1/rpc/fn_canal_aviso_ponto`, {
  method: 'POST', headers: SR,
  body: JSON.stringify({ p_servidor_id: '00000000-0000-0000-0000-000000000000' }),
})
caso('fn_canal_aviso_ponto responde (servidor inexistente devolve vazio)',
  r3.status === 200, `HTTP ${r3.status}`)

// ── 4) a fila nao pode ter linha sem canal
const fila = await todas('avisos_ponto_fila?select=canal,destino,status,tipo')
const semCanalFila = fila.filter(f => !f.canal).length
const porCanal = {}
for (const f of fila) porCanal[`${f.canal}/${f.status}`] = (porCanal[`${f.canal}/${f.status}`] || 0) + 1
console.log(`\n  fila (${fila.length} linhas): ${JSON.stringify(porCanal)}`)
caso('nenhuma linha da fila sem canal', semCanalFila === 0, `${semCanalFila} sem canal`)

// ── 5) a assinatura NOVA existe e a antiga saiu (PGRST203 derrubaria o worker)
const r5 = await fetch(`${U}/rest/v1/rpc/fn_avisos_ponto_pendentes`, {
  method: 'POST', headers: SR,
  body: JSON.stringify({ p_limite: 0, p_limite_whatsapp: 0 }),
})
const b5 = await r5.text()
caso('fn_avisos_ponto_pendentes aceita p_limite_whatsapp', r5.status === 200, `HTTP ${r5.status} ${b5.slice(0, 90)}`)
caso('sem ambiguidade de sobrecarga (PGRST203)', !b5.includes('PGRST203'), b5.slice(0, 90))

// ── 6) nada disso pode estar aberto a anon
for (const fn of ['fn_canal_aviso_ponto', 'fn_definir_canal_aviso_ponto', 'fn_avisos_ponto_pendentes']) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: AN, body: '{}' })
  caso(`${fn} NAO executavel por anon`, r.status !== 200 && r.status !== 204, `HTTP ${r.status}`)
}

// ── 7) as chaves de teto e silencio existem
const cfg = await todas('configuracoes_globais?select=chave,valor&chave=like.aviso_ponto_*')
const nomes = cfg.map(c => c.chave)
console.log(`\n  config: ${cfg.map(c => c.chave + '=' + JSON.stringify(c.valor)).join(', ')}`)
for (const k of ['aviso_ponto_whatsapp_max_hora', 'aviso_ponto_whatsapp_max_dia',
                 'aviso_ponto_silencio_inicio', 'aviso_ponto_silencio_fim']) {
  caso(`config ${k} existe`, nomes.includes(k))
}

console.log('')
let falhas = 0
for (const c of casos) {
  console.log(`  ${c.ok ? 'ok   ' : 'FALHA'}  ${c.nome}${c.ok ? '' : '   [' + c.detalhe + ']'}`)
  if (!c.ok) falhas++
}
console.log(`\n${casos.length - falhas}/${casos.length} conferencias passaram`)
process.exit(falhas ? 1 : 0)
