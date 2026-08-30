-- ============================================================================
-- configuracoes_globais: parar de servir SEGREDO a qualquer conta logada
-- ============================================================================
-- 30/08/2026 - achado 4 da auditoria de seguranca de 30/08/2026.
--
-- O PROBLEMA
--   A policy de leitura, criada em 20260523000000, e' literalmente:
--
--       CREATE POLICY "Permitir leitura de configuracoes para todos"
--         ON public.configuracoes_globais
--         FOR SELECT TO authenticated USING (true);
--
--   `USING (true)` para `authenticated` significa: QUALQUER conta logada le' a tabela inteira
--   pelo PostgREST, inclusive papeis `comum`/`servidor`/`ass_adm`. Em producao (medido em
--   30/08/2026) essa tabela guarda a senha do SMTP e a chave da API de WhatsApp. Ou seja, 63
--   contas podiam ler a credencial de envio da Secretaria com uma requisicao so'.
--
--   A policy de ESCRITA ja' era restrita a admin/super_admin desde a mesma migration. Era so' a
--   leitura que estava aberta - leitura e escrita tinham publicos diferentes, e ninguem notou.
--
-- ⚠️ POR QUE NAO E' UMA DENYLIST POR NOME DE CHAVE
--   A primeira versao deste plano propunha `chave NOT LIKE '%_key'`, `NOT LIKE '%senha%'` etc.
--   MEDIDO EM PRODUCAO, isso NAO resolve: das 59 chaves, so' DUAS tem nome que denuncia segredo
--   (`email_smtp_senha`, `whatsapp_astracall_key`). As outras 19 chaves sensiveis se chamam
--   `unidade_comunicacao_<uuid>` e sao BLOBS JSONB com `email_smtp_senha` e
--   `whatsapp_astracall_key` ANINHADOS DENTRO do valor. O nome delas nao casa com padrao nenhum,
--   entao a denylist deixaria o segredo passar inteiro - duas dessas 19 tem chave de API
--   preenchida hoje.
--
--   Por isso a regra combina as duas formas, e as duas precisam ficar:
--     - o prefixo `unidade_comunicacao_%`, que pega o blob (o caso que a denylist perdia);
--     - a lista explicita das chaves de hoje;
--     - os padroes genericos, que pegam a chave FUTURA que alguem batizar de `..._senha`.
--
-- INVARIANTE ESCOLHIDO: leitura e escrita passam a ter o MESMO publico (admin/super_admin) para
--   as chaves sensiveis. Alinhar os dois e' o que torna a regra facil de sustentar - e nao tira
--   capacidade de ninguem: `rh`/`rh_unidade` ja' NAO conseguiam gravar essas chaves (a policy de
--   escrita nunca os incluiu), entao perder a leitura nao os impede de fazer nada que faziam.
--   ⚠️ EFEITO VISIVEL ESPERADO: em /unidades/[id], o painel "Configuracoes de Comunicacao" passa
--   a aparecer VAZIO para `rh` e `rh_unidade`. Eles ja' recebiam erro ao tentar salvar ali.
--
-- ⚠️ O QUE ESTA MIGRATION NAO FAZ
--   Nao mexe na policy "Portal access to public configs" (TO public, 4 chaves: sobreaviso_%,
--   instituicao_cabecalho_url, terminal_classico_habilitado, timezone). Essas sao lidas SEM
--   LOGIN de proposito - pelo terminal, pelo portal e pelo link magico de sobreaviso. Fechar
--   ali derruba o ciclo de sobreaviso e a tela de login.
--   Nao mexe na policy de escrita.
--   Nao move segredo para variavel de ambiente (decisao do usuario em 30/08/2026: por ora ficam
--   onde estao - o que torna ESTA policy a unica separacao que existe).
--
-- POR QUE O ENVIO NAO QUEBRA
--   `getCommunicationConfigs` (src/utils/comunicacao/enviar.ts) le' com `createAdminClient()`,
--   ou seja, `service_role`, que tem BYPASSRLS. WhatsApp e e-mail continuam funcionando.
--   Conferido tambem: dos 22 sitios que leem esta tabela com a sessao do usuario, NENHUM usa
--   chave de segredo; os 4 que leem a tabela inteira sem filtro apenas passam a receber menos
--   linhas, sem erro.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS + CREATE. Seguro rodar nos dois ambientes.
-- ============================================================================

-- Predicado unico da regra. Existir como FUNCAO (e nao so' dentro da policy) permite que a
-- verificacao no fim deste arquivo teste exatamente o mesmo criterio que a policy aplica - se a
-- policy e a conferencia divergissem, a conferencia nao valeria nada.
CREATE OR REPLACE FUNCTION public.fn_config_e_sensivel(p_chave text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
    SELECT p_chave LIKE 'unidade_comunicacao_%'      -- blob JSONB com credencial ANINHADA
        OR p_chave IN (
             'email_smtp_senha',
             'whatsapp_astracall_key',
             'aviso_ponto_whatsapp_key'              -- ainda nao existe em producao; nasce fechada
           )
        OR p_chave LIKE '%senha%'
        OR p_chave LIKE '%password%'
        OR p_chave LIKE '%secret%'
        OR p_chave LIKE '%token%';
$fn$;

COMMENT ON FUNCTION public.fn_config_e_sensivel(text) IS
    'Fonte unica: a chave de configuracoes_globais carrega credencial? Usada pela policy de '
    'leitura e pela conferencia da migration 20260830100000. O prefixo unidade_comunicacao_ '
    'existe porque essas chaves sao blobs JSONB com senha SMTP e chave de API dentro - nome '
    'nenhum delas denuncia isso.';

-- Fecha de PUBLIC na mesma migration (armadilha 24 do CLAUDE.md: CREATE FUNCTION ja' concede
-- EXECUTE a PUBLIC, e `GRANT ... TO authenticated` nao restringe nada).
REVOKE EXECUTE ON FUNCTION public.fn_config_e_sensivel(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_config_e_sensivel(text) TO authenticated, service_role;


DROP POLICY IF EXISTS "Permitir leitura de configurações para todos" ON public.configuracoes_globais;

CREATE POLICY "Leitura de configuracoes sem segredo" ON public.configuracoes_globais
  FOR SELECT TO authenticated
  USING (
        NOT public.fn_config_e_sensivel(chave)
     OR (SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role)
  );

COMMENT ON POLICY "Leitura de configuracoes sem segredo" ON public.configuracoes_globais IS
    'Substitui "Permitir leitura de configuracoes para todos", que era USING (true) e entregava '
    'a senha do SMTP a qualquer conta logada. O ramo de admin e escrito AQUI DENTRO de proposito: '
    'a policy de escrita (FOR ALL, admin) ja concederia SELECT ao admin por OR, mas depender '
    'disso faria esta policy mentir sobre o proprio efeito quando lida sozinha.';


-- ============================================================================
-- VERIFICACAO - aborta se o resultado divergir do esperado
-- ============================================================================
-- ⚠️ Nao basta "aplicou sem erro". A 20260827030000 aplicou com sucesso e nao mudou NADA (REVOKE
-- de quem nao e' dono so' emite WARNING) - so' se descobriu medindo por fora. Desde entao toda
-- migration de privilegio confere o proprio resultado.
DO $verificacao$
DECLARE
    v_policy_qual text;
    v_sensiveis   integer;
    v_abertas     integer;
    v_blobs       integer;
    v_amostra     text;
BEGIN
    -- 1) A policy antiga NAO pode ter sobrevivido. Se sobreviver, ela e' PERMISSIVA e se soma
    --    com OR a esta - o USING (true) continuaria valendo e a correcao seria inteiramente
    --    inutil, sem nenhum sintoma. E' exatamente a armadilha 24 / o caso da
    --    solicitacoes_transferencia (20260828100000).
    IF EXISTS (
        SELECT 1 FROM pg_policy
         WHERE polrelid = 'public.configuracoes_globais'::regclass
           AND polname = 'Permitir leitura de configurações para todos'
    ) THEN
        RAISE EXCEPTION
            'ABORTADO: a policy antiga "Permitir leitura de configuracoes para todos" ainda '
            'existe. Policies permissivas se somam com OR - o USING (true) dela anularia esta '
            'correcao em silencio.';
    END IF;

    -- 2) A policy nova precisa existir e mencionar o predicado.
    SELECT pg_get_expr(polqual, polrelid) INTO v_policy_qual
      FROM pg_policy
     WHERE polrelid = 'public.configuracoes_globais'::regclass
       AND polname = 'Leitura de configuracoes sem segredo';

    IF v_policy_qual IS NULL THEN
        RAISE EXCEPTION 'ABORTADO: a policy "Leitura de configuracoes sem segredo" nao foi criada.';
    END IF;
    IF v_policy_qual NOT LIKE '%fn_config_e_sensivel%' THEN
        RAISE EXCEPTION 'ABORTADO: a policy existe mas nao usa fn_config_e_sensivel: %', v_policy_qual;
    END IF;

    -- 3) A classificacao tem que cobrir o que ESTE banco realmente guarda. Contagem, nao fe'.
    SELECT count(*) FILTER (WHERE public.fn_config_e_sensivel(chave)),
           count(*) FILTER (WHERE NOT public.fn_config_e_sensivel(chave)),
           count(*) FILTER (WHERE chave LIKE 'unidade_comunicacao_%')
      INTO v_sensiveis, v_abertas, v_blobs
      FROM public.configuracoes_globais;

    RAISE NOTICE 'configuracoes_globais: % chaves sensiveis (das quais % sao blobs de unidade), % abertas.',
        v_sensiveis, v_blobs, v_abertas;

    -- 4) As duas chaves de credencial nomeadas TEM que estar classificadas como sensiveis.
    --    Se alguma existir no banco e escapar do predicado, a correcao nao serviu para nada.
    SELECT string_agg(chave, ', ') INTO v_amostra
      FROM public.configuracoes_globais
     WHERE chave IN ('email_smtp_senha', 'whatsapp_astracall_key', 'aviso_ponto_whatsapp_key')
       AND NOT public.fn_config_e_sensivel(chave);

    IF v_amostra IS NOT NULL THEN
        RAISE EXCEPTION 'ABORTADO: chave de credencial NAO classificada como sensivel: %', v_amostra;
    END IF;

    -- 5) Rede de seguranca contra o proprio predicado: qualquer VALOR que contenha um campo de
    --    credencial nao-vazio precisa estar do lado fechado. Pega o blob que alguem criar amanha
    --    com outro prefixo - o modo de falha que a denylist por nome tinha.
    SELECT string_agg(chave, ', ') INTO v_amostra
      FROM public.configuracoes_globais
     WHERE NOT public.fn_config_e_sensivel(chave)
       AND valor::text ~ '"(email_smtp_senha|whatsapp_astracall_key|senha|password|secret|token)"\s*:\s*"[^"]+"';

    IF v_amostra IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: a(s) chave(s) % tem credencial NAO-VAZIA dentro do valor mas ficaram do '
            'lado ABERTO do predicado. Acrescente-as a fn_config_e_sensivel antes de aplicar.',
            v_amostra;
    END IF;

    -- 6) O outro sentido (20260827050000): revogar demais tambem quebra em silencio. As chaves
    --    que a aplicacao le' com a sessao do usuario TEM que continuar abertas.
    SELECT string_agg(chave, ', ') INTO v_amostra
      FROM (VALUES
              ('timezone'), ('instituicao_cabecalho_url'), ('terminal_classico_habilitado'),
              ('folha_ponto_habilitada'), ('competencias_encerradas'),
              ('tolerancia_extra_minutos_por_marcacao'), ('tolerancia_extra_minutos_diaria'),
              ('justificativa_prazo_dias_uteis'), ('dia_limite_planejamento'),
              ('dias_inativacao_automatica'), ('dias_uteis_transferencia_servidor'),
              ('desfecho_obrigatorio_fechar'), ('antecedencia_minima_ferias_dias'),
              ('sobreaviso_tempo_aceite_minutos'), ('max_horas_escala_servidor')
           ) AS t(chave)
     WHERE public.fn_config_e_sensivel(t.chave);

    IF v_amostra IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: chave(s) usada(s) pela aplicacao com a sessao do usuario ficaram FECHADAS: '
            '%. A tela que a le para de funcionar sem erro visivel.', v_amostra;
    END IF;

    RAISE NOTICE 'OK: leitura de configuracoes_globais fechada para credencial, aberta para o resto.';
END
$verificacao$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) As policies de SELECT que existem agora (esperado: esta + "Portal access to public configs",
--    e NENHUMA com qual = true):
--
--      SELECT polname, pg_get_expr(polqual, polrelid) AS usando
--        FROM pg_policy
--       WHERE polrelid = 'public.configuracoes_globais'::regclass
--         AND polcmd IN ('r', '*')
--       ORDER BY polname;
--
-- 2) O teste que importa e' pelo PostgREST, com um JWT de conta NAO-admin (papel
--    comum/servidor/coordenador). Esperado: as chaves de credencial NAO aparecem.
--
--      GET /rest/v1/configuracoes_globais?select=chave&chave=eq.email_smtp_senha
--      -- esperado: []   (antes: 1 linha, com a senha em valor)
--
--      GET /rest/v1/configuracoes_globais?select=chave&chave=like.unidade_comunicacao_*
--      -- esperado: []   (antes: 19 linhas, com senha e chave de API dentro do JSON)
--
--      GET /rest/v1/configuracoes_globais?select=chave&chave=eq.timezone
--      -- esperado: 1 linha  (nao pode ter fechado junto)
--
-- 3) Com JWT de admin, as tres consultas acima devolvem linha - se nao devolverem, a tela de
--    Configuracoes perdeu acesso ao proprio conteudo.
--
-- 4) Com a chave ANON (sem login), so' as 4 chaves publicas continuam visiveis:
--
--      GET /rest/v1/configuracoes_globais?select=chave
--      -- esperado: sobreaviso_*, instituicao_cabecalho_url, terminal_classico_habilitado, timezone
