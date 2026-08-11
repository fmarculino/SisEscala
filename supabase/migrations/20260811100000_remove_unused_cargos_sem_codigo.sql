-- Migration: remove cargos sem codigo e sem nenhum servidor usando
-- Data: 2026-08-11
--
-- CONTEXTO
--   26 cargos em `cargos` nao tem codigo (nunca vieram do relatorio de RH, nem foram mapeados
--   em cargos_codigos_origem). Pedido do usuario: excluir os que nao estao em uso. Conferido
--   antes de escrever esta migration - servidores.cargo e texto livre, entao "em uso" significa
--   o NOME do cargo aparecer literalmente em algum servidores.cargo:
--
--     22 sem nenhum servidor usando -> APAGADOS aqui.
--     4 com servidor usando -> NAO apagados (Coordenacao 6, Estagiario 2, Enfermeiro(a) 10,
--       Motorista 2). Apagar quebraria o combo de selecao ao editar a ficha desses 20
--       servidores (o formulario casa por nome exato pra pre-selecionar), mesmo sem quebrar o
--       dado gravado.
--
--   Lista travada por ID, nao por "codigo IS NULL" dinamico - uma migration que rode contra um
--   estado futuro diferente (novo cargo sem codigo cadastrado depois de hoje) nao pode apagar
--   algo que nao foi este que revisamos.
--
-- PORTAO: aborta se algum dos 22 tiver ganho uso (servidor com esse cargo) desde a conferencia.

DO $$
DECLARE
    v_ids uuid[] := ARRAY[
        '29239b21-18d6-4ae5-a44a-f254ce12d3e2', -- Administração
        'be8da6a2-ca40-42f1-ade8-06c3ac690051', -- Bucomaxilo
        '193a8b6c-6650-4ae6-b20c-3af23ffe2ff6', -- CAF
        '69283977-fc5b-44e9-adda-33f1ef1597bb', -- Cirurgião
        '75909caf-c947-48cc-a38b-c506ba7e84a8', -- Coordenação I
        'b20ed77a-a73a-4483-b3e6-54f8a282b4a5', -- Coordenação II
        'f362c939-1290-4619-99e8-70ae52abb283', -- Coordenação III
        'afd1bca7-ab96-4d48-bc48-50c94afbd914', -- DAB
        'bc17b8b8-9f21-4e8f-9e72-f9cfdf8e039b', -- Diretoria
        '89651ecf-15ba-47b9-9c67-b94e0554dd5c', -- DMAC (Coordenação III)
        '6d5d3e20-8f74-4ddb-a915-f5700bd541be', -- DMAC (Diretoria)
        '9fcdccc9-2151-485f-98c7-e5b47771805b', -- Fisioterapeuta
        '9234b699-e965-4289-9ea0-50859a073551', -- Gerente de Unidade
        'd0c6d891-9251-4664-9002-5b74c56eba79', -- Laboratório
        '019e0a3d-c740-4c0d-ad13-c749e1fb351b', -- Médico(a)
        '057173db-e9ea-4006-808c-e0c16a4771ef', -- Patrimônio
        '26465610-806b-4f07-bab9-00221b47045f', -- Psicólogo(a)
        'adaa301b-7b8f-4e5b-a532-bb8f298ae936', -- Saúde Mental
        'dec906ab-91e7-48f4-98ec-70dd8a85dabf', -- Técnico(a) em Enfermagem
        '9c3b9d80-ff83-4f2c-b845-b864b389895d', -- Técnico de Informática
        '4a510c48-204f-4144-b324-63085905c34f', -- Técnico em Laboratório
        '24ed6b8f-4a5e-45da-ada3-50cf226e6455'  -- TI Tecnologia e Informática
    ];
    v_em_uso text;
    v_removidos integer;
BEGIN
    SELECT string_agg(DISTINCT c.nome, ', ')
      INTO v_em_uso
      FROM public.cargos c
      JOIN public.servidores s ON btrim(lower(s.cargo)) = btrim(lower(c.nome))
     WHERE c.id = ANY(v_ids);

    IF v_em_uso IS NOT NULL THEN
        RAISE EXCEPTION 'Um ou mais destes cargos ganharam uso desde a conferencia - nao apagar sem revisar de novo: %', v_em_uso;
    END IF;

    DELETE FROM public.cargos WHERE id = ANY(v_ids);
    GET DIAGNOSTICS v_removidos = ROW_COUNT;
    RAISE NOTICE 'cargos removidos: %', v_removidos;
END
$$;

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--   1. Os 22 sumiram (esperado: 0 linhas):
--      SELECT id, nome FROM public.cargos WHERE id IN (
--        '29239b21-18d6-4ae5-a44a-f254ce12d3e2','be8da6a2-ca40-42f1-ade8-06c3ac690051',
--        '193a8b6c-6650-4ae6-b20c-3af23ffe2ff6','69283977-fc5b-44e9-adda-33f1ef1597bb',
--        '75909caf-c947-48cc-a38b-c506ba7e84a8','b20ed77a-a73a-4483-b3e6-54f8a282b4a5',
--        'f362c939-1290-4619-99e8-70ae52abb283','afd1bca7-ab96-4d48-bc48-50c94afbd914',
--        'bc17b8b8-9f21-4e8f-9e72-f9cfdf8e039b','89651ecf-15ba-47b9-9c67-b94e0554dd5c',
--        '6d5d3e20-8f74-4ddb-a915-f5700bd541be','9fcdccc9-2151-485f-98c7-e5b47771805b',
--        '9234b699-e965-4289-9ea0-50859a073551','d0c6d891-9251-4664-9002-5b74c56eba79',
--        '019e0a3d-c740-4c0d-ad13-c749e1fb351b','057173db-e9ea-4006-808c-e0c16a4771ef',
--        '26465610-806b-4f07-bab9-00221b47045f','adaa301b-7b8f-4e5b-a532-bb8f298ae936',
--        'dec906ab-91e7-48f4-98ec-70dd8a85dabf','9c3b9d80-ff83-4f2c-b845-b864b389895d',
--        '4a510c48-204f-4144-b324-63085905c34f','24ed6b8f-4a5e-45da-ada3-50cf226e6455'
--      );
--   2. Os 4 em uso continuam existindo:
--      SELECT nome, ativo FROM public.cargos
--       WHERE nome IN ('Coordenação','Estagiário','Enfermeiro(a)','Motorista');
--   3. Total de cargos caiu em 22:
--      SELECT count(*) FROM public.cargos;  -- esperado: 279 - 22 = 257
