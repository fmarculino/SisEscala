-- Migration: credenciais do relogio de ponto passam a ser cadastradas em dispositivos_rep
-- Data: 2026-08-11
--
-- MOTIVACAO
--   O download de "Marcacoes > Dispositivos REP > Baixar aplicativo" ja empacota o .exe com um
--   config.yaml preenchido com id/token/URL do SisEscala (v1.48.0/v1.48.1) - mas usuario_rep e
--   senha_rep do proprio relogio nunca foram campos desta tela. O route.ts sempre gravava
--   "admin" e um placeholder "PREENCHA_A_SENHA..." no arquivo, e o admin tinha que editar o
--   config.yaml a mao depois de extrair o zip - exatamente o tipo de edicao manual que a v1.48.2
--   (mescla automatica de config.yaml) tinha acabado de eliminar para as outras secoes.
--
--   Cada unidade cuida do proprio relogio (CLAUDE.md, decisao de 11/08/2026: sem AD/GPO
--   central) e pode ter senha diferente de admin/admin - por isso o campo fica em
--   dispositivos_rep, por dispositivo, e nao em configuracoes_globais.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS. Seguro rodar nos dois ambientes (CLAUDE.md armadilha 3).

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS usuario_rep text NOT NULL DEFAULT 'admin',
    ADD COLUMN IF NOT EXISTS senha_rep    text NULL,
    ADD COLUMN IF NOT EXISTS porta        integer NOT NULL DEFAULT 443,
    ADD COLUMN IF NOT EXISTS usa_https    boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.dispositivos_rep.senha_rep IS
    'Senha de admin do proprio relogio REP-C (login.fcgi), guardada em texto claro para poder '
    'ser reembutida no config.yaml a cada download - nao e um hash de PIN de servidor. Protegida '
    'pela mesma RLS de gestao administrativa de dispositivos_rep (admin/super_admin apenas).';

-- CONFERENCIA APOS APLICAR
--
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'dispositivos_rep'
--      AND column_name IN ('usuario_rep', 'senha_rep', 'porta', 'usa_https');
--   -- esperado: 4 linhas, usuario_rep default 'admin'::text, porta default 443, usa_https default true
