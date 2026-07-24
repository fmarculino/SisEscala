-- Migration: Add foto_url to servidores
-- Description: Adds foto_url column to servidores table to store profile photo or camera snapshot

ALTER TABLE public.servidores 
ADD COLUMN IF NOT EXISTS foto_url TEXT;
