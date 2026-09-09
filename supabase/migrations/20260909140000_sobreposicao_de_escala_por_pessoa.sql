-- ============================================================================
-- SOBREPOSICAO DE ESCALA E POR PESSOA, NAO POR MATRICULA
-- ============================================================================
-- Gerado por scratchpad/gen_pessoa_unica_sobreposicao.js a partir das versoes VIGENTES de
-- DUAS funcoes, cada uma da sua migration. Nao editar a mao: regerar pelo script.
--
--   fn_check_shift_conflicts              <- 20260904120000
--   fn_prevent_cross_sector_shift_overlap <- 20260826220000
--
-- Par de 20260909130000 (a alocacao considera os vinculos irmaos). Esta e a que impede o caso
-- ambiguo de NASCER; aquela resolve o que ja existe.
--
-- O QUE MUDA: as duas travas passam a enxergar a PESSOA — todos os cadastros Ativos com o
-- mesmo CPF — em vez da matricula. Para quem nao tem cadastro irmao (2.477 dos 2.498 Ativos)
-- o conjunto e ele mesmo e NADA muda.
--
-- POR QUE
--
-- servidores e "1 linha = 1 vinculo", e o indice unico de CPF foi derrubado de proposito
-- (20260810140000) para permitir duas matriculas da mesma pessoa. Mas a trava de sobreposicao
-- (20260826220000) compara por servidor_id — e duas matriculas sao dois servidor_id. Entao ela
-- simplesmente NAO ENXERGAVA o caso: a mesma pessoa podia ser escalada em dois turnos no mesmo
-- horario, e nada reclamava.
--
-- Foi assim que EDILEUZA LIMA FARIAS (mat 67454 e 15892, HMI) ficou com DOIS plantoes
-- Regular N 19:00-07:00 no mesmo dia, no mesmo setor (01/09/2026).
--
-- Decisao do usuario (09/09/2026): "apesar da pessoa ter duplo vinculo essa pessoa continua
-- sendo unica, ela nao pode ser alocada em duas escalas no mesmo horario; o sistema tem que
-- rejeitar a sobreposicao tanto da escala regular como dos plantoes e sobreaviso da mesma
-- forma que esta hoje."
--
-- E ISSO E O QUE TORNA A DESAMBIGUACAO POR HORARIO CONFIAVEL: se a escala nunca sobrepoe, a
-- batida nunca fica ambigua entre os dois vinculos. As duas migrations se sustentam.
--
-- ALCANCE MEDIDO EM 09/09/2026 (21 CPFs com 2+ cadastros Ativos, competencias 06 a 10/2026):
--   89 pares (dia com turno nas DUAS matriculas)
--   85 disjuntos  -> continuam passando, sem mudanca
--    3 sem horario resolvivel -> nao bloqueiam (nao inventar criterio onde falta dado)
--    1 SOBREPOSTO -> EDILEUZA, 01/09/2026, escala em Rascunho
--
-- ⚠️ LIMPAR VEM ANTES DE LIGAR A TRAVA (armadilha 23). Com a linha sobreposta no lugar, o
-- setor envolvido nao consegue salvar nada na competencia. O unico caso da base esta em
-- Rascunho e e erro de lancamento: corrigir a escala da EDILEUZA em 01/09/2026 antes/junto.
--
-- O QUE **NAO** MUDA, e e deliberado:
--
--   * O criterio continua sendo SLOT SOBREPOSTO, nunca "mesmo dia". Dobra em turnos
--     complementares e legitima e e o caso dominante do duplo vinculo: MT 07:00-19:00 numa
--     matricula e N 19:00-07:00 na outra (40 dos 41 dias medidos). Proibir por dia quebraria
--     exatamente o arranjo que essas pessoas praticam.
--
--   * O guard de UPDATE do trigger continua: escrita de PRESENCA (terminal, REP,
--     reconciliacao, validacao manual) passa reto. Sem ele, toda batida atravessaria a
--     checagem e qualquer linha em conflito passaria a derrubar o registro de ponto.
--
--   * A exclusao da propria celula (p_escala_mensal_id, 20260821100000) continua: sem ela,
--     trocar um turno por outro que compartilhe slot conflita a celula com ela mesma.
--
-- ⚠️ A EXCLUSAO DA PROPRIA LINHA NO TRIGGER PRECISOU MUDAR. A condicao era
-- "ed.escala_mensal_id <> NEW.escala_mensal_id", com o comentario "outra escala = outro
-- setor/unidade". Isso deixou de bastar: a escala da OUTRA MATRICULA tambem tem
-- escala_mensal_id diferente — e e justamente ela que precisa conflitar. Agora a busca aceita
-- tambem a linha de outro servidor_id da mesma pessoa, e quem exclui a propria linha e
-- "ed.id IS DISTINCT FROM NEW.id", que ja estava ali.
-- ============================================================================

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
    v_afastamento_integral BOOLEAN;
    v_permitir_plantao BOOLEAN;
    v_pessoa_ids UUID[];
    v_conflito_matricula TEXT;
    v_conflito_servidor UUID;
BEGIN
    -- A PESSOA, nao a matricula. servidores e "1 linha = 1 vinculo" (o indice unico de CPF foi
    -- derrubado em 20260810140000 de proposito), entao a mesma pessoa pode ter duas matriculas.
    -- Duplo vinculo NAO autoriza estar em dois lugares no mesmo horario: a pessoa continua uma
    -- so. Sem isto a trava nao enxergava nada, porque duas matriculas sao dois servidor_id —
    -- foi assim que EDILEUZA (mat 67454 e 15892) ficou com dois plantoes N simultaneos no mesmo
    -- setor em 01/09/2026, o unico caso da base inteira (89 pares dia-a-dia medidos).
    SELECT COALESCE(array_agg(o.id), ARRAY[p_servidor_id])
      INTO v_pessoa_ids
      FROM public.servidores o
      JOIN public.servidores eu ON eu.id = p_servidor_id
     WHERE o.status = 'Ativo'
       AND o.mesclado_em_servidor_id IS NULL
       AND (
             o.id = eu.id
          OR (
             length(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g')) >= 11
         AND right(regexp_replace(COALESCE(o.cpf,  ''), '\D', '', 'g'), 11)
           = right(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g'), 11)
             )
           );

    -- 1. Buscar os slots do turno proposto
    SELECT slots INTO v_turno_slots
    FROM public.dicionario_turnos
    WHERE id = p_turno_id;

    -- 2. Afastamento/evento do dia. Afastamento por horas (periodo_tipo = 'horas') nunca bloqueia.
    -- A leitura e do DIA INTEIRO, nunca de um evento isolado: duas declaracoes de comparecimento
    -- (uma {M} e outra {T}) sao parciais uma a uma e, JUNTAS, cobrem o turno MT.
    SELECT a.nome, a.integral, a.slots
      INTO v_afastamento_nome, v_afastamento_integral, v_afastamento_slots
    FROM public.fn_afastamento_dia(p_servidor_id, MAKE_DATE(p_ano, p_mes, p_dia)) a;

    -- So bloqueia quando o afastamento ANULA o turno: integral, ou cobrindo TODOS os slots dele.
    -- Afastamento PARCIAL ({M} sobre um turno MT) deixa o servidor escalado — ele trabalha a tarde.
    IF v_afastamento_nome IS NOT NULL
       AND public.fn_afastamento_anula_turno(v_afastamento_integral, v_afastamento_slots, v_turno_slots) THEN
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
        ds.nome,
        sv.matricula,
        sv.id
    INTO
        v_conflito_id,
        v_conflito_codigo,
        v_conflito_unidade,
        v_conflito_setor,
        v_conflito_matricula,
        v_conflito_servidor
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
    JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
    JOIN public.unidades u ON u.id = em.unidade_id
    JOIN public.setores s ON s.id = em.setor_id
    JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
    JOIN public.servidores sv ON sv.id = em.servidor_id
    WHERE em.servidor_id = ANY(v_pessoa_ids)
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
        -- Mensagem PROPRIA quando o conflito vem da OUTRA MATRICULA da mesma pessoa: sem
        -- dizer isso, o coordenador le "conflito com o turno X" e vai procurar na grade dele
        -- um lancamento que nao esta la — esta na escala da outra matricula, que ele pode nem
        -- saber que existe.
        IF v_conflito_servidor IS DISTINCT FROM p_servidor_id THEN
            RETURN QUERY SELECT TRUE, format(
                'Conflito com a outra matricula desta pessoa (%s): ja esta escalada no turno %s '
                || 'em %s (%s) neste dia. A pessoa e uma so — duplo vinculo nao permite dois '
                || 'turnos no mesmo horario.',
                v_conflito_matricula, v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
            RETURN;
        END IF;
        RETURN QUERY SELECT TRUE, format('Conflito com o turno %s no setor %s (%s).', v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
        RETURN;
    END IF;

    RETURN QUERY SELECT FALSE, ''::text;
END;
$function$;

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
    v_pessoa_ids   uuid[];
    v_outra_matr   text;
    v_outro_serv   uuid;
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

    -- A PESSOA, nao a matricula. servidores e "1 linha = 1 vinculo" (o indice unico de CPF foi
    -- derrubado em 20260810140000 de proposito), entao a mesma pessoa pode ter duas matriculas.
    -- Duplo vinculo NAO autoriza estar em dois lugares no mesmo horario: a pessoa continua uma
    -- so. Sem isto a trava nao enxergava nada, porque duas matriculas sao dois servidor_id —
    -- foi assim que EDILEUZA (mat 67454 e 15892) ficou com dois plantoes N simultaneos no mesmo
    -- setor em 01/09/2026, o unico caso da base inteira (89 pares dia-a-dia medidos).
    SELECT COALESCE(array_agg(o.id), ARRAY[v_servidor])
      INTO v_pessoa_ids
      FROM public.servidores o
      JOIN public.servidores eu ON eu.id = v_servidor
     WHERE o.status = 'Ativo'
       AND o.mesclado_em_servidor_id IS NULL
       AND (
             o.id = eu.id
          OR (
             length(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g')) >= 11
         AND right(regexp_replace(COALESCE(o.cpf,  ''), '\D', '', 'g'), 11)
           = right(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g'), 11)
             )
           );


    SELECT dt.codigo, ds.nome, u.nome, sv.matricula, sv.id
      INTO v_outro_codigo, v_outro_setor, v_outra_unid, v_outra_matr, v_outro_serv
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
      JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
      JOIN public.unidades u ON u.id = em.unidade_id
      JOIN public.setores s ON s.id = em.setor_id
      JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
      JOIN public.servidores sv ON sv.id = em.servidor_id
     WHERE em.servidor_id = ANY(v_pessoa_ids)
       AND em.mes = v_mes
       AND em.ano = v_ano
       AND ed.dia = NEW.dia
       AND (
             ed.escala_mensal_id <> NEW.escala_mensal_id   -- outra escala = outro setor/unidade
          OR em.servidor_id <> v_servidor                  -- ou a outra matricula da pessoa
           )
       AND ed.id IS DISTINCT FROM NEW.id
       AND dt.slots && v_slots
     LIMIT 1;

    IF v_outro_codigo IS NOT NULL THEN
        IF v_outro_serv IS DISTINCT FROM v_servidor THEN
            RAISE EXCEPTION
                'Sobreposicao de escala: esta pessoa ja esta escalada no dia % com o turno % em % (%), '
                'pela matricula %. A pessoa e uma so — duplo vinculo nao permite dois turnos no mesmo '
                'horario. Remova o lancamento de la antes de escalar aqui.',
                NEW.dia, v_outro_codigo, v_outro_setor, v_outra_unid, v_outra_matr
                USING ERRCODE = 'check_violation';
        END IF;
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

-- A assinatura NAO muda, entao CREATE OR REPLACE preserva os privilegios (armadilha 41 so
-- morde quando a lista de parametros muda). Reafirmados assim mesmo, junto do REVOKE de
-- PUBLIC/anon que a armadilha 24 exige de toda funcao alcancavel pelo PostgREST.
REVOKE ALL ON FUNCTION public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, UUID) IS
    'Conflito de lancamento de turno: afastamento que ANULA o turno, e sobreposicao de slot com '
    'outra escala da PESSOA — todos os cadastros Ativos de mesmo CPF, nao so a matricula. Duplo '
    'vinculo nao permite dois turnos no mesmo horario. Ver 20260909140000.';

COMMENT ON FUNCTION public.fn_prevent_cross_sector_shift_overlap() IS
    'Recusa lancamento de turno quando a mesma PESSOA (qualquer cadastro Ativo de mesmo CPF) ja '
    'tem, no mesmo dia e competencia, outro turno com slot sobreposto. Turnos adjacentes (dobra) '
    'continuam permitidos. Nao reavalia escrita de presenca. Ver 20260909140000.';

-- O trigger e recriado porque a funcao mudou de corpo; a definicao em si e identica.
DROP TRIGGER IF EXISTS trg_escala_diaria_sem_sobreposicao_setor ON public.escala_diaria;
CREATE TRIGGER trg_escala_diaria_sem_sobreposicao_setor
    BEFORE INSERT OR UPDATE ON public.escala_diaria
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_cross_sector_shift_overlap();

-- ============================================================================
-- CONFERENCIA — roda junto e ABORTA a migration se qualquer assercao falhar
-- ============================================================================
-- EXECUTA fn_check_shift_conflicts (armadilha 42) contra TODAS as linhas de escala das pessoas
-- com cadastro irmao, e confere os DOIS sentidos:
--
--   (a) slot sobreposto entre as duas matriculas -> TEM de acusar conflito
--   (b) turnos complementares (MT x N) -> NAO pode acusar
--
-- Apertar demais aqui quebraria o arranjo que essas pessoas praticam (40 dos 41 dias medidos
-- sao complementares); afrouxar recria o caso que a migration existe para impedir.

DO $conf$
DECLARE
    r              record;
    v_conf         boolean;
    v_msg          text;
    v_esperado     boolean;
    v_erros        integer := 0;
    v_falsos_neg   integer := 0;
    v_falsos_pos   integer := 0;
    v_linhas       integer := 0;
    v_pessoas      integer;
BEGIN
    SELECT count(*) INTO v_pessoas
      FROM (SELECT right(regexp_replace(COALESCE(cpf, ''), '\D', '', 'g'), 11)
              FROM public.servidores
             WHERE status = 'Ativo' AND mesclado_em_servidor_id IS NULL
               AND length(regexp_replace(COALESCE(cpf, ''), '\D', '', 'g')) >= 11
             GROUP BY 1 HAVING count(*) > 1) x;
    RAISE NOTICE 'pessoas com 2+ cadastros Ativos (mesmo CPF): %', v_pessoas;

    FOR r IN
        WITH pess AS (
            SELECT s.id, right(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g'), 11) AS cpf11
              FROM public.servidores s
             WHERE s.status = 'Ativo' AND s.mesclado_em_servidor_id IS NULL
               AND length(regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g')) >= 11
        ),
        dup AS (SELECT cpf11 FROM pess GROUP BY cpf11 HAVING count(*) > 1)
        SELECT ed.id, ed.dia, ed.categoria::text AS categoria, ed.dicionario_turnos_id,
               em.mes, em.ano, em.servidor_id, em.id AS escala_mensal_id,
               p.cpf11, dt.slots
          FROM public.escala_diaria ed
          JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
          JOIN pess p ON p.id = em.servidor_id
          JOIN dup ON dup.cpf11 = p.cpf11
          JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
         WHERE ed.dicionario_turnos_id IS NOT NULL
           AND dt.slots IS NOT NULL
    LOOP
        v_linhas := v_linhas + 1;

        -- O que a verdade diz: existe linha de OUTRA matricula da mesma pessoa, no mesmo dia e
        -- competencia, com slot sobreposto?
        SELECT EXISTS (
            SELECT 1
              FROM public.escala_diaria ed2
              JOIN public.escala_mensal em2 ON em2.id = ed2.escala_mensal_id
              JOIN public.servidores s2 ON s2.id = em2.servidor_id
              JOIN public.dicionario_turnos dt2 ON dt2.id = ed2.dicionario_turnos_id
             WHERE s2.status = 'Ativo'
               AND s2.mesclado_em_servidor_id IS NULL
               AND right(regexp_replace(COALESCE(s2.cpf, ''), '\D', '', 'g'), 11) = r.cpf11
               AND em2.servidor_id <> r.servidor_id
               AND em2.mes = r.mes AND em2.ano = r.ano
               AND ed2.dia = r.dia
               AND dt2.slots && r.slots
        ) INTO v_esperado;

        BEGIN
            SELECT c.conflito, c.mensagem INTO v_conf, v_msg
              FROM public.fn_check_shift_conflicts(
                       r.servidor_id, r.dia, r.mes, r.ano,
                       r.dicionario_turnos_id, r.categoria, r.escala_mensal_id) c;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'ABORTADO: fn_check_shift_conflicts falhou (servidor %, dia %/%/%): %',
                            r.servidor_id, r.dia, r.mes, r.ano, SQLERRM;
        END;

        -- Afastamento tambem devolve conflito, e ele nao e o que se mede aqui: so conta como
        -- falso positivo o conflito que fala de OUTRA MATRICULA.
        IF v_esperado AND NOT COALESCE(v_conf, false) THEN
            v_falsos_neg := v_falsos_neg + 1;
            RAISE WARNING 'NAO ACUSOU sobreposicao: servidor % dia %/%/% (cpf %)',
                          r.servidor_id, r.dia, r.mes, r.ano, r.cpf11;
        ELSIF NOT v_esperado AND COALESCE(v_conf, false)
              AND v_msg LIKE '%outra matricula%' THEN
            v_falsos_pos := v_falsos_pos + 1;
            RAISE WARNING 'ACUSOU A TOA: servidor % dia %/%/% -> %',
                          r.servidor_id, r.dia, r.mes, r.ano, v_msg;
        END IF;
    END LOOP;

    v_erros := v_falsos_neg + v_falsos_pos;
    RAISE NOTICE 'linhas conferidas: % | falsos negativos: % | falsos positivos: %',
                 v_linhas, v_falsos_neg, v_falsos_pos;

    IF v_falsos_neg > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % linha(s) com sobreposicao real entre matriculas da mesma '
                        'pessoa NAO foram acusadas. A trava por pessoa nao esta valendo.', v_falsos_neg;
    END IF;
    IF v_falsos_pos > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % linha(s) de turnos COMPLEMENTARES foram acusadas como '
                        'sobreposicao. Isso quebraria o arranjo MT x N que o duplo vinculo '
                        'pratica — o criterio precisa continuar sendo SLOT sobreposto.', v_falsos_pos;
    END IF;
END;
$conf$;

-- ============================================================================
-- ⚠️ DEPOIS DE APLICAR: a linha ja sobreposta continua no banco
-- ============================================================================
-- O trigger e BEFORE INSERT OR UPDATE: ele nao apaga o que ja existe, so recusa o proximo
-- lancamento. Enquanto a linha sobreposta estiver la, o setor dela nao consegue salvar aquela
-- celula. Para listar o que precisa de correcao manual na grade:
--
--   WITH pess AS (
--     SELECT s.id, right(regexp_replace(COALESCE(s.cpf,''), '\D','','g'), 11) AS cpf11
--       FROM public.servidores s
--      WHERE s.status = 'Ativo' AND s.mesclado_em_servidor_id IS NULL
--        AND length(regexp_replace(COALESCE(s.cpf,''), '\D','','g')) >= 11)
--   SELECT a.servidor_id, b.servidor_id, em.ano, em.mes, ed.dia
--     FROM public.escala_diaria ed
--     JOIN public.escala_mensal em  ON em.id  = ed.escala_mensal_id
--     JOIN pess a ON a.id = em.servidor_id
--     JOIN pess b ON b.cpf11 = a.cpf11 AND b.id <> a.id
--     JOIN public.escala_mensal em2 ON em2.servidor_id = b.id
--          AND em2.mes = em.mes AND em2.ano = em.ano
--     JOIN public.escala_diaria ed2 ON ed2.escala_mensal_id = em2.id AND ed2.dia = ed.dia
--     JOIN public.dicionario_turnos t1 ON t1.id = ed.dicionario_turnos_id
--     JOIN public.dicionario_turnos t2 ON t2.id = ed2.dicionario_turnos_id
--    WHERE t1.slots && t2.slots;
--
-- Em 09/09/2026 isso devolvia UM caso: EDILEUZA LIMA FARIAS (mat 67454 x 15892), 01/09/2026,
-- dois plantoes Regular N no mesmo setor do HMI, escala em Rascunho.
