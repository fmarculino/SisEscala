-- Migration: emitir, retificar e revogar o documento de apuracao do periodo
-- Data: 16/09/2026
-- Plano: docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md (Fase 3)
-- Depende de: 20260916110000 (o regime e a janela)
--
-- O QUE ISTO E
-- A Fase 1 deu o periodo; a Fase 2 deu a montagem (leitura pura). Aqui nasce o DOCUMENTO: um
-- snapshot append-only por versao, com autoria, que pode ser reimpresso identico meses depois e
-- retificado quando a folha muda.
--
-- 🚨 POR QUE SNAPSHOT E NAO VIEW: a folha e viva. A metade nova do periodo ainda recebe batida,
-- reconciliacao e decisao de compensacao. Se o documento fosse uma view, o PDF entregue em 21/09
-- e o mesmo PDF reimpresso em 05/10 poderiam divergir — e nenhum dos dois saberia dizer qual foi
-- entregue. Com snapshot, a divergencia posterior e DETECTADA (fingerprint) e resolvida por
-- RETIFICACAO, que e uma versao nova, nunca uma sobrescrita.
--
-- 🚨 POR QUE NAO CONGELAR A FOLHA: a tentacao e travar os dias <= 20 assim que a apuracao sai.
-- Esta descartado. E a mesma armadilha de preservar campo de origem `real` (19/08/2026), que
-- "parece conservador e e o oposto": congelar impede a folha de receber a correcao de uma batida
-- mal alocada, que e a coisa que mais aparece nesta base. O snapshot resolve sem congelar nada.
--
-- ⚠️ OS TOTAIS SAO CALCULADOS EM TYPESCRIPT, E ISSO E DELIBERADO (ver §4.7 e a Fase 2 do plano).
-- Eles dependem de calcularDia/totaisFolha — atraso, compensacao (Art. 7), autorizacao de extra
-- (Art. 8), abono, falta. Reimplementar aquilo aqui seria uma segunda opiniao sobre a mesma
-- pergunta, que e o que produziu as 37 mil horas de divergencia em 05/09/2026.
--
-- O que esta RPC faz, entao, e CONFERIR o payload contra o banco antes de gravar: a janela, a
-- contagem de dias do periodo e quantos deles tem linha na folha. Payload grosseiramente forjado
-- e recusado; e o que passar fica com autoria, versao e fingerprint, auditavel contra a folha.

-- ============================================================================
-- 1. O documento
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.folha_apuracoes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id         uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    -- Sem FK RESTRICT: aposentar um regime nao pode travar por causa de documento emitido.
    regime_id           uuid,
    regime_nome         text,
    dia_corte           smallint,
    competencia_mes     integer NOT NULL CHECK (competencia_mes BETWEEN 1 AND 12),
    competencia_ano     integer NOT NULL CHECK (competencia_ano >= 2000),
    periodo_inicio      date NOT NULL,
    periodo_fim         date NOT NULL,
    -- 1, 2, 3... Retificacao NUNCA sobrescreve: cria a versao seguinte.
    versao              smallint NOT NULL DEFAULT 1,
    -- O snapshot dos dias, exatamente como impresso.
    registros           jsonb NOT NULL,
    -- Totais em MINUTOS. `folha_ponto.total_horas_*` e NUMERIC(6,2), e de 0.18h nao se recupera
    -- 11 min — a folha ja aprendeu isso (v2.47.0).
    totais              jsonb NOT NULL,
    folhas_origem       uuid[] NOT NULL DEFAULT '{}',
    -- Para detectar depois que a folha mudou em relacao ao que foi emitido.
    fingerprint         text NOT NULL,
    -- O que o documento nao tinha na hora: metade sem folha, dia sem linha, decisao pendente.
    ressalvas           jsonb NOT NULL DEFAULT '[]',
    observacao          text,
    motivo_retificacao  text,
    emitido_por_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    emitido_em          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    revogado_em         timestamptz,
    revogado_por_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    revogado_motivo     text,
    CONSTRAINT chk_folha_apuracoes_periodo CHECK (periodo_inicio <= periodo_fim),
    CONSTRAINT chk_folha_apuracoes_versao CHECK (versao >= 1),
    CONSTRAINT uq_folha_apuracoes_versao
        UNIQUE (servidor_id, competencia_mes, competencia_ano, versao)
);

CREATE INDEX IF NOT EXISTS idx_folha_apuracoes_servidor_comp
    ON public.folha_apuracoes (servidor_id, competencia_ano DESC, competencia_mes DESC, versao DESC);

CREATE INDEX IF NOT EXISTS idx_folha_apuracoes_competencia
    ON public.folha_apuracoes (competencia_ano, competencia_mes);

ALTER TABLE public.folha_apuracoes ENABLE ROW LEVEL SECURITY;

-- Leitura pelo mesmo alcance de quem gere: a apuracao e documento de RH.
DROP POLICY IF EXISTS "Escopo de gestao ve apuracoes" ON public.folha_apuracoes;
CREATE POLICY "Escopo de gestao ve apuracoes"
    ON public.folha_apuracoes
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.servidores s
             WHERE s.id = folha_apuracoes.servidor_id
               AND public.fn_escopo_gestao_alcanca(s.unidade_id)
        )
    );

-- SEM policy de escrita: so as RPCs SECURITY DEFINER gravam. E o mesmo padrao de
-- escala_mensal_movimentos e folha_regime_vigencias — documento que alguem assina nao pode ser
-- forjado por um POST ao PostgREST.

-- 🚨 APPEND-ONLY, com UMA excecao estreita: revogar. Sem isso o documento seria editavel e
-- perderia a unica coisa que o torna util — ser identico ao que foi entregue.
CREATE OR REPLACE FUNCTION public.fn_apuracao_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'folha_apuracoes e append-only: DELETE nao e permitido. Para desfazer '
                        'uma emissao, revogue (fn_revogar_apuracao) — o documento continua no '
                        'historico, com o motivo.';
    END IF;

    -- A unica alteracao aceita e a revogacao, e ela nunca pode voltar atras nem mexer no
    -- conteudo. A comparacao e ESTRUTURAL (to_jsonb menos as tres colunas), nao uma lista de
    -- campos que envelhece: acrescentar coluna nova a tabela nao abre brecha aqui.
    IF to_jsonb(NEW) - 'revogado_em' - 'revogado_por_id' - 'revogado_motivo'
       IS DISTINCT FROM
       to_jsonb(OLD) - 'revogado_em' - 'revogado_por_id' - 'revogado_motivo' THEN
        RAISE EXCEPTION 'folha_apuracoes e append-only: so a revogacao pode ser gravada depois '
                        'da emissao. Para corrigir numeros, retifique (fn_retificar_apuracao).';
    END IF;

    IF OLD.revogado_em IS NOT NULL THEN
        RAISE EXCEPTION 'Esta apuracao ja foi revogada em % — revogacao nao se desfaz.',
            to_char(OLD.revogado_em, 'DD/MM/YYYY HH24:MI');
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_apuracao_append_only ON public.folha_apuracoes;
CREATE TRIGGER trg_apuracao_append_only
    BEFORE UPDATE OR DELETE ON public.folha_apuracoes
    FOR EACH ROW EXECUTE FUNCTION public.fn_apuracao_append_only();


-- ============================================================================
-- 2. Quem pode emitir
-- ============================================================================
-- Emitir documento de apuracao e ato de RH, como reabrir folha (04/09/2026): allowlist de papel,
-- e nao denylist. Coordenador e ass_adm ficam de fora — quem lanca a escala nao emite o
-- documento que vai para o pagamento.
--
-- ⚠️ `admin` (Diretor) entra COM escopo, nunca irrestrito: fn_escopo_gestao_alcanca e irrestrito
-- para ele (armadilha 62), entao o escopo por unidade precisa ser exigido aqui por cima — a mesma
-- correcao que a 20260903110000 fez para a autorizacao de carga.

CREATE OR REPLACE FUNCTION public.fn_pode_emitir_apuracao(p_servidor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_papel   text;
    v_unidade uuid;
BEGIN
    v_papel := public.get_my_role()::text;

    IF v_papel IS NULL OR v_papel NOT IN ('super_admin', 'rh', 'rh_unidade', 'admin') THEN
        RETURN false;
    END IF;

    IF v_papel IN ('super_admin', 'rh') THEN
        RETURN true;
    END IF;

    SELECT s.unidade_id INTO v_unidade FROM public.servidores s WHERE s.id = p_servidor_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    RETURN public.fn_escopo_gestao_alcanca(v_unidade);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_pode_emitir_apuracao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pode_emitir_apuracao(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_pode_emitir_apuracao(uuid) IS
    'Este perfil pode emitir/retificar/revogar apuracao deste servidor? super_admin e rh '
    'irrestritos; admin (Diretor) e rh_unidade apenas no escopo de unidade; coordenador e '
    'ass_adm nunca. Allowlist de proposito: emitir o documento que vai ao pagamento e ato de '
    'autoridade, nao de visibilidade (mesmo critetio de podeReabrirFolha).';


-- ============================================================================
-- 3. A conferencia do payload contra o banco
-- ============================================================================
-- O que o SQL sabe conferir sem duplicar calcularDia: a janela, o total de dias do periodo e
-- quantos deles tem linha na folha. Devolve o que ACHOU, para a RPC comparar.

CREATE OR REPLACE FUNCTION public.fn_apuracao_conferencia(
    p_servidor_id uuid,
    p_inicio      date,
    p_fim         date
)
RETURNS TABLE (
    dias_no_periodo     integer,
    dias_com_linha      integer,
    folhas              uuid[],
    competencias        text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH linhas AS (
        SELECT f.id AS folha_id,
               f.mes, f.ano,
               make_date(f.ano, f.mes, (r.item->>'dia')::integer) AS data_dia
          FROM public.folha_ponto f
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.registros, '[]'::jsonb)) AS r(item)
         WHERE f.servidor_id = p_servidor_id
           AND (r.item->>'dia') ~ '^[0-9]+$'
           AND (r.item->>'dia')::integer BETWEEN 1 AND 31
           -- O dia tem de existir no mes: dia 31 em fevereiro nao vira data.
           AND (r.item->>'dia')::integer
               <= extract(day from (make_date(f.ano, f.mes, 1) + interval '1 month - 1 day'))
    )
    SELECT (p_fim - p_inicio + 1)::integer,
           (SELECT count(*)::integer FROM linhas l
             WHERE l.data_dia BETWEEN p_inicio AND p_fim),
           COALESCE((SELECT array_agg(DISTINCT l.folha_id) FROM linhas l
                      WHERE l.data_dia BETWEEN p_inicio AND p_fim), '{}'::uuid[]),
           COALESCE((SELECT array_agg(DISTINCT to_char(l.data_dia, 'YYYY-MM')) FROM linhas l
                      WHERE l.data_dia BETWEEN p_inicio AND p_fim), '{}'::text[]);
$fn$;

REVOKE ALL ON FUNCTION public.fn_apuracao_conferencia(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_apuracao_conferencia(uuid, date, date)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_apuracao_conferencia(uuid, date, date) IS
    'O que o banco ve no periodo: total de dias, dias com linha na folha, folhas de origem e '
    'competencias. Serve para fn_emitir_apuracao recusar payload que nao corresponde a folha — '
    'sem duplicar calcularDia, que e a fonte unica do calculo do dia e vive no TypeScript.';


-- ============================================================================
-- 4. Emitir
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_emitir_apuracao(
    p_servidor_id    uuid,
    p_mes            integer,
    p_ano            integer,
    p_registros      jsonb,
    p_totais         jsonb,
    p_dias_com_linha integer,
    p_fingerprint    text,
    p_ressalvas      jsonb DEFAULT '[]'::jsonb,
    p_observacao     text DEFAULT NULL,
    p_confirmado     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_regime_id   uuid;
    v_regime      public.folha_regimes;
    v_inicio      date;
    v_fim         date;
    v_conf        record;
    v_versao      smallint;
    v_id          uuid;
    v_ressalvas   integer;
BEGIN
    IF NOT public.fn_pode_emitir_apuracao(p_servidor_id) THEN
        RAISE EXCEPTION 'Sem permissao para emitir a apuracao deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_fingerprint IS NULL OR length(btrim(p_fingerprint)) = 0 THEN
        RAISE EXCEPTION 'A apuracao precisa do fingerprint para que a divergencia posterior '
                        'possa ser detectada.';
    END IF;
    IF p_registros IS NULL OR jsonb_typeof(p_registros) <> 'array'
       OR jsonb_array_length(p_registros) = 0 THEN
        RAISE EXCEPTION 'A apuracao precisa dos dias do periodo.';
    END IF;
    IF p_totais IS NULL OR jsonb_typeof(p_totais) <> 'object' THEN
        RAISE EXCEPTION 'A apuracao precisa dos totais.';
    END IF;

    -- A janela vem do BANCO, nunca do payload: e o unico jeito de o documento nao poder nomear
    -- um periodo diferente do que o regime do servidor determina.
    SELECT p.regime_id, p.inicio, p.fim INTO v_regime_id, v_inicio, v_fim
      FROM public.fn_periodo_apuracao_servidor(p_servidor_id, p_mes, p_ano) p;

    IF v_inicio IS NULL THEN
        RAISE EXCEPTION 'Nao foi possivel resolver o periodo de apuracao de %/%.', p_mes, p_ano;
    END IF;

    SELECT * INTO v_regime FROM public.folha_regimes WHERE id = v_regime_id;

    -- O payload tem de cobrir exatamente os dias do periodo.
    SELECT * INTO v_conf FROM public.fn_apuracao_conferencia(p_servidor_id, v_inicio, v_fim);

    IF jsonb_array_length(p_registros) <> v_conf.dias_no_periodo THEN
        RAISE EXCEPTION 'A apuracao trouxe % dia(s) e o periodo % a % tem %. O documento nao '
                        'corresponde ao periodo.',
            jsonb_array_length(p_registros), to_char(v_inicio, 'DD/MM/YYYY'),
            to_char(v_fim, 'DD/MM/YYYY'), v_conf.dias_no_periodo;
    END IF;

    -- 🚨 A defesa contra payload forjado: a contagem de dias com linha na folha e conferida
    -- contra o banco. Os totais vem do TypeScript (calcularDia e a fonte unica), mas um documento
    -- que afirma 20 dias trabalhados onde a folha tem 5 e recusado aqui.
    IF p_dias_com_linha IS DISTINCT FROM v_conf.dias_com_linha THEN
        RAISE EXCEPTION 'A apuracao afirma % dia(s) com lancamento e a folha tem %. Sincronize a '
                        'folha e monte a previa de novo antes de emitir.',
            p_dias_com_linha, v_conf.dias_com_linha;
    END IF;

    -- Ressalva (metade sem folha, dia sem linha, decisao pendente) exige confirmacao explicita —
    -- do mesmo jeito que salvarFolhaPonto cobra no fechamento. O documento pode sair com
    -- ressalva; o que ele nao pode e sair SEM ninguem ter visto que ela existe.
    v_ressalvas := CASE WHEN p_ressalvas IS NULL OR jsonb_typeof(p_ressalvas) <> 'array'
                        THEN 0 ELSE jsonb_array_length(p_ressalvas) END;
    IF v_ressalvas > 0 AND NOT p_confirmado THEN
        RAISE EXCEPTION 'Esta apuracao tem % ressalva(s) e exige confirmacao explicita antes de '
                        'ser emitida.', v_ressalvas;
    END IF;

    -- Uma emissao por competencia; a segunda e RETIFICACAO, com motivo.
    SELECT max(a.versao) INTO v_versao
      FROM public.folha_apuracoes a
     WHERE a.servidor_id = p_servidor_id
       AND a.competencia_mes = p_mes AND a.competencia_ano = p_ano;

    IF v_versao IS NOT NULL THEN
        RAISE EXCEPTION 'Ja existe apuracao de %/% para este servidor (versao %). Use retificar '
                        'para emitir uma versao nova, com o motivo.', p_mes, p_ano, v_versao;
    END IF;

    INSERT INTO public.folha_apuracoes (
        servidor_id, regime_id, regime_nome, dia_corte,
        competencia_mes, competencia_ano, periodo_inicio, periodo_fim,
        versao, registros, totais, folhas_origem, fingerprint, ressalvas, observacao,
        emitido_por_id
    ) VALUES (
        p_servidor_id, v_regime_id, v_regime.nome, v_regime.dia_corte,
        p_mes, p_ano, v_inicio, v_fim,
        1, p_registros, p_totais, v_conf.folhas, btrim(p_fingerprint),
        COALESCE(p_ressalvas, '[]'::jsonb), nullif(btrim(coalesce(p_observacao, '')), ''),
        auth.uid()
    ) RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'status', 'emitida',
        'apuracao_id', v_id,
        'versao', 1,
        'periodo_inicio', v_inicio,
        'periodo_fim', v_fim,
        'regime_nome', v_regime.nome,
        'dias_no_periodo', v_conf.dias_no_periodo,
        'dias_com_linha', v_conf.dias_com_linha,
        'folhas_origem', v_conf.folhas,
        'competencias', v_conf.competencias,
        'ressalvas', v_ressalvas
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_emitir_apuracao(
    uuid, integer, integer, jsonb, jsonb, integer, text, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_emitir_apuracao(
    uuid, integer, integer, jsonb, jsonb, integer, text, jsonb, text, boolean)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_emitir_apuracao(
    uuid, integer, integer, jsonb, jsonb, integer, text, jsonb, text, boolean) IS
    'Grava o documento de apuracao do periodo (versao 1). A JANELA vem do banco, nunca do '
    'payload; a contagem de dias e de dias com linha na folha e CONFERIDA contra o banco; '
    'ressalva exige p_confirmado. Os totais vem do TypeScript de proposito (calcularDia e fonte '
    'unica). Segunda emissao da mesma competencia e recusada — use fn_retificar_apuracao.';


-- ============================================================================
-- 5. Retificar -- versao nova, nunca sobrescrita
-- ============================================================================
-- E o caminho quando a folha muda depois da emissao. E o que a Portaria 4.198/2022 art. 101-B II
-- descreve: devolucao de desconto justificada depois do dia 20.

CREATE OR REPLACE FUNCTION public.fn_retificar_apuracao(
    p_apuracao_id    uuid,
    p_registros      jsonb,
    p_totais         jsonb,
    p_dias_com_linha integer,
    p_fingerprint    text,
    p_motivo         text,
    p_ressalvas      jsonb DEFAULT '[]'::jsonb,
    p_confirmado     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_ant       public.folha_apuracoes;
    v_conf      record;
    v_versao    smallint;
    v_id        uuid;
    v_ressalvas integer;
BEGIN
    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 10 THEN
        RAISE EXCEPTION 'Informe o motivo da retificacao (ao menos 10 caracteres). O documento '
                        'anterior continua valendo no historico, e a diferenca precisa estar '
                        'explicada.';
    END IF;

    SELECT * INTO v_ant FROM public.folha_apuracoes WHERE id = p_apuracao_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Apuracao nao encontrada.';
    END IF;

    IF NOT public.fn_pode_emitir_apuracao(v_ant.servidor_id) THEN
        RAISE EXCEPTION 'Sem permissao para retificar a apuracao deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- A janela e SEMPRE a da apuracao anterior: retificar e refazer o MESMO periodo. Se o regime
    -- mudou no meio, isso e periodo diferente, e a competencia seguinte cuida dele.
    SELECT * INTO v_conf FROM public.fn_apuracao_conferencia(
        v_ant.servidor_id, v_ant.periodo_inicio, v_ant.periodo_fim);

    IF jsonb_array_length(p_registros) <> v_conf.dias_no_periodo THEN
        RAISE EXCEPTION 'A retificacao trouxe % dia(s) e o periodo tem %.',
            jsonb_array_length(p_registros), v_conf.dias_no_periodo;
    END IF;
    IF p_dias_com_linha IS DISTINCT FROM v_conf.dias_com_linha THEN
        RAISE EXCEPTION 'A retificacao afirma % dia(s) com lancamento e a folha tem %.',
            p_dias_com_linha, v_conf.dias_com_linha;
    END IF;

    v_ressalvas := CASE WHEN p_ressalvas IS NULL OR jsonb_typeof(p_ressalvas) <> 'array'
                        THEN 0 ELSE jsonb_array_length(p_ressalvas) END;
    IF v_ressalvas > 0 AND NOT p_confirmado THEN
        RAISE EXCEPTION 'Esta retificacao tem % ressalva(s) e exige confirmacao explicita.',
            v_ressalvas;
    END IF;

    SELECT max(a.versao) + 1 INTO v_versao
      FROM public.folha_apuracoes a
     WHERE a.servidor_id = v_ant.servidor_id
       AND a.competencia_mes = v_ant.competencia_mes
       AND a.competencia_ano = v_ant.competencia_ano;

    INSERT INTO public.folha_apuracoes (
        servidor_id, regime_id, regime_nome, dia_corte,
        competencia_mes, competencia_ano, periodo_inicio, periodo_fim,
        versao, registros, totais, folhas_origem, fingerprint, ressalvas,
        observacao, motivo_retificacao, emitido_por_id
    ) VALUES (
        v_ant.servidor_id, v_ant.regime_id, v_ant.regime_nome, v_ant.dia_corte,
        v_ant.competencia_mes, v_ant.competencia_ano, v_ant.periodo_inicio, v_ant.periodo_fim,
        v_versao, p_registros, p_totais, v_conf.folhas, btrim(p_fingerprint),
        COALESCE(p_ressalvas, '[]'::jsonb), v_ant.observacao, btrim(p_motivo), auth.uid()
    ) RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'status', 'retificada',
        'apuracao_id', v_id,
        'versao', v_versao,
        'versao_anterior', v_ant.versao,
        'apuracao_anterior_id', v_ant.id,
        'periodo_inicio', v_ant.periodo_inicio,
        'periodo_fim', v_ant.periodo_fim,
        'fingerprint_anterior', v_ant.fingerprint,
        'fingerprint_novo', btrim(p_fingerprint),
        'mudou', v_ant.fingerprint IS DISTINCT FROM btrim(p_fingerprint)
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_retificar_apuracao(
    uuid, jsonb, jsonb, integer, text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_retificar_apuracao(
    uuid, jsonb, jsonb, integer, text, text, jsonb, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_retificar_apuracao(
    uuid, jsonb, jsonb, integer, text, text, jsonb, boolean) IS
    'Emite a versao seguinte da mesma competencia, com motivo escrito de ao menos 10 caracteres. '
    'A janela e a da apuracao anterior — retificar e refazer o MESMO periodo. A versao anterior '
    'continua no historico (append-only); e ela que prova o que foi entregue antes.';


-- ============================================================================
-- 6. Revogar
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_revogar_apuracao(
    p_apuracao_id uuid,
    p_motivo      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_ap public.folha_apuracoes;
BEGIN
    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 10 THEN
        RAISE EXCEPTION 'Informe o motivo da revogacao (ao menos 10 caracteres).';
    END IF;

    SELECT * INTO v_ap FROM public.folha_apuracoes WHERE id = p_apuracao_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Apuracao nao encontrada.';
    END IF;
    IF NOT public.fn_pode_emitir_apuracao(v_ap.servidor_id) THEN
        RAISE EXCEPTION 'Sem permissao para revogar a apuracao deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ap.revogado_em IS NOT NULL THEN
        RAISE EXCEPTION 'Esta apuracao ja foi revogada em %.',
            to_char(v_ap.revogado_em, 'DD/MM/YYYY HH24:MI');
    END IF;

    UPDATE public.folha_apuracoes
       SET revogado_em = timezone('utc'::text, now()),
           revogado_por_id = auth.uid(),
           revogado_motivo = btrim(p_motivo)
     WHERE id = p_apuracao_id;

    RETURN jsonb_build_object(
        'status', 'revogada',
        'apuracao_id', p_apuracao_id,
        'versao', v_ap.versao,
        'competencia', to_char(make_date(v_ap.competencia_ano, v_ap.competencia_mes, 1), 'MM/YYYY')
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_revogar_apuracao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revogar_apuracao(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_revogar_apuracao(uuid, text) IS
    'Marca a apuracao como revogada, com motivo. O documento NAO e apagado: revogado continua no '
    'historico, porque ele pode ter sido entregue. Revogacao nao se desfaz (o trigger recusa).';


-- ============================================================================
-- 7. Listagem para a tela
-- ============================================================================
-- ⚠️ NAO devolve `registros` (o snapshot inteiro): a lista mostra dezenas de linhas e o snapshot
-- tem 31 dias cada. Quem quer o documento busca uma apuracao pelo id.

CREATE OR REPLACE FUNCTION public.fn_apuracoes_competencia(
    p_mes        integer,
    p_ano        integer,
    p_unidade_id uuid DEFAULT NULL
)
RETURNS TABLE (
    apuracao_id      uuid,
    servidor_id      uuid,
    servidor_nome    text,
    matricula        text,
    unidade_nome     text,
    regime_nome      text,
    periodo_inicio   date,
    periodo_fim      date,
    versao           smallint,
    totais           jsonb,
    ressalvas        jsonb,
    fingerprint      text,
    emitido_em       timestamptz,
    emitido_por      text,
    revogado_em      timestamptz,
    e_ultima_versao  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT a.id, a.servidor_id, s.nome, s.matricula, u.nome,
           a.regime_nome, a.periodo_inicio, a.periodo_fim, a.versao,
           a.totais, a.ressalvas, a.fingerprint, a.emitido_em,
           -- `profiles` NAO tem coluna de e-mail (conferido em 16/09/2026): o e-mail vive em
           -- auth.users, e nome de coluna inexistente so estoura na EXECUCAO (armadilha 1).
           COALESCE(p.full_name, '(sem nome)'),
           a.revogado_em,
           a.versao = (SELECT max(b.versao) FROM public.folha_apuracoes b
                        WHERE b.servidor_id = a.servidor_id
                          AND b.competencia_mes = a.competencia_mes
                          AND b.competencia_ano = a.competencia_ano)
      FROM public.folha_apuracoes a
      JOIN public.servidores s ON s.id = a.servidor_id
      LEFT JOIN public.unidades u ON u.id = s.unidade_id
      LEFT JOIN public.profiles p ON p.id = a.emitido_por_id
     WHERE a.competencia_mes = p_mes
       AND a.competencia_ano = p_ano
       AND (p_unidade_id IS NULL OR s.unidade_id = p_unidade_id)
       AND public.fn_escopo_gestao_alcanca(s.unidade_id)
     ORDER BY u.nome NULLS LAST, s.nome, a.versao DESC;
$fn$;

REVOKE ALL ON FUNCTION public.fn_apuracoes_competencia(integer, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_apuracoes_competencia(integer, integer, uuid)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_apuracoes_competencia(integer, integer, uuid) IS
    'As apuracoes emitidas de uma competencia, no escopo de gestao de quem consulta. Nao devolve '
    'o snapshot dos dias — a lista tem dezenas de linhas e cada snapshot tem 31 dias.';


-- ============================================================================
-- 8. Conferencia -- EXECUTA as funcoes (CLAUDE.md armadilha 42)
-- ============================================================================

DO $conf$
DECLARE
    v_srv     uuid;
    v_conf    record;
    v_abertas text;
    v_ok      boolean;
BEGIN
    -- 1. a tabela nasceu append-only e sem policy de escrita
    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'folha_apuracoes' AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'folha_apuracoes ganhou policy de escrita — o documento seria forjavel '
                        'por um POST ao PostgREST.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'public.folha_apuracoes'::regclass
           AND tgname = 'trg_apuracao_append_only'
    ) THEN
        RAISE EXCEPTION 'folha_apuracoes ficou sem a trava de append-only.';
    END IF;

    -- 2. a conferencia do payload EXECUTA e devolve numero coerente
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' LIMIT 1;
    IF v_srv IS NOT NULL THEN
        SELECT * INTO v_conf
          FROM public.fn_apuracao_conferencia(v_srv, DATE '2026-08-21', DATE '2026-09-20');
        IF v_conf.dias_no_periodo <> 31 THEN
            RAISE EXCEPTION 'fn_apuracao_conferencia contou % dias em 21/08 a 20/09; esperado 31.',
                v_conf.dias_no_periodo;
        END IF;
        IF v_conf.dias_com_linha IS NULL OR v_conf.dias_com_linha < 0 THEN
            RAISE EXCEPTION 'fn_apuracao_conferencia devolveu dias_com_linha invalido: %.',
                v_conf.dias_com_linha;
        END IF;

        -- Mes civil: 30 dias em setembro.
        SELECT * INTO v_conf
          FROM public.fn_apuracao_conferencia(v_srv, DATE '2026-09-01', DATE '2026-09-30');
        IF v_conf.dias_no_periodo <> 30 THEN
            RAISE EXCEPTION 'fn_apuracao_conferencia contou % dias em setembro; esperado 30.',
                v_conf.dias_no_periodo;
        END IF;

        -- 3. o guard de papel: sem sessao (service_role) NAO pode emitir. E o outro sentido do
        -- que importa aqui — quem emite documento de pagamento tem de estar logado.
        v_ok := public.fn_pode_emitir_apuracao(v_srv);
        IF v_ok THEN
            RAISE EXCEPTION 'fn_pode_emitir_apuracao devolveu TRUE sem papel nenhum (rodando '
                            'como %). Qualquer rota de maquina emitiria documento.', current_user;
        END IF;
    END IF;

    -- 4. anon nao executa nenhuma das seis
    SELECT string_agg(q.f, ', ') INTO v_abertas FROM (
        SELECT 'fn_pode_emitir_apuracao' AS f
         WHERE has_function_privilege('anon', 'public.fn_pode_emitir_apuracao(uuid)', 'EXECUTE')
        UNION ALL SELECT 'fn_apuracao_conferencia'
         WHERE has_function_privilege('anon', 'public.fn_apuracao_conferencia(uuid, date, date)', 'EXECUTE')
        UNION ALL SELECT 'fn_emitir_apuracao'
         WHERE has_function_privilege('anon', 'public.fn_emitir_apuracao(uuid, integer, integer, jsonb, jsonb, integer, text, jsonb, text, boolean)', 'EXECUTE')
        UNION ALL SELECT 'fn_retificar_apuracao'
         WHERE has_function_privilege('anon', 'public.fn_retificar_apuracao(uuid, jsonb, jsonb, integer, text, text, jsonb, boolean)', 'EXECUTE')
        UNION ALL SELECT 'fn_revogar_apuracao'
         WHERE has_function_privilege('anon', 'public.fn_revogar_apuracao(uuid, text)', 'EXECUTE')
        UNION ALL SELECT 'fn_apuracoes_competencia'
         WHERE has_function_privilege('anon', 'public.fn_apuracoes_competencia(integer, integer, uuid)', 'EXECUTE')
    ) q;
    IF v_abertas IS NOT NULL THEN
        RAISE EXCEPTION 'anon ainda executa: %. Banco %, usuario % — confira se voce e o dono.',
            v_abertas, current_database(), current_user;
    END IF;

    -- 5. e o outro sentido: authenticated precisa continuar alcancando a tela
    IF NOT has_function_privilege('authenticated', 'public.fn_apuracoes_competencia(integer, integer, uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.fn_pode_emitir_apuracao(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated perdeu EXECUTE — a tela de apuracoes nao abriria.';
    END IF;

    RAISE NOTICE 'Apuracao do periodo: 5 conferencias OK (append-only, sem policy de escrita, '
                 'conferencia do payload executada, guard de papel sem sessao, anon e authenticated).';
END;
$conf$;


-- ============================================================================
-- 9. Conferencia de dados, para rodar por fora depois de aplicar
-- ============================================================================
-- -- 9.1 nenhuma apuracao emitida ainda (a migration nao emite nada)
-- SELECT count(*) FROM public.folha_apuracoes;
--
-- -- 9.2 o append-only recusa UPDATE de conteudo (deve dar erro)
-- --     UPDATE public.folha_apuracoes SET totais = '{}'::jsonb WHERE id = '<id>';
--
-- -- 9.3 o que o banco ve no periodo dos 4 medicos (sem emitir nada)
-- SELECT s.matricula, c.*
--   FROM public.servidores s
--   JOIN LATERAL public.fn_apuracao_conferencia(s.id, DATE '2026-08-21', DATE '2026-09-20') c ON true
--  WHERE s.setor_id = 'a465e8bd-c455-440b-840b-b94483a13d2a'
--  ORDER BY s.matricula;
