-- ============================================================================
-- Mover e DIVIDIR a escala mensal entre setores -- em vez de apagar a metade de tras
-- ============================================================================
-- 03/09/2026 - relato do usuario: "esses servidores foram inseridos na escala errada, eles
-- deveriam estar na escala do mais medicos; eu fiz a transferencia de setor deles mas as escalas
-- continuam no mesmo setor de antes".
--
-- O QUE O SISTEMA FAZIA (medido em 03/09/2026)
--   `registrarTransferenciaEfetivada` (src/app/(dashboard)/servidores/actions.ts) ja DIVIDIA a
--   escala por data -- mas as quatro coisas que ela faz sao DELETE:
--     A. origem, mes da transferencia : apaga os dias >= dia da transferencia, sem ponto
--     B. destino, mesmo mes           : apaga os dias < dia -- SO SE a escala destino ja existir
--     C. origem, meses seguintes      : apaga a escala inteira
--     D. destino, meses anteriores    : apaga a escala inteira
--
--   Ou seja: a metade "depois da transferencia" e DESTRUIDA, nunca movida, e a escala de destino
--   nunca e criada. Nao existe "escala parcial no setor novo" -- existe um buraco.
--
--   Caso real: 4 servidores (ANDRE, ISAAC, KETHURY, MARCELO) transferidos
--   AMBULATORIO CLINICO -> MAIS MEDICOS com data 09/09/2026, registrada em 03/09/2026 16:03.
--   Depois disso: 08 e 09/2026 continuam inteiramente no AMBULATORIO CLINICO, os dias >= 9 de
--   09/2026 foram apagados, e MAIS MEDICOS nao tem escala nenhuma.
--
--   Agrava: o bloco inteiro roda dentro de um try/catch que so faz console.error. A
--   transferencia "da certo" sem ter tocado em escala nenhuma, e a tela nao diz nada.
--
-- POR QUE MOVER E DIVIDIR SAO BARATOS
--   `escala_diaria` NAO tem setor nem unidade proprios -- herda de `escala_mensal`. Entao mover e
--   um UPDATE de uma linha, e dividir e criar a segunda `escala_mensal` e repontar as linhas dos
--   dias. Nos dois casos NADA e fabricado e NADA e apagado: a presenca viaja junto com a linha, e
--   `marcacoes_ponto` mantem o `setor_id` onde a batida foi registrada -- que e o fato, e deve
--   ficar onde esta.
--
-- DECISOES DO USUARIO (03/09/2026), que estao codificadas aqui:
--   1. Dividir produz DUAS FOLHAS parciais no mes (uma por setor). `folha_ponto` ja e chaveada
--      por `escala_mensal_id` e nao guarda setor, entao isso sai de graca -- e cada chefia assina
--      o periodo que chefiou. Ja acontece com 1 servidor em 08/2026.
--   2. Competencia FECHADA ou ENCERRADA: RECUSAR sempre. Mes fechado e folha assinada; a porta e
--      reabrir a competencia em Configuracoes, que ja e ato registrado.
--   3. Na grade, o alcance e SO a competencia da tela.
--
-- ATENCAO: A FOLHA SEGUE SOZINHA NO "MOVER", E NAO SEGUE NO "DIVIDIR"
--   `folha_ponto` aponta para `escala_mensal_id` e nao tem coluna de setor -- entao mover a
--   escala leva a folha junto, sem regerar nada. Dividir e diferente: a folha existente continua
--   presa a escala de ORIGEM e passa a cobrir dias que foram embora. Por isso a divisao RECUSA
--   quando ja existe folha fora de Rascunho, e devolve `folha_sincronizar` para a tela mandar
--   sincronizar.
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE + correcao por ID EXPLICITO
-- (nunca por criterio amplo) + verificacao que aborta.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Historico append-only
-- ----------------------------------------------------------------------------
-- Mesmo desenho de `escala_mensal_jornada_historico` (20260819230000) e
-- `escala_diaria_turno_historico` (20260821110000): a operacao muda a premissa de um mes inteiro
-- de trabalho, entao tem de deixar rastro de quem, quando e por que.
CREATE TABLE IF NOT EXISTS public.escala_mensal_movimentos (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo                      text NOT NULL CHECK (tipo IN ('mover', 'dividir')),

    escala_mensal_id          uuid NOT NULL REFERENCES public.escala_mensal(id) ON DELETE CASCADE,
    -- So no 'dividir': a escala NOVA, que ficou com os dias a partir do corte.
    escala_destino_id         uuid REFERENCES public.escala_mensal(id) ON DELETE SET NULL,

    servidor_id               uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    mes                       integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
    ano                       integer NOT NULL CHECK (ano >= 2020),

    unidade_origem_id         uuid REFERENCES public.unidades(id),
    setor_origem_id           uuid REFERENCES public.setores(id),
    unidade_destino_id        uuid REFERENCES public.unidades(id),
    setor_destino_id          uuid REFERENCES public.setores(id),

    -- 'dividir': primeiro dia que foi para o setor novo. 'mover': NULL (foi o mes inteiro).
    dia_corte                 integer CHECK (dia_corte BETWEEN 1 AND 31),
    dias_movidos              integer NOT NULL DEFAULT 0,
    dias_com_ponto            integer NOT NULL DEFAULT 0,

    justificativa             text NOT NULL CHECK (btrim(justificativa) <> ''),
    movido_por                uuid REFERENCES auth.users(id),
    movido_em                 timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_movimento_dividir_tem_corte
        CHECK ((tipo = 'dividir' AND dia_corte IS NOT NULL) OR (tipo = 'mover' AND dia_corte IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_escala_movimento_servidor
    ON public.escala_mensal_movimentos (servidor_id, ano, mes);

ALTER TABLE public.escala_mensal_movimentos ENABLE ROW LEVEL SECURITY;

-- Leitura para quem opera escala (mesma populacao de `fn_pode_escalar_servidor_externo`: fora so
-- os papeis do Portal). Escrita NENHUMA por policy: so as RPCs SECURITY DEFINER gravam -- senao
-- qualquer autenticado forjaria um registro de movimentacao pelo PostgREST (armadilha 12).
DROP POLICY IF EXISTS "Leitura de movimentos de escala" ON public.escala_mensal_movimentos;
CREATE POLICY "Leitura de movimentos de escala"
ON public.escala_mensal_movimentos
FOR SELECT
TO authenticated
USING (public.fn_pode_escalar_servidor_externo());


-- ----------------------------------------------------------------------------
-- 2. Quem pode mover
-- ----------------------------------------------------------------------------
-- Exige poder lancar escala NOS DOIS LADOS. `fn_pode_solicitar_excecao_carga` ja espelha a policy
-- de escrita de `escala_mensal` ("quem lanca a escala daquela unidade/setor"), entao nao se
-- inventa criterio novo -- e o RH da Unidade, que so alcanca as unidades dele, precisa dos dois
-- lados pelo mesmo motivo da avaliacao de transferencia (28/08/2026): tirar de um setor que ele
-- nao enxerga e tao decisivo quanto por em um que ele enxerga.
CREATE OR REPLACE FUNCTION public.fn_pode_mover_escala_mensal(
    p_unidade_origem  uuid,
    p_setor_origem    uuid,
    p_unidade_destino uuid,
    p_setor_destino   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT public.fn_pode_solicitar_excecao_carga(p_unidade_origem, p_setor_origem)
       AND public.fn_pode_solicitar_excecao_carga(p_unidade_destino, p_setor_destino);
$fn$;

COMMENT ON FUNCTION public.fn_pode_mover_escala_mensal(uuid, uuid, uuid, uuid) IS
    'Quem pode mover/dividir escala entre setores: precisa poder lancar escala nos DOIS lados. '
    'Reusa fn_pode_solicitar_excecao_carga, que ja espelha a policy de escrita de escala_mensal.';


-- ----------------------------------------------------------------------------
-- 3. Guards comuns -- fonte unica das recusas
-- ----------------------------------------------------------------------------
-- Extraido porque mover e dividir precisam EXATAMENTE das mesmas recusas. Duas copias
-- divergiriam no primeiro guard novo, e a divisao (a mais rara) e' a que ficaria para tras.
CREATE OR REPLACE FUNCTION public.fn_validar_destino_escala(
    p_escala_id       uuid,
    p_unidade_destino uuid,
    p_setor_destino   uuid,
    p_justificativa   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_em      record;
    v_setor   record;
    v_choque  uuid;
BEGIN
    SELECT * INTO v_em FROM public.escala_mensal WHERE id = p_escala_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Escala mensal nao encontrada.';
    END IF;

    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RAISE EXCEPTION 'A justificativa e obrigatoria: mover escala muda a premissa de um mes inteiro de trabalho.';
    END IF;

    -- Decisao do usuario (03/09/2026): mes fechado nao se move. A porta e reabrir a competencia.
    IF public.fn_competencia_encerrada(v_em.mes, v_em.ano) THEN
        RAISE EXCEPTION
            'Competencia %/% esta encerrada: reabra em Configuracoes antes de mover a escala.',
            lpad(v_em.mes::text, 2, '0'), v_em.ano
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF v_em.status = 'Fechada' THEN
        RAISE EXCEPTION
            'A escala de %/% esta Fechada: reabra a escala antes de mover.',
            lpad(v_em.mes::text, 2, '0'), v_em.ano
            USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT s.id, s.unidade_id, s.ativo INTO v_setor
      FROM public.setores s WHERE s.id = p_setor_destino;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Setor de destino nao encontrado.';
    END IF;

    -- Setor de outra unidade nao e destino: a escala guarda unidade E setor, e aceitar a
    -- combinacao errada produziria uma escala que nenhuma tela de unidade encontra.
    IF v_setor.unidade_id IS DISTINCT FROM p_unidade_destino THEN
        RAISE EXCEPTION 'O setor de destino nao pertence a unidade de destino.';
    END IF;

    -- Mesma regra de `opcoesAtivas.ts`: destino e escolha NOVA, setor desativado fica fora.
    IF v_setor.ativo IS FALSE THEN
        RAISE EXCEPTION 'O setor de destino esta inativo.';
    END IF;

    IF v_em.unidade_id IS NOT DISTINCT FROM p_unidade_destino
   AND v_em.setor_id  IS NOT DISTINCT FROM p_setor_destino THEN
        RAISE EXCEPTION 'A escala ja esta neste setor.';
    END IF;

    IF NOT public.fn_pode_mover_escala_mensal(
            v_em.unidade_id, v_em.setor_id, p_unidade_destino, p_setor_destino) THEN
        RAISE EXCEPTION 'Acesso negado: e preciso poder lancar escala na origem E no destino.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Escala do MESMO servidor ja existente no destino, na mesma competencia. Nao se funde
    -- sozinho: juntar duas escalas soma horas que ninguem conferiu, e a unique de escala_mensal
    -- recusaria de qualquer forma -- com mensagem que ninguem entende.
    SELECT em2.id INTO v_choque
      FROM public.escala_mensal em2
     WHERE em2.servidor_id = v_em.servidor_id
       AND em2.mes = v_em.mes
       AND em2.ano = v_em.ano
       AND em2.setor_id = p_setor_destino
       AND em2.id <> p_escala_id
     LIMIT 1;

    IF v_choque IS NOT NULL THEN
        RAISE EXCEPTION
            'Este servidor ja tem escala em %/% no setor de destino. Ajuste-a antes de mover esta.',
            lpad(v_em.mes::text, 2, '0'), v_em.ano;
    END IF;
END;
$fn$;


-- ----------------------------------------------------------------------------
-- 4. Mover a escala INTEIRA
-- ----------------------------------------------------------------------------
-- A folha vai junto sem regerar: `folha_ponto` aponta para `escala_mensal_id` e nao guarda setor.
--
-- E nao ha sobreposicao nova a temer (armadilha 23): mover NAO muda o conjunto de (dia, slots) do
-- servidor, so a quem eles sao atribuidos -- e a unica escala que poderia colidir no destino ja
-- foi recusada em fn_validar_destino_escala.
CREATE OR REPLACE FUNCTION public.fn_mover_escala_mensal(
    p_escala_id       uuid,
    p_unidade_destino uuid,
    p_setor_destino   uuid,
    p_justificativa   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_em        record;
    v_dias      integer;
    v_com_ponto integer;
BEGIN
    SELECT * INTO v_em FROM public.escala_mensal WHERE id = p_escala_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Escala mensal nao encontrada.';
    END IF;

    PERFORM public.fn_validar_destino_escala(p_escala_id, p_unidade_destino, p_setor_destino, p_justificativa);

    SELECT count(*), count(*) FILTER (WHERE ed.presenca_entrada_em IS NOT NULL)
      INTO v_dias, v_com_ponto
      FROM public.escala_diaria ed
     WHERE ed.escala_mensal_id = p_escala_id;

    UPDATE public.escala_mensal
       SET unidade_id = p_unidade_destino,
           setor_id   = p_setor_destino,
           updated_at = now()
     WHERE id = p_escala_id;

    INSERT INTO public.escala_mensal_movimentos (
        tipo, escala_mensal_id, servidor_id, mes, ano,
        unidade_origem_id, setor_origem_id, unidade_destino_id, setor_destino_id,
        dias_movidos, dias_com_ponto, justificativa, movido_por
    ) VALUES (
        'mover', p_escala_id, v_em.servidor_id, v_em.mes, v_em.ano,
        v_em.unidade_id, v_em.setor_id, p_unidade_destino, p_setor_destino,
        v_dias, v_com_ponto, btrim(p_justificativa), auth.uid()
    );

    RETURN jsonb_build_object(
        'ok', true,
        'tipo', 'mover',
        'escala_id', p_escala_id,
        'dias_movidos', v_dias,
        'dias_com_ponto', v_com_ponto,
        -- A folha acompanha por FK; nao ha o que sincronizar. Dito explicitamente para a tela
        -- nao "avisar por precaucao" algo que nao aconteceu (armadilha 22).
        'folha_sincronizar', false
    );
END;
$fn$;


-- ----------------------------------------------------------------------------
-- 5. DIVIDIR: os dias a partir do corte vao para o setor novo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_dividir_escala_mensal(
    p_escala_id       uuid,
    p_dia_corte       integer,
    p_unidade_destino uuid,
    p_setor_destino   uuid,
    p_justificativa   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_em         record;
    v_nova_id    uuid;
    v_dias       integer;
    v_com_ponto  integer;
    v_folha      record;
BEGIN
    SELECT * INTO v_em FROM public.escala_mensal WHERE id = p_escala_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Escala mensal nao encontrada.';
    END IF;

    PERFORM public.fn_validar_destino_escala(p_escala_id, p_unidade_destino, p_setor_destino, p_justificativa);

    IF p_dia_corte IS NULL OR p_dia_corte < 2 OR p_dia_corte > 31 THEN
        RAISE EXCEPTION
            'Dia de corte invalido (%). Use 2 a 31 -- para levar o mes inteiro, a operacao e MOVER, nao dividir.',
            p_dia_corte;
    END IF;

    SELECT count(*), count(*) FILTER (WHERE ed.presenca_entrada_em IS NOT NULL)
      INTO v_dias, v_com_ponto
      FROM public.escala_diaria ed
     WHERE ed.escala_mensal_id = p_escala_id
       AND ed.dia >= p_dia_corte;

    IF v_dias = 0 THEN
        RAISE EXCEPTION
            'Nao ha nenhum dia lancado a partir do dia % nesta escala: nao ha o que dividir.',
            p_dia_corte;
    END IF;

    -- A folha e SNAPSHOT (folha_ponto.registros e jsonb). Depois da divisao ela continua presa a
    -- escala de origem cobrindo dias que foram embora -- e so "Sincronizar" a corrige. Fora de
    -- Rascunho isso e' documento ja gerado/revisado: recusa, em vez de deixar a folha mentir.
    SELECT fp.id, fp.status INTO v_folha
      FROM public.folha_ponto fp
     WHERE fp.escala_mensal_id = p_escala_id
     LIMIT 1;

    IF FOUND AND v_folha.status IS DISTINCT FROM 'Rascunho' THEN
        RAISE EXCEPTION
            'A folha de ponto desta escala esta em "%": dividir deixaria a folha cobrindo dias que mudaram de setor. Reabra a folha antes.',
            v_folha.status
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Escala nova sempre em Rascunho: ela nasce agora e ninguem a conferiu ainda, mesmo que a de
    -- origem estivesse adiante. `jornada_id` acompanha -- e a jornada da pessoa naquele mes
    -- (armadilha "a jornada do mes nao tem vigencia"); trocar aqui mudaria o julgamento dos dias.
    INSERT INTO public.escala_mensal (mes, ano, servidor_id, unidade_id, setor_id, status, ativo, jornada_id)
    VALUES (v_em.mes, v_em.ano, v_em.servidor_id, p_unidade_destino, p_setor_destino, 'Rascunho', true, v_em.jornada_id)
    RETURNING id INTO v_nova_id;

    -- Reaponta os dias. A presenca viaja JUNTO, na propria linha: nao se copia nem se recria
    -- horario nenhum (a regra de nunca fabricar batida vale aqui tambem).
    UPDATE public.escala_diaria
       SET escala_mensal_id = v_nova_id,
           updated_at = now()
     WHERE escala_mensal_id = p_escala_id
       AND dia >= p_dia_corte;

    INSERT INTO public.escala_mensal_movimentos (
        tipo, escala_mensal_id, escala_destino_id, servidor_id, mes, ano,
        unidade_origem_id, setor_origem_id, unidade_destino_id, setor_destino_id,
        dia_corte, dias_movidos, dias_com_ponto, justificativa, movido_por
    ) VALUES (
        'dividir', p_escala_id, v_nova_id, v_em.servidor_id, v_em.mes, v_em.ano,
        v_em.unidade_id, v_em.setor_id, p_unidade_destino, p_setor_destino,
        p_dia_corte, v_dias, v_com_ponto, btrim(p_justificativa), auth.uid()
    );

    RETURN jsonb_build_object(
        'ok', true,
        'tipo', 'dividir',
        'escala_id', p_escala_id,
        'escala_destino_id', v_nova_id,
        'dia_corte', p_dia_corte,
        'dias_movidos', v_dias,
        'dias_com_ponto', v_com_ponto,
        -- Duas folhas parciais no mes (decisao do usuario, 03/09/2026): a de origem precisa ser
        -- sincronizada para largar os dias que sairam, e a nova precisa ser gerada.
        'folha_sincronizar', true
    );
END;
$fn$;


-- ============================================================================
-- PRIVILEGIOS (armadilha 24)
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_pode_mover_escala_mensal(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_validar_destino_escala(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_mover_escala_mensal(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_dividir_escala_mensal(uuid, integer, uuid, uuid, text) FROM PUBLIC, anon;

-- `fn_validar_destino_escala` fica sem authenticated de proposito: nao e' chamada pela tela, so
-- de dentro das duas RPCs (que sao SECURITY DEFINER e executam com os privilegios do dono).
GRANT EXECUTE ON FUNCTION public.fn_validar_destino_escala(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_pode_mover_escala_mensal(uuid, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_mover_escala_mensal(uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dividir_escala_mensal(uuid, integer, uuid, uuid, text) TO authenticated, service_role;


-- ============================================================================
-- CORRECAO DO CASO RELATADO -- por ID EXPLICITO, nunca por criterio amplo
-- ============================================================================
-- Decisao do usuario (03/09/2026): mover 09/2026 INTEIRO para MAIS MEDICOS.
--
-- ATENCAO: isto contradiz de proposito a `data_transferencia = 09/09/2026` gravada em
-- historico_transferencias -- passa a dizer que estavam em MAIS MEDICOS desde o dia 1. O usuario
-- confirmou que e' o que quer (a lotacao ja estava errada desde o inicio do mes); a divisao no
-- dia 9 era a alternativa e foi descartada.
--
-- 08/2026 NAO e' tocada: esta Fechada, com folha Revisada. Fica no AMBULATORIO CLINICO.
--
-- Roda como o dono da migration, entao `auth.uid()` e NULL -- `movido_por` fica nulo e o
-- historico registra a justificativa abaixo. As RPCs nao sao usadas aqui porque
-- fn_pode_solicitar_excecao_carga com auth.uid() NULL ja devolveria true: o caminho e o mesmo,
-- so mais explicito sobre QUAIS quatro linhas mudam.
DO $correcao$
DECLARE
    v_origem_setor   uuid := '30d7ba9f-8a39-4733-892c-15816b270325'; -- AMBULATORIO CLINICO
    v_destino_setor  uuid := 'a465e8bd-c455-440b-840b-b94483a13d2a'; -- MAIS MEDICOS
    v_unidade        uuid := '0dbf8475-73cb-47e6-8833-e1e6ffc35bdc'; -- USF ENFERMEIRA ZEZINHA
    v_alvos          uuid[] := ARRAY[
        '94bc8432-cd4a-4607-b6a8-bc3b0bf3b06a',  -- ANDRE BARBOSA PIMENTEL DOS SANTOS
        '9b807461-8171-482b-b28b-08693d3a69d4',  -- KETHURY CHAVES BITARAES DE FREITAS
        '3076e4b4-2d7f-4042-866f-edc530ad8ab6',  -- ISAAC PRADO RAMOS
        'dcf5f276-6913-4acd-b252-c5d574ba916c'   -- MARCELO DE SOUZA CARDOSO
    ]::uuid[];
    v_id             uuid;
    v_em             record;
    v_movidas        integer := 0;
    v_dias           integer;
    v_com_ponto      integer;
BEGIN
    FOREACH v_id IN ARRAY v_alvos LOOP
        SELECT * INTO v_em FROM public.escala_mensal WHERE id = v_id FOR UPDATE;

        -- Ja movida (reaplicacao da migration) ou inexistente: segue, sem erro.
        IF NOT FOUND OR v_em.setor_id = v_destino_setor THEN
            CONTINUE;
        END IF;

        -- Nao move o que nao for exatamente o esperado -- id certo, setor errado seria pior que
        -- nao corrigir nada.
        IF v_em.setor_id <> v_origem_setor OR v_em.mes <> 9 OR v_em.ano <> 2026
        OR v_em.unidade_id <> v_unidade OR v_em.status <> 'Rascunho' THEN
            RAISE EXCEPTION
                'ABORTADO: escala % nao esta no estado esperado (setor=%, %/%, status=%).',
                v_id, v_em.setor_id, v_em.mes, v_em.ano, v_em.status;
        END IF;

        SELECT count(*), count(*) FILTER (WHERE ed.presenca_entrada_em IS NOT NULL)
          INTO v_dias, v_com_ponto
          FROM public.escala_diaria ed WHERE ed.escala_mensal_id = v_id;

        UPDATE public.escala_mensal
           SET setor_id = v_destino_setor, updated_at = now()
         WHERE id = v_id;

        INSERT INTO public.escala_mensal_movimentos (
            tipo, escala_mensal_id, servidor_id, mes, ano,
            unidade_origem_id, setor_origem_id, unidade_destino_id, setor_destino_id,
            dias_movidos, dias_com_ponto, justificativa, movido_por
        ) VALUES (
            'mover', v_id, v_em.servidor_id, v_em.mes, v_em.ano,
            v_unidade, v_origem_setor, v_unidade, v_destino_setor,
            v_dias, v_com_ponto,
            'Correcao 03/09/2026: transferencia de setor para MAIS MEDICOS nao levou a escala junto '
            '(a rotina antiga apagava os dias posteriores em vez de move-los). Movido o mes inteiro '
            'por decisao do usuario.',
            NULL
        );

        v_movidas := v_movidas + 1;
    END LOOP;

    RAISE NOTICE 'Correcao: % escala(s) de 09/2026 movidas para MAIS MEDICOS.', v_movidas;
END
$correcao$;


-- ============================================================================
-- A MIGRATION CONFERE O PROPRIO RESULTADO
-- ============================================================================
DO $verificacao$
DECLARE
    v_erradas integer;
    v_hist    integer;
BEGIN
    IF has_function_privilege('anon', 'public.fn_mover_escala_mensal(uuid, uuid, uuid, text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.fn_dividir_escala_mensal(uuid, integer, uuid, uuid, text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.fn_validar_destino_escala(uuid, uuid, uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: RPC de movimentacao de escala executavel por anon. Banco=%, usuario=%.',
            current_database(), current_user;
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.fn_mover_escala_mensal(uuid, uuid, uuid, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated sem EXECUTE em fn_mover_escala_mensal -- a tela nao conseguiria mover nada.';
    END IF;

    -- Ninguem escreve no historico por policy: se aparecer policy de escrita, a garantia de
    -- append-only pelas RPCs deixa de valer.
    IF EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'escala_mensal_movimentos'
           AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    ) THEN
        RAISE EXCEPTION 'ABORTADO: existe policy de escrita em escala_mensal_movimentos -- so as RPCs podem gravar.';
    END IF;

    SELECT count(*) INTO v_erradas
      FROM public.escala_mensal
     WHERE id IN ('94bc8432-cd4a-4607-b6a8-bc3b0bf3b06a',
                  '9b807461-8171-482b-b28b-08693d3a69d4',
                  '3076e4b4-2d7f-4042-866f-edc530ad8ab6',
                  'dcf5f276-6913-4acd-b252-c5d574ba916c')
       AND setor_id <> 'a465e8bd-c455-440b-840b-b94483a13d2a';

    IF v_erradas > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % das 4 escalas de 09/2026 nao ficaram em MAIS MEDICOS.', v_erradas;
    END IF;

    -- A policy de leitura avalia fn_pode_escalar_servidor_externo com os privilegios de QUEM
    -- consulta: sem EXECUTE para authenticated, a tabela ficaria ilegivel na tela (armadilha 39).
    IF NOT has_function_privilege('authenticated', 'public.fn_pode_escalar_servidor_externo()', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated sem EXECUTE em fn_pode_escalar_servidor_externo -- a policy de leitura do historico nunca devolveria linha.';
    END IF;

    SELECT count(*) INTO v_hist FROM public.escala_mensal_movimentos WHERE tipo = 'mover';
    RAISE NOTICE 'OK: 4 escalas em MAIS MEDICOS, % movimento(s) no historico.', v_hist;
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) A grade de USF ENFERMEIRA ZEZINHA / MAIS MEDICOS em 09/2026 tem de mostrar os 4, com os
--    dias e a presenca que estavam no AMBULATORIO CLINICO -- nada pode ter se perdido:
--      SELECT s.nome, count(ed.*) dias, count(ed.presenca_entrada_em) com_ponto
--        FROM escala_mensal em JOIN servidores s ON s.id = em.servidor_id
--        LEFT JOIN escala_diaria ed ON ed.escala_mensal_id = em.id
--       WHERE em.mes = 9 AND em.ano = 2026
--         AND em.setor_id = 'a465e8bd-c455-440b-840b-b94483a13d2a'
--       GROUP BY s.nome;
--    Esperado (medido antes de mover): ANDRE 5/1, KETHURY 5/2, ISAAC 6/1, MARCELO 3/1.
--
-- 2) 08/2026 dos quatro tem de continuar em AMBULATORIO CLINICO, Fechada, intacta.
--
-- 3) A folha de 09/2026 deles tem de seguir junto sem regerar (folha_ponto aponta para
--    escala_mensal_id e nao guarda setor):
--      SELECT servidor_id, mes, ano, status FROM folha_ponto
--       WHERE escala_mensal_id IN (...os 4 ids...);
--
-- 4) Como coordenador de um setor so: mover uma escala PARA outro setor que ele nao alcanca tem
--    de ser recusado com "e preciso poder lancar escala na origem E no destino".
--
-- 5) Mover escala de 06 ou 07/2026 (competencias encerradas) tem de ser recusado.
