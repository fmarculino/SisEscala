-- Migration: cobertura de ponto — quem esta escalado e NAO consegue bater no relogio
--
-- MOTIVACAO (medido em producao em 13/08/2026, LACEM, agosto/2026 — 40 servidores escalados):
--
--     situacao                        | servidores
--     --------------------------------+-----------
--     FORA DO RELOGIO                 |    10
--     SEM BIOMETRIA                   |     1
--     SEM VINCULO (batida vira orfa)  |    27
--     OK                              |     1
--
-- Ou seja: 39 dos 40 escalados nao tinham como ter ponto registrado, e o caso dominante (27) e o
-- mais traicoeiro — a pessoa ESTA cadastrada no equipamento, COM biometria, encosta o dedo, o
-- relogio aceita, o AFD grava... e a batida morre como orfa no SisEscala porque nao existe
-- rep_vinculos_servidor vigente ligando aquele identificador ao servidor. Nada na tela avisava,
-- e a unica forma de descobrir era SQL na mao. Com dezenas/centenas de relogios previstos, isso
-- precisa ser um alerta, nao uma auditoria.
--
-- Esta migration cria SOMENTE funcoes de leitura + uma acao de vinculo que nao toca no
-- equipamento. Nenhuma tabela nova, nenhum dado alterado por ela mesma.
--
-- IDEMPOTENTE: DROP FUNCTION IF EXISTS + CREATE. Seguro rodar nos dois ambientes, e seguro
-- REAPLICAR depois de mudar a assinatura.
--
-- ⚠️ O DROP nao e enfeite: `CREATE OR REPLACE FUNCTION` NAO consegue alterar a lista de colunas de
-- um RETURNS TABLE. Reaplicar esta migration depois de acrescentar uma coluna morre com
-- "42P13: cannot change return type of existing function" — aconteceu em 13/08/2026, ao reaplicar
-- com as tres colunas novas de diagnostico (fila_status/fila_erro/lotacao_compativel). Toda vez
-- que uma destas funcoes ganhar ou perder coluna de saida, o DROP correspondente tem que existir.
--
-- Os DROPs sao sem CASCADE de proposito: se algum dia uma delas passar a ter dependente de
-- verdade (view, funcao SQL com corpo parseado), o erro e' preferivel a derrubar o dependente em
-- silencio. A ordem abaixo respeita quem chama quem.


-- ============================================================================
-- 1. COBERTURA POR DISPOSITIVO (uma linha por servidor escalado no mes)
-- ============================================================================
-- FONTE UNICA da classificacao. O resumo (secao 2) e a tela nao repetem esta regra — sao
-- envelopes LATERAL em cima desta funcao, mesmo padrao de fn_blocos_previstos_mes sobre
-- fn_blocos_previstos_dia (CLAUDE.md). Se cada um classificar por conta propria, o numero do
-- alerta deixa de ser o numero da lista.
--
-- ESCALADO = tem escala_mensal da unidade (e do setor, quando o relogio e de um setor) no
-- mes/ano, com pelo menos um dia de categoria que exige presenca. Sobreaviso fora de proposito:
-- nao marca ponto (CLAUDE.md armadilha 6).
--
-- ESCOPO: denylist de papel (barra so os do Portal) + escopo por unidade somando
-- fn_unidade_alcancavel_por_setor — fn_unidade_no_escopo sozinha reprova coordenador cujo acesso
-- vem inteiramente de setor vinculado (CLAUDE.md, pendencia 3 da Fase 5).

-- Dependentes primeiro (secoes 2 e 4 chamam esta): drop na ordem inversa da criacao.
DROP FUNCTION IF EXISTS public.fn_enfileirar_cadastros_por_escala(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_resumo(integer, integer);
DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_dispositivo(uuid, integer, integer);

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
    v_setor_id    uuid;
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

    SELECT d.unidade_id, d.setor_id INTO v_unidade_id, v_setor_id
      FROM public.dispositivos_rep d
     WHERE d.id = p_dispositivo_id
       AND (auth.uid() IS NULL
            OR public.fn_unidade_no_escopo(d.unidade_id)
            OR public.fn_unidade_alcancavel_por_setor(d.unidade_id));

    IF v_unidade_id IS NULL THEN
        RAISE EXCEPTION 'Dispositivo inexistente ou fora do seu escopo.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Mes/ano default = mes corrente NO FUSO CONFIGURADO. O processo Node roda em UTC e o
    -- Postgres desta instalacao tambem — derivar "mes atual" sem o fuso vira o mes seguinte nas
    -- ultimas 3 horas de todo dia 31 (CLAUDE.md armadilha 12).
    v_tz := COALESCE((SELECT timezone FROM public.configuracoes_globais LIMIT 1), 'America/Sao_Paulo');
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
           AND (v_setor_id IS NULL OR em.setor_id = v_setor_id)
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
           (r.unidade_id = v_unidade_id AND (v_setor_id IS NULL OR r.setor_id = v_setor_id))
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

COMMENT ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) IS
    'Um servidor escalado no mes por linha, com o motivo de nao conseguir bater ponto no relogio '
    '(sem_cpf, sem_snapshot, fora_do_relogio, sem_biometria, sem_vinculo, ok). Fonte unica da '
    'classificacao - fn_cobertura_ponto_resumo e a tela sao envelopes desta funcao.';

GRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 2. RESUMO POR DISPOSITIVO (a tela de alerta com dezenas/centenas de relogios)
-- ============================================================================
-- Envelope LATERAL da funcao acima: herda a classificacao E o escopo.
--
-- ⚠️ O filtro de escopo fica num CTE **MATERIALIZED**, nao num WHERE ao lado do LATERAL. A funcao
-- de cima LEVANTA EXCECAO para dispositivo fora do escopo, e um WHERE nao garante rodar antes do
-- LATERAL — o planejador escolhe. Bastaria existir um relogio fora do escopo do caller para a
-- consulta inteira estourar, para todo mundo que nao seja admin com acesso a tudo. MATERIALIZED
-- forca a filtragem a acontecer primeiro.

-- Ja derrubada no topo da secao 1 (depende de fn_cobertura_ponto_dispositivo).
CREATE FUNCTION public.fn_cobertura_ponto_resumo(
    p_mes integer DEFAULT NULL,
    p_ano integer DEFAULT NULL
)
RETURNS TABLE (
    dispositivo_id      uuid,
    dispositivo_nome    text,
    unidade_nome        text,
    setor_nome          text,
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
        SELECT d.id, d.nome, d.unidade_id, d.setor_id, d.ativo, d.ultimo_contato_em
          FROM public.dispositivos_rep d
         WHERE auth.uid() IS NULL           -- service_role/SQL direto, ver guard da funcao acima
            OR public.fn_unidade_no_escopo(d.unidade_id)
            OR public.fn_unidade_alcancavel_por_setor(d.unidade_id)
    )
    SELECT d.id,
           d.nome,
           un.nome,
           ds.nome,
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
      LEFT JOIN public.setores se ON se.id = d.setor_id
      LEFT JOIN public.dicionario_setores ds ON ds.id = se.dicionario_setor_id
      LEFT JOIN LATERAL public.fn_cobertura_ponto_dispositivo(d.id, p_mes, p_ano) c ON true
     GROUP BY d.id, d.nome, un.nome, ds.nome, d.ativo, d.ultimo_contato_em
     ORDER BY count(*) FILTER (WHERE c.situacao <> 'ok') DESC, d.nome
$fn$;

COMMENT ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) IS
    'Uma linha por relogio no escopo do caller, com quantos servidores escalados nao conseguem '
    'bater ponto e por que. Alimenta o alerta da tela de Marcacoes.';

GRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) TO authenticated, service_role;


-- ============================================================================
-- 3. CRIAR VINCULO A PARTIR DO SNAPSHOT (o conserto do caso dominante)
-- ============================================================================
-- O caso 'sem_vinculo' (27 dos 40 na LACEM) NAO precisa de nada no equipamento: a pessoa ja esta
-- la, com biometria. Falta so a ponte do lado do SisEscala. Esta funcao cria essa ponte a partir
-- do snapshot que o coletor ja reportou, casando por CPF.
--
-- p_vigente_de decide QUAIS batidas passam a ter dono, e por isso e' o parametro perigoso:
-- fn_ingerir_afd/fn_reparse_afd_dispositivo resolvem o vinculo VIGENTE NA DATA DA BATIDA. Um
-- vigente_de antigo demais faria o historico do sistema ANTERIOR (a LACEM chegou com ~34.500
-- marcacoes de outro sistema) virar marcacao do SisEscala num reprocessamento. Por isso o default
-- e' o cadastro do dispositivo no SisEscala — a fronteira natural de "daqui pra frente este
-- relogio e nosso" — e nunca a primeira batida vista no AFD.
--
-- NAO reprocessa nada sozinha: batida ja ingerida continua orfa ate alguem rodar
-- fn_reparse_afd_dispositivo de proposito. Criar vinculo e recuperar historico sao duas decisoes
-- diferentes e a segunda mexe em ponto passado.

DROP FUNCTION IF EXISTS public.fn_vincular_cadastros_por_cpf(uuid, timestamptz);

CREATE FUNCTION public.fn_vincular_cadastros_por_cpf(
    p_dispositivo_id uuid,
    p_vigente_de     timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role       public.user_role;
    v_vigente_de timestamptz;
    v_criados    integer := 0;
BEGIN
    -- Escrita: allowlist de propriedade, nao denylist. auth.uid() NULL segue passando (a funcao e
    -- GRANTada a service_role de proposito), mas aqui isso e' o caminho de servidor confiavel, nao
    -- um bypass de tela.
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
            RAISE EXCEPTION 'Apenas administradores podem criar vinculos de relogio.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = p_dispositivo_id
           AND (auth.uid() IS NULL
                OR public.fn_unidade_no_escopo(d.unidade_id)
                OR public.fn_unidade_alcancavel_por_setor(d.unidade_id))
    ) THEN
        RAISE EXCEPTION 'Dispositivo inexistente ou fora do seu escopo.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(p_vigente_de, d.created_at, now()) INTO v_vigente_de
      FROM public.dispositivos_rep d WHERE d.id = p_dispositivo_id;

    -- Nunca no futuro: um vigente_de a frente da batida nao resolve nada e some sem erro.
    IF v_vigente_de > now() THEN
        v_vigente_de := now();
    END IF;

    WITH candidatos AS (
        SELECT u.identificador_afd, u.registration_bruto, u.nome_no_device, u.servidor_id, u.tem_biometria
          FROM public.rep_usuarios_dispositivo u
          JOIN public.servidores s ON s.id = u.servidor_id
         WHERE u.dispositivo_id = p_dispositivo_id
           AND u.servidor_id IS NOT NULL     -- resolvido por vinculo ou CPF no snapshot
           AND s.status = 'Ativo'
           -- O indice uq_vinculo_vigente ja impede duplicar por identificador; este NOT EXISTS
           -- impede o outro lado (mesmo servidor entrando com dois identificadores diferentes).
           AND NOT EXISTS (
               SELECT 1 FROM public.rep_vinculos_servidor v
                WHERE v.dispositivo_id = p_dispositivo_id
                  AND v.vigente_ate IS NULL
                  AND (v.identificador_afd = u.identificador_afd OR v.servidor_id = u.servidor_id)
           )
    ), inseridos AS (
        INSERT INTO public.rep_vinculos_servidor
               (dispositivo_id, identificador_afd, matricula_device, nome_device, servidor_id,
                device_user_id, tem_biometria, vigente_de, criado_por_id)
        SELECT p_dispositivo_id, c.identificador_afd, c.registration_bruto, c.nome_no_device,
               c.servidor_id, NULL, c.tem_biometria, v_vigente_de, auth.uid()
          FROM candidatos c
        RETURNING 1
    )
    SELECT count(*)::integer INTO v_criados FROM inseridos;

    RETURN jsonb_build_object(
        'criados', v_criados,
        'vigente_de', v_vigente_de
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) IS
    'Cria rep_vinculos_servidor a partir do snapshot do relogio, casando por CPF, para quem ja '
    'esta cadastrado no equipamento mas cujas batidas cairiam como orfas. Nao escreve no '
    'equipamento e nao reprocessa AFD ja ingerido.';

REVOKE ALL ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vincular_cadastros_por_cpf(uuid, timestamptz) TO authenticated, service_role;


-- ============================================================================
-- 4. ENFILEIRAR CADASTRO POR ESCALA (o conserto do 'fora_do_relogio')
-- ============================================================================
-- fn_enfileirar_cadastros_rep (Fase 7, o botao "Sincronizar cadastros" do modal do dispositivo)
-- escolhe candidato por LOTACAO: servidores.unidade_id = dispositivo.unidade_id, e o setor quando
-- o relogio e' de setor. Quem esta ESCALADO na unidade mas lotado em outro lugar nunca entra por
-- ali - e o botao devolve "0 enfileirados" sem dizer que aquela pessoa existia e ficou de fora.
--
-- Caso real (13/08/2026, LACEM): GABRIELA SANTOS MORENO e IZABELLA BORGES CARVALHO estavam na
-- escala do mes e batiam ponto no terminal do computador todo dia, sem nunca terem sido mandadas
-- ao relogio.
--
-- Esta funcao enfileira exatamente quem a tela de Cobertura mostra como 'fora_do_relogio' - ou
-- seja, por ESCALA. Mesma escolha ja feita no guard de fn_blocos_previstos_dia (CLAUDE.md): checa
-- por escala, nao por lotacao, para nao quebrar servidor externo/emprestado. Nao substitui a
-- funcao da Fase 7; e um segundo caminho, para o caso que aquele nao alcanca.
--
-- Nao escreve no equipamento: enfileirar e' intencao. Quem aplica continua sendo o coletor
-- (`coletor-rep cadastros` ou "Sincronizar cadastros agora" no menu da bandeja).

-- Ja derrubada no topo da secao 1 (chama fn_cobertura_ponto_dispositivo).
CREATE FUNCTION public.fn_enfileirar_cadastros_por_escala(
    p_dispositivo_id uuid,
    p_mes            integer DEFAULT NULL,
    p_ano            integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_role         public.user_role;
    v_enfileirados integer := 0;
    v_ja_na_fila   integer := 0;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        v_role := (SELECT public.get_my_role());
        IF v_role IS NULL OR v_role NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role) THEN
            RAISE EXCEPTION 'Apenas administradores podem enfileirar cadastros para o rele.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- A checagem de escopo do dispositivo vem de graca: fn_cobertura_ponto_dispositivo levanta
    -- excecao para dispositivo fora do escopo do caller antes de devolver qualquer linha.
    WITH alvo AS (
        SELECT c.servidor_id, c.fila_status
          FROM public.fn_cobertura_ponto_dispositivo(p_dispositivo_id, p_mes, p_ano) c
         WHERE c.situacao = 'fora_do_relogio'   -- 'sem_cpf' e situacao propria: nao cai aqui
    ), inseridos AS (
        INSERT INTO public.rep_cadastros_fila (dispositivo_id, servidor_id, criado_por_id)
        SELECT p_dispositivo_id, a.servidor_id, auth.uid()
          FROM alvo a
         WHERE NOT EXISTS (
             SELECT 1 FROM public.rep_cadastros_fila f
              WHERE f.dispositivo_id = p_dispositivo_id
                AND f.servidor_id = a.servidor_id
                AND f.status = 'pendente'
         )
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM inseridos),
           (SELECT count(*) FROM alvo WHERE fila_status = 'pendente')
      INTO v_enfileirados, v_ja_na_fila;

    RETURN jsonb_build_object(
        'enfileirados', v_enfileirados,
        'ja_na_fila', v_ja_na_fila
    );
END;
$fn$;

COMMENT ON FUNCTION public.fn_enfileirar_cadastros_por_escala(uuid, integer, integer) IS
    'Enfileira para o rele quem esta ESCALADO na unidade do dispositivo e nao esta cadastrado la, '
    'inclusive quem esta lotado em outra unidade/setor - caso que fn_enfileirar_cadastros_rep '
    '(escolha por lotacao) nunca alcanca. Nao escreve no equipamento.';

REVOKE ALL ON FUNCTION public.fn_enfileirar_cadastros_por_escala(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_enfileirar_cadastros_por_escala(uuid, integer, integer) TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) O resumo tem que reproduzir a contagem medida na mao em 13/08/2026 (LACEM, 08/2026):
--      10 fora_do_relogio, 1 sem_biometria, 27 sem_vinculo, 1 ok.
--
--   SELECT dispositivo_nome, escalados, ok, sem_vinculo, sem_biometria, fora_do_relogio,
--          sem_cpf, sem_snapshot, nao_conseguem_bater, batidas_perdidas
--     FROM public.fn_cobertura_ponto_resumo(8, 2026);
--
--   2) A lista tem que somar exatamente o resumo (fonte unica, secao 1):
--
--   SELECT situacao, count(*) FROM public.fn_cobertura_ponto_dispositivo(
--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%lacem%'), 8, 2026)
--    GROUP BY 1 ORDER BY 1;
--
--   3) ANTES de vincular, veja com que data isso vai valer (e o que muda num reprocessamento):
--
--   SELECT nome, created_at FROM public.dispositivos_rep WHERE nome ILIKE '%lacem%';
--
--   4) O caso que motivou a secao 4: quem esta escalado, fora do relogio, e por que continua
--      fora. lotacao_compativel = false explica "cliquei em Sincronizar cadastros e nao veio":
--
--   SELECT servidor_nome, matricula, dias_com_escala, fila_status, fila_erro, lotacao_compativel
--     FROM public.fn_cobertura_ponto_dispositivo(
--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%lacem%'), 8, 2026)
--    WHERE situacao = 'fora_do_relogio' ORDER BY servidor_nome;
--
--   5) Depois de rodar fn_vincular_cadastros_por_cpf, nenhum vinculo pode ter ficado duplicado:
--
--   SELECT dispositivo_id, servidor_id, count(*)
--     FROM public.rep_vinculos_servidor WHERE vigente_ate IS NULL
--    GROUP BY 1, 2 HAVING count(*) > 1;   -- esperado: 0 linhas
