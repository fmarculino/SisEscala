-- Migração de Unidade para Setor: ALA - PSICOSSOCIAL -> Setor sob HMM
-- Esta migração é executada com segurança em uma transação única (BEGIN/COMMIT)
-- para garantir a integridade dos dados e o rollback automático em caso de falha.

BEGIN;

DO $$
DECLARE
    v_old_unit_id UUID := '483095ba-09dd-43fa-b221-f5b601b03c52'; -- ALA - PSICOSSOCIAL (Unidade antiga)
    v_hmm_unit_id UUID := 'f248c6d1-952b-42de-b53b-11738625deff'; -- HMM (Unidade de Saúde de destino)
    v_new_sector_id UUID := '0c4368cf-c049-4113-90be-10e82c5f6ff7'; -- Novo ID do setor ALA - PSICOSSOCIAL
    v_dict_sector_id UUID;
    v_old_lat DOUBLE PRECISION;
    v_old_long DOUBLE PRECISION;
    v_old_radius INTEGER;
BEGIN
    -- 1. Obter geolocalização da antiga unidade para aplicar no novo setor (preservando o geofence)
    SELECT latitude, longitude, raio_geofence 
    INTO v_old_lat, v_old_long, v_old_radius
    FROM public.unidades 
    WHERE id = v_old_unit_id;

    -- 2. Garantir o nome no dicionário de setores municipal
    INSERT INTO public.dicionario_setores (nome)
    VALUES ('ALA - PSICOSSOCIAL')
    ON CONFLICT (nome) DO NOTHING;

    SELECT id INTO v_dict_sector_id 
    FROM public.dicionario_setores 
    WHERE nome = 'ALA - PSICOSSOCIAL';

    -- 3. Criar o novo setor 'ALA - PSICOSSOCIAL' sob a unidade HMM
    INSERT INTO public.setores (id, unidade_id, dicionario_setor_id, parent_id, latitude, longitude, raio_geofence, ativo)
    VALUES (
        v_new_sector_id,
        v_hmm_unit_id,
        v_dict_sector_id,
        NULL,
        v_old_lat,
        v_old_long,
        v_old_radius,
        true
    );

    -- 4. Vincular o setor 'ENFERMAGEM' existente como subsetor do novo setor 'ALA - PSICOSSOCIAL'
    -- e movê-lo para a unidade HMM
    UPDATE public.setores
    SET 
        unidade_id = v_hmm_unit_id,
        parent_id = v_new_sector_id
    WHERE unidade_id = v_old_unit_id AND id = '225e432b-05b6-4a51-961d-1cf496464ac0';

    -- 5. Atualizar os servidores da unidade antiga para a unidade HMM
    UPDATE public.servidores
    SET unidade_id = v_hmm_unit_id
    WHERE unidade_id = v_old_unit_id;

    -- 6. Atualizar as escalas mensais da unidade antiga para a unidade HMM
    UPDATE public.escala_mensal
    SET unidade_id = v_hmm_unit_id
    WHERE unidade_id = v_old_unit_id;

    -- 7. Atualizar os logs de sobreaviso
    UPDATE public.logs_sobreaviso
    SET unidade_id = v_hmm_unit_id
    WHERE unidade_id = v_old_unit_id;

    -- 8. Migrar permissões de usuários (profiles e profile_unidades)
    UPDATE public.profiles
    SET unidade_id = v_hmm_unit_id
    WHERE unidade_id = v_old_unit_id;

    INSERT INTO public.profile_unidades (profile_id, unidade_id)
    SELECT profile_id, v_hmm_unit_id
    FROM public.profile_unidades
    WHERE unidade_id = v_old_unit_id
    ON CONFLICT DO NOTHING;

    DELETE FROM public.profile_unidades
    WHERE unidade_id = v_old_unit_id;

    -- 9. Remover a antiga unidade
    DELETE FROM public.unidades
    WHERE id = v_old_unit_id;

    RAISE NOTICE 'Migração de unidade para setor concluída com sucesso!';
END $$;

COMMIT;
