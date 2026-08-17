-- ============================================================================
-- Identidade do relogio: casar por CPF **ou** PIS (17/08/2026)
-- ============================================================================
-- ARQUIVO GERADO por scratchpad/gen_identidade_cpf_pis.js. Nao editar a mao - regerar.
-- fn_registrar_snapshot_usuarios_dispositivo e fn_cobertura_ponto_dispositivo sao copia
-- mecanica do corpo vigente com substituicoes pontuais; o script aborta se qualquer invariante
-- divergir (CLAUDE.md armadilha 1).
--
-- O PROBLEMA (medido em producao em 17/08/2026)
--
--   "O identificador do AFD e o CPF" nunca foi propriedade do AFD - e propriedade de COMO cada
--   pessoa foi cadastrada em CADA relogio. O REP da SMS (10.110.0.20) veio de outro sistema que
--   cadastrava por PIS/NIS: dos 323 usuarios dele, 292 validam como PIS e so 13 como CPF
--   (conferido pelos digitos verificadores). Resultado, tudo silencioso:
--
--     * fn_registrar_snapshot_... resolveu 0 dos 323 (casava so por CPF)
--     * fn_cobertura_ponto_dispositivo rotulou 'fora_do_relogio' 27 servidores que estao no
--       equipamento COM biometria e batem ponto todo dia - a batida virava orfa e a tela dizia
--       que eles nem estavam cadastrados
--     * as 265.922 marcacoes do dispositivo ficaram todas sem dono
--
--   E os relogios da LACEM, CEI e Reg/TI/TFD estao cadastrados por CPF e funcionam. A solucao
--   nao pode quebrar esses.
--
-- A SOLUCAO: uma FONTE UNICA de resolucao que tenta vinculo, CPF e PIS - e nao um flag por
-- dispositivo. Flag por dispositivo seria errado desde o primeiro dia, porque a SMS vai ficar
-- MISTURADA: 292 pessoas antigas por PIS mais todas as novas por CPF, no mesmo equipamento.
-- Misturado e o caso normal, nao a excecao.
--
-- SEGURANCA CONFERIDA EM PRODUCAO ANTES DE ESCREVER ISTO (o "um nao pode atrapalhar o outro"):
--
--   * numeros que sao CPF de um servidor E PIS de outro:            0
--   * usuarios de relogio que casariam com 2 servidores diferentes: 0 (nos 4 dispositivos)
--   * CEI 67/67, LACEM 43/43, Reg-TI-TFD 43/44 casam so por CPF; SMS 48 casam so por PIS
--
--   Os conjuntos sao disjuntos: ampliar para PIS nao pode mudar nenhum casamento existente.
--   Ainda assim fn_servidor_por_identificador_afd RECUSA (devolve NULL) se um dia CPF e PIS
--   apontarem para pessoas diferentes - chutar ali daria ponto de uma pessoa para outra.
--
-- O QUE NAO MUDA
--   * Cadastro NOVO continua usando CPF (fn_enfileirar_cadastros_rep intocada). PIS entra so
--     como chave de LEITURA, para reconhecer o legado.
--   * fn_vincular_cadastros_por_cpf nao muda de corpo: ela sempre leu u.servidor_id do snapshot,
--     nunca casou por CPF - o nome e que engana. Corrigido o COMMENT dela aqui.
--   * RETURNS TABLE de fn_cobertura_ponto_dispositivo intocado, entao CREATE OR REPLACE basta e
--     fn_cobertura_ponto_resumo (envelope LATERAL) nao precisa ser derrubada (armadilha do 42P13).
--   * Nenhuma marcacao e reatribuida por esta migration. Criar vinculo nao reprocessa AFD; quem
--     reprocessa e fn_reparse_afd_dispositivo, e ela le o vinculo VIGENTE NA DATA DA BATIDA.
--     ⚠️ Este dispositivo tem marcacao desde ABRIL/2021 (sistema anterior). Ao vincular, use
--     p_vigente_de na data em que o SisEscala assumiu o ponto da unidade - nunca a primeira
--     batida do AFD, ou cinco anos de ponto alheio entram na folha.
-- ============================================================================


-- ============================================================================
-- 1. FONTE UNICA: de quem e este identificador?
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_servidor_por_identificador_afd(
    p_dispositivo_id uuid,
    p_identificador  text
)
RETURNS TABLE (servidor_id uuid, origem_match text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_chave    text;
    v_vinculo  uuid;
    v_por_cpf  uuid;
    v_por_pis  uuid;
    v_n_cpf    integer;
    v_n_pis    integer;
BEGIN
    -- right(...,11) e NUNCA ltrim(...,'0'): CPF que comeca com zero perderia um digito
    -- (CLAUDE.md armadilha 10). Vale igual para PIS.
    v_chave := right(regexp_replace(COALESCE(p_identificador, ''), '\D', '', 'g'), 11);
    IF length(v_chave) < 11 THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    -- 1) Vinculo vigente manda em tudo: e a decisao humana ja registrada para ESTE dispositivo.
    SELECT v.servidor_id INTO v_vinculo
      FROM public.rep_vinculos_servidor v
     WHERE v.dispositivo_id = p_dispositivo_id
       AND right(regexp_replace(v.identificador_afd, '\D', '', 'g'), 11) = v_chave
       AND v.vigente_ate IS NULL
     ORDER BY v.vigente_de DESC
     LIMIT 1;

    IF v_vinculo IS NOT NULL THEN
        RETURN QUERY SELECT v_vinculo, 'vinculo'::text;
        RETURN;
    END IF;

    -- 2) CPF. Conta antes de escolher: dois servidores Ativos com o mesmo CPF nao podem virar
    -- um casamento arbitrario (a base permite duas matriculas para a mesma pessoa - ver
    -- servidores.vinculo_multiplo_confirmado).
    -- (array_agg(...))[1] e NAO min(): nao existe min(uuid) no Postgres, e plpgsql so descobre
    -- isso na EXECUCAO (armadilha 1) - o CREATE passa feliz. Pego pelo portao em homologacao.
    SELECT count(*), (array_agg(s.id))[1] INTO v_n_cpf, v_por_cpf
      FROM public.servidores s
     WHERE s.status = 'Ativo'
       AND right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) = v_chave
       AND length(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g')) >= 11;

    -- 3) PIS/NIS. O legado da SMS vive aqui.
    -- (array_agg(...))[1] e NAO min(): nao existe min(uuid) no Postgres, e plpgsql so descobre
    -- isso na EXECUCAO (armadilha 1) - o CREATE passa feliz. Pego pelo portao em homologacao.
    SELECT count(*), (array_agg(s.id))[1] INTO v_n_pis, v_por_pis
      FROM public.servidores s
     WHERE s.status = 'Ativo'
       AND right(regexp_replace(COALESCE(s.pis_pasep, ''), '\D', '', 'g'), 11) = v_chave
       AND length(regexp_replace(COALESCE(s.pis_pasep, ''), '\D', '', 'g')) >= 11;

    -- Ambiguidade nunca vira chute. Tres casos, todos devolvem NULL de proposito:
    --   * mais de um servidor pelo mesmo CPF
    --   * mais de um servidor pelo mesmo PIS
    --   * CPF aponta para uma pessoa e PIS para OUTRA
    -- Sem dono e um problema visivel na tela de higiene; dono errado e ponto de uma pessoa
    -- lancado para outra, e ninguem descobre.
    IF v_n_cpf > 1 OR v_n_pis > 1 THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF v_por_cpf IS NOT NULL AND v_por_pis IS NOT NULL AND v_por_cpf <> v_por_pis THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF v_por_cpf IS NOT NULL THEN
        RETURN QUERY SELECT v_por_cpf, 'cpf'::text;
    ELSIF v_por_pis IS NOT NULL THEN
        RETURN QUERY SELECT v_por_pis, 'pis'::text;
    ELSE
        RETURN QUERY SELECT NULL::uuid, NULL::text;
    END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_servidor_por_identificador_afd(uuid, text) IS
    'De quem e este identificador de AFD, neste dispositivo. Tenta vinculo vigente, depois CPF, '
    'depois PIS/NIS - porque o identificador nao e uma propriedade do AFD, e o numero que foi '
    'digitado no cadastro daquela pessoa naquele relogio (a SMS veio cadastrada por PIS). '
    'Devolve NULL, nunca um chute, quando ha ambiguidade: CPF e PIS apontando para pessoas '
    'diferentes, ou mais de um servidor Ativo com o mesmo numero. FONTE UNICA - nao replicar '
    'esta regra em outra funcao nem no frontend.';


-- ============================================================================
-- 2. origem_match passa a aceitar 'pis'
-- ============================================================================
-- O CHECK original (20260812040000) so admitia 'vinculo' e 'cpf'; gravar 'pis' violaria e
-- derrubaria o snapshot inteiro.

ALTER TABLE public.rep_usuarios_dispositivo
    DROP CONSTRAINT IF EXISTS rep_usuarios_dispositivo_origem_match_check;

ALTER TABLE public.rep_usuarios_dispositivo
    ADD CONSTRAINT rep_usuarios_dispositivo_origem_match_check
    CHECK (origem_match IS NULL OR origem_match IN ('vinculo', 'cpf', 'pis'));


-- ============================================================================
-- 3. SNAPSHOT DO RELOGIO passa a usar a fonte unica
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

    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) TO service_role;


-- ============================================================================
-- 4. COBERTURA DA ESCALA para de mentir
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cobertura_ponto_dispositivo(
    p_dispositivo_id uuid,
    p_mes            integer DEFAULT NULL,
    p_ano            integer DEFAULT NULL
)
RETURNS TABLE (
    servidor_id        uuid,
    servidor_nome      text,
    matricula          text,
    dias_com_escala    integer,
    identificador_afd  text,
    nome_no_device     text,
    tem_biometria      boolean,
    tem_vinculo        boolean,
    batidas_perdidas   integer,
    situacao           text,
    snapshot_em        timestamptz,
    -- Por que quem esta 'fora_do_relogio' continua fora. Sem estes tres campos a unica orientacao
    -- possivel na tela e "use Sincronizar cadastros", que para o caso de lotacao divergente e
    -- conselho ERRADO: o botao nao pega essa pessoa por mais que se clique (ver secao 4).
    fila_status        text,
    fila_erro          text,
    lotacao_compativel boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role        public.user_role;
    v_unidade_id  uuid;
    v_restrito    boolean;
    v_tz          text;
    v_hoje        date;
    v_mes         integer;
    v_ano         integer;
    v_snapshot_em timestamptz;
BEGIN
    -- auth.uid() NULL = service_role ou SQL direto (Studio, script de conferencia): passa direto,
    -- mesmo padrao ja adotado no guard de fn_blocos_previstos_dia (CLAUDE.md). Sem isso as
    -- consultas de CONFERENCIA no fim deste arquivo reprovariam por falta de permissao e dariam a
    -- impressao de que a migration esta quebrada.
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        -- Denylist, nao allowlist: a allowlist de fn_pode_acionar_sobreaviso deixou 'rh' e
        -- 'rh_unidade' de fora por dois meses sem ninguem perceber (CLAUDE.md). Ver cobertura e
        -- visibilidade, nao autoridade — so os papeis do Portal ficam fora.
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para ver a cobertura de ponto.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT d.unidade_id INTO v_unidade_id
      FROM public.dispositivos_rep d
     WHERE d.id = p_dispositivo_id
       AND (auth.uid() IS NULL
            OR public.fn_unidade_no_escopo(d.unidade_id)
            OR public.fn_unidade_alcancavel_por_setor(d.unidade_id));

    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo inexistente ou fora do seu escopo.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 0 linhas em dispositivos_rep_setores = "toda a unidade" (mesma semantica de
    -- dispositivos_rep.setor_id IS NULL de antes desta migration); >=1 linha = so os setores
    -- listados. Ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md.
    SELECT EXISTS (
        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id
    ) INTO v_restrito;

    -- Mes/ano default = mes corrente NO FUSO CONFIGURADO. O processo Node roda em UTC e o
    -- Postgres desta instalacao tambem — derivar "mes atual" sem o fuso vira o mes seguinte nas
    -- ultimas 3 horas de todo dia 31 (CLAUDE.md armadilha 12).
    -- configuracoes_globais e CHAVE/VALOR (valor jsonb), nao uma linha com uma coluna por
    -- configuracao: `SELECT timezone FROM ...` morre com 'column "timezone" does not exist' - e
    -- morre so em RUNTIME, porque plpgsql nao resolve nome de coluna na criacao da funcao
    -- (CLAUDE.md armadilha 1). Esta e a forma usada por fn_confirmar_presenca e companhia.
    SELECT (valor#>>'{}')::text INTO v_tz
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    v_tz := COALESCE(v_tz, 'America/Sao_Paulo');
    v_hoje := (now() AT TIME ZONE v_tz)::date;
    v_mes := COALESCE(p_mes, EXTRACT(MONTH FROM v_hoje)::integer);
    v_ano := COALESCE(p_ano, EXTRACT(YEAR  FROM v_hoje)::integer);

    SELECT max(u.atualizado_em) INTO v_snapshot_em
      FROM public.rep_usuarios_dispositivo u
     WHERE u.dispositivo_id = p_dispositivo_id;

    RETURN QUERY
    WITH escalados AS (
        SELECT em.servidor_id AS sid, count(DISTINCT ed.dia)::integer AS dias
          FROM public.escala_mensal em
          JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
         WHERE em.mes = v_mes
           AND em.ano = v_ano
           AND em.unidade_id = v_unidade_id
           AND (NOT v_restrito OR EXISTS (
                 SELECT 1 FROM public.dispositivos_rep_setores ds
                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = em.setor_id))
           AND ed.categoria IS NOT NULL
           AND ed.categoria::text <> 'Sobreaviso'
         GROUP BY em.servidor_id
    ),
    base AS (
        SELECT s.id, s.nome, s.matricula, e.dias, s.unidade_id, s.setor_id,
               -- cpf_digitos NAO e mais usado para casar com o relogio (quem casa e o
               -- servidor_id ja resolvido no snapshot). Sobra so para responder "da para
               -- cadastrar esta pessoa?", porque o cadastro novo usa CPF.
               NULLIF(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), '') AS cpf_digitos
          FROM escalados e
          JOIN public.servidores s ON s.id = e.sid
         WHERE s.status = 'Ativo'
    ),
    resolvido AS (
        SELECT b.*,
               lpad(b.cpf_digitos, 12, '0') AS ident,
               u.identificador_afd AS ident_snapshot,
               u.nome_no_device,
               u.tem_biometria    AS bio_snapshot,
               v.id               AS vinculo_id,
               v.tem_biometria    AS bio_vinculo
          FROM base b
          -- Casa pelo servidor JA RESOLVIDO no snapshot, nao por lpad(cpf,12,'0') recalculado
          -- aqui. Recalcular era duplicar a regra de identidade: num relogio cadastrado por PIS
          -- (SMS, 17/08/2026) isso reportava 27 pessoas que batem ponto todo dia como
          -- 'fora_do_relogio'. A resolucao CPF-ou-PIS vive num lugar so, no snapshot.
          --
          -- LATERAL com LIMIT 1: a MESMA pessoa pode ter DOIS cadastros no equipamento (legado
          -- por PIS + cadastro novo por CPF, que e exatamente o cenario da SMS daqui pra frente).
          -- Com LEFT JOIN simples ela apareceria duas vezes na tela.
          LEFT JOIN LATERAL (
              SELECT u2.identificador_afd, u2.nome_no_device, u2.tem_biometria
                FROM public.rep_usuarios_dispositivo u2
               WHERE u2.dispositivo_id = p_dispositivo_id
                 AND u2.servidor_id = b.id
               ORDER BY u2.tem_biometria DESC, u2.identificador_afd
               LIMIT 1
          ) u ON true
          LEFT JOIN public.rep_vinculos_servidor v
                 ON v.dispositivo_id = p_dispositivo_id
                AND v.servidor_id = b.id
                AND v.vigente_ate IS NULL
    )
    SELECT r.id,
           r.nome,
           r.matricula,
           r.dias,
           -- O identificador que o relogio REALMENTE tem, nao o que o CPF produziria: para quem
           -- esta fora do equipamento a coluna fica NULL, que e a informacao honesta.
           r.ident_snapshot,
           r.nome_no_device,
           COALESCE(r.bio_snapshot, r.bio_vinculo, false),
           (r.vinculo_id IS NOT NULL),
           COALESCE(perdidas.n, 0)::integer,
           CASE
               -- ORDEM IMPORTA. Estar no equipamento vem ANTES de "sem_cpf": quem ja esta
               -- cadastrado no relogio (por PIS, por exemplo) nao precisa de CPF para ser
               -- vinculado, e rotular de sem_cpf esconderia alguem que bate ponto todo dia.
               -- sem_cpf passa a significar o que sempre deveria: nao esta no relogio E nao ha
               -- como cadastrar, porque falta o CPF que o cadastro novo usa.
               -- Sem vinculo E sem snapshot: nao da para afirmar que a pessoa nao esta no
               -- equipamento, so que ninguem leu o cadastro dele ainda. Dizer "fora do relogio"
               -- aqui seria alarme fabricado.
               WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL
                    AND v_snapshot_em IS NULL                                      THEN 'sem_snapshot'
               WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL
                    AND r.cpf_digitos IS NULL                                      THEN 'sem_cpf'
               WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL              THEN 'fora_do_relogio'
               WHEN NOT COALESCE(r.bio_snapshot, r.bio_vinculo, false)             THEN 'sem_biometria'
               WHEN r.vinculo_id IS NULL                                           THEN 'sem_vinculo'
               ELSE 'ok'
           END,
           v_snapshot_em,
           fila.status,
           fila.erro,
           -- fn_enfileirar_cadastros_rep (o botao "Sincronizar cadastros") escolhe por LOTACAO
           -- do servidor, nao por escala. Quem esta escalado aqui mas lotado em outro lugar nunca
           -- entra por aquele caminho - e essa e a resposta para "cliquei e nada aconteceu".
           (r.unidade_id = v_unidade_id AND (NOT v_restrito OR EXISTS (
                 SELECT 1 FROM public.dispositivos_rep_setores ds
                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = r.setor_id)))
      FROM resolvido r
      LEFT JOIN LATERAL (
          SELECT f.status, f.erro
            FROM public.rep_cadastros_fila f
           WHERE f.dispositivo_id = p_dispositivo_id
             AND f.servidor_id = r.id
           ORDER BY (f.status = 'pendente') DESC, f.created_at DESC
           LIMIT 1
      ) fila ON true
      -- Batida que o equipamento registrou e que NAO virou marcacao de ninguem. E a prova de que
      -- a pessoa esta tentando bater: alerta com evidencia, nao inferencia a partir do cadastro.
      LEFT JOIN LATERAL (
          SELECT count(*)::integer AS n
            FROM public.rep_afd_registros a
           WHERE a.dispositivo_id = p_dispositivo_id
             AND a.tipo_registro = '3'
             AND a.identificador_afd = r.ident
             AND a.ocorrido_em >= (now() - interval '30 days')
             AND NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v2
                  WHERE v2.dispositivo_id = p_dispositivo_id
                    AND v2.identificador_afd = a.identificador_afd
                    AND v2.vigente_de <= a.ocorrido_em
                    AND (v2.vigente_ate IS NULL OR v2.vigente_ate > a.ocorrido_em)
             )
      ) perdidas ON r.ident IS NOT NULL
     ORDER BY 10, 2;   -- 10 = situacao. Ordem alfabetica dos rotulos NAO e ordem de gravidade:
                       -- serve so para a saida ser estavel; quem ordena por gravidade e a tela.
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 5. O COMMENT de fn_vincular_cadastros_por_cpf estava enganando
-- ============================================================================
-- O corpo dela NAO casa por CPF: ele le rep_usuarios_dispositivo.servidor_id, ja resolvido pelo
-- snapshot. Por isso ela passa a funcionar com PIS sem nenhuma alteracao de corpo - e por isso o
-- nome/COMMENT precisavam ser corrigidos antes que alguem concluisse o contrario.

COMMENT ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) IS
    'Cria vinculos para os servidores que o snapshot do relogio JA resolveu '
    '(rep_usuarios_dispositivo.servidor_id). Apesar do nome, nao casa por CPF aqui: quem casa e '
    'fn_servidor_por_identificador_afd, na ingestao do snapshot, tentando vinculo, CPF e PIS. '
    'Nao escreve no equipamento e NAO reprocessa AFD ja ingerido - p_vigente_de decide quais '
    'batidas passam a ter dono num futuro fn_reparse_afd_dispositivo. Permitido para gestores e '
    'administradores no escopo.';


-- ============================================================================
-- CONFERENCIA - OBRIGATORIA, E NESTA ORDEM
-- ============================================================================
-- ⚠️ APLIQUE EM HOMOLOGACAO PRIMEIRO. As tres funcoes daqui sao plpgsql, e plpgsql resolve nome
-- de coluna e existencia de funcao SO NA EXECUCAO (CLAUDE.md armadilha 1): "CREATE OR REPLACE sem
-- erro" NAO prova nada. Foi exatamente assim que o portao em homologacao pegou um min(uuid)
-- inexistente nesta propria migration - a funcao criou feliz e explodiu ao rodar.
--
-- 0. TESTE DE FUMACA: EXECUTAR as tres, nao so criar. Em banco sem dado nenhum elas tem que
--    devolver vazio SEM ERRO. Se alguma estourar aqui, pare - nao vai a producao.
--
-- SELECT * FROM public.fn_servidor_por_identificador_afd(gen_random_uuid(), '000000000191');
-- SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--          (SELECT id FROM public.dispositivos_rep LIMIT 1), '[]'::jsonb);
-- SELECT count(*) FROM public.dispositivos_rep d
--   CROSS JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, 8, 2026) c;
--
-- 1. A fonte unica responde certo nos dois mundos? (troque os uuid/numeros)
--
-- SELECT * FROM public.fn_servidor_por_identificador_afd(
--     '<dispositivo>', '000123456789');
--
-- 2. Reprocessar o snapshot e ver o PIS aparecer. NAO e destrutivo em outro sentido: o snapshot
--    e substituido por inteiro a cada relato, por desenho. Rode "Atualizar lista de cadastros do
--    relogio" na bandeja da unidade, ou o coletor-rep higiene, e depois:
--
-- SELECT origem_match, count(*)
--   FROM public.rep_usuarios_dispositivo
--  WHERE dispositivo_id = '<dispositivo da SMS>'
--  GROUP BY origem_match ORDER BY 2 DESC;
--   -- esperado: 'pis' com ~48, NULL com ~275 (os que nao sao servidor nenhum - publico da
--   -- higiene), e nenhum erro de CHECK.
--
-- 3. O PORTAO desta migration - a cobertura tem que MUDAR na SMS e NAO mudar nos outros:
--
-- SELECT d.nome, c.situacao, count(*)
--   FROM public.dispositivos_rep d
--   CROSS JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, 8, 2026) c
--  GROUP BY d.nome, c.situacao ORDER BY d.nome, 3 DESC;
--
--   SMS antes: 125 fora_do_relogio + 1 sem_cpf
--   SMS esperado depois: ~27 sem_vinculo (ou sem_biometria), ~83 fora_do_relogio, ~15 sem_cpf
--   LACEM / CEI / Reg-TI-TFD: IDENTICO ao de antes. Qualquer mudanca neles e regressao -
--   pare e investigue, porque a medicao dizia CONFLITO=0 nos tres.
