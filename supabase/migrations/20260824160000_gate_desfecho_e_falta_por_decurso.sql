-- Migration: a chave que liga o gate de desfecho e a falta por decurso de prazo
-- Data: 2026-08-24
-- Plano: docs/planos/2026-08-23-desfecho-de-plantao-e-sobreaviso.md (fase 5)
--
-- O QUE ESTA CHAVE CONTROLA
--   Duas coisas, de proposito ligadas ao mesmo interruptor:
--
--   1. O GATE — fechar escala e fechar folha passam a recusar competencia com plantao ou
--      sobreaviso `em_avaliacao`.
--   2. A FALTA POR DECURSO — o auto-fechamento converte em `falta` o que ninguem decidiu
--      (decisao do usuario em 23/08/2026, secao 5.1 do plano).
--
--   Uma sem a outra nao faz sentido. So o gate deixaria folhas abertas para sempre quando
--   ninguem justificasse; so o decurso produziria faltas que o coordenador nunca teve
--   oportunidade de evitar, porque nada o teria impedido de fechar antes.
--
-- 🚨 NASCE DESLIGADA, E ISSO NAO E CAUTELA GENERICA
--   Medido em producao em 24/08/2026, competencia 08/2026: 132 plantoes estao `em_avaliacao`
--   (1.389h). Ligar o gate hoje travaria o fechamento de agosto inteiro, e ligar o decurso
--   converteria esses 132 em falta sem ninguem ter olhado nenhum.
--
--   A maior parte deles nao e conduta: e batida de transicao recusada pelo terminal (armadilha
--   6 do CLAUDE.md - fn_confirmar_presenca nao tem os slots de fronteira, entao quem bate na
--   emenda de dois turnos leva recusa) e plantao emendado ao Regular. Transformar isso em falta
--   automatica seria acusar servidor por defeito conhecido do sistema.
--
--   ORDEM OBRIGATORIA: (a) telas e classificacao [feito, v2.14.0 a v2.16.0], (b) a fila de
--   agosto tratada pelos coordenadores, (c) so entao ligar esta chave.
--
-- ⚠️ O PRAZO QUE IMPORTA
--   O auto-fechamento so alcanca escala/folha expirada: fim do mes + `dias_inativacao_automatica`
--   (5 dias). Para 08/2026 isso e 05/09/2026. A fila tem ate la para ser tratada - depois disso,
--   com a chave ligada, o que sobrar vira falta por decurso.

BEGIN;

INSERT INTO public.configuracoes_globais (chave, valor, descricao)
VALUES (
    'desfecho_obrigatorio_fechar',
    'false'::jsonb,
    'Exige desfecho (validado ou falta) de todo plantao/sobreaviso antes de fechar escala e '
    'folha, e faz o auto-fechamento converter em falta por decurso de prazo o que ninguem '
    'decidiu. Nasce FALSE: ligar antes de tratar a fila trava o fechamento da competencia.'
)
ON CONFLICT (chave) DO NOTHING;

COMMIT;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar; nao faz parte da migration)
-- ============================================================================
--
-- 1. A chave existe e esta DESLIGADA:
--
--    SELECT chave, valor FROM public.configuracoes_globais
--     WHERE chave = 'desfecho_obrigatorio_fechar';
--    -- esperado: false
--
-- 2. QUANTO FALTA TRATAR ANTES DE LIGAR (por unidade/setor):
--
--    SELECT u.nome AS unidade, ds.nome AS setor,
--           count(*) FILTER (WHERE d.estado = 'em_avaliacao') AS em_avaliacao,
--           count(*) FILTER (WHERE d.estado = 'falta')        AS faltas
--      FROM public.escala_mensal em
--      JOIN public.unidades u ON u.id = em.unidade_id
--      LEFT JOIN public.setores st ON st.id = em.setor_id
--      LEFT JOIN public.dicionario_setores ds ON ds.id = st.dicionario_setores_id
--      CROSS JOIN LATERAL public.fn_desfecho_eventos_escalas(ARRAY[em.id], public.fn_data_local()) d
--     WHERE em.mes = 8 AND em.ano = 2026 AND em.ativo IS TRUE
--     GROUP BY u.nome, ds.nome
--    HAVING count(*) FILTER (WHERE d.estado = 'em_avaliacao') > 0
--     ORDER BY em_avaliacao DESC;
--
--    Ligar a chave so quando esta consulta voltar vazia para a competencia corrente.
--
-- 3. PARA LIGAR, quando a fila estiver tratada:
--
--    UPDATE public.configuracoes_globais
--       SET valor = 'true'::jsonb, updated_at = now()
--     WHERE chave = 'desfecho_obrigatorio_fechar';
