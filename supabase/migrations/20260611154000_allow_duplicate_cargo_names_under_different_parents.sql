-- Description: Remove a restrição de unicidade apenas por nome e adiciona a restrição composta (nome, parent_id)
ALTER TABLE public.cargos DROP CONSTRAINT IF EXISTS cargos_nome_key;
ALTER TABLE public.cargos ADD CONSTRAINT cargos_nome_parent_id_key UNIQUE NULLS NOT DISTINCT (nome, parent_id);
