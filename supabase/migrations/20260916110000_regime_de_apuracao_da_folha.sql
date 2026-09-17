-- Migration: regime de apuracao da folha (periodo de fechamento diferente do mes civil)
-- Data: 16/09/2026
-- Plano: docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md (Fase 1)
--
-- PROBLEMA
-- O Mais Medicos fecha a frequencia no dia 20: o periodo vai de 21 de um mes a 20 do seguinte.
-- Hoje a folha do SisEscala e rigorosamente mensal e nao existe recorte que atravesse a virada.
-- Nao e exigencia de norma federal (procurada em 14/09/2026 e nao localizada): e convencao de
-- anos, e a propria folha do municipio ja operou assim. Entao o corte tem de ser CADASTRO, e
-- tem de poder valer para a rede inteira se isso voltar -- nunca constante no codigo.
--
-- O QUE ESTA MIGRATION FAZ (e o que NAO faz)
-- Cria o cadastro do regime e a funcao que deriva a janela. NADA muda de valor: a folha continua
-- mensal, a competencia continua sendo o mes civil, nenhuma tela existente troca de conta. O
-- documento de apuracao do periodo e a Fase 3; a montagem dos dias e a Fase 2.
--
-- DUAS DECISOES DO USUARIO (16/09/2026) QUE ESTAO CODIFICADAS AQUI
--   1. A competencia e "o mes que esta dentro": o periodo que fecha em 20/09/2026 e a
--      competencia 09/2026, e vai de 21/08 a 20/09. A outra leitura (nomear pelo mes que abre)
--      deslocaria o documento um mes inteiro.
--   2. O regime e propriedade do VINCULO, nunca do setor. Setor dita o escopo do relogio
--      (dispositivos_rep_setores): um setor artificial por regime cria ponto cego de biometria,
--      e duas pessoas do mesmo setor podem ter regimes diferentes.
--
-- 🚨 O PERIODO 21->20 ATRAVESSA O CORTE DE VIGENCIA DAS REGRAS DE FOLHA, e quem for escrever a
-- Fase 2 precisa saber disto. Medido em producao em 16/09/2026 nos 4 medicos:
--     dias 21..31/08 (folha Revisada)  -> 10,00 h por dia  (vao bruto da jornada, regra antiga)
--     dias  1..20/09 (folha Rascunho)  ->  7,58 h por dia  (liquido; horas_normais_liquidas_desde
--                                                           = 2026-09)
-- totaisFolha(registros, opcoes) recebe UMA competencia e UMA carga por dia. Chama-la uma vez
-- sobre os 31 dias do periodo aplicaria a regua de setembro aos dias de agosto: -40h somando as
-- 4 apuracoes, num documento que o servidor assina e divergindo da folha de agosto que ja esta
-- Revisada. A apuracao DERIVA da folha, nunca recalcula: soma POR METADE e junta os resultados.

-- ============================================================================
-- 1. O catalogo de regimes
-- ============================================================================
-- Ninguem digita o dia do corte solto numa tela: ele e cadastro, com nome, e reusado.

CREATE TABLE IF NOT EXISTS public.folha_regimes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome         text NOT NULL UNIQUE,
    -- NULL = ultimo dia do mes, que e o comportamento de hoje. Mes civil NAO e "corte 31":
    -- e a ausencia de corte, qualquer que seja o tamanho do mes.
    --
    -- ⚠️ O teto de 28 protege o FIM do periodo: corte 29, 30 ou 31 nao existe em fevereiro, e um
    -- periodo que as vezes tem corte e as vezes nao e um periodo que ninguem consegue conferir.
    -- O INICIO nao depende deste teto -- ver fn_periodo_apuracao, que o deriva somando um dia ao
    -- fim do periodo anterior em vez de usar dia_corte + 1.
    dia_corte    smallint,
    descricao    text,
    -- O fallback duro da resolucao. Exatamente um regime e padrao (indice unico parcial abaixo).
    padrao       boolean NOT NULL DEFAULT false,
    ativo        boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at   timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_folha_regimes_dia_corte
        CHECK (dia_corte IS NULL OR (dia_corte BETWEEN 1 AND 28))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_folha_regimes_padrao
    ON public.folha_regimes (padrao) WHERE padrao;

ALTER TABLE public.folha_regimes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticado ve regimes de apuracao" ON public.folha_regimes;
CREATE POLICY "Autenticado ve regimes de apuracao"
    ON public.folha_regimes
    FOR SELECT TO authenticated
    USING (true);

-- Sem policy de escrita: catalogo pequeno, alterado por migration. Com policy, qualquer
-- autenticado mudaria o dia do corte da rede pelo PostgREST.

INSERT INTO public.folha_regimes (nome, dia_corte, descricao, padrao)
VALUES
    ('Mes civil', NULL,
     'Do dia 1 ao ultimo dia do mes. E o regime de toda a rede e o padrao do sistema.', true),
    ('Fechamento no dia 20 (21 a 20)', 20,
     'Periodo de 21 de um mes a 20 do seguinte. Convencao do Mais Medicos, e ja praticada pela '
     || 'folha do municipio em outra epoca. A competencia e o mes em que o periodo FECHA.', false)
ON CONFLICT (nome) DO NOTHING;


-- ============================================================================
-- 2. A atribuicao, COM VIGENCIA -- e servidor_id NULL vale para a rede inteira
-- ============================================================================
-- 🚨 servidor_id NULL nao e brecha: e o que faz o corte poder voltar a valer para o municipio
-- sem criar 2.647 linhas (uma por servidor ativo). Sao 3 niveis na resolucao, do mais especifico
-- para o mais geral, e os dois primeiros tem vigencia:
--     1. linha do servidor        -> o regime dele
--     2. linha global (NULL)      -> o regime da rede naquela data
--     3. folha_regimes.padrao     -> Mes civil, o fallback duro
--
-- ⚠️ A VIGENCIA nao e zelo, e a licao da jornada do mes (19/08/2026): escala_mensal.jornada_id
-- nao tem vigencia, e troca-la no dia 12 reescreve a premissa dos dias 1 a 11. Regime sem
-- vigencia faria o mesmo -- quem entra no Mais Medicos em setembro teria as apuracoes de agosto
-- reinterpretadas.

CREATE TABLE IF NOT EXISTS public.folha_regime_vigencias (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = vale para todos. FK aceita NULL, e e isso que da o nivel 2 de graca.
    servidor_id      uuid REFERENCES public.servidores(id) ON DELETE CASCADE,
    regime_id        uuid NOT NULL REFERENCES public.folha_regimes(id) ON DELETE RESTRICT,
    vigencia_inicio  date NOT NULL,
    -- NULL = sem fim previsto (o caso dominante).
    vigencia_fim     date,
    motivo           text NOT NULL,
    criado_por_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_folha_regime_vig_datas
        CHECK (vigencia_fim IS NULL OR vigencia_inicio <= vigencia_fim),
    CONSTRAINT chk_folha_regime_vig_motivo
        CHECK (length(btrim(motivo)) >= 5)
);

-- Uma vigencia ABERTA por servidor, e uma aberta global. Vigencia fechada nao entra: o historico
-- de quem mudou de regime e legitimo, e duas linhas passadas nao se sobrepoem na pratica porque
-- fn_atribuir_regime_apuracao fecha a anterior antes de abrir a nova.
--
-- ⚠️ O COALESCE com sentinela nao e enfeite: indice unico sobre `servidor_id` NAO impediria duas
-- linhas globais, porque NULL nunca colide com NULL em unique. Um indice so, sobre a expressao,
-- cobre os dois casos -- um por servidor E um global.
CREATE UNIQUE INDEX IF NOT EXISTS uq_folha_regime_vig_aberta
    ON public.folha_regime_vigencias
       (COALESCE(servidor_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE vigencia_fim IS NULL;

CREATE INDEX IF NOT EXISTS idx_folha_regime_vig_servidor_data
    ON public.folha_regime_vigencias (servidor_id, vigencia_inicio DESC);

ALTER TABLE public.folha_regime_vigencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticado ve vigencia de regime" ON public.folha_regime_vigencias;
CREATE POLICY "Autenticado ve vigencia de regime"
    ON public.folha_regime_vigencias
    FOR SELECT TO authenticated
    USING (true);

-- SEM policy de escrita, de proposito (mesmo padrao de escala_mensal_movimentos,
-- dispositivos_rep_substituicoes e servidores_jornadas_temporarias_historico): so as RPCs
-- SECURITY DEFINER gravam. O regime decide em que documento o dia de trabalho de alguem entra.


CREATE TABLE IF NOT EXISTS public.folha_regime_vigencias_historico (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Sem FK: a linha de origem pode ter deixado de existir, e e esse o ponto do historico.
    vigencia_id      uuid NOT NULL,
    servidor_id      uuid,
    regime_id        uuid,
    -- O nome vai congelado ao lado porque regime e renomeavel.
    regime_nome      text,
    dia_corte        smallint,
    vigencia_inicio  date,
    vigencia_fim     date,
    acao             text NOT NULL CHECK (acao IN ('atribuida', 'encerrada')),
    motivo           text,
    autor_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    registrado_em    timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.folha_regime_vigencias_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticado ve historico de regime"
    ON public.folha_regime_vigencias_historico;
CREATE POLICY "Autenticado ve historico de regime"
    ON public.folha_regime_vigencias_historico
    FOR SELECT TO authenticated
    USING (true);

CREATE OR REPLACE FUNCTION public.fn_historico_regime_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    RAISE EXCEPTION 'folha_regime_vigencias_historico e append-only: % nao e permitido.', TG_OP;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_historico_regime_append_only
    ON public.folha_regime_vigencias_historico;
CREATE TRIGGER trg_historico_regime_append_only
    BEFORE UPDATE OR DELETE ON public.folha_regime_vigencias_historico
    FOR EACH ROW EXECUTE FUNCTION public.fn_historico_regime_append_only();


-- ============================================================================
-- 3. A janela, derivada por funcao PURA
-- ============================================================================
-- Espelho de janelaDoPeriodo em src/utils/folha/periodoApuracao.ts.
--
-- 🚨 O INICIO E "FIM DO PERIODO ANTERIOR + 1 DIA", nunca "dia_corte + 1 do mes anterior".
-- Com corte 28 em marco, o mes anterior e fevereiro e o dia 29 nao existe: a formula ingenua
-- produziria data invalida (ou, pior, um salto em silencio). Somando um dia ao fim anterior a
-- propriedade que importa sai de graca -- os periodos consecutivos sao CONTIGUOS e nao se
-- sobrepoem, entao nenhum dia de trabalho cai em dois documentos nem em nenhum.
--
-- Mes civil (dia_corte NULL) e um CASO desta funcao, nao um caminho separado: e o que impede as
-- duas metades do codigo de divergirem (a licao das 37 mil horas de 05/09/2026 -- duas copias
-- certas e uma errada).

CREATE OR REPLACE FUNCTION public.fn_periodo_apuracao(
    p_regime_id uuid,
    p_mes       integer,
    p_ano       integer
)
RETURNS TABLE (
    inicio     date,
    fim        date,
    dia_corte  smallint,
    rotulo     text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
-- CLAUDE.md armadilha 42: `RETURNS TABLE (... dia_corte ...)` declara um parametro de SAIDA com o
-- nome de uma coluna real de folha_regimes. Aqui toda referencia e qualificada (r.dia_corte) ou
-- v_*, entao nao ha ambiguidade hoje -- a diretiva existe para que acrescentar um statement
-- depois nao ressuscite o 42702 na PRIMEIRA EXECUCAO, que e onde plpgsql resolve nome de coluna.
-- O parametro de saida nunca e lido como variavel (o retorno e por RETURN QUERY).
#variable_conflict use_column
DECLARE
    v_corte      smallint;
    v_primeiro   date;
    v_fim        date;
    v_fim_ant    date;
    v_inicio     date;
BEGIN
    IF p_mes IS NULL OR p_mes < 1 OR p_mes > 12 OR p_ano IS NULL OR p_ano < 2000 THEN
        RAISE EXCEPTION 'Competencia invalida: mes %, ano %.', p_mes, p_ano;
    END IF;

    SELECT r.dia_corte INTO v_corte
      FROM public.folha_regimes r
     WHERE r.id = p_regime_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Regime de apuracao % nao encontrado.', p_regime_id;
    END IF;

    v_primeiro := make_date(p_ano, p_mes, 1);

    IF v_corte IS NULL THEN
        -- Mes civil: exatamente o comportamento de hoje.
        v_inicio := v_primeiro;
        v_fim    := (v_primeiro + interval '1 month - 1 day')::date;
    ELSE
        -- A competencia e o mes em que o periodo FECHA (decisao do usuario, 16/09/2026).
        v_fim     := make_date(p_ano, p_mes, v_corte);
        v_fim_ant := (v_primeiro - interval '1 month')::date + (v_corte - 1);
        v_inicio  := v_fim_ant + 1;
    END IF;

    RETURN QUERY SELECT
        v_inicio,
        v_fim,
        v_corte,
        CASE WHEN v_corte IS NULL
             THEN to_char(v_inicio, 'DD/MM/YYYY') || ' a ' || to_char(v_fim, 'DD/MM/YYYY')
             ELSE 'Apuracao ' || to_char(v_inicio, 'DD/MM/YYYY')
                  || ' a ' || to_char(v_fim, 'DD/MM/YYYY')
        END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_periodo_apuracao(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_periodo_apuracao(uuid, integer, integer)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_periodo_apuracao(uuid, integer, integer) IS
    'A janela de apuracao de uma competencia, para um regime. A competencia e o mes em que o '
    'periodo FECHA: corte 20 em 09/2026 devolve 21/08/2026 a 20/09/2026. dia_corte NULL devolve '
    'o mes civil, que e um caso desta funcao e nao um caminho separado. O inicio e o fim do '
    'periodo anterior + 1 dia, nunca dia_corte + 1 do mes anterior -- e isso que mantem os '
    'periodos contiguos mesmo com corte 28 e fevereiro. Espelho de janelaDoPeriodo em '
    'src/utils/folha/periodoApuracao.ts.';


-- ============================================================================
-- 4. A resolucao: qual regime vale para esta pessoa nesta data
-- ============================================================================
-- ⚠️ Servidor sem atribuicao NAO cai em erro nem em NULL: cai no regime da rede, e na falta dele
-- no padrao do catalogo. Senao todo servidor novo nasceria sem regime e a apuracao dele falharia
-- em silencio -- e sao 2.647 ativos contra 4 no Mais Medicos.

CREATE OR REPLACE FUNCTION public.fn_regime_apuracao_servidor(
    p_servidor_id uuid,
    p_data        date DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH ref AS (
        SELECT COALESCE(p_data, public.fn_data_local()) AS d
    )
    SELECT COALESCE(
        -- 1. o regime da pessoa
        (SELECT v.regime_id
           FROM public.folha_regime_vigencias v, ref
          WHERE v.servidor_id = p_servidor_id
            AND v.vigencia_inicio <= ref.d
            AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ref.d)
          ORDER BY v.vigencia_inicio DESC
          LIMIT 1),
        -- 2. o regime da rede naquela data
        (SELECT v.regime_id
           FROM public.folha_regime_vigencias v, ref
          WHERE v.servidor_id IS NULL
            AND v.vigencia_inicio <= ref.d
            AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ref.d)
          ORDER BY v.vigencia_inicio DESC
          LIMIT 1),
        -- 3. o fallback duro
        (SELECT r.id FROM public.folha_regimes r WHERE r.padrao LIMIT 1)
    );
$fn$;

REVOKE ALL ON FUNCTION public.fn_regime_apuracao_servidor(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_regime_apuracao_servidor(uuid, date)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_regime_apuracao_servidor(uuid, date) IS
    'O regime de apuracao vigente para o servidor na data. Tres niveis, do mais especifico ao '
    'mais geral: linha do servidor, linha global (servidor_id NULL, que e como o corte volta a '
    'valer para a rede sem 2.647 linhas) e folha_regimes.padrao. Nunca devolve NULL para '
    'servidor sem atribuicao. Espelho de regimeDoServidor em '
    'src/utils/folha/periodoApuracao.ts.';


-- O envelope que a tela consome: resolve o regime e devolve a janela numa chamada.
CREATE OR REPLACE FUNCTION public.fn_periodo_apuracao_servidor(
    p_servidor_id uuid,
    p_mes         integer,
    p_ano         integer
)
RETURNS TABLE (
    regime_id       uuid,
    regime_nome     text,
    dia_corte       smallint,
    inicio          date,
    fim             date,
    rotulo          text,
    atravessa_mes   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH reg AS (
        -- A data de referencia e o FIM do mes da competencia: e nele que o periodo fecha, e e o
        -- regime daquele momento que decide a janela inteira.
        SELECT public.fn_regime_apuracao_servidor(
                   p_servidor_id,
                   (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date
               ) AS id
    )
    SELECT r.id,
           fr.nome,
           p.dia_corte,
           p.inicio,
           p.fim,
           p.rotulo,
           extract(month from p.inicio) <> extract(month from p.fim)
      FROM reg r
      JOIN public.folha_regimes fr ON fr.id = r.id
     CROSS JOIN LATERAL public.fn_periodo_apuracao(r.id, p_mes, p_ano) p;
$fn$;

REVOKE ALL ON FUNCTION public.fn_periodo_apuracao_servidor(uuid, integer, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_periodo_apuracao_servidor(uuid, integer, integer)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_periodo_apuracao_servidor(uuid, integer, integer) IS
    'Resolve o regime do servidor e devolve a janela da competencia numa chamada. '
    'atravessa_mes avisa a tela (e a Fase 2) que o periodo pega duas competencias de folha -- '
    'ali a soma tem de ser feita POR METADE, porque as regras de folha tem vigencia por '
    'competencia (horas liquidas, compensacao e autorizacao de extra desde 2026-09).';


-- ============================================================================
-- 5. Atribuir e encerrar -- ato registrado, com motivo
-- ============================================================================
-- ⚠️ Atribuicao GLOBAL (p_servidor_id NULL) e so super_admin/rh: ela muda o documento de
-- pagamento da rede inteira. Por servidor, vale o escopo de gestao (fn_escopo_gestao_alcanca),
-- que e o mesmo predicado de /marcacoes e do diagnostico de cadastro.

CREATE OR REPLACE FUNCTION public.fn_atribuir_regime_apuracao(
    p_servidor_id     uuid,
    p_regime_id       uuid,
    p_vigencia_inicio date,
    p_motivo          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_papel      text;
    v_unidade    uuid;
    v_regime     public.folha_regimes;
    v_anterior   public.folha_regime_vigencias;
    v_nova_id    uuid;
    v_inicio     date;
BEGIN
    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
        RAISE EXCEPTION 'Informe o motivo da atribuicao (ao menos 5 caracteres).';
    END IF;

    SELECT * INTO v_regime FROM public.folha_regimes WHERE id = p_regime_id AND ativo;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Regime de apuracao inexistente ou inativo.';
    END IF;

    v_papel  := public.get_my_role()::text;
    v_inicio := COALESCE(p_vigencia_inicio, public.fn_data_local());

    IF p_servidor_id IS NULL THEN
        -- Vale para a rede: so quem enxerga a rede decide.
        IF v_papel IS NULL OR v_papel NOT IN ('super_admin', 'rh') THEN
            RAISE EXCEPTION 'Somente Administrador Geral ou RH Geral define o regime de '
                            'apuracao de toda a rede.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSE
        SELECT s.unidade_id INTO v_unidade
          FROM public.servidores s WHERE s.id = p_servidor_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Servidor nao encontrado.';
        END IF;
        IF NOT public.fn_escopo_gestao_alcanca(v_unidade) THEN
            RAISE EXCEPTION 'Sem permissao para definir o regime de apuracao deste servidor.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Fecha a vigencia aberta anterior no dia antes do novo inicio. E o que mantem o indice
    -- unico parcial satisfeito e preserva o passado: a apuracao de agosto continua resolvendo
    -- pelo regime que valia em agosto.
    SELECT * INTO v_anterior
      FROM public.folha_regime_vigencias
     WHERE servidor_id IS NOT DISTINCT FROM p_servidor_id
       AND vigencia_fim IS NULL
     LIMIT 1;

    IF FOUND THEN
        IF v_anterior.regime_id = p_regime_id THEN
            RETURN jsonb_build_object(
                'status', 'sem_mudanca',
                'vigencia_id', v_anterior.id,
                'regime_id', v_anterior.regime_id,
                'regime_nome', v_regime.nome,
                'mensagem', 'Este ja e o regime vigente; nada foi alterado.'
            );
        END IF;
        IF v_anterior.vigencia_inicio >= v_inicio THEN
            RAISE EXCEPTION 'A vigencia atual comeca em % e nao pode ser fechada antes disso.',
                to_char(v_anterior.vigencia_inicio, 'DD/MM/YYYY');
        END IF;

        UPDATE public.folha_regime_vigencias
           SET vigencia_fim = v_inicio - 1
         WHERE id = v_anterior.id;

        INSERT INTO public.folha_regime_vigencias_historico (
            vigencia_id, servidor_id, regime_id, regime_nome, dia_corte,
            vigencia_inicio, vigencia_fim, acao, motivo, autor_id
        )
        SELECT v_anterior.id, v_anterior.servidor_id, v_anterior.regime_id, r.nome, r.dia_corte,
               v_anterior.vigencia_inicio, v_inicio - 1, 'encerrada',
               'Encerrada automaticamente pela atribuicao de outro regime: ' || btrim(p_motivo),
               auth.uid()
          FROM public.folha_regimes r WHERE r.id = v_anterior.regime_id;
    END IF;

    INSERT INTO public.folha_regime_vigencias (
        servidor_id, regime_id, vigencia_inicio, motivo, criado_por_id
    ) VALUES (
        p_servidor_id, p_regime_id, v_inicio, btrim(p_motivo), auth.uid()
    ) RETURNING id INTO v_nova_id;

    INSERT INTO public.folha_regime_vigencias_historico (
        vigencia_id, servidor_id, regime_id, regime_nome, dia_corte,
        vigencia_inicio, vigencia_fim, acao, motivo, autor_id
    ) VALUES (
        v_nova_id, p_servidor_id, p_regime_id, v_regime.nome, v_regime.dia_corte,
        v_inicio, NULL, 'atribuida', btrim(p_motivo), auth.uid()
    );

    RETURN jsonb_build_object(
        'status', 'atribuida',
        'vigencia_id', v_nova_id,
        'regime_id', p_regime_id,
        'regime_nome', v_regime.nome,
        'dia_corte', v_regime.dia_corte,
        'vigencia_inicio', v_inicio,
        'escopo', CASE WHEN p_servidor_id IS NULL THEN 'rede' ELSE 'servidor' END,
        'encerrou_anterior', v_anterior.id
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_atribuir_regime_apuracao(uuid, uuid, date, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_atribuir_regime_apuracao(uuid, uuid, date, text)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_atribuir_regime_apuracao(uuid, uuid, date, text) IS
    'Atribui regime de apuracao a um servidor, ou a REDE INTEIRA quando p_servidor_id e NULL. '
    'Motivo obrigatorio, vigencia anterior fechada no dia anterior (nunca sobrescrita) e linha '
    'em folha_regime_vigencias_historico. Global e so super_admin/rh; por servidor vale '
    'fn_escopo_gestao_alcanca.';


CREATE OR REPLACE FUNCTION public.fn_encerrar_regime_apuracao(
    p_vigencia_id uuid,
    p_motivo      text,
    p_data_fim    date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_papel    text;
    v_unidade  uuid;
    v_vig      public.folha_regime_vigencias;
    v_regime   public.folha_regimes;
    v_fim      date;
BEGIN
    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
        RAISE EXCEPTION 'Informe o motivo do encerramento (ao menos 5 caracteres).';
    END IF;

    SELECT * INTO v_vig FROM public.folha_regime_vigencias WHERE id = p_vigencia_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vigencia de regime nao encontrada.';
    END IF;
    IF v_vig.vigencia_fim IS NOT NULL THEN
        RAISE EXCEPTION 'Esta vigencia ja foi encerrada em %.',
            to_char(v_vig.vigencia_fim, 'DD/MM/YYYY');
    END IF;

    v_papel := public.get_my_role()::text;

    IF v_vig.servidor_id IS NULL THEN
        IF v_papel IS NULL OR v_papel NOT IN ('super_admin', 'rh') THEN
            RAISE EXCEPTION 'Somente Administrador Geral ou RH Geral encerra o regime de '
                            'apuracao de toda a rede.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSE
        SELECT s.unidade_id INTO v_unidade
          FROM public.servidores s WHERE s.id = v_vig.servidor_id;
        IF NOT public.fn_escopo_gestao_alcanca(v_unidade) THEN
            RAISE EXCEPTION 'Sem permissao para encerrar o regime de apuracao deste servidor.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    v_fim := COALESCE(p_data_fim, public.fn_data_local());
    IF v_fim < v_vig.vigencia_inicio THEN
        RAISE EXCEPTION 'O fim (%) nao pode ser anterior ao inicio da vigencia (%).',
            to_char(v_fim, 'DD/MM/YYYY'), to_char(v_vig.vigencia_inicio, 'DD/MM/YYYY');
    END IF;

    UPDATE public.folha_regime_vigencias
       SET vigencia_fim = v_fim
     WHERE id = p_vigencia_id;

    SELECT * INTO v_regime FROM public.folha_regimes WHERE id = v_vig.regime_id;

    INSERT INTO public.folha_regime_vigencias_historico (
        vigencia_id, servidor_id, regime_id, regime_nome, dia_corte,
        vigencia_inicio, vigencia_fim, acao, motivo, autor_id
    ) VALUES (
        p_vigencia_id, v_vig.servidor_id, v_vig.regime_id, v_regime.nome, v_regime.dia_corte,
        v_vig.vigencia_inicio, v_fim, 'encerrada', btrim(p_motivo), auth.uid()
    );

    RETURN jsonb_build_object(
        'status', 'encerrada',
        'vigencia_id', p_vigencia_id,
        'vigencia_fim', v_fim,
        'regime_nome', v_regime.nome,
        'volta_para', (SELECT r.nome FROM public.folha_regimes r
                        WHERE r.id = public.fn_regime_apuracao_servidor(
                            v_vig.servidor_id, v_fim + 1))
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_encerrar_regime_apuracao(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_encerrar_regime_apuracao(uuid, text, date)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_encerrar_regime_apuracao(uuid, text, date) IS
    'Encerra uma vigencia de regime com motivo escrito e linha de historico. Devolve volta_para '
    '-- o regime que passa a valer no dia seguinte -- porque encerrar nao e "sem regime": e '
    'voltar ao nivel de baixo da resolucao.';


-- ============================================================================
-- 6. Conferencia -- EXECUTA as funcoes (CLAUDE.md armadilha 42)
-- ============================================================================
-- Conferir que a funcao EXISTE nao serve: plpgsql resolve nome de coluna so na execucao, e uma
-- funcao quebrada e criada sem reclamar. Confere os DOIS sentidos: a janela 21->20 sai certa, e
-- servidor sem atribuicao continua no mes civil exato.

DO $conf$
DECLARE
    v_civil   uuid;
    v_corte20 uuid;
    v_ini     date;
    v_fim     date;
    v_m       integer;
    v_abertas text;
    v_srv     uuid;
BEGIN
    SELECT id INTO v_civil   FROM public.folha_regimes WHERE dia_corte IS NULL AND padrao;
    SELECT id INTO v_corte20 FROM public.folha_regimes WHERE dia_corte = 20;

    IF v_civil IS NULL OR v_corte20 IS NULL THEN
        RAISE EXCEPTION 'O seed dos regimes nao entrou: civil=%, corte20=%.', v_civil, v_corte20;
    END IF;

    -- 1. o caso que motivou: competencia 09/2026, corte 20 -> 21/08 a 20/09
    SELECT p.inicio, p.fim INTO v_ini, v_fim
      FROM public.fn_periodo_apuracao(v_corte20, 9, 2026) p;
    IF v_ini <> DATE '2026-08-21' OR v_fim <> DATE '2026-09-20' THEN
        RAISE EXCEPTION 'Janela 21->20 errada para 09/2026: % a %. Esperado 2026-08-21 a 2026-09-20.',
            v_ini, v_fim;
    END IF;

    -- 2. virada de ano: 01/2026 -> 21/12/2025 a 20/01/2026
    SELECT p.inicio, p.fim INTO v_ini, v_fim
      FROM public.fn_periodo_apuracao(v_corte20, 1, 2026) p;
    IF v_ini <> DATE '2025-12-21' OR v_fim <> DATE '2026-01-20' THEN
        RAISE EXCEPTION 'Janela 21->20 errada na virada de ano: % a %.', v_ini, v_fim;
    END IF;

    -- 3. mes civil e EXATAMENTE o mes, inclusive em fevereiro bissexto
    SELECT p.inicio, p.fim INTO v_ini, v_fim
      FROM public.fn_periodo_apuracao(v_civil, 2, 2028) p;
    IF v_ini <> DATE '2028-02-01' OR v_fim <> DATE '2028-02-29' THEN
        RAISE EXCEPTION 'Mes civil errado para 02/2028 (bissexto): % a %.', v_ini, v_fim;
    END IF;
    SELECT p.inicio, p.fim INTO v_ini, v_fim
      FROM public.fn_periodo_apuracao(v_civil, 2, 2026) p;
    IF v_ini <> DATE '2026-02-01' OR v_fim <> DATE '2026-02-28' THEN
        RAISE EXCEPTION 'Mes civil errado para 02/2026: % a %.', v_ini, v_fim;
    END IF;

    -- 4. os periodos consecutivos sao CONTIGUOS (nenhum dia em dois documentos nem em nenhum)
    FOR v_m IN 1..12 LOOP
        IF (SELECT p.fim FROM public.fn_periodo_apuracao(v_corte20, v_m, 2026) p) + 1
           <> (SELECT q.inicio FROM public.fn_periodo_apuracao(
                   v_corte20,
                   CASE WHEN v_m = 12 THEN 1    ELSE v_m + 1 END,
                   CASE WHEN v_m = 12 THEN 2027 ELSE 2026     END) q) THEN
            RAISE EXCEPTION 'Os periodos de %/2026 e do mes seguinte nao sao contiguos.', v_m;
        END IF;
    END LOOP;

    -- 5. servidor sem atribuicao continua no mes civil (o outro sentido)
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' LIMIT 1;
    IF v_srv IS NOT NULL THEN
        IF public.fn_regime_apuracao_servidor(v_srv, DATE '2026-09-16') <> v_civil THEN
            RAISE EXCEPTION 'Servidor sem atribuicao deixou de cair no mes civil - a Fase 1 '
                            'mudaria a folha de toda a rede, e ela nao pode mudar nada.';
        END IF;
        SELECT p.inicio, p.fim INTO v_ini, v_fim
          FROM public.fn_periodo_apuracao_servidor(v_srv, 9, 2026) p;
        IF v_ini <> DATE '2026-09-01' OR v_fim <> DATE '2026-09-30' THEN
            RAISE EXCEPTION 'O envelope devolveu % a % para servidor sem atribuicao; esperado o '
                            'mes civil de 09/2026.', v_ini, v_fim;
        END IF;
    END IF;

    -- 6. historico sem policy de escrita e com append-only
    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN ('folha_regime_vigencias', 'folha_regime_vigencias_historico',
                             'folha_regimes')
           AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'Alguma tabela do regime ganhou policy de escrita - qualquer '
                        'autenticado mudaria o dia do corte pelo PostgREST.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'public.folha_regime_vigencias_historico'::regclass
           AND tgname = 'trg_historico_regime_append_only'
    ) THEN
        RAISE EXCEPTION 'O historico do regime ficou sem a trava de append-only.';
    END IF;

    -- 7. anon nao executa nenhuma das cinco (CLAUDE.md armadilha 24)
    SELECT string_agg(q.f, ', ') INTO v_abertas FROM (
        SELECT 'fn_periodo_apuracao' AS f
         WHERE has_function_privilege('anon', 'public.fn_periodo_apuracao(uuid, integer, integer)', 'EXECUTE')
        UNION ALL SELECT 'fn_regime_apuracao_servidor'
         WHERE has_function_privilege('anon', 'public.fn_regime_apuracao_servidor(uuid, date)', 'EXECUTE')
        UNION ALL SELECT 'fn_periodo_apuracao_servidor'
         WHERE has_function_privilege('anon', 'public.fn_periodo_apuracao_servidor(uuid, integer, integer)', 'EXECUTE')
        UNION ALL SELECT 'fn_atribuir_regime_apuracao'
         WHERE has_function_privilege('anon', 'public.fn_atribuir_regime_apuracao(uuid, uuid, date, text)', 'EXECUTE')
        UNION ALL SELECT 'fn_encerrar_regime_apuracao'
         WHERE has_function_privilege('anon', 'public.fn_encerrar_regime_apuracao(uuid, text, date)', 'EXECUTE')
    ) q;
    IF v_abertas IS NOT NULL THEN
        RAISE EXCEPTION 'anon ainda executa: %. Banco %, usuario % - confira se voce e o dono.',
            v_abertas, current_database(), current_user;
    END IF;

    -- 8. e o outro sentido: revogar demais deixaria a ficha do servidor sem o regime
    IF NOT has_function_privilege('authenticated', 'public.fn_periodo_apuracao_servidor(uuid, integer, integer)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.fn_regime_apuracao_servidor(uuid, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated perdeu EXECUTE - a ficha do servidor nao le mais o regime.';
    END IF;

    RAISE NOTICE 'Regime de apuracao: 8 conferencias OK (janela, virada de ano, fevereiro, '
                 'contiguidade dos 12 meses, mes civil por omissao, policies, anon, authenticated).';
END;
$conf$;


-- ============================================================================
-- 7. Conferencia de dados, para rodar por fora depois de aplicar
-- ============================================================================
-- Nada muda de valor nesta migration. Estas consultas provam isso:
--
-- -- 7.1 quantos servidores mudaram de regime (deve ser 0 - ninguem foi atribuido ainda)
-- SELECT count(*) FROM public.folha_regime_vigencias;
--
-- -- 7.2 a janela de cada regime para a competencia corrente
-- SELECT r.nome, p.* FROM public.folha_regimes r
--   CROSS JOIN LATERAL public.fn_periodo_apuracao(r.id, 9, 2026) p;
--
-- -- 7.3 os 4 do Mais Medicos continuam no mes civil (antes de atribuir)
-- SELECT s.matricula, fr.nome, p.inicio, p.fim
--   FROM public.servidores s
--   JOIN LATERAL public.fn_periodo_apuracao_servidor(s.id, 9, 2026) p ON true
--   JOIN public.folha_regimes fr ON fr.id = p.regime_id
--  WHERE s.setor_id = 'a465e8bd-c455-440b-840b-b94483a13d2a'
--  ORDER BY s.matricula;
