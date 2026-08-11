-- Migration: Adicionar valor 'rh' ao enum public.user_role
-- Data: 2026-08-11
--
-- CONTEXTO:
--   Criação do perfil 'rh' (Recursos Humanos). Este perfil possui direitos de acesso
--   amplos (mesmos dados de gestão/cadastros/relatórios), porém SEM acesso ao menu SISTEMA
--   (Usuários, Configurações Globais, Backup, Segurança), que é restrito ao Administrador Geral.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'rh';
