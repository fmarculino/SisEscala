-- Migration: abrangencia do relogio REP - LEITURA (parte 2 de 3)
-- Data: 2026-09-15
--
-- Gerada por scratchpad/gen_abrangencia_leitura.js a partir de 20260905100000, 20260905110000
-- e 20260906110000 (corpos copiados, nao redigitados - armadilha 1).
-- Plano: docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md
--
-- DEPENDE DE 20260915100000 (a coluna atende_toda_unidade). Aplicar NESTA ORDEM.
--
-- O QUE MUDA: as tres funcoes deixam de perguntar "a pessoa e da unidade do relogio?" e passam
-- a perguntar "o relogio atende o setor dela?". Com isso o pessoal do POLO MORADA NOVA (setor
-- da SMS que funciona dentro da USF Carlos Barreto) passa a aparecer na Cobertura de Ponto
-- daquele relogio e a ser enfileirado para cadastro nele - assim que alguem vincular o setor.
--
-- ⚠️ ENQUANTO NINGUEM VINCULAR NADA, ESTA MIGRATION NAO MUDA UM NUMERO SEQUER. Nao existe
--    vinculo para setor de outra unidade hoje (medido: 0). A conferencia no fim PROVA isso
--    executando as funcoes antes/depois e comparando.
--
-- NAO ENTRAM AQUI, de proposito:
--   fn_cobertura_ponto_resumo          - envelope LATERAL de fn_cobertura_ponto_dispositivo
--   fn_enfileirar_cadastros_por_escala - deriva de fn_cobertura_ponto_dispositivo
--   fn_higiene_usuarios_dispositivo    - decide pode_remover por "existe servidor Ativo
--                                        casando", nunca por unidade: quem e do setor de fora
--                                        ja fica protegido de ser removido.
--
-- PERFORMANCE (armadilha 54: esta funcao ja esteve a 1,4s do statement_timeout de 8s)
--   O predicado novo NAO e aplicado como fn_dispositivo_atende_setor() por linha - isso
--   derrubaria o filtro por unidade e faria varrer a rede inteira. A forma usada e um array
--   pequeno pre-computado (v_uni_alc / v_set_extra): com nenhum setor de fora ele tem 1
--   elemento e o plano fica igual ao de hoje.
--
-- IDEMPOTENTE: so CREATE OR REPLACE, sem mudanca na lista de colunas de nenhum RETURNS TABLE
-- (mudar colunas exigiria DROP - armadilha do 42P13).


-- ============================================================================
-- 1. COBERTURA DE PONTO: o universo passa a ser a abrangencia do relogio
-- ============================================================================
-- Corpo copiado de 20260905100000. Mudam 5 trechos, todos conferidos por contagem.
-- Arrasta de graca fn_cobertura_ponto_resumo e fn_enfileirar_cadastros_por_escala.
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
    v_toda_uni    boolean;
    v_set_extra   uuid[];
    v_uni_alc     uuid[];
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

    SELECT d.unidade_id, d.atende_toda_unidade INTO v_unidade_id, v_toda_uni
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
    -- 15/09/2026: "restrito" passou a ser a COLUNA, nao a existencia de linhas. Sem isto,
    -- vincular um setor de OUTRA unidade tornaria o relogio "restrito" e ele perderia a
    -- unidade dona inteira - exatamente o que a coluna existe para impedir.
    v_restrito := NOT v_toda_uni;

    -- Setores atendidos que NAO sao da unidade dona (o setor que funciona dentro de outro
    -- predio). Array pequeno de proposito: e' o que permite ampliar o alcance sem perder o
    -- filtro seletivo por unidade, que ja custou timeout nesta funcao (armadilha 54).
    SELECT COALESCE(array_agg(ds.setor_id), '{}'::uuid[])
      INTO v_set_extra
      FROM public.dispositivos_rep_setores ds
      JOIN public.setores s ON s.id = ds.setor_id
     WHERE ds.dispositivo_id = p_dispositivo_id
       AND s.unidade_id IS DISTINCT FROM v_unidade_id;

    SELECT COALESCE(array_agg(DISTINCT x.uid), '{}'::uuid[])
      INTO v_uni_alc
      FROM (SELECT v_unidade_id AS uid
            UNION
            SELECT s.unidade_id FROM public.setores s WHERE s.id = ANY(v_set_extra)) x;

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
           -- Filtro seletivo preservado: v_uni_alc tem 1 elemento no caso dominante.
           AND em.unidade_id = ANY(v_uni_alc)
           AND ((em.unidade_id = v_unidade_id
                 AND (NOT v_restrito OR EXISTS (
                       SELECT 1 FROM public.dispositivos_rep_setores ds
                        WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = em.setor_id)))
                OR em.setor_id = ANY(v_set_extra))
           AND ed.categoria IS NOT NULL
           AND ed.categoria::text <> 'Sobreaviso'
         GROUP BY em.servidor_id
    ),
    -- LOTADOS nesta unidade (e nos setores deste dispositivo, quando ele e restrito).
    -- Existe porque a aba respondia so "dos ESCALADOS, quem consegue bater?" - quem esta
    -- lotado e cadastrado no relogio, mas sem escala no mes, era invisivel. Medido em
    -- 05/09/2026: 1.257 pessoas cadastradas SEM BIOMETRIA (nao conseguem bater) que a tela
    -- nao mostrava, entre elas 348 no HMM-01 e 57 no CAPS III.
    lotados AS (
        SELECT s.id AS sid
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = ANY(v_uni_alc)
           AND ((s.unidade_id = v_unidade_id
                 AND (NOT v_restrito OR EXISTS (
                       SELECT 1 FROM public.dispositivos_rep_setores ds
                        WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id)))
                OR s.setor_id = ANY(v_set_extra))
    ),
    -- UNIAO, nunca substituicao. Trocar escala por lotacao quebraria o "Servidor Externo"
    -- (v1.2.4): quem e escalado AQUI e lotado em OUTRA unidade sumiria da tela, que e o caso
    -- que fn_enfileirar_cadastros_por_escala existe para atender.
    universo AS (
        SELECT sid FROM escalados
        UNION
        SELECT sid FROM lotados
    ),
    base AS (
        SELECT s.id, s.nome, s.matricula, COALESCE(e.dias, 0) AS dias, s.unidade_id, s.setor_id,
               -- cpf_digitos NAO e mais usado para casar com o relogio (quem casa e o
               -- servidor_id ja resolvido no snapshot). Sobra so para responder "da para
               -- cadastrar esta pessoa?", porque o cadastro novo usa CPF.
               NULLIF(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), '') AS cpf_digitos
          FROM universo u
          JOIN public.servidores s ON s.id = u.sid
          LEFT JOIN escalados e ON e.sid = u.sid
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

-- ============================================================================
-- 2. ENFILEIRAMENTO POR LOTACAO
-- ============================================================================
-- Corpo copiado de 20260905110000. Sem isto, o setor de fora apareceria na tela e nunca
-- chegaria ao equipamento - a tela diria "fora do relogio" para sempre.
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
    v_toda_uni      boolean;
    v_set_extra     uuid[];
    v_uni_alc       uuid[];
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

    SELECT unidade_id, atende_toda_unidade INTO v_unidade_id, v_toda_uni
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
    -- 15/09/2026: ver o comentario equivalente em fn_cobertura_ponto_dispositivo.
    v_restrito := NOT v_toda_uni;

    SELECT COALESCE(array_agg(ds.setor_id), '{}'::uuid[])
      INTO v_set_extra
      FROM public.dispositivos_rep_setores ds
      JOIN public.setores s ON s.id = ds.setor_id
     WHERE ds.dispositivo_id = p_dispositivo_id
       AND s.unidade_id IS DISTINCT FROM v_unidade_id;

    SELECT COALESCE(array_agg(DISTINCT x.uid), '{}'::uuid[])
      INTO v_uni_alc
      FROM (SELECT v_unidade_id AS uid
            UNION
            SELECT s.unidade_id FROM public.setores s WHERE s.id = ANY(v_set_extra)) x;

    WITH candidatos AS (
        SELECT s.id, s.cpf
          FROM public.servidores s
         WHERE s.status = 'Ativo'
           AND s.unidade_id = ANY(v_uni_alc)
           AND ((s.unidade_id = v_unidade_id
                 AND (NOT v_restrito OR EXISTS (
                       SELECT 1 FROM public.dispositivos_rep_setores ds
                        WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id)))
                OR s.setor_id = ANY(v_set_extra))
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
           -- Nao insistir com quem o EQUIPAMENTO ja recusou (ver fn_cadastro_rep_reprovado).
           AND NOT public.fn_cadastro_rep_reprovado(p_dispositivo_id, c.id)
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

-- ============================================================================
-- 3. PAINEL DE COBERTURA DE ESCALA DO PARQUE
-- ============================================================================
-- Corpo copiado de 20260906110000. Sem isto o setor continuaria saindo como
-- "sem_relogio_no_setor" mesmo depois de vinculado ao relogio do predio onde ele fica.
CREATE OR REPLACE FUNCTION public.fn_cobertura_escala_parque(
    p_mes integer DEFAULT NULL,
    p_ano integer DEFAULT NULL
)
RETURNS TABLE (
    servidor_id       uuid,
    servidor_nome     text,
    matricula         text,
    escala_unidade_id uuid,
    unidade_nome      text,
    setor_id          uuid,
    setor_nome        text,
    externo           boolean,
    lotacao_nome      text,
    dias_escalados    integer,
    primeiro_dia      integer,
    situacao          text,
    relogios_alvo     text,
    bate_em           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
-- RETURNS TABLE declara parametro de SAIDA com o nome de cada coluna, e varios deles se chamam
-- igual a colunas reais (servidor_id, matricula, setor_id, situacao...). Sem esta linha, qualquer
-- referencia nao qualificada vira 42702 "could not refer to either a PL/pgSQL variable or a table
-- column" - e SO EM RUNTIME, porque plpgsql nao resolve nome na criacao (armadilha 42). Aqui o
-- retorno e por RETURN QUERY, entao o parametro de saida nunca precisa ser lido como variavel.
#variable_conflict use_column
DECLARE
    v_role public.user_role;
    v_tz   text;
    v_hoje date;
    v_mes  integer;
    v_ano  integer;
BEGIN
    -- auth.uid() NULL = service_role / SQL direto: passa (mesmo padrao do guard de
    -- fn_blocos_previstos_dia), senao a conferencia no fim deste arquivo reprovaria sozinha.
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        -- DENYLIST, nao allowlist: ver cobertura e visibilidade, nao autoridade. A allowlist de
        -- fn_pode_acionar_sobreaviso deixou 'rh' e 'rh_unidade' de fora por dois meses sem
        -- ninguem perceber (armadilha 44). So os papeis do Portal ficam fora.
        IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
            RAISE EXCEPTION 'Sem permissao para ver a cobertura de escala.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Mes corrente NO FUSO CONFIGURADO. O Postgres desta instalacao roda em UTC: derivar o mes
    -- sem o fuso vira o mes seguinte nas ultimas 3 horas de todo dia 31 (armadilha 12).
    -- configuracoes_globais e CHAVE/VALOR com `valor` jsonb - nao existe coluna `timezone`.
    SELECT (valor#>>'{}')::text INTO v_tz
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    v_tz := COALESCE(v_tz, 'America/Sao_Paulo');
    v_hoje := (now() AT TIME ZONE v_tz)::date;
    v_mes := COALESCE(p_mes, EXTRACT(MONTH FROM v_hoje)::integer);
    v_ano := COALESCE(p_ano, EXTRACT(YEAR  FROM v_hoje)::integer);

    RETURN QUERY
    WITH escalas AS (
        SELECT em.id, em.servidor_id AS sid, em.unidade_id AS uid, em.setor_id AS setid,
               count(DISTINCT ed.dia)::integer AS dias,
               min(ed.dia)::integer            AS primeiro
          FROM public.escala_mensal em
          JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
         WHERE em.mes = v_mes
           AND em.ano = v_ano
           -- Escopo do usuario. fn_unidade_no_escopo SOZINHA so olha profile_unidades e recusa
           -- coordenador cujo acesso vem de profile_setores (CLAUDE.md, pendencia 3).
           AND (auth.uid() IS NULL
                OR public.fn_unidade_no_escopo(em.unidade_id)
                OR public.fn_unidade_alcancavel_por_setor(em.unidade_id))
           AND ed.categoria IS NOT NULL
           -- Sobreaviso nao marca presenca e tem ciclo proprio (armadilha 6).
           AND ed.categoria::text <> 'Sobreaviso'
         GROUP BY em.id, em.servidor_id, em.unidade_id, em.setor_id
    ),
    -- Relogios ATIVOS que atendem o setor DA ESCALA. 0 linhas em dispositivos_rep_setores =
    -- "toda a unidade" (mesma semantica da aba Cobertura de Ponto).
    alvo AS (
        -- 15/09/2026: o relogio passa a poder atender setor de OUTRA unidade. O JOIN
        -- continua ancorado em d.unidade_id = e.uid para nao perder a seletividade
        -- (armadilha 54); o segundo ramo so amplia para os POUCOS relogios que tem algum
        -- setor de fora - hoje, nenhum.
        SELECT e.id AS escala_id, d.id AS dispositivo_id, d.nome AS dnome
          FROM escalas e
          JOIN public.dispositivos_rep d
            ON d.ativo
           AND (d.unidade_id = e.uid
                OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores dx
                            JOIN public.setores sx ON sx.id = dx.setor_id
                           WHERE dx.dispositivo_id = d.id
                             AND sx.unidade_id IS DISTINCT FROM d.unidade_id))
         WHERE (d.atende_toda_unidade AND d.unidade_id = e.uid)
            OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                        WHERE ds.dispositivo_id = d.id AND ds.setor_id = e.setid)
    ),
    -- Cadastro/digital no snapshot, casando por servidor_id JA RESOLVIDO. Recalcular
    -- lpad(cpf,12,'0') aqui duplicaria a regra de identidade e reportaria como "fora do relogio"
    -- quem bate todo dia num equipamento cadastrado por PIS (armadilha 10).
    situado AS (
        SELECT e.id, e.sid, e.uid, e.setid, e.dias, e.primeiro,
               (SELECT count(*) FROM alvo a WHERE a.escala_id = e.id) AS n_alvo,
               (SELECT count(*) FROM alvo a
                  JOIN public.rep_usuarios_dispositivo u
                    ON u.dispositivo_id = a.dispositivo_id AND u.servidor_id = e.sid
                 WHERE a.escala_id = e.id) AS n_cad,
               (SELECT count(*) FROM alvo a
                  JOIN public.rep_usuarios_dispositivo u
                    ON u.dispositivo_id = a.dispositivo_id AND u.servidor_id = e.sid
                 WHERE a.escala_id = e.id AND u.tem_biometria) AS n_bio,
               (SELECT string_agg(a.dnome, ', ' ORDER BY a.dnome)
                  FROM alvo a WHERE a.escala_id = e.id) AS relogios
          FROM escalas e
    )
    SELECT s.sid,
           sv.nome,
           sv.matricula,
           s.uid,
           un.nome,
           s.setid,
           dse.nome,
           sv.unidade_id IS DISTINCT FROM s.uid,
           ulot.nome,
           s.dias,
           s.primeiro,
           CASE WHEN s.n_alvo = 0        THEN 'sem_relogio_no_setor'
                WHEN s.n_bio  = s.n_alvo THEN 'ok'
                WHEN s.n_cad  = 0        THEN 'fora_do_relogio'
                WHEN s.n_bio  = 0        THEN 'sem_biometria'
                ELSE                          'parcial' END,
           s.relogios,
           -- Onde ela bate hoje, em QUALQUER unidade: e o que distingue "so falta cadastrar a
           -- digital aqui" de "nunca cadastrou digital em lugar nenhum".
           (SELECT string_agg(DISTINCT u3.nome, ', ')
              FROM public.rep_usuarios_dispositivo ru
              JOIN public.dispositivos_rep d3 ON d3.id = ru.dispositivo_id AND d3.ativo
              JOIN public.unidades u3         ON u3.id = d3.unidade_id
             WHERE ru.servidor_id = s.sid AND ru.tem_biometria)
      FROM situado s
      JOIN public.servidores sv ON sv.id = s.sid AND sv.status = 'Ativo'
      JOIN public.unidades   un ON un.id = s.uid
      LEFT JOIN public.unidades ulot ON ulot.id = sv.unidade_id
      LEFT JOIN public.setores  se  ON se.id  = s.setid
      LEFT JOIN public.dicionario_setores dse ON dse.id = se.dicionario_setor_id
     WHERE NOT (s.n_alvo > 0 AND s.n_bio = s.n_alvo)
     ORDER BY s.primeiro, un.nome, sv.nome;
END;
$fn$;

-- ============================================================================
-- 4. CONFERENCIA (roda junto, aborta a migration inteira se algo divergir)
-- ============================================================================
-- Armadilha 42: conferencia que so checa se a funcao existe nao serve - tem que EXECUTAR.
-- Confere os DOIS sentidos: nada mudou para quem ja era atendido (inercia), E o caminho novo
-- de fato funciona quando um setor de fora e vinculado (ensaio revertido).

DO $conf$
DECLARE
    v_disp      record;
    v_n         integer;
    v_antes     integer;
    v_depois    integer;
    v_extra     uuid;
    v_uni_fora  uuid;
    v_total     integer := 0;
BEGIN
    -- 4.0 A parte 1 precisa estar aplicada.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'dispositivos_rep'
                      AND column_name = 'atende_toda_unidade') THEN
        RAISE EXCEPTION 'ABORTADO: aplique 20260915100000 (coluna atende_toda_unidade) antes desta.';
    END IF;

    -- 4.1 INERCIA: com nenhum setor de fora vinculado, a cobertura de cada relogio ativo tem
    --     que devolver exatamente o mesmo tamanho de universo de antes. Como nao da para
    --     rodar a versao antiga aqui, a prova e a regra antiga reconstruida em SQL puro.
    FOR v_disp IN SELECT id, unidade_id, atende_toda_unidade FROM public.dispositivos_rep WHERE ativo LOOP
        SELECT count(*) INTO v_depois
          FROM public.fn_cobertura_ponto_dispositivo(v_disp.id, NULL, NULL);

        SELECT count(DISTINCT sid) INTO v_antes FROM (
            SELECT em.servidor_id AS sid
              FROM public.escala_mensal em
              JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
             WHERE em.mes = EXTRACT(MONTH FROM (now() AT TIME ZONE COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'), 'America/Sao_Paulo'))::date)::integer
               AND em.ano = EXTRACT(YEAR  FROM (now() AT TIME ZONE COALESCE((SELECT (valor#>>'{}')::text FROM public.configuracoes_globais WHERE chave = 'timezone'), 'America/Sao_Paulo'))::date)::integer
               AND em.unidade_id = v_disp.unidade_id
               AND (v_disp.atende_toda_unidade OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                                                           WHERE ds.dispositivo_id = v_disp.id AND ds.setor_id = em.setor_id))
               AND ed.categoria IS NOT NULL AND ed.categoria::text <> 'Sobreaviso'
               AND EXISTS (SELECT 1 FROM public.servidores s WHERE s.id = em.servidor_id AND s.status = 'Ativo')
             UNION
            SELECT s.id
              FROM public.servidores s
             WHERE s.status = 'Ativo' AND s.unidade_id = v_disp.unidade_id
               AND (v_disp.atende_toda_unidade OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds
                                                           WHERE ds.dispositivo_id = v_disp.id AND ds.setor_id = s.setor_id))
        ) x;

        IF v_depois <> v_antes THEN
            RAISE EXCEPTION 'ABORTADO: universo do dispositivo % mudou (regra antiga=%, funcao nova=%).',
                v_disp.id, v_antes, v_depois;
        END IF;
        v_total := v_total + 1;
    END LOOP;
    RAISE NOTICE 'ok  4.1 universo identico a regra antiga em % relogio(s) ativo(s)', v_total;

    -- 4.2 O SENTIDO NOVO, por ensaio: vincular um setor de outra unidade tem que AUMENTAR o
    --     universo daquele relogio. Sem esta prova, a migration poderia nao estar fazendo nada.
    SELECT d.id, d.unidade_id INTO v_disp FROM public.dispositivos_rep d WHERE d.ativo LIMIT 1;
    IF v_disp.id IS NOT NULL THEN
        SELECT s.id, s.unidade_id INTO v_extra, v_uni_fora
          FROM public.setores s
          JOIN public.servidores sv ON sv.setor_id = s.id AND sv.status = 'Ativo'
         WHERE s.unidade_id IS DISTINCT FROM v_disp.unidade_id
         GROUP BY s.id, s.unidade_id HAVING count(*) > 0 LIMIT 1;

        IF v_extra IS NOT NULL THEN
            SELECT count(*) INTO v_antes FROM public.fn_cobertura_ponto_dispositivo(v_disp.id, NULL, NULL);
            INSERT INTO public.dispositivos_rep_setores (dispositivo_id, setor_id)
                 VALUES (v_disp.id, v_extra) ON CONFLICT DO NOTHING;
            SELECT count(*) INTO v_depois FROM public.fn_cobertura_ponto_dispositivo(v_disp.id, NULL, NULL);
            DELETE FROM public.dispositivos_rep_setores
                  WHERE dispositivo_id = v_disp.id AND setor_id = v_extra;

            IF v_depois <= v_antes THEN
                RAISE EXCEPTION 'ABORTADO: vincular setor de outra unidade nao ampliou o universo (antes=%, depois=%). A migration nao esta fazendo efeito.', v_antes, v_depois;
            END IF;
            RAISE NOTICE 'ok  4.2 setor de outra unidade amplia o universo: % -> % (ensaio revertido)', v_antes, v_depois;
        ELSE
            RAISE NOTICE '-   4.2 pulado: nao ha setor de outra unidade com servidor ativo para o ensaio';
        END IF;
    END IF;

    -- 4.3 O vinculo de ensaio foi mesmo desfeito.
    SELECT count(*) INTO v_n
      FROM public.dispositivos_rep_setores ds
      JOIN public.dispositivos_rep d ON d.id = ds.dispositivo_id
      JOIN public.setores s          ON s.id = ds.setor_id
     WHERE s.unidade_id IS DISTINCT FROM d.unidade_id;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO: sobraram % vinculo(s) cruzado(s) do ensaio.', v_n;
    END IF;
    RAISE NOTICE 'ok  4.3 nenhum vinculo cruzado residual';

    -- 4.4 Privilegios preservados nas tres.
    IF has_function_privilege('anon', 'public.fn_cobertura_ponto_dispositivo(uuid, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ganhou execute em fn_cobertura_ponto_dispositivo.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_cobertura_ponto_dispositivo(uuid, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU execute em fn_cobertura_ponto_dispositivo.';
    END IF;
    RAISE NOTICE 'ok  4.4 privilegios preservados';
END;
$conf$;
