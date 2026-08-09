-- Migration: painel de sobreaviso da secretaria inteira
-- Fase 5 do plano docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
--
-- POR QUE UMA RPC E NAO AFROUXAR A RLS
--   O painel precisa mostrar TODO sobreaviso escalado da secretaria, mas afrouxar a policy de
--   logs_sobreaviso abriria junto o historico inteiro da tabela para qualquer coordenador.
--   Visibilidade operacional do dia nao e a mesma coisa que acesso ao historico.
--   Esta funcao devolve so o necessario do dia, e a RLS da tabela fica como esta.
--
-- O QUE ELA DECIDE (e o frontend NAO recalcula)
--   - a janela do plantao: fn_janela_sobreaviso_dia, a MESMA que fn_acionar_sobreaviso valida
--   - pode_acionar / motivo_bloqueio: a MESMA fn_pode_acionar_sobreaviso que a RPC de
--     acionamento aplica
--   Se o botao decidisse por conta propria, voltaria o problema que o portao de conferencia
--   existe para evitar: habilitar por uma regra e gravar por outra.
--
-- O QUE ELA NAO DEVOLVE
--   Telefone. O painel passa a ser global, e mandar o telefone de todo servidor de sobreaviso
--   da secretaria para todo coordenador nao e necessario: quem envia o WhatsApp e uma server
--   action, que resolve o telefone no backend a partir do log_id.

CREATE OR REPLACE FUNCTION public.fn_painel_sobreaviso_dia(
    p_referencia timestamp with time zone DEFAULT now()
)
RETURNS TABLE (
    escala_diaria_id      uuid,
    escala_mensal_id      uuid,
    servidor_id           uuid,
    servidor_nome         text,
    dia                   integer,
    mes                   integer,
    ano                   integer,
    unidade_id            uuid,
    unidade_nome          text,
    setor_id              uuid,
    setor_nome            text,
    turno_codigo          text,
    turno_horas           numeric,
    abrangencia           text,
    janela_inicio         timestamp with time zone,
    janela_fim            timestamp with time zone,
    janela_inicio_local   timestamp,
    janela_fim_local      timestamp,
    ativo_agora           boolean,
    log_id                uuid,
    log_status            text,
    log_token             uuid,
    log_motivo            text,
    log_acionado_em       timestamp with time zone,
    log_acionado_por      text,
    log_destino_unidade   text,
    log_destino_setor     text,
    log_destino_referencia text,
    chamados_no_dia       integer,
    pode_acionar          boolean,
    motivo_bloqueio       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role public.user_role;
    v_tz   text;
    v_hoje date;
BEGIN
    -- Guard de papel. Sem isto a funcao seria uma porta lateral para ler a escala inteira.
    SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();

    IF v_role IS NULL OR v_role NOT IN ('super_admin'::public.user_role,
                                        'admin'::public.user_role,
                                        'coordenador'::public.user_role) THEN
        RETURN;
    END IF;

    SELECT (valor#>>'{}')::text INTO v_tz
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    IF v_tz IS NULL THEN v_tz := 'America/Sao_Paulo'; END IF;

    v_hoje := (p_referencia AT TIME ZONE v_tz)::date;

    RETURN QUERY
    SELECT
        ed.id,
        em.id,
        em.servidor_id,
        s.nome::text,
        ed.dia,
        em.mes,
        em.ano,
        em.unidade_id,
        u.nome::text,
        em.setor_id,
        ds.nome::text,
        dt.codigo::text,
        dt.horas_computadas::numeric,
        COALESCE(sec.sobreaviso_abrangencia, 'unidade')::text,
        j.inicio,
        j.fim,
        j.inicio_local,
        j.fim_local,
        (p_referencia >= j.inicio AND p_referencia < j.fim),
        ul.id,
        ul.status::text,
        ul.token_magic_link,
        ul.motivo_acionamento,
        ul.data_hora_acionamento,
        ul.acionador_nome,
        ul.destino_unidade,
        ul.destino_setor,
        ul.destino_referencia,
        COALESCE(cnt.total, 0)::integer,
        -- pode_acionar / motivo_bloqueio: a ordem espelha a ordem de validacao de
        -- fn_acionar_sobreaviso, para que a mensagem do botao seja a mesma que o banco daria.
        CASE
            WHEN NOT public.fn_pode_acionar_sobreaviso(em.id)      THEN false
            WHEN NOT (p_referencia >= j.inicio AND p_referencia < j.fim) THEN false
            WHEN ul.status::text IN ('Aguardando', 'Aceito')             THEN false
            ELSE true
        END,
        CASE
            WHEN NOT public.fn_pode_acionar_sobreaviso(em.id)
                THEN 'Sobreaviso restrito a ' || u.nome || '. Fale com o coordenador responsavel.'
            WHEN p_referencia < j.inicio
                THEN 'Disponivel a partir de ' || to_char(j.inicio_local, 'DD/MM HH24:MI') || '.'
            WHEN p_referencia >= j.fim
                THEN 'Plantao encerrado.'
            WHEN ul.status::text IN ('Aguardando', 'Aceito')
                THEN 'Ja acionado por ' || COALESCE(ul.acionador_nome, 'nao identificado')
                     || ' para ' || COALESCE(ul.destino_unidade, 'destino nao informado')
                     || '. Aguarde a chegada no local.'
            ELSE NULL
        END
    FROM public.escala_diaria ed
    JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
    JOIN public.servidores s     ON s.id  = em.servidor_id
    JOIN public.unidades  u      ON u.id  = em.unidade_id
    JOIN public.dicionario_turnos dt ON dt.id = ed.dicionario_turnos_id
    LEFT JOIN public.setores sec ON sec.id = em.setor_id
    LEFT JOIN public.dicionario_setores ds ON ds.id = sec.dicionario_setor_id
    CROSS JOIN LATERAL public.fn_janela_sobreaviso_dia(ed.id) j

    -- ultimo registro do dia para aquele servidor
    LEFT JOIN LATERAL (
        SELECT l.id, l.status, l.token_magic_link, l.motivo_acionamento,
               l.data_hora_acionamento, l.destino_referencia,
               pr.full_name::text AS acionador_nome,
               du.nome::text      AS destino_unidade,
               dsd.nome::text     AS destino_setor
          FROM public.logs_sobreaviso l
          LEFT JOIN public.profiles pr ON pr.id = l.acionado_por
          LEFT JOIN public.unidades du ON du.id = l.destino_unidade_id
          LEFT JOIN public.setores  dss ON dss.id = l.destino_setor_id
          LEFT JOIN public.dicionario_setores dsd ON dsd.id = dss.dicionario_setor_id
         WHERE l.servidor_id = em.servidor_id
           AND l.escala_mensal_id = em.id
           AND l.dia = ed.dia
           AND (l.categoria = 'Sobreaviso' OR l.categoria IS NULL)
         ORDER BY l.created_at DESC
         LIMIT 1
    ) ul ON true

    -- quantos ACIONAMENTOS de verdade houve no dia.
    -- Conferido em producao em 08/08/2026: das 522 linhas de logs_sobreaviso, 509 sao
    -- artefatos de validacao de presenca (o terminal e a grade tambem escrevem aqui) e apenas
    -- 13 sao acionamentos. Contar tudo faria o painel anunciar "5 chamados" onde houve um.
    LEFT JOIN LATERAL (
        SELECT count(*)::integer AS total
          FROM public.logs_sobreaviso l2
         WHERE l2.servidor_id = em.servidor_id
           AND l2.escala_mensal_id = em.id
           AND l2.dia = ed.dia
           AND (l2.categoria = 'Sobreaviso' OR l2.categoria IS NULL)
           AND (
                l2.acionado_por IS NOT NULL
             OR NOT (
                    COALESCE(l2.motivo_acionamento, '') ILIKE 'O próprio usuário confirmou%'
                 OR COALESCE(l2.motivo_acionamento, '') ILIKE 'Validação Manual%'
                 OR COALESCE(l2.motivo_acionamento, '') ILIKE 'REVERSÃO%'
                )
           )
    ) cnt ON true

    WHERE ed.categoria = 'Sobreaviso'::public.escala_categoria
      -- ontem e hoje: pega o plantao noturno que comecou ontem e ainda esta correndo.
      -- make_date resolve virada de mes e de ano sozinho.
      AND make_date(em.ano, em.mes, ed.dia) BETWEEN (v_hoje - 1) AND v_hoje
      -- ja encerrado nao aparece (mesmo criterio do painel atual)
      AND p_referencia < j.fim
    ORDER BY
        (p_referencia >= j.inicio AND p_referencia < j.fim) DESC,
        j.inicio ASC,
        s.nome ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_painel_sobreaviso_dia(timestamp with time zone) IS
'Painel de sobreaviso de ontem+hoje da secretaria inteira, para qualquer coordenador/admin.
VER e global; ACIONAR continua passando por fn_pode_acionar_sobreaviso - e e esta funcao que
devolve pode_acionar/motivo_bloqueio, para o frontend nao recalcular a regra. Nao devolve
telefone de proposito.';

GRANT EXECUTE ON FUNCTION public.fn_painel_sobreaviso_dia(timestamp with time zone) TO authenticated;

-- ---------------------------------------------------------------------------
-- Telefone do acionado, so para quem pode acionar
-- ---------------------------------------------------------------------------
-- Usada pela server action que dispara o WhatsApp. Devolve o telefone de UM chamado
-- especifico, e so se quem pediu poderia ter acionado aquele sobreaviso.
CREATE OR REPLACE FUNCTION public.fn_contato_acionamento_sobreaviso(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v jsonb;
BEGIN
    SELECT jsonb_build_object(
             'servidor_nome', s.nome,
             'telefone', s.telefone,
             'token', l.token_magic_link,
             'motivo', l.motivo_acionamento,
             'destino_unidade', du.nome,
             'destino_setor', dsd.nome,
             'destino_referencia', l.destino_referencia,
             'unidade_origem_id', l.unidade_id
           )
      INTO v
      FROM public.logs_sobreaviso l
      JOIN public.servidores s ON s.id = l.servidor_id
      LEFT JOIN public.unidades du ON du.id = l.destino_unidade_id
      LEFT JOIN public.setores  dss ON dss.id = l.destino_setor_id
      LEFT JOIN public.dicionario_setores dsd ON dsd.id = dss.dicionario_setor_id
     WHERE l.id = p_log_id
       AND public.fn_pode_acionar_sobreaviso(l.escala_mensal_id);

    IF v IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Chamado nao encontrado ou sem permissao.');
    END IF;

    RETURN v || jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.fn_contato_acionamento_sobreaviso(uuid) IS
'Telefone e dados de UM chamado, para a server action montar a mensagem de WhatsApp no
servidor. Existe para que fn_painel_sobreaviso_dia nao precise devolver telefone de toda a
secretaria para todo coordenador.';

GRANT EXECUTE ON FUNCTION public.fn_contato_acionamento_sobreaviso(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- CONFERENCIA (rodar depois de aplicar)
-- ---------------------------------------------------------------------------
--   -- 1) como coordenador restrito, o painel tem de mostrar sobreaviso de outros setores:
--   SELECT servidor_nome, unidade_nome, setor_nome, turno_codigo,
--          to_char(janela_inicio_local,'DD/MM HH24:MI') AS inicio,
--          to_char(janela_fim_local,   'DD/MM HH24:MI') AS fim,
--          ativo_agora, pode_acionar, motivo_bloqueio
--     FROM public.fn_painel_sobreaviso_dia();
--
--   -- 2) o mesmo dia visto do passado, para conferir a janela do plantao noturno:
--   SELECT * FROM public.fn_painel_sobreaviso_dia('2026-08-08 23:00-03'::timestamptz);
--
--   -- 3) chamados_no_dia NAO pode contar artefato de presenca. Comparar com:
--   SELECT count(*) FROM public.logs_sobreaviso
--    WHERE motivo_acionamento ILIKE 'Validação Manual%'
--       OR motivo_acionamento ILIKE 'O próprio usuário confirmou%';
--   -- em producao, 08/08/2026: 509 de 522 linhas sao artefato.
