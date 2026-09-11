-- ============================================================================
-- Migration: RH Geral e RH da Unidade passam a gerenciar relogios e terminais
-- Data: 2026-09-11
-- ============================================================================
--
-- MOTIVO
--
-- As 4 abas de infraestrutura de /marcacoes (Terminais Locais, Dispositivos REP, Higiene do
-- Relogio, Importar por Pendrive) estavam presas em ['admin','super_admin'] — na tela E nas
-- funcoes do banco por tras dela. Decisao do usuario em 10/09/2026: "os RHs precisam ter acesso
-- a todas as opcoes desta tela, RH Geral acesso total e RH da Unidade acesso as respectivas
-- unidades".
--
-- Medido em producao em 10/09/2026: 8 perfis `rh` (todos com acesso_todas_unidades) e 9
-- `rh_unidade` (4 no HMI, 5 no HMM). Cada RH do HMI alcanca 3 relogios; cada um do HMM, 6.
--
-- ⚠️ SO MEXER NA TELA NAO RESOLVE, e o modo de falha e' pior que o atual: a aba apareceria e o
-- botao morreria com "Apenas administradores podem...". As SEIS funcoes abaixo tem allowlist de
-- papel escrita a mao, todas anteriores a `rh`/`rh_unidade` existirem (armadilha 44 do
-- CLAUDE.md — allowlist envelhece em silencio).
--
-- FONTE UNICA
--
-- `fn_escopo_gestao_alcanca(unidade)` responde "este perfil alcanca esta unidade para gerir?".
-- Espelho exato de `unidadeNoEscopo` em src/utils/escopoGestao.ts — as duas pontas, uma regra:
--
--   super_admin · admin · rh   irrestrito
--   rh_unidade                 profile_unidades UNIAO unidades alcancadas por profile_setores
--   demais papeis              nenhuma unidade
--
-- ⚠️ O braco de `rh_unidade` NAO chama `fn_unidade_no_escopo`. Aquela funcao devolve true para
-- quem tem `acesso_todas_unidades`, e a flag e' uma CAIXA na tela de usuarios — um `rh_unidade`
-- com ela marcada passaria a gerir o parque inteiro no banco enquanto o TypeScript (que ignora a
-- flag para esse papel, mesma assimetria de avaliacaoTransferencia.ts) continuaria filtrando.
-- Divergencia entre tela e banco e' exatamente o que esta migration existe para nao criar.
--
-- ⚠️ `rh` entra por PAPEL, nao pela flag. Hoje os 8 tem `acesso_todas_unidades = true` e
-- `fn_unidade_no_escopo` ja os deixa passar por acidente de dado; um RH Geral criado sem marcar
-- a caixa veria a tela vazia sem nenhuma mensagem. "RH Geral enxerga tudo" e' a definicao do
-- papel (applyAccessFilters ja o trata assim) — tem que valer sem depender de checkbox.
--
-- O QUE ESTA MIGRATION NAO FAZ
--
-- Nao toca em `fn_unidade_no_escopo` (38 migrations dependem dela), nem nas policies de RLS.
-- ============================================================================

-- ============================================================================
-- 1. O PREDICADO COMPARTILHADO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_escopo_gestao_alcanca(p_unidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    -- auth.uid() NULL = service_role / SQL direto (Studio, script de conferencia): passa, mesmo
    -- criterio ja adotado em fn_blocos_previstos_dia e na cobertura de ponto. Sem isso a
    -- CONFERENCIA no fim deste arquivo reprovaria por falta de permissao.
    SELECT auth.uid() IS NULL
        OR EXISTS (
            SELECT 1
              FROM public.profiles p
             WHERE p.id = auth.uid()
               AND (
                    p.role IN ('super_admin'::public.user_role,
                               'admin'::public.user_role,
                               'rh'::public.user_role)
                 OR (
                        p.role = 'rh_unidade'::public.user_role
                    AND p_unidade_id IS NOT NULL
                    AND (
                            EXISTS (SELECT 1 FROM public.profile_unidades pu
                                     WHERE pu.profile_id = p.id
                                       AND pu.unidade_id = p_unidade_id)
                         OR public.fn_unidade_alcancavel_por_setor(p_unidade_id)
                        )
                    )
               )
        )
$fn$;

COMMENT ON FUNCTION public.fn_escopo_gestao_alcanca(uuid) IS
    'Este perfil alcanca esta unidade para GERIR (relogio, terminal, diagnostico de cadastro)? '
    'super_admin/admin/rh irrestritos; rh_unidade so profile_unidades + unidades alcancadas por '
    'setor vinculado; demais papeis nenhuma. Espelho de unidadeNoEscopo em '
    'src/utils/escopoGestao.ts. NAO usa fn_unidade_no_escopo de proposito: aquela honra '
    'acesso_todas_unidades, que e uma caixa da tela de usuarios e faria banco e tela divergirem.';

REVOKE ALL ON FUNCTION public.fn_escopo_gestao_alcanca(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_escopo_gestao_alcanca(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. TOKEN DO DISPOSITIVO REP
-- ============================================================================
-- Corpo copiado de 20260808080000. Muda so o guard.

CREATE OR REPLACE FUNCTION public.fn_gerar_token_dispositivo_rep(p_dispositivo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_token   text;
    v_unidade uuid;
BEGIN
    SELECT unidade_id INTO v_unidade FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade IS NULL AND NOT EXISTS (SELECT 1 FROM public.dispositivos_rep WHERE id = p_dispositivo_id) THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    IF NOT public.fn_escopo_gestao_alcanca(v_unidade) THEN
        RAISE EXCEPTION 'Sem permissao para gerar credencial de coletor deste equipamento.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 64 hex a partir de dois uuid v4. Evita depender da extensao pgcrypto (gen_random_bytes),
    -- que pode nao estar habilitada nos dois bancos (CLAUDE.md armadilha 3).
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    UPDATE public.dispositivos_rep
       SET token_hash        = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
           token_criado_em   = now(),
           token_criado_por_id = auth.uid(),
           updated_at        = now()
     WHERE id = p_dispositivo_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    -- Devolvido em texto claro UMA UNICA VEZ. O banco guarda apenas o sha256.
    RETURN v_token;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_gerar_token_dispositivo_rep(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gerar_token_dispositivo_rep(uuid) TO authenticated, service_role;


-- ============================================================================
-- 3. TOKEN DO TERMINAL LOCAL
-- ============================================================================
-- Corpo copiado de 20260811180000. Muda so o guard.

CREATE OR REPLACE FUNCTION public.fn_gerar_token_terminal_local(p_terminal_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_token   text;
    v_unidade uuid;
BEGIN
    SELECT unidade_id INTO v_unidade FROM public.terminais_locais WHERE id = p_terminal_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Terminal % nao encontrado.', p_terminal_id;
    END IF;

    IF NOT public.fn_escopo_gestao_alcanca(v_unidade) THEN
        RAISE EXCEPTION 'Sem permissao para gerar credencial deste terminal local.'
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

REVOKE ALL ON FUNCTION public.fn_gerar_token_terminal_local(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gerar_token_terminal_local(uuid) TO authenticated, service_role;


-- ============================================================================
-- 4. SETORES ATENDIDOS PELO DISPOSITIVO
-- ============================================================================
-- Corpo copiado de 20260813140000. Muda so o guard.

CREATE OR REPLACE FUNCTION public.fn_definir_setores_dispositivo_rep(
    p_dispositivo_id uuid,
    p_setor_ids      uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidade_id uuid;
    v_invalidos  integer;
    v_definidos  integer := 0;
BEGIN
    SELECT unidade_id INTO v_unidade_id FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    IF NOT public.fn_escopo_gestao_alcanca(v_unidade_id) THEN
        RAISE EXCEPTION 'Sem permissao para definir os setores deste dispositivo REP.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Nenhum setor pode ser de outra unidade - o dispositivo so atende a propria unidade
    -- (dispositivos_rep.unidade_id continua unico por dispositivo, ver plano de 13/08/2026).
    SELECT count(*) INTO v_invalidos
      FROM unnest(COALESCE(p_setor_ids, ARRAY[]::uuid[])) s(id)
     WHERE NOT EXISTS (
         SELECT 1 FROM public.setores se WHERE se.id = s.id AND se.unidade_id = v_unidade_id
     );
    IF v_invalidos > 0 THEN
        RAISE EXCEPTION '% setor(es) informado(s) nao pertence(m) a unidade deste dispositivo.', v_invalidos;
    END IF;

    -- Substitui o conjunto inteiro numa unica chamada (delete+insert atomicos por estarem na
    -- mesma funcao) - o cliente nunca faz delete/insert em duas chamadas REST separadas.
    DELETE FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;

    INSERT INTO public.dispositivos_rep_setores (dispositivo_id, setor_id, criado_por_id)
    SELECT p_dispositivo_id, s.id, auth.uid()
      FROM unnest(COALESCE(p_setor_ids, ARRAY[]::uuid[])) s(id)
     GROUP BY s.id;
    GET DIAGNOSTICS v_definidos = ROW_COUNT;

    RETURN jsonb_build_object('setores_definidos', v_definidos);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) TO authenticated, service_role;


-- ============================================================================
-- 5. HIGIENE — LISTAR CADASTROS DO RELOGIO
-- ============================================================================
-- Corpo copiado de 20260812040000. Muda so o guard: o de papel sai, e o de escopo (que ja
-- existia, com fn_unidade_no_escopo) passa a ser o predicado novo — que ja embute o papel.

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
    IF NOT EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = p_dispositivo_id AND public.fn_escopo_gestao_alcanca(d.unidade_id)
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

REVOKE ALL ON FUNCTION public.fn_higiene_usuarios_dispositivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_higiene_usuarios_dispositivo(uuid) TO authenticated, service_role;


-- ============================================================================
-- 6. HIGIENE — ENFILEIRAR REMOCAO
-- ============================================================================
-- Corpo copiado de 20260812040000. Muda so o guard.
--
-- ⚠️ A recusa de quem tem servidor Ativo casando NAO sai daqui. Ela e' o que impede a higiene de
-- apagar do relogio quem esta batendo ponto — e agora ha mais gente com o botao na mao.

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
    IF NOT EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = p_dispositivo_id AND public.fn_escopo_gestao_alcanca(d.unidade_id)
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

REVOKE ALL ON FUNCTION public.fn_enfileirar_remocao_usuarios_dispositivo(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_enfileirar_remocao_usuarios_dispositivo(uuid, text[]) TO authenticated, service_role;


-- ============================================================================
-- 7. SUBSTITUICAO DE EQUIPAMENTO
-- ============================================================================
-- Corpo copiado de 20260906140000. Muda so o guard.
--
-- ⚠️ Trocar a geracao muda como todo o AFD daquele ponto e' lido dali em diante, e e' a unica
-- parte irreversivel da troca de relogio. Continua exigindo motivo de 5 caracteres e continua
-- fora do alcance de coordenador; o que muda e' que o RH da unidade daquele equipamento tambem
-- registra a troca — e' ele quem esta na unidade quando o aparelho queima.

CREATE OR REPLACE FUNCTION public.fn_registrar_substituicao_dispositivo(
    p_dispositivo_id  uuid,
    p_motivo          text,
    p_numero_serie_novo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnsub$
DECLARE
    v_disp        public.dispositivos_rep%ROWTYPE;
    v_nsr_max     bigint;
    v_registros   bigint;
    v_nova        smallint;
BEGIN
    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
        RAISE EXCEPTION 'Informe o motivo da substituicao (minimo 5 caracteres).';
    END IF;

    SELECT * INTO v_disp FROM public.dispositivos_rep WHERE id = p_dispositivo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;
    END IF;

    IF NOT public.fn_escopo_gestao_alcanca(v_disp.unidade_id) THEN
        RAISE EXCEPTION 'Sem permissao para registrar substituicao deste equipamento.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(MAX(r.nsr), 0), COUNT(*)
      INTO v_nsr_max, v_registros
      FROM public.rep_afd_registros r
     WHERE r.dispositivo_id = p_dispositivo_id
       AND r.geracao = v_disp.geracao_atual;

    v_nova := v_disp.geracao_atual + 1;

    INSERT INTO public.dispositivos_rep_substituicoes (
        dispositivo_id, geracao_anterior, geracao_nova,
        nsr_max_anterior, registros_anteriores, motivo,
        numero_serie_anterior, numero_serie_novo, registrado_por_id)
    VALUES (
        p_dispositivo_id, v_disp.geracao_atual, v_nova,
        v_nsr_max, v_registros, btrim(p_motivo),
        v_disp.numero_serie, p_numero_serie_novo, auth.uid());

    UPDATE public.dispositivos_rep
       SET geracao_atual = v_nova,
           -- ultimo_nsr e' denormalizado e so' informativo. Mante-lo com o maximo da geracao
           -- anterior faria a tela afirmar que o equipamento novo ja coletou 111 mil linhas.
           --
           -- ⚠️ ZERO, nunca NULL: a coluna e' `bigint NOT NULL DEFAULT 0` desde 20260808000000,
           -- e "nada ainda" nesta tabela sempre foi 0. A primeira versao escrevia NULL e morria
           -- com 23502 na primeira execucao real - plpgsql so descobre isso EXECUTANDO.
           ultimo_nsr    = 0,
           numero_serie  = COALESCE(p_numero_serie_novo, numero_serie),
           updated_at    = now()
     WHERE id = p_dispositivo_id;

    RETURN jsonb_build_object(
        'sucesso', true,
        'geracao_anterior', v_disp.geracao_atual,
        'geracao_nova', v_nova,
        'nsr_max_anterior', v_nsr_max,
        'registros_anteriores', v_registros,
        'cursor_novo', public.fn_cursor_afd_dispositivo(p_dispositivo_id));
END;
$fnsub$;

REVOKE ALL ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA — EXECUTA as funcoes, com sessao simulada
-- ============================================================================
--
-- 🚨 MIGRATION RODA COMO service_role, e `fn_escopo_gestao_alcanca` devolve TRUE quando
-- auth.uid() e' NULL. Conferir sem simular sessao exercitaria justamente o caminho em que o
-- guard nao roda — "passaria" sem ter testado nada (a licao de 20260909170000). Por isso cada
-- caso publica um JWT sintetico, local a transacao.
--
-- Confere os DOIS sentidos. Afrouxar demais aqui e' pior que nao ter mudado nada: o predicado
-- decide quem gera credencial de coletor e quem apaga cadastro de relogio.

DO $conf$
DECLARE
    v_super      uuid;
    v_rh         uuid;
    v_rh_unid    uuid;
    v_coord      uuid;
    v_unid_dele  uuid;
    v_unid_outra uuid;
    v_ok         boolean;
BEGIN
    SELECT id INTO v_super FROM public.profiles WHERE role = 'super_admin' LIMIT 1;
    SELECT id INTO v_rh    FROM public.profiles WHERE role = 'rh' LIMIT 1;
    SELECT id INTO v_coord FROM public.profiles WHERE role = 'coordenador' LIMIT 1;

    SELECT p.id, pu.unidade_id INTO v_rh_unid, v_unid_dele
      FROM public.profiles p
      JOIN public.profile_unidades pu ON pu.profile_id = p.id
     WHERE p.role = 'rh_unidade'
     LIMIT 1;

    SELECT u.id INTO v_unid_outra
      FROM public.unidades u
     WHERE v_unid_dele IS NULL OR u.id <> v_unid_dele
     LIMIT 1;

    IF v_super IS NULL OR v_rh IS NULL OR v_rh_unid IS NULL OR v_unid_outra IS NULL THEN
        RAISE NOTICE 'CONFERENCIA PULADA: faltam perfis (super=% rh=% rh_unidade=% outra_unidade=%).',
                     v_super, v_rh, v_rh_unid, v_unid_outra;
        RETURN;
    END IF;

    -- 1) RH Geral alcanca uma unidade a que NAO esta vinculado (o ponto da mudanca).
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_rh::text, 'role', 'authenticated')::text, true);
    v_ok := public.fn_escopo_gestao_alcanca(v_unid_outra);
    IF NOT v_ok THEN
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE EXCEPTION 'ABORTADO: RH Geral nao alcanca unidade fora do vinculo dele — a '
                        'mudanca nao pegou (ou o papel esta fora da lista de irrestritos).';
    END IF;

    -- 2) RH da Unidade alcanca a unidade DELE...
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_rh_unid::text, 'role', 'authenticated')::text, true);
    v_ok := public.fn_escopo_gestao_alcanca(v_unid_dele);
    IF NOT v_ok THEN
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE EXCEPTION 'ABORTADO: RH da Unidade nao alcanca a propria unidade %.', v_unid_dele;
    END IF;

    -- 3) ...e NAO alcanca a de fora. Este e o sentido que nao pode afrouxar.
    v_ok := public.fn_escopo_gestao_alcanca(v_unid_outra);
    IF v_ok THEN
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE EXCEPTION 'ABORTADO: RH da Unidade alcanca unidade FORA do escopo dele (%) — o '
                        'predicado esta liberando o parque inteiro.', v_unid_outra;
    END IF;

    -- 4) Unidade NULA nunca passa para quem e escopado (na duvida, fecha).
    v_ok := public.fn_escopo_gestao_alcanca(NULL);
    IF v_ok THEN
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE EXCEPTION 'ABORTADO: unidade NULL passou para rh_unidade.';
    END IF;

    -- 5) Coordenador continua sem gerir NADA — a mudanca e para os RHs, nao para todo gestor.
    IF v_coord IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',
                           json_build_object('sub', v_coord::text, 'role', 'authenticated')::text, true);
        IF public.fn_escopo_gestao_alcanca(v_unid_dele) OR public.fn_escopo_gestao_alcanca(v_unid_outra) THEN
            PERFORM set_config('request.jwt.claims', '', true);
            RAISE EXCEPTION 'ABORTADO: coordenador passou a gerir relogio/terminal.';
        END IF;
    END IF;

    -- 6) Administrador Geral continua alcancando tudo.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);
    IF NOT public.fn_escopo_gestao_alcanca(v_unid_outra) THEN
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE EXCEPTION 'ABORTADO: Administrador Geral perdeu alcance.';
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE 'OK: rh irrestrito | rh_unidade so na propria (% ) e recusado em % | NULL fecha | coordenador fora | super_admin intacto',
                 v_unid_dele, v_unid_outra;
END;
$conf$;


-- Segundo bloco: as funcoes REAIS respondem ao predicado novo. Executa a mais barata
-- (fn_higiene_usuarios_dispositivo e STABLE, so le) contra um dispositivo real, nos dois
-- sentidos. Nao executa as que ESCREVEM (token, setores, substituicao) — token gerado aqui
-- invalidaria o coletor de uma unidade de producao.
DO $conf2$
DECLARE
    v_rh_unid   uuid;
    v_unid_dele uuid;
    v_disp_dele uuid;
    v_disp_fora uuid;
    v_ok_dele   boolean := false;
    v_ok_fora   boolean := false;
BEGIN
    SELECT p.id, pu.unidade_id INTO v_rh_unid, v_unid_dele
      FROM public.profiles p
      JOIN public.profile_unidades pu ON pu.profile_id = p.id
     WHERE p.role = 'rh_unidade'
     LIMIT 1;

    SELECT id INTO v_disp_dele FROM public.dispositivos_rep WHERE unidade_id = v_unid_dele LIMIT 1;
    SELECT id INTO v_disp_fora FROM public.dispositivos_rep WHERE unidade_id IS DISTINCT FROM v_unid_dele LIMIT 1;

    IF v_rh_unid IS NULL OR v_disp_dele IS NULL OR v_disp_fora IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 2 PULADA: faltam dispositivos para exercitar (dele=% fora=%).',
                     v_disp_dele, v_disp_fora;
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_rh_unid::text, 'role', 'authenticated')::text, true);

    BEGIN
        PERFORM 1 FROM public.fn_higiene_usuarios_dispositivo(v_disp_dele) LIMIT 1;
        v_ok_dele := true;
    EXCEPTION WHEN insufficient_privilege THEN
        v_ok_dele := false;
    END;

    BEGIN
        PERFORM 1 FROM public.fn_higiene_usuarios_dispositivo(v_disp_fora) LIMIT 1;
        v_ok_fora := true;
    EXCEPTION WHEN insufficient_privilege THEN
        v_ok_fora := false;
    END;

    PERFORM set_config('request.jwt.claims', '', true);

    IF NOT v_ok_dele THEN
        RAISE EXCEPTION 'ABORTADO: RH da Unidade continua recusado na Higiene do proprio relogio (%).', v_disp_dele;
    END IF;
    IF v_ok_fora THEN
        RAISE EXCEPTION 'ABORTADO: RH da Unidade leu a Higiene de um relogio de OUTRA unidade (%).', v_disp_fora;
    END IF;

    RAISE NOTICE 'OK: higiene liberada no relogio da unidade dele (%) e recusada no de fora (%).',
                 v_disp_dele, v_disp_fora;
END;
$conf2$;
