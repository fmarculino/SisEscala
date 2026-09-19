-- ============================================================================
-- BLOCO DE MEDICAO -- nao cria funcao, nao altera dado, nao deixa rastro.
-- ============================================================================
-- Roda EXPLAIN (ANALYZE, BUFFERS) da consulta de fn_auditoria_ponto_servidor com os valores ja
-- resolvidos, exatamente como a funcao a executaria, e devolve o PLANO.
--
-- A unica coisa que cria e' uma tabela TEMPORARIA (some quando a aba do SQL Editor fecha).
-- EXPLAIN ANALYZE executa a consulta, mas ela e' 100% SELECT.
--
-- Cole tudo, rode, e me mande o resultado inteiro.

CREATE TEMP TABLE IF NOT EXISTS _plano (linha_n serial, plano text);
TRUNCATE _plano;

DO $medir$
DECLARE
    v_srv      uuid;
    v_ids_afd  text[];
    v_irmaos   uuid[];
    v_ini      date := (now() - interval '29 days')::date;
    v_fim      date := now()::date;
    r          record;
    v_sql      text;
BEGIN
    -- O MESMO servidor que a conferencia da migration usa.
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' ORDER BY created_at LIMIT 1;

    SELECT array_remove(ARRAY[
               CASE WHEN COALESCE(s.cpf, '') <> ''
                    THEN lpad(regexp_replace(s.cpf, '[^0-9]', '', 'g'), 12, '0') END,
               CASE WHEN COALESCE(s.pis_pasep, '') <> ''
                    THEN lpad(regexp_replace(s.pis_pasep, '[^0-9]', '', 'g'), 12, '0') END
           ], NULL)
      INTO v_ids_afd
      FROM public.servidores s WHERE s.id = v_srv;

    SELECT array_agg(i.irmao_id) INTO v_irmaos
      FROM public.fn_cadastros_irmaos(ARRAY[v_srv]) i;

    INSERT INTO _plano(plano) VALUES
        (format('== servidor=%s  periodo=%s..%s  ids_afd=%s  irmaos=%s ==',
                v_srv, v_ini, v_fim, v_ids_afd, COALESCE(v_irmaos::text, 'NENHUM')));

    -- A consulta da funcao, com os parametros como LITERAIS (e o que o EXPLAIN precisa para
    -- mostrar o plano real). %L cuida do quoting; %s so' para os arrays, ja formatados.
    v_sql := format($q$
        EXPLAIN (ANALYZE, BUFFERS, TIMING)
        WITH dias AS MATERIALIZED (
            SELECT d::date AS data FROM generate_series(%L::date, %L::date, interval '1 day') d
        ),
        escala AS MATERIALIZED (
            SELECT make_date(em.ano, em.mes, ed.dia) AS data,
                   dt.codigo AS turno_codigo, ed.categoria::text AS categoria,
                   u.nome AS unidade_nome, ds.nome AS setor_nome,
                   ed.presenca_entrada_em, ed.presenca_intervalo_saida_em,
                   ed.presenca_intervalo_retorno_em, ed.presenca_saida_em
              FROM public.escala_mensal em
              JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id
              LEFT JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
              LEFT JOIN public.unidades u ON u.id = em.unidade_id
              LEFT JOIN public.setores st ON st.id = em.setor_id
              LEFT JOIN public.dicionario_setores ds ON ds.id = st.dicionario_setor_id
             WHERE em.servidor_id = %L
               AND ed.categoria <> 'Sobreaviso'
               AND make_date(em.ano, em.mes, ed.dia) BETWEEN %L::date AND %L::date
        ),
        marc_base AS MATERIALIZED (
            SELECT m.id, m.ocorrido_em, m.origem, m.dispositivo_id, m.afd_registro_id,
                   public.fn_batida_fisica(m.origem, m.sintetica)   AS fisica,
                   public.fn_marcacao_desconsiderada(m.id)          AS desconsiderada
              FROM public.marcacoes_ponto m
             WHERE m.servidor_id = %L
               AND m.ocorrido_em >= %L::date
               AND m.ocorrido_em <  (%L::date + 1)
        ),
        marc AS MATERIALIZED (
            SELECT (b.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
                   count(*) FILTER (WHERE b.fisica AND b.desconsiderada)::integer AS retidas,
                   jsonb_agg(jsonb_build_object(
                       'hora', to_char(b.ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
                       'origem', b.origem,
                       'relogio', (SELECT d.nome FROM public.dispositivos_rep d WHERE d.id = b.dispositivo_id),
                       'nsr', (SELECT a.nsr FROM public.rep_afd_registros a WHERE a.id = b.afd_registro_id),
                       'desconsiderada', b.desconsiderada,
                       'fisica', b.fisica
                   ) ORDER BY b.ocorrido_em) AS batidas
              FROM marc_base b
             GROUP BY 1
        ),
        irmao AS MATERIALIZED (
            SELECT (m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data,
                   jsonb_agg(jsonb_build_object(
                       'hora', to_char(m.ocorrido_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
                       'matricula', (SELECT i.matricula FROM public.servidores i WHERE i.id = m.servidor_id),
                       'relogio', (SELECT d.nome FROM public.dispositivos_rep d WHERE d.id = m.dispositivo_id)
                   ) ORDER BY m.ocorrido_em) AS batidas
              FROM public.marcacoes_ponto m
             WHERE %L::uuid[] IS NOT NULL
               AND m.servidor_id = ANY (%L::uuid[])
               AND m.ocorrido_em >= %L::date
               AND m.ocorrido_em <  (%L::date + 1)
             GROUP BY 1
        ),
        orfas AS MATERIALIZED (
            SELECT (a.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date AS data, count(*)::integer AS n
              FROM public.rep_afd_registros a
             WHERE a.tipo_registro = '3'
               AND a.identificador_afd = ANY (%L::text[])
               AND a.ocorrido_em >= %L::date
               AND a.ocorrido_em <  (%L::date + 1)
               AND NOT EXISTS (SELECT 1 FROM public.marcacoes_ponto m WHERE m.afd_registro_id = a.id)
             GROUP BY 1
        )
        SELECT dd.data, e.turno_codigo, m.batidas, m.retidas, i.batidas, o.n
          FROM dias dd
          LEFT JOIN escala e ON e.data = dd.data
          LEFT JOIN marc   m ON m.data = dd.data
          LEFT JOIN irmao  i ON i.data = dd.data
          LEFT JOIN orfas  o ON o.data = dd.data
    $q$,
        v_ini, v_fim,
        v_srv, v_ini, v_fim,
        v_srv, v_ini, v_fim,
        COALESCE(v_irmaos, ARRAY[]::uuid[]), COALESCE(v_irmaos, ARRAY[]::uuid[]), v_ini, v_fim,
        v_ids_afd, v_ini, v_fim
    );

    FOR r IN EXECUTE v_sql LOOP
        INSERT INTO _plano(plano) VALUES (r."QUERY PLAN");
    END LOOP;
END
$medir$;

SELECT linha_n, plano FROM _plano ORDER BY linha_n;
