-- Migration: controle de acesso em justificativas_eventos / _padrao / _assinaturas
-- Data: 2026-08-24
-- Plano: docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md (fase 0b)
--
-- 🚨 O QUE ESTA MIGRATION FECHA
--   As tres tabelas do modulo de justificativas nasceram (20260805000000, secao 12) com:
--
--       CREATE POLICY "Escrita justificativas_eventos" ON public.justificativas_eventos
--           FOR ALL USING (auth.uid() IS NOT NULL);
--
--   ou seja: QUALQUER conta autenticada, de QUALQUER unidade, le, escreve, sobrescreve e apaga
--   qualquer justificativa da rede inteira. E `justificativas/actions.ts` nao ajuda - `grep -c
--   role` naquele arquivo devolve 0: nenhuma das server actions confere papel.
--
--   Enquanto a tabela guardava texto motivacional isso era ruim. Com a coluna `resultado`
--   (20260824100000) ela passa a guardar VEREDITO SOBRE CONDUTA DE SERVIDOR PUBLICO - e a
--   decisao do usuario de 23/08/2026 ("a falta e reversivel pelo RH") nao significa nada
--   enquanto todo mundo puder reverter.
--
--   E a mesma licao de /usuarios (22/08/2026): tela filtrada nao protege a action. La foram
--   cinco server actions com service_role e autorizacao so no `if` da pagina.
--
-- ⚠️ ESTA MIGRATION SOZINHA NAO BASTA, E ISSO E DELIBERADO
--   TODOS os caminhos de aplicacao usam createAdminClient() (service_role), que passa por cima
--   de RLS: justificativas/actions.ts, folha-ponto/actions.ts (o anexo) e consultar-escala/
--   actions.ts (o portal). Entao o que esta migration fecha e o acesso DIRETO por JWT - real,
--   porque toda RPC e toda tabela do PostgREST sao alcancaveis por quem tem o anon key e uma
--   sessao. A autorizacao do caminho service_role e responsabilidade das actions, que ganham a
--   regra em src/utils/gestaoJustificativas.ts (mesma fonte unica de gestaoUsuarios.ts).
--   As duas camadas precisam concordar, e a regra e a mesma dos dois lados.
--
-- QUEM PODE O QUE
--   gerir (ler, justificar, validar, marcar falta)
--       super_admin, rh, rh_unidade, admin, coordenador, ass_adm - dentro do escopo
--       Este e EXATAMENTE o conjunto que ja enxerga /justificativas no menu hoje
--       (src/components/layout/sidebar.tsx: grupo OPERACAO). Nao se estreita ninguem aqui.
--   reverter desfecho ja gravado (falta -> validado, validado -> falta, ou apagar)
--       super_admin, rh, rh_unidade - decisao do usuario em 23/08/2026
--   apagar a linha inteira
--       super_admin, rh - mesma regua de /usuarios: o que e irreversivel fica com quem manda

BEGIN;

-- ============================================================================
-- 1. OS DOIS PREDICADOS
-- ============================================================================
--
-- fn_unidade_no_escopo NAO e usada aqui. Ela trata todo admin como se tivesse todas as
-- unidades e so verifica profile_unidades - a mesma razao pela qual fn_pode_acionar_sobreaviso
-- (20260808180000) tambem a evitou. O escopo abaixo espelha a policy de escala_mensal
-- (20260812070000), que e a tabela de onde estes eventos vem.

CREATE OR REPLACE FUNCTION public.fn_pode_gerir_justificativa(
    p_unidade_id uuid,
    p_setor_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        -- service_role (sem sessao): a autorizacao daquele caminho e da server action.
        auth.uid() IS NULL
     OR (SELECT get_my_role()) = 'super_admin'::user_role
     OR (SELECT get_my_role()) = 'rh'::user_role
     OR (
            (SELECT get_my_role()) = 'rh_unidade'::user_role
        AND p_unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu
                              WHERE pu.profile_id = auth.uid())
        )
     OR (
            (SELECT get_my_role()) = ANY (ARRAY['admin'::user_role,
                                                'coordenador'::user_role,
                                                'ass_adm'::user_role])
        AND (
               EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid()
                          AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))
            OR (p_unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu
                                  WHERE pu.profile_id = auth.uid())
                AND EXISTS (SELECT 1 FROM public.profiles p
                             WHERE p.id = auth.uid() AND p.acesso_todos_setores = true))
            OR p_setor_id IN (SELECT ps.setor_id FROM public.profile_setores ps
                               WHERE ps.profile_id = auth.uid())
            -- quem so tem profile_setores, sem a unidade-pai vinculada (piloto da TI)
            OR public.fn_unidade_alcancavel_por_setor(p_unidade_id)
            )
        )
$$;

COMMENT ON FUNCTION public.fn_pode_gerir_justificativa(uuid, uuid) IS
    'Quem pode ler/justificar/validar/marcar falta num evento desta unidade+setor. Mesmo '
    'conjunto de papeis que ja enxerga /justificativas no menu; escopo espelhado da policy de '
    'escala_mensal (20260812070000). auth.uid() IS NULL bypassa porque TODAS as server actions '
    'do modulo usam service_role - la a autorizacao e de src/utils/gestaoJustificativas.ts.';

GRANT EXECUTE ON FUNCTION public.fn_pode_gerir_justificativa(uuid, uuid) TO authenticated, service_role;


-- Reverter e diferente de decidir. Quem marca a falta e quem convive com o servidor todo dia;
-- quem desfaz precisa estar fora dessa relacao. Decisao do usuario em 23/08/2026 (secao 5.1).
CREATE OR REPLACE FUNCTION public.fn_pode_reverter_desfecho(p_unidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        auth.uid() IS NULL
     OR (SELECT get_my_role()) = 'super_admin'::user_role
     OR (SELECT get_my_role()) = 'rh'::user_role
     OR (
            (SELECT get_my_role()) = 'rh_unidade'::user_role
        AND p_unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu
                              WHERE pu.profile_id = auth.uid())
        )
$$;

COMMENT ON FUNCTION public.fn_pode_reverter_desfecho(uuid) IS
    'So RH Geral, RH da Unidade e Administrador Geral desfazem um desfecho ja gravado - '
    'inclusive a falta por decurso de prazo do auto-fechamento. Coordenador e ass_adm decidem, '
    'nao revisam a propria decisao.';

GRANT EXECUTE ON FUNCTION public.fn_pode_reverter_desfecho(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. O GUARD DA REVERSAO, NO BANCO
-- ============================================================================
--
-- Trigger PROPRIA, e nao um remendo dentro de trg_registrar_desfecho_evento: recriar aquela
-- funcao para enfiar uma regra nova e exatamente o padrao que ja custou seis regressoes neste
-- projeto (CLAUDE.md, armadilha 1). Uma trigger, um assunto.
--
-- BEFORE, para abortar antes de qualquer escrita; a de historico e AFTER e continua intacta.
CREATE OR REPLACE FUNCTION public.trg_autorizar_desfecho_evento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trg$
BEGIN
    IF NEW.resultado IS NOT DISTINCT FROM OLD.resultado THEN
        RETURN NEW;
    END IF;

    -- Gravar desfecho onde nao havia nenhum: basta gerir.
    IF OLD.resultado IS NULL THEN
        IF NOT public.fn_pode_gerir_justificativa(NEW.unidade_id, NEW.setor_id) THEN
            RAISE EXCEPTION 'Sem permissão para registrar o desfecho deste evento.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN NEW;
    END IF;

    -- Mexer num desfecho que ja existe e reversao, mesmo que o valor novo seja NULL.
    IF NOT public.fn_pode_reverter_desfecho(NEW.unidade_id) THEN
        RAISE EXCEPTION 'Apenas o RH pode reverter um desfecho já registrado.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
END;
$trg$;

DROP TRIGGER IF EXISTS trg_autorizar_desfecho_evento ON public.justificativas_eventos;
CREATE TRIGGER trg_autorizar_desfecho_evento
    BEFORE UPDATE OF resultado ON public.justificativas_eventos
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_autorizar_desfecho_evento();


-- ============================================================================
-- 3. AS POLICIES
-- ============================================================================

-- --- justificativas_eventos ------------------------------------------------
DROP POLICY IF EXISTS "Leitura justificativas_eventos" ON public.justificativas_eventos;
DROP POLICY IF EXISTS "Escrita justificativas_eventos" ON public.justificativas_eventos;

CREATE POLICY "Leitura justificativas_eventos" ON public.justificativas_eventos
    FOR SELECT TO authenticated
    USING (public.fn_pode_gerir_justificativa(unidade_id, setor_id));

CREATE POLICY "Insercao justificativas_eventos" ON public.justificativas_eventos
    FOR INSERT TO authenticated
    WITH CHECK (public.fn_pode_gerir_justificativa(unidade_id, setor_id));

-- USING = a linha que ja existe; WITH CHECK = a linha depois da alteracao. Os dois sao
-- necessarios: sem WITH CHECK, um coordenador moveria a linha para outra unidade num UPDATE.
CREATE POLICY "Atualizacao justificativas_eventos" ON public.justificativas_eventos
    FOR UPDATE TO authenticated
    USING (public.fn_pode_gerir_justificativa(unidade_id, setor_id))
    WITH CHECK (public.fn_pode_gerir_justificativa(unidade_id, setor_id));

-- Apagar a linha some com a trilha inteira do evento (o historico e ON DELETE CASCADE), entao
-- fica com quem ja detem o irreversivel no resto do sistema.
CREATE POLICY "Exclusao justificativas_eventos" ON public.justificativas_eventos
    FOR DELETE TO authenticated
    USING (
        (SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'rh'::user_role])
    );


-- --- justificativas_padrao (templates) --------------------------------------
-- Leitura continua ampla: template com unidade_id NULL e catalogo da secretaria (9 dos 12 em
-- producao) e precisa aparecer para todo coordenador. O que muda e a ESCRITA, que hoje qualquer
-- autenticado faz - inclusive apagar os 9 globais.
DROP POLICY IF EXISTS "Leitura justificativas_padrao" ON public.justificativas_padrao;
DROP POLICY IF EXISTS "Escrita justificativas_padrao" ON public.justificativas_padrao;

CREATE POLICY "Leitura justificativas_padrao" ON public.justificativas_padrao
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "Escrita justificativas_padrao" ON public.justificativas_padrao
    FOR ALL TO authenticated
    USING (
        CASE WHEN unidade_id IS NULL
             THEN (SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'rh'::user_role])
             ELSE public.fn_pode_gerir_justificativa(unidade_id, setor_id)
        END
    )
    WITH CHECK (
        CASE WHEN unidade_id IS NULL
             THEN (SELECT get_my_role()) = ANY (ARRAY['super_admin'::user_role, 'rh'::user_role])
             ELSE public.fn_pode_gerir_justificativa(unidade_id, setor_id)
        END
    );


-- --- justificativas_assinaturas ---------------------------------------------
-- Registro de integridade (hash sha256 do relatorio assinado). Nasce e nao muda: sem policy de
-- UPDATE nem de DELETE, de proposito - alterar o hash de uma assinatura destroi o que ela prova.
-- Producao tem 0 linhas hoje, entao nada e quebrado por essa restricao.
DROP POLICY IF EXISTS "Leitura justificativas_assinaturas" ON public.justificativas_assinaturas;
DROP POLICY IF EXISTS "Escrita justificativas_assinaturas" ON public.justificativas_assinaturas;

CREATE POLICY "Leitura justificativas_assinaturas" ON public.justificativas_assinaturas
    FOR SELECT TO authenticated
    USING (
        (SELECT get_my_role()) = ANY (ARRAY[
            'super_admin'::user_role, 'rh'::user_role, 'rh_unidade'::user_role,
            'admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role
        ])
    );

CREATE POLICY "Insercao justificativas_assinaturas" ON public.justificativas_assinaturas
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT get_my_role()) = ANY (ARRAY[
            'super_admin'::user_role, 'rh'::user_role, 'rh_unidade'::user_role,
            'admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role
        ])
    );

COMMIT;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao faz parte da migration)
-- ============================================================================
--
-- 1. As policies abertas sumiram - nenhuma deve aparecer com qual = '(auth.uid() IS NOT NULL)':
--
--    SELECT tablename, policyname, cmd, qual
--      FROM pg_policies
--     WHERE tablename LIKE 'justificativas%'
--     ORDER BY tablename, policyname;
--
-- 2. NADA quebra no app, porque todo caminho de aplicacao e service_role. Conferir na tela:
--    /justificativas carrega a fila, o anexo do plantao abre, e o portal do servidor continua
--    listando as justificativas dele.
--
-- 3. O caminho direto por JWT passou a ser recusado. Com um token de coordenador de OUTRA
--    unidade, isto tem que devolver zero linhas (nao erro - RLS filtra em silencio no SELECT):
--
--    GET /rest/v1/justificativas_eventos?select=id&limit=5
--
-- 4. A reversao e recusada para quem nao e RH. Com JWT de coordenador, sobre uma linha da
--    propria unidade que JA tenha resultado:
--
--    PATCH /rest/v1/justificativas_eventos?id=eq.<uuid>   {"resultado":"validado"}
--    -- esperado: 'Apenas o RH pode reverter um desfecho ja registrado.' (insufficient_privilege)
--
--    E gravar desfecho onde nao havia nenhum tem que PASSAR para o mesmo coordenador.
