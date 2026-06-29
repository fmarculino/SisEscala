-- Migration: Add cargo column to folha_ponto
-- Description: Adds a nullable text cargo column to allow saving historical job titles for employees at the time of their timesheet.

ALTER TABLE public.folha_ponto ADD COLUMN IF NOT EXISTS cargo TEXT;
