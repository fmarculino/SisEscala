-- Migration: painel de sobreaviso do dashboard volta a ser global para todo papel interno
-- Data: 2026-08-12
--
-- MOTIVACAO
--   Regra ja documentada e deliberada (20260808190000, plano da Fase 5 de acionamento de
--   sobreaviso): "VER e global; ACIONAR e por abrangencia" - o card "Sobreaviso Hoje" do
--   dashboard precisa mostrar quem esta de sobreaviso em QUALQUER unidade/setor pra QUALQUER
--   usuario interno, mesmo que ele so possa ACIONAR os que sao da propria unidade (ou 'geral').
--
--   fn_painel_sobreaviso_dia (20260808190000) e fn_pode_acionar_sobreaviso (20260808180000) tem
--   cada uma um guard de papel escrito como ALLOWLIST fixa
--   (super_admin/admin/coordenador) - as duas foram escritas em 08/08/2026, ANTES de 'rh'
--   existir (20260811130000, 11/08) e de 'rh_unidade' existir (20260812060000, hoje). Confirmado
--   pelo usuario testando um perfil RH da Unidade: o card veio vazio ("Nenhum servidor escalado
--   para sobreaviso hoje"), mesmo com sobreaviso geral ativo naquele exato momento - a mesma
--   classe de lacuna ja corrigida nesta sessao em outras policies (busque por
--   `= ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])` ao criar um papel novo, ver
--   nota no CLAUDE.md).
--
-- CORRECAO
--   1) fn_painel_sobreaviso_dia: guard vira DENYLIST (barra so 'servidor'/'comum', os dois
--      papeis do Portal, que nao usam este dashboard) em vez de allowlist - assim um papel
--      interno novo nao reabre este mesmo buraco da proxima vez. Nao muda o que a funcao
--      DEVOLVE (continua sem telefone, continua so' do dia) - so' quem pode CHAMAR ela.
--   2) fn_pode_acionar_sobreaviso: acrescenta 'rh' e 'rh_unidade' ao lado de admin/coordenador -
--      mesma decisao de paridade com admin/coordenador ja assumida e registrada em
--      docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md pro resto de escala/folha de
--      ponto. 'ass_adm' deliberadamente NAO entra aqui - continua so' vendo (denylist acima ja
--      cobre isso), nao acionando; nao foi pedido e e' uma decisao de autoridade maior que
--      visibilidade.
--
-- IDEMPOTENTE: CREATE OR REPLACE, corpo copiado integralmente da versao vigente
-- (20260808190000/20260808180000, unicas definicoes de cada uma) com so' o guard de papel
-- trocado - mesma disciplina do CLAUDE.md, armadilha 1. Seguro rodar nos dois ambientes
-- (armadilha 3).


-- ============================================================================
-- 1. fn_painel_sobreaviso_dia - guard vira denylist
-- ============================================================================

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
    -- Denylist (so' barra os dois papeis do Portal do Servidor) em vez de allowlist: "ver e'
    -- global" vale pra todo papel interno, e um papel novo (ex.: rh_unidade, 12/08/2026) nao
    -- pode precisar de outra migration so' pra aparecer aqui de novo.
    SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();

    IF v_role IS NULL OR v_role IN ('servidor'::public.user_role, 'comum'::public.user_role) THEN
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

    -- quantos ACIONAMENTOS de verdade houve no dia (ver 20260808190000 para a auditoria que
    -- justifica o filtro de artefato de presenca).
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
'Painel de sobreaviso de ontem+hoje da secretaria inteira, para qualquer papel interno (todo
role exceto servidor/comum, que sao do Portal). VER e global; ACIONAR continua passando por
fn_pode_acionar_sobreaviso - e e esta funcao que devolve pode_acionar/motivo_bloqueio, para o
frontend nao recalcular a regra. Nao devolve telefone de proposito.';

GRANT EXECUTE ON FUNCTION public.fn_painel_sobreaviso_dia(timestamp with time zone) TO authenticated;


-- ============================================================================
-- 2. fn_pode_acionar_sobreaviso - rh/rh_unidade ganham a mesma capacidade de admin/coordenador
-- ============================================================================
-- Mesma decisao de paridade ja assumida (e nao contestada) pro resto de escala/folha de ponto
-- em 20260812070000/docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md. 'ass_adm'
-- deliberadamente NAO entra - continua so' vendo (item 1 acima ja cobre isso), nao acionando;
-- nao foi pedido, e' decisao de autoridade maior que so' visibilidade.

CREATE OR REPLACE FUNCTION public.fn_pode_acionar_sobreaviso(p_escala_mensal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.escala_mensal em
          JOIN public.setores  s ON s.id = em.setor_id
          JOIN public.profiles p ON p.id = auth.uid()
         WHERE em.id = p_escala_mensal_id
           AND (
                p.role = 'super_admin'::public.user_role
             OR p.role = 'rh'::public.user_role
             OR (
                    p.role IN ('admin'::public.user_role, 'coordenador'::public.user_role, 'rh_unidade'::public.user_role)
                AND (
                     -- a porta nova: sobreaviso que atende a rede inteira
                     s.sobreaviso_abrangencia = 'geral'
                     -- e o escopo de sempre, identico ao da policy da tabela
                  OR COALESCE(p.acesso_todas_unidades, false)
                  OR COALESCE(p.acesso_todos_setores, false)
                  OR EXISTS (
                        SELECT 1 FROM public.profile_setores ps
                         WHERE ps.profile_id = p.id AND ps.setor_id = em.setor_id
                     )
                  OR EXISTS (
                        SELECT 1 FROM public.profile_unidades pu
                         WHERE pu.profile_id = p.id AND pu.unidade_id = em.unidade_id
                     )
                )
             )
           )
    )
$$;

COMMENT ON FUNCTION public.fn_pode_acionar_sobreaviso(uuid) IS
'Quem pode acionar o sobreaviso desta escala. VER e global (fn_painel_sobreaviso_dia); ACIONAR
passa por aqui. rh (Geral) tem o mesmo alcance do super_admin aqui, igual ao resto de
escala/folha de ponto (20260812070000). Setor com sobreaviso_abrangencia = geral libera
admin/coordenador/rh_unidade; o resto mantem o escopo por unidade/setor que a policy da tabela
ja exigia - rh_unidade tambem aceita unidade vinculada (profile_unidades), nao so' setor.';

GRANT EXECUTE ON FUNCTION public.fn_pode_acionar_sobreaviso(uuid) TO authenticated;


-- CONFERENCIA APOS APLICAR
--
--   1) Logado como rh_unidade (ou qualquer papel que nao seja servidor/comum), o painel
--      mostra sobreaviso de QUALQUER unidade, nao so' a vinculada:
--
--   SELECT servidor_nome, unidade_nome, setor_nome, abrangencia, pode_acionar, motivo_bloqueio
--     FROM public.fn_painel_sobreaviso_dia();
--   -- esperado: linhas de fora da unidade vinculada tambem aparecem, com pode_acionar = false
--   -- (motivo_bloqueio explicando) quando a abrangencia nao for 'geral' e a unidade nao bater
--
--   2) rh_unidade vinculado a unidade de um sobreaviso 'geral' consegue acionar:
--
--   SELECT public.fn_pode_acionar_sobreaviso('<escala_mensal_id de um sobreaviso geral>');
--   -- esperado: true
