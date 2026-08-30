// Leitura SOMENTE das chaves de comunicacao em producao, com MASCARAMENTO de segredo.
import fs from 'node:fs'
const env = Object.fromEntries(
  fs.readFileSync('.env.production','utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')] })
)
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
if (!U || !K) { console.error('faltou URL ou service key em .env.production'); process.exit(1) }
const H = { apikey: K, Authorization: `Bearer ${K}` }

const SEGREDO = /senha|password|_key$|key$|token|secret|pass/i

const resumo = t => t ? `«${t.length} chars, ${t.slice(0,2)}…${t.slice(-2)}»` : '(vazio)'

// ⚠️ Mascarar pelo NOME DA CHAVE nao basta, e essa foi uma licao cara (armadilha 34): as chaves
// `unidade_comunicacao_<uuid>` sao blobs JSONB com `email_smtp_senha` e `whatsapp_astracall_key`
// ANINHADOS no valor, e o nome delas nao casa com padrao nenhum. A primeira versao deste script
// mascarava so por nome e imprimiu a chave de API por extenso.
//
// Regra: mascare o VALOR, recursivamente, onde o CAMPO for sensivel — nunca so a chave de topo.
const mascararValor = v => {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(mascararValor)
  if (typeof v === 'object') {
    const out = {}
    for (const [k, val] of Object.entries(v)) {
      out[k] = SEGREDO.test(k) && typeof val === 'string' && val
        ? resumo(val)
        : mascararValor(val)
    }
    return out
  }
  return v
}

const mask = v => {
  if (typeof v === 'string') return resumo(v.replace(/^"|"$/g, ''))
  return resumo(JSON.stringify(v) || '')
}

/** Imprime qualquer valor de config com os campos de credencial ja resumidos, em qualquer nivel. */
const seguro = v => typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(mascararValor(v))

const r = await fetch(`${U}/rest/v1/configuracoes_globais?select=chave,valor`, { headers: H })
if (!r.ok) { console.error('HTTP', r.status, await r.text()); process.exit(1) }
const rows = await r.json()
console.log(`total de chaves em configuracoes_globais: ${rows.length}\n`)

const com = rows.filter(x => /^email_|^whatsapp_|^unidade_comunicacao_/.test(x.chave))
console.log('--- chaves de comunicacao ---')
for (const x of com.sort((a,b)=>a.chave.localeCompare(b.chave))) {
  const sensivel = SEGREDO.test(x.chave)
  console.log(`  ${x.chave.padEnd(42)} ${sensivel ? mask(x.valor) : seguro(x.valor)}`)
}

console.log('\n--- QUANTAS chaves casariam com a denylist da correcao 1.3 ---')
const alvo = rows.filter(x => SEGREDO.test(x.chave))
console.log(`  ${alvo.length} de ${rows.length}:`)
for (const x of alvo) console.log(`    ${x.chave}  -> ${mask(x.valor)}`)
