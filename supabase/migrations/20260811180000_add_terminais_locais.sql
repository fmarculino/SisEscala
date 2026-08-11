-- Migration: Terminais locais - ativacao por token do app local, sem sessao de coordenador
-- Data: 2026-08-11
--
-- MOTIVACAO
--   O terminal /presenca ativa hoje com supabase.auth.signInWithPassword() RODANDO NO
--   NAVEGADOR DA MAQUINA DO TERMINAL. Isso deixa uma sessao Supabase Auth completa de
--   coordenador/admin naquele navegador. Como o fluxo real e "coordenador ativa e vai
--   embora" (e isso precisa continuar assim), qualquer servidor com acesso fisico aquela
--   maquina pode abrir outra aba e navegar para a retaguarda autenticado como aquele
--   coordenador - a causa relatada de alteracoes indevidas no sistema.
--
--   A correcao nao e revogar a persistencia da sessao (quebraria o fluxo desejado). E parar
--   de colocar uma sessao de coordenador standalone naquele navegador. O app local que ja
--   esta sendo construido para falar com o relogio de ponto (coletor-rep) passa a tambem
--   poder abrir essa tela, autenticando por um token de dispositivo (o mesmo esquema ja
--   usado em dispositivos_rep/fn_autenticar_dispositivo_rep) em vez de email/senha.
--
-- POR QUE UMA TABELA NOVA, E NAO REAPROVEITAR dispositivos_rep
--   Sao coisas diferentes. dispositivos_rep e hardware REP-C sob a Portaria 671 (NSR, AFD,
--   cadeia de hash). Terminal local e so "quem pode abrir a tela /presenca-local" - a
--   marcacao continua nascendo com origem 'terminal', exatamente como hoje. Misturar as duas
--   tabelas conflaria dois conceitos legais distintos.
--
-- DECISOES JA CONFIRMADAS COM O USUARIO (2026-08-11)
--   1. Matricula fora da unidade/setor do terminal: BLOQUEADA, nunca aceita por ali.
--   2. Nesse terminal (ativado pelo app local), nao existe fallback de login por
--      email/senha - so o token do app local ativa. (O /presenca classico continua existindo
--      para unidades sem o app local; nao e alterado por esta migration.)
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE nas funcoes, DROP POLICY
-- IF EXISTS antes de recriar. Seguro rodar nos dois ambientes (CLAUDE.md armadilha 3).


-- ============================================================================
-- 1. TABELA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.terminais_locais (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                        text NOT NULL,
    unidade_id                  uuid NOT NULL REFERENCES public.unidades(id),
    setor_id                    uuid NULL REFERENCES public.setores(id),  -- NULL = qualquer setor da unidade
    -- Coordenador registrado como responsavel pelo terminal no momento do provisionamento.
    -- E o mesmo papel que p_coordenador_id sempre teve em fn_registrar_ponto: identificacao
    -- de quem supervisiona, nao uma sessao ao vivo (o proprio fn_registrar_ponto ja recebe
    -- esse id como parametro simples, sem validar contra auth.uid() - ver 20260808100000).
    responsavel_coordenador_id  uuid NOT NULL REFERENCES public.profiles(id),
    -- Credencial do app local. Exibida em texto claro uma unica vez na UI; aqui so o sha256.
    token_hash                  text,
    token_criado_em              timestamptz,
    token_criado_por_id           uuid REFERENCES public.profiles(id),
    ativo                        boolean NOT NULL DEFAULT true,
    ultimo_contato_em            timestamptz,
    ultimo_ip_origem             inet,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminais_locais_unidade
    ON public.terminais_locais (unidade_id) WHERE ativo;

COMMENT ON TABLE public.terminais_locais IS
    'Terminais de presenca ativados pelo app local (coletor-rep) via token de dispositivo, '
    'sem sessao Supabase Auth de coordenador no navegador. Restrito a unidade/setor.';
COMMENT ON COLUMN public.terminais_locais.ativo IS
    'Revogacao real do terminal. fn_registrar_ponto_terminal_local confere isto a cada '
    'marcacao - desativar aqui derruba qualquer sessao de navegador ja aberta na proxima batida.';
COMMENT ON COLUMN public.terminais_locais.setor_id IS
    'NULL = qualquer setor da unidade pode bater neste terminal. Preenchido = so aquele setor.';


-- ============================================================================
-- 2. RLS - gestao e so administrativa (mesmo padrao de dispositivos_rep)
-- ============================================================================

ALTER TABLE public.terminais_locais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestao de terminais locais por admin" ON public.terminais_locais;
CREATE POLICY "Gestao de terminais locais por admin" ON public.terminais_locais
    FOR ALL TO authenticated
    USING ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.terminais_locais FROM anon;


-- ============================================================================
-- 3. TOKEN DO TERMINAL - gerar (admin) e autenticar (service_role)
-- ============================================================================
-- Mesmo esquema de fn_gerar_token_dispositivo_rep/fn_autenticar_dispositivo_rep
-- (20260808080000): sha256 armazenado, texto claro devolvido uma unica vez.

CREATE OR REPLACE FUNCTION public.fn_gerar_token_terminal_local(p_terminal_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_token text;
BEGIN
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores podem gerar credencial de terminal local.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    UPDATE public.terminais_locais
       SET token_hash          = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
           token_criado_em     = now(),
           token_criado_por_id = auth.uid(),
           updated_at          = now()
     WHERE id = p_terminal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Terminal % nao encontrado.', p_terminal_id;
    END IF;

    RETURN v_token;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_gerar_token_terminal_local(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_autenticar_terminal_local(
    p_terminal_id uuid,
    p_token       text,
    p_ip          inet DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_hash  text;
    v_ativo boolean;
    v_ok    boolean;
BEGIN
    SELECT token_hash, ativo INTO v_hash, v_ativo
      FROM public.terminais_locais WHERE id = p_terminal_id;

    IF v_hash IS NULL OR NOT COALESCE(v_ativo, false) THEN
        RETURN false;
    END IF;

    v_ok := (v_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex'));

    IF v_ok THEN
        UPDATE public.terminais_locais
           SET ultimo_contato_em = now(),
               ultimo_ip_origem  = COALESCE(p_ip, ultimo_ip_origem)
         WHERE id = p_terminal_id;
    END IF;

    RETURN v_ok;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_autenticar_terminal_local(uuid, text, inet) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_autenticar_terminal_local(uuid, text, inet) TO service_role;


-- ============================================================================
-- 4. REGISTRO DE PONTO PELO TERMINAL LOCAL - escopo por unidade/setor
-- ============================================================================
-- NAO reescreve fn_confirmar_presenca nem fn_registrar_ponto (CLAUDE.md armadilha 1): so
-- confere escopo e delega. So alcancavel por service_role - a rota Next.js e que confere a
-- sessao do terminal (cookie assinado) antes de chamar isto, exatamente como
-- fn_solicitar_ajuste_ponto e alcancada so depois do portal validar o cookie do servidor.

CREATE OR REPLACE FUNCTION public.fn_registrar_ponto_terminal_local(
    p_terminal_id  uuid,
    p_matricula    text,
    p_pin_servidor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_terminal_unidade_id uuid;
    v_terminal_setor_id   uuid;
    v_terminal_ativo      boolean;
    v_responsavel_id      uuid;
    v_servidor_id         uuid;
    v_servidor_unidade_id uuid;
    v_servidor_setor_id   uuid;
BEGIN
    SELECT unidade_id, setor_id, ativo, responsavel_coordenador_id
      INTO v_terminal_unidade_id, v_terminal_setor_id, v_terminal_ativo, v_responsavel_id
      FROM public.terminais_locais
     WHERE id = p_terminal_id;

    IF v_terminal_unidade_id IS NULL OR NOT COALESCE(v_terminal_ativo, false) THEN
        RETURN jsonb_build_object(
            'success', false, 'tipo', 'erro',
            'message', 'Terminal desativado. Procure o administrador do sistema.');
    END IF;

    -- Mesma coluna que fn_registrar_ponto ja usa para gravar o contexto da marcacao
    -- (20260808100000) - nao inventa uma segunda definicao de "unidade do servidor".
    SELECT s.id, s.unidade_id, s.setor_id
      INTO v_servidor_id, v_servidor_unidade_id, v_servidor_setor_id
      FROM public.servidores s
     WHERE s.matricula = p_matricula;

    IF v_servidor_id IS NOT NULL
       AND (v_servidor_unidade_id IS DISTINCT FROM v_terminal_unidade_id
            OR (v_terminal_setor_id IS NOT NULL AND v_servidor_setor_id IS DISTINCT FROM v_terminal_setor_id))
    THEN
        -- Recusa ANTES de checar o PIN: uma matricula de outro setor nao aprende se o PIN
        -- digitado estaria certo.
        PERFORM public.fn_log_tentativa_negada(
            v_servidor_id, p_matricula, v_responsavel_id,
            'Terminal local: servidor fora da unidade/setor deste terminal.',
            NULL, NULL, NULL, NULL, NULL, NULL, NULL);
        RETURN jsonb_build_object(
            'success', false, 'tipo', 'erro',
            'message', 'Você não pertence a esta unidade/setor. Procure o terminal do seu setor.');
    END IF;

    -- Matricula desconhecida (v_servidor_id NULL) ou dentro do escopo: delega para o caminho
    -- normal, que ja trata identidade invalida e sempre registra a batida real.
    RETURN public.fn_registrar_ponto(p_matricula, p_pin_servidor, v_responsavel_id, NULL);
END;
$fn$;

COMMENT ON FUNCTION public.fn_registrar_ponto_terminal_local(uuid, text, text) IS
    'Entrada do terminal local (app coletor-rep). Confere que o terminal esta ativo e que a '
    'matricula pertence a unidade/setor do terminal, e delega para fn_registrar_ponto sem '
    'reescreve-la. service_role apenas - alcancavel so depois da rota validar a sessao do terminal.';

REVOKE ALL ON FUNCTION public.fn_registrar_ponto_terminal_local(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_ponto_terminal_local(uuid, text, text) TO service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) Tabela e policies existem:
--
--   SELECT count(*) FROM public.terminais_locais;  -- esperado: 0
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'terminais_locais';
--
--   2) Provisionar um terminal de teste e gerar token (como admin/super_admin):
--
--   INSERT INTO public.terminais_locais (nome, unidade_id, setor_id, responsavel_coordenador_id)
--        VALUES ('Terminal de teste', '<unidade_id>', '<setor_id>', '<coordenador_id>')
--     RETURNING id;
--   SELECT public.fn_gerar_token_terminal_local('<terminal_id>');  -- guarde o token devolvido
--
--   3) Autenticacao do dispositivo (via service_role, nunca do client):
--
--   SELECT public.fn_autenticar_terminal_local('<terminal_id>', '<token>');  -- esperado: true
--   SELECT public.fn_autenticar_terminal_local('<terminal_id>', 'token-errado');  -- esperado: false
--
--   4) Matricula dentro do escopo bate normalmente:
--
--   SELECT public.fn_registrar_ponto_terminal_local('<terminal_id>', '<matricula_do_setor>', '<pin>');
--   -- esperado: mesmo formato de fn_registrar_ponto (success/tipo/message)
--
--   5) Matricula de outra unidade/setor e recusada SEM checar o PIN:
--
--   SELECT public.fn_registrar_ponto_terminal_local('<terminal_id>', '<matricula_de_outro_setor>', '0000');
--   -- esperado: success=false, message contendo "não pertence a esta unidade/setor"
--   SELECT mensagem_erro FROM public.logs_tentativas_presenca ORDER BY data_hora_tentativa DESC LIMIT 1;
--   -- esperado: 'Terminal local: servidor fora da unidade/setor deste terminal.'
--
--   6) Desativar o terminal derruba a marcacao seguinte:
--
--   UPDATE public.terminais_locais SET ativo = false WHERE id = '<terminal_id>';
--   SELECT public.fn_registrar_ponto_terminal_local('<terminal_id>', '<matricula_do_setor>', '<pin>');
--   -- esperado: success=false, message = 'Terminal desativado. Procure o administrador do sistema.'
