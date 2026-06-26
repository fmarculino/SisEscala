-- Migration: Add preferenca_turno and carga_horaria_semanal to servidores
-- Description: Adds columns for shift preference and weekly workload, updating existing data based on contract type.

-- 1. Adicionar colunas
ALTER TABLE public.servidores 
ADD COLUMN IF NOT EXISTS preferenca_turno TEXT DEFAULT 'Flexivel' CHECK (preferenca_turno IN ('M', 'T', 'N', 'Flexivel')),
ADD COLUMN IF NOT EXISTS carga_horaria_semanal INTEGER DEFAULT 40;

-- 2. Atualizar dados existentes com base lógica
-- Estagiárias têm carga horária padrão de 30 horas semanais
UPDATE public.servidores
SET carga_horaria_semanal = 30
WHERE vinculo = 'Estagiária';

-- Demais vínculos (Efetiva, Contratada, Concursada, Comissionada) têm carga de 40 horas semanais
UPDATE public.servidores
SET carga_horaria_semanal = 40
WHERE vinculo IN ('Efetiva', 'Contratada', 'Concursada', 'Comissionada') OR vinculo IS NULL;
