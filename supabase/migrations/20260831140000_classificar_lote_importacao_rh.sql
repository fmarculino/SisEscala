-- Migration: classificacao em lote para a nova importacao de planilha em /servidores/pendencias
-- Data: 2026-08-31
--
-- Plano: sessao de 31/08/2026 que promoveu 41 servidores do HMM-SND na mao (script em
-- scratchpad, sessao gerada manualmente para admin@admin.com, fn_promover_pendencia_rh chamada
-- uma a uma). O usuario achou o processo demorado e pediu uma tela dentro de
-- /servidores/pendencias para RH Geral/RH da Unidade fazerem isso sozinhos, por CSV.
--
-- O QUE ESTA FUNCAO FAZ
--   Recebe um lote de linhas (idx, cpf, matricula) vindas do CSV parseado no servidor (Next.js) e
--   devolve, para cada linha, o que ja existe em `servidores` e em `importacao_rh_pendentes` (nao
--   promovida) que bate por CPF OU matricula -- exatamente a mesma logica que rodei na mao hoje em
--   scratchpad/classificar.mjs, agora dentro do banco para nao precisar de N chamadas por linha.
--
--   CPF tem prioridade sobre matricula no casamento com a pendencia (mesmo criterio de hoje): foi
--   assim que ZULEIDE SILVA MARQUES NUNES foi encontrada mesmo com o CPF da planilha errado --
--   o CPF dela na planilha tinha um typo, mas a matricula batia com a pendencia, cujo CPF (esse
--   sim correto) e o que de fato e gravado por fn_promover_pendencia_rh (ela le v_pend.cpf_normalizado,
--   nunca o que o cliente manda).
--
-- SECURITY DEFINER, mesma barra de fn_cpf_ja_cadastrado/fn_pendencia_rh_por_cpf (20260809110000/
-- 20260812050000): e leitura de classificacao que precisa enxergar a base inteira para nao deixar
-- passar despercebido um cadastro ja existente em outra unidade -- e' o mesmo raciocinio que fez
-- os dois casos JA_E_SERVIDOR de hoje (DANIEL, TAMARA) serem descobertos, nao silenciosamente
-- duplicados.
--
-- Papel: identico ao de fn_promover_pendencia_rh (20260812100000) -- super_admin, admin,
-- coordenador, rh, rh_unidade. Nao adiciono papel novo a fn_promover_pendencia_rh nem a
-- fn_atualizar_cadastro_via_pendencia_rh: elas ja aceitam rh/rh_unidade desde 12/08/2026.
--
-- IDEMPOTENTE: CREATE OR REPLACE. Seguro rodar nos dois ambientes (CLAUDE.md armadilha 3).


CREATE OR REPLACE FUNCTION public.fn_classificar_lote_importacao_rh(p_linhas jsonb)
RETURNS TABLE (
    idx                             integer,
    cpf_normalizado                 text,
    matricula                       text,
    cpf_digito_valido               boolean,
    servidor_id                     uuid,
    servidor_nome                   text,
    servidor_matricula              text,
    servidor_unidade_id             uuid,
    servidor_unidade_nome           text,
    servidor_status                 text,
    servidor_email                  text,
    servidor_telefone               text,
    servidor_pin_definido           boolean,
    pendencia_id                    uuid,
    pendencia_nome                  text,
    pendencia_matricula             text,
    pendencia_unidade_id            uuid,
    pendencia_unidade_nome          text,
    pendencia_departamento_origem   text,
    pendencia_vinculo_adicional     boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    IF (SELECT get_my_role()) NOT IN ('super_admin'::public.user_role, 'admin'::public.user_role,
        'coordenador'::public.user_role, 'rh'::public.user_role, 'rh_unidade'::public.user_role) THEN
        RAISE EXCEPTION 'Apenas administradores, diretores, coordenadores e RH podem classificar planilha de importacao.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH linhas AS (
        SELECT (l->>'idx')::integer                                AS idx,
               public.fn_cpf_normalizado(l->>'cpf')                AS cpf_normalizado,
               NULLIF(btrim(l->>'matricula'), '')                  AS matricula
          FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) AS l
    ),
    serv AS (
        -- Um servidor por linha: prioriza casamento por CPF; matricula so decide quando o CPF
        -- da linha nao achou ninguem (LATERAL + ORDER BY + LIMIT 1, mesmo criterio de prioridade
        -- usado na classificacao manual de hoje).
        SELECT l.idx, s.*
          FROM linhas l
          LEFT JOIN LATERAL (
                SELECT sv.id, sv.nome, sv.matricula, sv.unidade_id, sv.status, sv.email,
                       sv.telefone, sv.pin_acesso,
                       (l.cpf_normalizado IS NOT NULL AND sv.cpf = l.cpf_normalizado) AS via_cpf
                  FROM public.servidores sv
                 WHERE (l.cpf_normalizado IS NOT NULL AND sv.cpf = l.cpf_normalizado)
                    OR (l.matricula IS NOT NULL AND sv.matricula = l.matricula)
                 ORDER BY via_cpf DESC
                 LIMIT 1
          ) s ON true
    ),
    pend AS (
        SELECT l.idx, p.*
          FROM linhas l
          LEFT JOIN LATERAL (
                SELECT ip.id, ip.nome, ip.matricula, ip.unidade_id, ip.departamento_origem,
                       ip.vinculo_adicional_de_cpf,
                       (l.cpf_normalizado IS NOT NULL AND ip.cpf_normalizado = l.cpf_normalizado) AS via_cpf
                  FROM public.importacao_rh_pendentes ip
                 WHERE ip.promovido_em IS NULL
                   AND ((l.cpf_normalizado IS NOT NULL AND ip.cpf_normalizado = l.cpf_normalizado)
                     OR (l.matricula IS NOT NULL AND ip.matricula = l.matricula))
                 ORDER BY via_cpf DESC
                 LIMIT 1
          ) p ON true
    )
    SELECT l.idx,
           l.cpf_normalizado,
           l.matricula,
           (l.cpf_normalizado IS NOT NULL AND public.fn_cpf_digito_valido(l.cpf_normalizado)),
           s.id, s.nome, s.matricula, s.unidade_id, su.nome, s.status, s.email, s.telefone,
           (s.pin_acesso IS NOT NULL),
           p.id, p.nome, p.matricula, p.unidade_id, pu.nome, p.departamento_origem, p.vinculo_adicional_de_cpf
      FROM linhas l
      LEFT JOIN serv s ON s.idx = l.idx
      LEFT JOIN pend p ON p.idx = l.idx
      LEFT JOIN public.unidades su ON su.id = s.unidade_id
      LEFT JOIN public.unidades pu ON pu.id = p.unidade_id
     ORDER BY l.idx;
END;
$fn$;

COMMENT ON FUNCTION public.fn_classificar_lote_importacao_rh(jsonb) IS
    'Classifica em lote as linhas de um CSV de importacao contra servidores e '
    'importacao_rh_pendentes (nao promovida), por CPF (prioridade) ou matricula. Fonte de dados '
    'para a tela de revisao da nova importacao por planilha em /servidores/pendencias. Mesmo '
    'papel de fn_promover_pendencia_rh (super_admin/admin/coordenador/rh/rh_unidade).';


-- ============================================================================
-- PRIVILEGIOS (armadilha 24 do CLAUDE.md)
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_classificar_lote_importacao_rh(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_classificar_lote_importacao_rh(jsonb) TO authenticated, service_role;


-- ============================================================================
-- A MIGRATION CONFERE O PROPRIO RESULTADO (armadilha 24/39)
-- ============================================================================
DO $verificacao$
BEGIN
    IF has_function_privilege('anon', 'public.fn_classificar_lote_importacao_rh(jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: fn_classificar_lote_importacao_rh continua executavel por anon. Banco=%, usuario=%.',
            current_database(), current_user;
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.fn_classificar_lote_importacao_rh(jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated sem EXECUTE em fn_classificar_lote_importacao_rh -- a tela de importacao nao funcionaria para nenhum papel.';
    END IF;

    RAISE NOTICE 'OK: fn_classificar_lote_importacao_rh criada, fechada para anon, aberta para authenticated.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Reclassificar o lote de hoje deve achar todos os 41 ja promovidos (pendencia_id NULL,
--    servidor_id preenchido, servidor_unidade_id = HMM):
--
--    SELECT * FROM public.fn_classificar_lote_importacao_rh(
--      '[{"idx":0,"cpf":"01643786261","matricula":"56182"}]'::jsonb
--    );
--    -- esperado: servidor_id preenchido (AMANDA DE PAULA WILLE), pendencia_id NULL
--
-- 2) Um CPF que nunca existiu em lugar nenhum deve devolver tudo NULL, exceto idx/cpf/matricula:
--
--    SELECT * FROM public.fn_classificar_lote_importacao_rh(
--      '[{"idx":0,"cpf":"00000000000","matricula":"999999"}]'::jsonb
--    );
--
-- 3) A chave anon nao pode alcancar a funcao (confirmar com a chave anon direto via REST).
