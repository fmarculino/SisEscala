-- Migration: Configurações Globais de Limites e Tabela de Exceções de Escala
-- Data: 2026-08-11
-- Descrição: Define limites padrão de horas e sobreavisos por servidor na tabela configuracoes_globais
--            e cria a tabela excecoes_escala_servidor para autorizações extraordinárias por Administradores.

-- 1. Inserir chaves de configuração padrão em configuracoes_globais se ainda não existirem
INSERT INTO public.configuracoes_globais (chave, valor, descricao, updated_at)
VALUES 
  ('max_horas_escala_servidor', '300', 'Quantidade máxima de horas que um servidor pode acumular na escala mensal (excluindo sobreaviso).', NOW()),
  ('max_sobreavisos_escala_servidor', '10', 'Quantidade máxima de unidades de sobreaviso que um servidor pode ter na escala mensal.', NOW())
ON CONFLICT (chave) DO NOTHING;

-- 2. Criar a tabela excecoes_escala_servidor
CREATE TABLE IF NOT EXISTS public.excecoes_escala_servidor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id UUID NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    unidade_id UUID NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
    mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    ano INT NOT NULL CHECK (ano >= 2020),
    horas_adicionais_autorizadas NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (horas_adicionais_autorizadas >= 0),
    sobreavisos_adicionais_autorizados INT NOT NULL DEFAULT 0 CHECK (sobreavisos_adicionais_autorizados >= 0),
    motivo_justificativa TEXT NOT NULL,
    autorizado_por UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_excecao_servidor_unidade_mes_ano UNIQUE (servidor_id, unidade_id, mes, ano)
);

-- Index para buscas rápidas por servidor e competência
CREATE INDEX IF NOT EXISTS idx_excecoes_escala_servidor_comp 
ON public.excecoes_escala_servidor (servidor_id, unidade_id, mes, ano);

-- Habilitar RLS
ALTER TABLE public.excecoes_escala_servidor ENABLE ROW LEVEL SECURITY;

-- Politica de Leitura: Usuários autenticados podem visualizar exceções
CREATE POLICY "Leitura de excecoes por usuarios autenticados"
ON public.excecoes_escala_servidor
FOR SELECT
TO authenticated
USING (true);

-- Politica de Inserção/Atualização/Deleção: Apenas Admins e Super Admins
CREATE POLICY "Escrita de excecoes por admins"
ON public.excecoes_escala_servidor
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('super_admin', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('super_admin', 'admin')
  )
);
