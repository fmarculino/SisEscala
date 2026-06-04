-- Adicionar coluna logo_url nas tabelas de unidades e setores
ALTER TABLE public.unidades ADD COLUMN logo_url TEXT;
ALTER TABLE public.setores ADD COLUMN logo_url TEXT;

-- Criar o bucket de armazenamento de logos se não existir
INSERT INTO storage.buckets (id, name, public) 
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- Criar políticas RLS para o bucket 'logos' na tabela storage.objects
DROP POLICY IF EXISTS "Acesso publico de leitura para logos" ON storage.objects;
CREATE POLICY "Acesso publico de leitura para logos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'logos');

DROP POLICY IF EXISTS "Admins podem inserir logos" ON storage.objects;
CREATE POLICY "Admins podem inserir logos" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'logos');

DROP POLICY IF EXISTS "Admins podem atualizar logos" ON storage.objects;
CREATE POLICY "Admins podem atualizar logos" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING (bucket_id = 'logos');

DROP POLICY IF EXISTS "Admins podem deletar logos" ON storage.objects;
CREATE POLICY "Admins podem deletar logos" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (bucket_id = 'logos');
