-- Adiciona colunas de geolocalização à tabela setores se não existirem
ALTER TABLE public.setores ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.setores ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.setores ADD COLUMN IF NOT EXISTS raio_geofence INTEGER;

-- Atualiza a função register_sobreaviso_arrival para considerar a geolocalização do setor (com fallback para unidade)
CREATE OR REPLACE FUNCTION public.register_sobreaviso_arrival(magic_token uuid, p_lat double precision, p_long double precision, p_ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 AS $function$
 DECLARE
   v_log_id UUID;
   v_status public.sobreaviso_status;
   v_unidade_id UUID;
   v_unidade_lat double precision;
   v_unidade_long double precision;
   v_raio_geofence integer;
   v_distancia double precision;
   v_exigir_localizacao boolean;
 BEGIN
   -- 1. Obter informações do chamado, da unidade vinculada e do setor associado
   SELECT l.id, l.status, l.unidade_id, 
          COALESCE(s.latitude, u.latitude), 
          COALESCE(s.longitude, u.longitude), 
          COALESCE(s.raio_geofence, u.raio_geofence)
   INTO v_log_id, v_status, v_unidade_id, v_unidade_lat, v_unidade_long, v_raio_geofence
   FROM public.logs_sobreaviso l
   JOIN public.unidades u ON u.id = l.unidade_id
   LEFT JOIN public.escala_mensal em ON em.id = l.escala_mensal_id
   LEFT JOIN public.setores s ON s.id = em.setor_id
   WHERE l.token_magic_link = magic_token;

   IF v_log_id IS NULL THEN
     RETURN jsonb_build_object('success', false, 'error', 'Link inválido.');
   END IF;

   IF v_status != 'Aceito' THEN
     RETURN jsonb_build_object('success', false, 'error', 'Você precisa aceitar o chamado antes de registrar a chegada.');
   END IF;

   -- 2. Verificar se exige localização nas configurações globais
   SELECT COALESCE((valor#>>'{}')::boolean, true) INTO v_exigir_localizacao
   FROM public.configuracoes_globais
   WHERE chave = 'sobreaviso_exigir_localizacao';

   -- 3. Validar geolocalização no servidor se configurado
   IF COALESCE(v_exigir_localizacao, true) THEN
     IF p_lat IS NULL OR p_long IS NULL THEN
       RETURN jsonb_build_object('success', false, 'error', 'Permissão de GPS é obrigatória para registrar a chegada neste local.');
     END IF;

     -- Validar se há coordenadas válidas resolvidas
     IF v_unidade_lat IS NOT NULL AND v_unidade_long IS NOT NULL THEN
       -- Usar o PostGIS para calcular a distância em metros
       v_distancia := ST_Distance(
         ST_MakePoint(p_long, p_lat)::geography,
         ST_MakePoint(v_unidade_long, v_unidade_lat)::geography
       );

       -- Se estiver fora do raio permitido (raio_geofence, default 500m)
       IF v_distancia > COALESCE(v_raio_geofence, 500) THEN
         RETURN jsonb_build_object(
           'success', false,
           'error', format('Você está a %s metros do local. O registro de chegada só é permitido dentro do raio de %s metros.', round(v_distancia::numeric), COALESCE(v_raio_geofence, 500))
         );
       END IF;
     END IF;
   END IF;

   -- 4. Atualizar registro
   UPDATE public.logs_sobreaviso
   SET
     status = 'Chegou',
     data_hora_chegada = NOW(),
     tipo_validacao_chegada = CASE WHEN p_lat IS NOT NULL THEN 'GPS' ELSE 'Manual' END,
     lat_chegada = p_lat,
     long_chegada = p_long,
     ip_chegada = p_ip
   WHERE id = v_log_id;

   RETURN jsonb_build_object('success', true);
 END;
 $function$;

-- Atualiza a função get_sobreaviso_details RPC para retornar a geolocalização do setor (com fallback para unidade)
CREATE OR REPLACE FUNCTION public.get_sobreaviso_details(magic_token uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'log', row_to_json(l),
    'servidores', json_build_object('nome', s.nome),
    'unidades', json_build_object(
       'nome', u.nome,
       'latitude', COALESCE(sec.latitude, u.latitude),
       'longitude', COALESCE(sec.longitude, u.longitude),
       'raio_geofence', COALESCE(sec.raio_geofence, u.raio_geofence)
    )
  )
  FROM logs_sobreaviso l
  JOIN servidores s ON s.id = l.servidor_id
  JOIN unidades u ON u.id = l.unidade_id
  LEFT JOIN escala_mensal em ON em.id = l.escala_mensal_id
  LEFT JOIN setores sec ON sec.id = em.setor_id
  WHERE l.token_magic_link = magic_token;
$$;
