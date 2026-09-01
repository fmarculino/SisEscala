-- ============================================================================
-- Achar o servidor externo pelo NOME, sem saber onde ele esta lotado
-- ============================================================================
-- 31/08/2026 - pedido do usuario.
--
-- POR QUE
--   O modal "Adicionar Servidor Externo" da grade so' oferecia o caminho
--   Unidade -> Setor -> Servidor. Quem escala precisa entao saber a LOTACAO da pessoa antes de
--   achar a pessoa - e e' exatamente isso que ninguem sabe: sao 33 unidades e 646 setores, com
--   nomes repetidos em ramos diferentes (por isso o setor ja' aparece em arvore desde
--   `formatSectorsHierarchy`). Errar a unidade nao da' erro nenhum: a lista de servidores vem
--   vazia, e quem procura conclui que a pessoa nao esta cadastrada.
--
--   Esta funcao inverte a ordem: digita-se o nome (ou a matricula) e a LOTACAO vem junto na
--   resposta, como informacao - nao como pergunta.
--
-- ----------------------------------------------------------------------------
-- BOUNDED POR TERMO, NUNCA LISTA TUDO
-- ----------------------------------------------------------------------------
-- Mesmo padrao (e mesmo motivo) de `fn_buscar_pendencia_rh_por_termo` e da propria
-- `get_external_servers_for_scale`: SECURITY DEFINER para atravessar a RLS de `servidores` - um
-- coordenador so' enxerga o proprio escopo, e servidor externo e', por definicao, de fora dele.
-- Em troca, a funcao NUNCA devolve a base inteira: exige 3 caracteres e corta em 30 linhas.
--
-- ATENCAO: sao 1.393 servidores ativos em producao (31/08/2026). Carregar a lista toda no
-- navegador estaria acima do corte SILENCIOSO de 1.000 linhas do PostgREST (armadilha 8) e
-- devolveria uma busca que parece funcionar e nao acha parte das pessoas.
--
-- ATENCAO: a allowlist de papel e' IDENTICA a de `get_external_servers_for_scale`
-- (super_admin/admin/coordenador), de proposito: esta funcao alimenta o mesmo botao, e quem hoje
-- nao consegue adicionar servidor externo tambem nao passa a poder consulta-lo. Ampliar aqui
-- daria a um papel a leitura do nome e da lotacao de TODA a rede sem que ninguem tenha decidido
-- isso. Se `rh`/`rh_unidade` precisarem do botao, as DUAS funcoes mudam juntas.
--
-- ATENCAO: busca acento-insensivel por `translate`, nao por `unaccent` - a extensao nao esta
-- instalada neste banco. Quem digita num campo de filtro raramente acentua, e o cadastro e'
-- cheio de acento; sem isso a busca por "JOSE" nao acha "JOSE" com acento e induz a mesma
-- conclusao errada que a tela antiga produzia. Espelha `normalizar()` de
-- `src/components/ui/SelectComBusca.tsx`.
--
-- ATENCAO: so' `status = 'Ativo'`, como a RPC irma - inativo fica fora da ESCOLHA (armadilha 28).
--
-- IDEMPOTENTE: CREATE OR REPLACE + REVOKE/GRANT explicitos.
-- ============================================================================


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
    -- `auth.uid() IS NULL` = service_role (script de conferencia, rota de maquina) - mesmo bypass
    -- de `fn_blocos_previstos_dia`. Nao abre nada para anon: o EXECUTE dele foi revogado abaixo,
    -- entao anon sequer alcanca esta linha.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.role IN ('super_admin'::public.user_role, 'admin'::public.user_role,
                          'coordenador'::public.user_role)
    ) THEN
        RAISE EXCEPTION 'Acesso negado: perfil sem permissao para buscar servidores de outras lotacoes.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Abaixo de 3 caracteres devolve VAZIO em vez de erro: o campo e' de busca incremental, e
    -- quem digitou a primeira letra ainda esta digitando - erro ali seria ruido, nao aviso.
    IF p_termo IS NULL OR length(btrim(p_termo)) < 3 THEN
        RETURN;
    END IF;

    v_termo := translate(lower(btrim(p_termo)),
                         'áàâãäéèêëíìîïóòôõöúùûüçñ',
                         'aaaaaeeeeiiiiooooouuuucn');

    -- Curinga digitado e' texto, nao operador: quem digita "%" procura por "%", e "_" sozinho
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

COMMENT ON FUNCTION public.fn_buscar_servidor_para_escala(text) IS
    'Busca servidor ATIVO por nome/matricula em toda a rede, com a lotacao (unidade + caminho do '
    'setor) na resposta, para o modal "Adicionar Servidor Externo" da grade. SECURITY DEFINER '
    'de proposito - servidor externo esta fora do escopo de RLS de quem escala - e bounded: '
    'minimo 3 caracteres, LIMIT 30. Allowlist de papel identica a get_external_servers_for_scale; '
    'ao mexer em uma, mexa na outra.';


-- ============================================================================
-- PRIVILEGIOS (armadilha 24)
-- ============================================================================
-- `CREATE FUNCTION` ja' concede EXECUTE a PUBLIC - `GRANT ... TO authenticated` nao restringe
-- nada sozinho. A tela chama esta funcao com usuario logado, entao: fora PUBLIC e anon, dentro
-- authenticated.
REVOKE ALL ON FUNCTION public.fn_buscar_servidor_para_escala(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_buscar_servidor_para_escala(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_buscar_servidor_para_escala(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_buscar_servidor_para_escala(text) TO service_role;


-- ============================================================================
-- A MIGRATION CONFERE O PROPRIO RESULTADO
-- ============================================================================
-- REVOKE de quem nao e' dono da funcao emite WARNING e segue - a migration "aplica com sucesso"
-- sem ter mudado nada. So' se descobre medindo (armadilha 24).
DO $verificacao$
BEGIN
    IF has_function_privilege('anon', 'public.fn_buscar_servidor_para_escala(text)', 'EXECUTE') THEN
        RAISE EXCEPTION
            'ABORTADO: fn_buscar_servidor_para_escala continua executavel por anon. Banco=%, usuario=%, dono=%. REVOKE de quem nao e dono so emite WARNING.',
            current_database(), current_user,
            (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'fn_buscar_servidor_para_escala');
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.fn_buscar_servidor_para_escala(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated sem EXECUTE - o campo de busca do modal nao acharia ninguem.';
    END IF;

    RAISE NOTICE 'OK: fn_buscar_servidor_para_escala criada, fechada para anon e aberta para authenticated.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Logado como coordenador, no modal "Adicionar Servidor Externo": digitar 3 letras do nome de
--    alguem de OUTRA unidade. Tem de aparecer, com a unidade e o caminho do setor embaixo.
--
-- 2) Acento: buscar "JOSE" tem de trazer os "JOSE" acentuados, e vice-versa.
--
-- 3) Matricula: digitar a matricula inteira tem de trazer exatamente uma pessoa.
--
-- 4) Servidor inativado nao pode aparecer na busca.
--
-- 5) A funcao nao pode aparecer para a chave anon:
--      GET /rest/v1/  (apikey: <ANON>)  -> sem /rpc/fn_buscar_servidor_para_escala
