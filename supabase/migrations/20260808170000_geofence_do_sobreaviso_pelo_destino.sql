-- Migration: o "cheguei no local" passa a conferir o DESTINO, nao a unidade da escala
-- Fase 3 do plano docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
--
-- ESTADO ANTERIOR (20260624000000, a versao vigente das duas funcoes)
--   COALESCE(s.latitude, u.latitude)  -- s = setor de escala_mensal, u = unidades via l.unidade_id
--   O ponto de referencia era sempre a ORIGEM da escala.
--
-- MEDIDO EM PRODUCAO (08/08/2026, nas 8 chegadas com GPS que existem)
--   Todas conferidas contra o setor TECNOLOGIA DA INFORMACAO, todas a 12-73 m dele.
--   "Enfermeira zezinha sem internet" -> destino real USF ENFERMEIRA ZEZINHA, a 3.308 m dali.
--   "Emerson Cassele sem internet"    -> destino real USF EMERSON CASELLI,   a 3.954 m dali.
--   O servidor ia ate a sala da TI so para o botao aceitar, e so entao se deslocava.
--
-- NOVA CADEIA DE RESOLUCAO DO PONTO DE REFERENCIA (primeira fonte completa vence)
--   1. setor de destino     2. unidade de destino     3. setor da escala     4. unidade da escala
--   Os niveis 3 e 4 so existem para registros anteriores ao backfill da Fase 2.
--   Cobertura conferida em producao: 16/16 unidades tem coordenada, 5/57 setores tem, e
--   ZERO setores ficam sem referencia - o nivel 2 sempre resolve.
--
-- EFEITO COLATERAL QUE PRECISA SER AVISADO A QUEM OPERA
--   sobreaviso_tempo_chegada_minutos (90 min em producao) hoje cronometra o deslocamento ate a
--   sala da TI. Passando a cronometrar ate o local do chamado, chamados que hoje "chegam" no
--   prazo podem passar a estourar. E o comportamento correto, mas nao e silencioso.

-- ---------------------------------------------------------------------------
-- 1. register_sobreaviso_arrival
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_sobreaviso_arrival(
    magic_token uuid,
    p_lat double precision,
    p_long double precision,
    p_ip text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 AS $function$
 DECLARE
   v_log_id UUID;
   v_status public.sobreaviso_status;
   v_ref_lat double precision;
   v_ref_long double precision;
   v_raio_geofence integer;
   v_ref_fonte text;
   v_distancia double precision;
   v_exigir_localizacao boolean;
   v_geofence_aplicado boolean := false;

   v_ds_lat double precision; v_ds_long double precision; v_ds_raio integer;
   v_du_lat double precision; v_du_long double precision; v_du_raio integer;
   v_es_lat double precision; v_es_long double precision; v_es_raio integer;
   v_eu_lat double precision; v_eu_long double precision; v_eu_raio integer;
 BEGIN
   -- 1. Obter o chamado e as QUATRO fontes possiveis de ponto de referencia
   SELECT l.id, l.status,
          ds.latitude, ds.longitude, ds.raio_geofence,
          du.latitude, du.longitude, du.raio_geofence,
          es.latitude, es.longitude, es.raio_geofence,
          eu.latitude, eu.longitude, eu.raio_geofence
   INTO v_log_id, v_status,
        v_ds_lat, v_ds_long, v_ds_raio,
        v_du_lat, v_du_long, v_du_raio,
        v_es_lat, v_es_long, v_es_raio,
        v_eu_lat, v_eu_long, v_eu_raio
   FROM public.logs_sobreaviso l
   LEFT JOIN public.setores  ds ON ds.id = l.destino_setor_id
   LEFT JOIN public.unidades du ON du.id = l.destino_unidade_id
   LEFT JOIN public.escala_mensal em ON em.id = l.escala_mensal_id
   LEFT JOIN public.setores  es ON es.id = em.setor_id
   LEFT JOIN public.unidades eu ON eu.id = l.unidade_id
   WHERE l.token_magic_link = magic_token;

   IF v_log_id IS NULL THEN
     RETURN jsonb_build_object('success', false, 'error', 'Link inválido.');
   END IF;

   IF v_status != 'Aceito' THEN
     RETURN jsonb_build_object('success', false, 'error', 'Você precisa aceitar o chamado antes de registrar a chegada.');
   END IF;

   -- 2. Escolher o ponto de referencia. Testa lat E long juntos de proposito: pegar a latitude
   --    de uma fonte e a longitude de outra apontaria para um lugar que nao existe.
   IF v_ds_lat IS NOT NULL AND v_ds_long IS NOT NULL THEN
     v_ref_lat := v_ds_lat; v_ref_long := v_ds_long; v_raio_geofence := v_ds_raio; v_ref_fonte := 'setor_destino';
   ELSIF v_du_lat IS NOT NULL AND v_du_long IS NOT NULL THEN
     v_ref_lat := v_du_lat; v_ref_long := v_du_long; v_raio_geofence := v_du_raio; v_ref_fonte := 'unidade_destino';
   ELSIF v_es_lat IS NOT NULL AND v_es_long IS NOT NULL THEN
     v_ref_lat := v_es_lat; v_ref_long := v_es_long; v_raio_geofence := v_es_raio; v_ref_fonte := 'setor_escala';
   ELSIF v_eu_lat IS NOT NULL AND v_eu_long IS NOT NULL THEN
     v_ref_lat := v_eu_lat; v_ref_long := v_eu_long; v_raio_geofence := v_eu_raio; v_ref_fonte := 'unidade_escala';
   ELSE
     v_ref_fonte := 'sem_referencia';
   END IF;

   -- 3. Verificar se exige localizacao nas configuracoes globais
   SELECT COALESCE((valor#>>'{}')::boolean, true) INTO v_exigir_localizacao
   FROM public.configuracoes_globais
   WHERE chave = 'sobreaviso_exigir_localizacao';

   -- 4. Medir a distancia sempre que der, mesmo quando a validacao nao e exigida - e o dado
   --    que o relatorio usa para provar (ou nao) a chegada.
   IF p_lat IS NOT NULL AND p_long IS NOT NULL AND v_ref_lat IS NOT NULL THEN
     v_distancia := ST_Distance(
       ST_MakePoint(p_long, p_lat)::geography,
       ST_MakePoint(v_ref_long, v_ref_lat)::geography
     );
   END IF;

   -- 5. Validar geolocalizacao no servidor se configurado
   IF COALESCE(v_exigir_localizacao, true) THEN
     IF p_lat IS NULL OR p_long IS NULL THEN
       RETURN jsonb_build_object('success', false, 'error', 'Permissão de GPS é obrigatória para registrar a chegada neste local.');
     END IF;

     IF v_ref_lat IS NOT NULL AND v_ref_long IS NOT NULL THEN
       v_geofence_aplicado := true;

       IF v_distancia > COALESCE(v_raio_geofence, 500) THEN
         RETURN jsonb_build_object(
           'success', false,
           'error', format('Você está a %s metros do local do chamado. O registro de chegada só é permitido dentro do raio de %s metros.', round(v_distancia::numeric), COALESCE(v_raio_geofence, 500))
         );
       END IF;
     END IF;
     -- Sem coordenada de referencia a chegada continua sendo aceita (comportamento anterior),
     -- mas agora fica REGISTRADO que nada foi conferido: v_geofence_aplicado segue false.
   END IF;

   -- 6. Atualizar registro
   UPDATE public.logs_sobreaviso
   SET
     status = 'Chegou',
     data_hora_chegada = NOW(),
     tipo_validacao_chegada = CASE WHEN p_lat IS NOT NULL THEN 'GPS' ELSE 'Manual' END,
     lat_chegada = p_lat,
     long_chegada = p_long,
     ip_chegada = p_ip,
     chegada_distancia_metros = v_distancia,
     chegada_geofence_aplicado = v_geofence_aplicado
   WHERE id = v_log_id;

   RETURN jsonb_build_object(
     'success', true,
     'geofence_aplicado', v_geofence_aplicado,
     'distancia_metros', round(v_distancia::numeric),
     'referencia', v_ref_fonte
   );
 END;
 $function$;

COMMENT ON FUNCTION public.register_sobreaviso_arrival(uuid, double precision, double precision, text) IS
'Registra a chegada conferindo o DESTINO do chamado (setor -> unidade), com fallback para a
origem da escala apenas nos registros antigos. Grava chegada_distancia_metros e
chegada_geofence_aplicado: sem essas duas, "validado dentro do raio" e "aceito porque nao havia
coordenada" eram indistinguiveis - os dois gravavam tipo_validacao_chegada = GPS.';

-- ---------------------------------------------------------------------------
-- 2. get_sobreaviso_details
-- ---------------------------------------------------------------------------
-- A chave "unidades" do payload passa a descrever o DESTINO, nao a origem.
-- Isso e proposital: essa chave alimenta o texto "Você foi acionado para..." e a checagem de
-- raio no navegador (src/app/sobreaviso/[token]/page.tsx). Se ela continuasse apontando para a
-- origem, o pre-check do cliente discordaria da validacao do servidor - a mesma classe de erro
-- que o portao de conferencia existe para evitar.
-- A origem continua disponivel, agora na chave "origem".
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
       'nome', COALESCE(du.nome, eu.nome),
       'setor', dsd.nome,
       'referencia', l.destino_referencia,
       'latitude',      COALESCE(ds.latitude,      du.latitude,      es.latitude,      eu.latitude),
       'longitude',     COALESCE(ds.longitude,     du.longitude,     es.longitude,     eu.longitude),
       'raio_geofence', COALESCE(ds.raio_geofence, du.raio_geofence, es.raio_geofence, eu.raio_geofence)
    ),
    'origem', json_build_object(
       'unidade', eu.nome,
       'setor', esd.nome
    ),
    'acionado_por', json_build_object('nome', p.full_name)
  )
  FROM logs_sobreaviso l
  JOIN servidores s ON s.id = l.servidor_id
  LEFT JOIN setores  ds ON ds.id = l.destino_setor_id
  LEFT JOIN dicionario_setores dsd ON dsd.id = ds.dicionario_setor_id
  LEFT JOIN unidades du ON du.id = l.destino_unidade_id
  LEFT JOIN escala_mensal em ON em.id = l.escala_mensal_id
  LEFT JOIN setores  es ON es.id = em.setor_id
  LEFT JOIN dicionario_setores esd ON esd.id = es.dicionario_setor_id
  LEFT JOIN unidades eu ON eu.id = l.unidade_id
  LEFT JOIN profiles p ON p.id = l.acionado_por
  WHERE l.token_magic_link = magic_token;
$$;

GRANT EXECUTE ON FUNCTION public.get_sobreaviso_details(uuid) TO anon, authenticated;

-- NOTA: o COALESCE de coordenadas acima pode, em teoria, misturar latitude de uma fonte com
-- longitude de outra. Na pratica nao ocorre (as 4 fontes tem lat e long preenchidas juntas ou
-- vazias juntas), e este payload e apenas para exibicao e pre-check no navegador.
-- Quem DECIDE e register_sobreaviso_arrival, que escolhe a fonte inteira de uma vez.

-- ---------------------------------------------------------------------------
-- CONFERENCIA (rodar depois de aplicar)
-- ---------------------------------------------------------------------------
--   -- as 8 chegadas com GPS ja existentes: contra que ponto seriam conferidas hoje?
--   SELECT l.motivo_acionamento,
--          u.nome AS destino,
--          round(ST_Distance(
--            ST_MakePoint(l.long_chegada::double precision, l.lat_chegada::double precision)::geography,
--            ST_MakePoint(COALESCE(ds.longitude, du.longitude), COALESCE(ds.latitude, du.latitude))::geography
--          )::numeric) AS metros
--   FROM public.logs_sobreaviso l
--   LEFT JOIN public.setores  ds ON ds.id = l.destino_setor_id
--   LEFT JOIN public.unidades du ON du.id = l.destino_unidade_id
--   LEFT JOIN public.unidades u  ON u.id  = l.destino_unidade_id
--   WHERE l.lat_chegada IS NOT NULL;
--   -- Logo apos a Fase 2 o destino ainda e igual a origem, entao os valores devem bater com
--   -- os 12-73 m medidos em 08/08/2026. Se mudarem, o backfill nao fez o que se esperava.
