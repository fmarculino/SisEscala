-- Migration: Add Servidores Eventos (Afastamentos)
-- Description: Creates tipos_eventos and servidores_eventos tables, RLS policies, trigger to clear conflicting shifts, and updates fn_check_shift_conflicts RPC.

-- =========================================================================
-- 1. TABLES
-- =========================================================================

-- Table for event types (Férias, Atestado, etc.)
CREATE TABLE IF NOT EXISTS public.tipos_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL UNIQUE,
    cor TEXT NOT NULL DEFAULT '#EF4444',
    descricao TEXT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Table for public servant events (Absences)
CREATE TABLE IF NOT EXISTS public.servidores_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id UUID NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    tipo_evento_id UUID NOT NULL REFERENCES public.tipos_eventos(id) ON DELETE RESTRICT,
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    observacao TEXT,
    criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_datas CHECK (data_fim >= data_inicio)
);

-- =========================================================================
-- 2. SEED DEFAULT DATA
-- =========================================================================

INSERT INTO public.tipos_eventos (nome, cor, descricao) VALUES
('Férias', '#22C55E', 'Período de férias regulamentares do servidor.'),
('Atestado Médico', '#EF4444', 'Afastamento por motivos de saúde comprovados por atestado.'),
('Licença Maternidade', '#A855F7', 'Licença maternidade conforme legislação vigente.'),
('Licença Paternidade', '#3B82F6', 'Licença paternidade conforme legislação vigente.'),
('Licença Prêmio', '#EAB308', 'Licença prêmio por assiduidade.'),
('Outros', '#71717A', 'Outros tipos de afastamentos autorizados.')
ON CONFLICT (nome) DO NOTHING;

-- Seed Global Configuration Toggle
INSERT INTO public.configuracoes_globais (chave, valor, descricao, created_at, updated_at)
VALUES (
    'permitir_plantao_extra_durante_eventos',
    'false'::jsonb,
    'Permitir que servidores em afastamento/evento (ex: Férias, Licenças) sejam escalados para Plantões ou Hora Extra. Se falso, bloqueia completamente qualquer escala nestes dias.',
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
) ON CONFLICT (chave) DO NOTHING;

-- =========================================================================
-- 3. FUNCTIONS & TRIGGERS
-- =========================================================================

-- Trigger function to clean conflicting shifts after registering or updating an event
CREATE OR REPLACE FUNCTION public.fn_clean_conflicting_shifts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_permitir BOOLEAN;
BEGIN
  -- 1. Obter a configuração global
  SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir
  FROM public.configuracoes_globais
  WHERE chave = 'permitir_plantao_extra_durante_eventos';

  -- 2. Deletar os turnos conflitantes que não possuam presença confirmada
  IF v_permitir THEN
    -- Se for permitido, apenas limpamos as horas normais ('Regular')
    DELETE FROM public.escala_diaria ed
    USING public.escala_mensal em
    WHERE ed.escala_mensal_id = em.id
      AND em.servidor_id = NEW.servidor_id
      AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
      AND ed.categoria = 'Regular'
      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL;
  ELSE
    -- Se não for permitido, limpamos tudo
    DELETE FROM public.escala_diaria ed
    USING public.escala_mensal em
    WHERE ed.escala_mensal_id = em.id
      AND em.servidor_id = NEW.servidor_id
      AND MAKE_DATE(em.ano, em.mes, ed.dia) >= NEW.data_inicio
      AND MAKE_DATE(em.ano, em.mes, ed.dia) <= NEW.data_fim
      AND ed.presenca_entrada_em IS NULL
      AND ed.presenca_saida_em IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Apply trigger to public.servidores_eventos
DROP TRIGGER IF EXISTS trigger_clean_conflicting_shifts ON public.servidores_eventos;
CREATE TRIGGER trigger_clean_conflicting_shifts
AFTER INSERT OR UPDATE ON public.servidores_eventos
FOR EACH ROW
EXECUTE FUNCTION public.fn_clean_conflicting_shifts();


-- Update fn_check_shift_conflicts to validate events
CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts(
    p_servidor_id UUID,
    p_dia INTEGER,
    p_mes INTEGER,
    p_ano INTEGER,
    p_turno_id UUID,
    p_categoria TEXT DEFAULT 'Regular'
)
RETURNS TABLE(conflito BOOLEAN, mensagem TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_turno_slots TEXT[];
    v_conflito_id UUID;
    v_conflito_codigo TEXT;
    v_conflito_unidade TEXT;
    v_conflito_setor TEXT;
    v_afastamento_nome TEXT;
    v_permitir_plantao BOOLEAN;
BEGIN
    -- 1. Verificar se o servidor possui algum afastamento/evento ativo no dia especificado
    SELECT te.nome INTO v_afastamento_nome
    FROM public.servidores_eventos se
    JOIN public.tipos_eventos te ON te.id = se.tipo_evento_id
    WHERE se.servidor_id = p_servidor_id
      AND MAKE_DATE(p_ano, p_mes, p_dia) >= se.data_inicio
      AND MAKE_DATE(p_ano, p_mes, p_dia) <= se.data_fim
    LIMIT 1;

    -- Se o servidor possuir um afastamento/evento nesse dia
    IF v_afastamento_nome IS NOT NULL THEN
        -- Obter a configuração global se permite plantões ou horas extras
        SELECT COALESCE((valor#>>'{}')::boolean, false) INTO v_permitir_plantao
        FROM public.configuracoes_globais
        WHERE chave = 'permitir_plantao_extra_durante_eventos';

        -- Se for categoria Regular, ou se for qualquer outra categoria mas não permitir plantão
        IF p_categoria = 'Regular' OR NOT v_permitir_plantao THEN
            RETURN QUERY SELECT TRUE, format('Servidor está em afastamento/evento (%s).', v_afastamento_nome);
            RETURN;
        END IF;
    END IF;

    -- 2. Buscar os slots do turno proposto
    SELECT slots INTO v_turno_slots
    FROM public.dicionario_turnos
    WHERE id = p_turno_id;

    -- 3. Verificar conflito de escala diária existente (mesmo dia, outra unidade/setor, slots sobrepostos)
    SELECT 
        ed.id, 
        dt.codigo, 
        u.nome, 
        ds.nome
    INTO 
        v_conflito_id, 
        v_conflito_codigo, 
        v_conflito_unidade, 
        v_conflito_setor
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
    JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
    JOIN public.unidades u ON u.id = em.unidade_id
    JOIN public.setores s ON s.id = em.setor_id
    JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
    WHERE em.servidor_id = p_servidor_id
      AND em.mes = p_mes
      AND em.ano = p_ano
      AND ed.dia = p_dia
      AND dt.slots && v_turno_slots
    LIMIT 1;

    IF v_conflito_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, format('Conflito com o turno %s no setor %s (%s).', v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
        RETURN;
    END IF;

    -- Sem conflitos
    RETURN QUERY SELECT FALSE, ''::text;
END;
$function$;

-- =========================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

-- tipos_eventos
ALTER TABLE public.tipos_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura de tipos_eventos para autenticados" ON public.tipos_eventos;
CREATE POLICY "Permitir leitura de tipos_eventos para autenticados" ON public.tipos_eventos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Permitir gerenciamento de tipos_eventos para admins" ON public.tipos_eventos;
CREATE POLICY "Permitir gerenciamento de tipos_eventos para admins" ON public.tipos_eventos
  FOR ALL TO authenticated USING ((( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::user_role, 'admin'::user_role])));

-- servidores_eventos
ALTER TABLE public.servidores_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view relevant servant events" ON public.servidores_eventos;
CREATE POLICY "Users can view relevant servant events" ON public.servidores_eventos
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.servidores s
      WHERE s.id = servidores_eventos.servidor_id
    )
  );

DROP POLICY IF EXISTS "Coordinators and Admins can manage relevant servant events" ON public.servidores_eventos;
CREATE POLICY "Coordinators and Admins can manage relevant servant events" ON public.servidores_eventos
  FOR ALL TO authenticated USING (
    ((( SELECT get_my_role() AS get_my_role) = 'super_admin'::user_role)) OR
    (
      (( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['admin'::user_role, 'coordenador'::user_role])) AND
      EXISTS (
        SELECT 1 FROM public.servidores s
        WHERE s.id = servidores_eventos.servidor_id AND (
          (EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.acesso_todas_unidades = true OR p.acesso_todos_setores = true))) OR
          (s.unidade_id IN ( SELECT profile_unidades.unidade_id FROM profile_unidades WHERE (profile_unidades.profile_id = ( SELECT auth.uid() AS uid)))) OR 
          (s.setor_id IN ( SELECT profile_setores.setor_id FROM profile_setores WHERE (profile_setores.profile_id = ( SELECT auth.uid() AS uid))))
        )
      )
    )
  );

-- =========================================================================
-- 5. GRANTS FOR REST API
-- =========================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tipos_eventos TO authenticated, service_role;
GRANT SELECT ON public.tipos_eventos TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.servidores_eventos TO authenticated, service_role;
GRANT SELECT ON public.servidores_eventos TO anon;
