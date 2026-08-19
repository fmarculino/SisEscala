-- Migration: historico de alteracao da jornada de escala_mensal
--
-- PROBLEMA
--   escala_mensal.jornada_id nao tem vigencia: e UMA jornada por (servidor, mes). Trocar no
--   dia 12 nao muda "dali pra frente" - reescreve a premissa dos dias 1 a 11 tambem, porque
--   fn_blocos_previstos_dia, fn_confirmar_presenca e a geracao da folha leem essa coluna para
--   TODO dia do mes. E a troca nao deixava rastro nenhum: nem valor anterior, nem autor.
--
--   Medido em 19/08/2026 (producao, competencia 08/2026): das 224 escalas com batida real,
--   nenhuma apresenta quebra de horario praticado no meio do mes, e nenhuma das 145
--   mensuraveis tem a jornada desalinhada do praticado. Ou seja: o risco e estrutural, a
--   ocorrencia hoje e zero. Este historico existe para que a proxima decisao sobre o assunto
--   seja tomada com dado, e nao por inferencia sobre batidas (que foi o unico caminho
--   disponivel para chegar aos numeros acima).
--
-- POR QUE TRIGGER E RPC, E NAO SO UM DOS DOIS
--   A trigger e a rede de seguranca: pega QUALQUER troca, inclusive a do upsert da grade
--   (handleSave envia todas as linhas de escala_mensal a cada "Salvar Previsao"). O filtro
--   IS DISTINCT FROM garante que so a troca real vire linha de historico.
--   A RPC existe para carregar a JUSTIFICATIVA, que a trigger sozinha nao teria como receber:
--   ela publica o texto num GUC local a transacao e a trigger o consome. Um unico ponto de
--   gravacao do historico, dois caminhos de entrada.

-- 1. Tabela de historico
CREATE TABLE IF NOT EXISTS public.escala_mensal_jornada_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escala_mensal_id UUID NOT NULL REFERENCES public.escala_mensal(id) ON DELETE CASCADE,
    servidor_id UUID,
    mes INTEGER,
    ano INTEGER,
    jornada_anterior_id UUID REFERENCES public.jornadas(id) ON DELETE SET NULL,
    jornada_nova_id UUID REFERENCES public.jornadas(id) ON DELETE SET NULL,
    justificativa TEXT,
    alterado_por UUID,
    alterado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emjh_escala_mensal
    ON public.escala_mensal_jornada_historico (escala_mensal_id, alterado_em DESC);
CREATE INDEX IF NOT EXISTS idx_emjh_servidor_competencia
    ON public.escala_mensal_jornada_historico (servidor_id, ano, mes);

COMMENT ON TABLE public.escala_mensal_jornada_historico IS
    'Append-only. Uma linha por troca efetiva de escala_mensal.jornada_id. Escrita apenas pela '
    'trigger trg_registrar_troca_jornada; nunca por aplicacao. Trocar a jornada reescreve o '
    'horario previsto do MES INTEIRO, inclusive dias ja executados - este historico e o unico '
    'lugar onde o valor anterior sobrevive.';

COMMENT ON COLUMN public.escala_mensal_jornada_historico.justificativa IS
    'Preenchida quando a troca passou por fn_alterar_jornada_escala_mensal. NULL quando veio '
    'do upsert direto da grade.';

-- 2. Trigger que registra a troca
CREATE OR REPLACE FUNCTION public.trg_registrar_troca_jornada()
RETURNS TRIGGER AS $$
DECLARE
    v_justificativa TEXT;
BEGIN
    -- So interessa a troca efetiva. O "Salvar Previsao" da grade reenvia todas as linhas.
    IF NEW.jornada_id IS NOT DISTINCT FROM OLD.jornada_id THEN
        RETURN NEW;
    END IF;

    -- GUC local publicado por fn_alterar_jornada_escala_mensal. Ausente = troca pela grade.
    v_justificativa := NULLIF(current_setting('sisescala.justificativa_jornada', true), '');

    INSERT INTO public.escala_mensal_jornada_historico (
        escala_mensal_id, servidor_id, mes, ano,
        jornada_anterior_id, jornada_nova_id, justificativa, alterado_por
    ) VALUES (
        NEW.id, NEW.servidor_id, NEW.mes, NEW.ano,
        OLD.jornada_id, NEW.jornada_id, v_justificativa, auth.uid()
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_registrar_troca_jornada ON public.escala_mensal;
CREATE TRIGGER trg_registrar_troca_jornada
    AFTER UPDATE OF jornada_id ON public.escala_mensal
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_registrar_troca_jornada();

-- 3. RPC para a troca deliberada, com justificativa
DROP FUNCTION IF EXISTS public.fn_alterar_jornada_escala_mensal(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.fn_alterar_jornada_escala_mensal(
    p_escala_mensal_id UUID,
    p_jornada_id UUID,
    p_justificativa TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_anterior UUID;
    v_status TEXT;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RAISE EXCEPTION 'Justificativa obrigatoria para alterar a jornada de uma escala em curso.';
    END IF;

    SELECT jornada_id, status INTO v_anterior, v_status
    FROM public.escala_mensal
    WHERE id = p_escala_mensal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Escala mensal nao encontrada.';
    END IF;

    IF v_status = 'Fechada' THEN
        RAISE EXCEPTION 'Escala fechada: reabra antes de alterar a jornada.';
    END IF;

    IF p_jornada_id IS NULL THEN
        RAISE EXCEPTION 'Jornada de destino obrigatoria.';
    END IF;

    IF v_anterior IS NOT DISTINCT FROM p_jornada_id THEN
        RETURN jsonb_build_object('alterado', false, 'motivo', 'jornada ja e essa');
    END IF;

    -- Publica a justificativa para a trigger. is_local = true: morre no fim da transacao.
    PERFORM set_config('sisescala.justificativa_jornada', p_justificativa, true);

    UPDATE public.escala_mensal
    SET jornada_id = p_jornada_id,
        updated_at = now()
    WHERE id = p_escala_mensal_id;

    PERFORM set_config('sisescala.justificativa_jornada', '', true);

    RETURN jsonb_build_object(
        'alterado', true,
        'jornada_anterior_id', v_anterior,
        'jornada_nova_id', p_jornada_id
    );
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

COMMENT ON FUNCTION public.fn_alterar_jornada_escala_mensal(uuid, uuid, text) IS
    'Troca a jornada do mes REESCREVENDO o previsto de todos os dias, inclusive os ja '
    'executados. E o caminho do ENGANO ("a jornada estava errada desde o dia 1"). Para '
    'mudanca a partir de uma data (reducao judicial, acordo), o caminho e '
    'servidores_jornadas_temporarias, que e resolvida por data em obter_jornada_servidor_data. '
    'SECURITY INVOKER de proposito: a RLS de escala_mensal decide quem pode alterar.';

GRANT EXECUTE ON FUNCTION public.fn_alterar_jornada_escala_mensal(uuid, uuid, text) TO authenticated;

-- 4. RLS do historico: leitura para papeis de gestao, escrita so pela trigger
ALTER TABLE public.escala_mensal_jornada_historico ENABLE ROW LEVEL SECURITY;

-- Denylist, nao allowlist: fn_painel_sobreaviso_dia nasceu com allowlist de papel e deixou
-- 'rh' e 'rh_unidade' de fora por meses. Aqui so os papeis do Portal ficam barrados.
DROP POLICY IF EXISTS "Gestao le historico de jornada" ON public.escala_mensal_jornada_historico;
CREATE POLICY "Gestao le historico de jornada"
ON public.escala_mensal_jornada_historico
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role NOT IN ('servidor', 'comum')
    )
);

-- Nenhuma policy de INSERT/UPDATE/DELETE: a tabela e append-only e so a trigger
-- (SECURITY DEFINER) escreve nela.

GRANT SELECT ON public.escala_mensal_jornada_historico TO authenticated;

-- 5. Conferencia
-- SELECT h.alterado_em, s.nome, ja.nome AS de, jn.nome AS para, h.justificativa
--   FROM public.escala_mensal_jornada_historico h
--   LEFT JOIN public.servidores s ON s.id = h.servidor_id
--   LEFT JOIN public.jornadas ja ON ja.id = h.jornada_anterior_id
--   LEFT JOIN public.jornadas jn ON jn.id = h.jornada_nova_id
--  ORDER BY h.alterado_em DESC LIMIT 50;
