-- ============================================================================
-- Estrutura de setores do HMM a partir da planilha da unidade (25/08/2026)
-- ============================================================================
--
-- Cria os 87 setores que a planilha do HMM pede e o banco nao tinha, em ate 3 niveis.
-- APLICADA EM PRODUCAO em 25/08/2026 por insercao direta (PostgREST); este arquivo existe para
-- reproduzir a mesma estrutura em homologacao e para o repositorio registrar o que foi feito -
-- as tabelas base de setores nunca estiveram no versionamento (CLAUDE.md, armadilha 2).
--
-- ⚠️ SO CRIA. Nao renomeia, nao inativa e nao apaga nada. Os 101 setores que o HMM ja tinha
-- continuam com os mesmos ids, servidores e escalas - conferido depois de aplicar.
--
-- ⚠️ O ROTULO DO SETOR E COMPARTILHADO ENTRE UNIDADES. `setores` nao tem coluna de nome: o texto
-- vem de `dicionario_setores`, e o mesmo registro serve varias unidades - REGULACAO e RECEPCAO
-- estao em 29 unidades cada. Por isso, onde a planilha do HMM usa outro nome (NIR, NEP, NQSP, TI),
-- esta migration MANTEM o rotulo do banco em vez de renomear: renomear no dicionario mudaria o
-- nome do setor em 28 unidades sem relacao com o HMM.
--
-- Idempotente: cada rotulo e cada setor so e criado se ainda nao existir naquele caminho exato.


-- ----------------------------------------------------------------------------
-- 1. Rotulos que faltavam no dicionario
-- ----------------------------------------------------------------------------
INSERT INTO public.dicionario_setores (nome)
SELECT v.nome
  FROM (VALUES
      ('ADMINISTRATIVO AMENT'),
      ('BRINQUEDOTECA'),
      ('COORDENAÇÃO'),
      ('COORDENAÇÃO ACADÊMICA'),
      ('DIREÇÃO ADMINISTRATIVA'),
      ('DIRETOR ADMINISTRATIVO'),
      ('ADMINISTRATIVO'),
      ('DIREÇÃO CLÍNICA'),
      ('DIRETOR CLÍNICO'),
      ('DIREÇÃO TÉCNICA'),
      ('DIRETOR TÉCNICO'),
      ('AMBULÂNCIA'),
      ('CARDIOLOGIA'),
      ('CLÍNICA CIRÚRGICA'),
      ('CLÍNICA MÉDICA'),
      ('COMISSÃO DE CURATIVOS'),
      ('DIRETOR DE ENFERMAGEM'),
      ('EPIDEMIOLOGIA'),
      ('HEMOVIGILÂNCIA'),
      ('ORTOPEDIA'),
      ('PEDIATRIA - INTERNAÇÃO'),
      ('PEDIATRIA - OBSERVAÇÃO'),
      ('PEDIATRIA - PRONTO ATENDIMENTO'),
      ('PRONTO ATENDIMENTO'),
      ('SALA DE MEDICAÇÃO'),
      ('SALA VERMELHA'),
      ('SUTURA'),
      ('TOMOGRAFIA - OPERACIONAL'),
      ('UCE'),
      ('USG'),
      ('OPERACIONAL - HÓRUS'),
      ('ENFERMARIA'),
      ('NFDC'),
      ('ENTRADA'),
      ('ENTRADA DE VEÍCULOS'),
      ('INTERNAÇÃO'),
      ('SAÍDA DE VEÍCULOS'),
      ('TOMOGRAFIA'),
      ('ARCO CIRÚRGICO'),
      ('GERAL'),
      ('OPERADORES'),
      ('ESCRITURÁRIOS'),
      ('COLETOR DE RESÍDUOS'),
      ('DML/DILUIÇÃO'),
      ('LIMPEZA DE SUPERFÍCIES'),
      ('TELEFONIA'),
      ('COZINHA'),
      ('PRODUÇÃO'),
      ('AUXILIARES'),
      ('PMEC'),
      ('SUPERIOR'),
      ('TÉCNICOS'),
      ('AMENT - ALA PSICOSSOCIAL'),
      ('BUCOMAXILOFACIAL'),
      ('CIRURGIA GERAL'),
      ('CIRURGIA PEDIÁTRICA'),
      ('CIRURGIA VASCULAR'),
      ('CLÍNICOS - CCE'),
      ('COORDENAÇÃO - PRONTO ATENDIMENTO'),
      ('COORDENAÇÃO - PRONTO SOCORRO'),
      ('CSST'),
      ('ESPECIALISTAS - CCE'),
      ('GINECOLOGIA'),
      ('INFECTOLOGIA'),
      ('PEDIATRIA'),
      ('ULTRASSOM'),
      ('UROLOGIA'),
      ('VISITA DA PEDIATRIA')
  ) AS v(nome)
 WHERE NOT EXISTS (SELECT 1 FROM public.dicionario_setores d WHERE d.nome = v.nome);


-- ----------------------------------------------------------------------------
-- 2. Os setores, por nivel
--
--    O caminho (nivel1 > nivel2 > nivel3) e a identidade: um setor so e criado se aquele
--    caminho exato ainda nao existir na unidade. Duplicata ativa+inativa preexistente resolve
--    para a ATIVA (ORDER BY ativo DESC), para nao pendurar filho novo em setor desativado.
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE
    v_unidade uuid;
    v_rec     record;
    v_dic     uuid;
    v_pai     uuid;
    v_criados int := 0;
BEGIN
    SELECT id INTO v_unidade FROM public.unidades WHERE nome LIKE 'HMM%' LIMIT 1;
    IF v_unidade IS NULL THEN
        RAISE NOTICE 'Unidade HMM nao encontrada neste banco - nada a fazer.';
        RETURN;
    END IF;

    FOR v_rec IN
        SELECT * FROM (VALUES
      ('ALA - PSICOSSOCIAL', 'ADMINISTRATIVO AMENT', NULL),
      ('BRINQUEDOTECA', NULL, NULL),
      ('CCIH', 'COORDENAÇÃO', NULL),
      ('COORDENAÇÃO ACADÊMICA', NULL, NULL),
      ('DIREÇÃO ADMINISTRATIVA', NULL, NULL),
      ('DIREÇÃO ADMINISTRATIVA', 'DIRETOR ADMINISTRATIVO', NULL),
      ('DIREÇÃO ADMINISTRATIVA', 'ADMINISTRATIVO', NULL),
      ('DIREÇÃO CLÍNICA', NULL, NULL),
      ('DIREÇÃO CLÍNICA', 'DIRETOR CLÍNICO', NULL),
      ('DIREÇÃO CLÍNICA', 'ADMINISTRATIVO', NULL),
      ('DIREÇÃO TÉCNICA', NULL, NULL),
      ('DIREÇÃO TÉCNICA', 'DIRETOR TÉCNICO', NULL),
      ('DIREÇÃO TÉCNICA', 'ADMINISTRATIVO', NULL),
      ('ENFERMAGEM', 'AMBULÂNCIA', NULL),
      ('ENFERMAGEM', 'CARDIOLOGIA', NULL),
      ('ENFERMAGEM', 'CLÍNICA CIRÚRGICA', NULL),
      ('ENFERMAGEM', 'CLÍNICA MÉDICA', NULL),
      ('ENFERMAGEM', 'COMISSÃO DE CURATIVOS', NULL),
      ('ENFERMAGEM', 'COORDENAÇÃO', NULL),
      ('ENFERMAGEM', 'DIRETOR DE ENFERMAGEM', NULL),
      ('ENFERMAGEM', 'EPIDEMIOLOGIA', NULL),
      ('ENFERMAGEM', 'HEMOVIGILÂNCIA', NULL),
      ('ENFERMAGEM', 'ORTOPEDIA', NULL),
      ('ENFERMAGEM', 'PEDIATRIA - INTERNAÇÃO', NULL),
      ('ENFERMAGEM', 'PEDIATRIA - OBSERVAÇÃO', NULL),
      ('ENFERMAGEM', 'PEDIATRIA - PRONTO ATENDIMENTO', NULL),
      ('ENFERMAGEM', 'PRONTO ATENDIMENTO', NULL),
      ('ENFERMAGEM', 'SALA DE MEDICAÇÃO', NULL),
      ('ENFERMAGEM', 'SALA VERMELHA', NULL),
      ('ENFERMAGEM', 'SUTURA', NULL),
      ('ENFERMAGEM', 'TOMOGRAFIA - OPERACIONAL', NULL),
      ('ENFERMAGEM', 'UCE', NULL),
      ('ENFERMAGEM', 'USG', NULL),
      ('FARMÁCIA', 'OPERACIONAL - HÓRUS', NULL),
      ('FISIOTERAPIA', 'COORDENAÇÃO', NULL),
      ('FISIOTERAPIA', 'UCE', NULL),
      ('FISIOTERAPIA', 'ENFERMARIA', NULL),
      ('NFDC', NULL, NULL),
      ('PORTARIA', 'COORDENAÇÃO', NULL),
      ('PORTARIA', 'ENTRADA', NULL),
      ('PORTARIA', 'ENTRADA DE VEÍCULOS', NULL),
      ('PORTARIA', 'INTERNAÇÃO', NULL),
      ('PORTARIA', 'SAÍDA DE VEÍCULOS', NULL),
      ('PORTARIA', 'SALA VERMELHA', NULL),
      ('RADIOLOGIA', 'TOMOGRAFIA', NULL),
      ('RADIOLOGIA', 'ARCO CIRÚRGICO', NULL),
      ('RECEPÇÃO', 'COORDENAÇÃO', NULL),
      ('RECEPÇÃO', 'GERAL', NULL),
      ('RECEPÇÃO', 'SALA DE MEDICAÇÃO', NULL),
      ('REGULAÇÃO', 'OPERADORES', NULL),
      ('SAME', 'ESCRITURÁRIOS', NULL),
      ('SHL', 'CLÍNICA CIRÚRGICA', NULL),
      ('SHL', 'CLÍNICA MÉDICA', NULL),
      ('SHL', 'COLETOR DE RESÍDUOS', NULL),
      ('SHL', 'DML/DILUIÇÃO', NULL),
      ('SHL', 'LIMPEZA DE SUPERFÍCIES', NULL),
      ('SHL', 'PRONTO ATENDIMENTO', NULL),
      ('SHL', 'TELEFONIA', NULL),
      ('SHL', 'UCE', NULL),
      ('SND', 'COZINHA', NULL),
      ('SND', 'PRODUÇÃO', NULL),
      ('CCE - CENTRO DE CIRURGIAS ELETIVAS HMM', 'FARMÁCIA', 'AUXILIARES'),
      ('CCE - CENTRO DE CIRURGIAS ELETIVAS HMM', 'ADMINISTRATIVO', NULL),
      ('CCE - CENTRO DE CIRURGIAS ELETIVAS HMM', 'SND', 'COZINHA'),
      ('PMEC', NULL, NULL),
      ('PMEC', 'SUPERIOR', NULL),
      ('PMEC', 'TÉCNICOS', NULL),
      ('CORPO CLÍNICO', 'AMENT - ALA PSICOSSOCIAL', NULL),
      ('CORPO CLÍNICO', 'BUCOMAXILOFACIAL', NULL),
      ('CORPO CLÍNICO', 'CARDIOLOGIA', NULL),
      ('CORPO CLÍNICO', 'CIRURGIA GERAL', NULL),
      ('CORPO CLÍNICO', 'CIRURGIA PEDIÁTRICA', NULL),
      ('CORPO CLÍNICO', 'CIRURGIA VASCULAR', NULL),
      ('CORPO CLÍNICO', 'CLÍNICA MÉDICA', NULL),
      ('CORPO CLÍNICO', 'CLÍNICOS - CCE', NULL),
      ('CORPO CLÍNICO', 'COORDENAÇÃO - PRONTO ATENDIMENTO', NULL),
      ('CORPO CLÍNICO', 'COORDENAÇÃO - PRONTO SOCORRO', NULL),
      ('CORPO CLÍNICO', 'CSST', NULL),
      ('CORPO CLÍNICO', 'ESPECIALISTAS - CCE', NULL),
      ('CORPO CLÍNICO', 'GINECOLOGIA', NULL),
      ('CORPO CLÍNICO', 'INFECTOLOGIA', NULL),
      ('CORPO CLÍNICO', 'PEDIATRIA', NULL),
      ('CORPO CLÍNICO', 'PMEC', NULL),
      ('CORPO CLÍNICO', 'PRONTO ATENDIMENTO', NULL),
      ('CORPO CLÍNICO', 'ULTRASSOM', NULL),
      ('CORPO CLÍNICO', 'UROLOGIA', NULL),
      ('CORPO CLÍNICO', 'VISITA DA PEDIATRIA', NULL)
        ) AS t(n1, n2, n3)
        ORDER BY (CASE WHEN t.n3 IS NOT NULL THEN 3 WHEN t.n2 IS NOT NULL THEN 2 ELSE 1 END)
    LOOP
        -- pai: NULL na raiz; senao o setor do caminho ate o nivel anterior
        v_pai := NULL;
        IF v_rec.n2 IS NOT NULL THEN
            SELECT s.id INTO v_pai
              FROM public.setores s
              JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
             WHERE s.unidade_id = v_unidade AND s.parent_id IS NULL AND d.nome = v_rec.n1
             ORDER BY s.ativo DESC NULLS LAST LIMIT 1;
            IF v_pai IS NULL THEN
                RAISE EXCEPTION 'Setor pai nao encontrado: %', v_rec.n1;
            END IF;
        END IF;
        IF v_rec.n3 IS NOT NULL THEN
            SELECT s.id INTO v_pai
              FROM public.setores s
              JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
             WHERE s.unidade_id = v_unidade AND s.parent_id = v_pai AND d.nome = v_rec.n2
             ORDER BY s.ativo DESC NULLS LAST LIMIT 1;
            IF v_pai IS NULL THEN
                RAISE EXCEPTION 'Setor pai nao encontrado: % > %', v_rec.n1, v_rec.n2;
            END IF;
        END IF;

        SELECT id INTO v_dic FROM public.dicionario_setores
         WHERE nome = COALESCE(v_rec.n3, v_rec.n2, v_rec.n1) LIMIT 1;

        -- ja existe naquele caminho? entao nao faz nada (idempotencia)
        PERFORM 1 FROM public.setores s
          WHERE s.unidade_id = v_unidade
            AND s.dicionario_setor_id = v_dic
            AND s.parent_id IS NOT DISTINCT FROM v_pai;
        IF FOUND THEN CONTINUE; END IF;

        INSERT INTO public.setores (unidade_id, parent_id, dicionario_setor_id, ativo)
        VALUES (v_unidade, v_pai, v_dic, true);
        v_criados := v_criados + 1;
    END LOOP;

    RAISE NOTICE 'HMM: % setores criados', v_criados;
END
$mig$;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. Total de setores do HMM (esperado 188 em producao: 101 antes + 87):
--   SELECT count(*) FROM public.setores s
--     JOIN public.unidades u ON u.id = s.unidade_id WHERE u.nome LIKE 'HMM%';
--
-- 2. A arvore inteira, para conferir a olho:
--   WITH RECURSIVE t AS (
--     SELECT s.id, s.parent_id, d.nome, 1 AS nivel, d.nome::text AS caminho
--       FROM public.setores s
--       JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
--       JOIN public.unidades u ON u.id = s.unidade_id
--      WHERE u.nome LIKE 'HMM%' AND s.parent_id IS NULL
--     UNION ALL
--     SELECT s.id, s.parent_id, d.nome, t.nivel + 1, t.caminho || ' > ' || d.nome
--       FROM public.setores s
--       JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
--       JOIN t ON t.id = s.parent_id)
--   SELECT nivel, caminho FROM t ORDER BY caminho;
--
-- 3. Nenhum orfao e nenhum setor sem rotulo (as duas devem vir vazias):
--   SELECT s.id FROM public.setores s WHERE s.parent_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM public.setores p WHERE p.id = s.parent_id);
--   SELECT s.id FROM public.setores s
--     WHERE NOT EXISTS (SELECT 1 FROM public.dicionario_setores d WHERE d.id = s.dicionario_setor_id);
--
-- 4. Caminhos duplicados no HMM (esperado: as 4 duplicatas ativo+inativo preexistentes,
--    que esta migration NAO toca - a limpeza delas e decisao a parte):
--   SELECT s.parent_id, d.nome, count(*) FROM public.setores s
--     JOIN public.dicionario_setores d ON d.id = s.dicionario_setor_id
--     JOIN public.unidades u ON u.id = s.unidade_id
--    WHERE u.nome LIKE 'HMM%' GROUP BY 1,2 HAVING count(*) > 1;
