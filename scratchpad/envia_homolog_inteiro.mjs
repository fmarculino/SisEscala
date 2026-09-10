// Envia um arquivo .sql INTEIRO para HOMOLOGACAO pela ponte _deploy_run, que o executa numa
// unica transacao. Serve so' para validar a migration antes de o usuario aplica-la.
//
// Diferenca para envia_homolog.mjs: nao quebra em statements. plpgsql EXECUTE aceita varios
// comandos numa string so, e rodar tudo junto tem uma vantagem para validacao — se a
// conferencia do fim reprovar, TUDO volta atras.
//
// Uso: node scratchpad/envia_homolog_inteiro.mjs <arquivo.sql>
import fs from 'fs'
import { env } from './_env.mjs'

const E = env('.env.local')
const U = E.NEXT_PUBLIC_SUPABASE_URL
const K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

const arquivo = process.argv[2]
if (!arquivo) { console.error('uso: node scratchpad/envia_homolog_inteiro.mjs <arquivo.sql>'); process.exit(1) }
if (!U.includes('mtgfmxsbsyknotvwzdcr')) {
  console.error(`ABORTADO: .env.local nao aponta para homologacao (${U}). Este script nunca toca em producao.`)
  process.exit(1)
}

const sql = fs.readFileSync(arquivo, 'utf8')
const id = 'mig'
const PEDACO = 60000

await fetch(`${U}/rest/v1/_deploy_sql?id=eq.${id}`, { method: 'DELETE', headers: H })
const linhas = []
for (let p = 0, o = 0; p < sql.length; p += PEDACO, o++) linhas.push({ id, ordem: o, texto: sql.slice(p, p + PEDACO) })
const r = await fetch(`${U}/rest/v1/_deploy_sql`, { method: 'POST', headers: H, body: JSON.stringify(linhas) })
if (!r.ok) { console.error('falha ao enviar:', r.status, await r.text()); process.exit(1) }
console.log(`${arquivo}: ${sql.length} bytes enviados em ${linhas.length} pedaco(s)`)

const x = await fetch(`${U}/rest/v1/rpc/_deploy_run`, { method: 'POST', headers: H, body: JSON.stringify({ p_id: id }) })
const t = await x.text()
if (!x.ok) { console.error('\nERRO:\n' + t); process.exit(1) }
console.log('APLICADO EM HOMOLOGACAO: ' + t)
