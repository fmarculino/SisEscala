-- Migration: Libera leitura publica da config que controla o botao do terminal classico
--
-- A tela de login (/login) nao tem sessao Supabase Auth e le configuracoes_globais como
-- usuario anonimo. A policy "Portal access to public configs" so liberava sobreaviso_% e
-- instituicao_cabecalho_url - a chave nova terminal_classico_habilitado (toggle do botao
-- "Confirmacao de Presenca") ficava bloqueada pela RLS, entao o login nunca via o valor
-- salvo em Configuracoes e o botao continuava sempre visivel mesmo desabilitado.

DROP POLICY IF EXISTS "Portal access to public configs" ON public.configuracoes_globais;
CREATE POLICY "Portal access to public configs" ON public.configuracoes_globais
  FOR SELECT TO public USING (
    chave LIKE 'sobreaviso_%'
    OR chave = 'instituicao_cabecalho_url'
    OR chave = 'terminal_classico_habilitado'
  );
