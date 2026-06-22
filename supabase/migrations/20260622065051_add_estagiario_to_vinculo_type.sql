-- Migration: add_estagiario_to_vinculo_type
-- Description: Adds 'Estagiária' to the public.vinculo_type enum type.

ALTER TYPE public.vinculo_type ADD VALUE IF NOT EXISTS 'Estagiária';
