-- Migration: Add sector staffing requirements and global rule
ALTER TABLE public.setores
ADD COLUMN servidores_manha_min integer DEFAULT NULL CHECK (servidores_manha_min >= 0 OR servidores_manha_min IS NULL),
ADD COLUMN servidores_manha_ideal integer DEFAULT NULL CHECK (servidores_manha_ideal >= 0 OR servidores_manha_ideal IS NULL),
ADD COLUMN servidores_manha_max integer DEFAULT NULL CHECK (servidores_manha_max >= 0 OR servidores_manha_max IS NULL),

ADD COLUMN servidores_tarde_min integer DEFAULT NULL CHECK (servidores_tarde_min >= 0 OR servidores_tarde_min IS NULL),
ADD COLUMN servidores_tarde_ideal integer DEFAULT NULL CHECK (servidores_tarde_ideal >= 0 OR servidores_tarde_ideal IS NULL),
ADD COLUMN servidores_tarde_max integer DEFAULT NULL CHECK (servidores_tarde_max >= 0 OR servidores_tarde_max IS NULL),

ADD COLUMN servidores_noite_min integer DEFAULT NULL CHECK (servidores_noite_min >= 0 OR servidores_noite_min IS NULL),
ADD COLUMN servidores_noite_ideal integer DEFAULT NULL CHECK (servidores_noite_ideal >= 0 OR servidores_noite_ideal IS NULL),
ADD COLUMN servidores_noite_max integer DEFAULT NULL CHECK (servidores_noite_max >= 0 OR servidores_noite_max IS NULL),

ADD COLUMN dimensionamento_fds_feriados boolean DEFAULT true;

-- Constraints para garantir consistência dos intervalos (apenas se configurados)
ALTER TABLE public.setores
ADD CONSTRAINT chk_manha_range CHECK (
  (servidores_manha_min IS NULL OR servidores_manha_ideal IS NULL OR servidores_manha_min <= servidores_manha_ideal) AND 
  (servidores_manha_ideal IS NULL OR servidores_manha_max IS NULL OR servidores_manha_max = 0 OR servidores_manha_ideal <= servidores_manha_max)
),
ADD CONSTRAINT chk_tarde_range CHECK (
  (servidores_tarde_min IS NULL OR servidores_tarde_ideal IS NULL OR servidores_tarde_min <= servidores_tarde_ideal) AND 
  (servidores_tarde_ideal IS NULL OR servidores_tarde_max IS NULL OR servidores_tarde_max = 0 OR servidores_tarde_ideal <= servidores_tarde_max)
),
ADD CONSTRAINT chk_noite_range CHECK (
  (servidores_noite_min IS NULL OR servidores_noite_ideal IS NULL OR servidores_noite_min <= servidores_noite_ideal) AND 
  (servidores_noite_ideal IS NULL OR servidores_noite_max IS NULL OR servidores_noite_max = 0 OR servidores_noite_ideal <= servidores_noite_max)
);

-- Inserir configuração global de rigidez
INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES (
    'escala_regra_dimensionamento',
    '"flexivel"'::jsonb,
    'Define o comportamento da regra de dimensionamento dos setores na grade: flexivel (apenas avisa) ou rigida (bloqueia excesso e obriga o minimo ao fechar).',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
) ON CONFLICT (chave) DO NOTHING;
