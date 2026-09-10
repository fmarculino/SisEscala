COMMENT ON FUNCTION public.fn_alterar_turno_escala_diaria(uuid, integer, text, uuid, text) IS
    'Troca o turno de uma celula da grade carregando a justificativa. Unico caminho capaz de '
    'trocar turno de dia que ja tem ponto - a trigger recusa qualquer outro. O motivo vira linha '
    'no historico append-only escala_diaria_turno_historico em QUALQUER categoria e, SO em '
    'categoria de evento (Extra, Plantao, Sobreaviso), e ACRESCENTADO a justificativa daquele dia '
    'em justificativas_eventos, que e o que o relatorio imprime - Regular nao entra la, e a CHECK '
    'da tabela recusava a linha inteira ate 10/09/2026. O retorno diz o que foi escrito em '
    'justificativa_evento_registrada. SECURITY INVOKER de proposito: a RLS de escala_diaria e de '
    'justificativas_eventos decide quem pode alterar.';


-- ============================================================================
-- CONFERENCIA - roda junto e ABORTA a migration se qualquer assercao falhar
-- ============================================================================
-- Ela EXECUTA a funcao nova E a expressao real da CHECK (armadilha 42: conferir que a funcao
-- EXISTE nao prova nada; plpgsql so resolve nome de coluna, de funcao e de operador quando o
-- statement roda). Confere os DOIS sentidos: Regular tem que ficar de fora, e as tres categorias
-- de evento tem que continuar dentro - fechar demais aqui apagaria a justificativa do plantao,
-- que e' o que o relatorio imprime.
--
-- Nada e' fixado em matricula, servidor ou unidade: homologacao e producao tem conteudos
-- diferentes (armadilha 3).
DO $conf$
DECLARE
    v_falhas    text[] := ARRAY[]::text[];
    v_cat       text;
    v_fn        boolean;
    v_check     boolean;
    v_def       text;
    v_expr      text;
    v_src       text;
    v_n         integer;
    v_pos_guard integer;
    v_pos_ins   integer;
    v_pos_upd   integer;
BEGIN
    -- ------------------------------------------------------------------
    -- 1. Tabela-verdade da funcao nova.
    -- ------------------------------------------------------------------
    IF public.fn_categoria_tem_justificativa_evento('Regular') THEN
        v_falhas := v_falhas || 'Regular NAO pode ter justificativa de evento';
    END IF;
    FOREACH v_cat IN ARRAY ARRAY['Extra', 'Plantão', 'Sobreaviso'] LOOP
        IF NOT public.fn_categoria_tem_justificativa_evento(v_cat) THEN
            v_falhas := v_falhas || format('%s PRECISA ter justificativa de evento', v_cat);
        END IF;
    END LOOP;
    IF public.fn_categoria_tem_justificativa_evento(NULL) IS NOT FALSE THEN
        v_falhas := v_falhas || 'categoria nula tem que devolver false, nunca NULL';
    END IF;
    -- Variante sem acento / em outra caixa nao passa: a CHECK e' literal, e aceitar aqui so
    -- adiantaria o INSERT ate ela.
    FOREACH v_cat IN ARRAY ARRAY['plantao', 'PLANTÃO', 'extra', ''] LOOP
        IF public.fn_categoria_tem_justificativa_evento(v_cat) THEN
            v_falhas := v_falhas || format('variante %L nao pode ser aceita', v_cat);
        END IF;
    END LOOP;

    -- ------------------------------------------------------------------
    -- 2. A funcao concorda com a CHECK REAL da tabela?
    -- ------------------------------------------------------------------
    -- Executa a propria expressao da constraint, com a coluna trocada pelo literal. Sem isto a
    -- funcao seria uma segunda opiniao sobre a mesma pergunta, livre para divergir em silencio.
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'justificativas_eventos'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%categoria%';

    IF v_def IS NULL THEN
        -- Sem CHECK na tabela a funcao apenas restringe mais que o banco - inofensivo, mas
        -- precisa aparecer: e' sinal de que os dois ambientes divergiram.
        RAISE NOTICE 'ATENCAO: justificativas_eventos nao tem CHECK de categoria neste banco';
    ELSE
        RAISE NOTICE 'CHECK real: %', v_def;
        v_expr := regexp_replace(v_def, '^CHECK\s*', '');
        FOREACH v_cat IN ARRAY ARRAY['Regular', 'Extra', 'Plantão', 'Sobreaviso'] LOOP
            v_fn := public.fn_categoria_tem_justificativa_evento(v_cat);
            BEGIN
                EXECUTE format('SELECT %s', replace(v_expr, 'categoria', quote_literal(v_cat) || '::text'))
                   INTO v_check;
            EXCEPTION WHEN OTHERS THEN
                v_check := NULL;
                RAISE NOTICE 'nao foi possivel avaliar a CHECK para %: %', v_cat, SQLERRM;
            END;

            IF v_check IS NOT NULL AND v_check IS DISTINCT FROM v_fn THEN
                v_falhas := v_falhas || format(
                    'divergencia em %s: a CHECK diz %s e fn_categoria_tem_justificativa_evento diz %s',
                    v_cat, v_check, v_fn);
            END IF;
        END LOOP;
    END IF;

    -- ------------------------------------------------------------------
    -- 3. A RPC recopiada: uma so assinatura, e as escritas DENTRO do guard.
    -- ------------------------------------------------------------------
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_alterar_turno_escala_diaria';
    IF v_n <> 1 THEN
        -- Duas sobrecargas fazem o PostgREST devolver PGRST203 e a grade para de trocar turno.
        v_falhas := v_falhas || format('fn_alterar_turno_escala_diaria tem %s assinatura(s)', v_n);
    END IF;

    SELECT p.prosrc INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_alterar_turno_escala_diaria'
     LIMIT 1;

    v_pos_guard := strpos(v_src, 'fn_categoria_tem_justificativa_evento(p_categoria)');
    v_pos_ins   := strpos(v_src, 'INSERT INTO public.justificativas_eventos');
    v_pos_upd   := strpos(v_src, 'UPDATE public.justificativas_eventos');

    IF v_pos_guard = 0 THEN
        v_falhas := v_falhas || 'a RPC nao consulta fn_categoria_tem_justificativa_evento';
    END IF;
    IF v_pos_ins = 0 OR v_pos_upd = 0 THEN
        v_falhas := v_falhas || 'a RPC perdeu a escrita da justificativa de evento (plantao ficaria sem)';
    END IF;
    IF v_pos_guard > 0 AND (v_pos_ins < v_pos_guard OR v_pos_upd < v_pos_guard) THEN
        v_falhas := v_falhas || 'escrita em justificativas_eventos ANTES do guard';
    END IF;
    -- Guards que a funcao ja tinha e nao podem ter se perdido na recopia (armadilha 1).
    IF strpos(v_src, 'sisescala.justificativa_turno') = 0 THEN
        v_falhas := v_falhas || 'a RPC deixou de publicar o GUC que a trigger consome';
    END IF;
    IF strpos(v_src, 'Justificativa obrigatoria') = 0 THEN
        v_falhas := v_falhas || 'a RPC deixou de exigir justificativa';
    END IF;
    IF strpos(v_src, 'justificativa_evento_registrada') = 0 THEN
        v_falhas := v_falhas || 'a RPC nao relata se a justificativa de evento foi escrita';
    END IF;

    -- ------------------------------------------------------------------
    -- 4. Privilegios, nos DOIS sentidos (armadilhas 24 e 39).
    -- ------------------------------------------------------------------
    IF has_function_privilege('anon',
        'public.fn_categoria_tem_justificativa_evento(text)', 'EXECUTE') THEN
        v_falhas := v_falhas || 'fn_categoria_tem_justificativa_evento ficou aberta a anon';
    END IF;
    -- A RPC e SECURITY INVOKER: sem EXECUTE para authenticated, o coordenador para de trocar turno.
    IF NOT has_function_privilege('authenticated',
        'public.fn_categoria_tem_justificativa_evento(text)', 'EXECUTE') THEN
        v_falhas := v_falhas || 'fn_categoria_tem_justificativa_evento PERDEU execute de authenticated';
    END IF;
    IF NOT has_function_privilege('authenticated',
        'public.fn_alterar_turno_escala_diaria(uuid, integer, text, uuid, text)', 'EXECUTE') THEN
        v_falhas := v_falhas || 'fn_alterar_turno_escala_diaria PERDEU execute de authenticated';
    END IF;

    IF array_length(v_falhas, 1) > 0 THEN
        RAISE EXCEPTION 'CONFERENCIA REPROVADA: %', array_to_string(v_falhas, ' | ');
    END IF;
    RAISE NOTICE 'conferencia OK';
END;
$conf$;
