// Gera a PARTE de `fn_mesclar_servidores` da migration 20260911120000, copiando MECANICAMENTE o
// corpo VIGENTE e trocando so' o guard de papel.
//
// ⚠️ A fonte NAO e' 20260904130000, que e' onde a funcao nasceu: a versao vigente e'
// 20260906100000 (fusao de escala do mesmo setor). A primeira versao deste script apontava para
// a errada e ABORTOU no invariante da fusao de escala — que e' exatamente para isso que ele
// existe (CLAUDE.md: "descubra qual migration define a versao vigente").
//
// Por que gerador: a funcao tem ~180 linhas, com varredura dinamica de pg_index, tres
// blocos de GUC e a lista de campos de pessoa. Redigitar e' exatamente como as seis regressoes
// da armadilha 1 aconteceram. O script ABORTA se a contagem de ocorrencias divergir.
//
//   node scratchpad/gen_escopo_pendencias.js
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260906100000_mesclagem_funde_escala_do_mesmo_setor.sql')
const SAIDA = path.join(__dirname, '_fn_mesclar_servidores_gerada.sql')

const fonte = fs.readFileSync(FONTE, 'utf8')
// ⚠️ EOL DETECTADO, nunca assumido. A convencao do projeto e' CRLF, mas ja houve migration em LF
// (20260909160000) — padrao montado com o EOL errado vira no-op SILENCIOSO (armadilhas 48 e 59).
const EOL = fonte.includes('\r\n') ? '\r\n' : '\n'
console.log(`fonte: ${path.basename(FONTE)} (${EOL === '\r\n' ? 'CRLF' : 'LF'})`)

// --- recorta a funcao inteira, do CREATE ate o fechamento do dollar-quote --------------------
const inicio = fonte.indexOf('CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(')
if (inicio < 0) abortar('nao achei o CREATE de fn_mesclar_servidores na fonte')

// O corpo usa $fn$ como delimitador; pega do CREATE ate o SEGUNDO $fn$ seguido de ';'
const depois = fonte.slice(inicio)
const fimRel = depois.indexOf('$fn$;')
if (fimRel < 0) abortar('nao achei o fechamento $fn$; de fn_mesclar_servidores')
let corpo = depois.slice(0, fimRel + '$fn$;'.length)

// --- invariantes ANTES de mexer ---------------------------------------------------------------
// Cada um destes ja quebrou de verdade em alguma migration deste projeto. Se um deles nao estiver
// na fonte, a fonte nao e' a que eu penso que e' — e a copia sairia mutilada em silencio.
const INVARIANTES_ANTES = [
  ['guard de papel super_admin', /IF \(SELECT public\.get_my_role\(\)\) <> 'super_admin'::public\.user_role THEN/g, 1],
  ['GUC de mesclagem (destrava a imutabilidade da marcacao)', /sisescala\.mesclar_servidor/g, null],
  ['campos de pessoa (allowlist explicita)', /c_campos_pessoa/g, null],
  ['varredura por pg_INDEX, nao pg_constraint', /pg_index/g, null],
  ['impedimentos consultados antes de escrever', /fn_impedimentos_mesclagem_servidor/g, null],
  ['fusao de escala roda ANTES do laco generico', /fn_fundir_escala|escala_mensal/g, null],
  ['inativa em vez de excluir', /mesclado_em_servidor_id/g, null],
]
for (const [nome, re, esperado] of INVARIANTES_ANTES) {
  const n = (corpo.match(re) || []).length
  if (n === 0) abortar(`invariante ausente na fonte: ${nome}`)
  if (esperado !== null && n !== esperado) {
    abortar(`invariante "${nome}": esperava ${esperado} ocorrencia(s), achei ${n}`)
  }
  console.log(`  ok  ${nome} (${n})`)
}

// --- a UNICA substituicao ---------------------------------------------------------------------
const ALVO =
  `    IF (SELECT public.get_my_role()) <> 'super_admin'::public.user_role THEN${EOL}` +
  `        RAISE EXCEPTION 'Apenas o Administrador Geral pode mesclar cadastros de servidor.'${EOL}` +
  `            USING ERRCODE = 'insufficient_privilege';${EOL}` +
  `    END IF;`

const NOVO =
  `    -- Quem mescla: Administrador Geral e RH Geral. RH da Unidade VE a lista e o diagnostico${EOL}` +
  `    -- (fn_cadastros_duplicados), mas NAO mescla — decisao do usuario em 10/09/2026, medida:${EOL}` +
  `    -- dos 62 grupos mesclaveis, 27 atravessam unidade e 31 ja tem ponto, escala ou folha. A${EOL}` +
  `    -- mesclagem MOVE esses registros e inativa o cadastro que sai; num grupo cruzado isso e'${EOL}` +
  `    -- mover ponto de uma unidade que nao e' a dele. Ele identifica e escala; o RH Geral executa.${EOL}` +
  `    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role,${EOL}` +
  `                                             'rh'::public.user_role) THEN${EOL}` +
  `        RAISE EXCEPTION 'Apenas o RH Geral ou o Administrador Geral podem mesclar cadastros de servidor.'${EOL}` +
  `            USING ERRCODE = 'insufficient_privilege';${EOL}` +
  `    END IF;`

const ocorrencias = corpo.split(ALVO).length - 1
if (ocorrencias !== 1) {
  abortar(`esperava 1 ocorrencia do guard de papel para substituir, achei ${ocorrencias} `
    + `(indentacao ou EOL divergente? o padrao foi montado com ${EOL === '\r\n' ? 'CRLF' : 'LF'})`)
}
// Funcao como 2o argumento, nunca string: `$$`/`$'` no texto seriam interpretados pelo JS e
// quebrariam o dollar-quoting do plpgsql (armadilha 1, caso do gen_dobra.js).
corpo = corpo.replace(ALVO, () => NOVO)

// --- invariantes DEPOIS -----------------------------------------------------------------------
const INVARIANTES_DEPOIS = [
  ['guard antigo removido', /<> 'super_admin'::public\.user_role/g, 0],
  ['guard novo presente', /NOT IN \('super_admin'::public\.user_role,\s*'rh'::public\.user_role\)/g, 1],
  ['GUC de mesclagem preservado', /sisescala\.mesclar_servidor/g, null],
  ['campos de pessoa preservados', /c_campos_pessoa/g, null],
  ['impedimentos preservados', /fn_impedimentos_mesclagem_servidor/g, null],
]
for (const [nome, re, esperado] of INVARIANTES_DEPOIS) {
  const n = (corpo.match(re) || []).length
  if (esperado !== null && n !== esperado) abortar(`pos-substituicao "${nome}": esperava ${esperado}, achei ${n}`)
  if (esperado === null && n === 0) abortar(`pos-substituicao: invariante "${nome}" sumiu na copia`)
  console.log(`  ok  ${nome} (${n})`)
}

// dollar-quote em par
const dq = (corpo.match(/\$fn\$/g) || []).length
if (dq !== 2) abortar(`delimitador $fn$ fora de par: ${dq} ocorrencia(s)`)

const grants =
  `${EOL}${EOL}REVOKE ALL ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) FROM PUBLIC, anon;${EOL}` +
  `GRANT EXECUTE ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) TO authenticated, service_role;${EOL}`

fs.writeFileSync(SAIDA, corpo + grants)
console.log(`\ngerado: ${path.relative(RAIZ, SAIDA)} (${corpo.length + grants.length} bytes)`)
console.log('cole este trecho na migration 20260911120000.')

function abortar(msg) {
  console.error(`\nABORTADO: ${msg}`)
  process.exit(1)
}
