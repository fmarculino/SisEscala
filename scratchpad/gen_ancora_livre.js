/**
 * Gera a migration do NIVEL 2-B da cadeia de horario do Plantao: a ancora do dicionario passa a
 * valer quando ela NAO colide com o Regular do dia.
 *
 * ⚠️ COPIA MECANICA (armadilha 1). As funcoes de presenca sao recriadas INTEIRAS a cada migration,
 *   e seis regressoes reais ja aconteceram por redigitar trecho a mao. Este script copia o corpo
 *   VIGENTE de cada funcao e aplica UMA substituicao pontual, abortando se a contagem divergir.
 *
 * ⚠️ DUAS FONTES DIFERENTES (armadilha 9, o caso de 22/08/2026):
 *     fn_confirmar_presenca         -> 20260901120000  (2 cursores: ontem e hoje)
 *     fn_blocos_previstos_dia       -> 20260822130000
 *     fn_confirmar_presenca_manual  -> 20260822130000
 *   Regenerar so o arquivo "mais recente" deixaria a validacao manual do coordenador para tras.
 *
 * ⚠️ O SEGUNDO ARGUMENTO DE String.replace TEM DE SER FUNCAO. Com string, o JS interpreta os
 *   padroes de cifrao: `$$` vira `$` (quebrando o dollar-quoting do plpgsql) e `$'` — que existe
 *   dentro de `~ '^[0-9]+$'` — e substituido pelo RESTO DO ARQUIVO. Foi assim que a 20260809000000
 *   enfiou um bloco de GRANT no meio de uma funcao.
 *
 * Roda com:  node scratchpad/gen_ancora_livre.js
 */

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')
const SAIDA = path.join(MIG, '20260903100000_ancora_do_plantao_que_nao_colide_com_o_regular.sql')

const F_PRESENCA = '20260901120000_guarda_intervalo_minimo_e_deduplicacao_entrada.sql'
const F_BLOCOS = '20260822130000_plantao_interval_presence_functions.sql'

const ler = (f) => fs.readFileSync(path.join(MIG, f), 'utf8')

// ---------------------------------------------------------------------------
// 1. EXTRACAO DOS CORPOS VIGENTES
// ---------------------------------------------------------------------------
/** Recorta de `inicio` (inclusive) ate a linha `fim` (inclusive), 1-indexado. */
function recortar(texto, primeira, ultima, rotulo) {
  const linhas = texto.split(/\r?\n/)
  if (ultima > linhas.length) {
    throw new Error(`${rotulo}: arquivo tem ${linhas.length} linhas, pedi ate ${ultima}`)
  }
  return linhas.slice(primeira - 1, ultima).join('\r\n')
}

function acharLinha(texto, agulha, rotulo) {
  const linhas = texto.split(/\r?\n/)
  const idx = linhas.findIndex((l) => l.startsWith(agulha))
  if (idx < 0) throw new Error(`${rotulo}: nao achei a linha que comeca com ${JSON.stringify(agulha)}`)
  return idx + 1
}

const srcPresenca = ler(F_PRESENCA)
const srcBlocos = ler(F_BLOCOS)

const linhasPresenca = srcPresenca.split(/\r?\n/)
const iniConfirmar = acharLinha(srcPresenca, 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(', 'fn_confirmar_presenca')
const corpoConfirmar = recortar(srcPresenca, iniConfirmar, linhasPresenca.length, 'fn_confirmar_presenca').replace(/\s+$/, '')

const iniBlocos = acharLinha(srcBlocos, 'CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(', 'fn_blocos_previstos_dia')
const fimBlocos = acharLinha(srcBlocos, '$fnbloco$;', 'fn_blocos_previstos_dia (fim)')
const corpoBlocos = recortar(srcBlocos, iniBlocos, fimBlocos, 'fn_blocos_previstos_dia')

const iniManual = acharLinha(srcBlocos, 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(', 'fn_confirmar_presenca_manual')
const linhasBlocos = srcBlocos.split(/\r?\n/)
const corpoManual = recortar(srcBlocos, iniManual, linhasBlocos.length, 'fn_confirmar_presenca_manual').replace(/\s+$/, '')

// ---------------------------------------------------------------------------
// 2. A SUBSTITUICAO
// ---------------------------------------------------------------------------
// O marcador e o ramo `T%` de 11..14 seguido do fallback pelo nome da jornada. Essa sequencia so
// existe no bloco do PLANTAO: no bloco do Regular o mesmo `WHEN j.nome` aparece como PRIMEIRO ramo
// de outro CASE, e o ramo `T%` de 11..14 dele e seguido de `ELSE NULL`. Casar o `WHEN j.nome`
// sozinho pegaria os dois e deslocaria tambem o horario do expediente.
const MARCADOR = new RegExp(
  '([ \\t]*)WHEN \\(dt\\.codigo LIKE \'T%\' OR dt\\.slots\\[1\\] = \'T\'\\) AND \\r?\\n'
  + '[ \\t]*\\(public\\.fn_obter_horario_regular_dia\\(em\\.id, ed\\.dia\\)->>\'start_hour\'\\)::integer IS NOT NULL AND\\r?\\n'
  + '[ \\t]*\\(public\\.fn_obter_horario_regular_dia\\(em\\.id, ed\\.dia\\)->>\'start_hour\'\\)::integer BETWEEN 11 AND 14\\r?\\n'
  + '[ \\t]*THEN \\(public\\.fn_obter_horario_regular_dia\\(em\\.id, ed\\.dia\\)->>\'start_hour\'\\)::integer\\r?\\n'
  + '\\r?\\n'
  + '([ \\t]*)WHEN j\\.nome IS NOT NULL AND substring\\(j\\.nome from \'\\^\\(\\[0-9\\]\\+\\)\'\\)::integer IS NOT NULL THEN\\r?\\n',
  'g',
)

function ramoNovo(ind) {
  const L = [
    '',
    `${ind}-- NIVEL 2-B da cadeia de precedencia de horario (03/09/2026). Ver`,
    `${ind}-- docs/planos/2026-09-03-plantao-noturno-previsao-e-virada-de-dia.md`,
    `${ind}--`,
    `${ind}-- ANCORA DO DICIONARIO QUANDO ELA NAO COLIDE COM O REGULAR DO DIA.`,
    `${ind}-- O ramo logo abaixo — o ultimo da cascata legada — resolve o inicio do PLANTAO pelo`,
    `${ind}-- inicio da JORNADA REGULAR. Para plantao noturno em jornada diurna isso nao emenda`,
    `${ind}-- nada: EMPILHA o plantao em cima do expediente. Caso real medido em 03/09/2026:`,
    `${ind}-- CHARLENE (mat. 69250), 02/09, Regular M 07H AS 13H + Plantao N. O N nascia`,
    `${ind}-- 07:00-19:00, FUNDIA com o expediente (armadilha 6), e o DP casava a batida real das`,
    `${ind}-- 13:00 com o slot das 07:00 (360 min de distancia) e a das 18:45 com o das 13:00 —`,
    `${ind}-- expediente de 6h aparecendo com 11h55 na folha. 156 plantoes na mesma situacao,`,
    `${ind}-- 54 ja com ponto gravado, em 5 unidades.`,
    `${ind}--`,
    `${ind}-- ⚠️ ESTE RAMO NAO PODE SUBIR. Ele vem DEPOIS de todos os ramos de emenda de proposito:`,
    `${ind}-- onde a cascata ja emendava, nada muda. Acima deles, um \`N\` em jornada 07H AS 17H`,
    `${ind}-- passaria a esperar ate as 19:00 em vez de emendar as 17:00 — o comportamento medido`,
    `${ind}-- em 49 dias reais de producao em 08/08/2026, que motivou a condicao do NIVEL 2.`,
    `${ind}--`,
    `${ind}-- ⚠️ E A CONDICAO DE NAO-COLISAO E O QUE O NIVEL 2 DIZIA PROTEGER. O comentario dele`,
    `${ind}-- diz "forcar a ancora ali sobreporia o plantao ao turno Regular"; o fallback que ele`,
    `${ind}-- deixava passar produzia exatamente essa sobreposicao. Onde a ancora TAMBEM colide`,
    `${ind}-- (MT de 12h em jornada 07H AS 19H = 24h previstas no dia), nada muda aqui: e erro de`,
    `${ind}-- escala, e quem barra e a validacao da grade.`,
    `${ind}WHEN dt.horario_inicio IS NOT NULL`,
    `${ind}     AND public.fn_ancora_plantao_livre_do_regular(`,
    `${ind}             em.id, ed.dia, dt.horario_inicio, dt.horas_computadas)`,
    `${ind}THEN extract(hour from dt.horario_inicio)::integer`,
    '',
  ]
  return L.join('\r\n')
}

function aplicar(corpo, esperadas, rotulo) {
  let n = 0
  const saida = corpo.replace(MARCADOR, (casado, indT, indJ) => {
    n++
    // O ramo novo entra ANTES do fallback pelo nome da jornada, com a mesma indentacao dele.
    const posJ = casado.lastIndexOf(`${indJ}WHEN j.nome`)
    return casado.slice(0, posJ) + ramoNovo(indJ).replace(/^\r\n/, '') + '\r\n' + casado.slice(posJ)
  })
  if (n !== esperadas) {
    throw new Error(`${rotulo}: esperava ${esperadas} substituicao(oes), fiz ${n}. ABORTADO.`)
  }
  console.log(`  ${rotulo}: ${n} substituicao(oes)`)
  return saida
}

console.log('Aplicando o nivel 2-B:')
const novoConfirmar = aplicar(corpoConfirmar, 2, 'fn_confirmar_presenca')
const novoBlocos = aplicar(corpoBlocos, 1, 'fn_blocos_previstos_dia')
const novoManual = aplicar(corpoManual, 1, 'fn_confirmar_presenca_manual')

// ---------------------------------------------------------------------------
// 3. INVARIANTES — o que NAO pode ter mudado
// ---------------------------------------------------------------------------
// Contagem EXATA de cada invariante em cada funcao, medida na fonte em 03/09/2026.
//
// ⚠️ NAO BASTA "antes == depois". A primeira versao deste gerador so comparava a contagem antes e
//   depois da substituicao — e passou por uma fonte deliberadamente corrompida (guard de
//   Sobreaviso removido), porque 0 == 0. Fonte quebrada e o caso que mais importa pegar: e o que
//   colocaria em producao uma funcao sem o guard, e plpgsql so reclama disso em tempo de execucao.
//   Se algum destes numeros mudar por uma correcao legitima, atualize-o AQUI, conscientemente.
const INVARIANTES = {
  // Guards de Sobreaviso (armadilha 6): a CHECK do banco e a ultima defesa, mas perder os guards
  // aqui volta a fundir sobreaviso com o turno.
  "<> 'Sobreaviso'": { fn_confirmar_presenca: 14, fn_blocos_previstos_dia: 7, fn_confirmar_presenca_manual: 1 },
  // Guard do plantao diurno em jornada noturna (nivel 2-A, 20260809000000). A funcao manual nao o
  // tem — divergencia real entre as funcoes, anterior a esta migration e fora do escopo dela.
  dobra_diurna: { fn_confirmar_presenca: 31, fn_blocos_previstos_dia: 17, fn_confirmar_presenca_manual: 0 },
  // Intervalo do plantao (armadilha 9, 20260822120000/130000).
  fn_intervalo_previsto_minutos: { fn_confirmar_presenca: 10, fn_blocos_previstos_dia: 5, fn_confirmar_presenca_manual: 2 },
  // O fallback que o ramo novo passa a preceder tem de continuar existindo.
  "substring(j.nome from '^([0-9]+)')::integer": { fn_confirmar_presenca: 8, fn_blocos_previstos_dia: 4, fn_confirmar_presenca_manual: 4 },
  // Ancora fixa do dicionario, o NIVEL 2 — nao foi tocado.
  'SO VALE QUANDO NAO HA TURNO REGULAR NO DIA': { fn_confirmar_presenca: 2, fn_blocos_previstos_dia: 1, fn_confirmar_presenca_manual: 1 },
}

function conferir(antes, depois, rotulo) {
  for (const [agulha, esperado] of Object.entries(INVARIANTES)) {
    const a = antes.split(agulha).length - 1
    const d = depois.split(agulha).length - 1
    if (a !== esperado[rotulo]) {
      throw new Error(`${rotulo}: a FONTE tem ${a} ocorrencia(s) de ${JSON.stringify(agulha)}, `
        + `esperava ${esperado[rotulo]}. A fonte mudou (ou quebrou). ABORTADO.`)
    }
    if (a !== d) throw new Error(`${rotulo}: ${JSON.stringify(agulha)} tinha ${a} ocorrencia(s) e ficou com ${d}. ABORTADO.`)
  }
  // O corpo so pode ter CRESCIDO, e so pelo ramo novo.
  if (depois.length <= antes.length) throw new Error(`${rotulo}: o corpo nao cresceu. ABORTADO.`)
  const novos = depois.split('NIVEL 2-B').length - 1
  console.log(`  ${rotulo}: invariantes ok, ${novos} ramo(s) novo(s)`)
}

console.log('\nConferindo invariantes:')
conferir(corpoConfirmar, novoConfirmar, 'fn_confirmar_presenca')
conferir(corpoBlocos, novoBlocos, 'fn_blocos_previstos_dia')
conferir(corpoManual, novoManual, 'fn_confirmar_presenca_manual')

// ---------------------------------------------------------------------------
// 4. A MIGRATION
// ---------------------------------------------------------------------------
const CABECALHO = `-- ============================================================================
-- Migration: a ancora do dicionario passa a valer quando NAO colide com o Regular do dia
-- Data: 2026-09-03
-- Gerada por scratchpad/gen_ancora_livre.js — NAO EDITAR A MAO (armadilha 1).
--
-- O PROBLEMA
--   A cadeia de resolucao de horario do Plantao (armadilha 4) tem, como ultimo recurso,
--   \`substring(j.nome from '^([0-9]+)')\` — o INICIO DA JORNADA REGULAR. Para um plantao noturno
--   num dia de jornada diurna nenhum ramo de emenda casa, e esse fallback nao emenda coisa
--   nenhuma: EMPILHA o plantao em cima do expediente.
--
--   Caso real (CHARLENE LARCERDA DA SILVA, mat. 69250, HMI/FISIOTERAPIA, 02/09/2026):
--     Regular M, jornada 07H AS 13H  +  Plantao N (ancora 19:00 no dicionario)
--     fn_blocos_previstos_dia devolvia UM bloco:  07:00 -> 19:00, permite_intervalo FALSE
--       turnos_inicio [07:00, 07:00]   turnos_fim [13:00, 19:00]
--     ou seja: o plantao previsto para 07:00-19:00, fundido com o expediente (armadilha 6) e
--     sem o passo de intervalo que a 20260822120000 tinha acabado de lhe dar (armadilha 9).
--
--   Batidas reais dela, todas de origem rep:
--     06:50  13:00  18:45  21:35  22:35  (02/09)   06:57  07:15  (03/09)
--   Com o bloco errado, o DP casou 13:00 -> slot 07:00 (360 min) e 18:45 -> slot 13:00 (345 min),
--   porque nao casar custa 720 (v_tol_ontem * 2) e casar mal sempre compensa. Resultado gravado:
--     Regular  06:50 -> 18:45  = 11h55 contra jornada de 6h  (~5h55 de extra que nao existiu)
--     Plantao  13:00 -> 21:35
--   Nenhuma tentativa recusada, nenhuma pendencia, nenhum alerta: silencioso dos dois lados.
--
-- EXTENSAO MEDIDA EM PRODUCAO (03/09/2026, fn_blocos_previstos_mes sobre 2.216 escalas ativas,
-- 32.345 blocos): 156 linhas de Plantao previstas SOBREPOSTAS ao Regular do mesmo dia, 54 delas
-- ja com ponto gravado, em 5 unidades e 28 servidores. Em tres familias:
--     A  64  codigo com ancora (N, MT, T, M)      -> esta migration resolve
--     B  71  codigo Classe B (T4, N4, N6, M7)     -> so hora_inicio_prevista resolve (nivel 1)
--     C  21  nao cabe no dia (MT 12h + Regular 12h)-> erro de escala
--
-- A CORRECAO
--   Um ramo novo na cascata do Plantao — NIVEL 2-B —, colocado DEPOIS de todos os ramos de
--   emenda e ANTES do fallback pelo nome da jornada:
--
--       se o turno tem ancora no dicionario E a janela [ancora, ancora + duracao] NAO se sobrepoe
--       a janela prevista do Regular do dia, use a ancora.
--
--   Por construcao ele NAO altera nenhum dia em que um ramo de emenda ja casa hoje:
--     Regular 07H AS 17H + N   continua 17:00   (ramo N% com end_hour em 17..20)
--     Regular 12H AS 18H + M   continua 06:00   (ramo M% com start_hour em 12..15)
--     jornada 18H AS 06H + MT  continua 06:00   (nivel 2-A, 20260809000000)
--   So age onde hoje se cai no fallback pelo nome da jornada, que e exatamente o empilhamento.
--
-- ⚠️ NAO REMOVER A CONDICAO DO NIVEL 2 ("so vale quando nao ha Regular no dia"). Ela continua
--   correta e continua no lugar; o nivel 2-B passa por baixo dela, com a condicao explicita de
--   nao-colisao — que e o proprio criterio que ela dizia proteger.
--
-- ⚠️ ESTA MIGRATION NAO REPROCESSA PONTO NENHUM. marcacoes_ponto e INSERT-only e a projecao e
--   reconstruivel: quem realoca as batidas contra a previsao certa e fn_reconciliar_marcacoes_dia,
--   rodada DEPOIS, dia a dia, com conferencia antes/depois. Reconciliacao em massa foi medida em
--   03/09/2026 sobre 09/2026 e NAO e neutra: 4 ganhos contra 43 trocas e 7 perdas (uma delas
--   tirava 4h34 de uma saida ja gravada). Nao rode em massa.
--
-- ⚠️ COMPETENCIAS 06 e 07/2026 ESTAO FECHADAS e ficam como estao (decisao do usuario,
--   03/09/2026). fn_reconciliar_marcacoes_dia ja as recusa por conta propria.
--
-- FUNCOES RECRIADAS (copia mecanica do corpo vigente + 1 substituicao pontual cada):
--   fn_confirmar_presenca         <- 20260901120000  (2 cursores: ontem e hoje)
--   fn_blocos_previstos_dia       <- 20260822130000
--   fn_confirmar_presenca_manual  <- 20260822130000
--
-- IDEMPOTENTE: so CREATE OR REPLACE, sem DROP e sem mudanca de assinatura — os GRANTs existentes
-- sao preservados (nenhuma funcao vira objeto novo, armadilha 41). Reaplicar e inofensivo.
--
-- CONFERENCIA APOS APLICAR: ver o fim do arquivo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A ancora colide com o Regular do dia?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ancora_plantao_livre_do_regular(
    p_escala_mensal_id uuid,
    p_dia              integer,
    p_horario_inicio   time,
    p_horas            numeric
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fnanc$
DECLARE
    v_reg   jsonb;
    v_r_ini numeric;
    v_r_fim numeric;
    v_p_ini numeric;
    v_p_fim numeric;
BEGIN
    -- Sem ancora ou sem duracao nao ha o que afirmar. FALSE deixa a cascata seguir como antes:
    -- o default desta funcao e "nao sei", e "nao sei" nunca muda comportamento.
    IF p_horario_inicio IS NULL OR COALESCE(p_horas, 0) <= 0 THEN
        RETURN false;
    END IF;

    v_reg := public.fn_obter_horario_regular_dia(p_escala_mensal_id, p_dia);

    -- Sem Regular no dia a ancora nunca colide. Na pratica o NIVEL 2 ja resolveu antes de chegar
    -- aqui; a linha existe para a funcao ser correta sozinha, nao so no lugar onde e chamada.
    IF v_reg IS NULL THEN
        RETURN true;
    END IF;

    v_r_ini := (v_reg->>'start_hour')::numeric;
    v_r_fim := (v_reg->>'end_hour')::numeric;
    IF v_r_ini IS NULL OR v_r_fim IS NULL THEN
        RETURN false;
    END IF;

    -- Jornada que cruza a meia-noite (18H AS 06H): o fim pertence ao dia seguinte. Sem isto,
    -- 18..06 seria lido como um intervalo vazio e TUDO passaria por "nao colide".
    IF v_r_fim <= v_r_ini THEN
        v_r_fim := v_r_fim + 24;
    END IF;

    v_p_ini := extract(hour   from p_horario_inicio)::numeric
             + extract(minute from p_horario_inicio)::numeric / 60.0;
    v_p_fim := v_p_ini + p_horas;

    -- Os dois intervalos sao comparados no MESMO eixo: horas desde a meia-noite do dia da escala.
    -- O plantao pode passar de 24 — e o caso do N, 19:00 -> 31:00 — e e justamente por isso que
    -- ele nao colide com um expediente 07:00-13:00.
    RETURN v_p_fim <= v_r_ini OR v_p_ini >= v_r_fim;
END;
$fnanc$;

COMMENT ON FUNCTION public.fn_ancora_plantao_livre_do_regular(uuid, integer, time, numeric) IS
    'NIVEL 2-B da cadeia de horario do Plantao (03/09/2026): a janela da ancora do dicionario nao '
    'se sobrepoe a janela prevista do Regular do dia. Devolve false quando nao ha como afirmar, '
    'para a cascata seguir inalterada.';

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. Sem o REVOKE, funcao nova nasce
-- aberta a anon. Esta e chamada de dentro de funcoes SECURITY DEFINER, que executam com os
-- privilegios do dono — revogar aqui nao quebra nenhuma delas.
REVOKE ALL ON FUNCTION public.fn_ancora_plantao_livre_do_regular(uuid, integer, time, numeric)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ancora_plantao_livre_do_regular(uuid, integer, time, numeric)
    TO service_role;


-- ----------------------------------------------------------------------------
-- 2. fn_confirmar_presenca  (base: 20260901120000, 2 cursores)
-- ----------------------------------------------------------------------------
`

const RODAPE = `

-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
-- 1. A funcao nova responde o esperado nos casos de referencia:
--    SELECT
--      public.fn_ancora_plantao_livre_do_regular(em.id, 2, '19:00'::time, 12) AS n_em_07_13
--    FROM public.escala_mensal em
--    WHERE em.servidor_id = (SELECT id FROM public.servidores WHERE matricula = '69250')
--      AND em.ano = 2026 AND em.mes = 9;
--    -- esperado: true (o plantao N vai das 19:00 as 07:00 e nao encosta no expediente 07:00-13:00)
--
-- 2. O caso que motivou a migration — o bloco tem de virar DOIS, e o plantao 19:00 -> 07:00+1:
--    SELECT b.bloco_ordem, b.categoria, b.inicio_previsto, b.fim_previsto, b.permite_intervalo
--      FROM public.fn_blocos_previstos_dia(
--             (SELECT id FROM public.servidores WHERE matricula = '69250'),
--             '2026-09-02'::date) b
--     ORDER BY b.inicio_previsto;
--    -- esperado: bloco 1 Regular 07:00-13:00; bloco 2 Plantao 19:00-07:00 do dia 03, com
--    --           permite_intervalo = true (12h > 6h, piso legal de 60 min)
--
-- 3. NENHUM turno Regular ou Extra pode ter mudado de janela. Rodar ANTES e DEPOIS e comparar:
--    SELECT ed.id, b.inicio_previsto, b.fim_previsto
--      FROM public.escala_mensal em
--      JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
--      CROSS JOIN LATERAL public.fn_blocos_previstos_dia(
--               em.servidor_id, make_date(em.ano, em.mes, ed.dia)) b
--     WHERE em.ativo AND em.ano = 2026 AND em.mes IN (8, 9, 10)
--       AND ed.categoria IN ('Regular', 'Extra')
--       AND ed.id = ANY(b.escala_diaria_ids);
--    -- esperado: zero diferencas entre as duas execucoes
--
-- 4. Quantos plantoes deixaram de se sobrepor ao Regular (o ganho desta migration):
--    o script scratchpad/an_sobrep.mjs mede isso contra producao. Esperado: 156 -> 96
--    (queda de 60, medida por scratchpad/sim_nivel2b.mjs ANTES de aplicar; as familias B e C
--    continuam, e sao resolvidas pela validacao da grade e pelo nivel 1).
--    ✅ CONFERIDO EM PRODUCAO EM 03/09/2026: 156 -> 96, exatamente a queda prevista.
--
-- 5. Guards que nao podem ter sumido das tres funcoes recriadas:
--    SELECT p.proname,
--           (p.prosrc LIKE '%<> ''Sobreaviso''%')                AS guard_sobreaviso,
--           (p.prosrc LIKE '%dobra_diurna%')                     AS guard_dobra_diurna,
--           (p.prosrc LIKE '%fn_intervalo_previsto_minutos%')    AS intervalo_do_plantao,
--           (p.prosrc LIKE '%fn_ancora_plantao_livre_do_regular%') AS nivel_2b
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname IN ('fn_confirmar_presenca', 'fn_blocos_previstos_dia',
--                         'fn_confirmar_presenca_manual');
--    -- esperado: true em todas as colunas, nas tres funcoes
--
-- 6. A funcao nova NAO pode estar aberta a anon (armadilha 24):
--    SELECT has_function_privilege('anon',
--      'public.fn_ancora_plantao_livre_do_regular(uuid, integer, time, numeric)', 'EXECUTE');
--    -- esperado: false
`

const migration = [
  CABECALHO,
  novoConfirmar,
  '\r\n\r\n-- ----------------------------------------------------------------------------',
  '-- 3. fn_blocos_previstos_dia  (base: 20260822130000)',
  '-- ----------------------------------------------------------------------------',
  novoBlocos,
  '\r\n\r\n-- ----------------------------------------------------------------------------',
  '-- 4. fn_confirmar_presenca_manual  (base: 20260822130000)',
  '-- ----------------------------------------------------------------------------',
  novoManual,
  RODAPE,
].join('\r\n').replace(/\r?\n/g, '\r\n')

// ---------------------------------------------------------------------------
// 5. CONFERENCIA ESTRUTURAL DO ARQUIVO INTEIRO
// ---------------------------------------------------------------------------
// A 20260809000000 saiu com `syntax error at or near "$"` e um bloco de GRANT no meio de uma
// funcao porque ninguem olhou o arquivo gerado como um todo. Estas checagens sao a resposta.
const problemas = []

const pares = [['$fn$', 0], ['$fnbloco$', 2], ['$fnanc$', 2]]
for (const [delim, esperado] of pares) {
  const n = migration.split(delim).length - 1
  if (esperado && n !== esperado) problemas.push(`delimitador ${delim}: ${n} ocorrencia(s), esperava ${esperado}`)
}
const dollarDuplo = migration.split('$$').length - 1
if (dollarDuplo % 2 !== 0) problemas.push(`$$ em numero impar (${dollarDuplo}) — dollar-quoting desbalanceado`)

const creates = migration.split('CREATE OR REPLACE FUNCTION public.').length - 1
if (creates !== 4) problemas.push(`CREATE OR REPLACE FUNCTION: ${creates}, esperava 4`)

const ramos = migration.split('fn_ancora_plantao_livre_do_regular(').length - 1
// 1 definicao + 1 COMMENT + 2 privilegios + 4 chamadas nos ramos + 2 na conferencia = 10
if (ramos !== 10) problemas.push(`referencias a fn_ancora_plantao_livre_do_regular: ${ramos}, esperava 10`)

if (!/^-- =+\r\n-- Migration:/.test(migration)) problemas.push('cabecalho fora do formato')
// CRLF em todo o arquivo (convencao das migrations). Procurar "\n\r" seria errado: e o que aparece
// no meio de toda linha em branco CRLF (\r\n\r\n). O certo e LF sem CR antes.
if (/(^|[^\r])\n/.test(migration)) problemas.push('ha LF sem CR — o arquivo tem de ser CRLF inteiro')

if (problemas.length) {
  console.error('\nCONFERENCIA ESTRUTURAL FALHOU:')
  for (const p of problemas) console.error('  - ' + p)
  process.exit(1)
}

fs.writeFileSync(SAIDA, migration, 'utf8')
console.log(`\nEstrutura ok. Migration escrita:\n  ${path.relative(RAIZ, SAIDA)}`)
console.log(`  ${migration.split(/\r\n/).length} linhas`)
