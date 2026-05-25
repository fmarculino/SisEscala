-- SisEscala Unified Migration Script
-- Target: self-hosted Supabase on VPS/Coolify
-- Created at: 2026-05-22T19:03:58.016Z

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

-- Inserting Auth Users
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
VALUES (
  '0def43bc-c1e1-4bd3-bba5-ca46b3219727',
  '00000000-0000-0000-0000-000000000000',
  'fernandomarculino@outlook.com',
  '$2a$10$N8JX7I6sgSui9cMXETOUQuYa8hMeEYE7aZhFk8UkkfHW8Qn0YD68.',
  '2026-05-09 01:06:32.99401+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Fernando Marculino Coordenador","email_verified":true}'::jsonb,
  '2026-05-09 01:06:32.967245+00',
  '2026-05-11 21:46:32.626735+00',
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
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
VALUES (
  '6dd36fc1-fa8e-48fc-8eff-726a50e05621',
  '00000000-0000-0000-0000-000000000000',
  'barbarasuellenlacem@gmail.com',
  '$2a$10$PxVvga/DYq6TLfMu1naMoO9jjH52Z/fYqNpVIKnSQMoXfFwaOoz22',
  '2026-05-09 13:31:28.014666+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Barbara Suellen de Jesus Sousa","email_verified":true}'::jsonb,
  '2026-05-09 13:31:27.97766+00',
  '2026-05-09 14:18:27.035535+00',
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
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
VALUES (
  '1146662d-416a-4e8d-a031-fee8fefe249a',
  '00000000-0000-0000-0000-000000000000',
  'fernandomarculino@proton.com',
  '$2a$10$zs5h2/4fvqPHCG.rln6MxeNTY5rQGojJXX8c3auZAqi8GQl7aXx/u',
  '2026-05-09 04:30:39.174684+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Fernando Administrador","email_verified":true}'::jsonb,
  '2026-05-09 04:30:39.154926+00',
  '2026-05-09 04:30:55.951503+00',
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
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
VALUES (
  '6979b6b5-df31-42e0-96a4-03dbac3e6bf6',
  '00000000-0000-0000-0000-000000000000',
  'divxall2003@gmail.com',
  '$2a$10$/wUymJvaVXzMm8KKhcvvJeaAZjjxTMPNFSHohDMn5.iJ2MfZ8vary',
  '2026-05-07 00:09:01.140569+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Flavio","email_verified":true}'::jsonb,
  '2026-05-07 00:09:01.11592+00',
  '2026-05-13 17:27:32.62791+00',
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
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
VALUES (
  '1c144bc0-8f01-464e-beec-3cc94fdb9150',
  '00000000-0000-0000-0000-000000000000',
  'fernandomarculino@gmail.com',
  '$2a$06$.OE/11xaVFePVeBJoA7g1OwlIwnfxcwm7PzfQNPP9GQyeRrXgDRC.',
  '2026-05-05 02:51:14.08969+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Fernando Marculino"}'::jsonb,
  '2026-05-05 02:51:14.08969+00',
  '2026-05-22 05:40:32.247303+00',
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
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
VALUES (
  'fed6fad8-33c9-4290-9e0e-be25a58d13b7',
  '00000000-0000-0000-0000-000000000000',
  'admin@admin.com',
  '$2a$10$VhaQoyseqFSKo5hJ6wpnxeeXdoyplgxltt1F9TGeTHOwrrEQs8MfK',
  '2026-05-15 04:01:38.888734+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"admin teste","email_verified":true}'::jsonb,
  '2026-05-15 04:01:38.815671+00',
  '2026-05-15 04:15:21.235337+00',
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
) ON CONFLICT (id) DO NOTHING;

-- Inserting Auth Identities
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  '35da9465-2fa7-47c1-a94a-333e26aa1afe',
  '6979b6b5-df31-42e0-96a4-03dbac3e6bf6',
  '6979b6b5-df31-42e0-96a4-03dbac3e6bf6',
  '{"sub":"6979b6b5-df31-42e0-96a4-03dbac3e6bf6","email":"divxall2003@gmail.com","email_verified":false,"phone_verified":false}'::jsonb,
  'email',
  '2026-05-07 00:09:01.132146+00',
  '2026-05-07 00:09:01.135657+00',
  '2026-05-07 00:09:01.135657+00'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  '9caccce8-5524-46e8-8b80-f000d3c609c0',
  '0def43bc-c1e1-4bd3-bba5-ca46b3219727',
  '0def43bc-c1e1-4bd3-bba5-ca46b3219727',
  '{"sub":"0def43bc-c1e1-4bd3-bba5-ca46b3219727","email":"fernandomarculino@outlook.com","email_verified":false,"phone_verified":false}'::jsonb,
  'email',
  '2026-05-09 01:06:32.98777+00',
  '2026-05-09 01:06:32.987832+00',
  '2026-05-09 01:06:32.987832+00'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  '9e7ccfa0-37d9-48a0-ac81-715659b01fcb',
  '1146662d-416a-4e8d-a031-fee8fefe249a',
  '1146662d-416a-4e8d-a031-fee8fefe249a',
  '{"sub":"1146662d-416a-4e8d-a031-fee8fefe249a","email":"fernandomarculino@proton.com","email_verified":false,"phone_verified":false}'::jsonb,
  'email',
  '2026-05-09 04:30:39.170014+00',
  '2026-05-09 04:30:39.170076+00',
  '2026-05-09 04:30:39.170076+00'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  '7774c7e3-b51c-405b-a46b-21d15a113318',
  '6dd36fc1-fa8e-48fc-8eff-726a50e05621',
  '6dd36fc1-fa8e-48fc-8eff-726a50e05621',
  '{"sub":"6dd36fc1-fa8e-48fc-8eff-726a50e05621","email":"barbarasuellenlacem@gmail.com","email_verified":false,"phone_verified":false}'::jsonb,
  'email',
  '2026-05-09 13:31:28.008671+00',
  '2026-05-09 13:31:28.008744+00',
  '2026-05-09 13:31:28.008744+00'
) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  'c583d20f-d02a-4e38-ab59-0c5b6f1d635e',
  'fed6fad8-33c9-4290-9e0e-be25a58d13b7',
  'fed6fad8-33c9-4290-9e0e-be25a58d13b7',
  '{"sub":"fed6fad8-33c9-4290-9e0e-be25a58d13b7","email":"admin@admin.com","email_verified":false,"phone_verified":false}'::jsonb,
  'email',
  '2026-05-15 04:01:38.882745+00',
  '2026-05-15 04:01:38.882816+00',
  '2026-05-15 04:01:38.882816+00'
) ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------
-- 6. Insert Public Tables Data
-- ----------------------------------------------------

-- Table: public.unidades (5 rows)
INSERT INTO public.unidades (id, nome, endereco, localizacao, created_at, updated_at, latitude, longitude, raio_geofence, ativo) VALUES ('f248c6d1-952b-42de-b53b-11738625deff', 'HMM - Hospital Municipal de Marabá', '', NULL, '2026-05-05T03:08:27.390582+00:00', '2026-05-06T22:43:16.568002+00:00', -5.340906, -49.087016, 100, true);
INSERT INTO public.unidades (id, nome, endereco, localizacao, created_at, updated_at, latitude, longitude, raio_geofence, ativo) VALUES ('c38a5df5-21fb-4d4e-8c97-e9770debe437', 'HMI - Hospital Materno Infantil', '', NULL, '2026-05-08T03:25:33.728723+00:00', '2026-05-08T03:25:55.441448+00:00', -5.348944, -49.133894, 100, true);
INSERT INTO public.unidades (id, nome, endereco, localizacao, created_at, updated_at, latitude, longitude, raio_geofence, ativo) VALUES ('a52ad302-acfc-470d-91f4-431155338b88', 'CCE - Centro de Cirurgias Eletivas HMM', '', NULL, '2026-05-08T03:27:44.776962+00:00', '2026-05-08T03:27:44.776962+00:00', -5.35271, -49.138219, 100, true);
INSERT INTO public.unidades (id, nome, endereco, localizacao, created_at, updated_at, latitude, longitude, raio_geofence, ativo) VALUES ('111628b6-28ab-4ce7-ae46-890f377ddcdd', 'LACEM - LABORATORIO CENTRAL DE MARABA', '', NULL, '2026-05-09T13:23:27.550047+00:00', '2026-05-09T13:23:27.550047+00:00', -5.376002, -49.131115, 100, true);
INSERT INTO public.unidades (id, nome, endereco, localizacao, created_at, updated_at, latitude, longitude, raio_geofence, ativo) VALUES ('9f5ba3d4-44db-452d-a0e5-614e86437807', 'SMS - Secretaria Municipal de Saúde', '', NULL, '2026-05-10T23:36:28.81865+00:00', '2026-05-11T15:27:09.040347+00:00', -5.3604, -49.122692, 100, true);

-- Table: public.dicionario_setores (18 rows)
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('1e1fd046-37fe-4984-92de-3a4e43fe001f', 'ALMOXARIFADO', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('28285c54-49dc-46ef-8392-28b312009463', 'ENFERMAGEM', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('22d20f47-9599-49e7-876e-7aff33ac420e', 'TRIAGEM', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('22d12004-0158-44ce-b616-3e3f27ae876e', 'LABORATÓRIOS', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('380c1c9a-76d8-4631-b56c-e055564b47bd', 'PRONTO SOCORRO', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('39a662d6-99fd-4ca7-b69f-d10fe81ad5e2', 'TB NH E LEISHIMANIOSE', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('4a26d399-9e04-45e0-bf58-72cc3014fdd6', 'CENTRO CIRÚRGICO', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('2c6fac80-d9e6-4a89-9da8-a0a3953d3060', 'ADMINISTRATIVO', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('97ab77ef-debb-49d4-8e96-4e06e451c174', 'PORTARIA', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('af5cc410-30a7-429c-8068-8f8ab3d13236', 'CORPO CLÍNICO', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('7791457e-cdc2-46fa-a4d2-38de17fa55ba', 'RECEPCAO', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('036eeac3-9bad-46ef-8ddd-87da078bc0c1', 'DAB', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('2e8107eb-f878-4656-ae58-c0926f9348cf', 'TECNOLOGIA DA INFORMAÇÃO', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('c40a79c0-ad59-459a-8825-2bef6f24923c', 'COLETA', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('7154f62d-2b9e-44ec-b8a3-f1d51639744b', 'INFRAESTRUTURA', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('bce4a87b-5fcd-4144-bc2d-b0d8b2cdb19a', 'MEDICOS ESPECIALISTAS', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('de1e5310-2478-450c-82c2-053a5ac644a0', 'DMAC', '2026-05-15T02:51:28.239912+00:00');
INSERT INTO public.dicionario_setores (id, nome, created_at) VALUES ('ee8bb441-ff16-4fe0-9a72-97c606df5906', 'UTI ADULTO', '2026-05-15T02:51:28.239912+00:00');

-- Table: public.setores (20 rows)
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('bb7a2dc6-093e-45e9-8864-52923cc9c816', '111628b6-28ab-4ce7-ae46-890f377ddcdd', NULL, '2026-05-09T13:27:31.754571+00:00', '2026-05-09T13:27:31.754571+00:00', true, '1e1fd046-37fe-4984-92de-3a4e43fe001f');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('6df23f34-a24a-44b5-8970-f7e8d16325ac', 'f248c6d1-952b-42de-b53b-11738625deff', NULL, '2026-05-05T03:45:54.288462+00:00', '2026-05-05T03:45:54.288462+00:00', true, '28285c54-49dc-46ef-8392-28b312009463');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('7c33139e-edcc-4d7b-a3de-9508b3ec13d2', '111628b6-28ab-4ce7-ae46-890f377ddcdd', NULL, '2026-05-09T13:27:07.067151+00:00', '2026-05-09T13:27:07.067151+00:00', true, '22d20f47-9599-49e7-876e-7aff33ac420e');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('043838f5-c955-470d-97de-ae576ea99685', '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf', '2026-05-10T23:42:23.824847+00:00', '2026-05-10T23:42:23.824847+00:00', false, '22d12004-0158-44ce-b616-3e3f27ae876e');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('1b60c4fd-2ace-4365-9541-e931458d145c', 'f248c6d1-952b-42de-b53b-11738625deff', '6df23f34-a24a-44b5-8970-f7e8d16325ac', '2026-05-05T03:45:54.288462+00:00', '2026-05-05T03:45:54.288462+00:00', true, '380c1c9a-76d8-4631-b56c-e055564b47bd');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('06ff6353-3ba9-4716-b036-f295c022ac8e', '111628b6-28ab-4ce7-ae46-890f377ddcdd', NULL, '2026-05-09T13:26:38.933519+00:00', '2026-05-09T13:26:38.933519+00:00', true, '39a662d6-99fd-4ca7-b69f-d10fe81ad5e2');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('344d753d-04cf-4a67-990e-0a313e369b73', 'f248c6d1-952b-42de-b53b-11738625deff', '6df23f34-a24a-44b5-8970-f7e8d16325ac', '2026-05-05T03:45:54.288462+00:00', '2026-05-05T03:45:54.288462+00:00', true, '4a26d399-9e04-45e0-bf58-72cc3014fdd6');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('5909e20f-d296-48bc-be1f-0d3ae981deb5', '111628b6-28ab-4ce7-ae46-890f377ddcdd', NULL, '2026-05-09T13:25:02.989055+00:00', '2026-05-09T13:25:02.989055+00:00', true, '97ab77ef-debb-49d4-8e96-4e06e451c174');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('2c0c4a16-46c8-4ead-b74a-6fae85e0f866', 'f248c6d1-952b-42de-b53b-11738625deff', NULL, '2026-05-05T03:45:54.288462+00:00', '2026-05-05T03:45:54.288462+00:00', true, 'af5cc410-30a7-429c-8068-8f8ab3d13236');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('b3dc243c-4040-4b2c-b312-2b6ad1808ef1', '111628b6-28ab-4ce7-ae46-890f377ddcdd', NULL, '2026-05-09T13:25:13.114899+00:00', '2026-05-09T13:25:13.114899+00:00', true, '7791457e-cdc2-46fa-a4d2-38de17fa55ba');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('5927c53e-5ff5-476d-8b9d-b5c1dda2d58b', '9f5ba3d4-44db-452d-a0e5-614e86437807', NULL, '2026-05-10T23:41:25.939188+00:00', '2026-05-10T23:41:25.939188+00:00', true, '036eeac3-9bad-46ef-8ddd-87da078bc0c1');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('49e9559a-3b87-4bc2-ad89-24ff5ea77cbf', 'f248c6d1-952b-42de-b53b-11738625deff', NULL, '2026-05-08T00:34:09.895598+00:00', '2026-05-08T00:34:09.895598+00:00', true, '2e8107eb-f878-4656-ae58-c0926f9348cf');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('03077176-aff4-46bd-8f0e-bb3660628f14', '111628b6-28ab-4ce7-ae46-890f377ddcdd', NULL, '2026-05-09T13:25:23.375189+00:00', '2026-05-09T13:25:23.375189+00:00', true, 'c40a79c0-ad59-459a-8825-2bef6f24923c');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('d8d78e2a-649b-446a-b19e-513437e16930', 'f248c6d1-952b-42de-b53b-11738625deff', NULL, '2026-05-05T03:45:54.288462+00:00', '2026-05-05T03:45:54.288462+00:00', true, '7154f62d-2b9e-44ec-b8a3-f1d51639744b');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('4c8d78cd-d41b-441f-8edd-55b999d5438b', 'f248c6d1-952b-42de-b53b-11738625deff', NULL, '2026-05-07T01:59:33.048214+00:00', '2026-05-07T01:59:33.048214+00:00', true, 'bce4a87b-5fcd-4144-bc2d-b0d8b2cdb19a');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf', '9f5ba3d4-44db-452d-a0e5-614e86437807', NULL, '2026-05-10T23:41:16.593588+00:00', '2026-05-10T23:41:16.593588+00:00', true, 'de1e5310-2478-450c-82c2-053a5ac644a0');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('cdaf165f-9c6a-48b3-8753-f70b5950d0aa', 'f248c6d1-952b-42de-b53b-11738625deff', '6df23f34-a24a-44b5-8970-f7e8d16325ac', '2026-05-05T03:45:54.288462+00:00', '2026-05-05T03:45:54.288462+00:00', true, 'ee8bb441-ff16-4fe0-9a72-97c606df5906');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('0e15994b-997a-4d85-b09b-c224edf4049b', '111628b6-28ab-4ce7-ae46-890f377ddcdd', NULL, '2026-05-09T13:24:49.242643+00:00', '2026-05-09T13:24:49.242643+00:00', true, '2c6fac80-d9e6-4a89-9da8-a0a3953d3060');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('6d2b39fb-c7e6-4fd0-b28f-54e7fd6d1f76', '9f5ba3d4-44db-452d-a0e5-614e86437807', NULL, '2026-05-10T23:55:35.975164+00:00', '2026-05-10T23:55:35.975164+00:00', true, '2c6fac80-d9e6-4a89-9da8-a0a3953d3060');
INSERT INTO public.setores (id, unidade_id, parent_id, created_at, updated_at, ativo, dicionario_setor_id) VALUES ('33fb858f-8ec3-4384-981a-d809be75391e', 'f248c6d1-952b-42de-b53b-11738625deff', NULL, '2026-05-05T03:45:54.288462+00:00', '2026-05-05T03:45:54.288462+00:00', true, '2c6fac80-d9e6-4a89-9da8-a0a3953d3060');

-- Table: public.dicionario_turnos (54 rows)
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('eccaa06f-8d04-4b62-ba87-d6621221415e', 'I', 'INTERMEDIÁRIO: 4HRS', 4, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY[]::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('7fd3137a-64f8-4e42-b63e-52d393670dce', 'M1', 'MANHÃ: 1HRS', 1, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('2f4c0c21-f7c4-44ad-9c9c-63c5f409e92c', 'M2', 'MANHÃ: 2HRS', 2, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('551ad4b9-2533-426c-9e31-962800f71387', 'M3', 'MANHÃ: 3HRS', 3, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('40041d8b-7282-41b1-b309-8a9697fdb87e', 'M4', 'MANHÃ: 4HRS', 4, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('f4acd060-37e7-4dd5-9465-948d5d0631aa', 'M5', 'MANHÃ: 5HRS', 5, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('0f7d5836-f3e1-472e-90c4-ef69e7bd6ab1', 'M', 'MANHÃ: 6HRS', 6, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('c67ce9aa-788b-40fa-8b5c-52fa4cac6c8e', 'M7', 'MANHÃ: 7HRS', 7, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('7ff87287-d57b-4144-a42c-6ad3c28b1d3a', 'M8', 'MANHÃ: 8HRS', 8, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('f17e34c1-1a75-4d61-9f58-e0e530a40e0a', 'T1', 'TARDE: 1HRS', 1, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('87115391-d0a4-4e3e-9dd4-dd3dd9ccd9b1', 'T2', 'TARDE: 2HRS', 2, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('c5516972-9dd3-4597-88e4-ab4c90171861', 'MT3', 'MANHÃ: 6HRS, TARDE: 3HRS', 9, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('1e260da6-eb8d-408b-bad6-2e9319905160', 'MT4', 'MANHÃ: 6HRS, TARDE: 4HRS', 10, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('f267c49b-9914-4b0c-bf9e-1682d1b0de55', 'M4I', 'MANHÃ: 4HRS, INTERMEDIÁRIO: 4HRS', 8, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('12072242-5a44-4b77-80d0-8f077cc483d7', 'MT5', 'MANHÃ: 6HRS, TARDE: 5HRS', 11, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('560de34c-23cb-42a2-a792-1e007838b600', 'MT7', 'MANHÃ: 6HRS, TARDE: 7HRS', 13, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('b9dfd889-18bb-4d78-8cbd-2318fbbb8725', 'MT8', 'MANHÃ: 6HRS, TARDE: 8HRS', 14, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('1ce3707b-4ca3-4cac-8768-002c5fb3ef67', 'T3', 'TARDE: 3HRS', 3, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('df5548f5-3ca9-4e66-a068-8e9f9a618517', 'T4', 'TARDE: 4HRS', 4, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('5089b39d-40bf-4ebe-8c6d-dd130d3e6ce3', 'T5', 'TARDE: 5HRS', 5, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('881142dc-415f-468f-958d-657d0cdf8b6b', 'T', 'TARDE: 6HRS', 6, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('0b51e54d-7c4d-4507-95bd-6d3089f90b15', 'T7', 'TARDE: 7HRS', 7, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('2deb931e-675b-4b83-97ad-311ea60f2eb4', 'T8', 'TARDE: 8HRS', 8, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('0c84bba1-8226-4c51-9865-59611ecd98f6', 'IT4', 'INTERMEDIÁRIO: 4HRS, TARDE: 4HRS', 8, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('b13d9cfc-46b5-4cff-a60e-c10cf5f7cb39', 'N1', 'NOITE: 1HRS', 1, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('91627190-db88-4d6e-879d-750aac290b44', 'N2', 'NOITE: 2HRS', 2, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('6efc6ba5-5f22-402d-91d5-ffc12c7d9bfb', 'N3', 'NOITE: 3HRS', 3, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('07cdae57-4a99-42f4-94b9-7c2f727984a5', 'N4', 'NOITE: 4HRS', 4, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('f86612f8-5b9c-4793-891e-99ffe3f5bc72', 'N5', 'NOITE: 5HRS', 5, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('21398920-81db-4aaf-9580-d1da339361ab', 'N6', 'NOITE: 6HRS', 6, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('2471cc9a-d79a-4b85-95e2-17513d985ec7', 'N7', 'NOITE: 7HRS', 7, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('2fcd39f7-1894-4b7b-b39b-17c043f47df6', 'N8', 'NOITE: 8HRS', 8, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('b25ad3e4-2530-4341-b881-61580ef472b6', 'N9', 'NOITE: 9HRS', 9, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('56750133-dfc7-4814-89f2-27578813cdae', 'N10', 'NOITE: 10HRS', 10, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('823b9822-11b1-4527-8a22-82761bcde27a', 'N11', 'NOITE: 11HRS', 11, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('d52d0184-9f34-4049-9ad0-ffe17c2e268a', 'M2N', 'MANHÃ: 2HRS, NOITE: 12HRS', 14, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('9ade1c43-a837-481a-90ef-477ab0369e18', 'M3N', 'MANHÃ: 3HRS, NOITE: 12HRS', 15, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('58888054-f2d5-4721-842c-ea2e61d0af30', 'M4N', 'MANHÃ: 4HRS, NOITE: 12HRS', 16, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('35e6dd2f-c42a-4b6a-8be0-ad601d38fe2d', 'M5N', 'MANHÃ: 5HRS, NOITE: 12HRS', 17, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('fe64e439-b913-44e9-bbd9-17cfbd6de1f9', 'MN', 'MANHÃ: 6HRS, NOITE: 12HRS', 18, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('55b8adf1-6cc8-4037-88b6-2b9a83a1f827', 'M7N', 'MANHÃ: 7HRS, NOITE: 12HRS', 19, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('22f49ced-3ca7-45e2-9403-e807ce3a4869', 'M8N', 'MANHÃ: 8HRS, NOITE: 12HRS', 20, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('f4cd224e-19d1-4a07-a9e4-697f7ca5789d', 'N', 'NOITE: 12HRS', 12, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('b01b85b4-ff1c-4859-bd0e-61846b70c908', 'MT4N', 'MANHÃ: 6HRS, TARDE: 4HRS, NOITE: 12HRS', 22, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T', 'M']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('bdbe4aa5-9c00-435c-bb35-0ad8ab2647d1', 'T2N', 'TARDE: 2HRS, NOITE: 12HRS', 14, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('dba0be4b-5fbf-48ed-993e-1c44cd6e3ff4', 'T3N', 'TARDE: 3HRS, NOITE: 12HRS', 15, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('25ddda98-7b50-4015-a55a-4913441f32b7', 'T4N', 'TARDE: 4HRS, NOITE: 12HRS', 16, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('913df969-5e69-4709-8d37-120ddbb9bd4d', 'T5N', 'TARDE: 5HRS, NOITE: 12HRS', 17, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('6b5df776-26dd-4e61-a4f5-7709d2153644', 'TN', 'TARDE: 6HRS, NOITE: 12HRS', 18, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('f02d5672-1e48-439f-ae35-6d9c42164598', 'T7N', 'TARDE: 7HRS, NOITE: 12HRS', 19, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('f82eb6f0-43e9-4333-af89-6b50508e5bc7', 'T8N', 'TARDE: 8HRS, NOITE: 12HRS', 20, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['N', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('fa5e16e2-dd42-47f0-9dec-e5fcbf5f246f', 'S12', 'SOBREAVISO 12HRS', 12, 'Sobreaviso', '2026-05-05T03:13:49.874207+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['S']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('864644f9-504f-40a5-91be-c608939fc434', 'MT', 'MANHÃ: 6HRS, TARDE: 6HRS', 12, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M', 'T']::text[]);
INSERT INTO public.dicionario_turnos (id, codigo, descricao, horas_computadas, tipo, created_at, updated_at, ativo, slots) VALUES ('1c9a00b2-081a-4d06-b191-a6245c8cce78', 'MTN', 'MANHÃ: 6HRS, TARDE: 6HRS, NOITE: 12HRS', 24, 'Plantão', '2026-05-05T03:13:41.263402+00:00', '2026-05-09T15:33:21.116556+00:00', true, ARRAY['M', 'T', 'N']::text[]);

-- Table: public.cargos (16 rows)
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('019e0a3d-c740-4c0d-ad13-c749e1fb351b', 'Médico(a)', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('79d3aa6c-10ee-431d-a2a2-4d339ea3b90d', 'Enfermeiro(a)', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('dec906ab-91e7-48f4-98ec-70dd8a85dabf', 'Técnico(a) em Enfermagem', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('9fcdccc9-2151-485f-98c7-e5b47771805b', 'Fisioterapeuta', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('26465610-806b-4f07-bab9-00221b47045f', 'Psicólogo(a)', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('7cfdbd16-63a0-43e1-9062-ddbfccdfa25c', 'Assistente Social', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('ce57ae16-a7bd-4165-a244-eeba6de83e9d', 'Auxiliar Administrativo', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('17a4d08e-7885-43d4-a8cc-541bc4d84d32', 'Motorista', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('69283977-fc5b-44e9-adda-33f1ef1597bb', 'Cirurgião', '2026-05-07T02:19:16.789227+00:00', '2026-05-07T02:19:16.789227+00:00', '019e0a3d-c740-4c0d-ad13-c749e1fb351b', 2, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('be8da6a2-ca40-42f1-ade8-06c3ac690051', 'Bucomaxilo', '2026-05-07T02:19:33.255555+00:00', '2026-05-07T02:19:33.255555+00:00', '69283977-fc5b-44e9-adda-33f1ef1597bb', 3, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('9c3b9d80-ff83-4f2c-b845-b864b389895d', 'Técnico de Informática', '2026-05-08T00:35:27.742574+00:00', '2026-05-08T00:35:27.742574+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('4a510c48-204f-4144-b324-63085905c34f', 'Técnico em Laboratório', '2026-05-09T13:28:27.98216+00:00', '2026-05-09T13:28:27.98216+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('86dcf879-4e2b-490b-a3e5-e49ef4bebe94', 'Biomédico', '2026-05-09T13:28:35.940766+00:00', '2026-05-09T13:28:35.940766+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('12dcc13b-15c5-4f51-8f98-aac38b1e3cf0', 'Bioquimico', '2026-05-09T13:28:42.141981+00:00', '2026-05-09T13:28:42.141981+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('212e24ab-15e7-43ec-bd4b-abff0498da27', 'Agente de Portaria', '2026-05-09T13:29:08.117547+00:00', '2026-05-09T13:29:08.117547+00:00', NULL, 1, true);
INSERT INTO public.cargos (id, nome, created_at, updated_at, parent_id, nivel, ativo) VALUES ('742a6502-8239-4378-9cdb-88432ac066db', 'ASG Auxiliar de Serviços Gerais', '2026-05-07T02:03:46.274512+00:00', '2026-05-07T02:03:46.274512+00:00', NULL, 1, true);

-- Table: public.jornadas (12 rows)
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('ab01c055-89fd-4132-8b72-ce8884b23a75', '07H ÀS 13H', true, '2026-05-09T13:56:56.817488+00:00', '2026-05-09T13:56:56.817488+00:00', 0, 6);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('64af6d30-dec8-436a-a522-b0eb13147eac', '07H ÀS 16H', true, '2026-05-09T13:54:06.375135+00:00', '2026-05-09T13:54:06.375135+00:00', 60, 9);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('affd21be-478d-4fc1-9616-a98ec5425eec', '07H ÀS 17H', true, '2026-05-09T13:55:16.769944+00:00', '2026-05-09T13:55:16.769944+00:00', 120, 10);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('b28bcf19-3350-4da8-bb2d-fa17e99bf8e7', '07H ÀS 19H', true, '2026-05-08T03:09:55.014888+00:00', '2026-05-08T03:09:55.014888+00:00', 0, 12);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('25bed180-63db-4403-be3d-5a83957bae12', '08H ÀS 12H', true, '2026-05-09T13:57:50.736309+00:00', '2026-05-09T13:57:50.736309+00:00', 0, 4);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('f54a0c53-bed9-4d51-87e2-f070b5f10ef5', '08H ÀS 14H', true, '2026-05-09T13:59:03.863275+00:00', '2026-05-09T13:59:03.863275+00:00', 0, 6);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('b3b2cb0f-9bdd-4971-ab5c-5c8162fde7be', '08H ÀS 18H', true, '2026-05-08T03:15:31.919075+00:00', '2026-05-08T03:15:31.919075+00:00', 120, 10);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('24887db7-a12f-4d08-9228-0f0d8ffc3ea9', '13H ÀS 17H', true, '2026-05-09T13:58:12.783819+00:00', '2026-05-09T13:58:12.783819+00:00', 0, 4);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('6a6c080e-e01c-4784-85ed-aaafbd9da524', '13H ÀS 19H', true, '2026-05-09T13:57:31.409636+00:00', '2026-05-09T13:57:31.409636+00:00', 0, 6);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('fd9ca4c6-6736-4dd6-9b14-f17e61f3c260', '14H ÀS 18H', true, '2026-05-09T13:58:42.35571+00:00', '2026-05-09T13:58:42.35571+00:00', 0, 4);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('b0dc5af0-2438-4962-b527-6ec680f52155', '18H ÀS 06H', true, '2026-05-09T13:56:02.255553+00:00', '2026-05-09T13:56:02.255553+00:00', 0, 12);
INSERT INTO public.jornadas (id, nome, ativo, created_at, updated_at, intervalo_minutos, horas_totais) VALUES ('e0d6b4ee-be3c-410d-b6f4-441ec5a585cd', '19H ÀS 07H', true, '2026-05-08T03:15:48.663111+00:00', '2026-05-08T03:15:48.663111+00:00', 0, 12);

-- Table: public.servidores (1 rows)
INSERT INTO public.servidores (id, nome, matricula, cargo, vinculo, unidade_id, created_at, updated_at, setor_id, status, motivo_inativacao, email, telefone, pin_acesso, pin_failed_attempts, last_pin_attempt) VALUES ('0e6b03ca-2c54-47f6-af2e-977d2787580d', 'FERNANDO MARCULINO GUIMARAES JUNIOR', '68008', 'Auxiliar Administrativo', 'Comissionada', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T00:00:13.936854+00:00', '2026-05-18T12:57:56.445197+00:00', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf', 'Ativo', NULL, 'fernandomarculino@gmail.com', '(81) 98103-4808', '5541', 0, '2026-05-18T12:57:56.131+00:00');

-- Table: public.profiles (6 rows)
INSERT INTO public.profiles (id, full_name, role, unidade_id, created_at, updated_at, setor_id, acesso_todas_unidades, acesso_todos_setores, ativo) VALUES ('1c144bc0-8f01-464e-beec-3cc94fdb9150', 'Fernando Marculino', 'super_admin', NULL, '2026-05-05T02:51:14.08969+00:00', '2026-05-09T03:17:31.233705+00:00', NULL, true, true, true);
INSERT INTO public.profiles (id, full_name, role, unidade_id, created_at, updated_at, setor_id, acesso_todas_unidades, acesso_todos_setores, ativo) VALUES ('6979b6b5-df31-42e0-96a4-03dbac3e6bf6', 'Flavio', 'super_admin', NULL, '2026-05-07T00:09:01.115567+00:00', '2026-05-09T03:17:31.233705+00:00', NULL, true, true, true);
INSERT INTO public.profiles (id, full_name, role, unidade_id, created_at, updated_at, setor_id, acesso_todas_unidades, acesso_todos_setores, ativo) VALUES ('0def43bc-c1e1-4bd3-bba5-ca46b3219727', 'Fernando Marculino Coordenador', 'coordenador', 'f248c6d1-952b-42de-b53b-11738625deff', '2026-05-09T01:06:32.966856+00:00', '2026-05-09T03:52:11.269104+00:00', NULL, false, false, true);
INSERT INTO public.profiles (id, full_name, role, unidade_id, created_at, updated_at, setor_id, acesso_todas_unidades, acesso_todos_setores, ativo) VALUES ('1146662d-416a-4e8d-a031-fee8fefe249a', 'Fernando Administrador', 'admin', NULL, '2026-05-09T04:30:39.153403+00:00', '2026-05-09T04:30:39.276624+00:00', NULL, false, true, true);
INSERT INTO public.profiles (id, full_name, role, unidade_id, created_at, updated_at, setor_id, acesso_todas_unidades, acesso_todos_setores, ativo) VALUES ('6dd36fc1-fa8e-48fc-8eff-726a50e05621', 'Barbara Suellen de Jesus Sousa', 'admin', NULL, '2026-05-09T13:31:27.974714+00:00', '2026-05-09T13:31:28.394391+00:00', NULL, false, true, true);
INSERT INTO public.profiles (id, full_name, role, unidade_id, created_at, updated_at, setor_id, acesso_todas_unidades, acesso_todos_setores, ativo) VALUES ('fed6fad8-33c9-4290-9e0e-be25a58d13b7', 'admin teste', 'super_admin', NULL, '2026-05-15T04:01:38.809497+00:00', '2026-05-15T04:15:21.664865+00:00', NULL, true, true, true);

-- Table: public.profile_unidades (3 rows)
INSERT INTO public.profile_unidades (profile_id, unidade_id) VALUES ('0def43bc-c1e1-4bd3-bba5-ca46b3219727', 'f248c6d1-952b-42de-b53b-11738625deff');
INSERT INTO public.profile_unidades (profile_id, unidade_id) VALUES ('1146662d-416a-4e8d-a031-fee8fefe249a', 'f248c6d1-952b-42de-b53b-11738625deff');
INSERT INTO public.profile_unidades (profile_id, unidade_id) VALUES ('6dd36fc1-fa8e-48fc-8eff-726a50e05621', '111628b6-28ab-4ce7-ae46-890f377ddcdd');

-- Table: public.profile_setores (1 rows)
INSERT INTO public.profile_setores (profile_id, setor_id) VALUES ('0def43bc-c1e1-4bd3-bba5-ca46b3219727', '49e9559a-3b87-4bc2-ad89-24ff5ea77cbf');

-- Table: public.configuracoes_globais (10 rows)
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('d46554c3-d9eb-4245-9355-f5e7137dc745', 'sobreaviso_desconsiderar_falha', 'true'::jsonb, NULL, '2026-05-07T14:43:10.304909+00:00', '2026-05-07T14:43:10.304909+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('55fc75d5-0641-416e-80b7-d8ed1895fd37', 'sobreaviso_permitir_validacao_manual', 'true'::jsonb, NULL, '2026-05-07T14:43:10.304909+00:00', '2026-05-07T14:43:10.304909+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('e3828c08-1bfe-48f2-b9b2-b6ef98051640', 'sobreaviso_exigir_localizacao', '"true"'::jsonb, NULL, '2026-05-07T14:43:10.304909+00:00', '2026-05-08T00:07:54.736+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('f79052f2-322b-429a-bd48-0d6189ce8367', 'sobreaviso_tempo_chegada_minutos', '"60"'::jsonb, NULL, '2026-05-07T14:43:10.304909+00:00', '2026-05-09T13:31:51.712+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('68565d4f-5e29-48e1-bfc9-59c0d9fbc9fe', 'sobreaviso_tempo_aceite_minutos', '"30"'::jsonb, NULL, '2026-05-07T14:43:10.304909+00:00', '2026-05-09T13:31:54.632+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('87e05e03-5bbf-41cb-aad0-c1bb8ae86b77', 'dias_inativacao_automatica', '5'::jsonb, 'Número de dias após o fim do mês para inativar escalas automaticamente', '2026-05-07T03:44:33.70808+00:00', '2026-05-09T13:31:54.752+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('b13ebcf7-d249-4b39-85df-cfcff9ae0cd5', 'dia_limite_planejamento', '"20"'::jsonb, 'Dia do mês após o qual a escala do mês corrente é bloqueada para coordenadores.', '2026-05-10T15:14:14.109472+00:00', '2026-05-10T15:16:45.323+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('e42dc3bc-52fd-4530-a46f-6ed869024e2b', 'timezone', '"America/Sao_Paulo"'::jsonb, 'Fuso horário padrão do sistema (Ex: America/Sao_Paulo, America/Manaus, UTC)', '2026-05-10T21:08:14.607183+00:00', '2026-05-10T21:08:14.607183+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('64d0f7bc-6639-4df1-af29-2319f450478e', 'janela_presenca_minutos', '"60"'::jsonb, 'Janela de tolerância em minutos para registro de entrada e saída (antes e depois do horário previsto)', '2026-05-10T15:57:36.537139+00:00', '2026-05-10T21:13:21.99+00:00');
INSERT INTO public.configuracoes_globais (id, chave, valor, descricao, created_at, updated_at) VALUES ('207479c7-1864-4b9a-98ae-fc580afcacef', 'exigir_confirmacao_presenca', '"true"'::jsonb, 'Se ativo, o sistema desconsidera as horas de plantões não confirmados nos relatórios e totais.', '2026-05-10T15:34:20.124665+00:00', '2026-05-10T21:59:56.476+00:00');

-- Table: public.feriados (1 rows)
INSERT INTO public.feriados (id, data, descricao, created_at, updated_at) VALUES ('f64b9efb-7678-4f1b-9644-e0f914e9cfba', '2026-05-01', 'Dia do Trabalhador', '2026-05-07T02:48:45.144098+00:00', '2026-05-07T02:48:45.144098+00:00');

-- Table: public.escala_mensal (2 rows)
INSERT INTO public.escala_mensal (id, mes, ano, servidor_id, unidade_id, status, created_at, updated_at, setor_id, ativo, inativada_em, jornada_id) VALUES ('50e18851-35ed-4092-8f74-732aa2fad99b', 5, 2026, '0e6b03ca-2c54-47f6-af2e-977d2787580d', 'f248c6d1-952b-42de-b53b-11738625deff', 'Rascunho', '2026-05-11T15:20:41.284121+00:00', '2026-05-14T22:35:28.503335+00:00', '49e9559a-3b87-4bc2-ad89-24ff5ea77cbf', true, NULL, 'b28bcf19-3350-4da8-bb2d-fa17e99bf8e7');
INSERT INTO public.escala_mensal (id, mes, ano, servidor_id, unidade_id, status, created_at, updated_at, setor_id, ativo, inativada_em, jornada_id) VALUES ('6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 5, 2026, '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', 'Rascunho', '2026-05-11T01:55:10.955161+00:00', '2026-05-22T05:40:50.917153+00:00', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf', true, NULL, 'b3b2cb0f-9bdd-4971-ab5c-5c8162fde7be');

-- Table: public.escala_diaria (30 rows)
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('befb6c0f-2c18-4544-9cb7-09bae0cd0c07', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 4, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T03:19:48.964411+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:03:54.449062+00:00', '2026-05-11T03:22:08.96554+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('673f8463-8ce8-4386-a526-f62f4caf501c', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 6, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T03:19:48.964411+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:31.773568+00:00', '2026-05-11T03:22:35.408277+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('60151f92-f210-4464-8432-6ab1727bed17', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 7, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T03:26:03.162531+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:26:14.115386+00:00', '2026-05-11T03:26:19.742614+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('fd66be79-61f8-4d72-8d41-d1df880f5f59', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 11, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T03:19:48.964411+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '0def43bc-c1e1-4bd3-bba5-ca46b3219727', '2026-05-11T21:44:44.757949+00:00', '2026-05-11T21:47:01.467935+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('1fd35829-1ad6-47a3-a239-a8142015cbf7', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 12, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T04:42:00.773586+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T22:44:09.684864+00:00', '2026-05-13T22:44:14.880646+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('a6bf8bc4-d33e-4b42-a891-c38cd8e49398', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 13, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T04:42:36.756985+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T22:44:23.453027+00:00', '2026-05-13T22:44:31.763092+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('f116a180-4690-4030-af07-ab9f2ec4a374', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 4, '91627190-db88-4d6e-879d-750aac290b44', '2026-05-11T03:19:48.964411+00:00', '2026-05-22T05:40:51.164917+00:00', 'Extra', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:14.922803+00:00', '2026-05-11T03:22:18.774466+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('5aced393-f13b-499b-8115-3eb0f04d1500', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 6, 'b13d9cfc-46b5-4cff-a60e-c10cf5f7cb39', '2026-05-11T03:29:35.193188+00:00', '2026-05-22T05:40:51.164917+00:00', 'Extra', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:29:43.96444+00:00', '2026-05-11T03:29:51.604295+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('9110b2e9-6a01-46a4-b7ef-b5f9b307c833', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 5, 'f4cd224e-19d1-4a07-a9e4-697f7ca5789d', '2026-05-11T03:19:48.964411+00:00', '2026-05-22T05:40:51.164917+00:00', 'Plantão', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:22.313055+00:00', '2026-05-11T03:26:32.331052+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('e7e1ec58-36d8-43ff-a772-ceb7d5e7c8f7', '50e18851-35ed-4092-8f74-732aa2fad99b', 7, 'f4cd224e-19d1-4a07-a9e4-697f7ca5789d', '2026-05-14T22:34:43.889479+00:00', '2026-05-14T22:35:28.717089+00:00', 'Plantão', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('a6152822-722c-444a-8fcd-b243041e1707', '50e18851-35ed-4092-8f74-732aa2fad99b', 14, 'f4cd224e-19d1-4a07-a9e4-697f7ca5789d', '2026-05-14T22:35:28.906388+00:00', '2026-05-14T22:35:28.906388+00:00', 'Sobreaviso', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('11166294-ca11-4e36-b163-2ef70b2b3a40', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 14, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-14T22:32:31.336248+00:00', '2026-05-15T03:35:27.37509+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('b8a8c2cd-0a15-47ec-bb6a-8e43bc809a93', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 15, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-22T05:40:48.655977+00:00', NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('8002b159-b79a-4a9e-9dca-d01ecc51b8b1', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 18, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-18T13:01:18.030803+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-18T13:03:08.57835+00:00', NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('0ffbdc1d-aeb3-410e-9444-b595d92ec651', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 19, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('3f0b90c4-41d5-402f-9638-d1919706e0d6', '50e18851-35ed-4092-8f74-732aa2fad99b', 5, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:22:56.607422+00:00', '2026-05-14T22:35:28.717089+00:00', 'Plantão', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-12T00:13:04.973918+00:00', '2026-05-12T00:13:08.787937+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('7ea39931-d5a9-4565-b6ef-9f5133e8ba39', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 20, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('a37934a0-090d-4a51-a3c3-ffdfae217633', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 21, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('3f8ec272-439a-4485-88ee-888d927afc76', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 22, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('fb65e600-4817-4bad-b7c3-e1f961aa699e', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 23, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-13T23:03:44.248459+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('217d0f88-3163-42f0-9acc-c38b179a9752', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 25, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('47ab21b8-3a27-42fc-8eac-a14104246f86', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 26, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('d0accac7-1ee5-4132-9afb-fafb19c668f6', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 27, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('9c16f324-79d8-412c-a43d-f8c58eed0ea1', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 28, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('3b1dac61-a579-4af2-b9ef-87ba6e16e794', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 29, '864644f9-504f-40a5-91be-c608939fc434', '2026-05-11T15:19:27.700893+00:00', '2026-05-22T05:40:51.164917+00:00', 'Regular', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('77119378-7456-4c55-b4e9-b667e0e4091f', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 8, '0f7d5836-f3e1-472e-90c4-ef69e7bd6ab1', '2026-05-11T03:30:10.348871+00:00', '2026-05-22T05:40:51.164917+00:00', 'Plantão', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:55:24.454308+00:00', '2026-05-11T04:15:02.199368+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('5f3ad726-2b7e-46ef-afc7-9f875b03a6b8', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 9, 'df5548f5-3ca9-4e66-a068-8e9f9a618517', '2026-05-11T03:31:10.459531+00:00', '2026-05-22T05:40:51.164917+00:00', 'Plantão', true, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:31:17.465207+00:00', '2026-05-11T04:11:21.79128+00:00');
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('142e730e-7195-42ba-9cd2-311968e2acd3', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 16, '0f7d5836-f3e1-472e-90c4-ef69e7bd6ab1', '2026-05-13T23:31:46.335494+00:00', '2026-05-22T05:40:51.164917+00:00', 'Plantão', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('b79ae012-8db4-4d80-ad01-9aa83ce2f5dc', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 10, '1c9a00b2-081a-4d06-b191-a6245c8cce78', '2026-05-11T03:19:48.964411+00:00', '2026-05-22T05:40:51.164917+00:00', 'Sobreaviso', false, NULL, NULL, NULL, NULL);
INSERT INTO public.escala_diaria (id, escala_mensal_id, dia, dicionario_turnos_id, created_at, updated_at, categoria, presenca_confirmada, presenca_confirmada_em, confirmado_por_id, presenca_entrada_em, presenca_saida_em) VALUES ('b1ea4caa-54b3-467d-bbc2-7e8e79e0dff0', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 11, 'f4cd224e-19d1-4a07-a9e4-697f7ca5789d', '2026-05-11T04:47:37.570772+00:00', '2026-05-22T05:40:51.164917+00:00', 'Sobreaviso', false, NULL, NULL, NULL, NULL);

-- Table: public.logs_sobreaviso (54 rows)
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('f20da85f-377a-4a06-9bc2-aa87bab01ac1', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T02:00:24.92528+00:00', 'Chegou', '4b0d6ba0-a4d4-4e95-89fb-6296fd96ceac', '2026-05-11T02:01:42.586+00:00', '177.55.72.54'::inet, 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36', -5.3767732, -49.1306326, NULL, '2026-05-11T02:03:40.531+00:00', 'GPS', '2026-05-11T02:00:24.92528+00:00', -5.3767755, -49.1306799, 'teste', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 10, false, NULL, '177.55.72.54', NULL, NULL, 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('c6f5a36e-f98a-4e1b-8ea1-af5172cf935d', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T02:54:48.552714+00:00', 'Chegou', '4090bbcb-6fc8-408e-9c27-3a2096225340', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T02:54:48.552714+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T02:54:48.552714+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('20b05779-a266-4a81-922c-5442bbcf6601', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T02:41:18.170892+00:00', 'Chegou', '6f82eac9-4d93-4b55-838c-8aa362a95457', '2026-05-11T02:45:58.006+00:00', '177.55.72.54'::inet, 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36', -5.3767855, -49.130636, NULL, '2026-05-11T02:52:06.896+00:00', 'GPS', '2026-05-11T02:41:18.170892+00:00', -5.3767269, -49.1306798, 'teste', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 10, false, NULL, '177.55.72.54', NULL, NULL, 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('d6365a4e-8f4e-4698-8e86-b3f2402c91e3', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T02:54:52.909499+00:00', 'Chegou', '5cdb55bc-f9c2-40c8-9116-301b017628d7', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T02:54:52.909499+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T02:54:52.909499+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('541a67c2-0406-4ec7-a885-30174bedfa2a', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:13:17.93697+00:00', 'Chegou', 'ca6290a4-6565-49f6-89ed-cec85455a654', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:13:17.93697+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:13:17.93697+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('cf1a7b73-8a42-4861-8977-ae8f3a4fde0c', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:13:22.206366+00:00', 'Chegou', 'a51d5cb9-de0f-478a-8a79-6696aef19bbb', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:13:22.206366+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:13:22.206366+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('a5e4de1c-6656-4b19-8f04-24898074a59d', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:16:39.061732+00:00', 'Chegou', 'b3fa3066-01f5-4f1e-b674-38e09516d2e8', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:16:39.061732+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 6, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:16:39.061732+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('1cf1397d-4b00-4426-aac6-82dbb3c7ae56', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:22:05.609149+00:00', 'Chegou', 'bbbaa2e7-ac13-4251-9c90-0eb4c0d61959', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:22:05.609149+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:05.609149+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('b0a723f5-7d5b-4d42-9f91-5db7f09368b8', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:22:08.96554+00:00', 'Chegou', 'f394b0cf-f1c6-4452-bacb-da50901081a9', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:22:08.96554+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:08.96554+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('38f3071d-0283-4ab5-81b3-4d3c2673388f', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:22:31.773568+00:00', 'Chegou', 'de6d12eb-2aa0-49cd-b682-27924dcf79ee', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:22:31.773568+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 6, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:31.773568+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('aaa21bad-2a2a-4505-a1bd-396cc44d8b93', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:22:35.408277+00:00', 'Chegou', '84a47693-817e-459d-a3f6-e392cc3e09b2', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:22:35.408277+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 6, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:35.408277+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('005bf559-9a2b-4dba-81bd-5bab35b96f3c', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:26:14.115386+00:00', 'Chegou', 'cafa9a3f-840b-4395-b8b0-1ac2bc83dbd5', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:26:14.115386+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 7, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:26:14.115386+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('bbac8a80-7405-4c1a-9f2c-d8ed4cb460a6', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:26:19.742614+00:00', 'Chegou', '4ff516f6-61c1-4222-a6e3-a6648f0efba9', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:26:19.742614+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 7, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:26:19.742614+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('69578ca8-4b89-4b95-b8ef-681750bbf7b3', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:29:43.96444+00:00', 'Chegou', '2627e0ef-6d63-413c-9084-158e176d8456', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:29:43.96444+00:00', NULL, NULL, 'Validação Manual (Extra - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 6, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:29:43.96444+00:00', 'Extra');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('d643c215-369e-469d-a01e-bd9c51ad7b41', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:29:51.604295+00:00', 'Chegou', '13b6e979-450f-41bd-91a6-9d9ed6d6988f', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:29:51.604295+00:00', NULL, NULL, 'Validação Manual (Extra - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 6, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:29:51.604295+00:00', 'Extra');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('30926ba7-349d-4c03-a174-069b2bbcc5a5', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:31:24.214732+00:00', 'Chegou', 'b934e4ac-d626-4435-988d-eb340e57e964', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:31:24.214732+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 9, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:31:24.214732+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('83d666ca-37b7-435a-891d-cfd71f313611', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T02:55:06.515829+00:00', 'Chegou', 'cd771985-628d-4a1a-aafe-1cd5cee63a55', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T02:55:06.515829+00:00', NULL, NULL, 'Validação Manual (Plantão - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T02:55:06.515829+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('baf5ec47-fd91-4b6e-aef1-9bb1535ac729', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T02:55:11.111589+00:00', 'Chegou', '7934b67a-70c8-4a26-8693-4349926f0edb', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T02:55:11.111589+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T02:55:11.111589+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('60a28d26-8ece-49bf-a3a1-3f250a51eff1', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:08:56.635733+00:00', 'Cancelado', 'f266283d-1bd0-44cb-8730-1cff68aa0bc3', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:08:56.635733+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:08:56.635733+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('749c14a1-298c-46e9-91e5-ecb82c834e2c', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:13:34.791599+00:00', 'Chegou', '45a1ccf7-8876-4f2e-a34c-7690f19ba719', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:13:34.791599+00:00', NULL, NULL, 'Validação Manual (Plantão - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:13:34.791599+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('b83885dd-428f-422c-b8a0-ff046b7f81a7', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:13:38.197623+00:00', 'Chegou', 'cad21e04-edb3-4801-9d49-57028d77373f', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:13:38.197623+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:13:38.197623+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('9f54a9e1-3331-4414-bbf8-38969757e8d9', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:15:19.151952+00:00', 'Cancelado', 'e407e382-283b-427b-acb1-40a79dea184f', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:15:19.151952+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:15:19.151952+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('f396f5f0-b9ba-42bb-b5c4-f573f57ed507', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:22:22.313055+00:00', 'Chegou', 'c84cf85e-4e10-4723-92bd-332e7d398cc8', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:22:22.313055+00:00', NULL, NULL, 'Validação Manual (Plantão - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:22.313055+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('92e09759-d499-47e1-9812-081e2c568450', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:22:27.153672+00:00', 'Chegou', '1dda20b7-e2ba-4a23-b1b8-beb79153b0c6', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:22:27.153672+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:27.153672+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('ceb1b77c-f5e5-4721-a285-f14557a86008', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:22:42.367022+00:00', 'Cancelado', '67117f7b-0c01-42dc-9ed0-4c48a7152f81', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:22:42.367022+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:22:42.367022+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('9f3bc470-72fe-48b1-859a-2835bcaae87a', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:26:23.999567+00:00', 'Cancelado', 'd0703eb6-aa88-459d-b2ec-e655d4d857d5', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:26:23.999567+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:26:23.999567+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('bc75782e-7438-4584-a98f-1c08d8fe7961', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:30:15.116196+00:00', 'Chegou', 'de02bda1-2144-4575-8008-4be94bd5d629', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:30:15.116196+00:00', NULL, NULL, 'Validação Manual (Plantão - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 8, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:30:15.116196+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('e6904891-7edd-4a16-8fa9-f9f395652cb9', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:30:18.691727+00:00', 'Chegou', '109932b2-7ff1-4352-8f40-a32deafdadb6', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:30:18.691727+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 8, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:30:18.691727+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('819c41c4-bd6a-4774-b227-c49e922924a7', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:31:17.465207+00:00', 'Chegou', '16914ae3-2fd0-4a22-a108-ce09d46f2de4', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:31:17.465207+00:00', NULL, NULL, 'Validação Manual (Plantão - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 9, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:31:17.465207+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('0dde5ae9-33e2-4950-9d36-e9b159fed801', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:52:09.780057+00:00', 'Cancelado', '900c1705-911e-4231-b439-b747dd9830d7', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:52:09.780057+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 9, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:52:09.780057+00:00', 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('0c3d3969-7685-47a9-9eaf-fa8b7448b729', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T03:55:08.329924+00:00', 'Cancelado', 'a128c768-5ec1-4665-8fa4-487da06d888b', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T03:55:08.329924+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 8, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T03:55:08.329924+00:00', 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('ac228008-16b3-49a5-9d18-a8c79c841b0e', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:00:06.1273+00:00', 'Cancelado', '0b706540-6444-4373-bace-58f844b276ed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:00:06.1273+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 9, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:00:06.1273+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('4eacd86b-d76b-405d-8221-d492f00f25d2', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:00:23.597782+00:00', 'Chegou', '5dd244cb-1ff9-4442-be39-0b9ce7983fc5', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:00:23.597782+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 9, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:00:23.597782+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('5ec07cad-5327-432a-9a0a-a3b9e1b83b82', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:03:35.815793+00:00', 'Cancelado', '1dcb7502-72b5-4586-a582-bedbce501751', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:03:35.815793+00:00', NULL, NULL, 'REVERSÃO Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:03:35.815793+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('f6dbf0e0-cc80-4824-9876-6e8005ffc6cc', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:03:54.449062+00:00', 'Chegou', 'bec429a7-4409-4a9a-ac39-25d0b5c194ad', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:03:54.449062+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 4, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:03:54.449062+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('4472ff06-3c1f-427f-8291-892eaf02a233', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:11:13.45438+00:00', 'Cancelado', '94cc5669-c8ad-4e6b-bf10-9c4a22dbc6f9', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:11:13.45438+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 9, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:11:13.45438+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('30ddc344-3e03-4fbb-bf8c-f3d7689da16f', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:11:21.79128+00:00', 'Chegou', '25cd3ae3-bf69-4644-9ed3-4551a73f4375', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:11:21.79128+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 9, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:11:21.79128+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('e205a19c-cdc3-48d1-af50-6c0d3c17ef63', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:14:57.156838+00:00', 'Cancelado', 'adaf0da2-fafd-47da-8e51-5619083309f5', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:14:57.156838+00:00', NULL, NULL, 'REVERSÃO Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 8, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:14:57.156838+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('ca9fd22b-bd22-4cea-9a36-506c7861100c', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:15:02.199368+00:00', 'Chegou', '28683eb7-d364-459e-a9c6-0e627e4070ee', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T04:15:02.199368+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 8, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T04:15:02.199368+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('3d54af3d-2f37-4de4-a461-7b2f6a86e255', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:17:21.799897+00:00', 'Chegou', 'c877385b-e685-4a3e-856a-786b9068c0fa', '2026-05-11T04:17:49.939+00:00', '177.55.72.54'::inet, 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36', -5.3767651, -49.1306331, NULL, '2026-05-11T04:18:03.397+00:00', 'GPS', '2026-05-11T04:17:21.799897+00:00', -5.3767444, -49.1306313, 'teste', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 10, false, NULL, '177.55.72.54', NULL, NULL, 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('f1d901cb-ad4a-46da-87b6-e651046350e5', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T04:18:28.806239+00:00', 'Chegou', 'a696d029-8a19-4109-acdb-2f11046a8e9d', '2026-05-11T04:19:01.765+00:00', '177.55.72.54'::inet, 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36', -5.3767407, -49.1306826, NULL, '2026-05-11T04:19:18.714+00:00', 'GPS', '2026-05-11T04:18:28.806239+00:00', -5.376759, -49.1306477, 'sadasda', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 10, false, NULL, '177.55.72.54', NULL, NULL, 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('3ba7f4f9-70f6-42f4-8145-8c62d09b18dd', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T21:44:44.757949+00:00', 'Chegou', '1f9893cc-e085-4872-b3c8-02b6792455c4', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T21:44:44.757949+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 11, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-11T21:44:44.757949+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('637f831a-5a7a-40d0-9270-350de59d0392', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-11T21:47:01.467935+00:00', 'Chegou', 'b239dd7e-bc6f-4ad0-8fd5-8978fddfc750', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-11T21:47:01.467935+00:00', NULL, NULL, 'O próprio usuário confirmou sua presença (SAÍDA) via terminal.', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 11, false, NULL, NULL, '0def43bc-c1e1-4bd3-bba5-ca46b3219727', '2026-05-11T21:47:01.467935+00:00', 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('775b4e01-2dcc-4be7-a7d0-010db2ba256c', '0e6b03ca-2c54-47f6-af2e-977d2787580d', 'f248c6d1-952b-42de-b53b-11738625deff', '2026-05-12T00:13:04.973918+00:00', 'Chegou', 'd3df66cc-effe-4641-a6d7-663e24f1fa0f', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-12T00:13:04.973918+00:00', NULL, NULL, 'Validação Manual (Plantão - entrada)', '50e18851-35ed-4092-8f74-732aa2fad99b', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-12T00:13:04.973918+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('894049da-d3bb-4950-a10f-86a206cc8139', '0e6b03ca-2c54-47f6-af2e-977d2787580d', 'f248c6d1-952b-42de-b53b-11738625deff', '2026-05-12T00:13:08.787937+00:00', 'Chegou', 'b8102d85-078f-42b0-b29b-42ba51756cdd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-12T00:13:08.787937+00:00', NULL, NULL, 'Validação Manual (Plantão - saida)', '50e18851-35ed-4092-8f74-732aa2fad99b', NULL, NULL, NULL, 5, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-12T00:13:08.787937+00:00', 'Plantão');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('5467e0c3-a09e-4dfd-8f85-1fd34af9d3af', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-13T22:44:09.684864+00:00', 'Chegou', '83f8078f-48aa-4064-9a82-3231ae247563', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-13T22:44:09.684864+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 12, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T22:44:09.684864+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('2424864c-48c7-4ca1-9a91-1bbf60676017', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-13T22:44:14.880646+00:00', 'Chegou', 'f6b8fd7a-8c16-4b26-9991-ba6e664fd710', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-13T22:44:14.880646+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 12, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T22:44:14.880646+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('f24f0376-bd31-45bd-a55f-f8879151372e', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-13T22:44:23.453027+00:00', 'Chegou', 'f8cd4b28-ed43-4fdb-bc9e-14077cd8ab81', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-13T22:44:23.453027+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 13, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T22:44:23.453027+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('4aaf4dab-f57d-4bb2-9e7b-c6c79f454a74', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-13T22:44:31.763092+00:00', 'Chegou', '1951dd6f-f44c-433b-9d94-2d15b5b71813', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-13T22:44:31.763092+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 13, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T22:44:31.763092+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('a5d70847-f6aa-4bf4-a796-81da3e211fad', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-14T22:32:31.336248+00:00', 'Chegou', 'dc8f7903-2869-426d-8a7b-79a34a0d3515', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-14T22:32:31.336248+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 14, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-14T22:32:31.336248+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('673fb198-50d8-4ba4-8c81-1d1756d6f760', '0e6b03ca-2c54-47f6-af2e-977d2787580d', 'f248c6d1-952b-42de-b53b-11738625deff', '2026-05-14T22:35:51.618866+00:00', 'Aceito', '17be9785-e701-4fe0-9c66-dce9ae30ff1d', '2026-05-14T22:36:32.483+00:00', '45.173.175.20'::inet, 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36', -5.360652, -49.1229026, NULL, NULL, NULL, '2026-05-14T22:35:51.618866+00:00', NULL, NULL, 'kjlfsd lçsdkj flksdj flçsd', '50e18851-35ed-4092-8f74-732aa2fad99b', NULL, NULL, NULL, 14, false, NULL, NULL, NULL, NULL, 'Sobreaviso');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('c6ba0404-811c-4bbe-a43d-d29d19840585', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-15T03:35:27.37509+00:00', 'Chegou', '1af1b336-c605-4dad-ab59-5cf336389493', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-15T03:35:27.37509+00:00', NULL, NULL, 'Validação Manual (Regular - saida)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 14, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-15T03:35:27.37509+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('300326c4-b3b8-4585-856f-ab7434089bdc', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-18T13:03:08.57835+00:00', 'Chegou', '8bb085e9-e80b-4d93-9f13-3df25edc7cea', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-18T13:03:08.57835+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 18, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-18T13:03:08.57835+00:00', 'Regular');
INSERT INTO public.logs_sobreaviso (id, servidor_id, unidade_id, data_hora_acionamento, status, token_magic_link, data_hora_aceite, ip_aceite, user_agent, lat_aceite, long_aceite, eta_minutos, data_hora_chegada, tipo_validacao_chegada, created_at, lat_chegada, long_chegada, motivo_acionamento, escala_mensal_id, justificativa_recusa, lat_recusa, long_recusa, dia, validacao_manual, motivo_falha, ip_chegada, validado_por, data_hora_validacao, categoria) VALUES ('51c29262-a51a-42cb-ac60-f905a2302937', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '9f5ba3d4-44db-452d-a0e5-614e86437807', '2026-05-22T05:40:48.655977+00:00', 'Chegou', 'ef50fd66-24aa-4866-a5c6-dc50e6a2c5ed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Manual', '2026-05-22T05:40:48.655977+00:00', NULL, NULL, 'Validação Manual (Regular - entrada)', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', NULL, NULL, NULL, 15, true, NULL, NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-22T05:40:48.655977+00:00', 'Regular');

-- Table: public.logs_sistema (114 rows)
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('aabf6494-a4bd-46cb-a182-f3c2644f45b8', '2026-05-10T23:19:45.749907+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'ADICIONAR_SERVIDOR', '{"ano":2026,"mes":5,"nome":"Barbara Suellen de Jesus Sousa","setor_id":"0e15994b-997a-4d85-b09b-c224edf4049b","unidade_id":"111628b6-28ab-4ce7-ae46-890f377ddcdd","servidor_id":"19a4765c-cf4e-49d1-a843-218d2abf6290"}'::jsonb, '111628b6-28ab-4ce7-ae46-890f377ddcdd', '0e15994b-997a-4d85-b09b-c224edf4049b');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('72e41716-d28e-47bb-872f-47db503f5018', '2026-05-10T23:19:52.185532+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"0e15994b-997a-4d85-b09b-c224edf4049b","unidade_id":"111628b6-28ab-4ce7-ae46-890f377ddcdd","total_servidores":1,"total_lancamentos":0}'::jsonb, '111628b6-28ab-4ce7-ae46-890f377ddcdd', '0e15994b-997a-4d85-b09b-c224edf4049b');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e631f5f2-4204-4f04-af08-d7c95f14b361', '2026-05-10T23:26:42.185064+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGOUT', '{"info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0904c9b8-d3b8-4ede-aca0-1a5001f857aa', '2026-05-10T23:27:11.468294+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('4fbf0110-edc6-4a77-aa03-2ac88cbff175', '2026-05-10T23:29:38.666106+00:00', '0def43bc-c1e1-4bd3-bba5-ca46b3219727', 'LOGIN', '{"info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('5ec92215-eb0b-4ff7-9b44-2b3fe15d74e4', '2026-05-10T23:29:50.793573+00:00', '0def43bc-c1e1-4bd3-bba5-ca46b3219727', 'LOGOUT', '{"info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('99dc9914-8472-4543-a457-06724b3d8d61', '2026-05-10T23:29:59.187487+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('8b14d031-972c-4efb-ac83-3dd67c3e5464', '2026-05-10T23:34:53.016449+00:00', '0def43bc-c1e1-4bd3-bba5-ca46b3219727', 'LIMPEZA_BANCO_DADOS', '{"info":"Limpeza total de registros de teste para início de cadastro real","tabela":"servidores","quantidade_removida":14}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e8e8c3fa-0dce-4eff-aeb3-82771cd276a3', '2026-05-11T00:12:01.282045+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'ADICIONAR_SERVIDOR', '{"ano":2026,"mes":5,"nome":"FERNANDO MARCULINO GUIMARAES JUNIOR","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","servidor_id":"0e6b03ca-2c54-47f6-af2e-977d2787580d"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('28cb4a01-87c2-486a-ad6b-917a9277310c', '2026-05-11T00:18:46.315696+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":6}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('30bd3af1-1b4d-45fc-b36d-0fe2c1f2a583', '2026-05-11T00:28:24.78117+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":5}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('bd7755ee-2a97-441a-a134-4f0dc5eef9ca', '2026-05-11T00:33:04.571977+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":6}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('d57d895b-196e-46a0-997b-3b6aabd9e0a2', '2026-05-11T00:33:52.561459+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":6}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('5dc2543c-e9a0-4c34-a189-535382f08305', '2026-05-11T00:44:46.542097+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":4}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('2aecef2f-2060-4ea1-8960-e8a95143df94', '2026-05-11T00:44:54.594346+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":4}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('adaafa82-5d8f-4ff9-9231-4d602a548beb', '2026-05-11T00:49:01.261967+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":6}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('32413dde-08c7-4d13-ad61-40e6ed57cc4f', '2026-05-11T01:01:46.954213+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":4}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('ba62a225-419b-4081-8d1b-fb48858e2ad1', '2026-05-11T01:02:50.284986+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":0}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('93d32d40-8c51-4438-ae48-ef2cc72ba014', '2026-05-10T23:20:59.524943+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REMOVER_SERVIDOR_DA_ESCALA', '{"ano":2026,"mes":5,"nome":"Barbara Suellen de Jesus Sousa","setor_id":"0e15994b-997a-4d85-b09b-c224edf4049b","unidade_id":"111628b6-28ab-4ce7-ae46-890f377ddcdd","servidor_id":"19a4765c-cf4e-49d1-a843-218d2abf6290","escala_mensal_id":"ad34e2e0-058e-4b41-a47c-fceab86e2bef"}'::jsonb, '111628b6-28ab-4ce7-ae46-890f377ddcdd', '0e15994b-997a-4d85-b09b-c224edf4049b');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('eb1f015d-fbbd-4d45-8948-d92f4f75b9c3', '2026-05-11T01:02:54.58484+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REMOVER_SERVIDOR_DA_ESCALA', '{"ano":2026,"mes":5,"nome":"FERNANDO MARCULINO GUIMARAES JUNIOR","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","servidor_id":"0e6b03ca-2c54-47f6-af2e-977d2787580d","escala_mensal_id":"267e86a8-ae00-4824-a4e0-4d87e9ee8eea"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('f6f6b2cf-0386-43f3-8c41-705af7f6bfc5', '2026-05-11T01:13:04.129875+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGOUT', '{"ip":"177.55.72.54","info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('76b81bf2-0b07-4a4f-86a9-4570f258b83e', '2026-05-11T01:13:13.147539+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('80f258d3-f533-41e6-a382-06e53da854c6', '2026-05-11T01:20:44.025432+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"::1","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('5a8cf655-6b70-40cd-9f1c-3e0e5f4acac7', '2026-05-11T01:45:10.786547+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'ADICIONAR_TODOS_SERVIDORES', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","quantidade":1,"servidores":["FERNANDO MARCULINO GUIMARAES JUNIOR"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0a6865c9-9f65-4e3f-8fbb-4f4a22f41100', '2026-05-11T01:45:45.486542+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('bbe22768-3e2f-4e2d-a628-7dfac3f2cfbd', '2026-05-11T01:50:17.385721+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":0}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e09a7137-ed66-4649-8a59-c89199d5d60e', '2026-05-11T01:52:05.086525+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REMOVER_SERVIDOR_DA_ESCALA', '{"ano":2026,"mes":5,"nome":"FERNANDO MARCULINO GUIMARAES JUNIOR","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","servidor_id":"0e6b03ca-2c54-47f6-af2e-977d2787580d","escala_mensal_id":"1c055ed4-25cb-49d4-b57f-6cd6c0af5d79"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('85a6bd02-8e2a-44da-af93-0a25cc931c90', '2026-05-13T13:17:26.997873+00:00', '6979b6b5-df31-42e0-96a4-03dbac3e6bf6', 'LOGIN', '{"ip":"45.173.175.7","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('b56e3c29-499c-4b44-ac16-71ca80a60524', '2026-05-11T01:52:08.300615+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":0,"total_lancamentos":0}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('76fc3f2a-dd95-4064-baa6-f98b9f96ce9a', '2026-05-11T01:55:11.255242+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'ADICIONAR_TODOS_SERVIDORES', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","quantidade":1,"servidores":["FERNANDO MARCULINO GUIMARAES JUNIOR"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('5176ca35-504f-4833-882d-92fe4514f9d1', '2026-05-11T01:55:32.096909+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('6e478fe7-c8dd-4e5f-baab-c8c64b8d1b5c', '2026-05-11T01:57:26.632113+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":0}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('4fbded9f-b293-4948-9c5f-95b40173f559', '2026-05-11T01:57:32.237583+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('576cce86-9af0-493a-9651-3dc9f193623c', '2026-05-11T02:54:41.286904+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":4}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('ee3d0475-f84e-40cb-8328-4d0da6651361', '2026-05-11T03:08:30.824824+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":4}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('b4378138-2405-4953-8a25-0a03f6fd72d1', '2026-05-11T03:08:39.368046+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LIMPAR_ESCALA', '{"ano":2026,"mes":5,"info":"Lançamentos removidos (preservando presenças)","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('b7cfdcf4-7acc-4fb4-acec-a5a5476bdfa0', '2026-05-11T03:09:24.749661+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":4}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('2c335982-cd21-4b46-a097-f16df9cb44f9', '2026-05-11T03:13:07.407868+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":5}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('931fcac5-9060-4bdf-94bb-163ec96f9d9c', '2026-05-11T03:15:26.059415+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LIMPAR_ESCALA', '{"ano":2026,"mes":5,"info":"Lançamentos removidos (preservando presenças)","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('752b50fe-25c6-4b16-a03c-62ecd2bda271', '2026-05-11T03:15:46.11616+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":4}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('ec20fa81-f9d0-413e-bb30-59ce4d27c8b5', '2026-05-11T03:15:58.708004+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":6}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('bd210a49-660c-412a-bced-bc875e5fa592', '2026-05-11T03:16:04.721295+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LIMPAR_ESCALA', '{"ano":2026,"mes":5,"info":"Lançamentos removidos (preservando presenças)","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('2d2a5cec-c8f9-488b-9563-9095cbf86772', '2026-05-11T03:16:18.774869+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LIMPAR_ESCALA', '{"ano":2026,"mes":5,"info":"Lançamentos removidos (preservando presenças)","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('3837d1d2-670a-4680-b6e7-0c37aa7600b6', '2026-05-11T03:19:49.350559+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":6}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('a1f53b11-1fb0-4f0b-b929-1d321cbf255e', '2026-05-11T03:26:03.378109+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":7}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('bd4d6aec-6786-447f-8c1c-b7db52d1d038', '2026-05-11T03:29:35.506897+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":8}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e7c54a45-1d15-41fc-a7ba-bbb43d091645', '2026-05-11T03:30:10.579365+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":9}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('584b816a-74d5-473c-a2a1-4c11fef9a9c6', '2026-05-11T03:31:10.86426+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":10}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e7de6b19-a2cf-445e-ab08-ed1d389707e9', '2026-05-11T03:31:27.858766+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LIMPAR_ESCALA', '{"ano":2026,"mes":5,"info":"Lançamentos removidos (preservando presenças)","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('8dbb9232-6fd7-420e-b3a3-96f0f71e5b9e', '2026-05-11T03:37:39.211282+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGOUT', '{"ip":"::1","info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('dfd6b119-7e69-41b9-9808-817c8f70901d', '2026-05-11T03:38:55.818079+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"::1","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('97c83229-c3e7-4787-9c18-502694260589', '2026-05-11T03:52:45.796758+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LIMPAR_ESCALA', '{"ano":2026,"mes":5,"info":"Lançamentos removidos (preservando presenças)","setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807"}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('356b6cf1-56a1-4cc4-8731-027092aca73c', '2026-05-13T22:33:02.009908+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"::1","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('42cc7b15-d343-4deb-894a-ba1004cd5673', '2026-05-11T03:52:56.274861+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":10}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('7cbddfbe-2411-4f04-bfef-6ee8ea44f6e8', '2026-05-11T04:03:20.623042+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('54f45853-7c2f-46a4-ba1e-b4132348a0e6', '2026-05-11T04:11:54.988995+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":10}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0b6c64fc-cdc5-4cb3-b26c-8e7eeba3c98a', '2026-05-11T04:19:38.366924+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'FECHAR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('744a7397-8941-4238-98ec-22ba23e4e4cd', '2026-05-11T04:41:48.908563+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REABRIR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('9ea95b4f-8b07-4fcf-bc1f-1b6b6be7fe84', '2026-05-11T04:42:00.93453+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":11}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('7232b639-18c6-404f-816a-10d68a00e633', '2026-05-11T04:42:36.993934+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":12}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('5dffad79-2614-48ab-a84c-45dec54853b3', '2026-05-11T04:47:37.749708+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":13}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('81c2b5ac-03a3-430f-9ead-7304f14d8a91', '2026-05-11T04:52:00.247522+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'FECHAR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('049eba06-4403-4577-ad13-1706f4c4cb92', '2026-05-11T04:58:41.994487+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REABRIR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('587d3b41-321b-4f94-9eca-8856e21c84c8', '2026-05-11T04:58:56.42878+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'FECHAR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('41066362-3c14-484a-a52f-806685aa64de', '2026-05-11T05:03:52.688905+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REABRIR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('fe2f713a-196b-4fb6-8b59-56d6a2da9857', '2026-05-11T05:20:45.552204+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'FECHAR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('b48d3f3c-d002-4f09-980f-f690c9b8216e', '2026-05-11T05:29:23.29131+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REABRIR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('b082a525-e2b9-4271-88aa-9626b87acdcc', '2026-05-11T15:17:58.129758+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('05a718d4-29c5-4733-bc27-85e2d573b559', '2026-05-11T15:18:01.901523+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('c320fb00-67f1-472b-8d09-325b9f20308c', '2026-05-11T15:19:28.061772+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":25}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('9132ef71-65ee-4506-927d-476b97d4946f', '2026-05-11T15:20:41.565691+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'ADICIONAR_SERVIDOR_EXTERNO', '{"ano":2026,"mes":5,"nome":"FERNANDO MARCULINO GUIMARAES JUNIOR","setor_id":"49e9559a-3b87-4bc2-ad89-24ff5ea77cbf","unidade_id":"f248c6d1-952b-42de-b53b-11738625deff","servidor_id":"0e6b03ca-2c54-47f6-af2e-977d2787580d"}'::jsonb, 'f248c6d1-952b-42de-b53b-11738625deff', '49e9559a-3b87-4bc2-ad89-24ff5ea77cbf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('461452b2-d1d0-4308-88a7-6f4c719ae1ca', '2026-05-11T15:21:18.117269+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e07d15e8-cce7-4a4b-8707-f3c81200265e', '2026-05-11T15:21:20.640057+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('4911004d-beb5-4b56-a5dd-5015653647d0', '2026-05-11T15:22:56.896402+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"49e9559a-3b87-4bc2-ad89-24ff5ea77cbf","unidade_id":"f248c6d1-952b-42de-b53b-11738625deff","total_servidores":1,"total_lancamentos":1}'::jsonb, 'f248c6d1-952b-42de-b53b-11738625deff', '49e9559a-3b87-4bc2-ad89-24ff5ea77cbf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('f8d6b2b3-190f-4209-bae0-5442670d1933', '2026-05-11T15:25:13.754691+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":25}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('f41b259a-371f-46ea-b7f1-a82272934c20', '2026-05-11T16:04:11.806178+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('f3ea0245-fffc-431e-a2f7-f09777c224bf', '2026-05-11T21:43:49.009028+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('d6eecba4-2aa6-41cf-ab1a-7856f7b955f2', '2026-05-11T21:45:30.298133+00:00', '0def43bc-c1e1-4bd3-bba5-ca46b3219727', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('db427d45-3bac-43c1-b21d-7e2789ab8802', '2026-05-11T21:46:11.902643+00:00', '0def43bc-c1e1-4bd3-bba5-ca46b3219727', 'LOGOUT', '{"ip":"45.173.175.20","info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('13fc27d0-fe78-412b-8121-ca473199ec88', '2026-05-12T00:10:38.600753+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0eef7d33-e325-481d-ad7a-1261586f9bad', '2026-05-12T00:10:42.374649+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('c9c81046-aa0c-40ca-8bbf-c789d6e53b9f', '2026-05-12T11:12:57.032407+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('9625679e-d54d-48ee-8f23-d884c6551f6d', '2026-05-12T11:14:00.674296+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGOUT', '{"ip":"177.55.72.54","info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('22ebed39-6eab-4878-ac05-2295a65a3703', '2026-05-13T13:17:23.02608+00:00', '6979b6b5-df31-42e0-96a4-03dbac3e6bf6', 'LOGIN', '{"ip":"45.173.175.7","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('cbcc39ca-aa8b-4838-8784-96340d0c99db', '2026-05-13T23:03:44.49193+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":25}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('b8f8874f-dbe1-44f8-be28-4a3e075d8baf', '2026-05-13T23:04:25.744377+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":26}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('d9a123a8-0b73-4124-9b1d-243b74fc2296', '2026-05-13T23:14:07.998806+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":25}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('d924b287-1cf8-408a-9f55-64d071feaa32', '2026-05-13T23:31:46.528143+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":26}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('6631de84-594a-4930-8231-0b84714904f5', '2026-05-13T23:45:27.981815+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e12fe955-d0c3-4d35-8c7f-9679dbebd390', '2026-05-14T14:38:56.531461+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('fd04bf15-3de7-4be1-aa46-e46ee7d0313a', '2026-05-14T14:39:00.396003+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('34494223-a164-4516-b58c-ee9e14bf9694', '2026-05-14T14:53:09.823651+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('2d63e83b-a95f-4b25-bd21-7299d9c3a5a6', '2026-05-14T22:31:20.520056+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('4f2a7428-dae6-4104-b840-7b081244eb3a', '2026-05-14T22:34:44.336419+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"49e9559a-3b87-4bc2-ad89-24ff5ea77cbf","unidade_id":"f248c6d1-952b-42de-b53b-11738625deff","total_servidores":1,"total_lancamentos":2}'::jsonb, 'f248c6d1-952b-42de-b53b-11738625deff', '49e9559a-3b87-4bc2-ad89-24ff5ea77cbf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('6ebbade1-f3e2-48cf-aafa-c5bbafd5c251', '2026-05-14T22:35:29.110578+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"49e9559a-3b87-4bc2-ad89-24ff5ea77cbf","unidade_id":"f248c6d1-952b-42de-b53b-11738625deff","total_servidores":1,"total_lancamentos":3}'::jsonb, 'f248c6d1-952b-42de-b53b-11738625deff', '49e9559a-3b87-4bc2-ad89-24ff5ea77cbf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0d0e2dab-3535-4808-9ece-ac55670f0332', '2026-05-14T22:43:17.274486+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('6964fc5d-69da-407f-8fbd-b6a2557be6aa', '2026-05-14T22:48:10.207056+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'FECHAR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('454f928d-f61b-4e7c-ae13-407d23f164af', '2026-05-15T02:25:52.032769+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('370ee009-72b9-42be-a176-7411b6339c9e', '2026-05-15T02:27:03.343232+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'REABRIR_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","ids_escala":["6e06b08e-d3fc-4348-8c69-ea986ddb3e9f"],"unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('6a49cbc5-2051-4103-849b-7ccf1858187d', '2026-05-15T03:16:29.436491+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"::1","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0678ca2c-86f3-426f-8cdc-3be2f9fc2698', '2026-05-15T04:02:15.030413+00:00', 'fed6fad8-33c9-4290-9e0e-be25a58d13b7', 'LOGIN', '{"ip":"::1","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('a2424591-9aa8-4c39-af68-fc14cae38a17', '2026-05-15T04:02:41.741731+00:00', 'fed6fad8-33c9-4290-9e0e-be25a58d13b7', 'LOGOUT', '{"ip":"::1","info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('c3c069bd-9026-445a-b7af-630208dce02a', '2026-05-15T04:02:49.685588+00:00', 'fed6fad8-33c9-4290-9e0e-be25a58d13b7', 'LOGIN', '{"ip":"::1","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('e5f4f92e-cb38-4b3f-a228-ff2ccc4d0810', '2026-05-18T12:56:18.181541+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0da828cd-b872-46ff-8d32-b406807b7256', '2026-05-18T13:01:18.460508+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":27}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('0a15a0bf-1007-405f-b527-e4fd35d3bb61', '2026-05-18T13:05:04.366715+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"45.173.175.20","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('eea4a022-2dbc-4bf1-bdff-4633fb472cf2', '2026-05-18T13:09:42.591648+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGOUT', '{"ip":"45.173.175.20","info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('d042ea5a-8248-42d3-8e20-922a15b57132', '2026-05-22T04:28:28.15784+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('8f8edbc1-138c-41cb-9acc-b6c392ed5969', '2026-05-22T04:28:31.733447+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('d7ea4940-729d-4ff4-b973-77e3b28d65ec', '2026-05-22T04:31:11.085097+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"::1","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('30d4863e-7aea-4e57-8fe9-92b37dfde573', '2026-05-22T05:39:55.312048+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('475a3071-8419-49a6-b2ac-2b1016505fd1', '2026-05-22T05:40:04.661096+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGOUT', '{"ip":"177.55.72.54","info":"Sessão encerrada pelo usuário"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('f8895635-e96b-4376-b13a-037317c771ca', '2026-05-22T05:40:33.126928+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'LOGIN', '{"ip":"177.55.72.54","info":"Login efetuado com sucesso"}'::jsonb, NULL, NULL);
INSERT INTO public.logs_sistema (id, created_at, user_id, acao, detalhes, unidade_id, setor_id) VALUES ('59e3b4c6-87dc-459f-b5d1-3607aabb82fc', '2026-05-22T05:40:51.397366+00:00', '1c144bc0-8f01-464e-beec-3cc94fdb9150', 'SALVAR_PREVISAO_ESCALA', '{"ano":2026,"mes":5,"setor_id":"e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf","unidade_id":"9f5ba3d4-44db-452d-a0e5-614e86437807","total_servidores":1,"total_lancamentos":27}'::jsonb, '9f5ba3d4-44db-452d-a0e5-614e86437807', 'e939c0bc-e4ee-4c99-b9de-f5901ff3b9cf');

-- Table: public.solicitacoes_troca (6 rows)
INSERT INTO public.solicitacoes_troca (id, solicitante_id, escala_mensal_solicitante_id, dia_origem, categoria_origem, turno_origem_id, destinatario_id, escala_mensal_destinatario_id, dia_destino, justificativa, status, motivo_rejeicao, aprovado_por, created_at, updated_at) VALUES ('4112739b-9104-417d-9ca6-1858e9f3bdc8', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 18, 'Regular', '864644f9-504f-40a5-91be-c608939fc434', NULL, NULL, NULL, 'pode me da uma folga nesse dia?', 'Aprovada', NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T23:02:03.15719+00:00', '2026-05-13T23:13:41.014+00:00');
INSERT INTO public.solicitacoes_troca (id, solicitante_id, escala_mensal_solicitante_id, dia_origem, categoria_origem, turno_origem_id, destinatario_id, escala_mensal_destinatario_id, dia_destino, justificativa, status, motivo_rejeicao, aprovado_por, created_at, updated_at) VALUES ('a757ea5b-ee2f-4625-9201-80883ee950c9', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 14, 'Regular', '864644f9-504f-40a5-91be-c608939fc434', NULL, NULL, NULL, 'mais um teste', 'Rejeitada', 'não posso da folta nesse data, vamos conversar quando tiver de volta.', '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T23:20:39.568223+00:00', '2026-05-13T23:21:22.755+00:00');
INSERT INTO public.solicitacoes_troca (id, solicitante_id, escala_mensal_solicitante_id, dia_origem, categoria_origem, turno_origem_id, destinatario_id, escala_mensal_destinatario_id, dia_destino, justificativa, status, motivo_rejeicao, aprovado_por, created_at, updated_at) VALUES ('ad37ec6c-8af4-4f6b-a534-f7c1e2bb12c2', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 16, 'Plantão', '0f7d5836-f3e1-472e-90c4-ef69e7bd6ab1', NULL, NULL, NULL, 'teste', 'Rejeitada', 'nao pode trocar esse dia.', '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-13T23:32:01.807224+00:00', '2026-05-13T23:32:32.837+00:00');
INSERT INTO public.solicitacoes_troca (id, solicitante_id, escala_mensal_solicitante_id, dia_origem, categoria_origem, turno_origem_id, destinatario_id, escala_mensal_destinatario_id, dia_destino, justificativa, status, motivo_rejeicao, aprovado_por, created_at, updated_at) VALUES ('5f8deeb4-33a8-454c-972d-33d8591c0617', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 21, 'Regular', '864644f9-504f-40a5-91be-c608939fc434', NULL, NULL, NULL, 'lkj sjlksjflksfksfjsklçajdflksjds  dsklhjfdgsk j', 'Rejeitada', 'lij skldflskjflsdk', '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-14T22:44:11.795382+00:00', '2026-05-14T22:44:48.622+00:00');
INSERT INTO public.solicitacoes_troca (id, solicitante_id, escala_mensal_solicitante_id, dia_origem, categoria_origem, turno_origem_id, destinatario_id, escala_mensal_destinatario_id, dia_destino, justificativa, status, motivo_rejeicao, aprovado_por, created_at, updated_at) VALUES ('288cf553-4b51-4237-b2f3-56a85b86c833', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 23, 'Regular', '864644f9-504f-40a5-91be-c608939fc434', NULL, NULL, NULL, 'teste', 'Aprovada', NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-15T02:27:12.554442+00:00', '2026-05-15T02:27:32.489+00:00');
INSERT INTO public.solicitacoes_troca (id, solicitante_id, escala_mensal_solicitante_id, dia_origem, categoria_origem, turno_origem_id, destinatario_id, escala_mensal_destinatario_id, dia_destino, justificativa, status, motivo_rejeicao, aprovado_por, created_at, updated_at) VALUES ('13bb43ff-f506-492d-86aa-1360ed11a5bb', '0e6b03ca-2c54-47f6-af2e-977d2787580d', '6e06b08e-d3fc-4348-8c69-ea986ddb3e9f', 20, 'Regular', '864644f9-504f-40a5-91be-c608939fc434', NULL, NULL, NULL, 'Vou trocar de plantão com fulo', 'Aprovada', NULL, '1c144bc0-8f01-464e-beec-3cc94fdb9150', '2026-05-18T12:59:37.846057+00:00', '2026-05-18T13:00:10.721+00:00');

-- ----------------------------------------------------
-- 7. Create Functions, Triggers, RLS, and Constraints
-- ----------------------------------------------------

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
  (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
  (unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR 
  (id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
);

CREATE POLICY "Permitir tudo para usuários autenticados" ON public.cargos FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated" ON public.feriados FOR ALL TO authenticated USING (true);

CREATE POLICY "Everyone can view journeys" ON public.jornadas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage journeys" ON public.jornadas FOR ALL USING (get_my_role() = 'super_admin'::user_role);

CREATE POLICY "Users can view relevant servers" ON public.servidores FOR SELECT TO authenticated USING (
  (get_my_role() = 'super_admin'::user_role) OR 
  (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
  (unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR 
  (setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid()))
);
CREATE POLICY "Admins can manage all servers" ON public.servidores FOR ALL TO authenticated USING (get_my_role() = 'super_admin'::user_role);
CREATE POLICY "Scoped access for Admins and Coordinators" ON public.servidores FOR ALL TO authenticated USING (
  (get_my_role() = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND 
  ((EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
   (unidade_id IN (SELECT profile_unidades.unidade_id FROM public.profile_unidades WHERE profile_unidades.profile_id = auth.uid())) OR 
   (setor_id IN (SELECT profile_setores.setor_id FROM public.profile_setores WHERE profile_setores.profile_id = auth.uid())))
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
