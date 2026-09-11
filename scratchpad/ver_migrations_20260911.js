// Conferencia ESTRUTURAL das tres migrations de 11/09/2026, antes de aplicar em lugar nenhum.
// Nao substitui o ensaio em homologacao — pega o que o ensaio nao chega a ver porque o arquivo
// nem carrega: dollar-quote impar, REVOKE faltando, EOL divergente.
//
//   node scratchpad/ver_migrations_20260911.js
const fs = require('fs')
const path = require('path')

const MIGS = [
  '20260911100000_escopo_de_gestao_para_rh.sql',
  '20260911110000_autorizacao_ponto_coletivo_por_unidade.sql',
  '20260911120000_pendencias_de_cadastro_por_escopo.sql',
]

let falhas = 0
function exigir(cond, msg) {
  if (!cond) { console.error(`   FALHA: ${msg}`); falhas++ } else { console.log(`   ok   ${msg}`) }
}

for (const nome of MIGS) {
  const p = path.join(__dirname, '..', 'supabase/migrations', nome)
  const d = fs.readFileSync(p, 'utf8')
  console.log(`\n=== ${nome} ===`)

  // EOL: a convencao do projeto e CRLF.
  exigir(d.includes('\r\n') && !/[^\r]\n/.test(d), 'CRLF em todas as linhas')

  // Todo dollar-quote em par.
  for (const tag of ['$fn$', '$fnsub$', '$conf$', '$conf2$']) {
    const n = d.split(tag).length - 1
    if (n > 0) exigir(n % 2 === 0, `delimitador ${tag} em par (${n} ocorrencias)`)
  }

  // Toda funcao criada tem REVOKE FROM PUBLIC na mesma migration (armadilha 24).
  const criadas = [...d.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  const revogadas = new Set([...d.matchAll(/REVOKE ALL ON FUNCTION\s+public\.(\w+)\(/g)].map((m) => m[1]))
  for (const f of new Set(criadas)) {
    exigir(revogadas.has(f), `${f} tem REVOKE ... FROM PUBLIC`)
  }
  const semAnon = [...d.matchAll(/REVOKE ALL ON FUNCTION\s+public\.\w+\([^)]*\)\s*(?:\r?\n\s*)?FROM ([^;]+);/g)]
  for (const m of semAnon) {
    exigir(/PUBLIC/.test(m[1]) && /anon/.test(m[1]), `REVOKE cita PUBLIC e anon (${m[1].trim()})`)
  }

  // A conferencia tem que EXECUTAR alguma coisa, nao so perguntar se a funcao existe
  // (armadilha 42). E, rodando como service_role, tem que SIMULAR SESSAO — senao exercita
  // justamente o caminho em que o guard nao roda.
  if (/DO \$conf/.test(d)) {
    exigir(/request\.jwt\.claims/.test(d), 'conferencia simula sessao (set_config request.jwt.claims)')
    exigir(/RAISE EXCEPTION 'ABORTADO/.test(d), 'conferencia ABORTA quando reprova')
    exigir((d.match(/ABORTADO/g) || []).length >= 2, 'conferencia confere os DOIS sentidos (>= 2 abortos)')
  }
}

// O predicado tem que ser um so: nenhuma migration nova pode reescrever a regra de escopo
// em vez de chamar fn_escopo_gestao_alcanca.
console.log('\n=== fonte unica do escopo ===')
const todas = MIGS.map((n) => fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations', n), 'utf8')).join('\n')
exigir(/CREATE OR REPLACE FUNCTION public\.fn_escopo_gestao_alcanca/.test(todas), 'fn_escopo_gestao_alcanca definida uma vez')
exigir((todas.match(/CREATE OR REPLACE FUNCTION public\.fn_escopo_gestao_alcanca/g) || []).length === 1,
  'fn_escopo_gestao_alcanca NAO e redefinida em outra migration do lote')
exigir(!/profile_unidades pu\s+WHERE pu\.profile_id = auth\.uid\(\)/.test(
  todas.replace(/CREATE OR REPLACE FUNCTION public\.fn_escopo_gestao_alcanca[\s\S]*?\$fn\$;/, '')),
  'nenhuma outra funcao do lote reescreve o escopo por profile_unidades a mao')

// O braco de rh_unidade NAO pode chamar fn_unidade_no_escopo (que honra acesso_todas_unidades e
// faria banco e tela divergirem).
const predicado = (todas.match(/CREATE OR REPLACE FUNCTION public\.fn_escopo_gestao_alcanca[\s\S]*?\$fn\$;/) || [''])[0]
exigir(!/fn_unidade_no_escopo/.test(predicado),
  'o predicado NAO usa fn_unidade_no_escopo (ela honra acesso_todas_unidades)')
exigir(/fn_unidade_alcancavel_por_setor/.test(predicado),
  'o predicado soma as unidades alcancadas por setor vinculado')
exigir(/'rh'::public\.user_role/.test(predicado), 'RH Geral entra por PAPEL, nao por checkbox')

// Mesclar continua fora do RH da Unidade.
console.log('\n=== mesclar continua restrito ===')
const mesc = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations', MIGS[2]), 'utf8')
const corpoMesc = (mesc.match(/CREATE OR REPLACE FUNCTION public\.fn_mesclar_servidores[\s\S]*?\$fn\$;/) || [''])[0]
exigir(corpoMesc.length > 0, 'fn_mesclar_servidores presente na migration')
exigir(!/rh_unidade/.test(corpoMesc), 'fn_mesclar_servidores NAO libera rh_unidade')
exigir(/'rh'::public\.user_role/.test(corpoMesc), 'fn_mesclar_servidores libera RH Geral')
exigir(/sisescala\.mesclar_servidor/.test(corpoMesc), 'GUC da imutabilidade da marcacao preservado')
exigir(/c_campos_pessoa/.test(corpoMesc), 'allowlist de campos de pessoa preservada')
exigir(/pg_index/.test(corpoMesc), 'varredura por pg_index preservada (indice unico PARCIAL)')


// O Diretor (admin) continua fora de conceder dispensa de ponto — decisao de 27/08/2026, que o
// nomeia. O predicado compartilhado o trata como irrestrito, entao quem o segura e' a allowlist
// de papel nas duas RPCs; "simplificar" isso depois devolveria a rede inteira a ele.
console.log('\n=== diretor fora da dispensa de ponto ===')
const aut = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations', MIGS[1]), 'utf8')
for (const fn of ['fn_conceder_autorizacao_ponto_coletivo', 'fn_revogar_autorizacao_ponto_coletivo']) {
  const re = new RegExp('CREATE OR REPLACE FUNCTION public\\.' + fn + '[\\s\\S]*?\\$fn\\$;')
  const corpo = (aut.match(re) || [''])[0]
  exigir(corpo.length > 0, `${fn} presente`)
  exigir(corpo.includes("'rh_unidade'::public.user_role"), `${fn} inclui rh_unidade`)
  exigir(!corpo.includes("'admin'::public.user_role"), `${fn} NAO cita admin (Diretor fica fora)`)
  exigir(corpo.includes('fn_escopo_gestao_alcanca'), `${fn} recorta por unidade do SERVIDOR`)
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
