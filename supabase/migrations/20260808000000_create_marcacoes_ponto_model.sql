-- Migration: Cria o modelo de dados de marcacoes de ponto (Fase 1 da integracao com REP)
-- Data: 2026-08-08
--
-- OBJETIVO
--   Introduzir as tabelas do modulo de marcacoes SEM alterar nenhum comportamento existente.
--   Nada nesta migration e lido ou escrito pelo sistema atual: o terminal, a grade e a folha
--   de ponto continuam funcionando exatamente como antes. As tabelas nascem vazias e sao
--   populadas por uma migration de backfill posterior.
--
-- POR QUE UM MODELO NOVO EM VEZ DE MAIS COLUNAS EM escala_diaria
--   Hoje cada passo de presenca tem UMA coluna (presenca_entrada_em etc.). Isso torna o
--   registro destrutivo: uma segunda batida ocupa o mesmo slot e a anterior desaparece, sem
--   historico. Pior, fn_salvar_saida_bloco (20260706115000) FABRICA ate 5 timestamps
--   sinteticos numa unica batida de saida de bloco multi-turno, indistinguiveis de batida real.
--
--   Um sistema que sera alimentado por um REP-C certificado precisa do oposto: o registro
--   original nunca some, e o tratamento do coordenador e um fato NOVO registrado por cima,
--   nao uma edicao. E a regra central do PTRP da Portaria 671/2021 - pode complementar e
--   tratar, jamais alterar o dado original, e deve manter historico.
--
--   O desenho separa tres camadas que hoje estao fundidas numa coluna so:
--     rep_afd_registros     - evidencia bruta (a linha do AFD, artefato legal)
--     marcacoes_ponto       - o fato (quem, quando, por qual origem) - INSERT-only
--     marcacoes_tratamentos - o juizo do coordenador sobre o fato - append-only
--   e escala_diaria.presenca_* passa a ser PROJECAO, reconstruivel a qualquer momento.
--
-- ORDEM DAS TABELAS
--   Ha dependencia de FK: dispositivos_rep <- rep_sincronizacoes <- rep_afd_registros
--   <- marcacoes_ponto <- marcacoes_tratamentos. Criar fora de ordem quebra.
--
-- IDEMPOTENTE
--   CREATE TABLE / INDEX IF NOT EXISTS e DO block para o tipo enum. Os schemas de homologacao
--   e producao divergem (CLAUDE.md armadilha 3); rodar nos dois e seguro.


-- ============================================================================
-- 1. ORIGEM DA MARCACAO E PRECEDENCIA
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marcacao_origem') THEN
        CREATE TYPE public.marcacao_origem AS ENUM (
            'rep',                -- relogio de ponto fisico (coletor online ou pendrive)
            'terminal',           -- terminal web, via fn_confirmar_presenca
            'ajuste_coordenador', -- validacao ou ajuste manual por coordenador/admin
            'ajuste_servidor'     -- ajuste solicitado pelo proprio servidor (futuro)
        );
    END IF;
END
$$;

-- Ordem de prioridade na conciliacao: menor peso vence.
-- NAO usar o ordinal do enum para isso: um ALTER TYPE ... ADD VALUE futuro entraria numa
-- posicao arbitraria e mudaria silenciosamente a precedencia de todo o sistema.
CREATE OR REPLACE FUNCTION public.fn_precedencia_origem(p_origem public.marcacao_origem)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE p_origem
        WHEN 'rep'                THEN 1
        WHEN 'terminal'           THEN 2
        WHEN 'ajuste_coordenador' THEN 3
        WHEN 'ajuste_servidor'    THEN 4
    END
$$;

COMMENT ON FUNCTION public.fn_precedencia_origem(public.marcacao_origem) IS
    'Peso de precedencia da origem na conciliacao. Menor vence: REP > terminal > ajuste. '
    'Aplicada em um unico lugar (fn_reconciliar_marcacoes_dia) - nao replicar no frontend.';


-- ============================================================================
-- 2. DISPOSITIVOS (relogios de ponto cadastrados)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dispositivos_rep (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unidade_id          uuid NOT NULL REFERENCES public.unidades(id),
    setor_id            uuid NULL REFERENCES public.setores(id),
    nome                text NOT NULL,
    fabricante          text NOT NULL DEFAULT 'Control iD',
    modelo              text,
    numero_serie        text,
    numero_fabricacao   text,              -- vai no cabecalho do AFD
    endereco_ip         inet,
    porta               integer NOT NULL DEFAULT 443,
    usa_https           boolean NOT NULL DEFAULT true,
    cert_fingerprint    text,              -- pinning do certificado auto-assinado do device
    modo_operacao       text NOT NULL DEFAULT 'pull'
                        CHECK (modo_operacao IN ('pull', 'usb', 'pull_com_fallback_usb')),
    -- Autenticacao do coletor. O token e exibido uma unica vez na UI; aqui fica so o sha256.
    token_hash          text,
    token_criado_em     timestamptz,
    token_criado_por_id uuid REFERENCES public.profiles(id),
    -- Estado da sincronizacao
    ultimo_nsr          bigint NOT NULL DEFAULT 0,  -- ultimo NSR ACEITO pelo SisEscala
    ultimo_contato_em   timestamptz,
    ultimo_ip_origem    inet,
    deriva_segundos     integer,           -- relogio do device menos relogio do servidor
    ativo               boolean NOT NULL DEFAULT true,
    observacoes         text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_dispositivo_serie' AND conrelid = 'public.dispositivos_rep'::regclass
    ) THEN
        ALTER TABLE public.dispositivos_rep
            ADD CONSTRAINT uq_dispositivo_serie UNIQUE (fabricante, numero_serie);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_dispositivos_rep_unidade
    ON public.dispositivos_rep (unidade_id) WHERE ativo;

COMMENT ON TABLE public.dispositivos_rep IS
    'Relogios de ponto (REP) cadastrados por unidade/setor, com credencial do coletor e estado da sincronizacao.';
COMMENT ON COLUMN public.dispositivos_rep.ultimo_nsr IS
    'Ultimo NSR aceito pelo SisEscala. O coletor so avanca este valor apos ACK - nunca antes.';


-- ============================================================================
-- 3. SINCRONIZACOES (uma sessao de coleta: coletor online ou pendrive)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rep_sincronizacoes (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id        uuid NOT NULL REFERENCES public.dispositivos_rep(id),
    -- lote_id e gerado pelo CLIENTE. E o que torna o reenvio idempotente: o mesmo lote
    -- reenviado apos falha de rede devolve o resultado anterior em vez de reprocessar.
    lote_id               uuid NOT NULL,
    canal                 text NOT NULL CHECK (canal IN ('coletor_http', 'pendrive', 'manual_ui')),
    iniciada_em           timestamptz NOT NULL DEFAULT now(),
    concluida_em          timestamptz,
    status                text NOT NULL DEFAULT 'em_andamento'
                          CHECK (status IN ('em_andamento', 'concluida', 'erro', 'parcial')),
    nsr_inicial           bigint,
    nsr_final             bigint,
    linhas_recebidas      integer NOT NULL DEFAULT 0,
    linhas_novas          integer NOT NULL DEFAULT 0,
    linhas_duplicadas     integer NOT NULL DEFAULT 0,
    marcacoes_criadas     integer NOT NULL DEFAULT 0,
    marcacoes_orfas       integer NOT NULL DEFAULT 0,
    arquivo_sha256        text,             -- pendrive
    assinatura_verificada boolean,          -- Ed25519 do REP-C; NULL = nao foi possivel checar
    coletor_versao        text,
    coletor_hostname      text,
    ip_origem             inet,
    importado_por_id      uuid REFERENCES public.profiles(id),  -- quem subiu o pendrive
    mensagem_erro         text
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_sincronizacao_lote' AND conrelid = 'public.rep_sincronizacoes'::regclass
    ) THEN
        ALTER TABLE public.rep_sincronizacoes
            ADD CONSTRAINT uq_sincronizacao_lote UNIQUE (dispositivo_id, lote_id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sincronizacoes_dispositivo
    ON public.rep_sincronizacoes (dispositivo_id, iniciada_em DESC);

COMMENT ON TABLE public.rep_sincronizacoes IS
    'Sessao de coleta de AFD. Unica por (dispositivo_id, lote_id) - reenvio do mesmo lote e no-op.';


-- ============================================================================
-- 4. REGISTROS BRUTOS DO AFD (artefato legal - nunca alterado, nunca apagado)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rep_afd_registros (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id    uuid NOT NULL REFERENCES public.dispositivos_rep(id),
    nsr               bigint NOT NULL,
    tipo_registro     char(1) NOT NULL,   -- '1'..'9' conforme layout da Portaria 671
    -- A linha exatamente como veio do equipamento, ja decodificada de latin1 para UTF-8 mas
    -- sem nenhuma normalizacao. E esta coluna que se apresenta numa fiscalizacao.
    linha_bruta       text NOT NULL,
    linha_sha256      text NOT NULL,
    -- Colunas parseadas sao DERIVADAS. parse_versao permite reprocessar o historico quando
    -- o parser for corrigido, sem jamais tocar em linha_bruta.
    ocorrido_em       timestamptz,
    identificador_afd text,               -- CPF com zero a esquerda (12 digitos) no tipo 3
    parse_versao      integer NOT NULL DEFAULT 1,
    parse_ok          boolean NOT NULL DEFAULT true,
    parse_erro        text,
    -- Encadeamento anti-adulteracao: hash_encadeado = sha256(hash_anterior || linha_sha256),
    -- por dispositivo, em ordem de NSR. Um DELETE feito por fora do Postgres quebra a cadeia.
    hash_anterior     text,
    hash_encadeado    text NOT NULL,
    sincronizacao_id  uuid REFERENCES public.rep_sincronizacoes(id),
    recebido_em       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'uq_afd_dispositivo_nsr' AND conrelid = 'public.rep_afd_registros'::regclass
    ) THEN
        ALTER TABLE public.rep_afd_registros
            ADD CONSTRAINT uq_afd_dispositivo_nsr UNIQUE (dispositivo_id, nsr);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_afd_dispositivo_nsr
    ON public.rep_afd_registros (dispositivo_id, nsr DESC);
CREATE INDEX IF NOT EXISTS idx_afd_marcacoes_ocorrido
    ON public.rep_afd_registros (ocorrido_em) WHERE tipo_registro = '3';
CREATE INDEX IF NOT EXISTS idx_afd_identificador
    ON public.rep_afd_registros (identificador_afd) WHERE tipo_registro = '3';

COMMENT ON TABLE public.rep_afd_registros IS
    'Linhas brutas do AFD coletado do REP. Artefato legal: linha_bruta e imutavel. '
    'As colunas parseadas sao derivadas e podem ser recomputadas sob guard de reparse.';


-- ============================================================================
-- 5. MARCACOES DE PONTO (todas as origens) - INSERT-only
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.marcacoes_ponto (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL quando o identificador do AFD nao resolveu para nenhum servidor. Marcacao orfa
    -- NUNCA e descartada: ela e a evidencia de que alguem bateu o ponto.
    servidor_id         uuid NULL REFERENCES public.servidores(id),
    origem              public.marcacao_origem NOT NULL,
    ocorrido_em         timestamptz NOT NULL,                 -- o instante da batida (o fato)
    registrado_em       timestamptz NOT NULL DEFAULT now(),   -- quando entrou no SisEscala

    -- Proveniencia REP
    dispositivo_id      uuid NULL REFERENCES public.dispositivos_rep(id),
    nsr                 bigint NULL,
    afd_registro_id     uuid NULL REFERENCES public.rep_afd_registros(id),
    identificador_bruto text NULL,                            -- como veio do equipamento
    via_pendrive        boolean NOT NULL DEFAULT false,

    -- Proveniencia humana
    coordenador_id      uuid NULL REFERENCES public.profiles(id),  -- supervisor do terminal
    registrado_por_id   uuid NULL REFERENCES public.profiles(id),  -- autor do ajuste manual
    justificativa       text NULL,

    -- Contexto congelado no momento do registro: a lotacao do servidor pode mudar depois, e
    -- a marcacao precisa continuar dizendo onde ela aconteceu.
    unidade_id          uuid NULL REFERENCES public.unidades(id),
    setor_id            uuid NULL REFERENCES public.setores(id),

    -- Marcadores factuais
    sintetica           boolean NOT NULL DEFAULT false,  -- horario derivado da jornada, nao batido
    retroativa          boolean NOT NULL DEFAULT false,  -- backfill ou importacao tardia
    observacao          text,

    CONSTRAINT chk_marcacao_rep_completa CHECK (
        origem <> 'rep' OR (dispositivo_id IS NOT NULL AND nsr IS NOT NULL)
    ),
    -- Ajuste manual sem justificativa e exatamente o que uma auditoria procura.
    -- Marcacoes retroativas (backfill) sao isentas: o historico nao tem justificativa a oferecer.
    CONSTRAINT chk_marcacao_ajuste_justificado CHECK (
        retroativa
        OR origem NOT IN ('ajuste_coordenador', 'ajuste_servidor')
        OR (justificativa IS NOT NULL AND btrim(justificativa) <> '')
    )
);

-- Idempotencia da ingestao: o mesmo NSR nunca vira duas marcacoes, venha por rede ou pendrive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marcacao_rep_nsr
    ON public.marcacoes_ponto (dispositivo_id, nsr) WHERE origem = 'rep';

CREATE INDEX IF NOT EXISTS idx_marcacao_servidor_data
    ON public.marcacoes_ponto (servidor_id, ocorrido_em);
CREATE INDEX IF NOT EXISTS idx_marcacao_orfas
    ON public.marcacoes_ponto (identificador_bruto, ocorrido_em) WHERE servidor_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_marcacao_origem_data
    ON public.marcacoes_ponto (origem, ocorrido_em DESC);

COMMENT ON TABLE public.marcacoes_ponto IS
    'Marcacoes de ponto de todas as origens. INSERT-only: UPDATE e DELETE sao bloqueados por '
    'trigger. Para desconsiderar ou reclassificar uma marcacao, registre um tratamento em '
    'marcacoes_tratamentos - a marcacao original permanece para auditoria.';
COMMENT ON COLUMN public.marcacoes_ponto.ocorrido_em IS 'Instante da batida. E o fato.';
COMMENT ON COLUMN public.marcacoes_ponto.registrado_em IS
    'Instante em que a marcacao entrou no SisEscala. Difere muito de ocorrido_em em coleta por pendrive.';
COMMENT ON COLUMN public.marcacoes_ponto.sintetica IS
    'true quando o horario foi derivado da jornada em vez de batido de fato (validacao manual, '
    'ou os timestamps fabricados por fn_salvar_saida_bloco).';


-- ============================================================================
-- 6. TRATAMENTOS (o juizo do coordenador sobre uma marcacao) - append-only
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.marcacoes_tratamentos (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    marcacao_id       uuid NOT NULL REFERENCES public.marcacoes_ponto(id),
    tipo              text NOT NULL CHECK (tipo IN (
                        'desconsiderar',        -- duplicidade, batida indevida
                        'restaurar',            -- desfaz um desconsiderar anterior
                        'reclassificar_passo',  -- forca entrada/int_saida/int_retorno/saida
                        'reatribuir_servidor',  -- resolve marcacao orfa
                        'vincular_escala')),    -- forca a escala_diaria de destino
    passo_forcado     text NULL CHECK (passo_forcado IS NULL OR passo_forcado IN
                        ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida')),
    servidor_id_novo  uuid NULL REFERENCES public.servidores(id),
    escala_diaria_id  uuid NULL REFERENCES public.escala_diaria(id),
    justificativa     text NOT NULL,
    registrado_por_id uuid NOT NULL REFERENCES public.profiles(id),
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_tratamento_justificado CHECK (btrim(justificativa) <> ''),
    CONSTRAINT chk_tratamento_passo CHECK (
        tipo <> 'reclassificar_passo' OR passo_forcado IS NOT NULL
    ),
    CONSTRAINT chk_tratamento_servidor CHECK (
        tipo <> 'reatribuir_servidor' OR servidor_id_novo IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_tratamentos_marcacao
    ON public.marcacoes_tratamentos (marcacao_id, created_at);

COMMENT ON TABLE public.marcacoes_tratamentos IS
    'Tratamento PTRP: o coordenador nunca edita uma marcacao, ele registra um juizo sobre ela. '
    'O efetivo e o ultimo tratamento por created_at (desconsiderar/restaurar se alternam).';


-- ============================================================================
-- 7. VINCULO DEVICE -> SERVIDOR (com vigencia temporal)
-- ============================================================================
--
-- POR QUE VIGENCIA, E NAO UMA COLUNA EM servidores
--   O registro tipo 3 do AFD (a marcacao) carrega SOMENTE o identificador de 12 digitos -
--   o CPF com zero a esquerda. A matricula nao aparece em nenhuma marcacao; ela so existe no
--   cadastro do equipamento (load_users.fcgi) e no registro tipo 5.
--
--   Isso torna o cadastro do device a unica tabela de juncao entre uma batida e um servidor,
--   e obriga a snapshota-lo ANTES de qualquer remove_users.fcgi: apagado o usuario do relogio,
--   os NSRs antigos ficariam orfaos para sempre.
--
--   A vigencia existe porque o vinculo muda: matricula temporaria T26xxxxx vira definitiva,
--   servidor e transferido, CPF e corrigido. Sem vigencia, uma correcao de hoje faria batidas
--   de meses atras passarem a resolver para outra pessoa - que e falsificar ponto historico.

CREATE TABLE IF NOT EXISTS public.rep_vinculos_servidor (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id    uuid NOT NULL REFERENCES public.dispositivos_rep(id),
    identificador_afd text NOT NULL,      -- campo 'pis' do device, que na pratica guarda o CPF
    matricula_device  text,               -- campo 'registration' do device
    nome_device       text,
    servidor_id       uuid NOT NULL REFERENCES public.servidores(id),
    device_user_id    bigint,             -- id interno do usuario no relogio
    tem_biometria     boolean NOT NULL DEFAULT false,
    vigente_de        timestamptz NOT NULL DEFAULT now(),
    vigente_ate       timestamptz NULL,   -- NULL = vinculo vigente
    criado_por_id     uuid REFERENCES public.profiles(id),
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Um identificador so pode ter UM vinculo vigente por dispositivo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vinculo_vigente
    ON public.rep_vinculos_servidor (dispositivo_id, identificador_afd)
    WHERE vigente_ate IS NULL;

CREATE INDEX IF NOT EXISTS idx_vinculo_resolucao
    ON public.rep_vinculos_servidor (dispositivo_id, identificador_afd, vigente_de DESC);
CREATE INDEX IF NOT EXISTS idx_vinculo_servidor
    ON public.rep_vinculos_servidor (servidor_id);

COMMENT ON TABLE public.rep_vinculos_servidor IS
    'Ponte entre o identificador que vem no AFD (CPF com zero a esquerda) e o servidor, com '
    'vigencia temporal. Deve ser populada a partir de load_users.fcgi ANTES de qualquer '
    'remocao de usuarios do equipamento.';


-- ============================================================================
-- 8. GRANTS BASICOS
-- ============================================================================
-- Leitura para a aplicacao; a escrita e tratada na migration de imutabilidade (20260808010000).

GRANT SELECT ON public.dispositivos_rep         TO authenticated, service_role;
GRANT SELECT ON public.rep_sincronizacoes       TO authenticated, service_role;
GRANT SELECT ON public.rep_afd_registros        TO authenticated, service_role;
GRANT SELECT ON public.marcacoes_ponto          TO authenticated, service_role;
GRANT SELECT ON public.marcacoes_tratamentos    TO authenticated, service_role;
GRANT SELECT ON public.rep_vinculos_servidor    TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.fn_precedencia_origem(public.marcacao_origem)
    TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--   1) As 6 tabelas devem existir e estar VAZIAS:
--
--   SELECT c.relname, (SELECT count(*) FROM pg_class x WHERE x.oid = c.oid) AS existe
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND c.relname IN ('dispositivos_rep','rep_sincronizacoes','rep_afd_registros',
--                        'marcacoes_ponto','marcacoes_tratamentos','rep_vinculos_servidor')
--    ORDER BY c.relname;
--   -- esperado: 6 linhas
--
--   2) A ordem de precedencia deve ser REP < terminal < coordenador < servidor:
--
--   SELECT o AS origem, public.fn_precedencia_origem(o) AS peso
--     FROM unnest(enum_range(NULL::public.marcacao_origem)) o
--    ORDER BY 2;
--   -- esperado: rep=1, terminal=2, ajuste_coordenador=3, ajuste_servidor=4
--
--   3) Nada mudou no comportamento atual - o terminal e a folha nao conhecem estas tabelas.
--      Confirme que a grade e a folha de ponto continuam abrindo normalmente.
