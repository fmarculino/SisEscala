-- Migration: Seed virtual overtime shifts
-- Description: Inserts virtual turn codes representing extra hours (HE50 and HE100) with empty conflict slots to bypass overlap checks.

INSERT INTO public.dicionario_turnos (codigo, descricao, horas_computadas, tipo, slots, ativo)
VALUES 
  ('1', '1 Hora Extra Diurna', 1.0, 'Extra', '{}', true),
  ('1.5', '1.5 Horas Extras Diurnas', 1.5, 'Extra', '{}', true),
  ('2', '2 Horas Extras Diurnas', 2.0, 'Extra', '{}', true),
  ('1N', '1 Hora Extra Noturna', 1.0, 'Extra', '{}', true),
  ('1.5N', '1.5 Horas Extras Noturnas', 1.5, 'Extra', '{}', true),
  ('2N', '2 Horas Extras Noturnas', 2.0, 'Extra', '{}', true)
ON CONFLICT (codigo) DO UPDATE 
SET 
  descricao = EXCLUDED.descricao,
  horas_computadas = EXCLUDED.horas_computadas,
  tipo = EXCLUDED.tipo,
  slots = EXCLUDED.slots,
  ativo = EXCLUDED.ativo;
