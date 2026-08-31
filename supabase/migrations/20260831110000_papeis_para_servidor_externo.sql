-- ============================================================================
-- Quem GERENCIA ESCALA pode adicionar servidor externo -- nao so' tres papeis
-- ============================================================================
-- 31/08/2026 - decisao do usuario: "adicionar os servidores externos na escala todos podem,
-- desde que estejam dentro dos limites e regras; se estiver fora das regras estabelecidas os RH
-- tem que autorizar".
--
-- O QUE ESTAVA ERRADO
--   As duas funcoes que alimentam o modal "Adicionar Servidor Externo" tinham allowlist FIXA de
--   papel (super_admin/admin/coordenador), escrita em 06/2026 - antes de `rh` (11/08/2026),
--   `ass_adm` (11/08/2026) e `rh_unidade` (12/08/2026) existirem. Nenhuma migration voltou aqui.
--
--   Medido em producao em 31/08/2026: 8 RH Geral, 7 RH da Unidade e 8 Ass. Administrativo -- 23
--   pessoas que a RLS de `escala_mensal` JA autoriza a gravar a escala (20260818170000) e que
--   nao conseguiam escolher quem escalar.
--
--   ATENCAO: o sintoma era DIFERENTE nos dois caminhos do modal, e o antigo e o pior:
--     - busca por nome (`fn_buscar_servidor_para_escala`): "Acesso negado" na tela;
--     - Unidade -> Setor (`get_external_servers_for_scale`): a tela nao trata o erro do RPC, e a
--       lista de servidores volta VAZIA, em silencio -- quem procura conclui que a pessoa nao
--       esta cadastrada. Mesmo modo de falha que a busca por nome de 31/08 veio resolver.
--
-- POR QUE DENYLIST, E NAO "allowlist com mais tres papeis"
--   Mesma escolha (e mesmo motivo) de `fn_painel_sobreaviso_dia` em 20260812080000: allowlist de
--   papel envelhece em silencio -- e preciso lembrar dela a cada papel novo, e ninguem lembrou
--   nas tres vezes anteriores. Aqui o que se quer dizer e "quem opera escala", e o complemento
--   disso e curto e estavel: os papeis do PORTAL DO SERVIDOR (`servidor`, `comum`), que nem
--   enxergam a grade.
--
--   ATENCAO: isto NAO afrouxa o teto de horas. Adicionar alguem a grade continua passando pela
--   conferencia consolidada de `fn_carga_mensal_servidor`/`fn_teto_carga_servidor` (armadilha
--   26), e o excesso continua exigindo Autorizacao Extraordinaria -- que a partir de agora e do
--   RH (migration seguinte). "Todos podem adicionar; o RH autoriza o que sai da regra."
--
-- O QUE ISTO ABRE, DITO EXPLICITAMENTE
--   As duas funcoes sao SECURITY DEFINER e atravessam a RLS de `servidores` de proposito -- e a
--   definicao de servidor externo: ele esta FORA do escopo de quem escala. Entao `ass_adm` e
--   `rh_unidade` passam a poder ler NOME + LOTACAO de servidor ativo de toda a rede. Nao expoe
--   CPF, PIS, e-mail, telefone nem PIN: a projecao das duas funcoes continua sendo a mesma de
--   antes. E a busca por nome continua bounded (minimo 3 caracteres, LIMIT 30) -- nunca devolve
--   a base inteira, que em 31/08/2026 sao 1.393 servidores ativos.
--
--   `get_external_servers_for_scale` NUNCA teve REVOKE FROM PUBLIC (armadilha 24): o
--   `GRANT ... TO authenticated` de 20260603190141 nao restringia nada, e ela ficou executavel
--   por `anon` desde 06/2026. As 20260827* e a 20260830120000 nao a alcancaram. Fechada aqui.
--
-- IDEMPOTENTE: CREATE OR REPLACE (as assinaturas sao as mesmas de antes) + REVOKE/GRANT
-- explicitos + verificacao que aborta.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Fonte unica do criterio, para as duas funcoes nao divergirem
-- ----------------------------------------------------------------------------
-- Existe porque o comentario da 20260831100000 mandava mexer nas duas juntas -- e depender de
-- alguem lembrar disso e exatamente o que produziu a allowlist desatualizada. Agora a regra e
-- uma funcao so.
--
-- `auth.uid() IS NULL` = service_role (script de conferencia, rota de maquina): mesmo bypass de
-- `fn_blocos_previstos_dia`. Nao abre nada para `anon`, cujo EXECUTE e revogado abaixo.
CREATE OR REPLACE FUNCTION public.fn_pode_escalar_servidor_externo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT auth.uid() IS NULL
        OR EXISTS (
            SELECT 1
              FROM public.profiles p
             WHERE p.id = auth.uid()
               AND p.role NOT IN ('servidor'::public.user_role, 'comum'::public.user_role)
        );
$fn$;

COMMENT ON FUNCTION public.fn_pode_escalar_servidor_externo() IS
    'Quem pode escolher servidor de OUTRA lotacao para a grade. Denylist (papeis do Portal ficam '
    'de fora) e nao allowlist, de proposito: allowlist de papel envelhece em silencio a cada '
    'papel novo -- foi o que deixou rh/rh_unidade/ass_adm sem o botao. Fonte unica de '
    'get_external_servers_for_scale e fn_buscar_servidor_para_escala.';


-- ----------------------------------------------------------------------------
-- 2. Caminho Unidade -> Setor -> Servidor
-- ----------------------------------------------------------------------------
-- Corpo identico ao de 20260603190141, exceto o guard. Mantida a mensagem no mesmo formato.
CREATE OR REPLACE FUNCTION public.get_external_servers_for_scale(p_setor_id uuid)
RETURNS TABLE (
  id uuid,
  nome text,
  unidade_id uuid,
  setor_id uuid,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.fn_pode_escalar_servidor_externo() THEN
    RAISE EXCEPTION 'Acesso negado: Perfil sem permissao para buscar servidores externos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT s.id, s.nome, s.unidade_id, s.setor_id, s.status
  FROM public.servidores s
  WHERE s.setor_id = p_setor_id
    AND s.status = 'Ativo'
  ORDER BY s.nome;
END;
$fn$;


-- ----------------------------------------------------------------------------
-- 3. Busca por nome/matricula (31/08/2026)
-- ----------------------------------------------------------------------------
-- Corpo identico ao de 20260831100000, exceto o guard: a normalizacao de acento por
-- `translate`, o escape de curinga, o minimo de 3 caracteres, o LIMIT 30 e a ordem
-- "comeca com o termo primeiro" continuam palavra por palavra.
CREATE OR REPLACE FUNCTION public.fn_buscar_servidor_para_escala(p_termo text)
RETURNS TABLE (
    id            uuid,
    nome          text,
    matricula     text,
    cargo         text,
    unidade_id    uuid,
    unidade_nome  text,
    setor_id      uuid,
    setor_caminho text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_termo text;
BEGIN
    IF NOT public.fn_pode_escalar_servidor_externo() THEN
        RAISE EXCEPTION 'Acesso negado: perfil sem permissao para buscar servidores de outras lotacoes.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Abaixo de 3 caracteres devolve VAZIO em vez de erro: o campo e de busca incremental, e
    -- quem digitou a primeira letra ainda esta digitando - erro ali seria ruido, nao aviso.
    IF p_termo IS NULL OR length(btrim(p_termo)) < 3 THEN
        RETURN;
    END IF;

    v_termo := translate(lower(btrim(p_termo)),
                         'áàâãäéèêëíìîïóòôõöúùûüçñ',
                         'aaaaaeeeeiiiiooooouuuucn');

    -- Curinga digitado e texto, nao operador: quem digita "%" procura por "%", e "_" sozinho
    -- casaria com QUALQUER caractere, devolvendo 30 pessoas sem relacao com a busca.
    v_termo := replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_');

    RETURN QUERY
    SELECT s.id,
           s.nome,
           s.matricula,
           s.cargo,
           s.unidade_id,
           u.nome,
           s.setor_id,
           public.fn_setor_caminho(s.setor_id)
      FROM public.servidores s
      LEFT JOIN public.unidades u ON u.id = s.unidade_id
     WHERE s.status = 'Ativo'
       AND (
             translate(lower(s.nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
                 LIKE '%' || v_termo || '%'
          OR lower(COALESCE(s.matricula, '')) LIKE '%' || v_termo || '%'
       )
     -- Quem COMECA com o termo vem primeiro: digitar "ANA" tem de mostrar as Anas antes de
     -- "MARIANA". Depois, alfabetico, para a ordem ser estavel entre duas buscas iguais.
     ORDER BY (translate(lower(s.nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
                   LIKE v_termo || '%') DESC,
              s.nome
     LIMIT 30;
END;
$fn$;


-- ============================================================================
-- PRIVILEGIOS (armadilha 24)
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_pode_escalar_servidor_externo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_external_servers_for_scale(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_buscar_servidor_para_escala(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_pode_escalar_servidor_externo() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_external_servers_for_scale(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_buscar_servidor_para_escala(text) TO authenticated, service_role;


-- ============================================================================
-- A MIGRATION CONFERE O PROPRIO RESULTADO (armadilha 24)
-- ============================================================================
-- REVOKE de quem nao e dono emite WARNING e segue: sem isto a migration "aplica com sucesso"
-- sem ter mudado nada, e so se descobre medindo por fora.
DO $verificacao$
DECLARE
    v_f text;
BEGIN
    FOREACH v_f IN ARRAY ARRAY[
        'public.fn_pode_escalar_servidor_externo()',
        'public.get_external_servers_for_scale(uuid)',
        'public.fn_buscar_servidor_para_escala(text)'
    ] LOOP
        IF has_function_privilege('anon', v_f, 'EXECUTE') THEN
            RAISE EXCEPTION
                'ABORTADO: % continua executavel por anon. Banco=%, usuario=%.',
                v_f, current_database(), current_user;
        END IF;

        -- Os dois sentidos (a 20260827050000 aprendeu isto): revogar demais derruba a tela com
        -- a mesma discricao com que abrir demais vaza dado.
        IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
            RAISE EXCEPTION 'ABORTADO: % sem EXECUTE para authenticated -- o modal ficaria sem lista.', v_f;
        END IF;
    END LOOP;

    -- O guard tem de ter mesmo trocado de forma: se a allowlist antiga sobreviveu (arquivo
    -- aplicado fora de ordem, por exemplo), rh/rh_unidade/ass_adm continuariam de fora e a
    -- migration teria "passado" sem resolver nada.
    IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('get_external_servers_for_scale', 'fn_buscar_servidor_para_escala')
           AND p.prosrc ILIKE '%coordenador%'
    ) THEN
        RAISE EXCEPTION 'ABORTADO: allowlist de papel ainda presente no corpo -- o guard novo nao substituiu o antigo.';
    END IF;

    RAISE NOTICE 'OK: servidor externo liberado para quem gerencia escala; anon fechado nas tres funcoes.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Logado como RH da Unidade, abrir uma grade e "Adicionar Servidor Externo": digitar 3 letras
--    do nome de alguem de OUTRA unidade. Tem de aparecer, com unidade e caminho do setor.
--
-- 2) No mesmo modal, pelo caminho Unidade -> Setor: a lista de servidores nao pode vir vazia
--    para um setor que tem gente ativa. Era este o sintoma silencioso.
--
-- 3) Repetir como Ass. Administrativo.
--
-- 4) A chave anon nao pode alcancar nenhuma das tres:
--      GET /rest/v1/  (apikey: <ANON>)  -> sem /rpc/get_external_servers_for_scale
--                                       -> sem /rpc/fn_buscar_servidor_para_escala
--
-- 5) O teto continua defendido: adicionar alguem que ja tenha 300h no mes tem de mostrar o
--    aviso de carga (nao e esta migration que decide isso, mas e o que garante que "todos
--    podem adicionar" nao virou "todos podem estourar").
