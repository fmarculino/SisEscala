-- Enable execution of get_my_role for anonymous users so RLS policies don't crash
GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon;

-- Create RPC to fetch sobreaviso details securely without exposing full tables
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
       'latitude', u.latitude,
       'longitude', u.longitude,
       'raio_geofence', u.raio_geofence
    )
  )
  FROM logs_sobreaviso l
  JOIN servidores s ON s.id = l.servidor_id
  JOIN unidades u ON u.id = l.unidade_id
  WHERE l.token_magic_link = magic_token;
$$;

GRANT EXECUTE ON FUNCTION public.get_sobreaviso_details(uuid) TO anon, authenticated;
