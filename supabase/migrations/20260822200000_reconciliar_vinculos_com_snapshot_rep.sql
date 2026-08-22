-- ============================================================================
-- O relogio esqueceu, o SisEscala nao (22/08/2026)
-- ============================================================================
-- ARQUIVO GERADO por scratchpad/gen_reconciliar_vinculos_snapshot.js. Nao editar a mao - regerar.
-- As duas funcoes sao copia mecanica do corpo vigente (20260817170000 e 20260817100000) com
-- substituicoes pontuais; o script aborta se qualquer invariante divergir (CLAUDE.md armadilha 1).
--
-- O PROBLEMA, medido em producao em 22/08/2026 (REP-iDClass-HMM-01)
--
--   O relogio do HMM chegou reaproveitado, com 1.211 cadastros do sistema anterior. A higiene
--   removeu 1.157; o resto foi apagado no proprio equipamento, e ele ficou com UM cadastro. O
--   coletor releu e publicou o snapshot certo: 1 usuario.
--
--   E o SisEscala continuou com 54 vinculos vigentes.
--
--   Nada reconciliava rep_vinculos_servidor com o snapshot - a unica limpeza de vinculo estava em
--   fn_confirmar_remocao_usuario_dispositivo, que so alcanca quem saiu PELA FILA de remocao. Quem
--   e apagado na telinha do equipamento (ou nunca chegou nele) some do relogio e continua
--   vinculado aqui. Consequencias, as duas silenciosas:
--
--     * fn_cobertura_ponto_dispositivo classifica por vinculo quando nao acha a pessoa no
--       snapshot - a aba "Cobertura da Escala" mostrava 3 servidores escalados como 'ok' e
--       "com biometria", com identificador_afd NULO, sem nenhum deles estar no equipamento;
--     * fn_enfileirar_cadastros_rep pula quem tem vinculo vigente, entao o botao "Sincronizar
--       cadastros" nunca os reenviaria - para sempre, sem mensagem nenhuma.
--
--   Medida no parque inteiro antes de escrever isto (vinculo vigente cujo identificador nao esta
--   no snapshot atual do proprio dispositivo):
--
--     HMM-01        53   (higiene + limpeza manual do equipamento)
--     ENF-ZEZINHA    7   (6 deles estao no relogio sob OUTRO identificador)
--     SMS            2
--     outros 10      0
--
--   Nenhum desses 62 identificadores tem batida no AFD dentro da vigencia do vinculo, entao
--   encerra-los nao muda o dono de ponto nenhum.
--
-- A CORRECAO, em duas metades que so funcionam juntas
--
--   1. O snapshot passa a ser a verdade: quem nao aparece nele perde o vinculo (vigente_ate).
--      Duas guardas - lista vazia nunca reconcilia, e vinculo com menos de 15 min e poupado -
--      estao comentadas no corpo da funcao.
--   2. A fila de cadastro passa a olhar o snapshot tambem, nao so o vinculo. Sem isso, a metade
--      1 faria reenviar cadastro de quem ESTA no relogio sob outro numero (os 6 do ENF-ZEZINHA),
--      criando duplicata no equipamento.
--
-- O QUE NAO MUDA
--   * fn_cobertura_ponto_dispositivo nao e tocada: com o vinculo encerrado ela ja classifica
--     'fora_do_relogio' sozinha. A regra de "esta no relogio?" continua num lugar so.
--   * Ninguem e reenviado automaticamente. Encerrar o vinculo faz a pessoa reaparecer como
--     'fora_do_relogio' na tela; quem decide escrever no equipamento continua sendo alguem
--     clicando, mesma prudencia ja adotada para cadastros/remocoes.
--   * fn_atualizar_biometria_vinculos continua so LIGANDO tem_biometria. Divergencia de biometria
--     entre snapshot e vinculo: 0 nos 13 dispositivos, medido - nao ha caso real que justifique
--     mexer nessa decisao aqui.
--
-- IDEMPOTENTE: CREATE OR REPLACE nas duas funcoes; o backfill fecha so o que ainda estiver
-- aberto. Seguro reaplicar. Nenhum RETURNS TABLE muda de assinatura (sem 42P13).
-- ============================================================================


-- ============================================================================
-- 1. SNAPSHOT reconcilia o vinculo
-- ============================================================================

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
          LEFT JOIN LATERAL public.fn_servidor_por_identificador_afd(
                       p_dispositivo_id, e.identificador_afd) r ON true
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
    IF v_total > 0 THEN
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

    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match,
                              'vinculos_encerrados', v_encerrados);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) IS
    'Substitui por inteiro o snapshot de quem esta cadastrado no rele e ENCERRA os vinculos '
    'vigentes cujo identificador nao aparece nessa leitura - o equipamento e a verdade sobre quem '
    'esta nele. Nao reconcilia com lista vazia (leitura falha) nem encerra vinculo criado ha menos '
    'de 15 min (corrida entre ler o rele e publicar). Devolve vinculos_encerrados.';


-- ============================================================================
-- 2. FILA DE CADASTRO olha o snapshot, nao so o vinculo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_rep(p_dispositivo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role          public.user_role;
    v_unidade_id    uuid;
    v_restrito      boolean;
    v_enfileirados  integer := 0;
    v_sem_cpf       integer := 0;
    v_ja_vinculados integer := 0;
    v_ja_no_relogio integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para sincronizar cadastros com o rele.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT unidade_id INTO v_unidade_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    IF auth.uid() IS NOT NULL THEN
        IF NOT (public.fn_unidade_no_escopo(v_unidade_id) OR public.fn_unidade_alcancavel_por_setor(v_unidade_id)) THEN
            RAISE EXCEPTION 'Dispositivo fora do seu escopo de atuacao.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- 0 linhas em dispositivos_rep_setores = "toda a unidade" (mesma semantica de
    -- dispositivos_rep.setor_id IS NULL); >=1 linha = so os setores listados.
    SELECT EXISTS (
        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id
    ) INTO v_restrito;

    WITH candidatos AS (
        SELECT s.id, s.cpf
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = v_unidade_id
           AND (NOT v_restrito OR EXISTS (
                 SELECT 1 FROM public.dispositivos_rep_setores ds
                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id))
    ),
    sem_cpf AS (
        SELECT count(*) AS n FROM candidatos
         WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = ''
    ),
    ja_vinculados AS (
        SELECT count(*) AS n
          FROM candidatos c
          JOIN public.rep_vinculos_servidor v
            ON v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL
    ),
    -- Esta no equipamento, mas sob um identificador que nao e o do vinculo (ou sem vinculo
    -- nenhum). Medido em producao em 22/08/2026 no ENF-ZEZINHA: 6 servidores com vinculo
    -- apontando para um numero que o relogio nao tem mais, e o cadastro deles la sob outro.
    -- Reenviar essa gente cria cadastro duplicado no equipamento em vez de resolver.
    ja_no_relogio AS (
        SELECT count(*) AS n
          FROM candidatos c
         WHERE NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v
                  WHERE v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL)
           AND EXISTS (
                 SELECT 1 FROM public.rep_usuarios_dispositivo u
                  WHERE u.dispositivo_id = p_dispositivo_id AND u.servidor_id = c.id)
    ),
    inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, c.id, auth.uid()
          FROM candidatos c
         WHERE regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g') <> ''
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v
                  WHERE v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL)
           -- O vinculo e UMA evidencia de "ja esta no relogio", nao a unica: o snapshot e a
           -- leitura direta do equipamento. Sem esta linha, encerrar vinculos orfaos (a outra
           -- metade desta migration) faria reenviar cadastro de quem esta la sob outro numero.
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_usuarios_dispositivo u
                  WHERE u.dispositivo_id = p_dispositivo_id AND u.servidor_id = c.id)
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_cadastros_fila f
                  WHERE f.servidor_id = c.id AND f.dispositivo_id = p_dispositivo_id AND f.status = 'pendente')
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos), (SELECT n FROM sem_cpf), (SELECT n FROM ja_vinculados),
           (SELECT n FROM ja_no_relogio)
      INTO v_enfileirados, v_sem_cpf, v_ja_vinculados, v_ja_no_relogio;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'sem_cpf', v_sem_cpf,
        'ja_vinculados', v_ja_vinculados,
        'ja_no_relogio', v_ja_no_relogio
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_enfileirar_cadastros_rep(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_enfileirar_cadastros_rep(uuid) IS
    'Enfileira para o rele servidores ativos lotados na unidade/setor do dispositivo que nao estao '
    'la: sem vinculo vigente E sem cadastro no snapshot do equipamento. O snapshot entra porque o '
    'vinculo pode apontar para um identificador que o rele nao tem mais (medido no ENF-ZEZINHA em '
    '22/08/2026) - reenviar essa gente duplicaria o cadastro. Permitido para gestores e '
    'administradores no escopo da unidade.';


-- ============================================================================
-- 3. BACKFILL - fecha os 62 vinculos que ja estao mentindo hoje
-- ============================================================================
-- Mesmas guardas do corpo da funcao, mais uma: so mexe em dispositivo que TEM snapshot. Sem essa
-- condicao, todo relogio onde a higiene nunca rodou perderia todos os vinculos - e "ninguem leu o
-- cadastro dele ainda" nao e evidencia de que a pessoa nao esta la. E o mesmo criterio que
-- fn_cobertura_ponto_dispositivo usa para o rotulo 'sem_snapshot'.

UPDATE public.rep_vinculos_servidor v
   SET vigente_ate = now()
 WHERE v.vigente_ate IS NULL
   AND v.created_at < now() - interval '15 minutes'
   AND EXISTS (
         SELECT 1 FROM public.rep_usuarios_dispositivo s
          WHERE s.dispositivo_id = v.dispositivo_id)
   AND NOT EXISTS (
         SELECT 1
           FROM public.rep_usuarios_dispositivo u
          WHERE u.dispositivo_id = v.dispositivo_id
            AND right(regexp_replace(u.identificador_afd, '\D', '', 'g'), 11)
              = right(regexp_replace(v.identificador_afd, '\D', '', 'g'), 11));


-- ============================================================================
-- CONFERENCIA - OBRIGATORIA, E NESTA ORDEM
-- ============================================================================
-- HOMOLOGACAO PRIMEIRO. plpgsql resolve nome de coluna e existencia de funcao so na EXECUCAO
-- (armadilha 1): "CREATE OR REPLACE sem erro" nao prova nada nestas duas.
--
-- 0. TESTE DE FUMACA - EXECUTAR, nao so criar. Snapshot vazio nao pode encerrar nada:
--
-- SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--          (SELECT id FROM public.dispositivos_rep LIMIT 1), '[]'::jsonb);
--   -- esperado: {"total":0,"sem_correspondencia":0,"vinculos_encerrados":0}
--   -- ATENCAO: isso APAGA o snapshot daquele dispositivo (a funcao sempre substituiu por
--   -- inteiro). Em homologacao, tudo bem; em producao, rode a higiene depois para reler o rele.
--
-- SELECT public.fn_enfileirar_cadastros_rep(gen_random_uuid());
--   -- esperado: excecao 'Dispositivo ... nao encontrado' - nao erro de coluna/funcao.
--
-- 1. O PORTAO: nenhum vinculo vigente pode sobrar apontando para identificador que o snapshot
--    daquele dispositivo nao tem.
--
-- SELECT d.nome, count(*) AS vinculos_orfaos
--   FROM public.rep_vinculos_servidor v
--   JOIN public.dispositivos_rep d ON d.id = v.dispositivo_id
--  WHERE v.vigente_ate IS NULL
--    AND EXISTS (SELECT 1 FROM public.rep_usuarios_dispositivo s WHERE s.dispositivo_id = v.dispositivo_id)
--    AND NOT EXISTS (
--          SELECT 1 FROM public.rep_usuarios_dispositivo u
--           WHERE u.dispositivo_id = v.dispositivo_id
--             AND right(regexp_replace(u.identificador_afd, '\D', '', 'g'), 11)
--               = right(regexp_replace(v.identificador_afd, '\D', '', 'g'), 11))
--  GROUP BY d.nome ORDER BY 2 DESC;
--   -- esperado depois do backfill: ZERO linhas (antes: HMM-01 53, ENF-ZEZINHA 7, SMS 2).
--
-- 2. A tela tem que passar a dizer a verdade no HMM-01: os 3 'ok' viram 'fora_do_relogio'.
--
-- SELECT situacao, count(*)
--   FROM public.fn_cobertura_ponto_dispositivo('611748e6-a1ed-4950-a66a-eae7746982ad', 8, 2026)
--  GROUP BY situacao ORDER BY 2 DESC;
--   -- antes: ok = 3. depois: fora_do_relogio = 3.
--
-- 3. E os outros 12 dispositivos NAO podem mudar de perfil:
--
-- SELECT d.nome, c.situacao, count(*)
--   FROM public.dispositivos_rep d
--   CROSS JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, 8, 2026) c
--  GROUP BY 1, 2 ORDER BY 1, 3 DESC;
--
-- 4. Ponto passado nao pode ter mudado de dono. Encerrar vinculo so vale dali para frente, mas
--    conferir e barato:
--
-- SELECT count(*) FILTER (WHERE servidor_id IS NOT NULL) AS com_dono, count(*) AS total
--   FROM public.marcacoes_ponto WHERE origem = 'rep';
--   -- esperado: o mesmo numero de antes da migration.
