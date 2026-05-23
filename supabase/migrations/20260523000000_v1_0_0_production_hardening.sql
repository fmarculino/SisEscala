-- Migration: V1.0.0 Production Hardening and Performance Optimizations
-- Description: Applies Bcrypt PIN hashing, PostGIS geofencing, IDOR preventions, and RLS policy optimizations.
-- Target: Can be run on Vercel training base and new production environments.

-- =========================================================================
-- 1. EXTENSIONS
-- =========================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================================================================
-- 2. SECURITY DEFINER FUNCTIONS & RPCS
-- =========================================================================

-- RPC to securely verify PIN
CREATE OR REPLACE FUNCTION public.verify_pin(p_servidor_id uuid, p_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hash text;
BEGIN
  SELECT pin_acesso INTO v_hash FROM public.servidores WHERE id = p_servidor_id;
  IF v_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN v_hash = crypt(p_pin, v_hash);
END;
$function$;

-- RPC to register arrival with server-side geofencing
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
  -- 1. Obter informações do chamado e da unidade vinculada
  SELECT l.id, l.status, l.unidade_id, u.latitude, u.longitude, u.raio_geofence
  INTO v_log_id, v_status, v_unidade_id, v_unidade_lat, v_unidade_long, v_raio_geofence
  FROM public.logs_sobreaviso l
  JOIN public.unidades u ON u.id = l.unidade_id
  WHERE l.token_magic_link = magic_token;

  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link inválido.');
  END IF;

  IF v_status != 'Aceito' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Você precisa aceitar o chamado antes de registrar a chegada.');
  END IF;

  -- 2. Verificar se exige localização nas configurações globais
  SELECT COALESCE(valor::boolean, true) INTO v_exigir_localizacao
  FROM public.configuracoes_globais
  WHERE chave = 'sobreaviso_exigir_localizacao';

  -- 3. Validar geolocalização no servidor se configurado
  IF COALESCE(v_exigir_localizacao, true) THEN
    IF p_lat IS NULL OR p_long IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Permissão de GPS é obrigatória para registrar a chegada nesta unidade.');
    END IF;

    -- Validar se a unidade tem coordenadas válidas cadastradas
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
          'error', format('Você está a %s metros da unidade. O registro de chegada só é permitido dentro do raio de %s metros.', round(v_distancia::numeric), COALESCE(v_raio_geofence, 500))
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

-- =========================================================================
-- 3. TRIGGERS FOR AUTOMATIC PIN HASHING (BCRYPT)
-- =========================================================================

-- Trigger function for servers PIN hashing
CREATE OR REPLACE FUNCTION public.hash_servidor_pin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.pin_acesso IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.pin_acesso IS DISTINCT FROM OLD.pin_acesso) THEN
    -- Garantir que não estamos aplicando hash sobre algo que já é um hash bcrypt ($2a$ ou $2b$)
    IF NEW.pin_acesso NOT LIKE '$2a$%' AND NEW.pin_acesso NOT LIKE '$2b$%' THEN
      NEW.pin_acesso := crypt(NEW.pin_acesso, gen_salt('bf', 8));
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Apply trigger to public.servidores
DROP TRIGGER IF EXISTS trigger_hash_servidor_pin ON public.servidores;
CREATE TRIGGER trigger_hash_servidor_pin
BEFORE INSERT OR UPDATE ON public.servidores
FOR EACH ROW
EXECUTE FUNCTION public.hash_servidor_pin();

-- Migrate any legacy plaintext PINs to Bcrypt
UPDATE public.servidores
SET pin_acesso = crypt(pin_acesso, gen_salt('bf', 8))
WHERE pin_acesso IS NOT NULL 
  AND pin_acesso NOT LIKE '$2a$%' 
  AND pin_acesso NOT LIKE '$2b$%';

-- =========================================================================
-- 4. RLS OPTIMIZED POLICIES WITH SUBQUERIES (0 PERFORMANCE WARNINGS)
-- =========================================================================

-- cargos
ALTER TABLE public.cargos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir leitura de cargos para autenticados" ON public.cargos;
CREATE POLICY "Permitir leitura de cargos para autenticados" ON public.cargos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Permitir gerenciamento de cargos para administradores" ON public.cargos;
CREATE POLICY "Permitir gerenciamento de cargos para administradores" ON public.cargos
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

-- configuracoes_globais
ALTER TABLE public.configuracoes_globais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir leitura de configurações para todos" ON public.configuracoes_globais;
CREATE POLICY "Permitir leitura de configurações para todos" ON public.configuracoes_globais
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Portal access to public configs" ON public.configuracoes_globais;
CREATE POLICY "Portal access to public configs" ON public.configuracoes_globais
  FOR SELECT TO public USING (chave LIKE 'sobreaviso_%');

DROP POLICY IF EXISTS "Permitir atualização apenas para administradores" ON public.configuracoes_globais;
CREATE POLICY "Permitir atualização apenas para administradores" ON public.configuracoes_globais
  FOR ALL TO authenticated USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role])))));

-- dicionario_setores
ALTER TABLE public.dicionario_setores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir leitura para todos" ON public.dicionario_setores;
CREATE POLICY "Permitir leitura para todos" ON public.dicionario_setores
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Permitir gerenciamento de setores para administradores" ON public.dicionario_setores;
CREATE POLICY "Permitir gerenciamento de setores para administradores" ON public.dicionario_setores
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

-- dicionario_turnos
ALTER TABLE public.dicionario_turnos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can view shift dictionary" ON public.dicionario_turnos;
CREATE POLICY "Everyone can view shift dictionary" ON public.dicionario_turnos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage shifts" ON public.dicionario_turnos;
DROP POLICY IF EXISTS "Admins can manage turnos" ON public.dicionario_turnos;
CREATE POLICY "Admins can manage shifts" ON public.dicionario_turnos
  FOR ALL TO public USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));

-- escala_diaria
ALTER TABLE public.escala_diaria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view daily scales" ON public.escala_diaria;
CREATE POLICY "Authenticated users can view daily scales" ON public.escala_diaria
  FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

DROP POLICY IF EXISTS "Super Admins manage all daily scales" ON public.escala_diaria;
CREATE POLICY "Super Admins manage all daily scales" ON public.escala_diaria
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));

DROP POLICY IF EXISTS "Admins manage daily scales in their units" ON public.escala_diaria;
CREATE POLICY "Admins manage daily scales in their units" ON public.escala_diaria
  FOR ALL TO authenticated USING (
    (( SELECT get_my_role() AS get_my_role) = 'admin'::user_role) AND (
      (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.acesso_todas_unidades = true)))) OR 
      (EXISTS ( SELECT 1 FROM escala_mensal em WHERE ((em.id = escala_diaria.escala_mensal_id) AND (em.unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))))))
    )
  );

DROP POLICY IF EXISTS "Coordinators manage daily scales in their sectors" ON public.escala_diaria;
CREATE POLICY "Coordinators manage daily scales in their sectors" ON public.escala_diaria
  FOR ALL TO authenticated USING (
    (( SELECT get_my_role() AS get_my_role) = 'coordenador'::user_role) AND (
      (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.acesso_todos_setores = true)))) OR 
      (EXISTS ( SELECT 1 FROM escala_mensal em WHERE ((em.id = escala_diaria.escala_mensal_id) AND (em.setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))))))
    )
  );

-- escala_mensal
ALTER TABLE public.escala_mensal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view scales" ON public.escala_mensal;
CREATE POLICY "Authenticated users can view scales" ON public.escala_mensal
  FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

DROP POLICY IF EXISTS "Super Admins manage all scales" ON public.escala_mensal;
CREATE POLICY "Super Admins manage all scales" ON public.escala_mensal
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));

DROP POLICY IF EXISTS "Admins manage scales in their units" ON public.escala_mensal;
CREATE POLICY "Admins manage scales in their units" ON public.escala_mensal
  FOR ALL TO authenticated USING (
    (( SELECT get_my_role() AS get_my_role) = 'admin'::user_role) AND (
      (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.acesso_todas_unidades = true)))) OR 
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid))))
    )
  );

DROP POLICY IF EXISTS "Coordinators manage scales in their sectors" ON public.escala_mensal;
CREATE POLICY "Coordinators manage scales in their sectors" ON public.escala_mensal
  FOR ALL TO authenticated USING (
    (( SELECT get_my_role() AS get_my_role) = 'coordenador'::user_role) AND (
      (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.acesso_todos_setores = true)))) OR 
      (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid))))
    )
  );

DROP POLICY IF EXISTS "Scoped access for Escala Mensal" ON public.escala_mensal;
CREATE POLICY "Scoped access for Escala Mensal" ON public.escala_mensal
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR 
     (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))))
  );

-- feriados
ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read access to holidays for authenticated" ON public.feriados;
CREATE POLICY "Allow read access to holidays for authenticated" ON public.feriados
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow write access to holidays for admins" ON public.feriados;
CREATE POLICY "Allow write access to holidays for admins" ON public.feriados
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

-- jornadas
ALTER TABLE public.jornadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can view journeys" ON public.jornadas;
CREATE POLICY "Everyone can view journeys" ON public.jornadas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage journeys" ON public.jornadas;
CREATE POLICY "Admins can manage journeys" ON public.jornadas
  FOR ALL TO public USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));

-- logs_sistema
ALTER TABLE public.logs_sistema ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Logs inseriveis por qualquer autenticado" ON public.logs_sistema;
CREATE POLICY "Logs inseriveis por qualquer autenticado" ON public.logs_sistema
  FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

DROP POLICY IF EXISTS "Logs visiveis por quem tem acesso a unidade" ON public.logs_sistema;
CREATE POLICY "Logs visiveis por quem tem acesso a unidade" ON public.logs_sistema
  FOR SELECT TO public USING (
    EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'super_admin'::user_role) OR p.acesso_todas_unidades OR (logs_sistema.unidade_id = p.unidade_id) OR (EXISTS ( SELECT 1 FROM profile_unidades pu WHERE ((pu.profile_id = p.id) AND (pu.unidade_id = logs_sistema.unidade_id)))))))
  );

-- logs_sobreaviso
ALTER TABLE public.logs_sobreaviso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON public.logs_sobreaviso;
CREATE POLICY "Authenticated users can view audit logs" ON public.logs_sobreaviso
  FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

DROP POLICY IF EXISTS "Super Admins manage all on-call logs" ON public.logs_sobreaviso;
CREATE POLICY "Super Admins manage all on-call logs" ON public.logs_sobreaviso
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));

DROP POLICY IF EXISTS "Admins manage on-call logs in their units" ON public.logs_sobreaviso;
CREATE POLICY "Admins manage on-call logs in their units" ON public.logs_sobreaviso
  FOR ALL TO authenticated USING (
    (( SELECT get_my_role() AS get_my_role) = 'admin'::user_role) AND (
      (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.acesso_todas_unidades = true)))) OR 
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid))))
    )
  );

DROP POLICY IF EXISTS "Coordinators manage on-call logs in their sectors" ON public.logs_sobreaviso;
CREATE POLICY "Coordinators manage on-call logs in their sectors" ON public.logs_sobreaviso
  FOR ALL TO authenticated USING (
    (( SELECT get_my_role() AS get_my_role) = 'coordenador'::user_role) AND (
      EXISTS ( SELECT 1 FROM escala_mensal em WHERE ((em.id = logs_sobreaviso.escala_mensal_id) AND ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.acesso_todos_setores = true)))) OR (em.setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))))))
    )
  );

-- profile_setores
ALTER TABLE public.profile_setores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own sector access" ON public.profile_setores;
CREATE POLICY "Users view own sector access" ON public.profile_setores
  FOR SELECT TO public USING ((profile_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Admins manage sectors access" ON public.profile_setores;
CREATE POLICY "Admins manage sectors access" ON public.profile_setores
  FOR ALL TO public USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])))));

-- profile_unidades
ALTER TABLE public.profile_unidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own unit access" ON public.profile_unidades;
CREATE POLICY "Users view own unit access" ON public.profile_unidades
  FOR SELECT TO public USING ((profile_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "Admins manage units access" ON public.profile_unidades;
CREATE POLICY "Admins manage units access" ON public.profile_unidades
  FOR ALL TO public USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])))));

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = id));

DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL TO public USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));

-- servidores
ALTER TABLE public.servidores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view relevant servers" ON public.servidores;
CREATE POLICY "Users can view relevant servers" ON public.servidores
  FOR SELECT TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR 
     (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))))
  );

DROP POLICY IF EXISTS "Admins can manage all servers" ON public.servidores;
CREATE POLICY "Admins can manage all servers" ON public.servidores
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));

DROP POLICY IF EXISTS "Scoped access for Admins and Coordinators" ON public.servidores;
CREATE POLICY "Scoped access for Admins and Coordinators" ON public.servidores
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND (
      (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR 
      (setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid))))
    ))
  );

-- setores
ALTER TABLE public.setores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view sectors" ON public.setores;
CREATE POLICY "Authenticated users can view sectors" ON public.setores
  FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

DROP POLICY IF EXISTS "Scoped access for Setores" ON public.setores;
CREATE POLICY "Scoped access for Setores" ON public.setores
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role) OR 
     (unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR 
     (id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid)))))
  );

-- solicitacoes_troca
ALTER TABLE public.solicitacoes_troca ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read access to swap requests for admins and coordinators" ON public.solicitacoes_troca;
CREATE POLICY "Allow read access to swap requests for admins and coordinators" ON public.solicitacoes_troca
  FOR SELECT TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])) OR 
     ((( SELECT get_my_role() AS get_my_role) = 'coordenador'::user_role) AND (
       (EXISTS ( SELECT 1 FROM (escala_mensal em JOIN profile_unidades pu ON ((em.unidade_id = pu.unidade_id))) WHERE ((em.id = solicitacoes_troca.escala_mensal_solicitante_id) AND (pu.profile_id = ( SELECT auth.uid() AS uid))))) OR 
       (EXISTS ( SELECT 1 FROM (escala_mensal em JOIN profile_setores ps ON ((em.setor_id = ps.setor_id))) WHERE ((em.id = solicitacoes_troca.escala_mensal_solicitante_id) AND (ps.profile_id = ( SELECT auth.uid() AS uid)))))
     )))
  );

DROP POLICY IF EXISTS "Allow insert access to swap requests for coordinators and admin" ON public.solicitacoes_troca;
CREATE POLICY "Allow insert access to swap requests for coordinators and admin" ON public.solicitacoes_troca
  FOR INSERT TO authenticated WITH CHECK (
    (( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role, 'coordenador'::user_role]))
  );

DROP POLICY IF EXISTS "Allow update access to swap requests for admins and coordinator" ON public.solicitacoes_troca;
CREATE POLICY "Allow update access to swap requests for admins and coordinator" ON public.solicitacoes_troca
  FOR UPDATE TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])) OR 
     ((( SELECT get_my_role() AS get_my_role) = 'coordenador'::user_role) AND (
       (EXISTS ( SELECT 1 FROM (escala_mensal em JOIN profile_unidades pu ON ((em.unidade_id = pu.unidade_id))) WHERE ((em.id = solicitacoes_troca.escala_mensal_solicitante_id) AND (pu.profile_id = ( SELECT auth.uid() AS uid))))) OR 
       (EXISTS ( SELECT 1 FROM (escala_mensal em JOIN profile_setores ps ON ((em.setor_id = ps.setor_id))) WHERE ((em.id = solicitacoes_troca.escala_mensal_solicitante_id) AND (ps.profile_id = ( SELECT auth.uid() AS uid)))))
     )))
  );

-- spatial_ref_sys (Enabling RLS is skipped on cloud instances as the postgres role is not the owner)


-- unidades
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view units" ON public.unidades;
CREATE POLICY "Authenticated users can view units" ON public.unidades
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Manage units restricted to Super Admin" ON public.unidades;
CREATE POLICY "Manage units restricted to Super Admin" ON public.unidades
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role));
