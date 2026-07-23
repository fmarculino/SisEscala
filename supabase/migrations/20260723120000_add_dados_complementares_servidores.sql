-- Migration: Add complementary data columns to public.servidores
-- Description: Adds personal, residential, document, and admission fields for the "Dados Complementares" tab.

ALTER TABLE public.servidores
  ADD COLUMN IF NOT EXISTS data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS sexo TEXT,
  ADD COLUMN IF NOT EXISTS nacionalidade TEXT DEFAULT 'Brasileira',
  ADD COLUMN IF NOT EXISTS naturalidade TEXT,
  ADD COLUMN IF NOT EXISTS nome_mae TEXT,
  ADD COLUMN IF NOT EXISTS nome_pai TEXT,
  ADD COLUMN IF NOT EXISTS escolaridade TEXT,
  ADD COLUMN IF NOT EXISTS estado_civil TEXT,
  ADD COLUMN IF NOT EXISTS nome_conjuge TEXT,
  ADD COLUMN IF NOT EXISTS endereco_logradouro TEXT,
  ADD COLUMN IF NOT EXISTS endereco_numero TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS municipio_residencia TEXT DEFAULT 'Marabá - PA',
  ADD COLUMN IF NOT EXISTS telefone_residencial TEXT,
  ADD COLUMN IF NOT EXISTS rg_numero TEXT,
  ADD COLUMN IF NOT EXISTS rg_orgao_emissor TEXT,
  ADD COLUMN IF NOT EXISTS rg_data_emissao DATE,
  ADD COLUMN IF NOT EXISTS pis_pasep TEXT,
  ADD COLUMN IF NOT EXISTS registro_profissional TEXT,
  ADD COLUMN IF NOT EXISTS registro_profissional_orgao TEXT,
  ADD COLUMN IF NOT EXISTS data_admissao_hmm DATE,
  ADD COLUMN IF NOT EXISTS data_admissao_pmm DATE,
  ADD COLUMN IF NOT EXISTS observacao TEXT;
