-- Migration: destino do acionamento, autoria e abrangencia do sobreaviso
-- Fase 2 do plano docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
--
-- POR QUE
--   Quem esta de sobreaviso atende varias unidades, mas o chamado herdava a unidade da
--   escala. Medido em producao em 08/08/2026, nas 8 chegadas com GPS que existem:
--     - todas foram conferidas contra o setor TECNOLOGIA DA INFORMACAO (raio 100 m);
--     - "Enfermeira zezinha sem internet" -> destino real a 3.308 m do ponto conferido;
--     - "Emerson Cassele sem internet"    -> destino real a 3.954 m do ponto conferido.
--   Ou seja: o servidor ia ate a sala da TI so para o botao "cheguei" aceitar, e SO ENTAO
--   se deslocava para o local do chamado. data_hora_chegada mede a chegada no lugar errado.
--
-- O QUE ESTA MIGRATION FAZ
--   1. setores.sobreaviso_abrangencia  - quem pode acionar aquele sobreaviso
--   2. colunas de destino em logs_sobreaviso  - para onde a pessoa foi chamada
--   3. colunas de autoria e de prova da chegada
--   4. backfill do historico com destino = origem (preserva o sentido dos 522 registros)
--
--   Nada de comportamento muda aqui. As colunas so passam a ser lidas/escritas nas Fases 3 a 7.

-- ---------------------------------------------------------------------------
-- 1. Abrangencia do sobreaviso, no SETOR
-- ---------------------------------------------------------------------------
-- A abrangencia e propriedade da EQUIPE, nao do dia nem do codigo de turno: N12 e o mesmo
-- codigo do plantonista de TI e do clinico de um hospital, entao marcar em dicionario_turnos
-- nao separa os dois. Marcar em escala_mensal obrigaria a redecidir todo mes.
--
-- Default 'unidade': fecha por padrao. Ninguem vira acionavel por toda a secretaria sem
-- alguem marcar explicitamente.
ALTER TABLE public.setores
    ADD COLUMN IF NOT EXISTS sobreaviso_abrangencia text NOT NULL DEFAULT 'unidade';

ALTER TABLE public.setores
    DROP CONSTRAINT IF EXISTS chk_sobreaviso_abrangencia;

ALTER TABLE public.setores
    ADD CONSTRAINT chk_sobreaviso_abrangencia
    CHECK (sobreaviso_abrangencia IN ('geral', 'unidade'));

COMMENT ON COLUMN public.setores.sobreaviso_abrangencia IS
'Quem pode ACIONAR o sobreaviso deste setor. "geral" = qualquer coordenador/admin da secretaria
(TI, manutencao, transporte - equipes que atendem toda a rede). "unidade" = so quem tem escopo
naquela unidade/setor. Todos VEEM todos os sobreavisos no painel; a abrangencia restringe apenas
o acionamento. NAO restringe o destino: um sobreaviso de unidade pode ser chamado para qualquer
lugar.';

-- ---------------------------------------------------------------------------
-- 2. Destino, autoria e prova de chegada em logs_sobreaviso
-- ---------------------------------------------------------------------------
-- ATENCAO: unidade_id NAO muda de significado. Continua sendo a unidade da ESCALA (a origem,
-- de quem e o plantao) - e o que a RLS de logs_sobreaviso, a folha e o relatorio
-- plantao-sobreaviso usam. Destino e informacao nova, em colunas proprias.
ALTER TABLE public.logs_sobreaviso
    ADD COLUMN IF NOT EXISTS destino_unidade_id uuid REFERENCES public.unidades(id),
    ADD COLUMN IF NOT EXISTS destino_setor_id   uuid,
    ADD COLUMN IF NOT EXISTS destino_referencia text,
    ADD COLUMN IF NOT EXISTS acionado_por       uuid REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS abrangencia_no_acionamento text,
    ADD COLUMN IF NOT EXISTS chegada_distancia_metros   numeric,
    ADD COLUMN IF NOT EXISTS chegada_geofence_aplicado  boolean;

COMMENT ON COLUMN public.logs_sobreaviso.destino_unidade_id IS
'Para onde a pessoa foi chamada. Diferente de unidade_id, que e a unidade da escala (origem).';
COMMENT ON COLUMN public.logs_sobreaviso.destino_setor_id IS
'Setor de destino, opcional. Quando preenchido, tem de pertencer a destino_unidade_id (FK composta).';
COMMENT ON COLUMN public.logs_sobreaviso.destino_referencia IS
'Ponto de referencia livre ("CPD do 2o andar"). Unidade + setor nem sempre bastam.';
COMMENT ON COLUMN public.logs_sobreaviso.acionado_por IS
'Quem acionou. NULO no historico anterior a 08/2026: o dado nunca existiu. Com o painel aberto
para toda a secretaria, passa a ser obrigatorio na pratica (gravado por fn_acionar_sobreaviso).';
COMMENT ON COLUMN public.logs_sobreaviso.abrangencia_no_acionamento IS
'A abrangencia do setor NO MOMENTO do acionamento, congelada. Se o setor for remarcado depois, o
historico continua explicando por que aquele acionamento foi permitido.';
COMMENT ON COLUMN public.logs_sobreaviso.chegada_distancia_metros IS
'Distancia medida entre o GPS da chegada e o ponto de referencia do destino.';
COMMENT ON COLUMN public.logs_sobreaviso.chegada_geofence_aplicado IS
'FALSE quando nao havia coordenada para conferir e a chegada foi aceita mesmo assim. Antes desta
coluna esse caso era indistinguivel de uma chegada validada: os dois gravavam
tipo_validacao_chegada = GPS. NULO no historico anterior - nao da para saber retroativamente.';

ALTER TABLE public.logs_sobreaviso
    DROP CONSTRAINT IF EXISTS chk_abrangencia_no_acionamento;
ALTER TABLE public.logs_sobreaviso
    ADD CONSTRAINT chk_abrangencia_no_acionamento
    CHECK (abrangencia_no_acionamento IS NULL
           OR abrangencia_no_acionamento IN ('geral', 'unidade'));

-- ---------------------------------------------------------------------------
-- 3. Backfill: destino = origem
-- ---------------------------------------------------------------------------
-- Preserva o sentido do historico. Os 522 registros existentes de fato tinham como referencia
-- a unidade/setor da escala - foi contra ela que o geofence conferiu.
--
-- Conferido em producao em 08/08/2026 antes de escrever isto, nos 522 registros:
--   unidade_id nulo: 0 | escala_mensal_id nulo ou orfao: 0
--   log.unidade_id <> escala_mensal.unidade_id: 0
--   setor da escala fora de log.unidade_id: 0
-- Ou seja, o backfill nao produz nenhum par (setor, unidade) invalido e a FK composta abaixo
-- pode ser criada sem NOT VALID.
UPDATE public.logs_sobreaviso l
SET destino_unidade_id = l.unidade_id
WHERE l.destino_unidade_id IS NULL;

UPDATE public.logs_sobreaviso l
SET destino_setor_id = em.setor_id
FROM public.escala_mensal em
WHERE em.id = l.escala_mensal_id
  AND l.destino_setor_id IS NULL
  AND em.setor_id IS NOT NULL;

-- chegada_geofence_aplicado fica NULO no historico de proposito: nao da para reconstruir se a
-- validacao rodou ou foi pulada por falta de coordenada.

-- ---------------------------------------------------------------------------
-- 4. Integridade do par (setor, unidade) de destino
-- ---------------------------------------------------------------------------
-- Sem isto daria para gravar "setor do HMM dentro da unidade SMS" e o geofence resolveria um
-- ponto que nao existe. FK composta em vez de trigger: o banco garante sozinho.
ALTER TABLE public.setores
    DROP CONSTRAINT IF EXISTS uq_setores_id_unidade;
ALTER TABLE public.setores
    ADD CONSTRAINT uq_setores_id_unidade UNIQUE (id, unidade_id);

ALTER TABLE public.logs_sobreaviso
    DROP CONSTRAINT IF EXISTS fk_logs_sobreaviso_destino_setor;
ALTER TABLE public.logs_sobreaviso
    ADD CONSTRAINT fk_logs_sobreaviso_destino_setor
    FOREIGN KEY (destino_setor_id, destino_unidade_id)
    REFERENCES public.setores (id, unidade_id);

-- A FK acima e MATCH SIMPLE: so e checada quando as DUAS colunas estao preenchidas. O CHECK
-- abaixo fecha a brecha de gravar setor sem unidade, que escaparia da FK.
-- Nao se usa MATCH FULL aqui de proposito: ele proibiria destino de unidade SEM setor, que e
-- justamente o caso mais comum (52 dos 57 setores nao tem coordenada propria e o geofence cai
-- no fallback da unidade).
ALTER TABLE public.logs_sobreaviso
    DROP CONSTRAINT IF EXISTS chk_destino_setor_exige_unidade;
ALTER TABLE public.logs_sobreaviso
    ADD CONSTRAINT chk_destino_setor_exige_unidade
    CHECK (destino_setor_id IS NULL OR destino_unidade_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5. Destino nunca fica vazio
-- ---------------------------------------------------------------------------
-- fn_acionar_sobreaviso (Fase 4) sempre informa o destino. Mas fn_confirmar_presenca e
-- fn_confirmar_presenca_manual TAMBEM inserem em logs_sobreaviso (validacao de presenca de
-- Sobreaviso pelo terminal e pela grade) e nao conhecem destino nenhum.
-- Em vez de NOT NULL - que quebraria o terminal - o gatilho preenche destino = origem, que e
-- exatamente o que aquelas linhas significam.
CREATE OR REPLACE FUNCTION public.fn_logs_sobreaviso_destino_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.destino_unidade_id IS NULL THEN
        NEW.destino_unidade_id := NEW.unidade_id;

        -- so herda o setor junto com a unidade, para nunca formar par invalido
        IF NEW.destino_setor_id IS NULL AND NEW.escala_mensal_id IS NOT NULL THEN
            SELECT em.setor_id INTO NEW.destino_setor_id
            FROM public.escala_mensal em
            WHERE em.id = NEW.escala_mensal_id
              AND em.unidade_id = NEW.unidade_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_logs_sobreaviso_destino_default ON public.logs_sobreaviso;
CREATE TRIGGER trg_logs_sobreaviso_destino_default
    BEFORE INSERT ON public.logs_sobreaviso
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_logs_sobreaviso_destino_default();

COMMENT ON FUNCTION public.fn_logs_sobreaviso_destino_default() IS
'Preenche destino = origem quando quem insere nao conhece destino (terminal de presenca e
validacao manual). Sem isto, essas linhas ficariam com destino nulo e o geofence da Fase 3 nao
teria ponto de referencia.';

-- ---------------------------------------------------------------------------
-- 6. Semente: o caso que originou o pedido
-- ---------------------------------------------------------------------------
-- Setor TECNOLOGIA DA INFORMACAO da SMS - 52 dos 67 dias de sobreaviso de producao.
-- Existem DOIS setores com esse nome em unidades diferentes; so o da SMS tem sobreaviso.
-- CAF (14 dias) e TRANSPORTE (1 dia) tambem sao candidatos naturais a 'geral', mas ficam no
-- default ate alguem decidir na tela - marcar por conta propria ampliaria quem pode acionar.
UPDATE public.setores s
SET sobreaviso_abrangencia = 'geral'
FROM public.dicionario_setores ds, public.unidades u
WHERE ds.id = s.dicionario_setor_id
  AND u.id = s.unidade_id
  AND ds.nome ILIKE '%TECNOLOGIA DA INFORMA%'
  AND u.nome ILIKE 'SMS%';

-- ---------------------------------------------------------------------------
-- CONFERENCIA (rodar depois de aplicar)
-- ---------------------------------------------------------------------------
--   -- nenhum destino vazio, nenhum par invalido:
--   SELECT count(*) FILTER (WHERE destino_unidade_id IS NULL)             AS sem_destino,
--          count(*) FILTER (WHERE destino_unidade_id <> unidade_id)       AS destino_diferente,
--          count(*)                                                       AS total
--   FROM public.logs_sobreaviso;
--   -- esperado logo apos a migration: sem_destino = 0, destino_diferente = 0, total = 522
--
--   -- quem ficou marcado como geral:
--   SELECT u.nome, ds.nome, s.sobreaviso_abrangencia
--   FROM public.setores s
--   JOIN public.unidades u ON u.id = s.unidade_id
--   LEFT JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
--   WHERE s.sobreaviso_abrangencia = 'geral';
--   -- esperado: exatamente 1 linha, SMS / TECNOLOGIA DA INFORMACAO
