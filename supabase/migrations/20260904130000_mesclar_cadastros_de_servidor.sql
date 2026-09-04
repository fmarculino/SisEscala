-- ============================================================================
-- MESCLAR CADASTROS DE SERVIDOR - o mesmo servidor cadastrado duas vezes
-- ============================================================================
-- 04/09/2026
--
-- POR QUE
--   servidores e "1 linha = 1 vinculo" por decisao de 10/08/2026 (20260810140000): o mesmo CPF
--   pode aparecer duas vezes de forma LEGITIMA (concursada num cargo e contratada noutro), entao
--   o indice unico de CPF foi derrubado e trocado por vinculo_multiplo_confirmado - uma
--   confirmacao humana na tela de cadastro.
--
--   O custo dessa troca apareceu em campo: quem esta cadastrando marca a confirmacao para o
--   sistema deixar salvar, e o ENGANO passa a ser indistinguivel do vinculo duplo de verdade.
--   Caso real (04/09/2026): MARIA NAZARE NERES BRITO, matricula 65567 na USF HIROSHI MATSUDA, foi
--   cadastrada de novo por outra unidade como T2600103 (matricula temporaria), com
--   vinculo_multiplo_confirmado = true. Nao ha duplo vinculo nenhum - ha um cadastro a mais.
--
--   Medido em producao em 04/09/2026, em 2.075 servidores: 17 CPFs com dois cadastros ATIVOS, e
--   TODOS os 17 com a confirmacao marcada em pelo menos um lado. Nao existia ferramenta nenhuma
--   para desfazer isso: /servidores/pendencias LISTA as duplicidades
--   (fn_possiveis_duplicidades_servidor) e nao oferece acao nenhuma sobre elas - o mesmo defeito
--   da armadilha 44 do CLAUDE.md (instruir o que o sistema nao oferece), aqui na forma de
--   apontar o problema sem dar a saida.
--
-- O QUE ESTA MIGRATION DA
--   fn_mesclar_servidores(origem, destino): move TODO vinculo do cadastro errado para o correto
--   e INATIVA o errado deixando o rastro de para onde ele foi.
--
-- POR QUE MOVER E INATIVAR, E NAO EXCLUIR (decisao do usuario, 04/09/2026)
--   Excluir e o que fn_fundir_setor faz, e la faz sentido: setor e rotulo de organograma. Aqui
--   a linha errada carrega uma MATRICULA que pode ter sido impressa em folha de ponto, escala e
--   relatorio - apagar a linha e apagar a unica explicacao possivel para aquele numero. O
--   cadastro perdedor fica Inativo, apontando para quem o absorveu (mesclado_em_servidor_id), e
--   sai de toda tela que filtra por Ativo.
--
-- POR QUE MOVER O DADO E NAO EXIGIR LIMPEZA ANTES (decisao do usuario, 04/09/2026)
--   Dos 17 casos medidos, so UM (a MARIA NAZARE) tem o cadastro errado vazio. Os outros 16 ja
--   tem batida de ponto, escala e folha nos dois lados - uma ferramenta que so aceitasse o
--   cadastro errado vazio nao serviria para 16 dos 17 casos que existem. E o dado do lado errado
--   nao e lixo: a pessoa bateu aquele ponto de verdade, a batida so foi atribuida a linha
--   errada. Mover preserva o fato; apagar destruiria prova (Portaria 671/2021).
--
--   A escala movida CONTINUA no setor onde foi lancada. Se a unidade que cadastrou errado
--   tambem escalou a pessoa, ela passa a aparecer escalada la, agora sob o cadastro correto -
--   e o que de fato aconteceu, e quem resolve isso e a grade (apagar) ou mover/dividir a
--   escala (20260903120000). A mesclagem nao adivinha qual escala e a "de verdade".
--
-- A EXCECAO NO TRIGGER DE IMUTABILIDADE DA MARCACAO
--   marcacoes_ponto e INSERT-only (20260808010000) e o UPDATE que existe hoje e so orfa -> com
--   dono (reparse de AFD) e so setor_id (fusao de setor). Sem um terceiro ramo, nenhum cadastro
--   com batida poderia ser mesclado - e batida e justamente o que 16 dos 17 casos tem.
--
--   O ramo novo tem a mesma forma estreita do da fusao de setor: exige o GUC
--   sisescala.mesclar_servidor (local a transacao) E que o registro inteiro MENOS servidor_id
--   seja identico (to_jsonb(NEW) - 'servidor_id' = to_jsonb(OLD) - 'servidor_id'). Horario, NSR,
--   dispositivo, origem e sintetica continuam impossiveis de alterar por aqui, hoje e depois de a
--   tabela ganhar coluna nova - a comparacao e estrutural, nao uma lista de campos.
--
--   Os TRES ramos precisam continuar existindo em qualquer recriacao desta funcao (armadilha 1
--   do CLAUDE.md: seis regressoes reais ja vieram de recopiar corpo de funcao sem um trecho).
--
-- O QUE A MESCLAGEM RECUSA
--   1. CPF divergente entre os dois cadastros - mesclar pessoas diferentes e o pior erro que esta
--      ferramenta pode cometer, e e irreversivel na pratica (ponto de uma vira ponto da outra);
--   2. sobreposicao de escala - mesmo dia, mesma competencia, slots que se cruzam. E a regra de
--      fn_prevent_cross_sector_shift_overlap (20260826220000, armadilha 23) aplicada ANTES de
--      criar o estado que ela existe para impedir: mover escala_mensal.servidor_id nao passa pelo
--      trigger, que so olha escala_diaria. Medido: 1 dos 17 casos cai aqui;
--   3. colisao de unicidade em qualquer tabela - varredura dinamica, ver abaixo. Medido: 7 dos 17
--      casos tem escala do mesmo mes no MESMO setor nos dois cadastros e caem aqui;
--   4. cadastro que ja foi mesclado (dos dois lados) - a origem ja foi absorvida, ou o destino
--      escolhido nao e mais o cadastro final.
--
--   Recusar em bloco e deliberado: a alternativa seria apagar linha de dado real para "caber" no
--   destino. Quem resolve escala em disputa e a grade, com a competencia na frente.
--
-- POR QUE A VARREDURA E DINAMICA
--   30 tabelas apontam para servidores.id hoje (medido em 04/09/2026 pelo OpenAPI do PostgREST), e
--   as tabelas base do sistema estao FORA do versionamento (armadilha 2). Uma lista escrita a mao
--   nasceria incompleta e envelheceria a cada tabela nova - e a tabela esquecida seria justamente
--   a que continuaria apontando para o cadastro inativado, em silencio.
--
--   A varredura de unicidade e por pg_INDEX, nao por pg_constraint. Indice unico PARCIAL
--   (uq_profiles_servidor_id, criado por CREATE UNIQUE INDEX ... WHERE servidor_id IS NOT NULL)
--   NAO aparece em pg_constraint - a copia mecanica de fn_impedimentos_fusao_setor teria deixado
--   a conta de usuario de fora e o UPDATE quebraria no meio da mesclagem.
--   O PREDICADO do indice parcial entra na checagem (medido em 04/09/2026: 8 dos 13 indices
--   unicos que tocam servidor_id sao parciais). Ignora-lo recusaria mesclagem por colisao que
--   nao existe - duas solicitacoes ja decididas, por exemplo - e, no descarte de
--   rep_cadastros_fila, apagaria linha historica em vez de so a pendente que colide.
--
-- IDEMPOTENTE
--   ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP FUNCTION IF EXISTS antes do CREATE onde o
--   retorno e TABLE (CREATE OR REPLACE nao altera lista de colunas de saida - 42P13).
-- ============================================================================


-- ============================================================================
-- 1. O RASTRO DA MESCLAGEM
-- ============================================================================

ALTER TABLE public.servidores
    ADD COLUMN IF NOT EXISTS mesclado_em_servidor_id uuid REFERENCES public.servidores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS mesclado_em timestamptz,
    ADD COLUMN IF NOT EXISTS mesclado_por uuid;

COMMENT ON COLUMN public.servidores.mesclado_em_servidor_id IS
    'Preenchido quando este cadastro foi identificado como DUPLICADO e teve todos os vinculos '
    'movidos para outro cadastro (fn_mesclar_servidores). A linha continua existindo, Inativa, '
    'porque a matricula dela pode ter sido impressa em folha e escala - e este campo e a unica '
    'explicacao de para onde o dado foi.';

COMMENT ON COLUMN public.servidores.mesclado_em IS 'Quando a mesclagem aconteceu.';
COMMENT ON COLUMN public.servidores.mesclado_por IS 'auth.uid() de quem mesclou.';

CREATE INDEX IF NOT EXISTS idx_servidores_mesclado_em_servidor
    ON public.servidores (mesclado_em_servidor_id)
    WHERE mesclado_em_servidor_id IS NOT NULL;


-- ============================================================================
-- 2. A EXCECAO NO TRIGGER DE IMUTABILIDADE DA MARCACAO
-- ============================================================================
-- Copia integral da versao vigente (20260829110000) MAIS o ramo da mesclagem. Os dois ramos
-- anteriores TEM que continuar aqui: sem o do reparse, fn_reparse_afd_dispositivo para de dar
-- dono a batida orfa; sem o da fusao, nenhum setor com batida pode ser fundido.

CREATE OR REPLACE FUNCTION public.fn_bloquear_alteracao_marcacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    -- Permite associar servidor_id a uma batida orfa durante sessao de reparse declarada
    IF TG_OP = 'UPDATE'
       AND OLD.servidor_id IS NULL
       AND NEW.servidor_id IS NOT NULL
       AND NEW.ocorrido_em = OLD.ocorrido_em
       AND NEW.nsr IS NOT DISTINCT FROM OLD.nsr
       AND NEW.dispositivo_id IS NOT DISTINCT FROM OLD.dispositivo_id
       AND COALESCE(current_setting('sisescala.reparse_afd', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    -- Permite reapontar SO o setor durante uma fusao de setor declarada. A comparacao e do
    -- registro inteiro menos setor_id: nenhum outro campo pode ter mudado, hoje nem depois de a
    -- tabela ganhar coluna nova. Ver 20260829110000.
    IF TG_OP = 'UPDATE'
       AND NEW.setor_id IS NOT NULL
       AND NEW.setor_id IS DISTINCT FROM OLD.setor_id
       AND (to_jsonb(NEW) - 'setor_id') = (to_jsonb(OLD) - 'setor_id')
       AND COALESCE(current_setting('sisescala.fundir_setor', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    -- Permite reapontar SO o servidor durante uma mesclagem de cadastro declarada. Mesma forma
    -- estreita do ramo acima: o registro inteiro menos servidor_id tem que ser identico, entao a
    -- batida continua com o mesmo horario, NSR, equipamento e origem - muda de dono, nao de fato.
    -- Ver o cabecalho desta migration.
    IF TG_OP = 'UPDATE'
       AND NEW.servidor_id IS NOT NULL
       AND NEW.servidor_id IS DISTINCT FROM OLD.servidor_id
       AND (to_jsonb(NEW) - 'servidor_id') = (to_jsonb(OLD) - 'servidor_id')
       AND COALESCE(current_setting('sisescala.mesclar_servidor', true), 'off') = 'on' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'Marcacao de ponto e imutavel (Portaria 671/2021). Operacao rejeitada: %. '
        'Para desconsiderar, reclassificar ou reatribuir uma marcacao, registre um tratamento '
        'em marcacoes_tratamentos - a marcacao original permanece para auditoria.',
        TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$fn$;


-- ============================================================================
-- 3. O QUE ESTA PENDURADO NUM CADASTRO
-- ============================================================================
-- Alimenta a tela: quem vai mesclar precisa ver ANTES o que sera movido, e de qual lado esta o
-- peso. Mesma varredura dinamica da mesclagem, para as duas nunca discordarem sobre o que existe.

DROP FUNCTION IF EXISTS public.fn_dependencias_servidor(uuid);

CREATE FUNCTION public.fn_dependencias_servidor(p_servidor_id uuid)
RETURNS TABLE (
    tabela  text,
    coluna  text,
    qtd     bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    r  record;
    n  bigint;
BEGIN
    IF (SELECT public.get_my_role()) NOT IN ('super_admin'::public.user_role, 'rh'::public.user_role) THEN
        RAISE EXCEPTION 'Sem permissao para inspecionar vinculos de cadastro.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    FOR r IN
        SELECT c.conrelid::regclass::text AS rel,
               (SELECT a.attname::text
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[i]) AS col
          FROM pg_constraint c
          CROSS JOIN generate_subscripts(c.conkey, 1) AS i
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.servidores'::regclass
           AND (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.confrelid AND a2.attnum = c.confkey[i]) = 'id'
         ORDER BY 1, 2
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.rel, r.col)
            INTO n USING p_servidor_id;

        IF n > 0 THEN
            tabela := r.rel;
            coluna := r.col;
            qtd := n;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.fn_dependencias_servidor(uuid) IS
    'Quantas linhas de cada tabela apontam para este cadastro de servidor (varredura dinamica de '
    'pg_constraint). Diagnostico para a tela de mesclagem; nao altera nada.';

REVOKE ALL ON FUNCTION public.fn_dependencias_servidor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dependencias_servidor(uuid) TO authenticated, service_role;


-- ============================================================================
-- 4. OS CADASTROS DUPLICADOS
-- ============================================================================
-- Diferente de fn_possiveis_duplicidades_servidor de proposito, e a diferenca e o ponto:
--
--   - aquela EXCLUI o grupo quando todo mundo tem vinculo_multiplo_confirmado = true, para os
--     ~110 duplos vinculos legitimos nao poluirem a tela de pendencias para sempre. Mas foi
--     exatamente a confirmacao marcada por engano que criou o caso da MARIA NAZARE - esconder o
--     grupo confirmado esconderia justamente o que esta ferramenta existe para desfazer;
--   - esta aqui lista TODO CPF com dois ou mais cadastros nao mesclados, marca quais estao
--     confirmados (todos_confirmados) e devolve o PESO de cada lado (escalas, batidas, folhas,
--     vinculos de relogio), que e o que permite decidir qual cadastro absorve qual.
--
-- Quem le decide; a funcao nao escolhe o "correto" sozinha - matricula temporaria costuma ser o
-- cadastro errado, mas nao sempre, e chutar isso na fonte de dados esconderia o julgamento.

DROP FUNCTION IF EXISTS public.fn_cadastros_duplicados();

CREATE FUNCTION public.fn_cadastros_duplicados()
RETURNS TABLE (
    cpf                 text,
    quantidade          bigint,
    todos_confirmados   boolean,
    cadastros           jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
    IF (SELECT public.get_my_role()) <> 'super_admin'::public.user_role THEN
        RAISE EXCEPTION 'Apenas o Administrador Geral pode ver os cadastros duplicados.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH base AS (
        SELECT s.id, s.nome, s.matricula, s.status, s.created_at,
               s.vinculo_multiplo_confirmado,
               s.cargo, s.vinculo::text AS vinculo,
               public.fn_cpf_normalizado(s.cpf) AS cpf_norm,
               u.nome AS unidade_nome,
               ds.nome AS setor_nome
          FROM public.servidores s
          LEFT JOIN public.unidades u ON u.id = s.unidade_id
          LEFT JOIN public.setores se ON se.id = s.setor_id
          LEFT JOIN public.dicionario_setores ds ON ds.id = se.dicionario_setor_id
         WHERE s.mesclado_em_servidor_id IS NULL
    ),
    duplicados AS (
        SELECT b.*
          FROM base b
         WHERE b.cpf_norm IS NOT NULL
           AND EXISTS (SELECT 1 FROM base b2
                        WHERE b2.cpf_norm = b.cpf_norm AND b2.id <> b.id)
    ),
    com_peso AS (
        SELECT d.*,
               (SELECT count(*) FROM public.escala_mensal em WHERE em.servidor_id = d.id) AS escalas,
               (SELECT count(*) FROM public.marcacoes_ponto mp WHERE mp.servidor_id = d.id) AS batidas,
               (SELECT count(*) FROM public.folha_ponto fp WHERE fp.servidor_id = d.id) AS folhas,
               (SELECT count(*) FROM public.rep_vinculos_servidor rv
                 WHERE rv.servidor_id = d.id AND rv.vigente_ate IS NULL) AS vinculos_rep
          FROM duplicados d
    )
    SELECT c.cpf_norm,
           count(*),
           bool_and(c.vinculo_multiplo_confirmado),
           jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nome', c.nome,
               'matricula', c.matricula,
               'status', c.status,
               'cargo', c.cargo,
               'vinculo', c.vinculo,
               'unidade', c.unidade_nome,
               'setor', c.setor_nome,
               'vinculo_multiplo_confirmado', c.vinculo_multiplo_confirmado,
               'criado_em', c.created_at,
               'escalas', c.escalas,
               'batidas', c.batidas,
               'folhas', c.folhas,
               'vinculos_rep', c.vinculos_rep
           ) ORDER BY c.created_at)
      FROM com_peso c
     GROUP BY c.cpf_norm
     ORDER BY bool_and(c.vinculo_multiplo_confirmado), min(c.created_at) DESC;
END;
$fn$;

COMMENT ON FUNCTION public.fn_cadastros_duplicados() IS
    'CPFs com dois ou mais cadastros ainda nao mesclados, com o peso de cada lado (escalas, '
    'batidas, folhas, vinculos de relogio). Inclui os grupos ja marcados como vinculo multiplo '
    'confirmado - a confirmacao marcada por engano e justamente o caso a desfazer. So super_admin.';

REVOKE ALL ON FUNCTION public.fn_cadastros_duplicados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cadastros_duplicados() TO authenticated, service_role;


-- ============================================================================
-- 5. O QUE IMPEDE A MESCLAGEM (consulta - a tela mostra ANTES de confirmar)
-- ============================================================================
-- Uma linha por impedimento. Lista vazia = a mesclagem passa.
--
-- Existe separada da mesclagem pelo mesmo motivo de fn_impedimentos_fusao_setor: a tela precisa
-- dizer o que esta errado enquanto ainda da para trocar a escolha, nao depois do clique final.

DROP FUNCTION IF EXISTS public.fn_impedimentos_mesclagem_servidor(uuid, uuid);

CREATE FUNCTION public.fn_impedimentos_mesclagem_servidor(
    p_origem  uuid,
    p_destino uuid
)
RETURNS TABLE (
    motivo    text,
    detalhe   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_o       record;
    v_d       record;
    r         record;
    u         record;
    v_outras  text[];
    v_pred    text;
    v_qtd     bigint;
    v_lista   text;
BEGIN
    SELECT s.id, s.nome, s.matricula, s.status, s.mesclado_em_servidor_id,
           public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_o
      FROM public.servidores s WHERE s.id = p_origem;

    SELECT s.id, s.nome, s.matricula, s.status, s.mesclado_em_servidor_id,
           public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_d
      FROM public.servidores s WHERE s.id = p_destino;

    IF v_o.id IS NULL THEN
        motivo := 'origem_inexistente';
        detalhe := 'O cadastro duplicado nao foi encontrado.';
        RETURN NEXT; RETURN;
    END IF;

    IF v_d.id IS NULL THEN
        motivo := 'destino_inexistente';
        detalhe := 'O cadastro que vai absorver nao foi encontrado.';
        RETURN NEXT; RETURN;
    END IF;

    IF p_origem = p_destino THEN
        motivo := 'destino_igual_origem';
        detalhe := 'Escolha dois cadastros diferentes.';
        RETURN NEXT; RETURN;
    END IF;

    IF v_o.mesclado_em_servidor_id IS NOT NULL THEN
        motivo := 'origem_ja_mesclada';
        detalhe := format('A matricula %s ja foi mesclada em outro cadastro. Nao ha o que mover.',
                          v_o.matricula);
        RETURN NEXT;
    END IF;

    IF v_d.mesclado_em_servidor_id IS NOT NULL THEN
        motivo := 'destino_ja_mesclado';
        detalhe := format('A matricula %s ja foi mesclada em outro cadastro e nao e mais o '
                       || 'cadastro final. Escolha aquele que a absorveu.', v_d.matricula);
        RETURN NEXT;
    END IF;

    -- CPF divergente: e o unico dado que diz que sao a MESMA pessoa. Sem ele nao ha mesclagem que
    -- se possa desfazer depois - o ponto de uma teria virado ponto da outra.
    IF v_o.cpf_norm IS NOT NULL AND v_d.cpf_norm IS NOT NULL
       AND v_o.cpf_norm <> v_d.cpf_norm THEN
        motivo := 'cpf_divergente';
        detalhe := 'Os dois cadastros tem CPF diferente. Se for a mesma pessoa, corrija o CPF '
                || 'errado na ficha antes de mesclar; se nao for, nao mescle.';
        RETURN NEXT;
    END IF;

    IF v_o.cpf_norm IS NULL AND v_d.cpf_norm IS NULL THEN
        motivo := 'sem_cpf';
        detalhe := 'Nenhum dos dois cadastros tem CPF. Sem CPF nao ha como afirmar que sao a '
                || 'mesma pessoa - preencha o CPF na ficha antes de mesclar.';
        RETURN NEXT;
    END IF;

    -- Sobreposicao de escala. Mesma regra de fn_prevent_cross_sector_shift_overlap
    -- (20260826220000): mesma competencia, mesmo dia, escalas diferentes, slots que se cruzam.
    -- O trigger nao alcanca a mesclagem (ele olha escala_diaria; aqui se move escala_mensal), e
    -- por isso a checagem tem que acontecer antes - senao a mesclagem CRIA o estado que ele
    -- existe para impedir, e a folha passa a contar as mesmas horas duas vezes (armadilha 23).
    SELECT string_agg(DISTINCT format('%s/%s dia %s (%s x %s)',
                                      emo.mes, emo.ano, edo.dia, dto.codigo, dtd.codigo), '; ')
      INTO v_lista
      FROM public.escala_diaria edo
      JOIN public.escala_mensal emo ON emo.id = edo.escala_mensal_id
      JOIN public.dicionario_turnos dto ON dto.id = edo.dicionario_turnos_id
      JOIN public.escala_mensal emd ON emd.servidor_id = p_destino
                                   AND emd.mes = emo.mes AND emd.ano = emo.ano
      JOIN public.escala_diaria edd ON edd.escala_mensal_id = emd.id AND edd.dia = edo.dia
      JOIN public.dicionario_turnos dtd ON dtd.id = edd.dicionario_turnos_id
     WHERE emo.servidor_id = p_origem
       AND dto.slots && dtd.slots;

    IF v_lista IS NOT NULL THEN
        motivo := 'escala_sobreposta';
        detalhe := 'Os dois cadastros estao escalados no mesmo dia e horario: ' || v_lista
                || '. Um servidor nao ocupa dois lugares ao mesmo tempo - apague o lancamento '
                || 'que nao aconteceu na grade antes de mesclar.';
        RETURN NEXT;
    END IF;

    -- Colisao de unicidade em qualquer tabela que aponte para servidores. A varredura e por
    -- pg_INDEX (e nao pg_constraint) para alcancar tambem indice unico PARCIAL - ver o cabecalho.
    FOR r IN
        SELECT c.conrelid AS oid,
               c.conrelid::regclass::text AS rel,
               (SELECT a.attname::text
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[i]) AS col
          FROM pg_constraint c
          CROSS JOIN generate_subscripts(c.conkey, 1) AS i
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.servidores'::regclass
           AND (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.confrelid AND a2.attnum = c.confkey[i]) = 'id'
    LOOP
        FOR u IN
            SELECT i.indexrelid::regclass::text AS idx,
                   i.indpred IS NOT NULL AS parcial,
                   COALESCE(pg_get_expr(i.indpred, i.indrelid), 'true') AS pred_idx,
                   (SELECT array_agg(a.attname::text ORDER BY k.ord)
                      FROM unnest((string_to_array(i.indkey::text, ' '))[1:i.indnkeyatts]::int2[])
                           WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                   ) AS cols
              FROM pg_index i
             WHERE i.indrelid = r.oid
               AND i.indisunique
               AND i.indexprs IS NULL          -- indice sobre expressao nao da para comparar
        LOOP
            CONTINUE WHEN u.cols IS NULL OR NOT (r.col = ANY (u.cols));

            v_outras := array_remove(u.cols, r.col);

            IF v_outras IS NULL OR array_length(v_outras, 1) IS NULL THEN
                -- A unicidade e a propria coluna do servidor: qualquer linha no destino colide.
                v_pred := 'true';
            ELSE
                SELECT string_agg(format('d.%I IS NOT DISTINCT FROM o.%I', k, k), ' AND ')
                  INTO v_pred
                  FROM unnest(v_outras) AS k;
            END IF;

            -- O predicado do indice PARCIAL entra na conta: sem ele, dois cadastros com uma
            -- solicitacao ja decidida seriam lidos como colisao e a mesclagem travaria a toa.
            -- Cada lado numa subconsulta propria para as colunas nuas do predicado resolverem
            -- no escopo mais interno, sem ambiguidade entre o e d.
            EXECUTE format(
                'SELECT count(*) FROM (SELECT * FROM %s WHERE %s) o WHERE o.%I = $1 '
                'AND EXISTS (SELECT 1 FROM (SELECT * FROM %s WHERE %s) d '
                            'WHERE d.%I = $2 AND %s)',
                r.rel, u.pred_idx, r.col, r.rel, u.pred_idx, r.col, v_pred
            ) INTO v_qtd USING p_origem, p_destino;

            -- Configuracao do REP que e o proprio par (servidor + equipamento): a duplicata nao
            -- carrega historico nenhum, e descartada pela mesclagem e nao impede - ver secao 6.
            IF v_qtd > 0
               AND r.rel NOT IN ('rep_excecoes_ponto', 'public.rep_excecoes_ponto',
                                 'rep_administradores_parque', 'public.rep_administradores_parque',
                                 'rep_cadastros_fila', 'public.rep_cadastros_fila')
            THEN
                motivo := 'colisao_unicidade';
                detalhe := format(
                    '%s: %s registro(s) do cadastro duplicado ja existem no cadastro que vai '
                    || 'absorver (%s%s). Mover criaria duplicidade - resolva esses registros '
                    || 'antes.',
                    r.rel, v_qtd, u.idx,
                    CASE WHEN u.parcial THEN ', indice parcial' ELSE '' END);
                RETURN NEXT;
            END IF;
        END LOOP;
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid) IS
    'O que impede mesclar p_origem (cadastro duplicado) em p_destino (cadastro que absorve): CPF '
    'divergente, ausencia de CPF nos dois, cadastro ja mesclado, escala sobreposta no mesmo dia e '
    'colisao de unicidade. Vazio = pode mesclar.';

REVOKE ALL ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_impedimentos_mesclagem_servidor(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 6. A MESCLAGEM
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(
    p_origem  uuid,
    p_destino uuid,
    p_motivo  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    -- Campos que descrevem a PESSOA, e por isso podem ser completados a partir do cadastro
    -- duplicado quando faltam no que fica. Lista explicita de proposito: aqui, ao contrario da
    -- varredura de FK, copiar por engano e pior do que nao copiar - coluna nova entra so quando
    -- alguem decidir que ela descreve a pessoa. Fora da lista, deliberadamente: matricula, cargo,
    -- vinculo, unidade, setor e jornada (sao do VINCULO, e o vinculo que fica e o do destino) e
    -- dados bancarios (podem ser a conta do outro contrato).
    c_campos_pessoa constant text[] := ARRAY[
        'cpf', 'pis_pasep', 'data_nascimento', 'sexo', 'nacionalidade', 'naturalidade',
        'nome_mae', 'nome_pai', 'escolaridade', 'estado_civil', 'nome_conjuge',
        'rg_numero', 'rg_orgao_emissor', 'rg_data_emissao',
        'endereco_logradouro', 'endereco_numero', 'bairro', 'cep', 'municipio_residencia',
        'telefone', 'telefone_residencial', 'email',
        'registro_profissional', 'registro_profissional_orgao'
    ];
    -- Configuracao do REP cuja linha E o par (servidor + equipamento). Se o destino ja tem a
    -- mesma linha, a da origem nao tem para onde ir nem o que perder.
    c_descartaveis constant text[] := ARRAY[
        'rep_excecoes_ponto', 'public.rep_excecoes_ponto',
        'rep_administradores_parque', 'public.rep_administradores_parque',
        'rep_cadastros_fila', 'public.rep_cadastros_fila'
    ];
    v_o           record;
    v_d           record;
    v_impedimento text;
    r             record;
    u             record;
    v_outras      text[];
    v_pred        text;
    v_n           bigint;
    v_movidos     jsonb := '{}'::jsonb;
    v_descartados jsonb := '{}'::jsonb;
    v_completados text[] := ARRAY[]::text[];
    v_campo       text;
    v_valor       text;
    v_restantes   bigint;
BEGIN
    IF (SELECT public.get_my_role()) <> 'super_admin'::public.user_role THEN
        RAISE EXCEPTION 'Apenas o Administrador Geral pode mesclar cadastros de servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT s.id, s.nome, s.matricula, public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_o FROM public.servidores s WHERE s.id = p_origem;
    SELECT s.id, s.nome, s.matricula, public.fn_cpf_normalizado(s.cpf) AS cpf_norm
      INTO v_d FROM public.servidores s WHERE s.id = p_destino;

    IF v_o.id IS NULL THEN
        RAISE EXCEPTION 'Cadastro duplicado nao encontrado.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_d.id IS NULL THEN
        RAISE EXCEPTION 'Cadastro de destino nao encontrado.' USING ERRCODE = 'no_data_found';
    END IF;

    -- Todos os impedimentos de uma vez: quem esta na tela precisa ver a lista inteira, nao
    -- descobrir um por vez a cada tentativa.
    SELECT string_agg(imp.detalhe, ' | ')
      INTO v_impedimento
      FROM public.fn_impedimentos_mesclagem_servidor(p_origem, p_destino) imp;

    IF v_impedimento IS NOT NULL THEN
        RAISE EXCEPTION 'Nao e possivel mesclar a matricula % na matricula %: %',
            v_o.matricula, v_d.matricula, v_impedimento
            USING ERRCODE = 'check_violation';
    END IF;

    -- Autoriza o UPDATE de servidor_id em marcacoes_ponto (e SO ele) ate o fim desta transacao.
    PERFORM set_config('sisescala.mesclar_servidor', 'on', true);

    FOR r IN
        SELECT c.conrelid AS oid,
               c.conrelid::regclass::text AS rel,
               (SELECT a.attname::text
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[i]) AS col
          FROM pg_constraint c
          CROSS JOIN generate_subscripts(c.conkey, 1) AS i
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.servidores'::regclass
           AND (SELECT a2.attname
                  FROM pg_attribute a2
                 WHERE a2.attrelid = c.confrelid AND a2.attnum = c.confkey[i]) = 'id'
    LOOP
        -- 6.1 Configuracao do REP que o destino ja tem: descarta a da origem.
        IF r.rel = ANY (c_descartaveis) THEN
            FOR u IN
                SELECT COALESCE(pg_get_expr(i.indpred, i.indrelid), 'true') AS pred_idx,
                       (SELECT array_agg(a.attname::text ORDER BY k.ord)
                          FROM unnest((string_to_array(i.indkey::text, ' '))[1:i.indnkeyatts]::int2[])
                               WITH ORDINALITY AS k(attnum, ord)
                          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                       ) AS cols
                  FROM pg_index i
                 WHERE i.indrelid = r.oid AND i.indisunique AND i.indexprs IS NULL
            LOOP
                CONTINUE WHEN u.cols IS NULL OR NOT (r.col = ANY (u.cols));

                v_outras := array_remove(u.cols, r.col);
                IF v_outras IS NULL OR array_length(v_outras, 1) IS NULL THEN
                    v_pred := 'true';
                ELSE
                    SELECT string_agg(format('d.%I IS NOT DISTINCT FROM o.%I', k, k), ' AND ')
                      INTO v_pred
                      FROM unnest(v_outras) AS k;
                END IF;

                EXECUTE format(
                    'DELETE FROM %s o WHERE o.%I = $1 AND (%s) '
                    'AND EXISTS (SELECT 1 FROM (SELECT * FROM %s WHERE %s) d '
                                'WHERE d.%I = $2 AND %s)',
                    r.rel, r.col, u.pred_idx, r.rel, u.pred_idx, r.col, v_pred
                ) USING p_origem, p_destino;
                GET DIAGNOSTICS v_n = ROW_COUNT;

                IF v_n > 0 THEN
                    v_descartados := v_descartados || jsonb_build_object(
                        r.rel || '.' || r.col,
                        COALESCE((v_descartados ->> (r.rel || '.' || r.col))::bigint, 0) + v_n);
                END IF;
            END LOOP;
        END IF;

        -- 6.2 O resto vai inteiro para o cadastro que fica.
        EXECUTE format('UPDATE %s SET %I = $2 WHERE %I = $1', r.rel, r.col, r.col)
            USING p_origem, p_destino;
        GET DIAGNOSTICS v_n = ROW_COUNT;

        IF v_n > 0 THEN
            v_movidos := v_movidos || jsonb_build_object(r.rel || '.' || r.col, v_n);
        END IF;
    END LOOP;

    -- 6.3 Completa no cadastro que fica o que so o duplicado tinha. NUNCA sobrescreve: se o
    -- destino ja tem valor, ele vence - o cadastro correto e a referencia, e um dado divergente
    -- entre os dois e justamente o que precisa de decisao humana, nao de sobrescrita automatica.
    FOREACH v_campo IN ARRAY c_campos_pessoa LOOP
        EXECUTE format(
            'UPDATE public.servidores d SET %I = o.%I FROM public.servidores o '
            'WHERE d.id = $2 AND o.id = $1 '
            'AND NULLIF(btrim(d.%I::text), '''') IS NULL '
            'AND NULLIF(btrim(o.%I::text), '''') IS NOT NULL',
            v_campo, v_campo, v_campo, v_campo
        ) USING p_origem, p_destino;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN
            v_completados := v_completados || v_campo;
        END IF;
    END LOOP;

    -- 6.4 O cadastro duplicado sai de circulacao, com o rastro de para onde foi.
    UPDATE public.servidores
       SET status = 'Inativo',
           motivo_inativacao = left(
               format('Cadastro duplicado - mesclado na matricula %s.%s',
                      v_d.matricula,
                      CASE WHEN NULLIF(btrim(COALESCE(p_motivo, '')), '') IS NOT NULL
                           THEN ' ' || btrim(p_motivo) ELSE '' END), 500),
           vinculo_multiplo_confirmado = false,
           mesclado_em_servidor_id = p_destino,
           mesclado_em = now(),
           mesclado_por = auth.uid(),
           updated_at = now()
     WHERE id = p_origem;

    -- 6.5 Se nao sobrou nenhum OUTRO cadastro ativo com o mesmo CPF, o que fica deixa de ser
    -- "vinculo multiplo confirmado" - a confirmacao existia por causa da duplicata que acabou de
    -- sair. Mantida quando ainda ha outro vinculo de verdade (pessoa com dois cargos).
    SELECT count(*) INTO v_restantes
      FROM public.servidores s
     WHERE s.id <> p_destino
       AND s.mesclado_em_servidor_id IS NULL
       AND s.status = 'Ativo'
       AND public.fn_cpf_normalizado(s.cpf) IS NOT DISTINCT FROM
           COALESCE(v_d.cpf_norm, v_o.cpf_norm);

    IF v_restantes = 0 THEN
        UPDATE public.servidores
           SET vinculo_multiplo_confirmado = false, updated_at = now()
         WHERE id = p_destino AND vinculo_multiplo_confirmado;
    END IF;

    INSERT INTO public.logs_sistema (user_id, acao, detalhes)
    VALUES (auth.uid(), 'cadastro_servidor_mesclado', jsonb_build_object(
        'origem_id', p_origem,
        'origem_nome', v_o.nome,
        'origem_matricula', v_o.matricula,
        'destino_id', p_destino,
        'destino_nome', v_d.nome,
        'destino_matricula', v_d.matricula,
        'motivo', p_motivo,
        'movidos', v_movidos,
        'descartados', v_descartados,
        'campos_completados', to_jsonb(v_completados),
        'vinculo_multiplo_reavaliado', v_restantes = 0
    ));

    RETURN jsonb_build_object(
        'success', true,
        'origem_matricula', v_o.matricula,
        'destino_matricula', v_d.matricula,
        'nome', v_d.nome,
        'movidos', v_movidos,
        'descartados', v_descartados,
        'campos_completados', to_jsonb(v_completados),
        'message', format('Cadastro %s mesclado na matricula %s.', v_o.matricula, v_d.matricula));
END;
$fn$;

COMMENT ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) IS
    'Move TODO vinculo do cadastro duplicado (p_origem) para o cadastro que fica (p_destino) - '
    'varredura dinamica de pg_constraint -, completa no destino apenas os campos de pessoa que '
    'estavam vazios, e INATIVA a origem apontando para o destino (mesclado_em_servidor_id). Nao '
    'exclui: a matricula pode ter sido impressa em folha e escala. So super_admin. Recusa em '
    'bloco quando ha impedimento (fn_impedimentos_mesclagem_servidor). Registra em logs_sistema.';

REVOKE ALL ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mesclar_servidores(uuid, uuid, text) TO authenticated, service_role;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) O trigger de imutabilidade continua recusando UPDATE comum de marcacao (esperado: erro
--      'Marcacao de ponto e imutavel'):
--
--   UPDATE public.marcacoes_ponto SET ocorrido_em = ocorrido_em + interval '1 minute'
--    WHERE id = (SELECT id FROM public.marcacoes_ponto LIMIT 1);
--
--   2) ...e recusa tambem com o GUC da mesclagem ligado, quando o UPDATE mexe em outra coluna:
--
--   BEGIN;
--     SELECT set_config('sisescala.mesclar_servidor', 'on', true);
--     UPDATE public.marcacoes_ponto SET sintetica = NOT sintetica
--      WHERE id = (SELECT id FROM public.marcacoes_ponto LIMIT 1);   -- esperado: erro
--   ROLLBACK;
--
--   3) Os grupos duplicados que existem hoje (esperado em 04/09/2026: 17 grupos):
--
--   SELECT cpf, quantidade, todos_confirmados FROM public.fn_cadastros_duplicados();
--
--   4) Impedimentos de um par (troque os ids). Esperado: vazio quando a mesclagem passa:
--
--   SELECT * FROM public.fn_impedimentos_mesclagem_servidor('<origem>', '<destino>');
--
--   5) Ensaio SEM efeito - o resumo do que seria movido, sem gravar nada:
--
--   BEGIN;
--     SELECT public.fn_mesclar_servidores('<origem>', '<destino>', 'ensaio');
--   ROLLBACK;
--
--   6) Depois de uma mesclagem de verdade: nada pode ter sobrado apontando para a origem
--      (esperado: so servidores.mesclado_em_servidor_id nao aparece, porque e o proprio rastro):
--
--   SELECT * FROM public.fn_dependencias_servidor('<origem>');
--
--   7) ...e o log tem que registrar o de -> para:
--
--   SELECT acao, detalhes FROM public.logs_sistema
--    WHERE acao = 'cadastro_servidor_mesclado' ORDER BY created_at DESC LIMIT 5;
