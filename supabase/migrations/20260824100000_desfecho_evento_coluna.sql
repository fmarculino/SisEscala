-- Migration: desfecho do evento (plantao / sobreaviso) em justificativas_eventos
-- Data: 2026-08-24
-- Plano: docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md (fase 0, migration 1 de 3)
--
-- MOTIVACAO
--   O anexo "Demonstrativo de Plantoes e Sobreavisos" e comprobatorio - e o que o servidor
--   assina e o que o RH usa para pagar a unidade de plantao. Hoje ele soma o que foi ESCALADO,
--   nao o que foi cumprido: `totalHorasPlantao` e um reduce sobre todas as linhas
--   (folha-ponto/actions.ts:2572), e a linha sem batida sai apenas com o texto "Em validacao".
--
--   Medido em producao em 23/08/2026, competencia 08/2026, dias 1 a 22:
--     217 plantoes, 2.107h somadas no anexo
--       86 com entrada E saida   ->   730h
--       70 com so um dos dois    ->   723h
--       61 sem registro nenhum   ->   654h
--   Ou seja: 65% das horas impressas (1.377h) nao tem registro completo.
--
--   Caso concreto: ANDRESA MELO PEREIRA (mat. 54594), 08/2026. Dias 01 e 08 tem Plantao MT de
--   12h e zero batida. A folha de ponto grava "SABADO" e total_faltas = 0 (a folha busca o turno
--   do dia so na categoria Regular, folha-ponto/actions.ts:656), enquanto o anexo conta as 24h
--   dentro das 120h. Os dois documentos da mesma pessoa, no mesmo mes, se contradizem.
--
-- O QUE ESTA MIGRATION FAZ
--   Da ao evento um DESFECHO explicito, que nao existia: `validado` (foi cumprido) ou `falta`
--   (nao foi cumprido). A ausencia de desfecho passa a ser um estado com nome - "em avaliacao" -
--   em vez de silencio somado ao total.
--
--   A classificacao em si (o que conta como "registrado" sem intervencao humana, o que fica em
--   avaliacao, o que ja nasce falta) vive na migration 3, fn_desfecho_evento_dia. Aqui so a
--   estrutura.
--
-- POR QUE EM justificativas_eventos, E NAO EM TABELA NOVA
--   A tabela ja tem exatamente a granularidade do evento
--   (UNIQUE (servidor_id, dia, mes, ano, categoria)), ja tem origem/status/validador, e ja e
--   lida pelo anexo (folha-ponto/actions.ts, passo 5) e pela fila (/justificativas). Tabela nova
--   duplicaria a chave e criaria uma segunda verdade sobre o mesmo par (servidor, dia).
--
-- ATENCAO: A CHAVE UNICA NAO INCLUI escala_mensal_id
--   Um servidor com Plantao em DUAS escalas mensais no mesmo dia (dobra em unidades diferentes)
--   so consegue um desfecho para os dois. E limitacao pre-existente da constraint
--   uq_justificativa_evento (20260805000000), nao introduzida aqui. Medido em 08/2026: 0 casos.
--   Fica registrado, nao tratado.

BEGIN;

-- ============================================================================
-- 1. O DESFECHO
-- ============================================================================

ALTER TABLE public.justificativas_eventos
    ADD COLUMN IF NOT EXISTS resultado                  text,
    ADD COLUMN IF NOT EXISTS resultado_origem           text,
    ADD COLUMN IF NOT EXISTS resultado_definido_por_id  uuid REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS resultado_definido_por_nome text,
    ADD COLUMN IF NOT EXISTS resultado_definido_em      timestamptz;

-- NULL de proposito, NUNCA DEFAULT 'validado'.
--
-- As 51 justificativas que existem em producao foram escritas como MOTIVACAO do servico
-- extraordinario ("Plantao de Reforco em Finais de Semana"), nao como atestado de cumprimento -
-- ninguem tomou a decisao que esta coluna representa. Um DEFAULT 'validado' afirmaria, em nome
-- do coordenador, que plantoes sem registro completo foram cumpridos.
--
-- Medido em 08/2026, das 27 justificativas de Plantao: 21 estao em dia com registro completo
-- (continuam somando por conta do proprio ponto, sem precisar de decisao), 2 em dia parcial e
-- 4 em dia sem registro nenhum. Com NULL, apenas esses 6 exigem decisao humana.
ALTER TABLE public.justificativas_eventos
    DROP CONSTRAINT IF EXISTS chk_justificativa_resultado;
ALTER TABLE public.justificativas_eventos
    ADD CONSTRAINT chk_justificativa_resultado
    CHECK (resultado IS NULL OR resultado IN ('validado', 'falta'));

-- 'coordenador'      - alguem decidiu na fila de /justificativas
-- 'decurso_de_prazo' - o auto-fechamento converteu em falta o que ninguem decidiu
--                      (decisao do usuario em 23/08/2026, secao 5.1 do plano)
--
-- Quem reverte PRECISA distinguir os dois: "o coordenador decidiu que faltou" e "ninguem decidiu
-- e o prazo venceu" sao afirmacoes diferentes diante do servidor.
ALTER TABLE public.justificativas_eventos
    DROP CONSTRAINT IF EXISTS chk_justificativa_resultado_origem;
ALTER TABLE public.justificativas_eventos
    ADD CONSTRAINT chk_justificativa_resultado_origem
    CHECK (resultado_origem IS NULL OR resultado_origem IN ('coordenador', 'decurso_de_prazo'));

-- Desfecho sem autor e desfecho sem dono. Vale para os dois valores: `falta` porque e registro
-- sobre conduta de servidor publico, `validado` porque substitui a prova do relogio.
ALTER TABLE public.justificativas_eventos
    DROP CONSTRAINT IF EXISTS chk_justificativa_resultado_tem_autor;
ALTER TABLE public.justificativas_eventos
    ADD CONSTRAINT chk_justificativa_resultado_tem_autor
    CHECK (
        resultado IS NULL
        OR (resultado_origem IS NOT NULL AND resultado_definido_em IS NOT NULL)
    );

COMMENT ON COLUMN public.justificativas_eventos.resultado IS
    'Desfecho do evento: validado (cumprido) ou falta (nao cumprido). NULL = ninguem decidiu - '
    'o estado do evento entao vem de fn_desfecho_evento_dia, que pode devolver registrado (o '
    'ponto ja provou), em_avaliacao ou falta. Nao replicar essa regra no frontend.';

COMMENT ON COLUMN public.justificativas_eventos.resultado_origem IS
    'Como o desfecho foi produzido: coordenador (decisao na fila) ou decurso_de_prazo (o '
    'auto-fechamento converteu em falta o que ninguem decidiu). Reverter uma falta de decurso e '
    'diferente de reverter uma decisao humana, e a tela precisa dizer qual e qual.';

-- Indice parcial: a consulta que importa e "quem esta com falta neste mes/unidade", nunca a
-- tabela inteira. Falta e minoria por construcao.
DROP INDEX IF EXISTS public.idx_justificativas_eventos_falta;
CREATE INDEX idx_justificativas_eventos_falta
    ON public.justificativas_eventos (unidade_id, ano, mes, categoria)
    WHERE resultado = 'falta';


-- ============================================================================
-- 2. HISTORICO APPEND-ONLY DO DESFECHO
-- ============================================================================
--
-- Marcar falta e desmarcar falta sao decisoes sobre a conduta de um servidor publico. Nenhuma
-- das duas pode ser um UPDATE anonimo. Mesmo desenho de escala_diaria_turno_historico
-- (20260821110000): a tabela e escrita SO por trigger, nunca por aplicacao - assim o
-- auto-fechamento, a RPC da fila e qualquer UPDATE direto caem todos no mesmo registro.

CREATE TABLE IF NOT EXISTS public.justificativas_eventos_desfecho_historico (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    justificativa_id      uuid REFERENCES public.justificativas_eventos(id) ON DELETE CASCADE,
    servidor_id           uuid,
    escala_mensal_id      uuid,
    unidade_id            uuid,
    setor_id              uuid,
    dia                   integer,
    mes                   integer,
    ano                   integer,
    categoria             text,
    resultado_anterior    text,
    resultado_novo        text,
    origem_anterior       text,
    origem_nova           text,
    motivo                text,
    alterado_por          uuid,
    alterado_por_nome     text,
    alterado_em           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.justificativas_eventos_desfecho_historico IS
    'Trilha append-only de toda mudanca de justificativas_eventos.resultado. Escrita apenas pela '
    'trigger trg_registrar_desfecho_evento; nunca por aplicacao. resultado_anterior NULL = '
    'primeira decisao sobre o evento; resultado_novo NULL = desfecho apagado (volta a em '
    'avaliacao).';

CREATE INDEX IF NOT EXISTS idx_desfecho_historico_evento
    ON public.justificativas_eventos_desfecho_historico (justificativa_id, alterado_em DESC);
CREATE INDEX IF NOT EXISTS idx_desfecho_historico_servidor
    ON public.justificativas_eventos_desfecho_historico (servidor_id, ano, mes);

-- O motivo da mudanca chega pelo GUC, no mesmo padrao de sisescala.justificativa_turno
-- (20260821110000): a RPC publica, a trigger le. Ausente = mudanca por outro caminho, e a
-- trilha registra isso como motivo nulo em vez de perder a linha.
CREATE OR REPLACE FUNCTION public.trg_registrar_desfecho_evento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trg$
DECLARE
    v_motivo          text;
    v_autor           uuid;
    v_res_anterior    text := NULL;
    v_origem_anterior text := NULL;
BEGIN
    -- OLD so pode ser tocado dentro de um IF que ja garantiu TG_OP = 'UPDATE'. Em trigger de
    -- INSERT o registro OLD nao esta atribuido, e ler OLD.campo levanta erro em plpgsql - a
    -- garantia de curto-circuito de AND/CASE nao e' documentada, entao a checagem e aninhada
    -- em vez de combinada.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.resultado IS NOT DISTINCT FROM OLD.resultado
           AND NEW.resultado_origem IS NOT DISTINCT FROM OLD.resultado_origem THEN
            RETURN NEW;
        END IF;
        v_res_anterior    := OLD.resultado;
        v_origem_anterior := OLD.resultado_origem;
    ELSE
        -- INSERT ja nascendo sem desfecho nao e' evento nenhum: e' a justificativa motivacional
        -- de sempre, que este historico nao registra.
        IF NEW.resultado IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    v_motivo := NULLIF(btrim(COALESCE(current_setting('sisescala.motivo_desfecho', true), '')), '');
    v_autor  := COALESCE(NEW.resultado_definido_por_id, auth.uid());

    INSERT INTO public.justificativas_eventos_desfecho_historico (
        justificativa_id, servidor_id, escala_mensal_id, unidade_id, setor_id,
        dia, mes, ano, categoria,
        resultado_anterior, resultado_novo, origem_anterior, origem_nova,
        motivo, alterado_por, alterado_por_nome
    ) VALUES (
        NEW.id, NEW.servidor_id, NEW.escala_mensal_id, NEW.unidade_id, NEW.setor_id,
        NEW.dia, NEW.mes, NEW.ano, NEW.categoria,
        v_res_anterior, NEW.resultado,
        v_origem_anterior, NEW.resultado_origem,
        v_motivo, v_autor, NEW.resultado_definido_por_nome
    );

    RETURN NEW;
END;
$trg$;

DROP TRIGGER IF EXISTS trg_registrar_desfecho_evento ON public.justificativas_eventos;
CREATE TRIGGER trg_registrar_desfecho_evento
    AFTER INSERT OR UPDATE OF resultado, resultado_origem ON public.justificativas_eventos
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_registrar_desfecho_evento();

-- Historico e leitura de auditoria; escrita e exclusiva da trigger (SECURITY DEFINER passa por
-- cima da RLS). Sem policy de INSERT/UPDATE/DELETE de proposito.
ALTER TABLE public.justificativas_eventos_desfecho_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura desfecho historico" ON public.justificativas_eventos_desfecho_historico;
CREATE POLICY "Leitura desfecho historico"
    ON public.justificativas_eventos_desfecho_historico
    FOR SELECT TO authenticated
    USING (
        (SELECT get_my_role()) = ANY (ARRAY[
            'super_admin'::user_role, 'rh'::user_role, 'rh_unidade'::user_role,
            'admin'::user_role, 'coordenador'::user_role, 'ass_adm'::user_role
        ])
    );

COMMIT;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao faz parte da migration)
-- ============================================================================
--
-- 1. Nenhum desfecho foi inventado pelo backfill - o esperado e ZERO em todas as linhas:
--
--    SELECT count(*) FILTER (WHERE resultado IS NOT NULL) AS com_desfecho,
--           count(*)                                      AS total
--      FROM public.justificativas_eventos;
--    -- esperado: com_desfecho = 0, total = 51 (medido em 23/08/2026)
--
-- 2. O historico nasce vazio (a trigger so grava mudanca de resultado):
--
--    SELECT count(*) FROM public.justificativas_eventos_desfecho_historico;
--    -- esperado: 0
--
-- 3. Os 6 eventos de 08/2026 que vao precisar de decisao humana - justificativa ja escrita, mas
--    em dia SEM registro completo de ponto:
--
--    SELECT je.dia, je.categoria, s.nome
--      FROM public.justificativas_eventos je
--      JOIN public.servidores s ON s.id = je.servidor_id
--     WHERE je.mes = 8 AND je.ano = 2026 AND je.categoria ILIKE 'plant%'
--       AND EXISTS (
--             SELECT 1
--               FROM public.escala_diaria ed
--               JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--              WHERE em.servidor_id = je.servidor_id AND em.mes = je.mes AND em.ano = je.ano
--                AND ed.dia = je.dia AND ed.categoria::text ILIKE 'plant%'
--                AND (ed.presenca_entrada_em IS NULL OR ed.presenca_saida_em IS NULL)
--           )
--     ORDER BY je.dia;
--    -- esperado: 6 linhas (2 em dia parcial, 4 em dia sem registro nenhum)
