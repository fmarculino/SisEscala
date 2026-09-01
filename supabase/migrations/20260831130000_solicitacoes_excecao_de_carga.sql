-- ============================================================================
-- Solicitacao de Autorizacao Extraordinaria: o coordenador pede, o RH decide
-- ============================================================================
-- 31/08/2026 - decisao do usuario.
--
-- O QUE ESTAVA ERRADO
--   Ao estourar o teto mensal, quem nao e admin recebia a mensagem:
--       "Solicite a um Administrador a concessao de uma Autorizacao Extraordinaria."
--   ...e o sistema nao oferecia meio nenhum de fazer isso. Nao existia tabela, tela, aviso nem
--   registro: o pedido acontecia por WhatsApp, e a decisao nao ficava em lugar nenhum.
--
--   Sao 73 coordenadores e 8 ass_adm nessa situacao (medido em 31/08/2026) contra 5 pessoas que
--   podiam conceder -- 20 desde a 20260831120000, que soma RH Geral e RH da Unidade.
--
--   E o mais caro nao e o incomodo: instrucao que o sistema nao cumpre ensina a contornar o
--   sistema. O teto vira algo que se resolve "falando com alguem", e a decisao -- que e sobre
--   carga horaria de servidor publico -- some.
--
-- O DESENHO SEGUE `solicitacoes_transferencia_servidor` (20260811110000 / 20260828100000)
--   Mesma forma: quem opera pede com justificativa obrigatoria, quem tem autoridade avalia, e o
--   registro guarda as duas pontas. Nao e' um fluxo novo para as pessoas aprenderem.
--
-- ATENCAO: a ESCRITA da tabela e exclusivamente pelas duas RPCs SECURITY DEFINER. Nao existe
--   policy de INSERT/UPDATE/DELETE de proposito -- e o que impede a armadilha 12 (tela filtrada
--   nao protege endpoint: o PostgREST e chamavel direto). Sem RPC, ninguem marca o proprio
--   pedido como "aprovada".
--
-- ATENCAO: aprovar GRAVA a excecao na mesma transacao. Duas etapas ("aprova aqui, concede ali")
--   produziriam pedido aprovado sem teto ampliado -- e a escala continuaria barrada, com a tela
--   dizendo que estava autorizada.
--
-- ATENCAO: UM pendente por (servidor, mes, ano), nao por unidade. A autorizacao e uma so para o
--   mes da pessoa (armadilha 26); dois pedidos abertos para o mesmo mes produziriam duas
--   decisoes sobre o mesmo numero. O segundo pedido e recusado com o nome de quem ja pediu, em
--   vez de virar fila silenciosa.
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE + DROP POLICY IF EXISTS.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tabela
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitacoes_excecao_carga (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id                uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    -- Unidade/setor DE ONDE o pedido partiu. A autorizacao vale para o mes inteiro da pessoa,
    -- mas quem pediu, pediu de algum lugar -- e e por aqui que o RH da Unidade enxerga o que e
    -- dele.
    unidade_id                 uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
    setor_id                   uuid REFERENCES public.setores(id) ON DELETE SET NULL,
    mes                        integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
    ano                        integer NOT NULL CHECK (ano >= 2020),

    horas_solicitadas          numeric(6,2) NOT NULL DEFAULT 0 CHECK (horas_solicitadas >= 0),
    sobreavisos_solicitados    integer      NOT NULL DEFAULT 0 CHECK (sobreavisos_solicitados >= 0),
    justificativa              text NOT NULL CHECK (btrim(justificativa) <> ''),

    -- Fotografia do momento do pedido: sem ela, quem avalia dias depois nao sabe contra o que a
    -- pessoa estava pedindo (a grade ja mudou). Nao e usada em conta nenhuma -- e contexto.
    horas_no_pedido            numeric(8,2),
    teto_no_pedido             numeric(8,2),

    status                     text NOT NULL DEFAULT 'pendente'
                               CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'cancelada')),

    solicitado_por             uuid NOT NULL REFERENCES auth.users(id),
    solicitado_em              timestamptz NOT NULL DEFAULT now(),

    avaliado_por               uuid REFERENCES auth.users(id),
    avaliado_em                timestamptz,
    parecer                    text,
    -- O que foi de fato concedido pode ser MENOR que o pedido: aprovar nao e carimbar.
    horas_concedidas           numeric(6,2),
    sobreavisos_concedidos     integer,
    excecao_id                 uuid REFERENCES public.excecoes_escala_servidor(id) ON DELETE SET NULL,

    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    -- Pedido vazio nao existe: ou pede hora, ou pede sobreaviso.
    CONSTRAINT chk_solicitacao_excecao_pede_algo
        CHECK (horas_solicitadas > 0 OR sobreavisos_solicitados > 0)
);

-- Um PENDENTE por (servidor, mes, ano) -- ver o cabecalho. Parcial: pedidos ja decididos podem
-- se acumular a vontade, e e desejavel que se acumulem (e o historico).
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitacao_excecao_pendente
    ON public.solicitacoes_excecao_carga (servidor_id, mes, ano)
 WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_solicitacao_excecao_competencia
    ON public.solicitacoes_excecao_carga (mes, ano, status);

CREATE INDEX IF NOT EXISTS idx_solicitacao_excecao_unidade
    ON public.solicitacoes_excecao_carga (unidade_id, status);

ALTER TABLE public.solicitacoes_excecao_carga ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 2. Quem pode SOLICITAR
-- ----------------------------------------------------------------------------
-- Espelha a policy de escrita de `escala_mensal` (20260818170000): quem pode lancar a escala
-- naquela unidade/setor e quem pode pedir teto para ela. Nao inventa escopo novo.
--
-- ATENCAO: `fn_unidade_no_escopo` sozinha nao serve -- ela so olha `profile_unidades`, e o
-- coordenador cujo acesso vem inteiramente de setor vinculado passa em `NULL` e falha em
-- qualquer chamada real (registrado nas pendencias da Fase 5). Por isso o braco de setor usa
-- `fn_setores_no_escopo()`, a mesma da policy.
CREATE OR REPLACE FUNCTION public.fn_pode_solicitar_excecao_carga(
    p_unidade_id uuid,
    p_setor_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT CASE
        WHEN auth.uid() IS NULL THEN true

        WHEN (SELECT get_my_role()) IN ('super_admin'::public.user_role,
                                        'rh'::public.user_role) THEN true

        WHEN (SELECT get_my_role()) = 'rh_unidade'::public.user_role THEN
            p_unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu
                              WHERE pu.profile_id = auth.uid())

        WHEN (SELECT get_my_role()) IN ('admin'::public.user_role,
                                        'coordenador'::public.user_role,
                                        'ass_adm'::public.user_role) THEN
            EXISTS (SELECT 1 FROM public.profiles p
                     WHERE p.id = auth.uid()
                       AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))
            OR p_unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu
                                 WHERE pu.profile_id = auth.uid())
            OR p_setor_id IN (SELECT e.setor_id FROM public.fn_setores_no_escopo() e)

        ELSE false
    END;
$fn$;

COMMENT ON FUNCTION public.fn_pode_solicitar_excecao_carga(uuid, uuid) IS
    'Quem pode PEDIR Autorizacao Extraordinaria para uma escala. Espelha a policy de escrita de '
    'escala_mensal: quem lanca a escala pede o teto dela.';


-- ----------------------------------------------------------------------------
-- 3. Leitura
-- ----------------------------------------------------------------------------
-- Ve o pedido: quem pode decidi-lo, quem o fez, e quem opera aquela escala (o colega que vai
-- esbarrar no mesmo teto precisa saber que ja existe pedido em andamento).
DROP POLICY IF EXISTS "Leitura de solicitacoes de excecao de carga" ON public.solicitacoes_excecao_carga;

CREATE POLICY "Leitura de solicitacoes de excecao de carga"
ON public.solicitacoes_excecao_carga
FOR SELECT
TO authenticated
USING (
    solicitado_por = auth.uid()
    OR public.fn_pode_autorizar_excecao_carga(servidor_id, mes, ano)
    OR public.fn_pode_solicitar_excecao_carga(unidade_id, setor_id)
);

-- Nenhuma policy de INSERT/UPDATE/DELETE, de proposito: a escrita e so pelas RPCs abaixo.


-- ----------------------------------------------------------------------------
-- 4. Solicitar
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_solicitar_excecao_carga(
    p_servidor_id   uuid,
    p_unidade_id    uuid,
    p_mes           integer,
    p_ano           integer,
    p_justificativa text,
    p_horas         numeric DEFAULT 0,
    p_sobreavisos   integer DEFAULT 0,
    p_setor_id      uuid    DEFAULT NULL,
    p_horas_no_pedido numeric DEFAULT NULL,
    p_teto_no_pedido  numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_id          uuid;
    v_pendente    record;
BEGIN
    IF NOT public.fn_pode_solicitar_excecao_carga(p_unidade_id, p_setor_id) THEN
        RAISE EXCEPTION 'Acesso negado: perfil sem permissao para solicitar autorizacao nesta escala.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RAISE EXCEPTION 'A justificativa e obrigatoria: e ela que o RH le para decidir.';
    END IF;

    IF COALESCE(p_horas, 0) <= 0 AND COALESCE(p_sobreavisos, 0) <= 0 THEN
        RAISE EXCEPTION 'Informe quantas horas ou quantos sobreavisos adicionais o mes precisa.';
    END IF;

    -- Pedido em aberto para a mesma pessoa/mes: recusa DIZENDO quem pediu. Fila silenciosa aqui
    -- viraria duas decisoes sobre o mesmo numero.
    SELECT s.*, COALESCE(NULLIF(btrim(pr.full_name), ''), 'outro usuario') AS quem,
           u.nome AS unidade_nome
      INTO v_pendente
      FROM public.solicitacoes_excecao_carga s
      LEFT JOIN public.profiles pr ON pr.id = s.solicitado_por
      LEFT JOIN public.unidades u  ON u.id  = s.unidade_id
     WHERE s.servidor_id = p_servidor_id
       AND s.mes = p_mes
       AND s.ano = p_ano
       AND s.status = 'pendente'
     LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'ok', false,
            'ja_existe', true,
            'solicitacao_id', v_pendente.id,
            'mensagem', format(
                'Ja existe um pedido pendente para este servidor em %s/%s, aberto por %s (%s) em %s. O RH decide os dois no mesmo numero, entao aguarde ou fale com quem pediu.',
                lpad(p_mes::text, 2, '0'), p_ano, v_pendente.quem,
                COALESCE(v_pendente.unidade_nome, 'unidade nao informada'),
                to_char(v_pendente.solicitado_em, 'DD/MM/YYYY HH24:MI'))
        );
    END IF;

    INSERT INTO public.solicitacoes_excecao_carga (
        servidor_id, unidade_id, setor_id, mes, ano,
        horas_solicitadas, sobreavisos_solicitados, justificativa,
        horas_no_pedido, teto_no_pedido, solicitado_por
    ) VALUES (
        p_servidor_id, p_unidade_id, p_setor_id, p_mes, p_ano,
        COALESCE(p_horas, 0), COALESCE(p_sobreavisos, 0), btrim(p_justificativa),
        p_horas_no_pedido, p_teto_no_pedido, auth.uid()
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'solicitacao_id', v_id,
                              'mensagem', 'Pedido enviado ao RH. Ele aparece em "Autorizacoes de Escala".');
END;
$fn$;


-- ----------------------------------------------------------------------------
-- 5. Avaliar (aprovar concede na mesma transacao)
-- ----------------------------------------------------------------------------
-- `#variable_conflict use_column` NAO e necessario aqui (o retorno e jsonb, nao RETURNS TABLE),
-- mas as variaveis levam prefixo v_ pelo mesmo motivo da armadilha 42: nome de variavel igual a
-- nome de coluna e erro 42702 que so aparece em execucao.
CREATE OR REPLACE FUNCTION public.fn_avaliar_solicitacao_excecao_carga(
    p_solicitacao_id uuid,
    p_aprovar        boolean,
    p_parecer        text    DEFAULT NULL,
    p_horas          numeric DEFAULT NULL,
    p_sobreavisos    integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_sol          record;
    v_horas        numeric;
    v_sobreavisos  integer;
    v_excecao_id   uuid;
    v_anterior       record;
    v_tinha_anterior boolean;
BEGIN
    SELECT * INTO v_sol
      FROM public.solicitacoes_excecao_carga
     WHERE id = p_solicitacao_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitacao nao encontrada.';
    END IF;

    IF v_sol.status <> 'pendente' THEN
        RAISE EXCEPTION 'Esta solicitacao ja foi % em %.',
            v_sol.status, to_char(v_sol.avaliado_em, 'DD/MM/YYYY HH24:MI');
    END IF;

    -- Mesma funcao que a policy de `excecoes_escala_servidor` usa: aprovar aqui e conceder la,
    -- entao quem nao pode conceder nao pode aprovar. Sem isto, a aprovacao passaria e a gravacao
    -- da excecao morreria em erro de RLS, deixando pedido "aprovado" sem teto ampliado.
    IF NOT public.fn_pode_autorizar_excecao_carga(v_sol.servidor_id, v_sol.mes, v_sol.ano) THEN
        RAISE EXCEPTION 'Acesso negado: perfil sem permissao para decidir esta solicitacao.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT p_aprovar THEN
        IF p_parecer IS NULL OR btrim(p_parecer) = '' THEN
            RAISE EXCEPTION 'Informe o motivo da recusa: quem pediu precisa saber o que fazer em seguida.';
        END IF;

        UPDATE public.solicitacoes_excecao_carga
           SET status = 'rejeitada', avaliado_por = auth.uid(), avaliado_em = now(),
               parecer = btrim(p_parecer), updated_at = now()
         WHERE id = p_solicitacao_id;

        RETURN jsonb_build_object('ok', true, 'status', 'rejeitada');
    END IF;

    -- Conceder MENOS que o pedido e comum e legitimo; conceder zero nos dois nao e aprovar.
    v_horas       := COALESCE(p_horas, v_sol.horas_solicitadas);
    v_sobreavisos := COALESCE(p_sobreavisos, v_sol.sobreavisos_solicitados);

    IF v_horas < 0 OR v_sobreavisos < 0 THEN
        RAISE EXCEPTION 'Valores concedidos nao podem ser negativos.';
    END IF;

    IF v_horas = 0 AND v_sobreavisos = 0 THEN
        RAISE EXCEPTION 'Aprovar com zero hora e zero sobreaviso nao amplia teto nenhum. Para negar, use a recusa (com motivo).';
    END IF;

    SELECT horas_adicionais_autorizadas, sobreavisos_adicionais_autorizados, autorizado_por
      INTO v_anterior
      FROM public.excecoes_escala_servidor
     WHERE servidor_id = v_sol.servidor_id AND mes = v_sol.mes AND ano = v_sol.ano;

    -- FOUND, e nao `v_anterior IS NOT NULL`: para um record, `IS NOT NULL` so e verdadeiro
    -- quando TODOS os campos sao nao nulos -- uma autorizacao vigente com autorizado_por nulo
    -- responderia "nao existia", e a tela diria que nada foi substituido.
    v_tinha_anterior := FOUND;

    -- A excecao e UMA por (servidor, mes, ano) -- o upsert SUBSTITUI o adicional vigente, que
    -- pode ter vindo de outra unidade (armadilha 26). Quem aprova ve o valor anterior na tela
    -- antes de decidir; a resposta abaixo o devolve para a tela poder dizer o que mudou.
    INSERT INTO public.excecoes_escala_servidor (
        servidor_id, unidade_id, mes, ano,
        horas_adicionais_autorizadas, sobreavisos_adicionais_autorizados,
        motivo_justificativa, autorizado_por, updated_at
    ) VALUES (
        v_sol.servidor_id, v_sol.unidade_id, v_sol.mes, v_sol.ano,
        v_horas, v_sobreavisos,
        COALESCE(NULLIF(btrim(p_parecer), ''), v_sol.justificativa),
        auth.uid(), now()
    )
    ON CONFLICT (servidor_id, mes, ano) DO UPDATE
        SET horas_adicionais_autorizadas       = EXCLUDED.horas_adicionais_autorizadas,
            sobreavisos_adicionais_autorizados = EXCLUDED.sobreavisos_adicionais_autorizados,
            motivo_justificativa               = EXCLUDED.motivo_justificativa,
            autorizado_por                     = EXCLUDED.autorizado_por,
            unidade_id                         = EXCLUDED.unidade_id,
            updated_at                         = now()
    RETURNING id INTO v_excecao_id;

    UPDATE public.solicitacoes_excecao_carga
       SET status = 'aprovada', avaliado_por = auth.uid(), avaliado_em = now(),
           parecer = NULLIF(btrim(COALESCE(p_parecer, '')), ''),
           horas_concedidas = v_horas, sobreavisos_concedidos = v_sobreavisos,
           excecao_id = v_excecao_id, updated_at = now()
     WHERE id = p_solicitacao_id;

    RETURN jsonb_build_object(
        'ok', true,
        'status', 'aprovada',
        'horas_concedidas', v_horas,
        'sobreavisos_concedidos', v_sobreavisos,
        'substituiu_anterior', v_tinha_anterior,
        'horas_anteriores', COALESCE(v_anterior.horas_adicionais_autorizadas, 0),
        'sobreavisos_anteriores', COALESCE(v_anterior.sobreavisos_adicionais_autorizados, 0)
    );
END;
$fn$;


-- ----------------------------------------------------------------------------
-- 6. Cancelar o proprio pedido
-- ----------------------------------------------------------------------------
-- Existe para a trava de "um pendente por mes" nao virar prisao: quem pediu errado desiste, e o
-- proximo pedido passa. Cancelado NAO some -- vira historico como qualquer outro desfecho.
CREATE OR REPLACE FUNCTION public.fn_cancelar_solicitacao_excecao_carga(p_solicitacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_sol record;
BEGIN
    SELECT * INTO v_sol FROM public.solicitacoes_excecao_carga
     WHERE id = p_solicitacao_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitacao nao encontrada.';
    END IF;

    IF v_sol.status <> 'pendente' THEN
        RAISE EXCEPTION 'Apenas um pedido pendente pode ser cancelado (este esta %).', v_sol.status;
    END IF;

    IF v_sol.solicitado_por <> auth.uid()
       AND NOT public.fn_pode_autorizar_excecao_carga(v_sol.servidor_id, v_sol.mes, v_sol.ano) THEN
        RAISE EXCEPTION 'Acesso negado: so quem pediu (ou quem decide) pode cancelar.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.solicitacoes_excecao_carga
       SET status = 'cancelada', avaliado_por = auth.uid(), avaliado_em = now(), updated_at = now()
     WHERE id = p_solicitacao_id;

    RETURN jsonb_build_object('ok', true, 'status', 'cancelada');
END;
$fn$;


-- ----------------------------------------------------------------------------
-- 7. Listagem para a tela
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER porque a tela precisa do NOME do servidor, da unidade e das duas pessoas --
-- e a RLS de `servidores` mostra a quem avalia so o proprio escopo, enquanto o pedido pode ser
-- justamente sobre servidor externo. O filtro de quem ve o que continua sendo o mesmo da policy
-- de leitura, aplicado aqui explicitamente.
CREATE OR REPLACE FUNCTION public.fn_solicitacoes_excecao_carga(
    p_status text    DEFAULT NULL,
    p_mes    integer DEFAULT NULL,
    p_ano    integer DEFAULT NULL
)
RETURNS TABLE (
    id                      uuid,
    servidor_id             uuid,
    servidor_nome           text,
    servidor_matricula      text,
    unidade_id              uuid,
    unidade_nome            text,
    setor_id                uuid,
    setor_caminho           text,
    mes                     integer,
    ano                     integer,
    horas_solicitadas       numeric,
    sobreavisos_solicitados integer,
    justificativa           text,
    horas_no_pedido         numeric,
    teto_no_pedido          numeric,
    status                  text,
    solicitado_por_nome     text,
    solicitado_em           timestamptz,
    avaliado_por_nome       text,
    avaliado_em             timestamptz,
    parecer                 text,
    horas_concedidas        numeric,
    sobreavisos_concedidos  integer,
    pode_avaliar            boolean,
    pode_cancelar           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT s.id,
           s.servidor_id,
           sv.nome,
           sv.matricula,
           s.unidade_id,
           u.nome,
           s.setor_id,
           public.fn_setor_caminho(s.setor_id),
           s.mes,
           s.ano,
           s.horas_solicitadas,
           s.sobreavisos_solicitados,
           s.justificativa,
           s.horas_no_pedido,
           s.teto_no_pedido,
           s.status,
           COALESCE(NULLIF(btrim(pr1.full_name), ''), 'Usuario do sistema'),
           s.solicitado_em,
           NULLIF(btrim(COALESCE(pr2.full_name, '')), ''),
           s.avaliado_em,
           s.parecer,
           s.horas_concedidas,
           s.sobreavisos_concedidos,
           -- Resolvido no BANCO, linha a linha, como `podeAvaliar` da transferencia
           -- (20260828100000): a tela nao remonta a regra de escopo.
           public.fn_pode_autorizar_excecao_carga(s.servidor_id, s.mes, s.ano),
           (s.status = 'pendente'
            AND (s.solicitado_por = auth.uid()
                 OR public.fn_pode_autorizar_excecao_carga(s.servidor_id, s.mes, s.ano)))
      FROM public.solicitacoes_excecao_carga s
      JOIN public.servidores sv ON sv.id = s.servidor_id
      LEFT JOIN public.unidades u   ON u.id   = s.unidade_id
      LEFT JOIN public.profiles pr1 ON pr1.id = s.solicitado_por
      LEFT JOIN public.profiles pr2 ON pr2.id = s.avaliado_por
     WHERE (p_status IS NULL OR s.status = p_status)
       AND (p_mes    IS NULL OR s.mes = p_mes)
       AND (p_ano    IS NULL OR s.ano = p_ano)
       AND (
             s.solicitado_por = auth.uid()
             OR public.fn_pode_autorizar_excecao_carga(s.servidor_id, s.mes, s.ano)
             OR public.fn_pode_solicitar_excecao_carga(s.unidade_id, s.setor_id)
           )
     ORDER BY (s.status = 'pendente') DESC, s.solicitado_em DESC;
$fn$;


-- ============================================================================
-- PRIVILEGIOS (armadilha 24)
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_pode_solicitar_excecao_carga(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_solicitar_excecao_carga(uuid, uuid, integer, integer, text, numeric, integer, uuid, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_avaliar_solicitacao_excecao_carga(uuid, boolean, text, numeric, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cancelar_solicitacao_excecao_carga(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_solicitacoes_excecao_carga(text, integer, integer) FROM PUBLIC, anon;

-- fn_pode_solicitar_excecao_carga e avaliada DENTRO da policy de leitura, com os privilegios de
-- quem consulta: sem EXECUTE para authenticated, a tabela ficaria ilegivel (armadilha 39).
GRANT EXECUTE ON FUNCTION public.fn_pode_solicitar_excecao_carga(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_solicitar_excecao_carga(uuid, uuid, integer, integer, text, numeric, integer, uuid, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_avaliar_solicitacao_excecao_carga(uuid, boolean, text, numeric, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_solicitacao_excecao_carga(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_solicitacoes_excecao_carga(text, integer, integer) TO authenticated, service_role;

-- ATENCAO: o Supabase tem ALTER DEFAULT PRIVILEGES no schema public, entao TABELA NOVA pode
-- nascer com privilegio para anon sem ninguem ter escrito GRANT nenhum -- e o mesmo tipo de
-- surpresa da armadilha 24, um andar acima (la e funcao, aqui e tabela). A RLS ja barraria (a
-- policy de leitura e TO authenticated, e nao ha policy de escrita), mas privilegio que nao
-- deveria existir e' o que transforma um erro de policy futuro em vazamento.
REVOKE ALL ON TABLE public.solicitacoes_excecao_carga FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.solicitacoes_excecao_carga TO authenticated;
GRANT ALL ON TABLE public.solicitacoes_excecao_carga TO service_role;


-- ============================================================================
-- A MIGRATION CONFERE O PROPRIO RESULTADO
-- ============================================================================
DO $verificacao$
DECLARE
    v_f        text;
    v_escritas integer;
BEGIN
    FOREACH v_f IN ARRAY ARRAY[
        'public.fn_pode_solicitar_excecao_carga(uuid, uuid)',
        'public.fn_solicitar_excecao_carga(uuid, uuid, integer, integer, text, numeric, integer, uuid, numeric, numeric)',
        'public.fn_avaliar_solicitacao_excecao_carga(uuid, boolean, text, numeric, integer)',
        'public.fn_cancelar_solicitacao_excecao_carga(uuid)',
        'public.fn_solicitacoes_excecao_carga(text, integer, integer)'
    ] LOOP
        IF has_function_privilege('anon', v_f, 'EXECUTE') THEN
            RAISE EXCEPTION 'ABORTADO: % continua executavel por anon. Banco=%, usuario=%.',
                v_f, current_database(), current_user;
        END IF;
        IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
            RAISE EXCEPTION 'ABORTADO: % sem EXECUTE para authenticated -- a tela nao funcionaria.', v_f;
        END IF;
    END LOOP;

    -- Escrita direta pelo PostgREST tem de continuar impossivel: e o que garante que ninguem
    -- aprova o proprio pedido chamando a tabela em vez da RPC (armadilha 12).
    SELECT count(*) INTO v_escritas
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'solicitacoes_excecao_carga'
       AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');

    IF v_escritas <> 0 THEN
        RAISE EXCEPTION 'ABORTADO: % policy(ies) de escrita em solicitacoes_excecao_carga -- a escrita tem de ser so pelas RPCs.', v_escritas;
    END IF;

    -- A execucao e o que pega 42702 e nome de coluna errado (armadilha 42): funcao que existe
    -- nao e funcao que funciona. Filtro impossivel, entao nao devolve nada e nao escreve nada.
    PERFORM * FROM public.fn_solicitacoes_excecao_carga('pendente', 1, 1901);

    IF has_table_privilege('anon', 'public.solicitacoes_excecao_carga', 'SELECT')
    OR has_table_privilege('anon', 'public.solicitacoes_excecao_carga', 'INSERT') THEN
        RAISE EXCEPTION 'ABORTADO: anon tem privilegio na tabela solicitacoes_excecao_carga (default privileges do Supabase). Banco=%, usuario=%.',
            current_database(), current_user;
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.solicitacoes_excecao_carga', 'SELECT') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated sem SELECT -- a tela de Autorizacoes de Escala ficaria vazia.';
    END IF;

    RAISE NOTICE 'OK: solicitacoes_excecao_carga criada, escrita so por RPC, listagem executada com sucesso.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Como coordenador, estourar o teto numa grade: a mensagem tem de oferecer "Solicitar
--    autorizacao", e o pedido tem de aparecer em /autorizacoes-escala com status Pendente.
--
-- 2) Repetir o mesmo pedido: tem de ser recusado dizendo QUEM ja pediu e quando.
--
-- 3) Como RH da Unidade, aprovar concedendo MENOS horas que o pedido: o teto do servidor tem de
--    subir exatamente pelo valor concedido, e a grade tem de deixar salvar.
--
-- 4) Como RH da Unidade, sobre servidor fora do escopo: `pode_avaliar` tem de vir false e a RPC
--    tem de recusar (a tela nao e a defesa).
--
-- 5) Recusar sem parecer tem de falhar; recusar com parecer tem de fechar o pedido.
--
-- 6) Aprovar sobre servidor que JA tinha autorizacao de outra unidade: a resposta tem de trazer
--    `substituiu_anterior: true` com os valores antigos, e a tela tem de te-los mostrado antes.
