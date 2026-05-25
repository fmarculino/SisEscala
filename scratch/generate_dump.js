const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const oldUrl = process.env.OLD_SUPABASE_URL || '';
const oldServiceKey = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || '';

if (!oldUrl || !oldServiceKey) {
  console.error('Error: Please set OLD_SUPABASE_URL and OLD_SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(oldUrl, oldServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Table insertion order (dependencies first)
const tables = [
  'unidades',
  'dicionario_setores',
  'setores',
  'dicionario_turnos',
  'cargos',
  'jornadas',
  'servidores',
  'profiles',
  'profile_unidades',
  'profile_setores',
  'configuracoes_globais',
  'feriados',
  'escala_mensal',
  'escala_diaria',
  'logs_sobreaviso',
  'logs_sistema',
  'solicitacoes_troca'
];

// Column type definitions for mapping formatting
const tableColumnTypes = {
  unidades: { id: 'uuid', nome: 'text', endereco: 'text', localizacao: 'geometry', created_at: 'timestamptz', updated_at: 'timestamptz', latitude: 'numeric', longitude: 'numeric', raio_geofence: 'int4', ativo: 'bool' },
  dicionario_setores: { id: 'uuid', nome: 'text', created_at: 'timestamptz' },
  setores: { id: 'uuid', unidade_id: 'uuid', parent_id: 'uuid', created_at: 'timestamptz', updated_at: 'timestamptz', ativo: 'bool', dicionario_setor_id: 'uuid' },
  dicionario_turnos: { id: 'uuid', codigo: 'text', descricao: 'text', horas_computadas: 'numeric', tipo: 'turno_tipo', created_at: 'timestamptz', updated_at: 'timestamptz', ativo: 'bool', slots: '_text' },
  cargos: { id: 'uuid', nome: 'text', created_at: 'timestamptz', updated_at: 'timestamptz', parent_id: 'uuid', nivel: 'int4', ativo: 'bool' },
  jornadas: { id: 'uuid', nome: 'text', ativo: 'bool', created_at: 'timestamptz', updated_at: 'timestamptz', intervalo_minutos: 'int4', horas_totais: 'numeric' },
  servidores: { id: 'uuid', nome: 'text', matricula: 'text', cargo: 'text', vinculo: 'vinculo_type', unidade_id: 'uuid', created_at: 'timestamptz', updated_at: 'timestamptz', setor_id: 'uuid', status: 'text', motivo_inativacao: 'text', email: 'text', telefone: 'text', pin_acesso: 'text', pin_failed_attempts: 'int4', last_pin_attempt: 'timestamptz' },
  profiles: { id: 'uuid', full_name: 'text', role: 'user_role', unidade_id: 'uuid', created_at: 'timestamptz', updated_at: 'timestamptz', setor_id: 'uuid', acesso_todas_unidades: 'bool', acesso_todos_setores: 'bool', ativo: 'bool' },
  profile_unidades: { profile_id: 'uuid', unidade_id: 'uuid' },
  profile_setores: { profile_id: 'uuid', setor_id: 'uuid' },
  configuracoes_globais: { id: 'uuid', chave: 'text', valor: 'jsonb', descricao: 'text', created_at: 'timestamptz', updated_at: 'timestamptz' },
  feriados: { id: 'uuid', data: 'date', descricao: 'text', created_at: 'timestamptz', updated_at: 'timestamptz' },
  escala_mensal: { id: 'uuid', mes: 'int4', ano: 'int4', servidor_id: 'uuid', unidade_id: 'uuid', status: 'text', created_at: 'timestamptz', updated_at: 'timestamptz', setor_id: 'uuid', ativo: 'bool', inativada_em: 'timestamptz', jornada_id: 'uuid' },
  escala_diaria: { id: 'uuid', escala_mensal_id: 'uuid', dia: 'int4', dicionario_turnos_id: 'uuid', created_at: 'timestamptz', updated_at: 'timestamptz', categoria: 'escala_categoria', presenca_confirmada: 'bool', presenca_confirmada_em: 'timestamptz', confirmado_por_id: 'uuid', presenca_entrada_em: 'timestamptz', presenca_saida_em: 'timestamptz' },
  logs_sobreaviso: { id: 'uuid', servidor_id: 'uuid', unidade_id: 'uuid', data_hora_acionamento: 'timestamptz', status: 'sobreaviso_status', token_magic_link: 'uuid', data_hora_aceite: 'timestamptz', ip_aceite: 'inet', user_agent: 'text', lat_aceite: 'float8', long_aceite: 'float8', eta_minutos: 'int4', data_hora_chegada: 'timestamptz', tipo_validacao_chegada: 'text', created_at: 'timestamptz', lat_chegada: 'numeric', long_chegada: 'numeric', motivo_acionamento: 'text', escala_mensal_id: 'uuid', justificativa_recusa: 'text', lat_recusa: 'float8', long_recusa: 'float8', dia: 'int4', validacao_manual: 'bool', motivo_falha: 'text', ip_chegada: 'text', validado_por: 'uuid', data_hora_validacao: 'timestamptz', categoria: 'text' },
  logs_sistema: { id: 'uuid', created_at: 'timestamptz', user_id: 'uuid', acao: 'text', detalhes: 'jsonb', unidade_id: 'uuid', setor_id: 'uuid' },
  solicitacoes_troca: { id: 'uuid', solicitante_id: 'uuid', escala_mensal_solicitante_id: 'uuid', dia_origem: 'int4', categoria_origem: 'text', turno_origem_id: 'uuid', destinatario_id: 'uuid', escala_mensal_destinatario_id: 'uuid', dia_destino: 'int4', justificativa: 'text', status: 'text', motivo_rejeicao: 'text', aprovado_por: 'uuid', created_at: 'timestamptz', updated_at: 'timestamptz' }
};

function formatValue(val, type) {
  if (val === null || val === undefined) return 'NULL';
  if (type === 'bool') return val ? 'true' : 'false';
  if (type === 'int4' || type === 'numeric' || type === 'float8') return val.toString();
  if (type === 'jsonb') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  if (type === '_text') {
    if (!Array.isArray(val)) return 'NULL';
    const escapedItems = val.map(item => `'${item.replace(/'/g, "''")}'`);
    return `ARRAY[${escapedItems.join(', ')}]::text[]`;
  }
  if (type === 'inet') return `'${val.toString().replace(/'/g, "''")}'::inet`;
  if (type === 'geometry') return 'NULL';
  return `'${val.toString().replace(/'/g, "''")}'`;
}

async function run() {
  console.log('Generating migration dump...');
  
  let sql = `-- SisEscala Unified Migration Script
-- Target: self-hosted Supabase on VPS/Coolify
-- Created at: ${new Date().toISOString()}

-- Enable raw schema and data insertion safely
SET session_replication_role = 'replica';

-- ----------------------------------------------------
-- 1. Create Extensions
-- ----------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis" SCHEMA public;

-- ----------------------------------------------------
-- 2. Drop Existing Objects (Reverse Order for Safety)
-- ----------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP TABLE IF EXISTS public.solicitacoes_troca CASCADE;
DROP TABLE IF EXISTS public.logs_sistema CASCADE;
DROP TABLE IF EXISTS public.logs_sobreaviso CASCADE;
DROP TABLE IF EXISTS public.escala_diaria CASCADE;
DROP TABLE IF EXISTS public.escala_mensal CASCADE;
DROP TABLE IF EXISTS public.feriados CASCADE;
DROP TABLE IF EXISTS public.configuracoes_globais CASCADE;
DROP TABLE IF EXISTS public.profile_setores CASCADE;
DROP TABLE IF EXISTS public.profile_unidades CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.servidores CASCADE;
DROP TABLE IF EXISTS public.jornadas CASCADE;
DROP TABLE IF EXISTS public.cargos CASCADE;
DROP TABLE IF EXISTS public.dicionario_turnos CASCADE;
DROP TABLE IF EXISTS public.setores CASCADE;
DROP TABLE IF EXISTS public.dicionario_setores CASCADE;
DROP TABLE IF EXISTS public.unidades CASCADE;

DROP TYPE IF EXISTS public.vinculo_type CASCADE;
DROP TYPE IF EXISTS public.user_role CASCADE;
DROP TYPE IF EXISTS public.turno_tipo CASCADE;
DROP TYPE IF EXISTS public.sobreaviso_status CASCADE;
DROP TYPE IF EXISTS public.escala_categoria CASCADE;

DROP FUNCTION IF EXISTS public.fn_get_monthly_occupancy(uuid[], integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.fn_check_shift_conflicts(uuid, integer, integer, integer, uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.sync_setor_name_compatibility() CASCADE;
DROP FUNCTION IF EXISTS public.mark_sobreaviso_timeout(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.decline_sobreaviso_call(uuid, text, double precision, double precision) CASCADE;
DROP FUNCTION IF EXISTS public.register_sobreaviso_arrival(uuid, double precision, double precision, text) CASCADE;
DROP FUNCTION IF EXISTS public.accept_sobreaviso_call(uuid, double precision, double precision, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.fn_confirmar_presenca_manual(uuid, integer, escala_categoria, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fn_reverter_presenca_manual(uuid, integer, escala_categoria, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.fn_confirmar_presenca(text, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_sobreaviso_details(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_role() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;

-- ----------------------------------------------------
-- 3. Create Custom Enum Types
-- ----------------------------------------------------
CREATE TYPE public.escala_categoria AS ENUM ('Regular', 'Extra', 'Plantão', 'Sobreaviso');
CREATE TYPE public.sobreaviso_status AS ENUM ('Aguardando', 'Aceito', 'Recusado', 'Expirado', 'Chegou', 'Falhou', 'Cancelado');
CREATE TYPE public.turno_tipo AS ENUM ('Normal', 'Plantão', 'Sobreaviso', 'Extra');
CREATE TYPE public.user_role AS ENUM ('super_admin', 'coordenador', 'servidor', 'admin', 'comum');
CREATE TYPE public.vinculo_type AS ENUM ('Contratada', 'Concursada', 'Efetiva', 'Comissionada');

-- ----------------------------------------------------
-- 4. Create Tables
-- ----------------------------------------------------

CREATE TABLE public.unidades (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    nome text NOT NULL,
    endereco text,
    localizacao geometry(Geometry, 4326),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    latitude numeric,
    longitude numeric,
    raio_geofence integer DEFAULT 100,
    ativo boolean DEFAULT true,
    CONSTRAINT unidades_pkey PRIMARY KEY (id)
);

CREATE TABLE public.dicionario_setores (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    nome text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dicionario_setores_pkey PRIMARY KEY (id),
    CONSTRAINT dicionario_setores_nome_key UNIQUE (nome)
);

CREATE TABLE public.setores (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    unidade_id uuid,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ativo boolean DEFAULT true,
    dicionario_setor_id uuid,
    CONSTRAINT setores_pkey PRIMARY KEY (id)
);

CREATE TABLE public.dicionario_turnos (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    codigo text NOT NULL,
    descricao text,
    horas_computadas numeric NOT NULL,
    tipo public.turno_tipo NOT NULL DEFAULT 'Normal'::public.turno_tipo,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ativo boolean DEFAULT true,
    slots text[] DEFAULT '{}'::text[],
    CONSTRAINT dicionario_turnos_pkey PRIMARY KEY (id),
    CONSTRAINT dicionario_turnos_codigo_key UNIQUE (codigo)
);

CREATE TABLE public.cargos (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    nome text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    parent_id uuid,
    nivel integer DEFAULT 1,
    ativo boolean DEFAULT true,
    CONSTRAINT cargos_pkey PRIMARY KEY (id),
    CONSTRAINT cargos_nome_key UNIQUE (nome)
);

CREATE TABLE public.jornadas (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    nome text NOT NULL,
    ativo boolean DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    intervalo_minutos integer DEFAULT 0,
    horas_totais numeric DEFAULT 0,
    CONSTRAINT jornadas_pkey PRIMARY KEY (id)
);

CREATE TABLE public.servidores (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    nome text NOT NULL,
    matricula text,
    cargo text,
    vinculo public.vinculo_type NOT NULL DEFAULT 'Efetiva'::public.vinculo_type,
    unidade_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    setor_id uuid,
    status text DEFAULT 'Ativo'::text,
    motivo_inativacao text,
    email text,
    telefone text,
    pin_acesso text,
    pin_failed_attempts integer DEFAULT 0,
    last_pin_attempt timestamp with time zone,
    CONSTRAINT servidores_pkey PRIMARY KEY (id),
    CONSTRAINT servidores_matricula_key UNIQUE (matricula)
);

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    role public.user_role NOT NULL DEFAULT 'servidor'::public.user_role,
    unidade_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    setor_id uuid,
    acesso_todas_unidades boolean DEFAULT false,
    acesso_todos_setores boolean DEFAULT false,
    ativo boolean DEFAULT true,
    CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

CREATE TABLE public.profile_unidades (
    profile_id uuid NOT NULL,
    unidade_id uuid NOT NULL,
    CONSTRAINT profile_unidades_pkey PRIMARY KEY (profile_id, unidade_id)
);

CREATE TABLE public.profile_setores (
    profile_id uuid NOT NULL,
    setor_id uuid NOT NULL,
    CONSTRAINT profile_setores_pkey PRIMARY KEY (profile_id, setor_id)
);

CREATE TABLE public.configuracoes_globais (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    chave text NOT NULL,
    valor jsonb NOT NULL,
    descricao text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT configuracoes_globais_pkey PRIMARY KEY (id),
    CONSTRAINT configuracoes_globais_chave_key UNIQUE (chave)
);

CREATE TABLE public.feriados (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    data date NOT NULL,
    descricao text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT feriados_pkey PRIMARY KEY (id),
    CONSTRAINT feriados_data_key UNIQUE (data)
);

CREATE TABLE public.escala_mensal (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    mes integer NOT NULL,
    ano integer NOT NULL,
    servidor_id uuid,
    unidade_id uuid,
    status text NOT NULL DEFAULT 'Rascunho'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    setor_id uuid,
    ativo boolean DEFAULT true,
    inativada_em timestamp with time zone,
    jornada_id uuid,
    CONSTRAINT escala_mensal_pkey PRIMARY KEY (id),
    CONSTRAINT escala_mensal_mes_ano_servidor_id_unidade_id_setor_id_key UNIQUE (mes, ano, servidor_id, unidade_id, setor_id)
);

CREATE TABLE public.escala_diaria (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    escala_mensal_id uuid,
    dia integer NOT NULL,
    dicionario_turnos_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    categoria public.escala_categoria DEFAULT 'Regular'::public.escala_categoria,
    presenca_confirmada boolean DEFAULT false,
    presenca_confirmada_em timestamp with time zone,
    confirmado_por_id uuid,
    presenca_entrada_em timestamp with time zone,
    presenca_saida_em timestamp with time zone,
    CONSTRAINT escala_diaria_pkey PRIMARY KEY (id),
    CONSTRAINT escala_diaria_escala_mensal_id_dia_cat_key UNIQUE (escala_mensal_id, dia, categoria)
);

CREATE TABLE public.logs_sobreaviso (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    servidor_id uuid,
    unidade_id uuid,
    data_hora_acionamento timestamp with time zone DEFAULT now(),
    status public.sobreaviso_status NOT NULL DEFAULT 'Aguardando'::public.sobreaviso_status,
    token_magic_link uuid DEFAULT uuid_generate_v4(),
    data_hora_aceite timestamp with time zone,
    ip_aceite inet,
    user_agent text,
    lat_aceite double precision,
    long_aceite double precision,
    eta_minutos integer,
    data_hora_chegada timestamp with time zone,
    tipo_validacao_chegada text,
    created_at timestamp with time zone DEFAULT now(),
    lat_chegada numeric,
    long_chegada numeric,
    motivo_acionamento text,
    escala_mensal_id uuid,
    justificativa_recusa text,
    lat_recusa double precision,
    long_recusa double precision,
    dia integer,
    validacao_manual boolean DEFAULT false,
    motivo_falha text,
    ip_chegada text,
    validado_por uuid,
    data_hora_validacao timestamp with time zone,
    categoria text DEFAULT 'Sobreaviso'::text,
    CONSTRAINT logs_sobreaviso_pkey PRIMARY KEY (id)
);

CREATE TABLE public.logs_sistema (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    acao text NOT NULL,
    detalhes jsonb DEFAULT '{}'::jsonb,
    unidade_id uuid,
    setor_id uuid,
    CONSTRAINT logs_sistema_pkey PRIMARY KEY (id)
);

CREATE TABLE public.solicitacoes_troca (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    solicitante_id uuid NOT NULL,
    escala_mensal_solicitante_id uuid NOT NULL,
    dia_origem integer NOT NULL,
    categoria_origem text NOT NULL DEFAULT 'Regular'::text,
    turno_origem_id uuid,
    destinatario_id uuid,
    escala_mensal_destinatario_id uuid,
    dia_destino integer,
    justificativa text NOT NULL,
    status text NOT NULL DEFAULT 'Pendente'::text,
    motivo_rejeicao text,
    aprovado_por uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT solicitacoes_troca_pkey PRIMARY KEY (id)
);

-- ----------------------------------------------------
-- 5. Insert Authentication Data (auth.users & auth.identities)
-- ----------------------------------------------------
`;

  // Read auth users
  const authUsers = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth_users.json'), 'utf8'));
  const authIdentities = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth_identities.json'), 'utf8'));

  sql += `\n-- Inserting Auth Users\n`;
  for (const user of authUsers) {
    const rawApp = JSON.stringify(user.raw_app_meta_data).replace(/'/g, "''");
    const rawUser = JSON.stringify(user.raw_user_meta_data).replace(/'/g, "''");
    
    // We insert into auth.users using complete list of required columns
    sql += `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
VALUES (
  '${user.id}',
  '00000000-0000-0000-0000-000000000000',
  '${user.email}',
  '${user.encrypted_password}',
  '${user.email_confirmed_at}',
  '${rawApp}'::jsonb,
  '${rawUser}'::jsonb,
  '${user.created_at}',
  '${user.updated_at}',
  'authenticated',
  'authenticated',
  false,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;\n`;
  }

  sql += `\n-- Inserting Auth Identities\n`;
  for (const identity of authIdentities) {
    const rawData = JSON.stringify(identity.identity_data).replace(/'/g, "''");
    sql += `INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  '${identity.id}',
  '${identity.provider_id}',
  '${identity.user_id}',
  '${rawData}'::jsonb,
  '${identity.provider}',
  '${identity.last_sign_in_at}',
  '${identity.created_at}',
  '${identity.updated_at}'
) ON CONFLICT (id) DO NOTHING;\n`;
  }

  // ----------------------------------------------------
  // 6. Fetch and Insert Public Data
  // ----------------------------------------------------
  sql += `\n-- ----------------------------------------------------\n`;
  sql += `-- 6. Insert Public Tables Data\n`;
  sql += `-- ----------------------------------------------------\n`;

  for (const table of tables) {
    console.log(`Fetching data for table ${table}...`);
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      console.error(`Error fetching ${table}:`, error);
      throw error;
    }
    
    console.log(`Fetched ${data.length} rows for ${table}. Generating INSERTs...`);
    sql += `\n-- Table: public.${table} (${data.length} rows)\n`;
    
    if (data.length > 0) {
      const columns = Object.keys(data[0]);
      
      for (const row of data) {
        const valuesList = columns.map(col => {
          const type = tableColumnTypes[table][col];
          return formatValue(row[col], type);
        });
        
        sql += `INSERT INTO public.${table} (${columns.join(', ')}) VALUES (${valuesList.join(', ')});\n`;
      }
    }
  }

  // ----------------------------------------------------
  // 7. Create Custom Functions, Triggers & Policies
  // ----------------------------------------------------
  sql += `\n-- ----------------------------------------------------\n`;
  sql += `-- 7. Create Functions, Triggers, RLS, and Constraints\n`;
  sql += `-- ----------------------------------------------------\n`;

  sql += `
-- Functions
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', 'servidor');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_sobreaviso_details(magic_token uuid)
RETURNS json AS $$
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
  FROM public.logs_sobreaviso l
  JOIN public.servidores s ON s.id = l.servidor_id
  JOIN public.unidades u ON u.id = l.unidade_id
  WHERE l.token_magic_link = magic_token;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(p_matricula text, p_pin_servidor text, p_coordenador_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_servidor_id UUID;
    v_escala_diaria_id UUID;
    v_escala_mensal_id UUID;
    v_unidade_id UUID;
    v_entrada_confirmada TIMESTAMP WITH TIME ZONE;
    v_saida_confirmada TIMESTAMP WITH TIME ZONE;
    v_turno_id UUID;
    v_slots TEXT[];
    v_horas_shift NUMERIC;
    v_start_hour INTEGER;
    v_end_hour INTEGER;
    v_now TIMESTAMP WITH TIME ZONE;
    v_now_local TIMESTAMP;
    v_janela_minutos INTEGER;
    v_timezone TEXT;
    v_hora_atual INTEGER;
    v_minuto_atual INTEGER;
    v_momento_atual_minutos INTEGER;
    v_inicio_turno_minutos INTEGER;
    v_fim_turno_minutos INTEGER;
    v_mes INTEGER;
    v_ano INTEGER;
    v_dia_hoje INTEGER;
    v_dia_ontem INTEGER;
    v_mes_ontem INTEGER;
    v_ano_ontem INTEGER;
    v_date_ontem DATE;
    v_categoria_final TEXT;
    v_tipo_final TEXT;
BEGIN
    v_now := now();
    
    SELECT (valor#>>'{}')::text INTO v_timezone 
    FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_timezone IS NULL THEN v_timezone := 'America/Sao_Paulo'; END IF;

    SELECT (valor#>>'{}')::integer INTO v_janela_minutos 
    FROM public.configuracoes_globais WHERE chave = 'janela_presenca_minutos';
    IF v_janela_minutos IS NULL THEN v_janela_minutos := 30; END IF;

    v_now_local := v_now AT TIME ZONE v_timezone;
    
    v_dia_hoje := extract(day from v_now_local)::integer;
    v_mes := extract(month from v_now_local)::integer;
    v_ano := extract(year from v_now_local)::integer;
    
    v_date_ontem := v_now_local::date - interval '1 day';
    v_dia_ontem := extract(day from v_date_ontem)::integer;
    v_mes_ontem := extract(month from v_date_ontem)::integer;
    v_ano_ontem := extract(year from v_date_ontem)::integer;

    SELECT s.id INTO v_servidor_id
    FROM public.servidores s
    WHERE s.matricula = p_matricula
      AND s.pin_acesso = p_pin_servidor;

    IF v_servidor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Matrícula ou PIN inválidos.');
    END IF;

    SELECT ed.id, em.id, em.unidade_id, ed.presenca_entrada_em, ed.presenca_saida_em, ed.dicionario_turnos_id, dt.horas_computadas, dt.slots, ed.categoria::text
    INTO v_escala_diaria_id, v_escala_mensal_id, v_unidade_id, v_entrada_confirmada, v_saida_confirmada, v_turno_id, v_horas_shift, v_slots, v_categoria_final
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    WHERE em.servidor_id = v_servidor_id
      AND em.mes = v_mes
      AND em.ano = v_ano
      AND ed.dia = v_dia_hoje
      AND ed.categoria IN ('Regular', 'Extra', 'Plantão')
    LIMIT 1;

    IF v_slots IS NOT NULL AND array_length(v_slots, 1) > 0 THEN
        v_start_hour := CASE 
            WHEN v_slots[1] ~ '^[0-9]+$' THEN v_slots[1]::integer
            WHEN v_slots[1] = 'M' THEN 7
            WHEN v_slots[1] = 'T' THEN 13
            WHEN v_slots[1] = 'N' THEN 19
            ELSE 7
        END;
    ELSE
        v_start_hour := 7;
    END IF;

    v_end_hour := v_start_hour + COALESCE(v_horas_shift, 0)::integer;

    v_hora_atual := extract(hour from v_now_local)::integer;
    v_minuto_atual := extract(minute from v_now_local)::integer;
    v_momento_atual_minutos := (v_hora_atual * 60) + v_minuto_atual;

    IF (v_escala_diaria_id IS NULL OR v_entrada_confirmada IS NOT NULL OR v_hora_atual < 12) AND v_hora_atual < 12 THEN
        DECLARE
            v_id_ontem UUID;
            v_mensal_ontem UUID;
            v_unid_ontem UUID;
            v_ent_ontem TIMESTAMP WITH TIME ZONE;
            v_sai_ontem TIMESTAMP WITH TIME ZONE;
            dt_slots_ontem TEXT[];
            dt_horas_ontem NUMERIC;
            v_start_ontem INTEGER;
            v_end_ontem INTEGER;
            v_cat_ontem TEXT;
        BEGIN
            SELECT ed.id, em.id, em.unidade_id, ed.presenca_entrada_em, ed.presenca_saida_em, dt.slots, dt.horas_computadas, ed.categoria::text
            INTO v_id_ontem, v_mensal_ontem, v_unid_ontem, v_ent_ontem, v_sai_ontem, dt_slots_ontem, dt_horas_ontem, v_cat_ontem
            FROM public.escala_diaria ed
            JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
            JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
            WHERE em.servidor_id = v_servidor_id
              AND em.mes = v_mes_ontem
              AND em.ano = v_ano_ontem
              AND ed.dia = v_dia_ontem
              AND ed.categoria IN ('Regular', 'Extra', 'Plantão')
            LIMIT 1;

            IF v_id_ontem IS NOT NULL AND v_sai_ontem IS NULL THEN
                v_start_ontem := CASE 
                    WHEN dt_slots_ontem[1] ~ '^[0-9]+$' THEN dt_slots_ontem[1]::integer
                    WHEN dt_slots_ontem[1] = 'M' THEN 7
                    WHEN dt_slots_ontem[1] = 'T' THEN 13
                    WHEN dt_slots_ontem[1] = 'N' THEN 19
                    ELSE 7
                END;
                v_end_ontem := v_start_ontem + dt_horas_ontem::integer;
                
                IF v_end_ontem > 24 THEN
                    v_fim_turno_minutos := (v_end_ontem - 24) * 60;
                    IF v_momento_atual_minutos >= (v_fim_turno_minutos - v_janela_minutos) AND 
                       v_momento_atual_minutos <= (v_fim_turno_minutos + v_janela_minutos) THEN
                        
                        UPDATE public.escala_diaria SET presenca_saida_em = v_now, confirmado_por_id = p_coordenador_id WHERE id = v_id_ontem;
                        
                        INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
                        VALUES (v_servidor_id, v_unid_ontem, v_mensal_ontem, v_dia_ontem, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA ONTEM) via terminal.', 'Manual');
                        
                        RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada (Plantão de Ontem) às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
                    END IF;
                END IF;
            END IF;
        END;
    END IF;

    IF v_escala_diaria_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nenhum plantão agendado para você hoje.');
    END IF;

    v_inicio_turno_minutos := v_start_hour * 60;
    IF v_end_hour <= 24 THEN
        v_fim_turno_minutos := v_end_hour * 60;
    ELSE
        v_fim_turno_minutos := 9999;
    END IF;

    IF v_entrada_confirmada IS NULL THEN
        IF v_momento_atual_minutos >= (v_inicio_turno_minutos - v_janela_minutos) AND 
           v_momento_atual_minutos <= (v_inicio_turno_minutos + v_janela_minutos) THEN
            
            UPDATE public.escala_diaria SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id WHERE id = v_escala_diaria_id;
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (ENTRADA) via terminal.', 'Manual');
            
            RETURN jsonb_build_object('success', true, 'message', 'Entrada confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom plantão!');
        
        ELSIF v_end_hour <= 24 AND v_momento_atual_minutos >= (v_fim_turno_minutos - v_janela_minutos) AND 
              v_momento_atual_minutos <= (v_fim_turno_minutos + v_janela_minutos) THEN
            
            UPDATE public.escala_diaria SET presenca_saida_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id WHERE id = v_escala_diaria_id;
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA SEM ENTRADA) via terminal.', 'Manual');
            
            RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Atenção: Sua ENTRADA não foi registrada e precisará de validação manual do administrador.');
        
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de ENTRADA. Seu plantão inicia às ' || lpad(v_start_hour::text, 2, '0') || ':00.');
        END IF;
    
    ELSIF v_saida_confirmada IS NULL THEN
        IF v_end_hour > 24 THEN
             RETURN jsonb_build_object('success', false, 'message', 'Sua saída está prevista para amanhã às ' || lpad((v_end_hour-24)::text, 2, '0') || ':00.');
        END IF;

        IF v_momento_atual_minutos >= (v_fim_turno_minutos - v_janela_minutos) AND 
           v_momento_atual_minutos <= (v_fim_turno_minutos + v_janela_minutos) THEN
            
            UPDATE public.escala_diaria SET presenca_saida_em = v_now, confirmado_por_id = p_coordenador_id WHERE id = v_escala_diaria_id;
            
            INSERT INTO public.logs_sobreaviso (servidor_id, unidade_id, escala_mensal_id, dia, data_hora_acionamento, data_hora_validacao, validacao_manual, validado_por, status, motivo_acionamento, tipo_validacao_chegada)
            VALUES (v_servidor_id, v_unidade_id, v_escala_mensal_id, v_dia_hoje, v_now, v_now, false, p_coordenador_id, 'Chegou', 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', 'Manual');
            
            RETURN jsonb_build_object('success', true, 'message', 'Saída confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom descanso!');
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Fora da janela de SAÍDA. Seu plantão encerra às ' || lpad(v_end_hour::text, 2, '0') || ':00.');
        END IF;
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Você já registrou sua entrada e saída hoje.');
    END IF;

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', 'Erro interno: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_reverter_presenca_manual(p_escala_mensal_id uuid, p_dia integer, p_categoria public.escala_categoria, p_tipo text, p_validador_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_escala_diaria_id UUID;
    v_unidade_id UUID;
    v_servidor_id UUID;
    v_tem_outra_presenca BOOLEAN;
BEGIN
    SELECT unidade_id, servidor_id INTO v_unidade_id, v_servidor_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;

    SELECT id INTO v_escala_diaria_id
    FROM public.escala_diaria
    WHERE escala_mensal_id = p_escala_mensal_id
      AND dia = p_dia
      AND categoria = p_categoria;

    IF v_escala_diaria_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Registro de escala não encontrado.');
    END IF;

    IF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria 
        SET presenca_entrada_em = NULL, 
            updated_at = now()
        WHERE id = v_escala_diaria_id;
    ELSE
        UPDATE public.escala_diaria 
        SET presenca_saida_em = NULL, 
            updated_at = now()
        WHERE id = v_escala_diaria_id;
    END IF;

    SELECT (presenca_entrada_em IS NOT NULL OR presenca_saida_em IS NOT NULL)
    INTO v_tem_outra_presenca
    FROM public.escala_diaria
    WHERE id = v_escala_diaria_id;

    UPDATE public.escala_diaria
    SET presenca_confirmada = v_tem_outra_presenca,
        confirmado_por_id = CASE WHEN v_tem_outra_presenca THEN confirmado_por_id ELSE NULL END
    WHERE id = v_escala_diaria_id;

    INSERT INTO public.logs_sobreaviso (
        servidor_id,
        unidade_id,
        escala_mensal_id,
        dia,
        data_hora_acionamento,
        data_hora_validacao,
        validacao_manual,
        validado_por,
        status,
        motivo_acionamento,
        tipo_validacao_chegada,
        categoria
    ) VALUES (
        v_servidor_id,
        v_unidade_id,
        p_escala_mensal_id,
        p_dia,
        now(),
        now(),
        true,
        p_validador_id,
        'Cancelado',
        'REVERSÃO Manual (' || p_categoria::text || ' - ' || p_tipo || ')',
        'Manual',
        p_categoria::text
    );

    RETURN jsonb_build_object('success', true, 'message', 'Presença revertida com sucesso.');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(p_escala_mensal_id uuid, p_dia integer, p_categoria public.escala_categoria, p_tipo text, p_validador_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_escala_diaria_id UUID;
    v_now TIMESTAMP WITH TIME ZONE;
    v_unidade_id UUID;
    v_servidor_id UUID;
    v_already_confirmed BOOLEAN;
BEGIN
    v_now := now();

    SELECT unidade_id, servidor_id INTO v_unidade_id, v_servidor_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;

    IF v_servidor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Escala mensal não encontrada.');
    END IF;

    SELECT id, 
           CASE WHEN p_tipo = 'entrada' THEN presenca_entrada_em IS NOT NULL 
                ELSE presenca_saida_em IS NOT NULL END
    INTO v_escala_diaria_id, v_already_confirmed
    FROM public.escala_diaria
    WHERE escala_mensal_id = p_escala_mensal_id
      AND dia = p_dia
      AND categoria = p_categoria;

    IF v_escala_diaria_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'O servidor não está escalado para este dia/categoria.');
    END IF;

    IF v_already_confirmed THEN
        RETURN jsonb_build_object('success', false, 'message', 'Esta presença já foi registrada anteriormente.');
    END IF;

    IF p_tipo = 'entrada' THEN
        UPDATE public.escala_diaria 
        SET presenca_entrada_em = v_now, 
            presenca_confirmada = true, 
            confirmado_por_id = p_validador_id,
            updated_at = v_now
        WHERE id = v_escala_diaria_id;
    ELSE
        UPDATE public.escala_diaria 
        SET presenca_saida_em = v_now, 
            presenca_confirmada = true, 
            confirmado_por_id = p_validador_id,
            updated_at = v_now
        WHERE id = v_escala_diaria_id;
    END IF;

    INSERT INTO public.logs_sobreaviso (
        servidor_id,
        unidade_id,
        escala_mensal_id,
        dia,
        data_hora_acionamento,
        data_hora_validacao,
        validacao_manual,
        validado_por,
        status,
        motivo_acionamento,
        tipo_validacao_chegada,
        categoria
    ) VALUES (
        v_servidor_id,
        v_unidade_id,
        p_escala_mensal_id,
        p_dia,
        v_now,
        v_now,
        true,
        p_validador_id,
        'Chegou',
        'Validação Manual (' || p_categoria::text || ' - ' || p_tipo || ')',
        'Manual',
        p_categoria::text
    );

    RETURN jsonb_build_object('success', true, 'message', 'Presença validada com sucesso.');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.accept_sobreaviso_call(magic_token uuid, p_lat double precision, p_long double precision, p_ip text, p_user_agent text)
RETURNS jsonb AS $$
DECLARE
  v_log_id UUID;
  v_status public.sobreaviso_status;
BEGIN
  SELECT id, status INTO v_log_id, v_status
  FROM public.logs_sobreaviso
  WHERE token_magic_link = magic_token;

  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link inválido.');
  END IF;

  IF v_status != 'Aguardando' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este chamado já foi processado ou expirou.');
  END IF;

  UPDATE public.logs_sobreaviso
  SET 
    status = 'Aceito',
    data_hora_aceite = NOW(),
    lat_aceite = p_lat,
    long_aceite = p_long,
    ip_aceite = p_ip::inet,
    user_agent = p_user_agent
  WHERE id = v_log_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.register_sobreaviso_arrival(magic_token uuid, p_lat double precision, p_long double precision, p_ip text)
RETURNS jsonb AS $$
DECLARE
  v_log_id UUID;
  v_status public.sobreaviso_status;
BEGIN
  SELECT id, status INTO v_log_id, v_status
  FROM public.logs_sobreaviso
  WHERE token_magic_link = magic_token;

  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link inválido.');
  END IF;

  IF v_status != 'Aceito' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Você precisa aceitar o chamado antes de registrar a chegada.');
  END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.decline_sobreaviso_call(magic_token uuid, p_justificativa text, p_lat double precision, p_long double precision)
RETURNS jsonb AS $$
DECLARE
  v_log_id UUID;
  v_status public.sobreaviso_status;
BEGIN
  SELECT id, status INTO v_log_id, v_status
  FROM public.logs_sobreaviso
  WHERE token_magic_link = magic_token;

  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Link inválido.');
  END IF;

  IF v_status != 'Aguardando' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este chamado não pode mais ser recusado.');
  END IF;

  UPDATE public.logs_sobreaviso
  SET 
    status = 'Recusado',
    justificativa_recusa = p_justificativa,
    data_hora_aceite = NOW(),
    lat_recusa = p_lat,
    long_recusa = p_long
  WHERE id = v_log_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.mark_sobreaviso_timeout(magic_token uuid, p_motivo text)
RETURNS jsonb AS $$
BEGIN
  UPDATE public.logs_sobreaviso
  SET 
    status = 'Falhou',
    motivo_falha = p_motivo
  WHERE token_magic_link = magic_token 
  AND status IN ('Aguardando', 'Aceito');

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.sync_setor_name_compatibility()
RETURNS trigger AS $$
BEGIN
    IF NEW.dicionario_setor_id IS NOT NULL THEN
        SELECT nome INTO NEW.nome FROM public.dicionario_setores WHERE id = NEW.dicionario_setor_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts(
    p_servidor_id uuid,
    p_dia integer,
    p_mes integer,
    p_ano integer,
    p_turno_id uuid,
    p_escala_diaria_id_ignore uuid DEFAULT NULL::uuid
)
RETURNS TABLE(has_conflict boolean, conflict_message text, details jsonb) AS $$
DECLARE
    v_slots_pretendidos text[];
    v_conflito_id uuid;
    v_conflito_msg text;
    v_detalhes jsonb;
BEGIN
    SELECT slots INTO v_slots_pretendidos FROM public.dicionario_turnos WHERE id = p_turno_id;

    IF v_slots_pretendidos IS NULL OR array_length(v_slots_pretendidos, 1) IS NULL THEN
        RETURN QUERY SELECT false, NULL::text, NULL::jsonb;
        RETURN;
    END IF;

    SELECT 
        ed.id,
        format('Conflito com %s no Setor %s (%s)', 
               dt.codigo, 
               ds.nome, 
               u.nome
        ),
        jsonb_build_object(
            'setor', ds.nome,
            'unidade', u.nome,
            'turno', dt.codigo,
            'categoria', ed.categoria
        )
    INTO v_conflito_id, v_conflito_msg, v_detalhes
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    JOIN public.setores s ON em.setor_id = s.id
    JOIN public.dicionario_setores ds ON s.dicionario_setor_id = ds.id
    JOIN public.unidades u ON em.unidade_id = u.id
    WHERE em.servidor_id = p_servidor_id
      AND em.mes = p_mes
      AND em.ano = p_ano
      AND ed.dia = p_dia
      AND (p_escala_diaria_id_ignore IS NULL OR ed.id <> p_escala_diaria_id_ignore)
      AND ed.dicionario_turnos_id IS NOT NULL
      AND dt.slots && v_slots_pretendidos
    LIMIT 1;

    IF v_conflito_id IS NOT NULL THEN
        RETURN QUERY SELECT true, v_conflito_msg, v_detalhes;
    ELSE
        RETURN QUERY SELECT false, NULL::text, NULL::jsonb;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.fn_get_monthly_occupancy(
    p_servidor_ids uuid[],
    p_mes integer,
    p_ano integer
)
RETURNS TABLE(
    servidor_id uuid,
    escala_mensal_id uuid,
    dia integer,
    slots text[],
    descricao_conflito text,
    unidade_id uuid,
    setor_id uuid,
    categoria text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        em.servidor_id,
        em.id as escala_mensal_id,
        ed.dia,
        dt.slots,
        format('%s (%s - %s)', dt.codigo, ds.nome, u.nome) as descricao_conflito,
        em.unidade_id,
        em.setor_id,
        ed.categoria::text
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
    JOIN public.setores s ON em.setor_id = s.id
    JOIN public.dicionario_setores ds ON s.dicionario_setor_id = ds.id
    JOIN public.unidades u ON em.unidade_id = u.id
    WHERE em.servidor_id = ANY(p_servidor_ids)
      AND em.mes = p_mes
      AND em.ano = p_ano
      AND ed.dicionario_turnos_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon;
GRANT EXECUTE ON FUNCTION public.get_sobreaviso_details(uuid) TO anon, authenticated;

-- Foreign Keys
ALTER TABLE public.setores ADD CONSTRAINT setores_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES public.unidades(id) ON DELETE SET NULL;
ALTER TABLE public.setores ADD CONSTRAINT setores_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.setores(id) ON DELETE SET NULL;
ALTER TABLE public.setores ADD CONSTRAINT setores_dicionario_setor_id_fkey FOREIGN KEY (dicionario_setor_id) REFERENCES public.dicionario_setores(id) ON DELETE SET NULL;

ALTER TABLE public.servidores ADD CONSTRAINT servidores_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES public.unidades(id) ON DELETE SET NULL;
ALTER TABLE public.servidores ADD CONSTRAINT servidores_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.setores(id) ON DELETE SET NULL;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES public.unidades(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.setores(id) ON DELETE SET NULL;

ALTER TABLE public.profile_unidades ADD CONSTRAINT profile_unidades_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.profile_unidades ADD CONSTRAINT profile_unidades_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES public.unidades(id) ON DELETE CASCADE;

ALTER TABLE public.profile_setores ADD CONSTRAINT profile_setores_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.profile_setores ADD CONSTRAINT profile_setores_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.setores(id) ON DELETE CASCADE;

ALTER TABLE public.cargos ADD CONSTRAINT cargos_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.cargos(id) ON DELETE SET NULL;

ALTER TABLE public.escala_mensal ADD CONSTRAINT escala_mensal_servidor_id_fkey FOREIGN KEY (servidor_id) REFERENCES public.servidores(id) ON DELETE SET NULL;
ALTER TABLE public.escala_mensal ADD CONSTRAINT escala_mensal_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES public.unidades(id) ON DELETE SET NULL;
ALTER TABLE public.escala_mensal ADD CONSTRAINT escala_mensal_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.setores(id) ON DELETE SET NULL;
ALTER TABLE public.escala_mensal ADD CONSTRAINT escala_mensal_jornada_id_fkey FOREIGN KEY (jornada_id) REFERENCES public.jornadas(id) ON DELETE SET NULL;

ALTER TABLE public.escala_diaria ADD CONSTRAINT escala_diaria_escala_mensal_id_fkey FOREIGN KEY (escala_mensal_id) REFERENCES public.escala_mensal(id) ON DELETE CASCADE;
ALTER TABLE public.escala_diaria ADD CONSTRAINT escala_diaria_dicionario_turnos_id_fkey FOREIGN KEY (dicionario_turnos_id) REFERENCES public.dicionario_turnos(id) ON DELETE SET NULL;
ALTER TABLE public.escala_diaria ADD CONSTRAINT escala_diaria_confirmado_por_id_fkey FOREIGN KEY (confirmado_por_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.logs_sobreaviso ADD CONSTRAINT logs_sobreaviso_servidor_id_fkey FOREIGN KEY (servidor_id) REFERENCES public.servidores(id) ON DELETE SET NULL;
ALTER TABLE public.logs_sobreaviso ADD CONSTRAINT logs_sobreaviso_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES public.unidades(id) ON DELETE SET NULL;
ALTER TABLE public.logs_sobreaviso ADD CONSTRAINT logs_sobreaviso_escala_mensal_id_fkey FOREIGN KEY (escala_mensal_id) REFERENCES public.escala_mensal(id) ON DELETE SET NULL;
ALTER TABLE public.logs_sobreaviso ADD CONSTRAINT logs_sobreaviso_validado_por_fkey FOREIGN KEY (validado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.logs_sistema ADD CONSTRAINT logs_sistema_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.logs_sistema ADD CONSTRAINT logs_sistema_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES public.unidades(id) ON DELETE SET NULL;
ALTER TABLE public.logs_sistema ADD CONSTRAINT logs_sistema_setor_id_fkey FOREIGN KEY (setor_id) REFERENCES public.setores(id) ON DELETE SET NULL;

ALTER TABLE public.solicitacoes_troca ADD CONSTRAINT solicitacoes_troca_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES public.servidores(id) ON DELETE CASCADE;
ALTER TABLE public.solicitacoes_troca ADD CONSTRAINT solicitacoes_troca_escala_mensal_solicitante_id_fkey FOREIGN KEY (escala_mensal_solicitante_id) REFERENCES public.escala_mensal(id) ON DELETE CASCADE;
ALTER TABLE public.solicitacoes_troca ADD CONSTRAINT solicitacoes_troca_turno_origem_id_fkey FOREIGN KEY (turno_origem_id) REFERENCES public.dicionario_turnos(id) ON DELETE SET NULL;
ALTER TABLE public.solicitacoes_troca ADD CONSTRAINT solicitacoes_troca_destinatario_id_fkey FOREIGN KEY (destinatario_id) REFERENCES public.servidores(id) ON DELETE SET NULL;
ALTER TABLE public.solicitacoes_troca ADD CONSTRAINT solicitacoes_troca_escala_mensal_destinatario_id_fkey FOREIGN KEY (escala_mensal_destinatario_id) REFERENCES public.escala_mensal(id) ON DELETE SET NULL;

-- Triggers
CREATE TRIGGER set_updated_at_unidades BEFORE UPDATE ON public.unidades FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_servidores BEFORE UPDATE ON public.servidores FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_dicionario_turnos BEFORE UPDATE ON public.dicionario_turnos FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_escala_mensal BEFORE UPDATE ON public.escala_mensal FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_escala_diaria BEFORE UPDATE ON public.escala_diaria FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER tr_sync_setor_name BEFORE INSERT OR UPDATE ON public.setores FOR EACH ROW EXECUTE FUNCTION sync_setor_name_compatibility();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Indexes
CREATE INDEX idx_logs_sobreaviso_token ON public.logs_sobreaviso USING btree (token_magic_link);
CREATE INDEX idx_servidores_unidade_setor ON public.servidores USING btree (unidade_id, setor_id, status);
CREATE INDEX idx_escala_mensal_performance ON public.escala_mensal USING btree (unidade_id, setor_id, mes, ano, ativo);
CREATE INDEX idx_logs_sistema_unidade_setor_created ON public.logs_sistema USING btree (unidade_id, setor_id, created_at);
CREATE INDEX idx_escala_diaria_escala_mensal_id ON public.escala_diaria USING btree (escala_mensal_id);
CREATE INDEX idx_sol_troca_solicitante ON public.solicitacoes_troca USING btree (solicitante_id);
CREATE INDEX idx_sol_troca_escala ON public.solicitacoes_troca USING btree (escala_mensal_solicitante_id);
CREATE INDEX idx_sol_troca_created ON public.solicitacoes_troca USING btree (created_at DESC);
CREATE INDEX idx_sol_troca_status ON public.solicitacoes_troca USING btree (status);

-- Row Level Security (RLS) policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicionario_turnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dicionario_setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escala_mensal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escala_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_sobreaviso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servidores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jornadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes_globais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_troca ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can manage all profiles" ON public.profiles FOR ALL USING (get_my_role() = 'super_admin'::user_role);

CREATE POLICY "Authenticated users can view units" ON public.unidades FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage units restricted to Super Admin" ON public.unidades FOR ALL TO authenticated USING (get_my_role() = 'super_admin'::user_role);

CREATE POLICY "Everyone can view shift dictionary" ON public.dicionario_turnos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage turnos" ON public.dicionario_turnos FOR ALL USING (get_my_role() = 'super_admin'::user_role);

CREATE POLICY "Permitir leitura para todos" ON public.dicionario_setores FOR SELECT USING (true);
CREATE POLICY "Permitir inserção para autenticados" ON public.dicionario_setores FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can view sectors" ON public.setores FOR SELECT USING (auth.role() = 'authenticated'::text);
CREATE POLICY "Scoped access for Setores" ON public.setores FOR ALL TO authenticated USING (
  (get_my_role() = 'super_admin'::user_role) OR 
  (unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR 
  (id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
);

CREATE POLICY "Permitir tudo para usuários autenticados" ON public.cargos FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON public.feriados FOR ALL TO authenticated USING (true);

CREATE POLICY "Everyone can view journeys" ON public.jornadas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage journeys" ON public.jornadas FOR ALL USING (get_my_role() = 'super_admin'::user_role);

CREATE POLICY "Users can view relevant servers" ON public.servidores FOR SELECT TO authenticated USING (
  (get_my_role() = 'super_admin'::user_role) OR 
  (unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR 
  (setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
);
CREATE POLICY "Admins can manage all servers" ON public.servidores FOR ALL TO authenticated USING (get_my_role() = 'super_admin'::user_role);
CREATE POLICY "Scoped access for Admins and Coordinators" ON public.servidores FOR ALL TO authenticated USING (
  (get_my_role() = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND 
  ((unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid()))) OR 
  (setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
);

CREATE POLICY "Admins manage units access" ON public.profile_unidades FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role]))
);
CREATE POLICY "Users view own unit access" ON public.profile_unidades FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "Admins manage sectors access" ON public.profile_setores FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role]))
);
CREATE POLICY "Users view own sector access" ON public.profile_setores FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "Permitir leitura de configurações para todos" ON public.configuracoes_globais FOR SELECT TO authenticated USING (true);
CREATE POLICY "Portal access to public configs" ON public.configuracoes_globais FOR SELECT USING (chave LIKE 'sobreaviso_%');
CREATE POLICY "Permitir atualização apenas para administradores" ON public.configuracoes_globais FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))
);
CREATE POLICY "Escrita apenas para Super Admin" ON public.configuracoes_globais FOR ALL TO authenticated USING (get_my_role() = 'super_admin'::user_role);

CREATE POLICY "Authenticated users can view scales" ON public.escala_mensal FOR SELECT USING (auth.role() = 'authenticated'::text);
CREATE POLICY "Super Admins manage all scales" ON public.escala_mensal FOR ALL TO authenticated USING (get_my_role() = 'super_admin'::user_role);
CREATE POLICY "Scoped access for Escala Mensal" ON public.escala_mensal FOR ALL TO authenticated USING (
  (get_my_role() = 'super_admin'::user_role) OR 
  (unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR 
  (setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
);
CREATE POLICY "Admins manage scales in their units" ON public.escala_mensal FOR ALL TO authenticated USING (
  (get_my_role() = 'admin'::user_role) AND 
  (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true) OR 
   unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid()))
);
CREATE POLICY "Coordinators manage scales in their sectors" ON public.escala_mensal FOR ALL TO authenticated USING (
  (get_my_role() = 'coordenador'::user_role) AND 
  (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true) OR 
   setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
);

CREATE POLICY "Authenticated users can view daily scales" ON public.escala_diaria FOR SELECT USING (auth.role() = 'authenticated'::text);
CREATE POLICY "Super Admins manage all daily scales" ON public.escala_diaria FOR ALL TO authenticated USING (get_my_role() = 'super_admin'::user_role);
CREATE POLICY "Admins manage daily scales in their units" ON public.escala_diaria FOR ALL TO authenticated USING (
  (get_my_role() = 'admin'::user_role) AND 
  EXISTS (SELECT 1 FROM public.escala_mensal em WHERE em.id = escala_diaria.escala_mensal_id AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true) OR 
    em.unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())
  ))
);
CREATE POLICY "Coordinators manage daily scales in their sectors" ON public.escala_diaria FOR ALL TO authenticated USING (
  (get_my_role() = 'coordenador'::user_role) AND 
  EXISTS (SELECT 1 FROM public.escala_mensal em WHERE em.id = escala_diaria.escala_mensal_id AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true) OR 
    em.setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid())
  ))
);

CREATE POLICY "Authenticated users can view audit logs" ON public.logs_sobreaviso FOR SELECT USING (auth.role() = 'authenticated'::text);
CREATE POLICY "Super Admins manage all on-call logs" ON public.logs_sobreaviso FOR ALL TO authenticated USING (get_my_role() = 'super_admin'::user_role);
CREATE POLICY "Admins manage on-call logs in their units" ON public.logs_sobreaviso FOR ALL TO authenticated USING (
  (get_my_role() = 'admin'::user_role) AND 
  (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todas_unidades = true) OR 
   unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid()))
);
CREATE POLICY "Coordinators manage on-call logs in their sectors" ON public.logs_sobreaviso FOR ALL TO authenticated USING (
  (get_my_role() = 'coordenador'::user_role) AND 
  EXISTS (SELECT 1 FROM public.escala_mensal em WHERE em.id = logs_sobreaviso.escala_mensal_id AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.acesso_todos_setores = true) OR 
    em.setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid())
  ))
);

CREATE POLICY "Logs visiveis por quem tem acesso a unidade" ON public.logs_sistema FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND (
      p.role = 'super_admin'::user_role OR 
      p.acesso_todas_unidades OR 
      logs_sistema.unidade_id = p.unidade_id OR 
      EXISTS (SELECT 1 FROM public.profile_unidades pu WHERE pu.profile_id = p.id AND pu.unidade_id = logs_sistema.unidade_id)
    )
  )
);
CREATE POLICY "Logs inseriveis por qualquer autenticado" ON public.logs_sistema FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can view swap requests" ON public.solicitacoes_troca FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert swap requests" ON public.solicitacoes_troca FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update swap requests" ON public.solicitacoes_troca FOR UPDATE TO authenticated WITH CHECK (true);

-- Restore trigger and FK constraint checking
SET session_replication_role = 'origin';
`;

  // Write to migration_dump.sql
  const outputPath = path.join(__dirname, 'migration_dump.sql');
  fs.writeFileSync(outputPath, sql);
  console.log(`Successfully generated unified migration SQL file at: ${outputPath}`);
}

run().catch(err => {
  console.error('Fatal error running generator script:', err);
  process.exit(1);
});
