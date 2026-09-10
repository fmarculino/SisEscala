-- Migration: excluir vigencia de jornada vira ATO REGISTRADO, com as duas recusas duras
-- Description: motivo obrigatorio + historico append-only + recusa em competencia encerrada e
--              folha fora de Rascunho quando o periodo ja tem ponto. Cria
--              servidores_jornadas_temporarias_historico, fn_vigencia_jornada_impacto e
--              fn_excluir_vigencia_jornada, mais a trigger BEFORE DELETE que fecha o caminho cru.
--
-- O QUE ESTAVA ABERTO (medido em producao em 10/09/2026)
--   deleteJornadaTemporaria era um DELETE cru: sem motivo, sem rastro, sem guard nenhum, e nao
--   existia trigger de DELETE nesta tabela. A assimetria era gritante - CRIAR a vigencia exige
--   motivo, TROCAR a jornada do mes exige justificativa e vira linha em
--   escala_mensal_jornada_historico, e APAGAR (a mais destrutiva das tres) nao exigia nada.
--
--   69 vigencias, 33 servidores, 61 delas criadas em 09/2026. 38 das 69 (55%) ja cobrem dia com
--   ponto: 115 dias, dos quais 68 em folha Revisada e 32 em folha fora de Rascunho com a
--   competencia ainda ABERTA - alcancaveis pelo botao "Corrigir Todas" da tela de folha, que
--   pula competencia encerrada mas NAO pula folha Revisada.
--
-- POR QUE NAO E BLOQUEIO DURO POR "JA TEM BATIDA"
--   Foi a primeira ideia e esta errada, pelo mesmo motivo ja registrado no CLAUDE.md para a
--   troca de jornada do mes (19/08/2026). Aqui e ainda mais forte: DESFAZER UM ENGANO E A UNICA
--   RAZAO LEGITIMA QUE EXISTE PARA APAGAR UMA VIGENCIA. Mudanca real de horario daqui pra frente
--   e vigencia NOVA, nunca apagar a antiga. Travar quem tem ponto seria congelar para sempre a
--   vigencia cadastrada errada - e os motivos ja gravados provam que isso acontece
--   ("horario cadastrado indevido", "registro errado de horario de trabalho").
--
-- O QUE MUDA DE FATO AO APAGAR
--   Nada se perde: marcacoes_ponto e INSERT-only, escala_diaria.presenca_* nao e reescrita pelo
--   DELETE e folha_ponto.registros e snapshot. O que muda e o JULGAMENTO do dia -
--   obter_jornada_servidor_data deixa de achar a vigencia e cai para escala_mensal.jornada_id.
--
--   MEDIR ISSO EM HORAS SUBESTIMA, E MUITO. Em 97 dos 115 dias batidos a CARGA e identica entre
--   as duas jornadas - delta zero. Mas em 43 deles a JANELA desloca: 179h na entrada e 179h na
--   saida. Caso real: SILVIA MERCEDES (28558), vigencia 10H AS 14H contra jornada do mes
--   14H AS 18H, 20 dias ja batidos, folha Revisada. Mesma carga de 4h; a entrada prevista
--   mudaria de 10:00 para 14:00. Por isso fn_vigencia_jornada_impacto devolve a JANELA
--   (de -> para) e nao um delta de horas: um aviso dizendo "0h de diferenca" seria uma mentira
--   tranquilizadora.
--
-- POR QUE A RPC NAO RECONCILIA SOZINHA
--   Reconciliar em massa esta medido e recusado (CLAUDE.md: 4 ganhos contra 43 trocas e 7
--   perdas). Aqui a exclusao apenas DEVOLVE a lista de dias que ficaram para tras; quem
--   sincroniza e uma pessoa, pelo botao que ja existe. Mudar numero de folha sem alguem pedir e
--   exatamente o modo de falha que esta migration existe para fechar.

BEGIN;

-- ============================================================================
-- 1. Historico append-only da exclusao
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.servidores_jornadas_temporarias_historico (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Sem FK: a linha de origem deixou de existir, e esse e justamente o ponto do historico.
    vigencia_id           uuid NOT NULL,
    servidor_id           uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    -- jornada_id sem FK RESTRICT de proposito: aposentar uma jornada nao pode travar por causa
    -- de historico. O nome vai congelado ao lado, porque jornada e renomeavel.
    jornada_id            uuid,
    jornada_nome          text,
    -- Para onde o previsto daqueles dias voltou. Pode haver mais de uma quando o periodo
    -- atravessa competencias com jornadas diferentes - por isso e texto, nao uuid.
    jornada_apos          text,
    data_inicio           date NOT NULL,
    data_fim              date NOT NULL,
    motivo_original       text,
    motivo_exclusao       text NOT NULL,
    dias_no_periodo       integer NOT NULL,
    dias_com_ponto        integer NOT NULL,
    excluido_por          uuid REFERENCES auth.users(id),
    excluido_em           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vig_jornada_hist_servidor
    ON public.servidores_jornadas_temporarias_historico (servidor_id, excluido_em DESC);

ALTER TABLE public.servidores_jornadas_temporarias_historico ENABLE ROW LEVEL SECURITY;

-- Leitura pela ficha do servidor, mesmo alcance da tabela viva.
DROP POLICY IF EXISTS "Autenticado ve historico de vigencia"
    ON public.servidores_jornadas_temporarias_historico;
CREATE POLICY "Autenticado ve historico de vigencia"
    ON public.servidores_jornadas_temporarias_historico
    FOR SELECT TO authenticated
    USING (true);

-- SEM policy de escrita, de proposito (mesmo padrao de escala_mensal_movimentos e
-- dispositivos_rep_substituicoes): so a RPC SECURITY DEFINER grava aqui. Com policy, qualquer
-- autenticado forjaria linha de historico pelo PostgREST.

CREATE OR REPLACE FUNCTION public.fn_historico_vigencia_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    RAISE EXCEPTION 'servidores_jornadas_temporarias_historico e append-only: % nao e permitido.', TG_OP;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_historico_vigencia_append_only
    ON public.servidores_jornadas_temporarias_historico;
CREATE TRIGGER trg_historico_vigencia_append_only
    BEFORE UPDATE OR DELETE ON public.servidores_jornadas_temporarias_historico
    FOR EACH ROW EXECUTE FUNCTION public.fn_historico_vigencia_append_only();


-- ============================================================================
-- 2. O impacto, para a tela avisar ANTES de confirmar
-- ============================================================================
-- Devolve uma linha so. A tela nao recalcula nada disso: quem responde "o que acontece se eu
-- apagar" e o banco, porque e o banco que resolve a jornada por data.

DROP FUNCTION IF EXISTS public.fn_vigencia_jornada_impacto(uuid);

CREATE FUNCTION public.fn_vigencia_jornada_impacto(p_vigencia_id uuid)
RETURNS TABLE (
    servidor_nome         text,
    jornada_atual         text,
    jornada_apos          text,
    dias_no_periodo       integer,
    dias_com_ponto        integer,
    competencia_encerrada boolean,
    folhas_bloqueantes    text,
    pode_excluir          boolean,
    impedimento           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
-- CLAUDE.md armadilha 42: RETURNS TABLE declara variavel com o nome de cada coluna de saida, e
-- o corpo referencia colunas homonimas de outras tabelas. Resolver sempre para a coluna e o que
-- se quer aqui - o retorno e por RETURN QUERY, nenhum parametro de saida e lido como variavel.
#variable_conflict use_column
DECLARE
    v_vig    RECORD;
    v_dias   integer;
    v_ponto  integer;
    v_enc    boolean;
    v_folhas text;
    v_apos   text;
BEGIN
    SELECT t.*, s.nome AS s_nome, j.nome AS j_nome
      INTO v_vig
      FROM public.servidores_jornadas_temporarias t
      JOIN public.servidores s ON s.id = t.servidor_id
      LEFT JOIN public.jornadas j ON j.id = t.jornada_id
     WHERE t.id = p_vigencia_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Datas INCLUSIVAS nos dois extremos (obter_jornada_servidor_data usa >= e <=), entao um
    -- periodo de 29/09 a 29/09 e 1 dia. A tela exibia "0 dias" por faltar este +1.
    v_dias := (v_vig.data_fim - v_vig.data_inicio) + 1;

    -- Dias do periodo que ja tem ponto. escala_diaria nao tem servidor_id nem data: herda o
    -- servidor de escala_mensal e a data de (ano, mes, dia). Um servidor pode ter mais de uma
    -- escala_mensal na mesma competencia (dois setores), entao o DISTINCT e sobre a data.
    SELECT count(DISTINCT make_date(em.ano, em.mes, ed.dia))
      INTO v_ponto
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE em.servidor_id = v_vig.servidor_id
       AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_vig.data_inicio AND v_vig.data_fim
       AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL);

    -- As duas recusas duras olham SO as competencias que tem dia batido. Periodo sem ponto
    -- nenhum nao interessa a competencia nem a folha - nao ha julgamento a preservar.
    SELECT EXISTS (
        SELECT 1
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
         WHERE em.servidor_id = v_vig.servidor_id
           AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_vig.data_inicio AND v_vig.data_fim
           AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL)
           AND public.fn_competencia_encerrada(em.mes, em.ano)
    ) INTO v_enc;

    SELECT string_agg(DISTINCT x.rotulo, ', ')
      INTO v_folhas
      FROM (
        SELECT to_char(make_date(fp.ano, fp.mes, 1), 'MM/YYYY') || ' (' || fp.status || ')' AS rotulo
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
          JOIN public.folha_ponto fp ON fp.escala_mensal_id = em.id
         WHERE em.servidor_id = v_vig.servidor_id
           AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_vig.data_inicio AND v_vig.data_fim
           AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL)
           AND fp.status <> 'Rascunho'
      ) x;

    -- Para onde o previsto volta. E a jornada do MES de cada escala tocada - pode ser mais de
    -- uma quando o periodo atravessa competencias.
    SELECT string_agg(DISTINCT COALESCE(j.nome, '(sem jornada na escala)'), ', ')
      INTO v_apos
      FROM public.escala_mensal em
      LEFT JOIN public.jornadas j ON j.id = em.jornada_id
     WHERE em.servidor_id = v_vig.servidor_id
       AND make_date(em.ano, em.mes, 1)
           BETWEEN date_trunc('month', v_vig.data_inicio)::date
               AND date_trunc('month', v_vig.data_fim)::date;

    RETURN QUERY SELECT
        v_vig.s_nome::text,
        COALESCE(v_vig.j_nome, '(jornada removida)')::text,
        COALESCE(v_apos, '(sem escala no periodo)')::text,
        v_dias,
        COALESCE(v_ponto, 0),
        COALESCE(v_enc, false),
        v_folhas,
        NOT (COALESCE(v_enc, false) OR v_folhas IS NOT NULL),
        CASE
            WHEN COALESCE(v_enc, false)
                THEN 'Ha dia com ponto em competencia ENCERRADA neste periodo. Reabra a competencia em Configuracoes antes de remover.'
            WHEN v_folhas IS NOT NULL
                THEN 'Ha dia com ponto em folha ja fechada: ' || v_folhas || '. Reabra a folha antes de remover.'
            ELSE NULL
        END::text;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_vigencia_jornada_impacto(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_vigencia_jornada_impacto(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_vigencia_jornada_impacto(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_vigencia_jornada_impacto(uuid) IS
    'O que acontece se esta vigencia de jornada for removida: janela de -> para, dias no periodo, '
    'dias que ja tem ponto e as duas recusas duras. Devolve a JANELA e nao um delta de horas - '
    'em 97 dos 115 dias medidos em 10/09/2026 a carga era identica e so a janela deslocava.';


-- ============================================================================
-- 3. A exclusao, como ato registrado
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_excluir_vigencia_jornada(
    p_vigencia_id uuid,
    p_motivo      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_vig    RECORD;
    v_imp    RECORD;
    v_motivo text;
    v_dias   jsonb;
BEGIN
    v_motivo := btrim(COALESCE(p_motivo, ''));

    SELECT t.*, j.nome AS j_nome
      INTO v_vig
      FROM public.servidores_jornadas_temporarias t
      LEFT JOIN public.jornadas j ON j.id = t.jornada_id
     WHERE t.id = p_vigencia_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Alteracao de horario nao encontrada (ja foi removida?).';
    END IF;

    -- Fonte unica de quem pode gerir vigencia (20260828140000). SECURITY DEFINER passa por cima
    -- da RLS, entao a checagem tem que ser explicita aqui - a policy de DELETE nao vai rodar.
    IF NOT public.fn_pode_gerir_vigencia_jornada(v_vig.servidor_id) THEN
        RAISE EXCEPTION 'Voce nao tem permissao para remover a alteracao de horario deste servidor.';
    END IF;

    -- Apagar e mais grave que criar: o motivo aqui e o unico rastro que vai sobrar do que foi
    -- desfeito. Por isso 5 caracteres, e nao apenas "nao vazio" como na criacao - a base ja tem
    -- quatro vigencias cadastradas com o motivo ".".
    IF length(v_motivo) < 5 THEN
        RAISE EXCEPTION 'Informe o motivo da remocao (ao menos 5 caracteres). Ele fica registrado no historico do servidor.';
    END IF;

    SELECT * INTO v_imp FROM public.fn_vigencia_jornada_impacto(p_vigencia_id);

    IF NOT v_imp.pode_excluir THEN
        RAISE EXCEPTION '%', v_imp.impedimento;
    END IF;

    -- Os dias que ficam com o previsto diferente do que estava quando o ponto foi julgado.
    -- Devolvidos ao chamador para a tela dizer o que precisa ser conferido - a RPC NAO
    -- sincroniza nada (ver o cabecalho desta migration).
    SELECT COALESCE(jsonb_agg(DISTINCT to_char(q.d, 'DD/MM/YYYY')), '[]'::jsonb)
      INTO v_dias
      FROM (
        SELECT make_date(em.ano, em.mes, ed.dia) AS d
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
         WHERE em.servidor_id = v_vig.servidor_id
           AND make_date(em.ano, em.mes, ed.dia) BETWEEN v_vig.data_inicio AND v_vig.data_fim
           AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL)
      ) q;

    INSERT INTO public.servidores_jornadas_temporarias_historico (
        vigencia_id, servidor_id, jornada_id, jornada_nome, jornada_apos,
        data_inicio, data_fim, motivo_original, motivo_exclusao,
        dias_no_periodo, dias_com_ponto, excluido_por
    ) VALUES (
        v_vig.id, v_vig.servidor_id, v_vig.jornada_id, v_vig.j_nome, v_imp.jornada_apos,
        v_vig.data_inicio, v_vig.data_fim, v_vig.motivo, v_motivo,
        v_imp.dias_no_periodo, v_imp.dias_com_ponto, auth.uid()
    );

    -- GUC local a transacao (mesmo padrao de sisescala.fundir_setor e sisescala.mesclar_servidor):
    -- e ele que autoriza a trigger BEFORE DELETE abaixo.
    --
    -- E DESLIGADO LOGO DEPOIS, e isso nao e zelo: "local a transacao" quer dizer que ele fica
    -- ligado ate o fim DA TRANSACAO, nao ate o fim desta funcao. Medido no ensaio em homologacao
    -- (10/09/2026): com o GUC ligado, um DELETE cru na mesma transacao passava direto pela
    -- trigger. Hoje nao existe caminho na aplicacao que faca isso (cada RPC e uma transacao
    -- propria), mas a janela nao precisa existir - assim ela dura exatamente um statement.
    -- As funcoes irmas (fundir_setor, mesclar_servidor, reparse_afd) tem a mesma folga e nao
    -- foram tocadas aqui.
    PERFORM set_config('sisescala.excluir_vigencia', 'on', true);

    DELETE FROM public.servidores_jornadas_temporarias WHERE id = p_vigencia_id;

    PERFORM set_config('sisescala.excluir_vigencia', 'off', true);

    RETURN jsonb_build_object(
        'servidor_nome',   v_imp.servidor_nome,
        'jornada_atual',   v_imp.jornada_atual,
        'jornada_apos',    v_imp.jornada_apos,
        'dias_no_periodo', v_imp.dias_no_periodo,
        'dias_com_ponto',  v_imp.dias_com_ponto,
        'dias_a_revisar',  v_dias
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_excluir_vigencia_jornada(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_excluir_vigencia_jornada(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_excluir_vigencia_jornada(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_excluir_vigencia_jornada(uuid, text) IS
    'Unico caminho para remover vigencia de jornada. Exige motivo, grava historico append-only e '
    'recusa quando o periodo tem ponto em competencia encerrada ou em folha fora de Rascunho. '
    'NAO reconcilia nem sincroniza: devolve os dias afetados para uma pessoa decidir.';


-- ============================================================================
-- 4. A rede de seguranca: o DELETE cru deixa de existir
-- ============================================================================
-- Mesmo desenho de trg_registrar_troca_turno (20260821110000): trigger recusa, RPC carrega a
-- mensagem legivel. Sem isto, a policy de DELETE continuaria permitindo o caminho antigo pelo
-- PostgREST, e a tela corrigida nao protegeria quem chama a API direto (armadilha 12).
--
-- Nenhum caminho da aplicacao apaga linha de servidores (a mesclagem INATIVA), entao a cascata
-- da FK nao e um caso real. Se alguem apagar servidor na mao, o erro aqui e ALTO em vez de
-- silencioso - e a saida deliberada e a mesma GUC.

CREATE OR REPLACE FUNCTION public.trg_vigencia_jornada_exclusao_registrada()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF COALESCE(current_setting('sisescala.excluir_vigencia', true), '') <> 'on' THEN
        RAISE EXCEPTION 'Remover alteracao de horario exige motivo: use fn_excluir_vigencia_jornada. O DELETE direto nao deixa rastro do que foi desfeito.';
    END IF;
    RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_vigencia_jornada_exclusao_registrada
    ON public.servidores_jornadas_temporarias;
CREATE TRIGGER trg_vigencia_jornada_exclusao_registrada
    BEFORE DELETE ON public.servidores_jornadas_temporarias
    FOR EACH ROW EXECUTE FUNCTION public.trg_vigencia_jornada_exclusao_registrada();


-- ============================================================================
-- 5. Conferencia do proprio resultado - ABORTA se divergir
-- ============================================================================
-- CLAUDE.md armadilha 24: REVOKE de quem nao e dono emite WARNING e segue. Conferir por fora e
-- a unica forma de saber se aplicou de verdade.

DO $conf$
DECLARE
    v_abertas text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'public.servidores_jornadas_temporarias'::regclass
           AND tgname = 'trg_vigencia_jornada_exclusao_registrada'
    ) THEN
        RAISE EXCEPTION 'A trigger de exclusao registrada nao ficou instalada - o DELETE cru continua aberto.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'public.servidores_jornadas_temporarias_historico'::regclass
           AND tgname = 'trg_historico_vigencia_append_only'
    ) THEN
        RAISE EXCEPTION 'O historico ficou sem a trava de append-only.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'servidores_jornadas_temporarias_historico'
           AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'O historico ganhou policy de escrita - qualquer autenticado forjaria linha por ali.';
    END IF;

    SELECT string_agg(q.f, ', ') INTO v_abertas FROM (
        SELECT 'fn_vigencia_jornada_impacto' AS f
         WHERE has_function_privilege('anon', 'public.fn_vigencia_jornada_impacto(uuid)', 'EXECUTE')
        UNION ALL
        SELECT 'fn_excluir_vigencia_jornada'
         WHERE has_function_privilege('anon', 'public.fn_excluir_vigencia_jornada(uuid, text)', 'EXECUTE')
    ) q;
    IF v_abertas IS NOT NULL THEN
        RAISE EXCEPTION 'anon ainda executa: %. Banco %, usuario % - confira se voce e o dono das funcoes.',
            v_abertas, current_database(), current_user;
    END IF;

    -- O outro sentido: revogar demais derruba a ficha do servidor com a mesma discricao.
    IF NOT has_function_privilege('authenticated', 'public.fn_excluir_vigencia_jornada(uuid, text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.fn_vigencia_jornada_impacto(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated perdeu EXECUTE - a ficha do servidor nao consegue mais remover vigencia.';
    END IF;
END;
$conf$;

COMMIT;

-- ============================================================================
-- CONFERENCIA MANUAL (rodar depois de aplicar)
-- ============================================================================
-- 1) O DELETE cru tem que falhar:
--    DELETE FROM servidores_jornadas_temporarias WHERE id = '<uuid>';
--    -> ERROR: Remover alteracao de horario exige motivo...
--
-- 2) Quantas vigencias vivas cobrem dia com ponto (eram 38 de 69 em 10/09/2026):
--    SELECT count(*) FROM servidores_jornadas_temporarias t
--     WHERE EXISTS (SELECT 1 FROM escala_diaria ed
--                     JOIN escala_mensal em ON em.id = ed.escala_mensal_id
--                    WHERE em.servidor_id = t.servidor_id
--                      AND make_date(em.ano, em.mes, ed.dia) BETWEEN t.data_inicio AND t.data_fim
--                      AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL));
--
-- 3) O impacto de uma vigencia real, sem apagar nada:
--    SELECT * FROM fn_vigencia_jornada_impacto('<uuid>');
