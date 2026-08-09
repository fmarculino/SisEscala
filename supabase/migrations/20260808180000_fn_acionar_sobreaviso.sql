-- Migration: o acionamento de sobreaviso vira RPC com regra no banco
-- Fase 4 do plano docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
--
-- ESTADO ANTERIOR
--   O acionamento era um INSERT direto do navegador (ScaleGrid.tsx:1569) sob uma policy
--   FOR ALL. Todas as travas viviam no frontend:
--     - janela ativa do plantao      -> ScaleGrid.tsx:4260 (heuristica propria)
--     - "ja tem chamado em aberto"   -> ScaleGrid.tsx:4258
--   Com a policy FOR ALL, um coordenador podia gravar QUALQUER linha dentro do escopo dele -
--   inclusive status = 'Chegou', sem token, sem GPS, sem ninguem aceitar nada.
--
--   Isso era tolerável enquanto o acionamento morava dentro da grade da escala e so o dono do
--   setor chegava la. O painel global da Fase 6 acaba com essa premissa, e ainda cria uma
--   corrida: dois coordenadores de unidades diferentes acionando a mesma pessoa ao mesmo tempo.
--
-- O QUE MUDA
--   1. fn_pode_acionar_sobreaviso - a regra de abrangencia, em um lugar so
--   2. fn_acionar_sobreaviso      - o unico caminho de acionamento
--   3. indice unico parcial       - fecha a corrida (a checagem 5 sozinha nao e atomica)
--   4. policy sem INSERT          - o INSERT direto deixa de existir para o cliente

-- ---------------------------------------------------------------------------
-- 1. A regra de abrangencia, em um lugar so
-- ---------------------------------------------------------------------------
-- Espelha a policy "Admins e Coordenadores gerenciam logs_sobreaviso" (20260618080000) e
-- acrescenta UMA porta: setor de abrangencia 'geral' libera qualquer coordenador/admin.
--
-- Nao se usa fn_unidade_no_escopo aqui de proposito: aquela funcao trata TODO admin como se
-- tivesse acesso a todas as unidades, o que e mais largo do que a policy desta tabela. Usar
-- ela aqui ampliaria silenciosamente quem pode acionar.
CREATE OR REPLACE FUNCTION public.fn_pode_acionar_sobreaviso(p_escala_mensal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.escala_mensal em
          JOIN public.setores  s ON s.id = em.setor_id
          JOIN public.profiles p ON p.id = auth.uid()
         WHERE em.id = p_escala_mensal_id
           AND (
                p.role = 'super_admin'::public.user_role
             OR (
                    p.role IN ('admin'::public.user_role, 'coordenador'::public.user_role)
                AND (
                     -- a porta nova: sobreaviso que atende a rede inteira
                     s.sobreaviso_abrangencia = 'geral'
                     -- e o escopo de sempre, identico ao da policy da tabela
                  OR COALESCE(p.acesso_todas_unidades, false)
                  OR COALESCE(p.acesso_todos_setores, false)
                  OR EXISTS (
                        SELECT 1 FROM public.profile_setores ps
                         WHERE ps.profile_id = p.id AND ps.setor_id = em.setor_id
                     )
                )
             )
           )
    )
$$;

COMMENT ON FUNCTION public.fn_pode_acionar_sobreaviso(uuid) IS
'Quem pode acionar o sobreaviso desta escala. VER e global (fn_painel_sobreaviso_dia); ACIONAR
passa por aqui. Setor com sobreaviso_abrangencia = geral libera qualquer coordenador/admin; o
resto mantem o escopo por unidade/setor que a policy da tabela ja exigia.';

GRANT EXECUTE ON FUNCTION public.fn_pode_acionar_sobreaviso(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fecha a corrida entre dois acionadores
-- ---------------------------------------------------------------------------
-- A checagem "ja existe chamado em aberto" dentro da funcao NAO e atomica: dois acionamentos
-- simultaneos leem "nao existe" e os dois inserem. So o indice resolve.
-- Conferido em 08/08/2026 antes de criar: producao tem 0 linhas Aguardando/Aceito e
-- homologacao tem 3, sem nenhum grupo duplicado. O indice pode ser criado sem limpeza previa.
DROP INDEX IF EXISTS public.uq_sobreaviso_chamado_aberto;
CREATE UNIQUE INDEX uq_sobreaviso_chamado_aberto
    ON public.logs_sobreaviso (servidor_id, escala_mensal_id, dia)
    WHERE status IN ('Aguardando', 'Aceito');

COMMENT ON INDEX public.uq_sobreaviso_chamado_aberto IS
'Um chamado em aberto por servidor/escala/dia. Sem isto, o painel global permitiria que dois
coordenadores de unidades diferentes acionassem a mesma pessoa no mesmo instante.';

-- ---------------------------------------------------------------------------
-- 3. O unico caminho de acionamento
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_acionar_sobreaviso(
    p_escala_mensal_id   uuid,
    p_dia                integer,
    p_motivo             text,
    p_destino_unidade_id uuid,
    p_destino_setor_id   uuid DEFAULT NULL,
    p_destino_referencia text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role            public.user_role;
    v_escala_diaria_id uuid;
    v_servidor_id     uuid;
    v_unidade_id      uuid;
    v_setor_id        uuid;
    v_abrangencia     text;
    -- escalares em vez de RECORD: SELECT INTO sobre funcao que pode NAO devolver linha deixa o
    -- record em estado ambiguo, e "record IS NULL" e sutil demais para uma regra de autorizacao.
    v_jan_inicio      timestamp with time zone;
    v_jan_fim         timestamp with time zone;
    v_jan_inicio_loc  timestamp;
    v_jan_fim_loc     timestamp;
    v_agora           timestamp with time zone := now();
    v_aberto          record;
    v_token           uuid;
    v_log_id          uuid;
BEGIN
    -- (1) quem esta chamando
    SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();

    IF v_role IS NULL OR v_role NOT IN ('super_admin'::public.user_role,
                                        'admin'::public.user_role,
                                        'coordenador'::public.user_role) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Somente coordenadores e administradores podem acionar sobreaviso.');
    END IF;

    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Informe o motivo do acionamento.');
    END IF;

    -- (2) existe mesmo um Sobreaviso escalado nesse dia?
    SELECT ed.id, em.servidor_id, em.unidade_id, em.setor_id
      INTO v_escala_diaria_id, v_servidor_id, v_unidade_id, v_setor_id
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.escala_mensal_id = p_escala_mensal_id
       AND ed.dia = p_dia
       AND ed.categoria = 'Sobreaviso'::public.escala_categoria
     LIMIT 1;

    IF v_escala_diaria_id IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Nao ha sobreaviso escalado para este servidor neste dia.');
    END IF;

    -- (3) abrangencia
    SELECT s.sobreaviso_abrangencia INTO v_abrangencia
      FROM public.setores s WHERE s.id = v_setor_id;

    IF NOT public.fn_pode_acionar_sobreaviso(p_escala_mensal_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Este sobreaviso atende apenas a unidade de origem. Fale com o coordenador responsavel.');
    END IF;

    -- (4) janela ativa - MESMA funcao que habilita o botao no painel
    SELECT j.inicio, j.fim, j.inicio_local, j.fim_local
      INTO v_jan_inicio, v_jan_fim, v_jan_inicio_loc, v_jan_fim_loc
      FROM public.fn_janela_sobreaviso_dia(v_escala_diaria_id) j;

    IF v_jan_inicio IS NULL OR v_jan_fim IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Nao foi possivel determinar o horario deste plantao de sobreaviso.');
    END IF;

    IF v_agora < v_jan_inicio OR v_agora >= v_jan_fim THEN
        RETURN jsonb_build_object('success', false,
            'error', format('Fora da janela do plantao. Este sobreaviso vale das %s as %s.',
                to_char(v_jan_inicio_loc, 'DD/MM HH24:MI'),
                to_char(v_jan_fim_loc,    'DD/MM HH24:MI')));
    END IF;

    -- (5) chamado ja em aberto: recusar DIZENDO quem acionou e para onde, em vez de so negar
    SELECT l.id, l.status, l.data_hora_acionamento,
           COALESCE(pr.full_name, 'nao identificado') AS quem,
           COALESCE(du.nome, '?') AS destino
      INTO v_aberto
      FROM public.logs_sobreaviso l
      LEFT JOIN public.profiles pr ON pr.id = l.acionado_por
      LEFT JOIN public.unidades du ON du.id = l.destino_unidade_id
     WHERE l.servidor_id = v_servidor_id
       AND l.escala_mensal_id = p_escala_mensal_id
       AND l.dia = p_dia
       AND l.status IN ('Aguardando', 'Aceito')
     LIMIT 1;

    IF v_aberto.id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Ja existe um chamado %s para este servidor hoje, acionado por %s para %s. Aguarde a chegada no local.',
                   lower(v_aberto.status::text), v_aberto.quem, v_aberto.destino));
    END IF;

    -- (6) destino coerente
    IF p_destino_unidade_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Informe a unidade de destino.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = p_destino_unidade_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unidade de destino inexistente.');
    END IF;

    IF p_destino_setor_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.setores s
                        WHERE s.id = p_destino_setor_id
                          AND s.unidade_id = p_destino_unidade_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'O setor de destino nao pertence a unidade de destino.');
    END IF;

    -- (7) grava
    INSERT INTO public.logs_sobreaviso (
        servidor_id, unidade_id, escala_mensal_id, dia,
        motivo_acionamento, status, categoria,
        destino_unidade_id, destino_setor_id, destino_referencia,
        acionado_por, abrangencia_no_acionamento
    ) VALUES (
        v_servidor_id, v_unidade_id, p_escala_mensal_id, p_dia,
        btrim(p_motivo), 'Aguardando', 'Sobreaviso',
        p_destino_unidade_id, p_destino_setor_id, NULLIF(btrim(COALESCE(p_destino_referencia, '')), ''),
        auth.uid(), v_abrangencia
    )
    RETURNING id, token_magic_link INTO v_log_id, v_token;

    RETURN jsonb_build_object('success', true, 'log_id', v_log_id, 'token', v_token);

EXCEPTION
    WHEN unique_violation THEN
        -- so cai aqui se dois acionamentos simultaneos passarem juntos pela checagem (5)
        RETURN jsonb_build_object('success', false,
            'error', 'Outro coordenador acionou este servidor neste instante. Recarregue o painel.');
END;
$$;

COMMENT ON FUNCTION public.fn_acionar_sobreaviso(uuid, integer, text, uuid, uuid, text) IS
'Unico caminho de acionamento de sobreaviso. Valida papel, existencia do plantao, abrangencia,
janela ativa (fn_janela_sobreaviso_dia - a MESMA que habilita o botao), chamado em aberto e
coerencia do destino. Grava acionado_por e congela a abrangencia do momento.';

GRANT EXECUTE ON FUNCTION public.fn_acionar_sobreaviso(uuid, integer, text, uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. O cliente perde o INSERT direto
-- ---------------------------------------------------------------------------
-- A policy anterior era uma so, FOR ALL. Quebrada em SELECT/UPDATE/DELETE com exatamente o
-- mesmo predicado - nada de leitura ou de validacao manual muda. O que desaparece e o INSERT.
--
-- fn_confirmar_presenca e fn_confirmar_presenca_manual continuam inserindo em logs_sobreaviso
-- (validacao de presenca de Sobreaviso pelo terminal e pela grade): as duas sao
-- SECURITY DEFINER e rodam como owner, entao nao passam por esta policy. fn_acionar_sobreaviso
-- tambem e SECURITY DEFINER. Verificado antes de escrever: nenhum outro ponto do frontend
-- insere nesta tabela (o unico era ScaleGrid.tsx:1569, substituido pela RPC na Fase 8).
DROP POLICY IF EXISTS "Admins e Coordenadores gerenciam logs_sobreaviso" ON public.logs_sobreaviso;

CREATE POLICY "Admins e Coordenadores leem logs_sobreaviso" ON public.logs_sobreaviso
  FOR SELECT TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.id = logs_sobreaviso.escala_mensal_id AND
        em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid())
      ))
    ))
  );

CREATE POLICY "Admins e Coordenadores atualizam logs_sobreaviso" ON public.logs_sobreaviso
  FOR UPDATE TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.id = logs_sobreaviso.escala_mensal_id AND
        em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid())
      ))
    ))
  );

CREATE POLICY "Admins e Coordenadores apagam logs_sobreaviso" ON public.logs_sobreaviso
  FOR DELETE TO authenticated
  USING (
    ((SELECT get_my_role()) = 'super_admin'::user_role) OR
    (((SELECT get_my_role()) = ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
      (unidade_id IN (SELECT profile_unidades.unidade_id FROM profile_unidades WHERE profile_unidades.profile_id = auth.uid())
       AND (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))) OR
      (EXISTS (
        SELECT 1 FROM public.escala_mensal em
        WHERE em.id = logs_sobreaviso.escala_mensal_id AND
        em.setor_id IN (SELECT profile_setores.setor_id FROM profile_setores WHERE profile_setores.profile_id = auth.uid())
      ))
    ))
  );

-- ---------------------------------------------------------------------------
-- CONFERENCIA (rodar depois de aplicar)
-- ---------------------------------------------------------------------------
--   -- 1) o INSERT direto tem de falhar para um coordenador autenticado:
--   --    INSERT INTO logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, status)
--   --    VALUES (...);  -> esperado: new row violates row-level security policy
--
--   -- 2) as policies que restaram:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'logs_sobreaviso' ORDER BY cmd;
--   -- esperado: SELECT / UPDATE / DELETE, e NENHUMA com cmd = INSERT
--
--   -- 3) o terminal continua gravando presenca de Sobreaviso:
--   --    exercitar fn_confirmar_presenca com um servidor de sobreaviso e conferir que a linha
--   --    aparece em logs_sobreaviso com destino preenchido pelo gatilho da Fase 2.
