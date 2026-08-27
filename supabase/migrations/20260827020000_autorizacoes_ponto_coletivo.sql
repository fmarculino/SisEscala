-- ============================================================================
-- AUTORIZACAO DO RH PARA VALIDACAO COLETIVA DE PASSOS DE PONTO
-- ============================================================================
-- 27/08/2026 - plano em docs/planos/2026-08-27-dispensa-de-registro-de-ponto.md
--
-- O CASO
--   Oficio 249/2026/SMS-PRO-ESP (Processo 050505164.000160/2026-10): os 7 tecnicos do Programa
--   Porta a Porta comecam a jornada as 04h30/06h00 sendo buscados em casa pelo motorista, e vao
--   direto ao atendimento - passar na sede da SMS so' para registrar a entrada e' inviavel. O
--   oficio pede dispensa da ENTRADA e mantem, por escrito, a obrigatoriedade da SAIDA.
--
-- O QUE ISTO E' - E O QUE NAO E'
--   NAO e' marcacao automatica pelo sistema (vedacao 2 da Portaria 671/2021). E' o coordenador
--   DECLARANDO a jornada, com justificativa, exatamente como a validacao manual ja' faz hoje:
--   origem `ajuste_coordenador`, `sintetica = true`, e a folha rotula como manual, nunca como
--   batida. O que esta migration acrescenta e' a AUTORIZACAO previa do RH como pre-condicao, e
--   um modo que declara so' os passos autorizados - deixando a saida vir do relogio.
--
--   A validacao coletiva em si ja' existia: fn_atestar_jornada_bulk (20260808120000) ja' aceita
--   varios servidores, varios dias e uma justificativa unica. O que faltava era (a) autorizacao
--   e (b) um modo que nao carimbasse a saida.
--
-- POR QUE A CHECAGEM VIVE NO BANCO
--   fn_atestar_jornada_bulk e' GRANTada a `authenticated` e chamavel direto (armadilha 12 do
--   CLAUDE.md: tela filtrada nao protege RPC). Autorizacao conferida so' no modal seria
--   decoracao.
--
-- ESTADO MEDIDO EM PRODUCAO (27/08/2026)
--   Setor SMS -> PORTA A PORTA: 10 servidores ativos, 10 escalas mensais de 08/2026 todas em
--   Rascunho, ZERO dias lancados e ZERO marcacoes. O grupo ainda nao entrou no fluxo de ponto.
--   No sistema inteiro, 08/2026: 18.041 marcacoes `ajuste_coordenador` em 6.176 pares
--   (servidor, dia) de 537 servidores - o volume que a validacao coletiva ja' atende.
-- ============================================================================


-- ============================================================================
-- 1. A AUTORIZACAO
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.autorizacoes_ponto_coletivo (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- NOMINAL de proposito: o oficio autoriza pessoas, nao setores. Guardar por setor faria
    -- servidor novo herdar dispensa que ninguem autorizou para ele.
    servidor_id         uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,

    -- Quais passos o coordenador pode DECLARAR em massa para este servidor.
    -- 'saida' nao entra: e' o registro que o proprio oficio preserva e o minimo que sustenta a
    -- folha como prova (Sumula 338 do TST). Ver o CHECK abaixo.
    passos              text[] NOT NULL,

    vigencia_inicio     date NOT NULL,
    -- Obrigatoria: dispensa sem prazo vira permanente e ninguem revisa. Teto de 12 meses,
    -- renovavel por ato novo - e' o que costuma ser cobrado em fiscalizacao.
    vigencia_fim        date NOT NULL,

    documento           text NOT NULL,   -- numero do oficio/processo
    motivo              text NOT NULL,   -- vira o texto padrao da justificativa

    autorizado_por_id   uuid REFERENCES auth.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- Revoga-se, nunca se apaga: e' ato administrativo, e um mes ja' fechado precisa poder ser
    -- reconstruido com o que valia na epoca.
    revogado_em         timestamptz,
    revogado_por_id     uuid REFERENCES auth.users(id),
    revogacao_motivo    text,

    CONSTRAINT chk_apc_passos_validos CHECK (
        array_length(passos, 1) >= 1
        AND passos <@ ARRAY['entrada', 'intervalo_saida', 'intervalo_retorno']::text[]
    ),
    CONSTRAINT chk_apc_vigencia CHECK (vigencia_fim >= vigencia_inicio),
    CONSTRAINT chk_apc_vigencia_maxima CHECK (vigencia_fim <= vigencia_inicio + interval '12 months'),
    CONSTRAINT chk_apc_revogacao CHECK (
        (revogado_em IS NULL AND revogado_por_id IS NULL)
        OR (revogado_em IS NOT NULL AND revogacao_motivo IS NOT NULL)
    )
);

COMMENT ON TABLE public.autorizacoes_ponto_coletivo IS
    'Autorizacao do RH Geral para o coordenador DECLARAR em massa passos de ponto de um servidor '
    '(Oficio/processo obrigatorio). Nao dispensa a batida de saida e nao gera marcacao sozinha.';
COMMENT ON COLUMN public.autorizacoes_ponto_coletivo.passos IS
    'Passos declaraveis: entrada, intervalo_saida, intervalo_retorno. NUNCA saida.';
COMMENT ON COLUMN public.autorizacoes_ponto_coletivo.documento IS
    'Numero do oficio/processo que autoriza. E o que a fiscalizacao pede - por isso obrigatorio.';

CREATE INDEX IF NOT EXISTS idx_apc_servidor_vigencia
    ON public.autorizacoes_ponto_coletivo (servidor_id, vigencia_inicio, vigencia_fim)
    WHERE revogado_em IS NULL;


-- Duas autorizacoes vigentes sobrepostas para o mesmo servidor tornariam indeterminado qual
-- documento vale naquele dia - e o documento e' justamente o que responde a fiscalizacao.
-- Trigger em vez de EXCLUDE ... USING gist para nao depender da extensao btree_gist.
CREATE OR REPLACE FUNCTION public.fn_apc_sem_sobreposicao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
    IF NEW.revogado_em IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.autorizacoes_ponto_coletivo a
         WHERE a.servidor_id = NEW.servidor_id
           AND a.id <> NEW.id
           AND a.revogado_em IS NULL
           AND daterange(a.vigencia_inicio, a.vigencia_fim, '[]')
            && daterange(NEW.vigencia_inicio, NEW.vigencia_fim, '[]')
    ) THEN
        RAISE EXCEPTION
            'Ja existe autorizacao vigente para este servidor no periodo informado. Revogue a '
            'anterior antes de conceder outra.'
            USING ERRCODE = 'unique_violation';
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_apc_sem_sobreposicao ON public.autorizacoes_ponto_coletivo;
CREATE TRIGGER trg_apc_sem_sobreposicao
    BEFORE INSERT OR UPDATE ON public.autorizacoes_ponto_coletivo
    FOR EACH ROW EXECUTE FUNCTION public.fn_apc_sem_sobreposicao();


-- ============================================================================
-- 2. RLS - leitura para quem opera a escala, escrita SO' pelas funcoes
-- ============================================================================
ALTER TABLE public.autorizacoes_ponto_coletivo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura de autorizacoes de ponto" ON public.autorizacoes_ponto_coletivo;
CREATE POLICY "Leitura de autorizacoes de ponto" ON public.autorizacoes_ponto_coletivo
    FOR SELECT TO authenticated
    USING ((SELECT public.get_my_role()) NOT IN ('servidor'::public.user_role, 'comum'::public.user_role));

-- Nenhuma policy de INSERT/UPDATE/DELETE: escrita passa obrigatoriamente pelas funcoes
-- SECURITY DEFINER abaixo, que e' onde a regra de papel vive. Mesmo padrao de
-- logs_tentativas_presenca (20260807130000).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.autorizacoes_ponto_coletivo FROM anon, authenticated;


-- ============================================================================
-- 3. CONCEDER / REVOGAR - exclusivo do RH Geral e do Administrador Geral
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_conceder_autorizacao_ponto_coletivo(
    p_servidor_ids    uuid[],
    p_passos          text[],
    p_vigencia_inicio date,
    p_vigencia_fim    date,
    p_documento       text,
    p_motivo          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role      public.user_role;
    v_servidor  uuid;
    v_criadas   integer := 0;
    v_erros     jsonb := '[]'::jsonb;
    v_nome      text;
BEGIN
    v_role := (SELECT public.get_my_role());

    -- "Isso tem que ser expressamente liberado pelo RH Geral" - decisao do usuario, 27/08/2026.
    -- Coordenador, Diretor e RH da Unidade NAO concedem: o oficio e' endereçado a RH central.
    IF v_role NOT IN ('rh'::public.user_role, 'super_admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas o RH Geral pode autorizar validacao coletiva de ponto.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_documento IS NULL OR btrim(p_documento) = '' THEN
        RAISE EXCEPTION 'Informe o numero do oficio ou processo que autoriza.';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Informe o motivo da autorizacao.';
    END IF;

    IF p_servidor_ids IS NULL OR array_length(p_servidor_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Selecione ao menos um servidor.';
    END IF;

    -- O CHECK da tabela ja' barra 'saida', mas a mensagem crua de constraint nao explica nada
    -- para quem esta' na tela.
    IF 'saida' = ANY(p_passos) THEN
        RAISE EXCEPTION
            'A batida de saida nao pode ser dispensada: e o registro real que sustenta a folha.';
    END IF;

    FOREACH v_servidor IN ARRAY p_servidor_ids LOOP
        SELECT nome INTO v_nome FROM public.servidores WHERE id = v_servidor;

        BEGIN
            INSERT INTO public.autorizacoes_ponto_coletivo (
                servidor_id, passos, vigencia_inicio, vigencia_fim,
                documento, motivo, autorizado_por_id
            ) VALUES (
                v_servidor, p_passos, p_vigencia_inicio, p_vigencia_fim,
                btrim(p_documento), btrim(p_motivo), auth.uid()
            );
            v_criadas := v_criadas + 1;
        EXCEPTION WHEN OTHERS THEN
            -- Um servidor com autorizacao sobreposta nao pode derrubar o lote inteiro: o RH
            -- lanca os sete de uma vez e precisa saber qual dos sete ficou de fora, e por que.
            v_erros := v_erros || jsonb_build_object(
                'servidor_id', v_servidor,
                'servidor_nome', COALESCE(v_nome, '(desconhecido)'),
                'erro', SQLERRM);
        END;
    END LOOP;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'autorizacao_ponto_coletivo_concedida', jsonb_build_object(
        'servidores', array_length(p_servidor_ids, 1),
        'criadas', v_criadas,
        'passos', p_passos,
        'documento', btrim(p_documento),
        'vigencia_inicio', p_vigencia_inicio,
        'vigencia_fim', p_vigencia_fim));

    RETURN jsonb_build_object(
        'success', true,
        'criadas', v_criadas,
        'erros', v_erros,
        'message', format('%s autorizacao(oes) concedida(s).', v_criadas));
END;
$fn$;

COMMENT ON FUNCTION public.fn_conceder_autorizacao_ponto_coletivo(uuid[], text[], date, date, text, text) IS
    'Concede autorizacao de validacao coletiva. So RH Geral / Administrador Geral. Um servidor '
    'com erro nao derruba o lote - o resultado lista quem ficou de fora.';

GRANT EXECUTE ON FUNCTION public.fn_conceder_autorizacao_ponto_coletivo(uuid[], text[], date, date, text, text)
    TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_revogar_autorizacao_ponto_coletivo(
    p_autorizacao_id uuid,
    p_motivo         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role public.user_role;
BEGIN
    v_role := (SELECT public.get_my_role());

    IF v_role NOT IN ('rh'::public.user_role, 'super_admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas o RH Geral pode revogar autorizacao de validacao coletiva.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Informe o motivo da revogacao.';
    END IF;

    UPDATE public.autorizacoes_ponto_coletivo
       SET revogado_em      = now(),
           revogado_por_id  = auth.uid(),
           revogacao_motivo = btrim(p_motivo)
     WHERE id = p_autorizacao_id
       AND revogado_em IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Autorizacao nao encontrada ou ja revogada.';
    END IF;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'autorizacao_ponto_coletivo_revogada', jsonb_build_object(
        'autorizacao_id', p_autorizacao_id, 'motivo', btrim(p_motivo)));

    -- Revogar NAO desfaz o que ja foi declarado: aquilo e' ponto de mes possivelmente fechado, e
    -- se estiver errado o caminho e' a correcao normal da folha, com rastro proprio.
    RETURN jsonb_build_object('success', true, 'message', 'Autorizacao revogada.');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_revogar_autorizacao_ponto_coletivo(uuid, text)
    TO authenticated, service_role;


-- ============================================================================
-- 4. O QUE ESTA AUTORIZADO NESTE DIA
-- ============================================================================
-- Fonte unica da leitura: usada pela tela (para mostrar o aviso e preencher a justificativa) e
-- pela funcao de validacao (que e' quem de fato decide). Se cada uma derivar por conta propria,
-- a tela passa a prometer o que o banco recusa.

CREATE OR REPLACE FUNCTION public.fn_autorizacao_ponto_coletivo_vigente(
    p_servidor_id uuid,
    p_data        date
)
RETURNS public.autorizacoes_ponto_coletivo
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT a.*
      FROM public.autorizacoes_ponto_coletivo a
     WHERE a.servidor_id = p_servidor_id
       AND a.revogado_em IS NULL
       AND p_data BETWEEN a.vigencia_inicio AND a.vigencia_fim
     ORDER BY a.created_at DESC
     LIMIT 1;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_autorizacao_ponto_coletivo_vigente(uuid, date)
    TO authenticated, service_role;


-- ============================================================================
-- 5. A VALIDACAO COLETIVA RESTRITA AOS PASSOS AUTORIZADOS
-- ============================================================================
-- NAO altera fn_confirmar_presenca_manual nem fn_confirmar_presenca (armadilha 1 do CLAUDE.md).
-- Envelopa fn_confirmar_presenca_manual_bulk chamando-a UMA VEZ POR PASSO autorizado - os tipos
-- 'entrada', 'intervalo_saida' e 'intervalo_retorno' ja existiam nela desde sempre e nunca
-- tinham chamador de aplicacao. Assim o horario previsto continua saindo de um lugar so.
--
-- A SAIDA NUNCA E TOCADA: nenhum caminho aqui passa 'saida', 'completo', 'periodo_1' ou
-- 'periodo_2'.

CREATE OR REPLACE FUNCTION public.fn_atestar_passos_autorizados_bulk(
    p_escala_mensal_ids uuid[],
    p_dias              integer[],
    p_categorias        text[],
    p_validador_id      uuid,
    p_justificativa     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone     text;
    v_em_id        uuid;
    v_dia          integer;
    v_passo        text;
    v_res          jsonb;
    v_atestados    integer := 0;
    v_pulados      integer := 0;
    v_sem_autoriz  jsonb := '[]'::jsonb;
    v_pendentes    jsonb := '[]'::jsonb;
    v_aut          public.autorizacoes_ponto_coletivo;
    v_servidor_id  uuid;
    v_servidor_nome text;
    v_mes          integer;
    v_ano          integer;
    v_data         date;
    v_tem_entrada  boolean;
    v_docs         text[] := ARRAY[]::text[];
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Justificativa e obrigatoria para atestar jornada.');
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    FOREACH v_em_id IN ARRAY p_escala_mensal_ids LOOP
        SELECT em.servidor_id, em.mes, em.ano, s.nome
          INTO v_servidor_id, v_mes, v_ano, v_servidor_nome
          FROM public.escala_mensal em
          JOIN public.servidores s ON s.id = em.servidor_id
         WHERE em.id = v_em_id;

        CONTINUE WHEN v_servidor_id IS NULL;

        FOREACH v_dia IN ARRAY p_dias LOOP
            -- O modal manda o intervalo cru (ex.: 1 a 31), entao dia 31 em mes de 30 chega aqui.
            -- Checagem direta em vez de capturar a excecao de make_date: mais barato e evita
            -- abrir subtransacao por dia.
            CONTINUE WHEN v_dia < 1 OR v_dia > extract(
                day from (make_date(v_ano, v_mes, 1) + interval '1 month' - interval '1 day')
            )::integer;

            v_data := make_date(v_ano, v_mes, v_dia);

            -- A autorizacao e' conferida DIA A DIA, nao uma vez por servidor: a vigencia pode
            -- comecar ou terminar no meio do periodo selecionado, e o oficio vale exatamente
            -- dentro dela.
            v_aut := public.fn_autorizacao_ponto_coletivo_vigente(v_servidor_id, v_data);

            IF v_aut.id IS NULL THEN
                v_sem_autoriz := v_sem_autoriz || jsonb_build_object(
                    'servidor_nome', v_servidor_nome, 'dia', v_dia);
                v_pulados := v_pulados + 1;
                CONTINUE;
            END IF;

            IF NOT (v_aut.documento = ANY(v_docs)) THEN
                v_docs := v_docs || v_aut.documento;
            END IF;

            -- Mesma protecao de fn_atestar_jornada_bulk: dia com batida aguardando revisao fica
            -- de fora, porque ali existe horario REAL a ser apreciado - declarar por cima seria
            -- trocar o fato pela declaracao.
            IF EXISTS (
                SELECT 1
                  FROM public.marcacoes_ponto m
                 WHERE m.servidor_id = v_servidor_id
                   AND m.origem IN ('terminal', 'ajuste_servidor')
                   AND m.observacao LIKE '%pendente de revisao%'
                   AND (m.ocorrido_em AT TIME ZONE v_timezone)::date = v_data
                   AND NOT EXISTS (
                       SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)
            ) THEN
                v_pendentes := v_pendentes || jsonb_build_object(
                    'servidor_nome', v_servidor_nome, 'dia', v_dia);
                v_pulados := v_pulados + 1;
                CONTINUE;
            END IF;

            FOREACH v_passo IN ARRAY v_aut.passos LOOP
                -- ⚠️ p_tipo = 'intervalo_retorno' FABRICA a entrada (inicio + 5h) quando ela
                -- esta' nula - ver 20260822130000. Com 'entrada' tambem autorizada isso nao
                -- acontece (ela e' gravada antes, e o UPDATE usa COALESCE); sem ela, pular e' a
                -- unica saida, senao esta funcao criaria pelas costas o horario que o desenho
                -- inteiro existe para nao criar.
                IF v_passo = 'intervalo_retorno'
                   AND NOT ('entrada' = ANY(v_aut.passos)) THEN
                    SELECT EXISTS (
                        SELECT 1 FROM public.escala_diaria ed
                         WHERE ed.escala_mensal_id = v_em_id
                           AND ed.dia = v_dia
                           AND ed.categoria::text = ANY(p_categorias)
                           AND ed.presenca_entrada_em IS NOT NULL
                    ) INTO v_tem_entrada;

                    CONTINUE WHEN NOT v_tem_entrada;
                END IF;

                v_res := public.fn_confirmar_presenca_manual_bulk(
                    ARRAY[v_em_id], ARRAY[v_dia], p_categorias,
                    v_passo, p_validador_id,
                    btrim(p_justificativa) || ' (Autorizacao do RH: ' || v_aut.documento || ')');

                -- ⚠️ A chave e' `processed_count`. fn_confirmar_presenca_manual_bulk sempre
                -- devolveu esse nome (20260804040000) e fn_atestar_jornada_bulk le
                -- `total_processed` desde 08/08/2026 - por isso a mensagem dela diz "atestada em
                -- 0 registro(s)" mesmo quando validou tudo. Corrigido na secao 6 abaixo.
                IF COALESCE((v_res->>'success')::boolean, false) THEN
                    v_atestados := v_atestados + COALESCE((v_res->>'processed_count')::integer, 0);
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success',      true,
        'atestados',    v_atestados,
        'pulados',      v_pulados,
        'sem_autorizacao', v_sem_autoriz,
        'pendentes',    v_pendentes,
        'documentos',   to_jsonb(v_docs),
        'message', format(
            'Jornada declarada em %s registro(s), somente nos passos autorizados. %s dia(s) '
            'ficaram de fora (sem autorizacao vigente ou com batida aguardando revisao). '
            'A saida nao foi tocada em nenhum dia.',
            v_atestados, v_pulados));
END;
$fn$;

COMMENT ON FUNCTION public.fn_atestar_passos_autorizados_bulk(uuid[], integer[], text[], uuid, text) IS
    'Validacao coletiva restrita aos passos que o RH autorizou por servidor e por data. Nunca '
    'toca na saida. Envelopa fn_confirmar_presenca_manual_bulk uma vez por passo, sem alterar '
    'nenhuma funcao de presenca.';

GRANT EXECUTE ON FUNCTION public.fn_atestar_passos_autorizados_bulk(uuid[], integer[], text[], uuid, text)
    TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) A tabela recusa o que tem de recusar:
--
--   INSERT INTO public.autorizacoes_ponto_coletivo
--       (servidor_id, passos, vigencia_inicio, vigencia_fim, documento, motivo)
--   VALUES ('<servidor>', ARRAY['saida'], '2026-09-01', '2026-09-30', 'X', 'Y');
--   -- esperado: violacao de chk_apc_passos_validos
--
--   VALUES (..., ARRAY['entrada'], '2026-09-01', '2028-09-30', ...);
--   -- esperado: violacao de chk_apc_vigencia_maxima (teto de 12 meses)
--
--   2) So RH Geral concede (com JWT de coordenador, esperado 'insufficient_privilege'):
--
--   SELECT public.fn_conceder_autorizacao_ponto_coletivo(
--       ARRAY['<servidor>']::uuid[], ARRAY['entrada'], '2026-09-01', '2027-08-31',
--       'Oficio 249/2026/SMS-PRO-ESP', 'Programa Porta a Porta - inicio de jornada em campo');
--
--   3) Duas vigencias sobrepostas para o mesmo servidor sao recusadas pelo trigger:
--
--   -- repetir a chamada acima: esperado erro de autorizacao ja vigente
--
--   4) A validacao restrita NAO toca na saida (o teste que importa):
--
--   SELECT presenca_entrada_em, presenca_saida_em FROM public.escala_diaria
--    WHERE escala_mensal_id = '<em>' AND dia = <dia>;   -- anote os dois
--
--   SELECT public.fn_atestar_passos_autorizados_bulk(
--       ARRAY['<em>']::uuid[], ARRAY[<dia>], ARRAY['Regular'], '<validador>',
--       'Declaracao coletiva conforme autorizacao do RH');
--
--   -- esperado: presenca_entrada_em preenchida, presenca_saida_em EXATAMENTE como estava
--
--   5) Servidor sem autorizacao e' pulado, nao declarado:
--
--   -- rodar a mesma chamada para um servidor sem autorizacao vigente:
--   -- esperado atestados = 0 e o nome dele em sem_autorizacao
--
--   6) Quantas autorizacoes vigentes existem hoje (esperado 0 logo apos aplicar):
--
--   SELECT count(*) FROM public.autorizacoes_ponto_coletivo WHERE revogado_em IS NULL;


-- ============================================================================
-- 6. CORRECAO: fn_atestar_jornada_bulk contava com a chave errada
-- ============================================================================
-- Achado ao escrever a secao 5, em 27/08/2026. fn_confirmar_presenca_manual_bulk devolve
-- `processed_count` (assim desde 20260804040000) e fn_atestar_jornada_bulk le
-- `total_processed`, que nunca existiu — nas duas versoes dela (20260808120000 e
-- 20260808130000).
--
-- Efeito: o COALESCE resolve para 0 sempre, entao a validacao em massa funciona e ANUNCIA
-- "Jornada atestada em 0 registro(s)". Nada e' gravado errado; o que quebra e' a confianca de
-- quem clicou — e e' a mesma familia da armadilha 22 do CLAUDE.md (relatar o que foi calculado
-- em vez do que mudou), aqui na forma pior: relatar zero quando mudou.
--
-- Copia mecanica do corpo vigente (20260808130000) com UMA substituicao, conferida por
-- scratchpad/gen_fix_atestar_contagem.js.

CREATE OR REPLACE FUNCTION public.fn_atestar_jornada_bulk(
    p_escala_mensal_ids uuid[],
    p_dias              integer[],
    p_categorias        text[],
    p_tipo              text,
    p_validador_id      uuid,
    p_justificativa     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone  text;
    v_pendentes jsonb := '[]'::jsonb;
    v_em_id     uuid;
    v_dia       integer;
    v_res       jsonb;
    v_atestados integer := 0;
    v_pulados   integer := 0;
    r           record;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RETURN jsonb_build_object('success', false,
            'message', 'Justificativa é obrigatória para atestar jornada.');
    END IF;

    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    FOR r IN
        SELECT em.id AS escala_mensal_id,
               s.nome AS servidor_nome,
               extract(day from m.ocorrido_em AT TIME ZONE v_timezone)::integer AS dia,
               count(*) AS batidas,
               min(m.ocorrido_em) AS primeira,
               bool_or(m.origem = 'ajuste_servidor') AS tem_solicitacao
          FROM public.marcacoes_ponto m
          JOIN public.servidores s     ON s.id = m.servidor_id
          JOIN public.escala_mensal em ON em.servidor_id = m.servidor_id
                                      AND em.mes = extract(month from m.ocorrido_em AT TIME ZONE v_timezone)::integer
                                      AND em.ano = extract(year  from m.ocorrido_em AT TIME ZONE v_timezone)::integer
         WHERE em.id = ANY(p_escala_mensal_ids)
           AND m.origem IN ('terminal', 'ajuste_servidor')
           AND m.observacao LIKE '%pendente de revisao%'
           AND extract(day from m.ocorrido_em AT TIME ZONE v_timezone)::integer = ANY(p_dias)
           AND NOT EXISTS (SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)
         GROUP BY em.id, s.nome, 3
         ORDER BY s.nome, 3
    LOOP
        v_pendentes := v_pendentes || jsonb_build_object(
            'escala_mensal_id', r.escala_mensal_id,
            'servidor_nome',    r.servidor_nome,
            'dia',              r.dia,
            'batidas',          r.batidas,
            'tem_solicitacao',  r.tem_solicitacao,
            'primeira_batida',  to_char(r.primeira AT TIME ZONE v_timezone, 'HH24:MI'));
    END LOOP;

    FOREACH v_em_id IN ARRAY p_escala_mensal_ids LOOP
        FOREACH v_dia IN ARRAY p_dias LOOP
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_pendentes) AS x
                 WHERE (x->>'escala_mensal_id')::uuid = v_em_id
                   AND (x->>'dia')::integer = v_dia
            ) THEN
                v_pulados := v_pulados + 1;
                CONTINUE;
            END IF;

            v_res := public.fn_confirmar_presenca_manual_bulk(
                ARRAY[v_em_id], ARRAY[v_dia], p_categorias,
                p_tipo, p_validador_id, p_justificativa);

            IF COALESCE((v_res->>'success')::boolean, false) THEN
                v_atestados := v_atestados + COALESCE((v_res->>'processed_count')::integer, 0);
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success',   true,
        'atestados', v_atestados,
        'pulados',   v_pulados,
        'pendentes', v_pendentes,
        'message',   CASE
            WHEN jsonb_array_length(v_pendentes) = 0
                THEN 'Jornada atestada em ' || v_atestados || ' registro(s).'
            ELSE 'Jornada atestada em ' || v_atestados || ' registro(s). ' ||
                 jsonb_array_length(v_pendentes) || ' dia(s) ficaram de fora por terem ponto ' ||
                 'registrado ou ajuste solicitado aguardando revisão.'
        END);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_atestar_jornada_bulk(uuid[], integer[], text[], text, uuid, text)
    TO authenticated, service_role;

--   7) A contagem passa a bater (rodar sobre um dia sem batida pendente):
--
--   SELECT public.fn_atestar_jornada_bulk(ARRAY['<em>']::uuid[], ARRAY[<dia>],
--          ARRAY['Regular'], 'completo', '<validador>', 'teste de contagem');
--   -- esperado: atestados > 0 na resposta (antes vinha 0 mesmo tendo gravado)
