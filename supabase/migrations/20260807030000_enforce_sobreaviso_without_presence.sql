-- Migration: Barreira definitiva - Sobreaviso nunca carrega marca de presenca
-- Data: 2026-08-07
--
-- POR QUE UMA CONSTRAINT
--   As correcoes em fn_confirmar_presenca e fn_confirmar_presenca_manual (20260807020000)
--   resolvem os caminhos conhecidos. Mas este projeto ja perdeu logica critica DUAS vezes
--   ao recriar essas funcoes com CREATE OR REPLACE (ver .agents/AGENTS.md):
--     - 04/08/2026: alinhamento dinamico de hora extra
--     - 20260804080000: guard de intervalo intrajornada
--   Uma constraint nao depende de ninguem lembrar de preserva-la ao recopiar a funcao,
--   e vale para QUALQUER caminho de escrita - inclusive UPDATE manual no SQL editor.
--
-- REGRA
--   Linha de escala_diaria com categoria 'Sobreaviso' nao pode ter nenhum campo de presenca
--   preenchido. O ciclo do sobreaviso (acionamento / aceite / chegada) vive em logs_sobreaviso.
--
-- LIMPEZA PREVIA
--   Em 07/08/2026 restavam 2 linhas em producao (FERNANDO MARCULINO, dias 3 e 4 de 08/2026)
--   com batidas de terminal que cairam na linha de Sobreaviso. Os turnos Regular desses dias
--   estao completos e intactos (08:04->18:00 e 08:23->18:00), e a folha de ponto le apenas
--   Regular e Extra - portanto a limpeza nao altera nenhuma folha.

DO $$
DECLARE
    v_limpos INTEGER := 0;
BEGIN
    UPDATE public.escala_diaria
    SET presenca_entrada_em            = NULL,
        presenca_entrada_manual        = false,
        presenca_saida_em              = NULL,
        presenca_saida_manual          = false,
        presenca_intervalo_saida_em    = NULL,
        presenca_intervalo_saida_manual = false,
        presenca_intervalo_retorno_em  = NULL,
        presenca_intervalo_retorno_manual = false,
        presenca_confirmada            = false
    WHERE categoria::text = 'Sobreaviso'
      AND (presenca_entrada_em IS NOT NULL
        OR presenca_saida_em IS NOT NULL
        OR presenca_intervalo_saida_em IS NOT NULL
        OR presenca_intervalo_retorno_em IS NOT NULL);

    GET DIAGNOSTICS v_limpos = ROW_COUNT;
    RAISE NOTICE 'Linhas de Sobreaviso com marca de presenca removida: %', v_limpos;
END;
$$;


-- Barreira permanente
ALTER TABLE public.escala_diaria
    DROP CONSTRAINT IF EXISTS chk_sobreaviso_sem_presenca;

ALTER TABLE public.escala_diaria
    ADD CONSTRAINT chk_sobreaviso_sem_presenca CHECK (
        categoria::text <> 'Sobreaviso'
        OR (
            presenca_entrada_em IS NULL
            AND presenca_saida_em IS NULL
            AND presenca_intervalo_saida_em IS NULL
            AND presenca_intervalo_retorno_em IS NULL
        )
    );

COMMENT ON CONSTRAINT chk_sobreaviso_sem_presenca ON public.escala_diaria IS
    'Sobreaviso nao marca presenca. Acionamento, aceite e chegada ficam em logs_sobreaviso.';


-- CONSULTA DE CONFERENCIA (deve retornar zero linhas)
--
-- SELECT s.nome, em.ano, em.mes, ed.dia, ed.presenca_entrada_em, ed.presenca_saida_em
-- FROM escala_diaria ed
-- JOIN escala_mensal em ON ed.escala_mensal_id = em.id
-- JOIN servidores s ON em.servidor_id = s.id
-- WHERE ed.categoria::text = 'Sobreaviso'
--   AND (ed.presenca_entrada_em IS NOT NULL OR ed.presenca_saida_em IS NOT NULL
--     OR ed.presenca_intervalo_saida_em IS NOT NULL OR ed.presenca_intervalo_retorno_em IS NOT NULL);
