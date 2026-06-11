-- Migration: Add ignora_janela_presenca to servidores
-- Description: Adds a boolean flag to servidores to allow bypassing presence confirmation window checks.

ALTER TABLE public.servidores ADD COLUMN IF NOT EXISTS ignora_janela_presenca BOOLEAN DEFAULT false;
