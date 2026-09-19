// Cria o indice que faltava em marcacoes_ponto(afd_registro_id) e corrige a sonda que mentiu.
// ABORTA se algum trecho nao bater exatamente 1x.
//
// 🚨 EXPLAIN (ANALYZE) em producao, 19/09/2026 -- o diagnostico definitivo:
//
//   CTE orfas .......................... actual time=5369.285 ms
//     Hash Anti Join
//       -> Bitmap Heap Scan rep_afd_registros ...... 74 linhas, 46 ms  (indice OK)
//       -> Hash  (rows=3453341) .................... 4869 ms
//            -> Seq Scan on marcacoes_ponto ........ 3.491.055 linhas, 3718 ms
//   Execution Time: 5540 ms
//
// O `NOT EXISTS (SELECT 1 FROM marcacoes_ponto WHERE afd_registro_id = a.id)` vira Hash Anti
// Join, e sem indice em `afd_registro_id` o Postgres constroi um hash da tabela INTEIRA (3,49
// milhoes de linhas, 14.742 blocos de arquivo temporario) para comparar com 74 registros de AFD.
//
// ⚠️ E a minha sonda "inocentou" a orfa em 1 ms porque ela media a consulta SEM o NOT EXISTS --
// exatamente a parte cara. Sonda que nao reproduz a consulta inteira nao mede nada; custou duas
// rodadas de producao.
import fs from 'fs'
const ARQ = 'supabase/migrations/20260919120000_auditoria_do_ponto_por_servidor.sql'
let s = fs.readFileSync(ARQ, 'utf8')
const N = s.includes('\r\n') ? '\r\n' : '\n'
console.log(`fonte: ${ARQ} (${N === '\r\n' ? 'CRLF' : 'LF'})`)
const sub = (de, para) => {
  const d = de.replace(/\n/g, N), p = para.replace(/\n/g, N)
  const n = s.split(d).length - 1
  if (n !== 1) throw new Error(`esperava 1 ocorrencia, achei ${n}: ${d.slice(0, 70)}`)
  s = s.replace(d, p)
}

// 1) o indice, antes da funcao
sub(`DROP FUNCTION IF EXISTS public.fn_auditoria_ponto_servidor(uuid, date, date);`,
`-- ----------------------------------------------------------------------------
-- O indice que faltava em marcacoes_ponto(afd_registro_id)
-- ----------------------------------------------------------------------------
-- 🚨 Medido por EXPLAIN (ANALYZE) em producao em 19/09/2026: um
-- \`NOT EXISTS (SELECT 1 FROM marcacoes_ponto WHERE afd_registro_id = a.id)\` sobre 74 registros
-- de AFD virava Hash Anti Join com SEQ SCAN das 3.491.055 linhas de marcacoes_ponto -- 3.718 ms
-- de leitura, 4.869 ms montando o hash, 14.742 blocos de arquivo temporario. 5.369 ms para
-- responder "estas 74 linhas ja viraram marcacao?".
--
-- \`marcacoes_ponto\` nasceu em 20260808000000 com indices por servidor, por orfa e por origem --
-- nenhum por \`afd_registro_id\`. Ninguem tinha sentido porque a unica consulta que percorria esse
-- caminho era a do helper de reconciliacao da rota, com poucos ids por vez (\`IN (...)\`).
--
-- ⚠️ PARCIAL: so linhas com AFD. Marcacao de terminal e ajuste tem \`afd_registro_id\` nulo e nao
-- interessam a nenhuma busca por registro de AFD -- o indice fica menor e mais rapido de manter.
--
-- ⚠️ A criacao bloqueia ESCRITA em marcacoes_ponto por dezenas de segundos (3,5 milhoes de
-- linhas). Nada se perde: o coletor tem fila offline e o terminal re-tenta.
CREATE INDEX IF NOT EXISTS idx_marcacao_afd_registro
    ON public.marcacoes_ponto (afd_registro_id)
    WHERE afd_registro_id IS NOT NULL;

COMMENT ON INDEX public.idx_marcacao_afd_registro IS
    'Responde "este registro de AFD ja virou marcacao?" sem varrer a tabela. Sem ele o NOT EXISTS '
    'da auditoria de orfas fazia Hash Anti Join sobre 3,49 milhoes de linhas (5,4 s). '
    'Ver 20260919120000.';

DROP FUNCTION IF EXISTS public.fn_auditoria_ponto_servidor(uuid, date, date);`)

// 2) a sonda passa a reproduzir a consulta INTEIRA
sub(`            PERFORM count(*) FROM public.rep_afd_registros a
             WHERE a.tipo_registro = '3'
               AND a.identificador_afd = ANY (v_ids)
               AND a.ocorrido_em >= v_ini30
               AND a.ocorrido_em <  (v_hoje + 1)
               AND NOT EXISTS (SELECT 1 FROM public.marcacoes_ponto m WHERE m.afd_registro_id = a.id);`,
`            -- ⚠️ O NOT EXISTS faz PARTE da sonda. A versao anterior dela o omitia e devolvia
            -- 1 ms, "inocentando" esta CTE enquanto ela sozinha custava 5.369 ms -- duas rodadas
            -- de producao foram gastas por causa disso. Sonda que nao reproduz a consulta
            -- inteira nao mede nada.
            PERFORM count(*) FROM public.rep_afd_registros a
             WHERE a.tipo_registro = '3'
               AND a.identificador_afd = ANY (v_ids)
               AND a.ocorrido_em >= v_ini30
               AND a.ocorrido_em <  (v_hoje + 1)
               AND NOT EXISTS (SELECT 1 FROM public.marcacoes_ponto m WHERE m.afd_registro_id = a.id);`)

fs.writeFileSync(ARQ, s)
console.log('  2 substituicoes aplicadas')

const c = fs.readFileSync(ARQ, 'utf8')
const exigir = (re, n, rot) => {
  const g = (c.match(re) || []).length
  if (g !== n) throw new Error(`invariante "${rot}": esperava ${n}, achei ${g}`)
  console.log(`  invariante OK: ${rot} (${g})`)
}
exigir(/CREATE INDEX IF NOT EXISTS idx_marcacao_afd_registro/g, 1, 'indice criado antes da funcao')
exigir(/WHERE afd_registro_id IS NOT NULL/g, 1, 'indice parcial: so quem tem AFD')
exigir(/NOT EXISTS \(SELECT 1 FROM public\.marcacoes_ponto m WHERE m\.afd_registro_id = a\.id\)/g, 2,
       'o NOT EXISTS esta na CTE E na sonda')
// O indice precisa vir ANTES do CREATE da funcao: a conferencia EXECUTA a funcao no fim do
// arquivo, e sem o indice ja no lugar ela mediria o tempo antigo e reprovaria.
const posIndice = c.indexOf('CREATE INDEX IF NOT EXISTS idx_marcacao_afd_registro')
const posFuncao = c.indexOf('CREATE OR REPLACE FUNCTION public.fn_auditoria_ponto_servidor')
if (posIndice < 0 || posFuncao < 0 || posIndice > posFuncao) throw new Error('o indice precisa vir antes da funcao')
console.log('  invariante OK: indice antes da funcao (a conferencia mede COM ele)')
