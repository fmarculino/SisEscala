-- Migration: Add bank fields to servidores
-- Description: Adds banco_nome, agencia_numero, conta_numero, conta_tipo, chave_pix columns to public.servidores table

ALTER TABLE public.servidores 
ADD COLUMN IF NOT EXISTS banco_nome TEXT,
ADD COLUMN IF NOT EXISTS agencia_numero TEXT,
ADD COLUMN IF NOT EXISTS conta_numero TEXT,
ADD COLUMN IF NOT EXISTS conta_tipo TEXT DEFAULT 'Corrente',
ADD COLUMN IF NOT EXISTS chave_pix TEXT;
