-- ============================================================================
-- OS OUTROS CADASTROS DA MESMA PESSOA — para a GRADE avisar antes de salvar
-- ============================================================================
-- Terceira peca do conjunto de 09/09/2026. Aplicar depois de 20260909130000 e 20260909140000
-- (nao depende delas para funcionar, mas so faz sentido com elas).
--
-- POR QUE EXISTE
--
-- 20260909140000 poe a trava de sobreposicao no banco: a mesma PESSOA nao pode ter dois turnos
-- no mesmo horario, mesmo com duas matriculas. Mas o banco recusando sozinho nao basta — e a
-- mesma razao pela qual src/utils/conflitoEscala.ts existe desde 26/08/2026: o "Salvar
-- Previsao" e um upsert EM LOTE, e uma linha recusada pelo trigger derruba o mes inteiro de
-- todos os servidores da grade, com a mensagem crua do Postgres.
--
-- A grade ja carrega a ocupacao externa (fn_get_monthly_occupancy) e ja sabe avisar "dia 3 do
-- FAGNER ja esta no PATRIMONIO". O que ela nao tinha como saber e que dois servidor_id sao a
-- MESMA PESSOA — servidores e "1 linha = 1 vinculo", e nada no que a grade carrega diz isso.
--
-- ⚠️ POR QUE UMA FUNCAO NOVA, E NAO MEXER EM fn_get_monthly_occupancy: aquela funcao foi criada
-- FORA do versionamento (armadilha 2 — as migrations nao sao o schema completo) e so existe no
-- banco. Recria-la exigiria transcrever um corpo que ninguem tem em arquivo, com o risco de
-- perder algo no caminho — exatamente o modo de falha da armadilha 1. A grade passa a mandar
-- os ids dos irmaos JUNTO em p_servidor_ids, e aquela funcao continua intocada.
--
-- CRITERIO: o mesmo das outras duas migrations do conjunto — cadastro Ativo, nao mesclado,
-- mesmo CPF (11 digitos, ja limpo de pontuacao). Cadastro mesclado nao volta: a duplicata
-- absorvida (armadilha 50) nao pode ressuscitar como vinculo vivo.
--
-- IDEMPOTENTE: CREATE OR REPLACE. Assinatura nova, entao os privilegios sao escritos aqui
-- (armadilha 41: objeto novo nasce com EXECUTE para PUBLIC — armadilha 24).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cadastros_irmaos(p_servidor_ids uuid[])
RETURNS TABLE (servidor_id uuid, irmao_id uuid, irmao_matricula text, irmao_nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT eu.id, o.id, o.matricula, o.nome
      FROM public.servidores eu
      JOIN public.servidores o
        ON o.id <> eu.id
       AND o.status = 'Ativo'
       AND o.mesclado_em_servidor_id IS NULL
       AND length(regexp_replace(COALESCE(o.cpf, ''), '\D', '', 'g')) >= 11
       AND right(regexp_replace(COALESCE(o.cpf, ''), '\D', '', 'g'), 11)
         = right(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g'), 11)
     WHERE eu.id = ANY(p_servidor_ids)
       AND eu.status = 'Ativo'
       AND eu.mesclado_em_servidor_id IS NULL
       AND length(regexp_replace(COALESCE(eu.cpf, ''), '\D', '', 'g')) >= 11
$fn$;

REVOKE ALL ON FUNCTION public.fn_cadastros_irmaos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cadastros_irmaos(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_cadastros_irmaos(uuid[]) IS
    'Os outros cadastros Ativos da mesma pessoa (mesmo CPF) para cada servidor da lista. A '
    'grade usa para avisar de sobreposicao entre matriculas da mesma pessoa ANTES do upsert em '
    'lote, em vez de levar a recusa do trigger. Ver 20260909140000.';

-- ============================================================================
-- CONFERENCIA — roda junto e ABORTA se falhar (armadilha 42: EXECUTA a funcao)
-- ============================================================================
DO $conf$
DECLARE
    v_pessoas  integer;
    v_linhas   integer;
    v_assim    integer;
BEGIN
    SELECT count(*) INTO v_pessoas
      FROM (SELECT right(regexp_replace(COALESCE(cpf, ''), '\D', '', 'g'), 11)
              FROM public.servidores
             WHERE status = 'Ativo' AND mesclado_em_servidor_id IS NULL
               AND length(regexp_replace(COALESCE(cpf, ''), '\D', '', 'g')) >= 11
             GROUP BY 1 HAVING count(*) > 1) x;

    -- Chamada com TODOS os servidores Ativos: tem de devolver exatamente os pares das pessoas
    -- com cadastro duplicado, e nada mais.
    SELECT count(*) INTO v_linhas
      FROM public.fn_cadastros_irmaos(
               (SELECT COALESCE(array_agg(id), '{}') FROM public.servidores WHERE status = 'Ativo'));

    RAISE NOTICE 'pessoas com 2+ cadastros Ativos: % | pares devolvidos: %', v_pessoas, v_linhas;

    -- Simetria: se A e irmao de B, B e irmao de A. Uma relacao torta aqui faria a grade avisar
    -- de um lado e nao do outro.
    SELECT count(*) INTO v_assim
      FROM public.fn_cadastros_irmaos(
               (SELECT COALESCE(array_agg(id), '{}') FROM public.servidores WHERE status = 'Ativo')) a
     WHERE NOT EXISTS (
           SELECT 1 FROM public.fn_cadastros_irmaos(ARRAY[a.irmao_id]) b
            WHERE b.irmao_id = a.servidor_id);

    IF v_assim > 0 THEN
        RAISE EXCEPTION 'ABORTADO: % par(es) sem simetria (A ve B, B nao ve A).', v_assim;
    END IF;

    IF v_pessoas > 0 AND v_linhas = 0 THEN
        RAISE EXCEPTION 'ABORTADO: existem % pessoa(s) com cadastro duplicado e a funcao nao '
                        'devolveu nenhum par.', v_pessoas;
    END IF;

    -- anon nao pode executar (armadilha 24)
    IF has_function_privilege('anon', 'public.fn_cadastros_irmaos(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_cadastros_irmaos.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_cadastros_irmaos(uuid[])', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU fn_cadastros_irmaos — a grade chama com '
                        'a sessao do coordenador.';
    END IF;

    RAISE NOTICE 'fn_cadastros_irmaos ok: simetrica, escopada a authenticated/service_role.';
END;
$conf$;
