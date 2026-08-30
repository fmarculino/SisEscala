// Item 9 da auditoria: tirar a chave `service_role` de PRODUCAO, em texto plano, dos scripts de
// scratch/. Eles passam a ler de `.env.production` (ou do ambiente) e a RECUSAR rodar sem ela.
//
// ⚠️ CONTEXTO IMPORTANTE, medido em 30/08/2026: `/scratch/` esta no .gitignore e
// `git log --all -S<chave>` nao retorna nada — essas chaves NUNCA foram commitadas. Existe
// exatamente 1 JWT em todo o historico dos 558 commits, e e o de HOMOLOGACAO. Ou seja: isto e'
// higiene da maquina de desenvolvimento, nao vazamento publico. E' o motivo pelo qual nao ha
// urgencia de rotacao aqui (decisao do usuario em 30/08/2026: nao rotacionar por ora).
//
// O que muda: a chave sai do disco em texto plano, e o padrao passa a ser o da armadilha 18 —
// ler do ambiente, falhar explicitamente sem ela, NUNCA um literal.
//
// Roda: node scratchpad/gen_scratch_sem_chave.js [--aplicar]
const fs = require('fs')
const path = require('path')

const APLICAR = process.argv.includes('--aplicar')
const DIR = 'scratch'

if (!fs.existsSync(DIR)) { console.log('scratch/ nao existe — nada a fazer'); process.exit(0) }

const LEITOR = [
  "// Chave lida do ambiente. NUNCA um literal: ver armadilha 18 do CLAUDE.md (o repositorio e",
  "// publico, e commit e o que publica). Recusa rodar sem a variavel.",
  "const __env = Object.fromEntries(",
  "  require('fs').readFileSync(require('path').join(__dirname, '..', '.env.production'), 'utf8')",
  "    .split(/\\r?\\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))",
  "    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^[\"']|[\"']$/g, '')] })",
  ")",
  "const __key = process.env.SUPABASE_SERVICE_ROLE_KEY || __env.SUPABASE_SERVICE_ROLE_KEY",
  "if (!__key) { console.error('SUPABASE_SERVICE_ROLE_KEY ausente (.env.production ou ambiente).'); process.exit(1) }",
  "",
].join('\n')

const RE_CHAVE = /(const\s+(?:supabaseKey|serviceKey|key)\s*=\s*)['"]eyJ[A-Za-z0-9_.\-]+['"]/g

let tocados = 0, ocorrencias = 0
for (const nome of fs.readdirSync(DIR)) {
  const p = path.join(DIR, nome)
  if (!/\.(js|mjs|ts)$/.test(nome) || !fs.statSync(p).isFile()) continue
  let s = fs.readFileSync(p, 'utf8')
  const achadas = (s.match(RE_CHAVE) || []).length
  if (!achadas) continue

  ocorrencias += achadas
  tocados++
  console.log(`  ${String(achadas).padStart(2)} chave(s) literal(is)  ${p}`)

  if (!APLICAR) continue

  s = s.replace(RE_CHAVE, (_m, decl) => `${decl}__key`)
  if (!s.includes('__key =')) s = LEITOR + s
  fs.writeFileSync(p, s, 'utf8')
}

console.log('')
console.log(APLICAR
  ? `APLICADO: ${ocorrencias} chave(s) literal(is) removida(s) de ${tocados} arquivo(s).`
  : `ENSAIO: ${ocorrencias} chave(s) literal(is) em ${tocados} arquivo(s). Use --aplicar.`)

if (APLICAR) {
  // conferencia: nao pode sobrar JWT literal em scratch/
  let sobrou = 0
  for (const nome of fs.readdirSync(DIR)) {
    const p = path.join(DIR, nome)
    if (!fs.statSync(p).isFile()) continue
    if (/eyJ[A-Za-z0-9_-]{20,}\./.test(fs.readFileSync(p, 'utf8'))) { console.error(`  ⚠️ ainda tem JWT: ${p}`); sobrou++ }
  }
  if (sobrou) { console.error(`ABORTADO na conferencia: ${sobrou} arquivo(s) ainda com JWT literal.`); process.exit(1) }
  console.log('Conferido: nenhum JWT literal restante em scratch/.')
}
