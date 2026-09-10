-- ============================================================================
-- TROCAR O TURNO DE UM DIA COM PONTO ERA IMPOSSIVEL NA LINHA REGULAR (10/09/2026)
-- ============================================================================
-- SINTOMA, relatado do campo: o coordenador lancou MT onde era M, o dia ja tinha ponto, a grade
-- abriu o modal de justificativa (correto), ele escreveu o motivo, clicou em "Alterar e
-- justificar" e recebeu
--
--     new row for relation "justificativas_eventos" violates check constraint
--     "justificativas_eventos_categoria_check"
--
-- A troca NAO acontecia. Nada ficou pela metade — a RPC e um statement so, entao o UPDATE do
-- turno e a linha do historico voltaram atras junto —, mas o coordenador ficava sem saida: a
-- celula nao aceita a correcao por nenhum outro caminho (trg_registrar_troca_turno recusa troca
-- de turno em dia com ponto sem justificativa, e so esta RPC sabe carregar o texto).
--
-- CAUSA
--   fn_alterar_turno_escala_diaria (20260821110000) grava o carimbo da troca em DOIS lugares:
--     1. escala_diaria_turno_historico  — append-only, pela trigger, para QUALQUER categoria;
--     2. justificativas_eventos         — o que o relatorio de justificativas imprime.
--
--   O segundo so existe para EVENTO. A tabela tem
--
--       CHECK (categoria = ANY (ARRAY['Extra', 'Plantao', 'Sobreaviso']))
--
--   e o modulo inteiro e' "Gestao e registro motivacional individual para Horas Extras, Plantoes
--   e Sobreavisos": fn_listar_eventos_justificaveis e as telas filtram exatamente essas tres
--   categorias. A RPC escrevia p_categoria cru, entao para 'Regular' morria em 23514.
--
--   ⚠️ A CHECK NAO ESTA EM MIGRATION NENHUMA — a tabela nasceu fora do versionamento e o
--   CREATE TABLE IF NOT EXISTS de 20260805000000 nunca chegou a cria-la (armadilha 2 do
--   CLAUDE.md). Confirmada por pg_get_constraintdef em 10/09/2026.
--
-- A CORRECAO NAO E' AFROUXAR A CHECK, e essa foi a primeira ideia.
--   Uma linha 'Regular' em justificativas_eventos nao apareceria em tela nenhuma (os tres
--   caminhos de leitura do modulo filtram Extra/Plantao/Sobreaviso), nao sairia em relatorio
--   nenhum, e ainda ocuparia a chave uq_justificativa_evento (servidor, dia, mes, ano,
--   categoria). Seria dado morto criado para satisfazer um INSERT. A CHECK esta CERTA: ela e' o
--   banco dizendo que Regular nao e' evento.
--
--   O motivo da troca continua registrado onde ele sempre foi a prova do ato: o historico
--   append-only escala_diaria_turno_historico, escrito pela trigger para toda categoria, com
--   de -> para, autor e tinha_ponto.
--
-- ⚠️ E O RELATO TEM QUE ACOMPANHAR (armadilha 22). A RPC passa a devolver
--   `justificativa_evento_registrada`, e a grade deixa de prometer "sai no relatorio de Regular"
--   — relatorio que nao existe. Prometer o que o sistema nao faz ensina a desconfiar do resto.
--
-- IDEMPOTENTE: so CREATE OR REPLACE, sem DROP e sem mudanca de assinatura na RPC — ela nao vira
-- objeto novo, entao o GRANT existente e' preservado (armadilha 41).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Fonte unica: esta categoria tem justificativa de EVENTO?
-- ----------------------------------------------------------------------------
-- ESPELHO EXATO de justificativas_eventos_categoria_check. Nao normaliza acento nem caixa DE
-- PROPOSITO: aceitar 'plantao' aqui so adiantaria o INSERT ate a CHECK, que e' literal — trocaria
-- um "nao escreve" explicito pelo mesmo 23514 de antes. Quem chama passa a categoria vinda do
-- enum escala_categoria, que ja e' exata.
--
-- A conferencia no fim desta migration EXECUTA a expressao real da CHECK e aborta se as duas
-- discordarem: se um dia a lista da tabela mudar, isto para de compilar a verdade em silencio.
CREATE OR REPLACE FUNCTION public.fn_categoria_tem_justificativa_evento(p_categoria text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fncat$
    SELECT p_categoria IS NOT NULL
       AND p_categoria = ANY (ARRAY['Extra', 'Plantão', 'Sobreaviso']);
$fncat$;

COMMENT ON FUNCTION public.fn_categoria_tem_justificativa_evento(text) IS
    'Espelho da CHECK justificativas_eventos_categoria_check. Regular NAO e evento: nao tem '
    'justificativa de evento, nao entra no relatorio de justificativas e nao pode ser gravada '
    'naquela tabela. Quem registra a troca de turno de um dia Regular e o historico append-only '
    'escala_diaria_turno_historico.';

-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. E' chamada de dentro de
-- fn_alterar_turno_escala_diaria, que e SECURITY INVOKER — authenticated precisa manter o EXECUTE.
REVOKE ALL ON FUNCTION public.fn_categoria_tem_justificativa_evento(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_categoria_tem_justificativa_evento(text)
    TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. fn_alterar_turno_escala_diaria  (base: 20260821110000, copia mecanica)
-- ----------------------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.fn_alterar_turno_escala_diaria(
    p_escala_mensal_id UUID,
    p_dia INTEGER,
    p_categoria TEXT,
    p_dicionario_turnos_id UUID,
    p_justificativa TEXT
)
RETURNS JSONB AS $fn$
DECLARE
    v_ed_id UUID;
    v_turno_ant UUID;
    v_cod_ant TEXT;
    v_cod_novo TEXT;
    v_servidor UUID;
    v_mes INTEGER;
    v_ano INTEGER;
    v_unidade UUID;
    v_setor UUID;
    v_status TEXT;
    v_tem_ponto BOOLEAN;
    v_tz TEXT;
    v_autor TEXT;
    v_carimbo TEXT;
    v_just_id UUID;
    v_just_texto TEXT;
    -- Diz se a justificativa de EVENTO foi mesmo escrita. Categoria Regular nunca escreve:
    -- quem relata precisa saber disso para nao prometer um relatorio que nao existe.
    v_evento_justificado BOOLEAN := false;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RAISE EXCEPTION 'Justificativa obrigatoria para alterar o turno de um dia ja trabalhado.';
    END IF;

    IF p_dicionario_turnos_id IS NULL THEN
        RAISE EXCEPTION 'Turno de destino obrigatorio.';
    END IF;

    SELECT ed.id, ed.dicionario_turnos_id,
           (ed.presenca_entrada_em IS NOT NULL
             OR ed.presenca_saida_em IS NOT NULL
             OR ed.presenca_intervalo_saida_em IS NOT NULL
             OR ed.presenca_intervalo_retorno_em IS NOT NULL
             OR COALESCE(ed.presenca_confirmada, false)),
           em.servidor_id, em.mes, em.ano, em.unidade_id, em.setor_id, em.status
      INTO v_ed_id, v_turno_ant, v_tem_ponto, v_servidor, v_mes, v_ano, v_unidade, v_setor, v_status
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.escala_mensal_id = p_escala_mensal_id
       AND ed.dia = p_dia
       AND ed.categoria = p_categoria::public.escala_categoria;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nao existe lancamento de % no dia % desta escala.', p_categoria, p_dia;
    END IF;

    IF v_status = 'Fechada' THEN
        RAISE EXCEPTION 'Escala fechada: reabra antes de alterar o turno.';
    END IF;

    IF v_turno_ant IS NOT DISTINCT FROM p_dicionario_turnos_id THEN
        RETURN jsonb_build_object('alterado', false, 'motivo', 'o turno ja e esse');
    END IF;

    SELECT codigo INTO v_cod_ant  FROM public.dicionario_turnos WHERE id = v_turno_ant;
    SELECT codigo INTO v_cod_novo FROM public.dicionario_turnos WHERE id = p_dicionario_turnos_id;
    IF v_cod_novo IS NULL THEN
        RAISE EXCEPTION 'Turno de destino inexistente.';
    END IF;

    -- Publica a justificativa para a trigger. is_local = true: morre no fim da transacao.
    PERFORM set_config('sisescala.justificativa_turno', btrim(p_justificativa), true);

    UPDATE public.escala_diaria
       SET dicionario_turnos_id = p_dicionario_turnos_id
     WHERE id = v_ed_id;

    PERFORM set_config('sisescala.justificativa_turno', '', true);

    -- SO CATEGORIA DE EVENTO TEM JUSTIFICATIVA DE EVENTO (10/09/2026).
    -- justificativas_eventos.categoria tem CHECK que aceita apenas Extra, Plantao e Sobreaviso.
    -- Trocar o turno de uma linha REGULAR com ponto morria aqui, em 23514, e a transacao inteira
    -- voltava atras: a troca nao acontecia, e a tela mostrava a mensagem crua do Postgres.
    -- O motivo continua registrado - quem guarda o ato e o historico append-only
    -- (escala_diaria_turno_historico), escrito pela trigger acima, para QUALQUER categoria.
    IF public.fn_categoria_tem_justificativa_evento(p_categoria) THEN
        -- Justificativa do evento, para o relatorio de plantao. A tabela tem UMA linha por
        -- (servidor, dia, mes, ano, categoria) - uq_justificativa_evento - e no dia da dobra ja
        -- costuma existir a justificativa do plantao original. ACRESCENTA em vez de substituir:
        -- as duas coisas sao verdade e as duas precisam aparecer no relatorio.
        SELECT NULLIF((valor#>>'{}')::text, '') INTO v_tz
          FROM public.configuracoes_globais WHERE chave = 'timezone';
        v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

        SELECT full_name INTO v_autor FROM public.profiles WHERE id = auth.uid();

        v_carimbo := format('[%s - turno alterado de %s para %s por %s] %s',
            to_char(now() AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI'),
            COALESCE(v_cod_ant, '(vazio)'), v_cod_novo, COALESCE(v_autor, 'sistema'),
            btrim(p_justificativa));

        SELECT id, texto_justificativa INTO v_just_id, v_just_texto
          FROM public.justificativas_eventos
         WHERE servidor_id = v_servidor AND dia = p_dia AND mes = v_mes AND ano = v_ano
           AND categoria = p_categoria;

        IF v_just_id IS NOT NULL THEN
            UPDATE public.justificativas_eventos
               SET texto_justificativa = v_just_texto || chr(10) || chr(10) || v_carimbo,
                   escala_diaria_id = v_ed_id,
                   updated_at = now()
             WHERE id = v_just_id;
        ELSE
            INSERT INTO public.justificativas_eventos (
                escala_diaria_id, servidor_id, escala_mensal_id, unidade_id, setor_id,
                dia, mes, ano, categoria, texto_justificativa,
                origem, status, registrado_por_id, registrado_por_nome,
                validado_por_id, validado_por_nome, data_validacao
            ) VALUES (
                v_ed_id, v_servidor, p_escala_mensal_id, v_unidade, v_setor,
                p_dia, v_mes, v_ano, p_categoria, v_carimbo,
                'coordenador', 'aprovada', auth.uid(), v_autor,
                auth.uid(), v_autor, now()
            )
            RETURNING id INTO v_just_id;
        END IF;

        v_evento_justificado := true;
    END IF;

    RETURN jsonb_build_object(
        'alterado', true,
        'escala_diaria_id', v_ed_id,
        'codigo_anterior', v_cod_ant,
        'codigo_novo', v_cod_novo,
        'tinha_ponto', v_tem_ponto,
        'justificativa_evento_registrada', v_evento_justificado,
        'justificativa_evento_id', v_just_id
    );
END;
$fn$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

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
