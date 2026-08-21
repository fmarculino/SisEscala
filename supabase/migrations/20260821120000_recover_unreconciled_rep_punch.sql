-- Migration: recover one REP punch that was never reconciled (MESSIAS, 2026-08-17)
--
-- POR QUE ISTO EXISTE
--   A batida REP de 17/08/2026 as 08:20 (AFD NSR 268543) existe em marcacoes_ponto com dono,
--   mas a escala_diaria daquele dia ficou com ZERO passo. Consequencia: a folha de agosto ia
--   registrar FALTA para quem tem batida em AFD assinado.
--
--   A causa e datada: a ingestao do AFD so passou a chamar fn_reconciliar_marcacoes_dia na
--   migration 20260818080000, do dia 18. A batida do dia 17 entrou antes disso e nunca teve a
--   reconciliacao acionada. Nao e defeito de alocacao.
--
--   Conferido antes de escrever esta migration, com a projecao SOMENTE LEITURA
--   (fn_projecao_marcacoes_dia, que e STABLE): ela aloca 08:20 como ENTRADA e devolve
--   confirmada = true. Reconciliar apenas materializa o que a projecao ja diz — nenhum horario
--   e fabricado e nenhuma batida e descartada.
--
-- ESCOPO
--   UM par (servidor, dia), escolhido por matricula explicita. Nao ha varredura e nao ha
--   criterio amplo. Se a matricula nao existir (homologacao), a migration nao faz nada.
--
--   p_limpar_sem_marcacao fica no DEFAULT false: esta migration so ACRESCENTA o passo que a
--   projecao encontrou, nunca limpa passo existente.
--
--   Os outros dois casos da mesma varredura (IVANA 65717 dia 19, JANIA 1281 dia 20) NAO entram
--   aqui, de proposito: para eles a projecao devolve ZERO linha, ou seja, recusa a batida por
--   estar ~6h fora do turno previsto. Forcar um passo ali seria fabricar horario, o oposto do
--   que o modulo de marcacoes garante. Esses dois passam a ser sinalizados na folha como
--   pendencia de revisao, e quem decide e o coordenador (Portaria 671/2021, art. 82).

DO $$
DECLARE
    v_servidor uuid;
    v_res      jsonb;
BEGIN
    SELECT id INTO v_servidor
      FROM public.servidores
     WHERE matricula = '54007'
     LIMIT 1;

    IF v_servidor IS NULL THEN
        RAISE NOTICE 'matricula 54007 nao existe neste banco; nada a fazer';
        RETURN;
    END IF;

    v_res := public.fn_reconciliar_marcacoes_dia(v_servidor, DATE '2026-08-17');
    RAISE NOTICE 'reconciliacao 54007 2026-08-17: %', v_res;
END $$;

-- CONFERENCIA (rodar depois; deve mostrar presenca_entrada_em = 2026-08-17 08:20, origem rep)
-- SELECT s.nome, s.matricula, ed.dia, ed.presenca_entrada_em, ed.presenca_entrada_origem,
--        ed.presenca_saida_em, ed.reconciliado_em
--   FROM public.escala_diaria ed
--   JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--   JOIN public.servidores    s  ON s.id  = em.servidor_id
--  WHERE s.matricula = '54007' AND em.mes = 8 AND em.ano = 2026 AND ed.dia = 17;
