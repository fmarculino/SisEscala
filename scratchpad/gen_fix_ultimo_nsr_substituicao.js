#!/usr/bin/env node
/**
 * Gera supabase/migrations/20260906140000_fix_ultimo_nsr_na_substituicao.sql
 *
 * O DEFEITO (06/09/2026, pego na primeira execucao real em producao):
 * fn_registrar_substituicao_dispositivo escrevia `ultimo_nsr = NULL`, e a coluna e'
 * `bigint NOT NULL DEFAULT 0` desde 20260808000000. Resultado:
 *
 *   ERROR: 23502: null value in column "ultimo_nsr" of relation "dispositivos_rep"
 *          violates not-null constraint
 *
 * A intencao estava certa - o ultimo_nsr denormalizado nao pode continuar com o maximo da
 * geracao ANTERIOR, senao a tela afirma que o equipamento novo ja coletou 111 mil linhas. O
 * valor errado e' que era NULL: "nada ainda" nesta tabela sempre foi ZERO, e o proprio DEFAULT
 * da coluna dizia isso.
 *
 * ⚠️ POR QUE NENHUM PORTAO PEGOU: e' a armadilha 1 na forma mais pura. plpgsql resolve nome de
 * coluna e restricao so na EXECUCAO do statement - `CREATE OR REPLACE FUNCTION` aceita feliz da
 * vida uma funcao que viola NOT NULL, e o portao (que le texto) nao tem como saber que a coluna
 * e' NOT NULL. A licao operacional e curta: ANTES de escrever um valor numa coluna, leia a
 * definicao dela. `grep "nome_da_coluna" supabase/migrations/*.sql` resolve em 5 segundos.
 *
 * ✅ Nada ficou pela metade: a chamada e' um statement unico, entao o INSERT no historico e o
 * UPDATE da geracao voltaram atras junto. O CCE continua na geracao 1, intacto.
 *
 * ⚠️ A migration 20260906120000 NAO e regerada: ela ja foi aplicada em producao, e reescrever
 * arquivo ja aplicado apaga o registro do que de fato rodou. O conserto vem em migration
 * propria, e o corpo da funcao e' COPIADO de la (nunca redigitado) com uma substituicao contada.
 *
 * Rodar:  node scratchpad/gen_fix_ultimo_nsr_substituicao.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')
const FONTE = '20260906120000_geracao_do_equipamento.sql'
const SAIDA = path.join(MIG, '20260906140000_fix_ultimo_nsr_na_substituicao.sql')

const falhas = []
function exigir(cond, msg) { if (!cond) falhas.push(msg) }

const src = fs.readFileSync(path.join(MIG, FONTE), 'utf8').replace(/\r\n/g, '\n')
const ini = 'CREATE OR REPLACE FUNCTION public.fn_registrar_substituicao_dispositivo('
const i = src.indexOf(ini)
if (i < 0) { console.error('ABORTADO: funcao nao encontrada em ' + FONTE); process.exit(1) }
const j = src.indexOf('\n$fnsub$;', i)
if (j < 0) { console.error('ABORTADO: fim da funcao nao encontrado'); process.exit(1) }
let fn = src.slice(i, j + '\n$fnsub$;'.length)

// --- Invariantes: o que NAO pode se perder na copia (armadilha 1) --------------------------
exigir(/NOT IN \('super_admin', 'admin'\)/.test(fn), 'guard de papel ausente na fonte')
exigir(/Informe o motivo da substituicao/.test(fn), 'exigencia de motivo ausente na fonte')
exigir(/WHERE id = p_dispositivo_id FOR UPDATE/.test(fn), 'FOR UPDATE ausente na fonte')
exigir(/INSERT INTO public\.dispositivos_rep_substituicoes/.test(fn), 'gravacao do historico ausente na fonte')
exigir(/v_nova := v_disp\.geracao_atual \+ 1;/.test(fn), 'incremento da geracao ausente na fonte')
exigir(/fn_cursor_afd_dispositivo\(p_dispositivo_id\)/.test(fn), 'cursor novo no retorno ausente na fonte')

// --- A correcao -----------------------------------------------------------------------------
const DE = `           -- ultimo_nsr e' denormalizado e so' informativo. Mante-lo com o maximo da geracao
           -- anterior faria a tela afirmar que o equipamento novo ja coletou 111 mil linhas.
           ultimo_nsr    = NULL,`
const PARA = `           -- ultimo_nsr e' denormalizado e so' informativo. Mante-lo com o maximo da geracao
           -- anterior faria a tela afirmar que o equipamento novo ja coletou 111 mil linhas.
           --
           -- ⚠️ ZERO, nunca NULL: a coluna e' \`bigint NOT NULL DEFAULT 0\` desde 20260808000000,
           -- e "nada ainda" nesta tabela sempre foi 0. A primeira versao escrevia NULL e morria
           -- com 23502 na primeira execucao real - plpgsql so descobre isso EXECUTANDO.
           ultimo_nsr    = 0,`

const partes = fn.split(DE)
if (partes.length - 1 !== 1) {
  falhas.push(`substituicao do ultimo_nsr: esperava 1 ocorrencia, achou ${partes.length - 1}`)
} else {
  fn = partes.join(PARA)
}

const CABECALHO = `-- ============================================================================
-- Correcao: fn_registrar_substituicao_dispositivo violava NOT NULL em ultimo_nsr
-- ============================================================================
-- 06/09/2026, horas depois de 20260906120000. Pego na PRIMEIRA execucao real em producao:
--
--   ERROR: 23502: null value in column "ultimo_nsr" of relation "dispositivos_rep"
--          violates not-null constraint
--
-- A intencao estava certa: depois de trocar o equipamento, o ultimo_nsr denormalizado nao pode
-- continuar com o maximo da geracao ANTERIOR - a tela afirmaria que o aparelho novo ja coletou
-- 111 mil linhas. O valor e' que estava errado. A coluna e' \`bigint NOT NULL DEFAULT 0\` desde
-- 20260808000000: "nada ainda" nesta tabela sempre foi ZERO.
--
-- ⚠️ ARMADILHA 1, na forma mais pura: plpgsql resolve coluna e restricao so na EXECUCAO do
-- statement. CREATE OR REPLACE FUNCTION aceitou a funcao sem reclamar, tsc/build/lint nao veem
-- nada, e o portao de texto nao tem como saber que a coluna e NOT NULL. Antes de escrever um
-- valor numa coluna, LEIA A DEFINICAO DELA:
--     grep -rn "ultimo_nsr" supabase/migrations/*.sql | grep "NOT NULL"
--
-- ✅ NENHUM DADO FICOU PELA METADE. A chamada e' um statement unico, entao o INSERT no historico
-- e o UPDATE da geracao voltaram atras junto com o erro. O CCE-01 continua na geracao 1 e com o
-- AFD intacto - a substituicao simplesmente nao aconteceu ainda.
--
-- ⚠️ 20260906120000 NAO foi regerada. Ela ja rodou em producao, e reescrever arquivo ja aplicado
-- apaga o registro do que de fato foi executado. O corpo abaixo e' COPIADO de la por
-- scratchpad/gen_fix_ultimo_nsr_substituicao.js, com uma substituicao contada.
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_fix_ultimo_nsr_substituicao.js
-- ============================================================================

`

const RODAPE = `

REVOKE ALL ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    TO authenticated, service_role;

-- ============================================================================
-- CONFERENCIA
-- ============================================================================
--
-- 1. Antes de rodar a substituicao: o CCE-01 tem que estar como sempre esteve (geracao 1,
--    ultimo_nsr e cursor altos). Se estiver assim, o erro nao deixou rastro nenhum.
--
--   SELECT d.nome, d.geracao_atual, d.ultimo_nsr,
--          public.fn_cursor_afd_dispositivo(d.id) AS cursor_hoje
--     FROM public.dispositivos_rep d WHERE d.nome ILIKE '%CCE%';
--
--   SELECT count(*) AS substituicoes_gravadas FROM public.dispositivos_rep_substituicoes;
--   -- esperado: 0 (nada foi gravado pela tentativa que falhou)
--
-- 2. A substituicao do CCE-01, agora:
--
--   SELECT public.fn_registrar_substituicao_dispositivo(
--            (SELECT d.id FROM public.dispositivos_rep d WHERE d.nome ILIKE '%CCE%'),
--            'Equipamento queimou e foi substituido em 06/09/2026; AFD do novo recomeca no NSR 1.');
--   -- esperado: geracao_nova = 2 e cursor_novo = 1
--
-- 3. Depois do proximo ciclo do coletor (ate 5 min), o AFD do aparelho novo tem que aparecer:
--
--   SELECT r.geracao, count(*), min(r.nsr), max(r.nsr)
--     FROM public.rep_afd_registros r
--     JOIN public.dispositivos_rep d ON d.id = r.dispositivo_id
--    WHERE d.nome ILIKE '%CCE%' GROUP BY 1 ORDER BY 1;
--   -- esperado: geracao 1 com os 111.508 intactos, e geracao 2 comecando em 1
`

if (falhas.length) {
  console.error('\nABORTADO - o gerador nao escreveu nada:\n')
  falhas.forEach((f) => console.error('  x ' + f))
  process.exit(1)
}

const sql = CABECALHO + fn + RODAPE
const checks = [
  ['delimitadores $fnsub$ em pares', (sql.match(/\$fnsub\$/g) || []).length, 2],
  // Ancorado no inicio da linha: o cabecalho CITA `CREATE OR REPLACE FUNCTION` ao explicar a
  // armadilha 1, e contar a mencao junto faria a conferencia acusar duas definicoes.
  ['CREATE OR REPLACE FUNCTION', (sql.match(/^CREATE OR REPLACE FUNCTION/gm) || []).length, 1],
  ['ultimo_nsr recebe zero', (sql.match(/ultimo_nsr    = 0,/g) || []).length, 1],
  ['nenhum ultimo_nsr = NULL remanescente', (sql.match(/ultimo_nsr\s*=\s*NULL/g) || []).length, 0],
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
