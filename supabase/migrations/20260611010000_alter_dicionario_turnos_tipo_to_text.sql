-- Description: Altera a coluna tipo de dicionario_turnos de enum para text para permitir múltiplos tipos separados por vírgula.
ALTER TABLE public.dicionario_turnos ALTER COLUMN tipo TYPE text USING tipo::text;
