-- Migration: corrige fn_gerar_resumos_aviso_ponto - nunca gerou um resumo sequer
-- Data: 2026-08-11
--
-- CONTEXTO
--   Medido em 11/08/2026: zero linhas tipo IN ('resumo_diario','resumo_semanal') em
--   avisos_ponto_fila desde que a feature existe (v1.29.0, 09/08/2026), apesar de haver dado
--   elegivel havia dias (ex.: FERNANDO MARCULINO GUIMARAES JUNIOR, opt-in confirmado em
--   09/08 22:29, com pelo menos 3 dias de turno completo - entrada e saida - dentro da janela
--   de retroatividade de 3 dias). Chamada direta da RPC devolve 0, sem erro visivel.
--
--   A funcao tem `EXCEPTION WHEN OTHERS THEN RETURN 0` (proposital - "nao pode derrubar o
--   worker") mas isso tambem esconde qualquer erro real que esteja acontecendo. Suspeita: a
--   query DIARIA agrupa por uma EXPRESSAO (`(ed.presenca_entrada_em AT TIME ZONE v_timezone)::date`,
--   posicao 5 do GROUP BY) e depois repete essa mesma expressao crua no HAVING e dentro de uma
--   subquery correlacionada (NOT EXISTS) - o casamento textual entre SELECT/HAVING e a expressao
--   do GROUP BY e permitido pelo Postgres na mesma query, mas a subquery correlacionada e mais
--   fragil a esse padrao.
--
--   Reescrita com CTE: computa `dia` como coluna material antes de agrupar, agrupa por essa
--   coluna (nao por expressao repetida), e o filtro pos-agregacao passa a ser um WHERE simples
--   sobre colunas ja agrupadas, sem nenhuma expressao raw nem correlacao ambigua. Elimina a
--   classe inteira do problema, independente de qual sintaxe exata estava falhando.
--
--   A secao SEMANAL nao tem GROUP BY (um SELECT por servidor, sem agregacao) - nao sofre do
--   mesmo padrao, entra aqui inalterada.
--
--   Erro (se houver de novo) passa a ficar visivel: o EXCEPTION grava em logs_sistema antes de
--   devolver 0, em vez de so RAISE WARNING (que ninguem le sem acesso ao log do container).

CREATE OR REPLACE FUNCTION public.fn_gerar_resumos_aviso_ponto()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_timezone  text;
    v_hoje      date;
    v_agora     timestamp;
    v_seg_ant   date;
    v_row       record;
    v_dia       record;
    v_linhas    text;
    v_msg       text;
    v_tel       text;
    v_qtd       integer := 0;
    v_incompleto boolean;
BEGIN
    SELECT (valor#>>'{}')::text INTO v_timezone
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    v_agora := now() AT TIME ZONE v_timezone;
    v_hoje  := v_agora::date;

    -- ------------------------------------------------------------------ DIARIO
    -- AGREGADO POR (servidor, dia), nao por linha de escala_diaria: um servidor pode ter DUAS
    -- linhas no mesmo dia (Regular + Plantao, por exemplo). Percorrer linha a linha produziria um
    -- resumo com so um dos turnos - e o indice unico engoliria o outro em silencio, que e o pior
    -- resultado: mensagem entregue, incompleta, e sem rastro do que faltou.
    -- Primeira entrada e ultima saida do dia; o intervalo vem do turno em que foi marcado.
    --
    -- `dia` vira coluna material na CTE `base` e o agrupamento (`agrupado`) e por essa coluna, nao
    -- por uma expressao repetida em HAVING/subquery - ver cabecalho desta migration.
    FOR v_row IN
        WITH base AS (
            SELECT s.id AS servidor_id, s.nome AS nome, u.id AS unidade_id, u.nome AS unidade_nome,
                   (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date AS dia,
                   ed.presenca_entrada_em, ed.presenca_intervalo_saida_em,
                   ed.presenca_intervalo_retorno_em, ed.presenca_saida_em
              FROM public.escala_diaria ed
              JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
              JOIN public.servidores    s  ON s.id  = em.servidor_id
              JOIN public.unidades      u  ON u.id  = em.unidade_id
             WHERE s.aviso_ponto_status = 'ativo'
               AND s.aviso_ponto_modo   = 'resumo_diario'
               AND public.fn_aviso_ponto_habilitado(em.unidade_id, em.setor_id)
               AND ed.presenca_entrada_em IS NOT NULL
               -- limite de retroatividade: ligar o recurso nao pode despejar meses de resumo
               AND ed.presenca_entrada_em > now() - interval '3 days'
        ),
        agrupado AS (
            -- uuid nao tem MIN/MAX de fabrica no Postgres - mesmo contorno via text que a versao
            -- anterior ja usava (min(u.id::text)::uuid), preservado aqui.
            SELECT servidor_id, min(nome) AS nome, min(unidade_id::text)::uuid AS unidade_id,
                   min(unidade_nome) AS unidade_nome, dia,
                   min(presenca_entrada_em)           AS presenca_entrada_em,
                   min(presenca_intervalo_saida_em)   AS presenca_intervalo_saida_em,
                   max(presenca_intervalo_retorno_em) AS presenca_intervalo_retorno_em,
                   max(presenca_saida_em)             AS presenca_saida_em,
                   bool_or(presenca_saida_em IS NOT NULL)  AS tem_saida,
                   bool_and(presenca_saida_em IS NOT NULL) AS todas_com_saida
              FROM base
             GROUP BY servidor_id, dia
        )
        SELECT a.servidor_id, a.nome, a.unidade_id, a.unidade_nome, a.dia,
               a.presenca_entrada_em, a.presenca_intervalo_saida_em,
               a.presenca_intervalo_retorno_em, a.presenca_saida_em, a.tem_saida
          FROM agrupado a
         -- fecha quando TODOS os turnos do dia tem saida, OU quando o dia ja passou. Exigir todos
         -- evita mandar resumo no fim do Regular de quem ainda vai emendar o plantao.
         WHERE (a.todas_com_saida OR a.dia < v_hoje)
           AND NOT EXISTS (
                SELECT 1 FROM public.avisos_ponto_fila f
                 WHERE f.servidor_id = a.servidor_id
                   AND f.tipo = 'resumo_diario'
                   AND f.referencia = a.dia)
    LOOP
        v_tel := public.fn_telefone_aviso_ponto(v_row.servidor_id);
        CONTINUE WHEN v_tel IS NULL;

        v_incompleto := NOT v_row.tem_saida OR v_row.presenca_saida_em IS NULL;

        v_linhas :=
            '• Entrada: ' || to_char(v_row.presenca_entrada_em AT TIME ZONE v_timezone, 'HH24:MI')
          || CASE WHEN v_row.presenca_intervalo_saida_em IS NOT NULL
                  THEN E'\n• Saída p/ intervalo: ' || to_char(v_row.presenca_intervalo_saida_em AT TIME ZONE v_timezone, 'HH24:MI')
                  ELSE '' END
          || CASE WHEN v_row.presenca_intervalo_retorno_em IS NOT NULL
                  THEN E'\n• Retorno do intervalo: ' || to_char(v_row.presenca_intervalo_retorno_em AT TIME ZONE v_timezone, 'HH24:MI')
                  ELSE '' END
          || CASE WHEN v_row.presenca_saida_em IS NOT NULL
                  THEN E'\n• Saída: ' || to_char(v_row.presenca_saida_em AT TIME ZONE v_timezone, 'HH24:MI')
                  ELSE E'\n• Saída: *não registrada*' END;

        v_msg :=
            '📋 *Resumo do seu ponto — ' || to_char(v_row.dia, 'DD/MM/YYYY') || '*' || E'\n\n' ||
            'Olá, ' || COALESCE(v_row.nome, 'servidor(a)') || '.' || E'\n' ||
            'Local: ' || COALESCE(v_row.unidade_nome, 'não informado') || E'\n\n' ||
            v_linhas || E'\n\n' ||
            CASE WHEN v_incompleto
                 THEN '⚠️ *A saída deste dia não foi registrada.* Procure seu coordenador para regularizar.' || E'\n\n'
                 ELSE '' END ||
            '_Aviso informativo, não é o Comprovante de Registro de Ponto._' || E'\n' ||
            '_Horários sujeitos a revisão do coordenador. Sua folha está no Portal do Servidor._' || E'\n' ||
            'SisEscala — Secretaria Municipal de Saúde de Marabá' || E'\n\n' ||
            '_Para parar de receber, responda PARAR._';

        INSERT INTO public.avisos_ponto_fila
            (tipo, servidor_id, unidade_id, telefone, mensagem, evento, referencia)
        VALUES
            ('resumo_diario', v_row.servidor_id, v_row.unidade_id, v_tel, v_msg,
             CASE WHEN v_incompleto THEN 'resumo_incompleto' ELSE 'resumo' END, v_row.dia)
        ON CONFLICT DO NOTHING;

        v_qtd := v_qtd + 1;
    END LOOP;

    -- ----------------------------------------------------------------- SEMANAL
    -- Segunda-feira (ISO 1) a partir das 08:00 locais, cobrindo a segunda anterior.
    -- Sem GROUP BY nesta secao - um SELECT por servidor, sem agregacao - nao sofre do mesmo
    -- padrao da diaria, entra inalterada.
    IF extract(isodow from v_hoje) = 1 AND extract(hour from v_agora) >= 8 THEN
        v_seg_ant := v_hoje - 7;

        FOR v_row IN
            SELECT s.id AS servidor_id, s.nome, s.unidade_id
              FROM public.servidores s
              JOIN public.unidades   u ON u.id = s.unidade_id
             WHERE s.aviso_ponto_status = 'ativo'
               AND s.aviso_ponto_modo   = 'resumo_semanal'
               AND public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id)
               AND NOT EXISTS (
                    SELECT 1 FROM public.avisos_ponto_fila f
                     WHERE f.servidor_id = s.id
                       AND f.tipo = 'resumo_semanal'
                       AND f.referencia = v_seg_ant)
        LOOP
            v_tel := public.fn_telefone_aviso_ponto(v_row.servidor_id);
            CONTINUE WHEN v_tel IS NULL;

            v_linhas := '';
            FOR v_dia IN
                SELECT (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date AS dia,
                       ed.presenca_entrada_em, ed.presenca_saida_em
                  FROM public.escala_diaria ed
                  JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
                 WHERE em.servidor_id = v_row.servidor_id
                   AND ed.presenca_entrada_em IS NOT NULL
                   AND (ed.presenca_entrada_em AT TIME ZONE v_timezone)::date BETWEEN v_seg_ant AND v_seg_ant + 6
                 ORDER BY 1
            LOOP
                v_linhas := v_linhas || '• ' || to_char(v_dia.dia, 'DD/MM') || ': '
                  || to_char(v_dia.presenca_entrada_em AT TIME ZONE v_timezone, 'HH24:MI') || ' → '
                  || COALESCE(to_char(v_dia.presenca_saida_em AT TIME ZONE v_timezone, 'HH24:MI'),
                              '*sem saída*')
                  || E'\n';
            END LOOP;

            -- Semana sem nenhum registro nao gera mensagem: seria ruido puro.
            CONTINUE WHEN v_linhas = '';

            v_msg :=
                '📋 *Resumo semanal do seu ponto*' || E'\n' ||
                to_char(v_seg_ant, 'DD/MM') || ' a ' || to_char(v_seg_ant + 6, 'DD/MM/YYYY') || E'\n\n' ||
                'Olá, ' || COALESCE(v_row.nome, 'servidor(a)') || '.' || E'\n\n' ||
                v_linhas || E'\n' ||
                '_Aviso informativo, não é o Comprovante de Registro de Ponto._' || E'\n' ||
                '_Horários sujeitos a revisão. Sua folha completa está no Portal do Servidor:_' || E'\n' ||
                'https://sisescala.maraba.pa.gov.br/consultar-escala' || E'\n\n' ||
                '_Para parar de receber, responda PARAR._';

            INSERT INTO public.avisos_ponto_fila
                (tipo, servidor_id, unidade_id, telefone, mensagem, evento, referencia)
            VALUES
                ('resumo_semanal', v_row.servidor_id, v_row.unidade_id, v_tel, v_msg,
                 'resumo', v_seg_ant)
            ON CONFLICT DO NOTHING;

            v_qtd := v_qtd + 1;
        END LOOP;
    END IF;

    RETURN v_qtd;

EXCEPTION WHEN OTHERS THEN
    -- Nao pode derrubar o worker: despachar o que ja esta na fila e mais importante que gerar
    -- resumo novo. Mas o erro nao pode ficar so no log do container, que ninguem le - grava em
    -- logs_sistema (mesmo padrao de fn_expurgar_logs, 20260809210000) para ficar consultavel.
    INSERT INTO public.logs_sistema (acao, entidade, entidade_id, origem, detalhes)
    VALUES ('ERRO_SISTEMA', 'aviso_ponto', 'fn_gerar_resumos_aviso_ponto', 'rotina',
            jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE, 'ocorrido_em', now()));
    RETURN 0;
END;
$fn$;

COMMENT ON FUNCTION public.fn_gerar_resumos_aviso_ponto() IS
    'Enfileira resumos diarios e semanais. Idempotente por (servidor, tipo, referencia). O diario '
    'agrupa via CTE material (nao expressao repetida em HAVING/subquery - ver 20260811120000). '
    'Erro grava em logs_sistema antes de devolver 0, para nao falhar em silencio de novo.';

GRANT EXECUTE ON FUNCTION public.fn_gerar_resumos_aviso_ponto() TO service_role;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. Chamar direto e conferir que devolve > 0 se houver dado elegivel (ex.: apos a correcao,
--      quem tem turno completo nos ultimos 3 dias com aviso ativo/resumo_diario deve gerar):
--      SELECT public.fn_gerar_resumos_aviso_ponto();
--   2. Ver o que foi enfileirado:
--      SELECT tipo, servidor_id, referencia, evento, status FROM public.avisos_ponto_fila
--       WHERE tipo IN ('resumo_diario','resumo_semanal') ORDER BY criado_em DESC;
--   3. Se ainda devolver 0 e houver dado elegivel, checar se desta vez ficou registrado o motivo:
--      SELECT * FROM public.logs_sistema WHERE entidade_id = 'fn_gerar_resumos_aviso_ponto'
--       ORDER BY created_at DESC LIMIT 5;
