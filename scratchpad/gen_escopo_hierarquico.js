// Gera a migration que troca o teste PLANO de setor pelo teste HIERARQUICO nas policies vigentes.
//
// Segue a armadilha 1 do CLAUDE.md: NAO redigita corpo de policy. Extrai o texto verbatim da
// migration que define a versao vigente de cada policy, aplica UMA substituicao pontual e
// aborta se a contagem divergir do esperado.
//
// "Vigente" nao e adivinhado pelo nome do arquivo: percorre todas as migrations em ordem e a
// ultima mencao de cada policy (CREATE ou DROP) e que vale.
//
// Uso: node scratchpad/gen_escopo_hierarquico.js

const fs = require('fs')
const path = require('path')

const DIR = 'supabase/migrations'
const SAIDA = path.join(DIR, '20260814120000_hierarchical_sector_scope.sql')
const OCORRENCIAS_ESPERADAS = 18
const POLICIES_ESPERADAS = 17

// As tres variantes de escrita do teste plano que existem no repositorio. Sao alternativas
// EXPLICITAS de proposito: um `\)?` opcional no fim comeria o parentese que fecha o `IN (...)`
// de quem escreveu sem o embrulho `( SELECT auth.uid() AS uid)`, desbalanceando a expressao.
const TESTE_PLANO = new RegExp(
  'SELECT\\s+profile_setores\\.setor_id\\s+FROM\\s+(?:public\\.)?profile_setores\\s+WHERE\\s+' +
    '(?:' +
    '\\(\\s*profile_setores\\.profile_id\\s*=\\s*\\(\\s*SELECT\\s+auth\\.uid\\(\\)\\s+AS\\s+uid\\s*\\)\\s*\\)' +
    '|' +
    'profile_setores\\.profile_id\\s*=\\s*auth\\.uid\\(\\)' +
    ')',
  'gi'
)

const SUBSTITUTO = 'SELECT e.setor_id FROM public.fn_setores_no_escopo() e'

// ---------------------------------------------------------------- 1. estado vigente
const arquivos = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
const estado = new Map() // "tabela::policy" -> { file, body } | null (dropada)

for (const f of arquivos) {
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8')
  for (const m of sql.matchAll(/DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)/gi)) {
    estado.set(`${m[2]}::${m[1]}`, null)
  }
  for (const m of sql.matchAll(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)[\s\S]*?;\s*(?=\n|$)/gi)) {
    estado.set(`${m[2]}::${m[1]}`, { file: f, body: m[0] })
  }
}

const alvos = [...estado.entries()]
  .filter(([, v]) => {
    if (!v) return false
    TESTE_PLANO.lastIndex = 0
    return TESTE_PLANO.test(v.body)
  })
  .map(([k, v]) => ({ tabela: k.split('::')[0], policy: k.split('::')[1], ...v }))

if (alvos.length !== POLICIES_ESPERADAS) {
  abortar(`esperava ${POLICIES_ESPERADAS} policies com teste plano, achei ${alvos.length}`)
}

// ---------------------------------------------------------------- 2. substituicao
let totalTrocas = 0
const blocos = alvos.map(a => {
  let trocas = 0
  // 2o argumento como FUNCAO: com string, o JS interpreta $$ / $' e destroi o dollar-quoting
  // e o resto do arquivo (armadilha 1 do CLAUDE.md).
  const novo = a.body.replace(TESTE_PLANO, () => {
    trocas++
    return SUBSTITUTO
  })
  if (trocas === 0) abortar(`nenhuma troca em "${a.policy}" (${a.tabela})`)
  if (parenteses(novo) !== 0) abortar(`parenteses desbalanceados apos troca em "${a.policy}"`)
  TESTE_PLANO.lastIndex = 0
  if (TESTE_PLANO.test(novo)) abortar(`sobrou teste plano em "${a.policy}"`)
  totalTrocas += trocas
  return { ...a, novo, trocas }
})

if (totalTrocas !== OCORRENCIAS_ESPERADAS) {
  abortar(`esperava ${OCORRENCIAS_ESPERADAS} ocorrencias trocadas, fiz ${totalTrocas}`)
}

// ---------------------------------------------------------------- 3. montagem
const L = []
const p = s => L.push(s)

p('-- Escopo de setor passa a alcancar os SUBSETORES (descendentes em parent_id).')
p('--')
p('-- Ate aqui o vinculo de um perfil a um setor era testado de forma PLANA:')
p('--   setor_id IN (SELECT setor_id FROM profile_setores WHERE profile_id = auth.uid())')
p('-- Quem estava vinculado a DMAC nao enxergava DMAC/REGULACAO nem DMAC/TFD; quem estava em')
p('-- ADMINISTRACAO/APOIO nao enxergava ADMINISTRACAO/APOIO/SERVICOS GERAIS. A hierarquia de')
p('-- setores so era usada para DESENHAR a lista, nunca para permissao -- nao havia um unico')
p('-- WITH RECURSIVE sobre setores no projeto.')
p('--')
p('-- Medido em producao em 14/08/2026, antes desta migration:')
p('--   12 perfis escopados por setor vinculados a um setor com filhos;')
p('--   7 deles (DMAC) sem enxergar 34 servidores Ativos cada;')
p('--   3 servidores lotados em setor de nivel 3 invisiveis para o coordenador do setor-pai.')
p('-- Duas coordenadoras do CAF ja contornavam o problema na mao, vinculadas aos 4 polos um a um.')
p('--')
p('-- Esta migration NAO amplia escopo para quem nao tinha nenhum: so faz o vinculo existente')
p('-- alcancar o que a arvore da tela de Setores sempre sugeriu que ele alcancava.')
p('')
p('-- ============================================================================')
p('-- 1. Fonte unica da expansao hierarquica')
p('-- ============================================================================')
p('')
p('-- SECURITY DEFINER e obrigatorio: o passo recursivo precisa enxergar setores que o proprio')
p('-- usuario ainda nao alcanca -- e justamente o que estamos calculando. Sem isso a policy de')
p('-- `setores` limitaria a recursao a si mesma.')
p('-- UNION (nao UNION ALL) encerra a recursao se algum parent_id formar ciclo.')
p('CREATE OR REPLACE FUNCTION public.fn_setores_no_escopo(p_profile_id uuid DEFAULT auth.uid())')
p('RETURNS TABLE (setor_id uuid)')
p('LANGUAGE sql')
p('STABLE')
p('SECURITY DEFINER')
p('SET search_path = public')
p('AS $fn$')
p('  WITH RECURSIVE base AS (')
p('    SELECT ps.setor_id AS id')
p('    FROM public.profile_setores ps')
p('    WHERE ps.profile_id = p_profile_id')
p('    UNION')
p('    SELECT s.id')
p('    FROM public.setores s')
p('    JOIN base b ON s.parent_id = b.id')
p('  )')
p('  SELECT id FROM base;')
p('$fn$;')
p('')
p('GRANT EXECUTE ON FUNCTION public.fn_setores_no_escopo(uuid) TO authenticated;')
p('')
p('COMMENT ON FUNCTION public.fn_setores_no_escopo(uuid) IS')
p("  'Setores do perfil MAIS todos os descendentes por parent_id. Fonte unica do escopo de setor nas policies. Ver tambem setores_no_escopo(profiles), a versao coluna computada usada pelo frontend.';")
p('')
p('-- Coluna computada do PostgREST: `select=setores_no_escopo` sobre `profiles` devolve o mesmo')
p('-- conjunto ja expandido, para o filtro do lado do cliente (applyAccessFilters) nao divergir')
p('-- da RLS. O frontend montava `permitted_setores` lendo o embed cru de profile_setores.')
p('CREATE OR REPLACE FUNCTION public.setores_no_escopo(public.profiles)')
p('RETURNS uuid[]')
p('LANGUAGE sql')
p('STABLE')
p('SECURITY DEFINER')
p('SET search_path = public')
p('AS $fn$')
p("  SELECT COALESCE(array_agg(e.setor_id), '{}'::uuid[])")
p('  FROM public.fn_setores_no_escopo($1.id) e;')
p('$fn$;')
p('')
p('GRANT EXECUTE ON FUNCTION public.setores_no_escopo(public.profiles) TO authenticated;')
p('')
p('-- ============================================================================')
p(`-- 2. Policies -- ${blocos.length} policies em ${new Set(blocos.map(b => b.tabela)).size} tabelas`)
p('--')
p('-- Corpos copiados VERBATIM da migration que define a versao vigente de cada uma; a unica')
p('-- alteracao e a troca do subselect de profile_setores por fn_setores_no_escopo().')
p('-- ============================================================================')

const porTabela = {}
blocos.forEach(b => (porTabela[b.tabela] ||= []).push(b))

Object.keys(porTabela).sort().forEach(tabela => {
  p('')
  p(`-- ---------- ${tabela} ----------`)
  porTabela[tabela].forEach(b => {
    p('')
    p(`-- origem: ${b.file}  (${b.trocas}x)`)
    p(`DROP POLICY IF EXISTS "${b.policy}" ON public.${b.tabela};`)
    p(b.novo.trimEnd())
  })
})

p('')
p('-- ============================================================================')
p('-- 3. Conferencia')
p('-- ============================================================================')
p('--')
p('-- (a) Nenhuma policy pode ter sobrado com o teste plano:')
p('--')
p('--   SELECT tablename, policyname')
p('--   FROM pg_policies')
p('--   WHERE schemaname = \'public\'')
p('--     AND (COALESCE(qual, \'\') || COALESCE(with_check, \'\')) LIKE \'%profile_setores%\'')
p('--     AND (COALESCE(qual, \'\') || COALESCE(with_check, \'\')) NOT LIKE \'%fn_setores_no_escopo%\';')
p('--   -- esperado: 0 linhas')
p('--')
p('-- (b) Expansao de um perfil concreto (o coordenador de ADMINISTRACAO/APOIO):')
p('--')
p('--   SELECT ds.nome')
p('--   FROM public.fn_setores_no_escopo(\'<profile_id>\') e')
p('--   JOIN public.setores s ON s.id = e.setor_id')
p('--   JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id;')
p('--   -- esperado: APOIO + SERVICOS GERAIS + PORTARIA + MANUTECAO + ENGENHARIA')
p('')

const sql = L.join('\r\n') // convencao do projeto: migrations em CRLF

// ---------------------------------------------------------------- 4. conferencia estrutural
const nCreate = (sql.match(/CREATE POLICY/g) || []).length
const nDrop = (sql.match(/DROP POLICY/g) || []).length
if (nCreate !== POLICIES_ESPERADAS) abortar(`CREATE POLICY: esperava ${POLICIES_ESPERADAS}, saiu ${nCreate}`)
if (nDrop !== POLICIES_ESPERADAS) abortar(`DROP POLICY: esperava ${POLICIES_ESPERADAS}, saiu ${nDrop}`)
if ((sql.match(/\$fn\$/g) || []).length !== 4) abortar('delimitadores $fn$ fora de par')
if ((sql.match(/fn_setores_no_escopo\(\) e/g) || []).length !== OCORRENCIAS_ESPERADAS) {
  abortar('numero de chamadas substituidas nao bate no arquivo final')
}
if (/[À-ſ]/.test(sql.replace(/-- .*/g, ''))) abortar('acento fora de comentario')

fs.writeFileSync(SAIDA, sql, 'latin1')
console.log(`OK  ${SAIDA}`)
console.log(`    ${POLICIES_ESPERADAS} policies, ${totalTrocas} ocorrencias trocadas`)
Object.keys(porTabela).sort().forEach(t => console.log(`      ${t}: ${porTabela[t].length}`))

function parenteses(s) {
  let n = 0
  for (const c of s) {
    if (c === '(') n++
    else if (c === ')') n--
  }
  return n
}

function abortar(msg) {
  console.error(`ABORTADO: ${msg}`)
  process.exit(1)
}
