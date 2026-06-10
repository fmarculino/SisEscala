-- Migration: Corrigir slots para validação de conflitos de sobreaviso
-- Description: Atualiza a coluna slots de dicionario_turnos para os tipos de sobreaviso novos.

UPDATE public.dicionario_turnos
SET slots = ARRAY['M', 'T', 'N']
WHERE codigo = 'MTNS' AND tipo = 'Sobreaviso';

UPDATE public.dicionario_turnos
SET slots = ARRAY['M', 'T']
WHERE codigo = 'D12' AND tipo = 'Sobreaviso';

UPDATE public.dicionario_turnos
SET slots = ARRAY['N']
WHERE codigo = 'N12' AND tipo = 'Sobreaviso';

UPDATE public.dicionario_turnos
SET slots = ARRAY['M']
WHERE codigo = 'M6' AND tipo = 'Sobreaviso';

UPDATE public.dicionario_turnos
SET slots = ARRAY['T']
WHERE codigo = 'T6' AND tipo = 'Sobreaviso';
