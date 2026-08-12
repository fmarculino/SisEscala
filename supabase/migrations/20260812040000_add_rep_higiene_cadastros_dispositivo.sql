-- Migration: higiene de cadastros do dispositivo REP (usuarios antigos de outro sistema)
-- Data: 2026-08-12
--
-- MOTIVACAO
--   Instalacao real na segunda unidade (LACEN, 12/08/2026, primeira fora do piloto da TI)
--   revelou o problema que o plano original so previa em tese: o rele e' um REP-C ja usado por
--   OUTRO sistema antes do SisEscala. Ele chega com cadastros de usuario (load_users.fcgi) de
--   gente que pode nao fazer mais parte do quadro - e nao existe hoje um jeito de ver quem sao
--   nem de tirar do equipamento.
--
--   O medo do usuario era o historico de marcacao antigo (rep_afd_registros) "contaminar" folha
--   de ponto de servidor nenhum. Isso ja NAO acontece por construcao: fn_ingerir_afd so cria
--   marcacao com servidor_id preenchido quando existe rep_vinculos_servidor vigente para o
--   identificador_afd daquela batida (20260808080000, secao 3.4) - sem vinculo, a marcacao entra
--   como orfa, visivel para auditoria mas sem efeito nenhum em escala_diaria. Confirmado ao vivo
--   no log do coletor da LACEN: os ~34.500 registros tipo 3 do historico do rele deram
--   marcacoes == orfas em TODO lote, porque rep_vinculos_servidor estava vazio ate a primeira
--   identidade (Fase 7) ser empurrada. Por isso esta migration NAO mexe em rep_afd_registros nem
--   em marcacoes_ponto - so' cadastro de USUARIO do equipamento, que e' dado gerenciavel.
--
--   Tambem nao existe (nem deveria existir) um "zerar o rele": a memoria do AFD e' desenhada
--   para ser inviolavel (Portaria 671/2021, e' o que da ao REP-C seu valor como prova legal) -
--   um botao de reset no SisEscala minaria essa garantia, e nao ha confirmacao de que a API do
--   equipamento sequer exponha uma operacao dessas. O historico organico nao vinculado ja e'
--   inofensivo por design; o unico problema real e' o CADASTRO DE USUARIO desatualizado, que
--   ESTA sob controle da API (add_users/load_users/remove_users.fcgi, mesma familia ja validada
--   contra hardware real na Fase 7 - CLAUDE.md).
--
-- FLUXO
--   1. coletor roda `coletor-rep higiene` (so leitura no rele - load_users.fcgi) e reporta o
--      snapshot completo via POST /api/rep/v1/usuarios-dispositivo -> fn_registrar_snapshot_usuarios_dispositivo.
--   2. Tela em /marcacoes mostra cada usuario do rele casado (ou nao) com servidor ativo do
--      SisEscala (fn_higiene_usuarios_dispositivo). Quem bate com servidor ativo fica marcado
--      como "manter" (nao selecionavel para remocao, protegido no proprio RPC de enfileirar).
--      Quem nao bate e' candidato a remocao.
--   3. Admin seleciona quem remover -> fn_enfileirar_remocao_usuarios_dispositivo (INSERT em
--      rep_remocoes_fila).
--   4. coletor roda `coletor-rep higiene-remover` (GRAVA no equipamento -
--      remove_users.fcgi, NAO VALIDADA contra hardware real ainda, ver aviso em rep/client.go),
--      aplica cada remocao e confirma via POST /api/rep/v1/remocoes -> fn_confirmar_remocao_usuario_dispositivo.
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE nas funcoes, DROP POLICY
-- IF EXISTS antes de recriar. Seguro rodar nos dois ambientes (CLAUDE.md armadilha 3).


-- ============================================================================
-- 1. SNAPSHOT DE USUARIOS DO DISPOSITIVO (o que existe no rele HOJE, por load_users.fcgi)
-- ============================================================================
-- Substituido por inteiro a cada relato do coletor (fn_registrar_snapshot_usuarios_dispositivo
-- apaga e reinsere) - nao ha tentativa de reconciliar incrementalmente quem foi removido
-- manualmente na telinha do equipamento entre uma leitura e outra; a proxima leitura corrige
-- sozinha.

CREATE TABLE IF NOT EXISTS public.rep_usuarios_dispositivo (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id     uuid NOT NULL REFERENCES public.dispositivos_rep(id),
    identificador_afd  text NOT NULL,       -- campo 'pis' do device (CLAUDE.md armadilha 10)
    registration_bruto text,                -- campo 'registration' do device, como veio (pode nao ser matricula do SisEscala)
    nome_no_device     text,
    tem_biometria      boolean NOT NULL DEFAULT false,
    servidor_id        uuid REFERENCES public.servidores(id),   -- resolvido por vinculo ou por CPF, ver funcao abaixo
    origem_match       text CHECK (origem_match IS NULL OR origem_match IN ('vinculo', 'cpf')),
    atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_dispositivo
    ON public.rep_usuarios_dispositivo (dispositivo_id, identificador_afd);

COMMENT ON TABLE public.rep_usuarios_dispositivo IS
    'Snapshot de quem esta cadastrado no rele agora (load_users.fcgi), reportado pelo coletor. '
    'servidor_id NULL = nao corresponde a nenhum servidor ativo do SisEscala - candidato a '
    'remocao (ex.: cadastro de outro sistema que usava o mesmo equipamento antes).';

ALTER TABLE public.rep_usuarios_dispositivo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestao de snapshot de usuarios do dispositivo por admin" ON public.rep_usuarios_dispositivo;
CREATE POLICY "Gestao de snapshot de usuarios do dispositivo por admin" ON public.rep_usuarios_dispositivo
    FOR ALL TO authenticated
    USING ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_usuarios_dispositivo FROM anon;
GRANT SELECT ON public.rep_usuarios_dispositivo TO authenticated, service_role;


-- ============================================================================
-- 2. FILA DE REMOCAO (o que foi selecionado na tela para tirar do equipamento)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rep_remocoes_fila (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id   uuid NOT NULL REFERENCES public.dispositivos_rep(id),
    identificador_afd text NOT NULL,
    nome_no_device   text,               -- copia no momento do enfileiramento, para auditoria mesmo apos remover
    status           text NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'removido', 'falhou')),
    erro             text,
    tentativas       integer NOT NULL DEFAULT 0,
    solicitado_por_id uuid REFERENCES public.profiles(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    processado_em    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_remocao_fila_pendente
    ON public.rep_remocoes_fila (dispositivo_id, identificador_afd)
    WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_remocao_fila_dispositivo_status
    ON public.rep_remocoes_fila (dispositivo_id, status);

COMMENT ON TABLE public.rep_remocoes_fila IS
    'Fila de remocao de usuario do dispositivo REP (higiene de cadastros de outro sistema). '
    'Nunca enfileira quem tem rep_vinculos_servidor vigente para um servidor Ativo - guard em '
    'fn_enfileirar_remocao_usuarios_dispositivo, nao so na tela.';

ALTER TABLE public.rep_remocoes_fila ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestao de fila de remocao REP por admin" ON public.rep_remocoes_fila;
CREATE POLICY "Gestao de fila de remocao REP por admin" ON public.rep_remocoes_fila
    FOR ALL TO authenticated
    USING ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_remocoes_fila FROM anon;
GRANT SELECT ON public.rep_remocoes_fila TO authenticated, service_role;


-- ============================================================================
-- 3. REGISTRAR SNAPSHOT (coletor, via POST /api/rep/v1/usuarios-dispositivo) - service_role
-- ============================================================================
-- p_usuarios: array de {identificador_afd, registration_bruto, nome, tem_biometria}. Resolve
-- servidor_id em duas camadas, na ordem: (1) rep_vinculos_servidor vigente para este
-- identificador neste dispositivo - fonte ja confirmada pela Fase 7; (2) sem vinculo, tenta CPF
-- batendo com servidor Ativo (mesmo criterio 'cpf' de fn_vinculos_sugeridos_afd) - candidato a
-- vincular, nao a remover, mesmo que ainda nao esteja em rep_vinculos_servidor.

CREATE OR REPLACE FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(
    p_dispositivo_id uuid,
    p_usuarios       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_total integer := 0;
    v_sem_match integer := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.dispositivos_rep WHERE id = p_dispositivo_id) THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    DELETE FROM public.rep_usuarios_dispositivo WHERE dispositivo_id = p_dispositivo_id;

    WITH entrada AS (
        SELECT
            btrim(u->>'identificador_afd')                         AS identificador_afd,
            NULLIF(btrim(u->>'registration_bruto'), '')             AS registration_bruto,
            NULLIF(btrim(u->>'nome'), '')                           AS nome,
            COALESCE((u->>'tem_biometria')::boolean, false)         AS tem_biometria
          FROM jsonb_array_elements(COALESCE(p_usuarios, '[]'::jsonb)) AS u
         WHERE btrim(COALESCE(u->>'identificador_afd', '')) <> ''
    ),
    resolvido AS (
        SELECT e.*,
               COALESCE(vinc.servidor_id, cpf_match.id)             AS servidor_id,
               CASE WHEN vinc.servidor_id IS NOT NULL THEN 'vinculo'
                    WHEN cpf_match.id IS NOT NULL THEN 'cpf'
                    ELSE NULL END                                   AS origem_match
          FROM entrada e
          LEFT JOIN public.rep_vinculos_servidor vinc
            ON vinc.dispositivo_id = p_dispositivo_id
           AND vinc.identificador_afd = e.identificador_afd
           AND vinc.vigente_ate IS NULL
          LEFT JOIN public.servidores cpf_match
            ON cpf_match.status = 'Ativo'
           AND right(regexp_replace(COALESCE(cpf_match.cpf, ''), '\D', '', 'g'), 11)
               = right(e.identificador_afd, 11)
           AND length(regexp_replace(COALESCE(cpf_match.cpf, ''), '\D', '', 'g')) >= 11
    ),
    inseridos AS (
        INSERT INTO public.rep_usuarios_dispositivo
               (dispositivo_id, identificador_afd, registration_bruto, nome_no_device,
                tem_biometria, servidor_id, origem_match)
        SELECT p_dispositivo_id, identificador_afd, registration_bruto, nome,
               tem_biometria, servidor_id, origem_match
          FROM resolvido
        RETURNING servidor_id
    )
    SELECT count(*), count(*) FILTER (WHERE servidor_id IS NULL)
      INTO v_total, v_sem_match
      FROM inseridos;

    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) TO service_role;


-- ============================================================================
-- 4. TELA DE HIGIENE (admin/super_admin, escopo por unidade do dispositivo)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_higiene_usuarios_dispositivo(p_dispositivo_id uuid)
RETURNS TABLE (
    identificador_afd  text,
    registration_bruto text,
    nome_no_device     text,
    tem_biometria      boolean,
    servidor_id        uuid,
    servidor_nome      text,
    servidor_matricula text,
    servidor_status    text,
    origem_match       text,
    fila_status        text,
    pode_remover       boolean,
    atualizado_em      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores podem ver o cadastro de usuarios do rele.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = p_dispositivo_id AND public.fn_unidade_no_escopo(d.unidade_id)
    ) THEN
        RAISE EXCEPTION 'Voce nao tem acesso a este dispositivo.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT u.identificador_afd, u.registration_bruto, u.nome_no_device, u.tem_biometria,
           u.servidor_id, s.nome, s.matricula, s.status::text, u.origem_match,
           f.status,
           -- So' pode remover quando NAO existe servidor Ativo casando (nem por vinculo, nem
           -- por CPF) - o mesmo guard que fn_enfileirar_remocao_usuarios_dispositivo aplica de
           -- verdade; aqui e' so' para a tela nao oferecer a opcao.
           (s.id IS NULL OR s.status IS DISTINCT FROM 'Ativo') AND f.status IS DISTINCT FROM 'pendente' AS pode_remover,
           u.atualizado_em
      FROM public.rep_usuarios_dispositivo u
      LEFT JOIN public.servidores s ON s.id = u.servidor_id
      LEFT JOIN public.rep_remocoes_fila f
        ON f.dispositivo_id = u.dispositivo_id AND f.identificador_afd = u.identificador_afd AND f.status = 'pendente'
     WHERE u.dispositivo_id = p_dispositivo_id
     ORDER BY (s.id IS NOT NULL) DESC, u.nome_no_device;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_higiene_usuarios_dispositivo(uuid) TO authenticated;


-- ============================================================================
-- 5. ENFILEIRAR REMOCAO (admin/super_admin, pela tela)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enfileirar_remocao_usuarios_dispositivo(
    p_dispositivo_id    uuid,
    p_identificadores_afd text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_enfileirados integer := 0;
    v_bloqueados   integer := 0;
BEGIN
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores podem remover cadastros do rele.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = p_dispositivo_id AND public.fn_unidade_no_escopo(d.unidade_id)
    ) THEN
        RAISE EXCEPTION 'Voce nao tem acesso a este dispositivo.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    WITH candidatos AS (
        SELECT u.identificador_afd, u.nome_no_device, u.servidor_id, s.status AS servidor_status
          FROM public.rep_usuarios_dispositivo u
          LEFT JOIN public.servidores s ON s.id = u.servidor_id
         WHERE u.dispositivo_id = p_dispositivo_id
           AND u.identificador_afd = ANY(p_identificadores_afd)
    ),
    bloqueados AS (
        SELECT count(*) AS n FROM candidatos
         WHERE servidor_id IS NOT NULL AND servidor_status = 'Ativo'
    ),
    inseridos AS (
        INSERT INTO public.rep_remocoes_fila (dispositivo_id, identificador_afd, nome_no_device, solicitado_por_id)
        SELECT p_dispositivo_id, c.identificador_afd, c.nome_no_device, auth.uid()
          FROM candidatos c
         WHERE NOT (c.servidor_id IS NOT NULL AND c.servidor_status = 'Ativo')
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_remocoes_fila f
                  WHERE f.dispositivo_id = p_dispositivo_id AND f.identificador_afd = c.identificador_afd
                    AND f.status = 'pendente')
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos), (SELECT n FROM bloqueados)
      INTO v_enfileirados, v_bloqueados;

    RETURN jsonb_build_object('enfileirados', v_enfileirados, 'bloqueados_por_vinculo_ativo', v_bloqueados);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_enfileirar_remocao_usuarios_dispositivo(uuid, text[]) TO authenticated;


-- ============================================================================
-- 6. LISTAR/CONFIRMAR REMOCOES (coletor, via /api/rep/v1/remocoes) - service_role apenas
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_remocoes_pendentes_dispositivo(p_dispositivo_id uuid)
RETURNS TABLE (fila_id uuid, identificador_afd text, nome_no_device text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT f.id, f.identificador_afd, f.nome_no_device
      FROM public.rep_remocoes_fila f
     WHERE f.dispositivo_id = p_dispositivo_id
       AND f.status = 'pendente'
     ORDER BY f.created_at
$fn$;

REVOKE ALL ON FUNCTION public.fn_remocoes_pendentes_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remocoes_pendentes_dispositivo(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(
    p_fila_id uuid,
    p_sucesso boolean,
    p_erro    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_dispositivo_id  uuid;
    v_identificador   text;
BEGIN
    SELECT dispositivo_id, identificador_afd INTO v_dispositivo_id, v_identificador
      FROM public.rep_remocoes_fila WHERE id = p_fila_id AND status = 'pendente';

    IF v_dispositivo_id IS NULL THEN
        RETURN; -- ja processado ou id invalido - idempotente, sem erro (reenvio seguro)
    END IF;

    IF NOT p_sucesso THEN
        UPDATE public.rep_remocoes_fila
           SET status = 'falhou', erro = p_erro, tentativas = tentativas + 1, processado_em = now()
         WHERE id = p_fila_id;
        RETURN;
    END IF;

    UPDATE public.rep_remocoes_fila
       SET status = 'removido', processado_em = now()
     WHERE id = p_fila_id;

    -- Removido de verdade do equipamento - tira tambem do snapshot (nao esta mais la) e fecha
    -- qualquer vinculo que por acaso existisse (defensivo: o guard em
    -- fn_enfileirar_remocao_usuarios_dispositivo ja deveria ter impedido chegar aqui com vinculo
    -- ativo, mas o servidor pode ter sido desativado depois do enfileiramento e antes da remocao).
    DELETE FROM public.rep_usuarios_dispositivo
     WHERE dispositivo_id = v_dispositivo_id AND identificador_afd = v_identificador;

    UPDATE public.rep_vinculos_servidor
       SET vigente_ate = now()
     WHERE dispositivo_id = v_dispositivo_id AND identificador_afd = v_identificador AND vigente_ate IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text) TO service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Objetos existem:
--
--   SELECT count(*) FROM public.rep_usuarios_dispositivo; -- esperado: 0
--   SELECT count(*) FROM public.rep_remocoes_fila;         -- esperado: 0
--
--   2) Simular um snapshot com um usuario sem correspondencia e um com CPF de servidor ativo:
--
--   SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--            '<dispositivo_id>',
--            '[{"identificador_afd":"999999999999","registration_bruto":"12345","nome":"FULANO ANTIGO","tem_biometria":true}]'::jsonb);
--   -- esperado: {"total": 1, "sem_correspondencia": 1}
--
--   3) Tela (como admin/super_admin):
--
--   SELECT * FROM public.fn_higiene_usuarios_dispositivo('<dispositivo_id>');
--   -- esperado: a linha acima com servidor_id NULL e pode_remover = true
--
--   4) Enfileirar remocao e conferir bloqueio para quem tem vinculo ativo:
--
--   SELECT public.fn_enfileirar_remocao_usuarios_dispositivo('<dispositivo_id>', ARRAY['999999999999']);
--   -- esperado: {"enfileirados": 1, "bloqueados_por_vinculo_ativo": 0}
--
--   5) Confirmar como o coletor confirmaria:
--
--   SELECT public.fn_confirmar_remocao_usuario_dispositivo('<fila_id>', true, NULL);
--   SELECT * FROM public.rep_usuarios_dispositivo WHERE identificador_afd = '999999999999'; -- esperado: 0 linhas
