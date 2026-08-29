/**
 * Gera 20260829130000 a partir da migration vigente de fn_carga_mensal_consolidada.
 *
 * Copia MECANICA (mesmo padrao de gen_ancora.js / gen_intervalo_plantao.js): o corpo nao e
 * redigitado, so' recebe as duas colunas a mais na CTE `carga` e as duas chaves a mais no
 * jsonb_build_object das escalas. Aborta se a contagem de ocorrencias divergir do esperado.
 */
const fs = require('fs')

const VIGENTE = 'supabase/migrations/20260828130000_consolidated_monthly_load_report.sql'
const SAIDA = 'supabase/migrations/20260829130000_carga_consolidada_link_escala.sql'

let src = fs.readFileSync(VIGENTE, 'utf8').replace(/\r\n/g, '\n')

// 1. recorta do CREATE FUNCTION ate o GRANT final (o cabecalho antigo nao vem junto)
const inicio = src.indexOf('DROP FUNCTION IF EXISTS public.fn_carga_mensal_consolidada')
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.fn_carga_mensal_consolidada(integer, integer) TO authenticated, service_role;'
const fim = src.indexOf(fimMarca)
if (inicio < 0 || fim < 0) throw new Error('nao achei os limites da funcao no arquivo vigente')
let corpo = src.slice(inicio, fim + fimMarca.length)

// 2. CREATE FUNCTION -> CREATE OR REPLACE: a lista de colunas do RETURNS TABLE nao muda (as
//    chaves novas entram DENTRO do jsonb `escalas`), entao nao ha 42P13 e o DROP e desnecessario.
//    Manter o DROP derrubaria a funcao para quem a estiver chamando no meio da aplicacao.
const antesDrop = corpo
corpo = corpo.replace('DROP FUNCTION IF EXISTS public.fn_carga_mensal_consolidada(integer, integer);\n\n', '')
corpo = corpo.replace('CREATE FUNCTION public.fn_carga_mensal_consolidada(', 'CREATE OR REPLACE FUNCTION public.fn_carga_mensal_consolidada(')
if (corpo === antesDrop) throw new Error('nao consegui trocar CREATE por CREATE OR REPLACE')

// 3a. A CTE `carga` precisa CARREGAR as duas colunas. Ela projeta uma lista explicita do retorno
//     de fn_carga_mensal_servidor, entao acrescentar a chave no jsonb sem acrescentar aqui da
//     42703 "column c.unidade_id does not exist" -- foi o que aconteceu na 1a tentativa
//     (29/08/2026), e so' apareceu ao aplicar: plpgsql/SQL nao resolve nome de coluna no CREATE.
const deCarga = [
  '        SELECT c.servidor_id,',
  '               c.escala_mensal_id,',
  '               c.unidade_nome,',
].join('\n')
const paraCarga = [
  '        SELECT c.servidor_id,',
  '               c.escala_mensal_id,',
  '               c.unidade_id,',
  '               c.setor_id,',
  '               c.unidade_nome,',
].join('\n')
const ocorrenciasCarga = corpo.split(deCarga).length - 1
if (ocorrenciasCarga !== 1) throw new Error('esperava 1 CTE carga, achei ' + ocorrenciasCarga)
corpo = corpo.replace(deCarga, paraCarga)

// 3b. os ids no jsonb, que e' o que a tela consome
const deJson = [
  "                       'escala_mensal_id', c.escala_mensal_id,",
  "                       'unidade_nome', c.unidade_nome,",
].join('\n')
const paraJson = [
  "                       'escala_mensal_id', c.escala_mensal_id,",
  "                       'unidade_id', c.unidade_id,",
  "                       'setor_id', c.setor_id,",
  "                       'unidade_nome', c.unidade_nome,",
].join('\n')
const ocorrenciasJson = corpo.split(deJson).length - 1
if (ocorrenciasJson !== 1) throw new Error('esperava 1 jsonb_build_object das escalas, achei ' + ocorrenciasJson)
corpo = corpo.replace(deJson, paraJson)

const cabecalho = `-- ============================================================================
-- CARGA CONSOLIDADA: os ids que faltavam para a tela levar ate a escala
-- ============================================================================
-- 29/08/2026
--
-- POR QUE
--   O relatorio /relatorios/carga-consolidada ja diz ONDE estao as horas ("289h - HMI / SHL \\
--   ACOLHIMENTO"), mas so' em texto: para chegar na grade daquela pessoa era preciso decorar a
--   unidade e o setor, voltar em Escalas e procurar. A pessoa que aparece nessa lista esta acima
--   do teto -- ou seja, alguem PRECISA abrir a escala dela para reduzir.
--
--   fn_carga_mensal_servidor ja devolve unidade_id e setor_id; era a CTE 'carga' desta funcao que
--   nao os projetava e o jsonb_build_object que nao os repassava. Nenhuma consulta nova.
--
-- ⚠️ AS DUAS PONTAS ANDAM JUNTAS
--   A primeira versao mexeu SO' no jsonb e morreu com 42703 "column c.unidade_id does not exist"
--   -- e so' na hora de APLICAR, porque SQL/plpgsql nao resolve nome de coluna no CREATE
--   (armadilha 1 do CLAUDE.md). Ao acrescentar campo aqui, mexa na CTE 'carga' tambem; o script
--   gerador aborta se qualquer uma das duas ancoras nao aparecer exatamente uma vez.
--
-- O QUE NAO MUDA
--   A lista de colunas do RETURNS TABLE e' a mesma (as chaves entram DENTRO do jsonb 'escalas'),
--   entao aqui e' CREATE OR REPLACE puro -- sem o DROP da versao anterior, que derrubaria a funcao
--   para quem estivesse consultando o relatorio no momento da aplicacao. O criterio de quem
--   aparece, o escopo por unidade e o calculo do teto ficam intactos.
--
-- GERADA POR SCRIPT
--   scratchpad/gen_carga_link.js, copia mecanica de 20260828130000 (mesmo padrao de gen_ancora.js):
--   o corpo nao foi redigitado, e o script aborta se a contagem de ocorrencias divergir.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE; REVOKE de privilegio ausente nao e erro.
-- ============================================================================


`

const rodape = `


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) Cada escala do jsonb tem que trazer os dois ids (esperado: nenhuma linha):
--
--   SELECT r.servidor_nome, e->>'unidade_id' AS unidade_id, e->>'setor_id' AS setor_id
--     FROM public.fn_carga_mensal_consolidada(9, 2026) r,
--          LATERAL jsonb_array_elements(r.escalas) e
--    WHERE e->>'unidade_id' IS NULL OR e->>'setor_id' IS NULL;
--
--   2) O conteudo do relatorio NAO pode ter mudado - mesma gente, mesmas horas que antes:
--
--   SELECT servidor_nome, total_horas, escalas_com_carga, excede_horas
--     FROM public.fn_carga_mensal_consolidada(9, 2026)
--    ORDER BY total_horas DESC;
`

fs.writeFileSync(SAIDA, (cabecalho + corpo + rodape).replace(/\n/g, '\r\n'))

// 4. conferencia estrutural do arquivo gerado
const out = fs.readFileSync(SAIDA, 'utf8')
const checks = [
  ['delimitadores $fn$ em par', (out.match(/\$fn\$/g) || []).length % 2 === 0],
  ['um unico CREATE OR REPLACE', (out.match(/CREATE OR REPLACE FUNCTION/g) || []).length === 1],
  ['nenhum DROP FUNCTION', !/DROP FUNCTION/.test(out)],
  ['GRANT uma vez', (out.match(/^GRANT /gm) || []).length === 1],
  ['REVOKE uma vez', (out.match(/^REVOKE /gm) || []).length === 1],
  ['CTE carga projeta unidade_id', /c\.escala_mensal_id,\r?\n\s+c\.unidade_id,\r?\n\s+c\.setor_id,/.test(out)],
  ['unidade_id no jsonb', /'unidade_id', c\.unidade_id/.test(out)],
  ['setor_id no jsonb', /'setor_id', c\.setor_id/.test(out)],
]
let ok = true
for (const [nome, passou] of checks) {
  console.log((passou ? 'ok    ' : 'FALHA ') + nome)
  if (!passou) ok = false
}
if (!ok) { fs.unlinkSync(SAIDA); throw new Error('conferencia falhou - migration descartada') }
console.log('\ngerado:', SAIDA)
