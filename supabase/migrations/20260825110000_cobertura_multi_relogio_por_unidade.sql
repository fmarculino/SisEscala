-- ============================================================================
-- Cobertura de ponto numa unidade com MAIS DE UM RELOGIO (25/08/2026)
-- ============================================================================
--
-- MOTIVACAO. Ha unidades com 4 equipamentos (e pode haver mais). A cobertura sempre foi
-- calculada POR DISPOSITIVO, e isso continua certo: para bater num relogio, a pessoa precisa
-- estar cadastrada NAQUELE relogio, com biometria. Mas a leitura da tela fica ambigua quando a
-- unidade tem varios: quem esta no relogio do proprio setor e nao no relogio geral aparece como
-- problema no geral, exatamente como quem nao esta em relogio nenhum.
--
-- As duas situacoes exigem acao diferente:
--   * nao esta em NENHUM relogio  -> essa pessoa nao registra ponto. Urgente.
--   * esta em outro relogio da unidade -> ela registra ponto hoje. Cadastra-la aqui e' opcional,
--     e so' faz sentido se ela de fato usa esta entrada.
--
-- O QUE MUDA. Uma coluna em cada funcao, nada mais:
--   fn_cobertura_ponto_dispositivo -> coberto_em (nomes dos outros relogios onde ela bate)
--   fn_cobertura_ponto_resumo      -> cobertos_em_outro (quantos dos "nao conseguem bater" batem
--                                     em outro relogio da mesma unidade)
--
-- NENHUM numero existente muda de significado. nao_conseguem_bater continua sendo "quantos nao
-- conseguem bater NESTE relogio" - descontar dali faria a tela dizer que esta tudo certo num
-- equipamento onde ninguem consegue bater.
--
-- ⚠️ Exige biometria para contar como cobertura. Cadastro sem digital nao registra ponto: contar
-- isso como coberto reintroduziria, por outro caminho, o "bate e nao registra" que a aba de
-- Cobertura existe para denunciar (CLAUDE.md, "Cobertura de ponto").
--
-- ⚠️ DROP antes do CREATE nas duas: CREATE OR REPLACE nao altera a lista de colunas de um
-- RETURNS TABLE (42P13, ja mordeu este mesmo par de funcoes em 13/08/2026). Sem CASCADE, de
-- proposito - dependente de verdade deve dar erro, nao sumir em silencio. A ordem importa: o
-- resumo e' envelope LATERAL do detalhe, entao sai primeiro e volta por ultimo.
--
-- Idempotente: DROP IF EXISTS + CREATE.


-- ============================================================================
-- 1. Fora as duas (dependente primeiro)
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_resumo(integer, integer);
DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_dispositivo(uuid, integer, integer);


-- ============================================================================
-- 2. fn_cobertura_ponto_dispositivo (copia mecanica de 20260817170000 + coberto_em)
-- ============================================================================

CREATE FUNCTION public.fn_cobertura_ponto_dispositivo(
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
    lotacao_compativel boolean,
    -- Outros relogios ATIVOS da mesma unidade em que esta pessoa consegue bater ponto hoje
    -- (esta cadastrada la COM biometria). NULL = nao consegue bater em mais nenhum.
    --
    -- Existe porque uma unidade pode ter varios equipamentos, e ai a mesma pessoa aparece numa
    -- linha por relogio: quem esta no relogio do setor dela e nao no relogio geral e listada
    -- como problema no geral. E verdade (ali ela nao bate), mas nao e a mesma urgencia de quem
    -- nao bate em lugar nenhum - e sem esta coluna as duas sao indistinguiveis na tela.
    coberto_em         text
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
                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = r.setor_id))),
           -- Onde mais esta pessoa consegue bater, na MESMA unidade. Exige biometria de
           -- proposito: cadastro sem digital nao registra ponto, entao contar como cobertura
           -- seria repetir o caso dominante que a aba de Cobertura existe para denunciar.
           (SELECT string_agg(d2.nome, ', ' ORDER BY d2.nome)
              FROM public.dispositivos_rep d2
             WHERE d2.id <> p_dispositivo_id
               AND d2.unidade_id = v_unidade_id
               AND d2.ativo
               AND (EXISTS (SELECT 1 FROM public.rep_usuarios_dispositivo u3
                             WHERE u3.dispositivo_id = d2.id
                               AND u3.servidor_id = r.id
                               AND u3.tem_biometria)
                    OR EXISTS (SELECT 1 FROM public.rep_vinculos_servidor v3
                                WHERE v3.dispositivo_id = d2.id
                                  AND v3.servidor_id = r.id
                                  AND v3.vigente_ate IS NULL
                                  AND v3.tem_biometria)))
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
-- 3. fn_cobertura_ponto_resumo (copia mecanica de 20260813140000 + cobertos_em_outro)
-- ============================================================================

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
    batidas_perdidas    integer,
    -- Quantos dos nao_conseguem_bater JA BATEM em outro relogio ativo desta unidade. Nunca
    -- descontado de nao_conseguem_bater: naquele equipamento a pessoa continua sem conseguir
    -- bater, e mudar o significado de um numero que ja esta na tela seria pior que somar um
    -- numero novo ao lado dele.
    cobertos_em_outro   integer
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
           COALESCE(sum(c.batidas_perdidas), 0)::integer,
           count(*) FILTER (WHERE c.situacao <> 'ok' AND c.coberto_em IS NOT NULL)::integer
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
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. Nenhuma contagem antiga pode ter mudado. Compare com o que a tela mostrava antes:
--   SELECT dispositivo_nome, escalados, ok, nao_conseguem_bater, cobertos_em_outro
--     FROM public.fn_cobertura_ponto_resumo(8, 2026) ORDER BY dispositivo_nome;
--
-- 2. Unidade com mais de um relogio - quem esta coberto em outro lugar:
--   SELECT servidor_nome, situacao, coberto_em
--     FROM public.fn_cobertura_ponto_dispositivo(
--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%hmi%' LIMIT 1), 8, 2026)
--    WHERE coberto_em IS NOT NULL ORDER BY servidor_nome;
--
-- 3. Unidade com UM relogio so: coberto_em tem que ser NULL em toda linha (nao ha outro
--    equipamento para cobrir ninguem). Se vier preenchido, a subconsulta esta ignorando o
--    filtro de unidade:
--   SELECT count(*) FILTER (WHERE coberto_em IS NOT NULL) AS deve_ser_zero
--     FROM public.fn_cobertura_ponto_dispositivo(
--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%lacem%' LIMIT 1), 8, 2026);
