-- ============================================================================
-- Snapshot de cadastro: separar "li e havia zero" de "nao consegui ler" (06/09/2026)
-- ============================================================================
-- Plano: docs/planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md (Prioridade 1a)
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_snapshot_leitura_ok.js
-- O gerador copia fn_registrar_snapshot_usuarios_dispositivo de 20260822210000_ponto_valido_desde_por_dispositivo.sql
-- e aborta se qualquer uma das guardas dela tiver desaparecido da fonte.
--
-- ⚠️ ARMADILHA 41: a assinatura muda de (uuid, jsonb) para (uuid, jsonb, boolean), e assinatura
-- nova e' um objeto NOVO - nasce com EXECUTE para PUBLIC. Por isso o REVOKE/GRANT e reescrito
-- aqui, e a de 2 argumentos leva DROP: duas sobrecargas fariam o PostgREST devolver PGRST203.
-- O DROP vem ANTES do CREATE de proposito; enquanto a rota antiga estiver no ar ela chama por
-- NOME de parametro (p_dispositivo_id, p_usuarios) e resolve na nova, pelo DEFAULT.
-- ============================================================================

-- ============================================================================
-- 1. Rastro da leitura, em dispositivos_rep
-- ============================================================================
-- Leitura boa que devolve ZERO cadastros nao deixa marca nenhuma hoje: rep_usuarios_dispositivo
-- fica vazia, e "nunca ninguem leu" fica indistinguivel de "leu e o relogio esta vazio". Era
-- exatamente por isso que a tela do CCE continuava afirmando que os 35 servidores estavam la.

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS usuarios_lidos_em    timestamptz,
    ADD COLUMN IF NOT EXISTS usuarios_lidos_total integer;

COMMENT ON COLUMN public.dispositivos_rep.usuarios_lidos_em IS
    'Quando o coletor leu o cadastro do equipamento com sucesso pela ultima vez. NULL = nunca '
    'foi lido. Com usuarios_lidos_total = 0, significa "lido e vazio" - relogio zerado ou '
    'substituido, nao falta de leitura.';

COMMENT ON COLUMN public.dispositivos_rep.usuarios_lidos_total IS
    'Quantos cadastros a ultima leitura bem-sucedida encontrou no equipamento.';

-- ============================================================================
-- 2. fn_registrar_snapshot_usuarios_dispositivo
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(
    p_dispositivo_id uuid,
    p_usuarios       jsonb,
    -- DEFAULT false e o que segura a janela migration -> deploy: enquanto a rota antiga
    -- mandar 2 argumentos, ela resolve para esta funcao e o comportamento e o de hoje.
    -- Coletor antigo nunca manda o campo, entao o parque inteiro segue igual ate subir.
    p_leitura_ok     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_total integer := 0;
    v_sem_match integer := 0;
    v_encerrados integer := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.dispositivos_rep WHERE id = p_dispositivo_id) THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    DELETE FROM public.rep_usuarios_dispositivo WHERE dispositivo_id = p_dispositivo_id;

    WITH bruto AS (
        SELECT
            btrim(u->>'identificador_afd')                         AS identificador_afd,
            NULLIF(btrim(u->>'registration_bruto'), '')             AS registration_bruto,
            NULLIF(btrim(u->>'nome'), '')                           AS nome,
            COALESCE((u->>'tem_biometria')::boolean, false)         AS tem_biometria
          FROM jsonb_array_elements(COALESCE(p_usuarios, '[]'::jsonb)) AS u
         WHERE btrim(COALESCE(u->>'identificador_afd', '')) <> ''
    ),
    entrada AS (
        -- Dedup: um device reaproveitado pode ter o mesmo identificador_afd cadastrado mais de
        -- uma vez. Mantem o registro com biometria quando algum dos duplicados tiver.
        SELECT DISTINCT ON (identificador_afd)
               identificador_afd, registration_bruto, nome, tem_biometria
          FROM bruto
         ORDER BY identificador_afd, tem_biometria DESC, nome NULLS LAST
    ),
    resolvido AS (
        -- FONTE UNICA de identidade: fn_servidor_por_identificador_afd tenta vinculo, CPF e PIS,
        -- nesta ordem, e RECUSA quando CPF e PIS apontam para pessoas diferentes. Antes daqui
        -- havia um LEFT JOIN casando SO por CPF - foi isso que fez o relogio da SMS (cadastrado
        -- por PIS pelo sistema anterior) resolver ZERO dos 323 usuarios.
        --
        -- LATERAL em vez de LEFT JOIN tambem elimina um risco latente: dois servidores Ativos com
        -- o mesmo CPF multiplicavam a linha e estouravam uq_usuario_dispositivo no INSERT, dando
        -- rollback no snapshot inteiro (o mesmo modo de falha que esta migration de origem
        -- corrigiu para identificador duplicado, pela outra ponta).
        SELECT e.*, r.servidor_id, r.origem_match
          FROM entrada e
          -- NULL no instante = "isto e cadastro, nao batida": nao ha o que comparar com
          -- dispositivos_rep.ponto_valido_desde, e quem esta cadastrado no relogio HOJE
          -- continua sendo reconhecido independente de quando o equipamento foi assumido.
          LEFT JOIN LATERAL public.fn_servidor_por_identificador_afd(
                       p_dispositivo_id, e.identificador_afd, NULL::timestamptz) r ON true
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

    -- RECONCILIACAO DO VINCULO COM O QUE O RELOGIO REALMENTE TEM (22/08/2026)
    --
    -- O snapshot sempre foi substituido por inteiro, mas NADA olhava para rep_vinculos_servidor:
    -- quem sumia do equipamento ficava com vinculo vigente para sempre. Medido em producao no
    -- HMM-01, depois da higiene do relogio: 53 vinculos vigentes de gente que nao esta mais no
    -- equipamento. A tela "Cobertura da Escala" lia esse vinculo e dizia 'ok' + "com biometria"
    -- para 3 servidores escalados que NAO ESTAO no relogio, e fn_enfileirar_cadastros_rep pula
    -- quem tem vinculo vigente - ou seja, eles nunca mais seriam reenviados. Os dois lados
    -- silenciosos, exatamente o modo de falha da secao "Cobertura de ponto" do CLAUDE.md.
    --
    -- Encerrar vinculo NAO mexe em ponto passado: quem reprocessa autoria (fn_reparse_afd_
    -- dispositivo) le o vinculo vigente NA DATA da batida, e vigente_ate = now() so fecha dali
    -- para frente. E e reversivel: reenviar o cadastro abre um vinculo novo
    -- (fn_confirmar_cadastro_rep ja fecha o anterior antes de inserir).
    --
    -- DUAS GUARDAS QUE NAO PODEM SAIR DAQUI:
    --
    --   1. Lista VAZIA nunca reconcilia. Payload vazio e indistinguivel de leitura que falhou
    --      (a rota /api/rep/v1/usuarios-dispositivo cai para [] quando o corpo vem malformado)
    --      - e encerrar todos os vinculos de uma unidade por causa de um POST torto e muito
    --      pior que o bug que esta funcao conserta.
    --   2. Vinculo criado ha menos de 15 minutos e poupado. O coletor le o relogio inteiro
    --      (paginado de 100 em 100) e so depois publica o snapshot; um push de cadastro que
    --      acontecesse entre a leitura e a publicacao criaria um vinculo legitimo que nao esta
    --      naquela lista. A proxima leitura reconcilia, se for para reconciliar mesmo.
    --   3. (06/09/2026) Lista vazia RECONCILIA quando o coletor afirma que a leitura foi boa.
    --      Sem isto, relogio substituido por um equipamento em branco - ou zerado pela
    --      interface - deixa 100% dos vinculos vigentes apontando para cadastro que nao
    --      existe mais, e nada no sistema reclama. O CCE ficou assim ate alguem medir.
    --      A diferenca entre os dois casos NUNCA esteve no payload: `[]` de POST torto e
    --      `[]` de relogio vazio sao identicos. Quem sabe e o coletor, e agora ele diz.
    IF v_total > 0 OR p_leitura_ok THEN
        WITH encerrados AS (
            UPDATE public.rep_vinculos_servidor v
               SET vigente_ate = now()
             WHERE v.dispositivo_id = p_dispositivo_id
               AND v.vigente_ate IS NULL
               AND v.created_at < now() - interval '15 minutes'
               AND NOT EXISTS (
                     SELECT 1
                       FROM public.rep_usuarios_dispositivo u
                      WHERE u.dispositivo_id = p_dispositivo_id
                        -- right(...,11) dos dois lados: o mesmo numero convive com zero a
                        -- esquerda de tamanhos diferentes (armadilha 10). ltrim(...,'0') aqui
                        -- comeria um digito de CPF que comeca com zero - 37% da base.
                        AND right(regexp_replace(u.identificador_afd, '\D', '', 'g'), 11)
                          = right(regexp_replace(v.identificador_afd, '\D', '', 'g'), 11))
            RETURNING 1
        )
        SELECT count(*) INTO v_encerrados FROM encerrados;
    END IF;

    IF p_leitura_ok OR v_total > 0 THEN
        UPDATE public.dispositivos_rep
           SET usuarios_lidos_em    = now(),
               usuarios_lidos_total = v_total
         WHERE id = p_dispositivo_id;
    END IF;

    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match,
                              'vinculos_encerrados', v_encerrados,
                              'leitura_ok', p_leitura_ok);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean)
    TO service_role;

COMMENT ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean) IS
    'Substitui por inteiro o snapshot de quem esta cadastrado no equipamento e encerra vinculo '
    'de quem sumiu dele. Lista vazia so reconcilia quando p_leitura_ok afirma que a leitura foi '
    'bem-sucedida - payload vazio por corpo malformado continua sendo ignorado.';

-- ============================================================================
-- 3. CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 3.1 Existe UMA assinatura so (senao PostgREST devolve PGRST203):
--
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_snapshot_usuarios_dispositivo';
--   -- esperado: exatamente 1 linha, com (uuid, jsonb, boolean)
--
-- 3.2 anon NAO executa (armadilha 24 - GRANT a authenticated nunca restringiu nada):
--
--   SELECT has_function_privilege('anon',
--            'public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean)', 'EXECUTE');
--   -- esperado: false
--
-- 3.3 O comportamento de hoje NAO mudou para quem nao subiu o coletor. Chamar com 2 argumentos
--     (como a rota antiga faz) tem que continuar NAO reconciliando com lista vazia:
--
--   SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--            '<uuid de um dispositivo de homologacao>', '[]'::jsonb);
--   -- esperado: vinculos_encerrados = 0, leitura_ok = false
--
-- 3.4 E com a leitura afirmada, reconcilia:
--
--   SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--            '<uuid de um dispositivo de homologacao>', '[]'::jsonb, true);
--   -- esperado: vinculos_encerrados = <quantos vinculos vigentes aquele device tinha>
--   -- ⚠️ SO EM HOMOLOGACAO. Em producao isto encerra vinculo de verdade.
