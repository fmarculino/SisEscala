-- Migration: relogio REP compartilhado por multiplos setores - reescreve as funcoes de leitura
-- Data: 2026-08-13
--
-- ARQUIVO GERADO por scratchpad/gen_multi_setor_dispositivo.js. Nao editar a mao - regerar.
-- fn_enfileirar_cadastros_rep, fn_cobertura_ponto_dispositivo e fn_ingerir_afd sao copia
-- mecanica do corpo vigente com substituicoes pontuais - o script aborta se qualquer
-- invariante divergir. fn_cobertura_ponto_resumo tem mudanca mais ampla (RETURNS TABLE muda)
-- mas ainda parte do corpo vigente extraido do arquivo, nao redigitado.
--
-- CONTEXTO E ANALISE DE RISCO COMPLETOS
--   docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md
--
-- PRE-REQUISITO
--   20260813130000_add_dispositivos_rep_setores.sql (tabela + backfill) precisa ja ter sido
--   aplicada e conferida - o checkpoint dela (contagens batendo) e o portao antes desta.
--
-- O QUE MUDA
--   As tres funcoes trocam "d.setor_id IS NULL OR X.setor_id = d.setor_id" (um setor ou
--   nenhum) por "0 linhas em dispositivos_rep_setores OU EXISTS casando" (um conjunto ou
--   nenhum) - 0 linhas continua significando "toda a unidade", exatamente como setor_id NULL
--   significava antes. fn_ingerir_afd passa a gravar setor_id de origem rep como NULL quando o
--   dispositivo tem 0 ou 2+ setores (so grava quando tem exatamente 1) - campo comprovadamente
--   sem nenhum consumidor hoje, ver o plano.
--
-- O QUE NAO MUDA
--   fn_enfileirar_cadastros_por_escala nao e tocada - herda o novo filtro por estar em cima de
--   fn_cobertura_ponto_dispositivo (LATERAL). dispositivos_rep.setor_id (a coluna antiga)
--   continua existindo e populada - so deixa de ser LIDA por estas quatro funcoes. Remocao dela
--   fica para uma migration separada, sem pressa (plano, secao "Sequencia de migracao").
--
-- CHECKPOINT OBRIGATORIO ANTES DE SEGUIR PARA actions.ts/UI (secao de CONFERENCIA no fim
-- deste arquivo): fn_cobertura_ponto_resumo(8, 2026) tem que reproduzir os mesmos numeros de
-- sempre para a LACEM (39 escalados, 27 sem vinculo, 10 fora do relogio, 1 sem biometria, 1
-- ok) - ela esta em "toda a unidade" (0 linhas na tabela nova), entao nada deveria mudar.
--
-- IDEMPOTENTE: CREATE OR REPLACE nas tres primeiras (assinatura e RETURNS nao mudam),
-- DROP FUNCTION IF EXISTS + CREATE em fn_cobertura_ponto_resumo (RETURNS TABLE muda -
-- CLAUDE.md armadilha 1, 42P13 sem o DROP). Seguro reaplicar.


-- ============================================================================
-- 1. fn_enfileirar_cadastros_rep
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_rep(p_dispositivo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_unidade_id uuid;
    v_restrito   boolean;
    v_enfileirados integer := 0;
    v_sem_cpf      integer := 0;
    v_ja_vinculados integer := 0;
BEGIN
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores podem sincronizar cadastros com o rele.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT unidade_id INTO v_unidade_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    -- 0 linhas em dispositivos_rep_setores = "toda a unidade" (mesma semantica de
    -- dispositivos_rep.setor_id IS NULL de antes desta migration); >=1 linha = so os setores
    -- listados. Ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md.
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
    inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, c.id, auth.uid()
          FROM candidatos c
         WHERE regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g') <> ''
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_vinculos_servidor v
                  WHERE v.servidor_id = c.id AND v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL)
           AND NOT EXISTS (
                 SELECT 1 FROM public.rep_cadastros_fila f
                  WHERE f.servidor_id = c.id AND f.dispositivo_id = p_dispositivo_id AND f.status = 'pendente')
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos), (SELECT n FROM sem_cpf), (SELECT n FROM ja_vinculados)
      INTO v_enfileirados, v_sem_cpf, v_ja_vinculados;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'sem_cpf', v_sem_cpf,
        'ja_vinculados', v_ja_vinculados
    );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_enfileirar_cadastros_rep(uuid) TO authenticated;


-- ============================================================================
-- 2. fn_cobertura_ponto_dispositivo (RETURNS TABLE nao muda - CREATE OR REPLACE basta)
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
               -- identificador_afd E o CPF preenchido a 12 posicoes (CLAUDE.md armadilha 10).
               -- CPF vazio nao vira identificador nenhum: NULL para nao casar com lpad('',12).
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
          LEFT JOIN public.rep_usuarios_dispositivo u
                 ON u.dispositivo_id = p_dispositivo_id
                AND b.cpf_digitos IS NOT NULL
                AND u.identificador_afd = lpad(b.cpf_digitos, 12, '0')
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
               WHEN r.cpf_digitos IS NULL                                          THEN 'sem_cpf'
               -- Sem vinculo E sem snapshot: nao da para afirmar que a pessoa nao esta no
               -- equipamento, so que ninguem leu o cadastro dele ainda. Dizer "fora do relogio"
               -- aqui seria alarme fabricado.
               WHEN r.ident_snapshot IS NULL AND r.vinculo_id IS NULL
                    AND v_snapshot_em IS NULL                                      THEN 'sem_snapshot'
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
-- 3. fn_cobertura_ponto_resumo (RETURNS TABLE muda - DROP antes do CREATE)
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_resumo(integer, integer);

CREATE FUNCTION public.fn_cobertura_ponto_resumo(
    p_mes integer DEFAULT NULL,
    p_ano integer DEFAULT NULL
)
RETURNS TABLE (
    dispositivo_id      uuid,
    dispositivo_nome    text,
    unidade_nome        text,
    setores_nomes       text,
    ativo               boolean,
    ultimo_contato_em   timestamptz,
    snapshot_em         timestamptz,
    escalados           integer,
    ok                  integer,
    sem_vinculo         integer,
    sem_biometria       integer,
    fora_do_relogio     integer,
    sem_cpf             integer,
    sem_snapshot        integer,
    nao_conseguem_bater integer,
    batidas_perdidas    integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH dispositivos AS MATERIALIZED (
        SELECT d.id, d.nome, d.unidade_id, d.ativo, d.ultimo_contato_em
          FROM public.dispositivos_rep d
         WHERE auth.uid() IS NULL           -- service_role/SQL direto, ver guard da funcao acima
            OR public.fn_unidade_no_escopo(d.unidade_id)
            OR public.fn_unidade_alcancavel_por_setor(d.unidade_id)
    )
    SELECT d.id,
           d.nome,
           un.nome,
           max(setores_agg.nomes),
           d.ativo,
           d.ultimo_contato_em,
           max(c.snapshot_em),
           count(*)::integer,
           count(*) FILTER (WHERE c.situacao = 'ok')::integer,
           count(*) FILTER (WHERE c.situacao = 'sem_vinculo')::integer,
           count(*) FILTER (WHERE c.situacao = 'sem_biometria')::integer,
           count(*) FILTER (WHERE c.situacao = 'fora_do_relogio')::integer,
           count(*) FILTER (WHERE c.situacao = 'sem_cpf')::integer,
           count(*) FILTER (WHERE c.situacao = 'sem_snapshot')::integer,
           count(*) FILTER (WHERE c.situacao <> 'ok')::integer,
           COALESCE(sum(c.batidas_perdidas), 0)::integer
      FROM dispositivos d
      JOIN public.unidades un ON un.id = d.unidade_id
      LEFT JOIN LATERAL (
          -- Lista os setores deste dispositivo (0 linhas = "toda a unidade", igual antes).
          SELECT string_agg(ds2.nome, ', ' ORDER BY ds2.nome) AS nomes
            FROM public.dispositivos_rep_setores drs
            JOIN public.setores se2 ON se2.id = drs.setor_id
            JOIN public.dicionario_setores ds2 ON ds2.id = se2.dicionario_setor_id
           WHERE drs.dispositivo_id = d.id
      ) setores_agg ON true

      LEFT JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, p_mes, p_ano) c ON true
     GROUP BY d.id, d.nome, un.nome, d.ativo, d.ultimo_contato_em
     ORDER BY count(*) FILTER (WHERE c.situacao <> 'ok') DESC, d.nome
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 4. fn_ingerir_afd
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_ingerir_afd(
    p_dispositivo_id uuid,
    p_lote_id        uuid,
    p_linhas         jsonb,          -- array de strings, ja em UTF-8
    p_canal          text DEFAULT 'coletor_http',
    p_arquivo_sha256 text DEFAULT NULL,
    p_coletor_versao text DEFAULT NULL,
    p_coletor_host   text DEFAULT NULL,
    p_ip             inet DEFAULT NULL,
    p_importado_por  uuid DEFAULT NULL,
    p_assinatura_ok  boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_sinc_id     uuid;
    v_existente   public.rep_sincronizacoes%ROWTYPE;
    v_unidade_id  uuid;
    v_setor_id    uuid;
    v_n_setores   integer;
    v_hash_ant    text;
    v_linha       text;
    v_p           record;
    v_sha         text;
    v_afd_id      uuid;
    v_servidor_id uuid;
    v_recebidas   integer := 0;
    v_novas       integer := 0;
    v_dups        integer := 0;
    v_marc        integer := 0;
    v_orfas       integer := 0;
    v_nsr_min     bigint;
    v_nsr_max     bigint;
BEGIN
    -- 3.1 Idempotencia do lote: reenvio apos falha de rede devolve o resultado anterior.
    SELECT * INTO v_existente
      FROM public.rep_sincronizacoes
     WHERE dispositivo_id = p_dispositivo_id AND lote_id = p_lote_id;

    IF FOUND AND v_existente.status = 'concluida' THEN
        RETURN jsonb_build_object(
            'reenvio', true, 'sincronizacao_id', v_existente.id,
            'recebidas', v_existente.linhas_recebidas, 'novas', v_existente.linhas_novas,
            'duplicadas', v_existente.linhas_duplicadas, 'marcacoes', v_existente.marcacoes_criadas,
            'orfas', v_existente.marcacoes_orfas, 'nsr_max_aceito', v_existente.nsr_final);
    END IF;

    SELECT unidade_id INTO v_unidade_id
      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;
    END IF;

    -- setor_id da marcacao so faz sentido quando o dispositivo atende EXATAMENTE um setor -
    -- com zero (toda a unidade) ou mais de um nao seria honesto atribuir a um dos varios.
    -- Ninguem le este campo hoje para marcacao de origem rep (levantado antes de mudar isto,
    -- ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md): nao
    -- filtra RLS (so unidade_id filtra), fn_alocar_marcacoes_dia casa so por servidor+tempo, e
    -- fn_marcacoes_pendentes_revisao exclui explicitamente origem rep. E so contexto.
    --
    -- Duas consultas, nao count(*) + min() do setor numa so: o Postgres nao tem agregado
    -- min()/max() para uuid (sem operator class de agregacao registrada para o tipo, apesar de
    -- suportar < / > / ORDER BY) - "function min(uuid) does not exist". Pego em producao ao
    -- validar esta mesma migration (checkpoint 4), antes de gerar dado real com o bug.
    SELECT count(*) INTO v_n_setores
      FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;
    IF v_n_setores = 1 THEN
        SELECT setor_id INTO v_setor_id
          FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;
    ELSE
        v_setor_id := NULL;
    END IF;


    INSERT INTO public.rep_sincronizacoes (
        dispositivo_id, lote_id, canal, arquivo_sha256, assinatura_verificada,
        coletor_versao, coletor_hostname, ip_origem, importado_por_id)
    VALUES (p_dispositivo_id, p_lote_id, p_canal, p_arquivo_sha256, p_assinatura_ok,
            p_coletor_versao, p_coletor_host, p_ip, p_importado_por)
    RETURNING id INTO v_sinc_id;

    -- 3.2 Ultimo elo da cadeia de hash deste dispositivo.
    SELECT hash_encadeado INTO v_hash_ant
      FROM public.rep_afd_registros
     WHERE dispositivo_id = p_dispositivo_id
     ORDER BY nsr DESC LIMIT 1;

    -- 3.3 Processa em ordem de NSR. A ordem importa: a cadeia de hash e sequencial.
    FOR v_linha IN
        SELECT x FROM jsonb_array_elements_text(p_linhas) AS x
         ORDER BY substring(x from 1 for 9)
    LOOP
        v_recebidas := v_recebidas + 1;
        SELECT * INTO v_p FROM public.fn_parse_linha_afd(v_linha);

        IF v_p.nsr IS NULL THEN
            CONTINUE;   -- linha ilegivel: nao entra na cadeia
        END IF;

        v_sha := encode(sha256(convert_to(v_linha, 'UTF8')), 'hex');

        INSERT INTO public.rep_afd_registros (
            dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256,
            ocorrido_em, identificador_afd, parse_versao, parse_ok, parse_erro,
            hash_anterior, hash_encadeado, sincronizacao_id)
        VALUES (
            p_dispositivo_id, v_p.nsr, COALESCE(v_p.tipo, '?'), v_linha, v_sha,
            v_p.ocorrido_em, v_p.identificador, 1, v_p.ok, v_p.erro,
            v_hash_ant,
            encode(sha256(convert_to(COALESCE(v_hash_ant, '') || v_sha, 'UTF8')), 'hex'),
            v_sinc_id)
        ON CONFLICT (dispositivo_id, nsr) DO NOTHING
        RETURNING id INTO v_afd_id;

        IF v_afd_id IS NULL THEN
            v_dups := v_dups + 1;
            CONTINUE;   -- NSR ja ingerido: a cadeia dele ja existe, nao avanca v_hash_ant
        END IF;

        v_novas    := v_novas + 1;
        v_hash_ant := encode(sha256(convert_to(COALESCE(v_hash_ant, '') || v_sha, 'UTF8')), 'hex');
        v_nsr_min  := LEAST(COALESCE(v_nsr_min, v_p.nsr), v_p.nsr);
        v_nsr_max  := GREATEST(COALESCE(v_nsr_max, v_p.nsr), v_p.nsr);

        -- 3.4 Marcacao de ponto: somente registro tipo 3.
        IF v_p.tipo = '3' AND v_p.ocorrido_em IS NOT NULL THEN
            -- Resolucao do servidor pelo vinculo VIGENTE NA DATA DA BATIDA. Usar o vinculo
            -- atual faria uma correcao de hoje reescrever a autoria de batidas antigas.
            SELECT v.servidor_id INTO v_servidor_id
              FROM public.rep_vinculos_servidor v
             WHERE v.dispositivo_id = p_dispositivo_id
               AND v.identificador_afd = v_p.identificador
               AND v.vigente_de <= v_p.ocorrido_em
               AND (v.vigente_ate IS NULL OR v.vigente_ate > v_p.ocorrido_em)
             ORDER BY v.vigente_de DESC
             LIMIT 1;

            IF v_servidor_id IS NULL THEN
                v_orfas := v_orfas + 1;   -- orfa NUNCA e descartada, so fica sem dono
            END IF;

            PERFORM public.fn_registrar_marcacao(
                v_servidor_id,
                'rep'::public.marcacao_origem,
                v_p.ocorrido_em,
                v_unidade_id, v_setor_id,
                NULL, NULL, NULL,
                false,                                        -- batida de REP nunca e sintetica
                (v_p.ocorrido_em < now() - interval '1 day'), -- retroativa: coleta atrasada
                p_dispositivo_id, v_p.nsr, v_afd_id, v_p.identificador,
                (p_canal = 'pendrive'),
                'AFD NSR ' || v_p.nsr::text);

            v_marc := v_marc + 1;
        END IF;
    END LOOP;

    -- 3.5 Fecha a sincronizacao e avanca o NSR aceito do dispositivo.
    UPDATE public.rep_sincronizacoes
       SET concluida_em = now(), status = 'concluida',
           nsr_inicial = v_nsr_min, nsr_final = v_nsr_max,
           linhas_recebidas = v_recebidas, linhas_novas = v_novas,
           linhas_duplicadas = v_dups, marcacoes_criadas = v_marc, marcacoes_orfas = v_orfas
     WHERE id = v_sinc_id;

    UPDATE public.dispositivos_rep
       SET ultimo_nsr = GREATEST(COALESCE(ultimo_nsr, 0), COALESCE(v_nsr_max, 0)),
           updated_at = now()
     WHERE id = p_dispositivo_id;

    RETURN jsonb_build_object(
        'reenvio', false, 'sincronizacao_id', v_sinc_id,
        'recebidas', v_recebidas, 'novas', v_novas, 'duplicadas', v_dups,
        'marcacoes', v_marc, 'orfas', v_orfas,
        'nsr_inicial', v_nsr_min, 'nsr_max_aceito', v_nsr_max);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ingerir_afd FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd TO service_role;


-- ============================================================================
-- 5. fn_definir_setores_dispositivo_rep (nova - escrita atomica da tabela de juncao)
-- ============================================================================

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
    IF auth.uid() IS NOT NULL THEN
        IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
            RAISE EXCEPTION 'Apenas administradores podem definir os setores de um dispositivo REP.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT unidade_id INTO v_unidade_id FROM public.dispositivos_rep WHERE id = p_dispositivo_id;
    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
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

COMMENT ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) IS
    'Substitui o conjunto de setores de um dispositivo REP numa escrita atomica. Lista vazia ou '
    'NULL = "toda a unidade" (mesma semantica de dispositivos_rep.setor_id IS NULL). Recusa '
    'setor de outra unidade.';

REVOKE ALL ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) CHECKPOINT (bloqueia a proxima etapa se divergir) - reproduzir os numeros de sempre:
--
--   SELECT dispositivo_nome, setores_nomes, escalados, ok, sem_vinculo, sem_biometria,
--          fora_do_relogio, sem_cpf, sem_snapshot, nao_conseguem_bater, batidas_perdidas
--     FROM public.fn_cobertura_ponto_resumo(8, 2026);
--   -- LACEM esperado: 39/1/27/1/10/.../1 - identico a antes desta migration. setores_nomes
--   -- NULL (dispositivo em "toda a unidade").
--
--   2) fn_cobertura_ponto_dispositivo isolada bate com o resumo (fonte unica preservada):
--
--   SELECT situacao, count(*) FROM public.fn_cobertura_ponto_dispositivo(
--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%lacem%'), 8, 2026)
--    GROUP BY 1 ORDER BY 1;
--
--   3) fn_definir_setores_dispositivo_rep grava e troca o conjunto inteiro (teste manual, nao
--      em cima do dispositivo real da LACEM sem querer mudar o comportamento dele):
--
--   SELECT public.fn_definir_setores_dispositivo_rep(
--       '<dispositivo de teste>'::uuid, ARRAY['<setor A>'::uuid, '<setor B>'::uuid]);
--   SELECT setor_id FROM public.dispositivos_rep_setores WHERE dispositivo_id = '<dispositivo de teste>';
--   -- esperado: exatamente os 2 setores. Repetir com ARRAY[]::uuid[] (ou NULL) tem que zerar
--   -- (voltar a "toda a unidade"), e com um setor de OUTRA unidade tem que dar RAISE EXCEPTION
--   -- sem gravar nada.
--
--   4) fn_ingerir_afd continua criando marcacao para dispositivo de 0 ou 1 setor (nao regrediu
--      o caminho comum) - reprocessar um lote pequeno de teste e conferir
--      marcacoes_ponto.setor_id: NULL para dispositivo "toda a unidade" ou multi-setor, igual
--      ao setor unico para dispositivo com exatamente 1 setor na tabela nova.
