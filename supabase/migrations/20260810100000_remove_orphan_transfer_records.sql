-- Migration: Remove registros de transferencia que nunca aconteceram
-- Data: 2026-08-10
--
-- CONTEXTO
--   updateServidor gravava o INSERT em historico_transferencias ANTES do UPDATE em servidores.
--   Quando o UPDATE era recusado, o historico ficava: a ficha exibia uma transferencia que nao
--   ocorreu, e a lotacao da pessoa seguia a mesma.
--
--   A recusa vinha da RLS. A policy "Scoped access for Admins and Coordinators" (20260618080000)
--   foi criada FOR ALL sem WITH CHECK, entao o Postgres reusa a expressao do USING como WITH
--   CHECK. Para admin/coordenador sem acesso_todas_unidades nem acesso_todos_setores - 20 dos 30
--   perfis de producao - a unica via que autoriza e setor_id IN profile_setores. Gravar setor NULO
--   e sempre recusado, porque NULO nao pertence a lista nenhuma. O usuario recebia na tela o texto
--   cru "new row violates row-level security policy for table servidores".
--
-- CASOS CONHECIDOS (producao, medido em 10/08/2026)
--   THIELE SAYURI NASCIMENTO KAWANO - "Assumiu PSS"
--     29/07 13:09, 29/07 13:11 e 30/07 13:20 -> DMAC para setor NULO. Segue lotada em DMAC.
--   KETTELE DAYANY ALBUQUERQUE MOREIRA NEVES - "Disponibilizada para RH"
--     10/08 14:51 e 10/08 14:55 -> DMAC para setor NULO. Segue lotada em DMAC.
--
--   A repeticao em minutos e a pessoa tentando de novo: a mensagem nao dizia o que estava errado.
--
-- ESCOPO
--   So sai o registro cujo destino e NULO E cujo servidor continua lotado em algum setor - ou
--   seja, aquele em que o destino contradiz a lotacao atual, prova de que a transferencia nao
--   surtiu efeito. Transferencia legitima tem destino preenchido e nao e tocada aqui.
--   Idempotente: rodar de novo nao encontra mais nada.
--
-- A CAUSA JA FOI FECHADA NO CODIGO (v1.41.0)
--   - o historico passou a ser gravado DEPOIS do UPDATE;
--   - setor vazio ou fora do escopo e recusado com mensagem, no formulario e na server action;
--   - UPDATE que nao alcanca linha nenhuma deixou de ser anunciado como sucesso.
--   A policy NAO foi alterada: servidor sem setor sairia do escopo de quem o soltou e so
--   super_admin conseguiria edita-lo de novo.

DO $$
DECLARE
    v_removidos INTEGER := 0;
BEGIN
    WITH orfaos AS (
        DELETE FROM public.historico_transferencias h
        USING public.servidores s
        WHERE s.id = h.servidor_id
          AND h.setor_destino_id IS NULL
          AND s.setor_id IS NOT NULL
        RETURNING h.id
    )
    SELECT count(*) INTO v_removidos FROM orfaos;

    RAISE NOTICE 'historico_transferencias: % registro(s) orfao(s) removido(s)', v_removidos;
END $$;

-- CONFERENCIA
--   Deve devolver zero linhas depois de aplicada.
--
-- SELECT h.id,
--        h.created_at,
--        s.matricula,
--        s.nome,
--        h.motivo
--   FROM public.historico_transferencias h
--   JOIN public.servidores s ON s.id = h.servidor_id
--  WHERE h.setor_destino_id IS NULL
--    AND s.setor_id IS NOT NULL
--  ORDER BY h.created_at;
