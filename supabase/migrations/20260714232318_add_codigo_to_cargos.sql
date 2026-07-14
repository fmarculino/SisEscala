-- Migration: Add code column to cargos and fix triggers
-- Description: Adds a codigo column with unique constraint to cargos table, and updates the sync trigger function to support ' / ' as well as ' > '.

ALTER TABLE public.cargos ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE public.cargos DROP CONSTRAINT IF EXISTS cargos_codigo_key;
ALTER TABLE public.cargos ADD CONSTRAINT cargos_codigo_key UNIQUE (codigo);

-- Update the sync trigger function to handle both ' / ' and ' > '
CREATE OR REPLACE FUNCTION public.sync_servidor_cargo_id_by_text_path()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_parts TEXT[];
  v_c1_id UUID;
  v_c2_id UUID;
  v_c3_id UUID;
  v_final_cargo_id UUID;
BEGIN
  -- Se o campo cargo_id for enviado diretamente e o cargo (texto) não mudou, respeitar
  IF NEW.cargo_id IS NOT NULL AND (TG_OP = 'UPDATE' AND NEW.cargo = OLD.cargo) THEN
    RETURN NEW;
  END IF;

  -- Se o texto do cargo estiver vazio
  IF NEW.cargo IS NULL OR trim(NEW.cargo) = '' THEN
    NEW.cargo_id := NULL;
    RETURN NEW;
  END IF;

  -- Separar o cargo por ' / ' ou ' > ' para identificar a hierarquia
  IF position(' / ' in NEW.cargo) > 0 THEN
    v_parts := string_to_array(NEW.cargo, ' / ');
  ELSE
    v_parts := string_to_array(NEW.cargo, ' > ');
  END IF;

  -- Resolver Nível 1
  SELECT id INTO v_c1_id FROM public.cargos WHERE nivel = 1 AND nome = trim(v_parts[1]);
  
  -- Se o nível 1 não existir, cadastrá-lo
  IF v_c1_id IS NULL THEN
    INSERT INTO public.cargos (nome, nivel, parent_id, ativo)
    VALUES (trim(v_parts[1]), 1, NULL, true)
    RETURNING id INTO v_c1_id;
  END IF;
  
  v_final_cargo_id := v_c1_id;

  -- Resolver Nível 2
  IF array_length(v_parts, 1) >= 2 THEN
    SELECT id INTO v_c2_id FROM public.cargos WHERE nivel = 2 AND nome = trim(v_parts[2]) AND parent_id = v_c1_id;
    
    -- Se o nível 2 não existir, cadastrá-lo
    IF v_c2_id IS NULL THEN
      INSERT INTO public.cargos (nome, nivel, parent_id, ativo)
      VALUES (trim(v_parts[2]), 2, v_c1_id, true)
      RETURNING id INTO v_c2_id;
    END IF;
    
    v_final_cargo_id := v_c2_id;
  END IF;

  -- Resolver Nível 3
  IF array_length(v_parts, 1) >= 3 THEN
    SELECT id INTO v_c3_id FROM public.cargos WHERE nivel = 3 AND nome = trim(v_parts[3]) AND parent_id = v_c2_id;
    
    -- Se o nível 3 não existir, cadastrá-lo
    IF v_c3_id IS NULL THEN
      INSERT INTO public.cargos (nome, nivel, parent_id, ativo)
      VALUES (trim(v_parts[3]), 3, v_c2_id, true)
      RETURNING id INTO v_c3_id;
    END IF;
    
    v_final_cargo_id := v_c3_id;
  END IF;

  -- Associar o cargo_id final resolvido ao servidor
  NEW.cargo_id := v_final_cargo_id;

  RETURN NEW;
END;
$function$;
