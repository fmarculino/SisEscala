-- Migration: Conflict check ignores the cell being edited
-- Description: fn_check_shift_conflicts passa a aceitar p_escala_mensal_id e a excluir da busca
-- de conflito a propria celula (escala_mensal + categoria + dia) que o coordenador esta editando.
--
-- Medido em 21/08/2026 (homologacao, chamada real da RPC sobre uma linha existente de Plantao MT):
--   MT   slots [M,T] -> conflito: "Conflito com o turno MT no setor LIMPEZA (LACEM)"
--   MT4  slots [M,T] -> conflito com a mesma linha
--   MTN  slots [M,T,N] -> conflito com a mesma linha
--   N    slots [N]   -> sem conflito (nenhum slot em comum)
-- Ou seja: reescrever a celula com o MESMO codigo ja era recusado. Quem nao tinha presenca no
-- dia contornava apagando a celula, salvando e digitando de novo; com presenca registrada a
-- remocao e barrada pelo Direito Adquirido e a celula ficava impossivel de corrigir - inclusive
-- para dobra de plantao (T 13-19 emendando na noite, que o dicionario ja resolve com TN).
--
-- A deteccao de conflito real (mesmo servidor em DUAS escalas no mesmo dia com slots sobrepostos)
-- continua intacta: so a linha da propria celula sai da busca, e apenas quando o chamador informa
-- qual e. p_escala_mensal_id NULL preserva o comportamento anterior.
--
-- Copia mecanica de 20260820120000_block_all_categories_during_leave.sql via
-- scratchpad/gen_conflito_celula.js. Nao editar a mao.
--
-- DROP antes do CREATE porque a lista de argumentos muda: com CREATE OR REPLACE o Postgres
-- criaria uma SOBRECARGA, e a chamada de 6 argumentos ficaria ambigua para o PostgREST.

DROP FUNCTION IF EXISTS public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts(
    p_servidor_id UUID,
    p_dia INTEGER,
    p_mes INTEGER,
    p_ano INTEGER,
    p_turno_id UUID,
    p_categoria TEXT DEFAULT 'Regular',
    p_escala_mensal_id UUID DEFAULT NULL
)
RETURNS TABLE(conflito BOOLEAN, mensagem TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_turno_slots TEXT[];
    v_conflito_id UUID;
    v_conflito_codigo TEXT;
    v_conflito_unidade TEXT;
    v_conflito_setor TEXT;
    v_afastamento_nome TEXT;
    v_afastamento_slots TEXT[];
    v_permitir_plantao BOOLEAN;
BEGIN
    -- 1. Buscar os slots do turno proposto
    SELECT slots INTO v_turno_slots
    FROM public.dicionario_turnos
    WHERE id = p_turno_id;

    -- 2. Verificar se o servidor possui algum afastamento/evento ativo no dia especificado que conflite nos slots
    -- Afastamentos por horas (periodo_tipo = 'horas') não bloqueiam a inclusão do turno na escala
    SELECT te.nome, se.slots INTO v_afastamento_nome, v_afastamento_slots
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = p_servidor_id
      AND MAKE_DATE(p_ano, p_mes, p_dia) >= se.data_inicio
      AND MAKE_DATE(p_ano, p_mes, p_dia) <= se.data_fim
      AND COALESCE(se.periodo_tipo, 'integral') <> 'horas'
      AND se.hora_inicio IS NULL
      AND (
        se.slots IS NULL 
        OR array_length(se.slots, 1) IS NULL
        OR se.slots && v_turno_slots
      )
    LIMIT 1;

    -- Se o servidor possuir um afastamento/evento integral ou por slot conflitante
    IF v_afastamento_nome IS NOT NULL THEN
        SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir_plantao
        FROM public.configuracoes_globais
        WHERE chave = 'permitir_plantao_extra_durante_eventos';

        -- Sobreaviso entra ao lado de Regular: a configuracao chama-se
        -- "permitir plantao e extra durante eventos" e nunca foi sobre sobreaviso.
        IF p_categoria IN ('Regular', 'Sobreaviso') OR NOT v_permitir_plantao THEN
            RETURN QUERY SELECT TRUE, format('Servidor está em afastamento/evento (%s)%s.', 
                v_afastamento_nome,
                CASE 
                    WHEN v_afastamento_slots IS NOT NULL THEN format(' no período: %s', array_to_string(v_afastamento_slots, ', '))
                    ELSE ''
                END
            );
            RETURN;
        END IF;
    END IF;

    -- 3. Verificar conflito de escala diaria existente (mesmo dia, outra unidade/setor, slots sobrepostos)
    -- p_escala_mensal_id identifica a CELULA que esta sendo editada: (escala_mensal, categoria, dia)
    -- e exatamente a chave de uma celula da grade. Sem excluir essa linha, trocar o codigo de um
    -- turno ja salvo por outro que compartilhe qualquer slot faz a funcao conflitar a celula com
    -- ELA MESMA (medido em 21/08/2026: MT -> MT devolvia conflito). Com a remocao da celula
    -- bloqueada por presenca (Direito Adquirido), o dia com ponto registrado ficava congelado:
    -- nao dava para apagar nem para trocar. NULL preserva o comportamento antigo.
    SELECT 
        ed.id, 
        dt.codigo, 
        u.nome, 
        ds.nome
    INTO 
        v_conflito_id, 
        v_conflito_codigo, 
        v_conflito_unidade, 
        v_conflito_setor
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
    JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
    JOIN public.unidades u ON u.id = em.unidade_id
    JOIN public.setores s ON s.id = em.setor_id
    JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
    WHERE em.servidor_id = p_servidor_id
      AND em.mes = p_mes
      AND em.ano = p_ano
      AND ed.dia = p_dia
      AND dt.slots && v_turno_slots
      AND NOT (
          p_escala_mensal_id IS NOT NULL
          AND em.id = p_escala_mensal_id
          AND ed.categoria = p_categoria::public.escala_categoria
      )
    LIMIT 1;

    IF v_conflito_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, format('Conflito com o turno %s no setor %s (%s).', v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
        RETURN;
    END IF;

    RETURN QUERY SELECT FALSE, ''::text;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, UUID) TO authenticated, service_role;
