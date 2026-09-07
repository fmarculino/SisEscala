#!/usr/bin/env node
/**
 * Gera supabase/migrations/20260906130000_snapshot_leitura_confiavel.sql
 *
 * O QUE RESOLVE (caso real do CCE, 06/09/2026): o relogio foi trocado por um equipamento em
 * branco. O coletor leu "zero cadastros" e publicou lista vazia. A guarda 1 de
 * fn_registrar_snapshot_usuarios_dispositivo (`IF v_total > 0`) impediu a reconciliacao - mas o
 * DELETE do snapshot roda ANTES dela, entao o snapshot esvaziou e NENHUM vinculo foi encerrado.
 * A partir dai os dois lados mentiram juntos: a Cobertura afirmava que os 35 estavam no relogio,
 * e "Sincronizar cadastros" devolvia 0 enfileirados - para sempre.
 *
 * A GUARDA NAO SAI. Ela protege contra POST torto (a rota cai para [] quando o corpo vem
 * malformado), e encerrar os vinculos de uma unidade inteira por causa disso e MUITO pior que o
 * bug do CCE. O que muda e' o TRANSPORTE: o coletor passa a dizer se a leitura foi boa, e essa
 * e' exatamente a informacao que hoje e' jogada fora entre ler o equipamento e publicar.
 *
 * ⚠️ Fonte descoberta com
 *   grep -rln "FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo" supabase/migrations \
 *     | sort | tail -1
 *
 * Rodar:  node scratchpad/gen_snapshot_leitura_ok.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')
const FONTE = '20260822210000_ponto_valido_desde_por_dispositivo.sql'
const SAIDA = path.join(MIG, '20260906130000_snapshot_leitura_confiavel.sql')

const falhas = []
function exigir(cond, msg) { if (!cond) falhas.push(msg) }

function trocar(texto, de, para, esperado, rotulo) {
  const partes = texto.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    falhas.push(`${rotulo}: esperava ${esperado} ocorrencia(s), achou ${achou}`)
    return texto
  }
  return partes.join(para)
}

const src = fs.readFileSync(path.join(MIG, FONTE), 'utf8').replace(/\r\n/g, '\n')
const ini = 'CREATE OR REPLACE FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo('
const i = src.indexOf(ini)
if (i < 0) { console.error('ABORTADO: funcao nao encontrada em ' + FONTE); process.exit(1) }
const j = src.indexOf('\n$fn$;', i)
if (j < 0) { console.error('ABORTADO: fim da funcao nao encontrado'); process.exit(1) }
let fn = src.slice(i, j + '\n$fn$;'.length)

// --- Invariantes de entrada: o que NAO pode ter se perdido da versao vigente ---------------
exigir(/DISTINCT ON \(identificador_afd\)/.test(fn),
  'dedup por identificador_afd ausente na fonte')
exigir(/LEFT JOIN LATERAL public\.fn_servidor_por_identificador_afd\(/.test(fn),
  'resolucao de identidade por LATERAL ausente na fonte')
exigir(/NULL::timestamptz\) r ON true/.test(fn),
  'NULL no instante (cadastro nao e batida) ausente na fonte')
exigir(/v\.created_at < now\(\) - interval '15 minutes'/.test(fn),
  'GUARDA 2 (vinculo com menos de 15 min e poupado) ausente na fonte - ela NAO pode sair')
exigir(/right\(regexp_replace\(u\.identificador_afd, '\\D', '', 'g'\), 11\)/.test(fn),
  'comparacao por right(...,11) (armadilha 10) ausente na fonte')
exigir(/IF v_total > 0 THEN/.test(fn),
  'GUARDA 1 (lista vazia nunca reconcilia) ausente na fonte')

// --- 1. Assinatura: ganha p_leitura_ok com DEFAULT ------------------------------------------
fn = trocar(
  fn,
  '    p_dispositivo_id uuid,\n    p_usuarios       jsonb\n)',
  '    p_dispositivo_id uuid,\n    p_usuarios       jsonb,\n'
  + '    -- DEFAULT false e o que segura a janela migration -> deploy: enquanto a rota antiga\n'
  + '    -- mandar 2 argumentos, ela resolve para esta funcao e o comportamento e o de hoje.\n'
  + '    -- Coletor antigo nunca manda o campo, entao o parque inteiro segue igual ate subir.\n'
  + '    p_leitura_ok     boolean DEFAULT false\n)',
  1,
  'assinatura com p_leitura_ok'
)

// --- 2. A guarda passa a aceitar leitura vazia CONFIAVEL -------------------------------------
fn = trocar(
  fn,
  '    IF v_total > 0 THEN\n        WITH encerrados AS (',
  '    --   3. (06/09/2026) Lista vazia RECONCILIA quando o coletor afirma que a leitura foi boa.\n'
  + '    --      Sem isto, relogio substituido por um equipamento em branco - ou zerado pela\n'
  + '    --      interface - deixa 100% dos vinculos vigentes apontando para cadastro que nao\n'
  + '    --      existe mais, e nada no sistema reclama. O CCE ficou assim ate alguem medir.\n'
  + '    --      A diferenca entre os dois casos NUNCA esteve no payload: `[]` de POST torto e\n'
  + '    --      `[]` de relogio vazio sao identicos. Quem sabe e o coletor, e agora ele diz.\n'
  + '    IF v_total > 0 OR p_leitura_ok THEN\n        WITH encerrados AS (',
  1,
  'guarda com p_leitura_ok'
)

// --- 3. Deixa rastro de que a leitura aconteceu ----------------------------------------------
// Sem isto, leitura boa que devolve zero nao deixa marca NENHUMA: rep_usuarios_dispositivo fica
// vazia, e a tela nao consegue separar "nunca ninguem leu" de "leu e o relogio esta vazio".
fn = trocar(
  fn,
  "    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match,\n"
  + "                              'vinculos_encerrados', v_encerrados);",
  '    IF p_leitura_ok OR v_total > 0 THEN\n'
  + '        UPDATE public.dispositivos_rep\n'
  + '           SET usuarios_lidos_em    = now(),\n'
  + '               usuarios_lidos_total = v_total\n'
  + '         WHERE id = p_dispositivo_id;\n'
  + '    END IF;\n'
  + '\n'
  + "    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match,\n"
  + "                              'vinculos_encerrados', v_encerrados,\n"
  + "                              'leitura_ok', p_leitura_ok);",
  1,
  'carimbo de leitura em dispositivos_rep'
)

const CABECALHO = `-- ============================================================================
-- Snapshot de cadastro: separar "li e havia zero" de "nao consegui ler" (06/09/2026)
-- ============================================================================
-- Plano: docs/planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md (Prioridade 1a)
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_snapshot_leitura_ok.js
-- O gerador copia fn_registrar_snapshot_usuarios_dispositivo de ${FONTE}
-- e aborta se qualquer uma das guardas dela tiver desaparecido da fonte.
--
-- ⚠️ ARMADILHA 41: a assinatura muda de (uuid, jsonb) para (uuid, jsonb, boolean), e assinatura
-- nova e' um objeto NOVO - nasce com EXECUTE para PUBLIC. Por isso o REVOKE/GRANT e reescrito
-- aqui, e a de 2 argumentos leva DROP: duas sobrecargas fariam o PostgREST devolver PGRST203.
-- O DROP vem ANTES do CREATE de proposito; enquanto a rota antiga estiver no ar ela chama por
-- NOME de parametro (p_dispositivo_id, p_usuarios) e resolve na nova, pelo DEFAULT.
-- ============================================================================

-- ============================================================================
-- 1. Rastro da leitura, em dispositivos_rep
-- ============================================================================
-- Leitura boa que devolve ZERO cadastros nao deixa marca nenhuma hoje: rep_usuarios_dispositivo
-- fica vazia, e "nunca ninguem leu" fica indistinguivel de "leu e o relogio esta vazio". Era
-- exatamente por isso que a tela do CCE continuava afirmando que os 35 servidores estavam la.

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS usuarios_lidos_em    timestamptz,
    ADD COLUMN IF NOT EXISTS usuarios_lidos_total integer;

COMMENT ON COLUMN public.dispositivos_rep.usuarios_lidos_em IS
    'Quando o coletor leu o cadastro do equipamento com sucesso pela ultima vez. NULL = nunca '
    'foi lido. Com usuarios_lidos_total = 0, significa "lido e vazio" - relogio zerado ou '
    'substituido, nao falta de leitura.';

COMMENT ON COLUMN public.dispositivos_rep.usuarios_lidos_total IS
    'Quantos cadastros a ultima leitura bem-sucedida encontrou no equipamento.';

-- ============================================================================
-- 2. fn_registrar_snapshot_usuarios_dispositivo
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb);

`

const RODAPE = `

REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean)
    TO service_role;

COMMENT ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean) IS
    'Substitui por inteiro o snapshot de quem esta cadastrado no equipamento e encerra vinculo '
    'de quem sumiu dele. Lista vazia so reconcilia quando p_leitura_ok afirma que a leitura foi '
    'bem-sucedida - payload vazio por corpo malformado continua sendo ignorado.';

-- ============================================================================
-- 3. CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 3.1 Existe UMA assinatura so (senao PostgREST devolve PGRST203):
--
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_snapshot_usuarios_dispositivo';
--   -- esperado: exatamente 1 linha, com (uuid, jsonb, boolean)
--
-- 3.2 anon NAO executa (armadilha 24 - GRANT a authenticated nunca restringiu nada):
--
--   SELECT has_function_privilege('anon',
--            'public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean)', 'EXECUTE');
--   -- esperado: false
--
-- 3.3 O comportamento de hoje NAO mudou para quem nao subiu o coletor. Chamar com 2 argumentos
--     (como a rota antiga faz) tem que continuar NAO reconciliando com lista vazia:
--
--   SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--            '<uuid de um dispositivo de homologacao>', '[]'::jsonb);
--   -- esperado: vinculos_encerrados = 0, leitura_ok = false
--
-- 3.4 E com a leitura afirmada, reconcilia:
--
--   SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--            '<uuid de um dispositivo de homologacao>', '[]'::jsonb, true);
--   -- esperado: vinculos_encerrados = <quantos vinculos vigentes aquele device tinha>
--   -- ⚠️ SO EM HOMOLOGACAO. Em producao isto encerra vinculo de verdade.
`

if (falhas.length) {
  console.error('\nABORTADO - o gerador nao escreveu nada:\n')
  falhas.forEach((f) => console.error('  x ' + f))
  process.exit(1)
}

const sql = CABECALHO + fn + RODAPE
const checks = [
  ['delimitadores $fn$ em pares', (sql.match(/\$fn\$/g) || []).length, 2],
  ['CREATE OR REPLACE FUNCTION', (sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1],
  ['DROP da assinatura antiga', (sql.match(/DROP FUNCTION IF EXISTS public\.fn_registrar_snapshot_usuarios_dispositivo\(uuid, jsonb\);/g) || []).length, 1],
  ['guarda antiga remanescente', (sql.match(/IF v_total > 0 THEN\n        WITH encerrados/g) || []).length, 0],
  ['guarda das 15 preservada', (sql.match(/interval '15 minutes'/g) || []).length, 1],
]
const ruins = checks.filter(([, a, e]) => a !== e)
if (ruins.length) {
  console.error('\nABORTADO - conferencia estrutural falhou:\n')
  ruins.forEach(([o, a, e]) => console.error(`  x ${o}: esperava ${e}, achou ${a}`))
  process.exit(1)
}

fs.writeFileSync(SAIDA, sql.replace(/\n/g, '\r\n'), 'utf8')
console.log('OK  ' + path.relative(RAIZ, SAIDA))
console.log('    ' + sql.split('\n').length + ' linhas')
