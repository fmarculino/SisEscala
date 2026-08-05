-- Migration: Add Justificativas de Eventos module schema, tables, RPCs, and default configurations
-- Description: Creates tables for justificativas_padrao, justificativas_eventos, justificativas_assinaturas, RPC functions, RLS policies, and global settings.

-- 1. TABELA DE JUSTIFICATIVAS PADRÃO (TEMPLATES DO COORDENADOR)
CREATE TABLE IF NOT EXISTS public.justificativas_padrao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unidade_id UUID REFERENCES public.unidades(id) ON DELETE CASCADE,  -- NULL = global
    setor_id UUID REFERENCES public.setores(id) ON DELETE SET NULL,    -- NULL = todos setores
    titulo TEXT NOT NULL,
    texto TEXT NOT NULL,
    categoria TEXT NULL CHECK (categoria IS NULL OR categoria IN ('Extra', 'Plantão', 'Sobreaviso')),
    ativo BOOLEAN DEFAULT true,
    criado_por_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. TABELA DE REGISTROS DE JUSTIFICATIVAS DE EVENTOS
CREATE TABLE IF NOT EXISTS public.justificativas_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escala_diaria_id UUID REFERENCES public.escala_diaria(id) ON DELETE CASCADE,
    servidor_id UUID REFERENCES public.servidores(id) ON DELETE CASCADE,
    escala_mensal_id UUID REFERENCES public.escala_mensal(id) ON DELETE CASCADE,
    unidade_id UUID REFERENCES public.unidades(id),
    setor_id UUID REFERENCES public.setores(id),
    dia INTEGER NOT NULL CHECK (dia BETWEEN 1 AND 31),
    mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    ano INTEGER NOT NULL CHECK (ano BETWEEN 2020 AND 2100),
    categoria TEXT NOT NULL,
    justificativa_padrao_id UUID REFERENCES public.justificativas_padrao(id) ON DELETE SET NULL,
    texto_justificativa TEXT NOT NULL,
    
    -- Origem e fluxo de aprovação/validação
    origem TEXT NOT NULL DEFAULT 'coordenador' CHECK (origem IN ('coordenador', 'servidor')),
    status TEXT NOT NULL DEFAULT 'aprovada' CHECK (status IN ('sugestao_pendente', 'aprovada', 'rejeitada')),
    
    registrado_por_id UUID REFERENCES public.profiles(id),
    registrado_por_nome TEXT,
    validado_por_id UUID REFERENCES public.profiles(id),
    validado_por_nome TEXT,
    data_validacao TIMESTAMPTZ,
    motivo_rejeicao TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraint de unicidade por servidor + dia + mês + ano + categoria
    CONSTRAINT uq_justificativa_evento UNIQUE (servidor_id, dia, mes, ano, categoria)
);

-- 3. TABELA DE REGISTRO DE ASSINATURAS E INTEGRIDADE
CREATE TABLE IF NOT EXISTS public.justificativas_assinaturas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relatorio_tipo TEXT NOT NULL CHECK (relatorio_tipo IN ('individual', 'mensal')),
    servidor_id UUID REFERENCES public.servidores(id),
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    modo_assinatura TEXT NOT NULL CHECK (modo_assinatura IN ('a1', 'govbr', 'manual', 'mista')),
    hash_sha256 TEXT NOT NULL,
    a1_nome_certificado TEXT,
    a1_emissor TEXT,
    a1_validade TIMESTAMPTZ,
    a1_assinado_em TIMESTAMPTZ,
    govbr_referencia TEXT,
    manual_impresso_em TIMESTAMPTZ,
    assinado_por_id UUID REFERENCES public.profiles(id),
    assinado_por_nome TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. CONFIGURAÇÕES GLOBAIS PADRÃO
INSERT INTO public.configuracoes_globais (chave, valor) VALUES
    ('justificativa_prazo_dias_uteis', '3'),
    ('justificativa_servidor_visualizar', 'true'),
    ('justificativa_obrigatoria_fechar_escala', 'true')
ON CONFLICT (chave) DO NOTHING;

-- 5. ÍNDICES DE PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_justificativas_eventos_busca 
    ON public.justificativas_eventos (unidade_id, setor_id, mes, ano, categoria);
CREATE INDEX IF NOT EXISTS idx_justificativas_eventos_servidor 
    ON public.justificativas_eventos (servidor_id, mes, ano);
CREATE INDEX IF NOT EXISTS idx_justificativas_padrao_unidade 
    ON public.justificativas_padrao (unidade_id, setor_id, categoria);

-- 6. RPC: LISTAR EVENTOS PENDENTES DE JUSTIFICATIVA
CREATE OR REPLACE FUNCTION public.fn_listar_eventos_pendentes_justificativa(
    p_unidade_id UUID DEFAULT NULL,
    p_setor_id UUID DEFAULT NULL,
    p_mes INT DEFAULT NULL,
    p_ano INT DEFAULT NULL,
    p_categoria TEXT DEFAULT 'todos',
    p_status TEXT DEFAULT 'todos',
    p_page INT DEFAULT 1,
    p_per_page INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_offset INT;
    v_total INT;
    v_justificados INT;
    v_pendentes INT;
    v_sugestoes INT;
    v_result JSONB;
BEGIN
    v_offset := (p_page - 1) * p_per_page;

    WITH eventos AS (
        SELECT 
            ed.id AS escala_diaria_id,
            ed.escala_mensal_id,
            em.servidor_id,
            s.nome AS servidor_nome,
            s.matricula AS servidor_matricula,
            ed.dia,
            em.mes,
            em.ano,
            ed.categoria::text AS categoria,
            ed.dicionario_turnos_id,
            COALESCE(dt.codigo, '—') AS turno_codigo,
            em.unidade_id,
            em.setor_id,
            u.nome AS unidade_nome,
            ds.nome AS setor_nome,
            je.id AS justificativa_id,
            je.texto_justificativa,
            je.origem AS justificativa_origem,
            COALESCE(je.status, 'pendente') AS justificativa_status,
            je.registrado_por_nome,
            je.created_at AS justificativa_created_at
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.servidores s ON em.servidor_id = s.id
        LEFT JOIN public.unidades u ON em.unidade_id = u.id
        LEFT JOIN public.setores st ON em.setor_id = st.id
        LEFT JOIN public.dicionario_setores ds ON st.dicionario_setores_id = ds.id
        LEFT JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        LEFT JOIN public.justificativas_eventos je 
            ON je.servidor_id = em.servidor_id 
           AND je.dia = ed.dia 
           AND je.mes = em.mes 
           AND je.ano = em.ano 
           AND (je.categoria = ed.categoria::text OR LOWER(je.categoria) = LOWER(ed.categoria::text))
        WHERE (p_unidade_id IS NULL OR em.unidade_id = p_unidade_id)
          AND (p_setor_id IS NULL OR em.setor_id = p_setor_id)
          AND (p_mes IS NULL OR em.mes = p_mes)
          AND (p_ano IS NULL OR em.ano = p_ano)
          AND (
              ed.categoria::text IN ('Extra', 'Plantão', 'Sobreaviso', 'Plantao', 'EXTRA', 'PLANTAO', 'SOBREAVISO')
              OR LOWER(ed.categoria::text) IN ('extra', 'plantão', 'plantao', 'sobreaviso')
          )
          AND (p_categoria = 'todos' OR ed.categoria::text = p_categoria OR LOWER(ed.categoria::text) = LOWER(p_categoria))
    )
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE justificativa_status = 'aprovada'),
        COUNT(*) FILTER (WHERE justificativa_status = 'pendente'),
        COUNT(*) FILTER (WHERE justificativa_status = 'sugestao_pendente')
    INTO v_total, v_justificados, v_pendentes, v_sugestoes
    FROM eventos;

    WITH eventos AS (
        SELECT 
            ed.id AS escala_diaria_id,
            ed.escala_mensal_id,
            em.servidor_id,
            s.nome AS servidor_nome,
            s.matricula AS servidor_matricula,
            ed.dia,
            em.mes,
            em.ano,
            ed.categoria::text AS categoria,
            ed.dicionario_turnos_id,
            COALESCE(dt.codigo, '—') AS turno_codigo,
            em.unidade_id,
            em.setor_id,
            u.nome AS unidade_nome,
            ds.nome AS setor_nome,
            je.id AS justificativa_id,
            je.texto_justificativa,
            je.origem AS justificativa_origem,
            COALESCE(je.status, 'pendente') AS justificativa_status,
            je.registrado_por_nome,
            je.created_at AS justificativa_created_at
        FROM public.escala_diaria ed
        JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
        JOIN public.servidores s ON em.servidor_id = s.id
        LEFT JOIN public.unidades u ON em.unidade_id = u.id
        LEFT JOIN public.setores st ON em.setor_id = st.id
        LEFT JOIN public.dicionario_setores ds ON st.dicionario_setores_id = ds.id
        LEFT JOIN public.dicionario_turnos dt ON ed.dicionario_turnos_id = dt.id
        LEFT JOIN public.justificativas_eventos je 
            ON je.servidor_id = em.servidor_id 
           AND je.dia = ed.dia 
           AND je.mes = em.mes 
           AND je.ano = em.ano 
           AND (je.categoria = ed.categoria::text OR LOWER(je.categoria) = LOWER(ed.categoria::text))
        WHERE (p_unidade_id IS NULL OR em.unidade_id = p_unidade_id)
          AND (p_setor_id IS NULL OR em.setor_id = p_setor_id)
          AND (p_mes IS NULL OR em.mes = p_mes)
          AND (p_ano IS NULL OR em.ano = p_ano)
          AND (
              ed.categoria::text IN ('Extra', 'Plantão', 'Sobreaviso', 'Plantao', 'EXTRA', 'PLANTAO', 'SOBREAVISO')
              OR LOWER(ed.categoria::text) IN ('extra', 'plantão', 'plantao', 'sobreaviso')
          )
          AND (p_categoria = 'todos' OR ed.categoria::text = p_categoria OR LOWER(ed.categoria::text) = LOWER(p_categoria))
          AND (
              p_status = 'todos' 
              OR (p_status = 'pendentes' AND COALESCE(je.status, 'pendente') = 'pendente')
              OR (p_status = 'preenchidas' AND je.status = 'aprovada')
              OR (p_status = 'sugestoes' AND je.status = 'sugestao_pendente')
          )
        ORDER BY ed.dia ASC, s.nome ASC
        LIMIT p_per_page OFFSET v_offset
    )
    SELECT jsonb_build_object(
        'total', v_total,
        'justificados', v_justificados,
        'pendentes', v_pendentes,
        'sugestoes', v_sugestoes,
        'page', p_page,
        'per_page', p_per_page,
        'items', COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
    ) INTO v_result
    FROM eventos e;

    RETURN v_result;
END;
$$;

-- 7. RPC: CONTAR PENDÊNCIAS DE JUSTIFICATIVA (PARA BLOQUEIO DE ESCALA)
CREATE OR REPLACE FUNCTION public.fn_contar_pendencias_justificativa(
    p_unidade_id UUID,
    p_setor_id UUID,
    p_mes INT,
    p_ano INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON ed.escala_mensal_id = em.id
    LEFT JOIN public.justificativas_eventos je 
        ON je.servidor_id = em.servidor_id 
       AND je.dia = ed.dia 
       AND je.mes = em.mes 
       AND je.ano = em.ano 
       AND (je.categoria = ed.categoria::text OR LOWER(je.categoria) = LOWER(ed.categoria::text))
       AND je.status = 'aprovada'
    WHERE em.unidade_id = p_unidade_id
      AND em.setor_id = p_setor_id
      AND em.mes = p_mes
      AND em.ano = p_ano
      AND (
          ed.categoria::text IN ('Extra', 'Plantão', 'Sobreaviso', 'Plantao', 'EXTRA', 'PLANTAO', 'SOBREAVISO')
          OR LOWER(ed.categoria::text) IN ('extra', 'plantão', 'plantao', 'sobreaviso')
      )
      AND je.id IS NULL;

    RETURN v_count;
END;
$$;

-- 8. RPC: SALVAR JUSTIFICATIVA INDIVIDUAL (COORDENADOR)
CREATE OR REPLACE FUNCTION public.fn_salvar_justificativa_evento(
    p_escala_diaria_id UUID,
    p_servidor_id UUID,
    p_escala_mensal_id UUID,
    p_dia INT,
    p_mes INT,
    p_ano INT,
    p_categoria TEXT,
    p_texto TEXT,
    p_justificativa_padrao_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_user_nome TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_unidade_id UUID;
    v_setor_id UUID;
    v_id UUID;
BEGIN
    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;

    INSERT INTO public.justificativas_eventos (
        escala_diaria_id,
        servidor_id,
        escala_mensal_id,
        unidade_id,
        setor_id,
        dia,
        mes,
        ano,
        categoria,
        justificativa_padrao_id,
        texto_justificativa,
        origem,
        status,
        registrado_por_id,
        registrado_por_nome,
        validado_por_id,
        validado_por_nome,
        data_validacao,
        updated_at
    ) VALUES (
        p_escala_diaria_id,
        p_servidor_id,
        p_escala_mensal_id,
        v_unidade_id,
        v_setor_id,
        p_dia,
        p_mes,
        p_ano,
        p_categoria,
        p_justificativa_padrao_id,
        p_texto,
        'coordenador',
        'aprovada',
        p_user_id,
        p_user_nome,
        p_user_id,
        p_user_nome,
        now(),
        now()
    )
    ON CONFLICT (servidor_id, dia, mes, ano, categoria) 
    DO UPDATE SET 
        texto_justificativa = EXCLUDED.texto_justificativa,
        justificativa_padrao_id = EXCLUDED.justificativa_padrao_id,
        status = 'aprovada',
        validado_por_id = EXCLUDED.validado_por_id,
        validado_por_nome = EXCLUDED.validado_por_nome,
        data_validacao = now(),
        updated_at = now()
    RETURNING id INTO v_id;

    INSERT INTO public.logs_sistema (acao, unidade_id, setor_id, detalhes, profile_id)
    VALUES (
        'JUSTIFICATIVA_REGISTRADA',
        v_unidade_id,
        v_setor_id,
        jsonb_build_object(
            'servidor_id', p_servidor_id,
            'dia', p_dia,
            'mes', p_mes,
            'ano', p_ano,
            'categoria', p_categoria,
            'registrado_por', p_user_nome
        ),
        p_user_id
    );

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- 9. RPC: SALVAR JUSTIFICATIVAS EM LOTE (BULK)
CREATE OR REPLACE FUNCTION public.fn_salvar_justificativas_bulk(
    p_eventos JSONB,
    p_user_id UUID DEFAULT NULL,
    p_user_nome TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item JSONB;
    v_count INT := 0;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_eventos)
    LOOP
        PERFORM public.fn_salvar_justificativa_evento(
            (v_item->>'escala_diaria_id')::uuid,
            (v_item->>'servidor_id')::uuid,
            (v_item->>'escala_mensal_id')::uuid,
            (v_item->>'dia')::int,
            (v_item->>'mes')::int,
            (v_item->>'ano')::int,
            (v_item->>'categoria')::text,
            (v_item->>'texto')::text,
            NULLIF(v_item->>'justificativa_padrao_id', '')::uuid,
            p_user_id,
            p_user_nome
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'total_processado', v_count);
END;
$$;

-- 10. RPC: SUGESTÃO DE JUSTIFICATIVA PELO SERVIDOR
CREATE OR REPLACE FUNCTION public.fn_sugerir_justificativa_servidor(
    p_servidor_id UUID,
    p_escala_diaria_id UUID,
    p_escala_mensal_id UUID,
    p_dia INT,
    p_mes INT,
    p_ano INT,
    p_categoria TEXT,
    p_texto TEXT,
    p_servidor_nome TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_unidade_id UUID;
    v_setor_id UUID;
    v_id UUID;
BEGIN
    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;

    INSERT INTO public.justificativas_eventos (
        escala_diaria_id,
        servidor_id,
        escala_mensal_id,
        unidade_id,
        setor_id,
        dia,
        mes,
        ano,
        categoria,
        texto_justificativa,
        origem,
        status,
        registrado_por_nome,
        updated_at
    ) VALUES (
        p_escala_diaria_id,
        p_servidor_id,
        p_escala_mensal_id,
        v_unidade_id,
        v_setor_id,
        p_dia,
        p_mes,
        p_ano,
        p_categoria,
        p_texto,
        'servidor',
        'sugestao_pendente',
        p_servidor_nome,
        now()
    )
    ON CONFLICT (servidor_id, dia, mes, ano, categoria) 
    DO UPDATE SET 
        texto_justificativa = EXCLUDED.texto_justificativa,
        origem = 'servidor',
        status = 'sugestao_pendente',
        registrado_por_nome = EXCLUDED.registrado_por_nome,
        updated_at = now()
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- 11. RPC: VALIDAR SUGESTÃO DO SERVIDOR (APROVAR OU REJEITAR)
CREATE OR REPLACE FUNCTION public.fn_validar_sugestao_justificativa(
    p_justificativa_id UUID,
    p_acao TEXT,              -- 'aprovar' ou 'rejeitar'
    p_texto_editado TEXT DEFAULT NULL,
    p_motivo_rejeicao TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_user_nome TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_acao = 'aprovar' THEN
        UPDATE public.justificativas_eventos
        SET status = 'aprovada',
            texto_justificativa = COALESCE(NULLIF(p_texto_editado, ''), texto_justificativa),
            validado_por_id = p_user_id,
            validado_por_nome = p_user_nome,
            data_validacao = now(),
            updated_at = now()
        WHERE id = p_justificativa_id;
    ELSIF p_acao = 'rejeitar' THEN
        UPDATE public.justificativas_eventos
        SET status = 'rejeitada',
            motivo_rejeicao = p_motivo_rejeicao,
            validado_por_id = p_user_id,
            validado_por_nome = p_user_nome,
            data_validacao = now(),
            updated_at = now()
        WHERE id = p_justificativa_id;
    ELSE
        RAISE EXCEPTION 'Ação inválida. Use aprovar ou rejeitar.';
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 12. RLS POLICIES
ALTER TABLE public.justificativas_padrao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.justificativas_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.justificativas_assinaturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura justificativas_padrao" ON public.justificativas_padrao;
CREATE POLICY "Leitura justificativas_padrao" ON public.justificativas_padrao
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Escrita justificativas_padrao" ON public.justificativas_padrao;
CREATE POLICY "Escrita justificativas_padrao" ON public.justificativas_padrao
    FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Leitura justificativas_eventos" ON public.justificativas_eventos;
CREATE POLICY "Leitura justificativas_eventos" ON public.justificativas_eventos
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Escrita justificativas_eventos" ON public.justificativas_eventos;
CREATE POLICY "Escrita justificativas_eventos" ON public.justificativas_eventos
    FOR ALL USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Leitura justificativas_assinaturas" ON public.justificativas_assinaturas;
CREATE POLICY "Leitura justificativas_assinaturas" ON public.justificativas_assinaturas
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Escrita justificativas_assinaturas" ON public.justificativas_assinaturas;
CREATE POLICY "Escrita justificativas_assinaturas" ON public.justificativas_assinaturas
    FOR ALL USING (auth.uid() IS NOT NULL);

-- 13. SEED DE TEMPLATES PADRÃO DE JUSTIFICATIVA (3 PARA CADA CATEGORIA)
INSERT INTO public.justificativas_padrao (titulo, texto, categoria, ativo)
SELECT * FROM (VALUES
    -- HORA EXTRA
    ('Demanda Emergencial / Pico de Atendimento', 'Convocação extraordinária para cobertura de alta demanda e atendimento emergencial durante período de pico assistencial.', 'Extra', true),
    ('Substituição por Afastamento Médico', 'Realização de jornada extraordinária para substituição de servidor afastado por motivo de atestado médico ou licença de saúde.', 'Extra', true),
    ('Mutirão de Exames / Procedimentos', 'Execução de horas extraordinárias para mutirão assistencial visando redução da fila de espera e cumprimento de metas.', 'Extra', true),
    
    -- PLANTÃO
    ('Plantão de Reforço em Finais de Semana / Feriados', 'Cumprimento de escala de plantão presencial complementar para reforço da equipe assistencial em finais de semana ou feriados.', 'Plantão', true),
    ('Substituição de Plantonista Faltoso', 'Plantão extraordinário realizado para cobertura de ausência imprevisível de profissional plantonista, assegurando a escala mínima.', 'Plantão', true),
    ('Ações Integradas de Saúde Pública', 'Escala de plantão presencial direcionada ao atendimento em campanhas especiais de vacinação e ações integradas do município.', 'Plantão', true),
    
    -- SOBREAVISO
    ('Suporte de Prontidão à Distância', 'Permanência do servidor em regime de sobreaviso à distância para pronto atendimento a chamados de urgência do setor.', 'Sobreaviso', true),
    ('Sobreaviso Noturno e Finais de Semana', 'Disponibilidade em regime de sobreaviso durante o período noturno e finais de semana para chamados emergenciais.', 'Sobreaviso', true),
    ('Sobreaviso de Infraestrutura e TI', 'Permanência de prontidão técnica em sobreaviso para atendimento a falhas críticas de infraestrutura, logística ou sistemas.', 'Sobreaviso', true)
) AS v(titulo, texto, categoria, ativo)
WHERE NOT EXISTS (
    SELECT 1 FROM public.justificativas_padrao WHERE titulo = v.titulo
);
