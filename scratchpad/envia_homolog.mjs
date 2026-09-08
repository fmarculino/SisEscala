// Envia uma migration para HOMOLOGACAO em pedacos, via PostgREST, e executa statement a
// statement pela funcao ponte _deploy_run. Serve so' para validar a migration antes de o
// usuario aplica-la; a ponte e' removida no fim.
//
// Uso: node scratchpad/envia_homolog.mjs <arquivo.sql>
import fs from 'fs'
import { env } from './_env.mjs'

const E = env('.env.local')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

const arquivo = process.argv[2]
if (!arquivo) { console.error('uso: node scratchpad/envia_homolog.mjs <arquivo.sql>'); process.exit(1) }
if (!U.includes('mtgfmxsbsyknotvwzdcr')) {
  console.error(`ABORTADO: .env.local nao aponta para homologacao (${U}). Este script nunca toca em producao.`)
  process.exit(1)
}

const sql = fs.readFileSync(arquivo, 'utf8')

// Quebra em statements pelos delimitadores de dollar-quoting que o projeto usa. Cada fatia vai
// do fim do statement anterior ate o fim do proprio delimitador — comentarios soltos entre
// statements viajam junto com o seguinte, o que e' inofensivo.
const FIMS = ['$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;', '$fnbloco$;', '$fnaloc$;', '$conf$;']
const statements = []
let pos = 0
while (pos < sql.length) {
  let melhor = -1, tamanho = 0
  for (const f of FIMS) {
    const i = sql.indexOf(f, pos)
    if (i >= 0 && (melhor < 0 || i < melhor)) { melhor = i; tamanho = f.length }
  }
  if (melhor < 0) break
  statements.push(sql.slice(pos, melhor + tamanho))
  pos = melhor + tamanho
}
const resto = sql.slice(pos).trim()
if (resto && !resto.split('\n').every(l => l.trim() === '' || l.trim().startsWith('--'))) {
  console.error('ABORTADO: sobrou texto que nao e comentario depois do ultimo statement:')
  console.error(resto.slice(0, 400))
  process.exit(1)
}

console.log(`${arquivo}: ${statements.length} statement(s)`)
statements.forEach((s, i) => {
  const m = s.match(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)|DO \$conf\$/)
  console.log(`  [${i}] ${(m ? m[1] || 'DO (conferencia)' : '???').padEnd(30)} ${s.length} bytes`)
})

const PEDACO = 60000
for (let i = 0; i < statements.length; i++) {
  const id = `st${i}`
  await fetch(`${U}/rest/v1/_deploy_sql?id=eq.${id}`, { method: 'DELETE', headers: H })
  const linhas = []
  for (let p = 0, o = 0; p < statements[i].length; p += PEDACO, o++) {
    linhas.push({ id, ordem: o, texto: statements[i].slice(p, p + PEDACO) })
  }
  const r = await fetch(`${U}/rest/v1/_deploy_sql`, { method: 'POST', headers: H, body: JSON.stringify(linhas) })
  if (!r.ok) { console.error(`falha ao enviar ${id}:`, r.status, await r.text()); process.exit(1) }
}
console.log('enviado.')

for (let i = 0; i < statements.length; i++) {
  const r = await fetch(`${U}/rest/v1/rpc/_deploy_run`, { method: 'POST', headers: H, body: JSON.stringify({ p_id: `st${i}` }) })
  const t = await r.text()
  if (!r.ok) {
    console.error(`\nERRO no statement [${i}]:`)
    console.error(t)
    process.exit(1)
  }
  console.log(`  [${i}] ${t}`)
}
console.log('\nTODOS OS STATEMENTS APLICARAM EM HOMOLOGACAO.')
