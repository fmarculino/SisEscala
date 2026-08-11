-- Migration: Adicionar valor 'ass_adm' ao enum public.user_role
-- Data: 2026-08-11
--
-- CONTEXTO:
--   Criacao do perfil 'ass_adm' (Ass. Administrativo). Este perfil possui
--   as mesmas permissoes de acesso do perfil 'coordenador'.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'ass_adm';
