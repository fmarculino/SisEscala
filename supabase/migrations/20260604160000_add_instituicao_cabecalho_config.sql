-- Adiciona a chave de configuração do cabeçalho da instituição
INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES (
    'instituicao_cabecalho_url',
    'null'::jsonb,
    'URL da imagem de cabeçalho da instituição (ex: prefeitura/secretaria) utilizada em relatórios, escalas e folhas de ponto.',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
) ON CONFLICT (chave) DO NOTHING;

-- Atualiza a política de RLS para permitir acesso público ao cabeçalho da instituição (necessário para a tela de login)
DROP POLICY IF EXISTS "Portal access to public configs" ON public.configuracoes_globais;
CREATE POLICY "Portal access to public configs" ON public.configuracoes_globais
  FOR SELECT TO public USING (chave LIKE 'sobreaviso_%' OR chave = 'instituicao_cabecalho_url');
