-- Migration: Proibir o mesmo servidor em DOIS setores no mesmo dia com slots sobrepostos
--
-- O PROBLEMA (medido em 26/08/2026, producao, 5 competencias, 21.031 linhas de escala_diaria)
--   fn_check_shift_conflicts existe desde sempre e detecta o caso certo, mas tinha UM UNICO
--   chamador em todo o repositorio: handleCellChange, ou seja, so a digitacao celula a celula.
--   "Aplicar Template", "Gerador Inteligente" e "Salvar Previsao" nunca a consultaram, e nao
--   existia trigger nenhum no banco. Resultado: 24 pares (servidor, dia) com a mesma pessoa
--   escalada em dois setores em horarios sobrepostos, a mesma batida projetada nas duas linhas
--   e DUAS folhas de ponto contando o mesmo tempo (CLEONEIDE: 210h + 190h em 08/2026).
--   Limpeza em 20260826210000; esta migration impede que volte a acontecer.
--
-- POR QUE NO BANCO E NAO SO NA TELA
--   Toda RPC do projeto e GRANTeada a authenticated, e a grade tem tres caminhos de escrita
--   (celula, template, gerador) mais o upsert em lote do "Salvar Previsao". Tela corrigida nao
--   protege quem chama a RPC direto, e um caminho de escrita NOVO daqui a seis meses nasce
--   desprotegido. E a mesma licao da armadilha 14 (afastamento) e da 12 (aceitar marcacao).
--
-- O CRITERIO E SLOT SOBREPOSTO, NAO "MESMO DIA"
--   Dobra em outro setor continua permitida e e caso real: medidos 9 pares cross-setor
--   ADJACENTES (ERIKA SOUZA LIMA, 09/2026, Regular MT em ENFERMEIROS + Plantao N em
--   CLASSIFICACAO DE RISCO). MT = [M,T] e N = [N] nao se cruzam, entao passam. Proibir por dia
--   quebraria a dobra que o dicionario de turnos existe para suportar (ver armadilha 15).
--
-- O GUARD DE UPDATE NAO E OTIMIZACAO, E CORRETUDE
--   handleSave faz upsert da linha INTEIRA, presenca incluida, a cada "Salvar Previsao", e mais
--   de 20 migrations tem funcoes que dao UPDATE em escala_diaria so para gravar presenca
--   (fn_confirmar_presenca, fn_reconciliar_marcacoes_dia, validacao manual...). Sem o
--   IS DISTINCT FROM, TODA batida do terminal passaria a atravessar esta checagem, e qualquer
--   linha herdada em conflito passaria a DERRUBAR O REGISTRO DE PONTO - o erro na direcao cara.
--   So mexer na identidade do turno reavalia.
--
-- ORDEM DE APLICACAO
--   Esta migration exige que 20260826210000 ja tenha rodado. Com as 24 linhas ainda no lugar,
--   os 4 setores envolvidos ficam sem conseguir salvar nada em 08/2026.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS antes do CREATE, CREATE INDEX IF NOT EXISTS.


-- ============================================================================
-- 1. INDICE DE APOIO
-- ============================================================================
-- A checagem parte de (servidor_id, mes, ano) em escala_mensal para achar as outras escalas do
-- servidor na competencia. Sem indice isso e seq scan a cada linha nova da grade.

CREATE INDEX IF NOT EXISTS idx_escala_mensal_servidor_competencia
    ON public.escala_mensal (servidor_id, mes, ano);


-- ============================================================================
-- 2. O GUARD
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_prevent_cross_sector_shift_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_slots        text[];
    v_servidor     uuid;
    v_mes          integer;
    v_ano          integer;
    v_outro_codigo text;
    v_outro_setor  text;
    v_outra_unid   text;
BEGIN
    -- So reavalia quando a IDENTIDADE do turno muda. Escrita de presenca (terminal, REP,
    -- reconciliacao, validacao manual) passa reto - ver o cabecalho desta migration.
    IF TG_OP = 'UPDATE'
       AND NEW.escala_mensal_id      IS NOT DISTINCT FROM OLD.escala_mensal_id
       AND NEW.dia                   IS NOT DISTINCT FROM OLD.dia
       AND NEW.categoria             IS NOT DISTINCT FROM OLD.categoria
       AND NEW.dicionario_turnos_id  IS NOT DISTINCT FROM OLD.dicionario_turnos_id
    THEN
        RETURN NEW;
    END IF;

    IF NEW.dicionario_turnos_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT slots INTO v_slots
      FROM public.dicionario_turnos
     WHERE id = NEW.dicionario_turnos_id;

    -- Turno sem slots definidos nao tem como sobrepor por slot. Nao inventar criterio aqui:
    -- o dicionario e a fonte, e um turno sem slot e um turno que o cadastro ainda nao descreveu.
    IF v_slots IS NULL OR array_length(v_slots, 1) IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT em.servidor_id, em.mes, em.ano
      INTO v_servidor, v_mes, v_ano
      FROM public.escala_mensal em
     WHERE em.id = NEW.escala_mensal_id;

    IF v_servidor IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT dt.codigo, ds.nome, u.nome
      INTO v_outro_codigo, v_outro_setor, v_outra_unid
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
      JOIN public.unidades u ON u.id = em.unidade_id
      JOIN public.setores s ON s.id = em.setor_id
      JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
     WHERE em.servidor_id = v_servidor
       AND em.mes = v_mes
       AND em.ano = v_ano
       AND ed.dia = NEW.dia
       AND ed.escala_mensal_id <> NEW.escala_mensal_id   -- outra escala = outro setor/unidade
       AND ed.id IS DISTINCT FROM NEW.id
       AND dt.slots && v_slots
     LIMIT 1;

    IF v_outro_codigo IS NOT NULL THEN
        RAISE EXCEPTION
            'Sobreposicao de escala: o servidor ja esta escalado no dia % com o turno % em % (%). '
            'Um servidor nao pode ocupar dois setores no mesmo horario. Remova o lancamento de la '
            'antes de escalar aqui.',
            NEW.dia, v_outro_codigo, v_outro_setor, v_outra_unid
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_prevent_cross_sector_shift_overlap() IS
    'Recusa lancamento de turno quando o mesmo servidor ja tem, no mesmo dia e competencia, '
    'turno em OUTRA escala_mensal (outro setor/unidade) com slots sobrepostos. Turnos '
    'adjacentes (dobra em outro setor) continuam permitidos. Nao reavalia escrita de presenca.';

DROP TRIGGER IF EXISTS trg_escala_diaria_sem_sobreposicao_setor ON public.escala_diaria;
CREATE TRIGGER trg_escala_diaria_sem_sobreposicao_setor
    BEFORE INSERT OR UPDATE ON public.escala_diaria
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_cross_sector_shift_overlap();


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
-- 1) O trigger tem que existir e ser BEFORE INSERT OR UPDATE:
--
--    SELECT tgname, pg_get_triggerdef(oid)
--      FROM pg_trigger
--     WHERE tgrelid = 'public.escala_diaria'::regclass
--       AND tgname = 'trg_escala_diaria_sem_sobreposicao_setor';
--
-- 2) Nao pode existir sobreposicao remanescente (se existir, a migration 20260826210000 nao
--    rodou e os setores envolvidos ficarao sem conseguir salvar):
--
--    SELECT em.servidor_id, em.mes, em.ano, ed.dia
--      FROM public.escala_diaria ed
--      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
--      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
--      JOIN public.escala_diaria ed2 ON ed2.dia = ed.dia AND ed2.escala_mensal_id <> ed.escala_mensal_id
--      JOIN public.escala_mensal em2 ON em2.id = ed2.escala_mensal_id
--       AND em2.servidor_id = em.servidor_id AND em2.mes = em.mes AND em2.ano = em.ano
--      JOIN public.dicionario_turnos dt2 ON dt2.id = ed2.dicionario_turnos_id
--     WHERE dt.slots && dt2.slots;                       -- esperado: 0 linhas
--
-- 3) A dobra ADJACENTE em outro setor tem que continuar passando. Teste vivo (nao destrutivo)
--    com a ERIKA, 09/2026 - Regular MT em ENFERMEIROS + Plantao N em CLASSIFICACAO DE RISCO:
--    reescrever a linha do Plantao N com ela mesma nao pode levantar excecao.
