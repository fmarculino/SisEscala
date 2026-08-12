-- Migration: Adicionar valor 'rh_unidade' ao enum public.user_role
-- Data: 2026-08-12
--
-- CONTEXTO:
--   O perfil 'rh' (20260811130000, "RH Geral" a partir daqui) foi pensado pra um RH central que
--   enxerga tudo. Na pratica ha tambem RH proprio de unidade, que responde ao RH central mas so
--   deveria enxergar a propria unidade. 'rh_unidade' ("RH da Unidade") cobre esse segundo caso -
--   ver docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md para o desenho completo.
--
-- SO' o ALTER TYPE aqui, de proposito: Postgres nao deixa usar um valor de enum recem-adicionado
-- na MESMA transacao que o adiciona ("unsafe use of new value of enum type") - e' por isso que
-- 20260811130000 (o precedente direto, mesmo padrao) tambem e' um migration so' com isto. As
-- policies que passam a citar 'rh_unidade' vao na proxima migration (20260812070000).

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'rh_unidade';
