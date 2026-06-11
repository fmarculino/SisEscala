-- Description: Adiciona o campo cpf na tabela servidores
ALTER TABLE public.servidores ADD COLUMN IF NOT EXISTS cpf text;
