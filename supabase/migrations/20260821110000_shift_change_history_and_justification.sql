-- Migration: historico e justificativa obrigatoria na troca de turno de dia ja trabalhado
--
-- PROBLEMA
--   Trocar o codigo do turno de um dia que JA TEM PONTO registrado muda o previsto contra o
--   qual aquele ponto e' julgado - hora extra, falta, saida esperada no terminal. E' o caso da
--   DOBRA: a servidora estava escalada no Plantao T (13-19), o plantonista seguinte nao
--   compareceu, o coordenador a convocou para emendar a noite e a celula vira TN (13-07).
--   O motivo dessa convocacao e' informacao de folha e de relatorio, e nao existia lugar
--   nenhum para ele: a troca era silenciosa e sem autor.
--
-- REGRA
--   Dia SEM ponto continua livre (planejamento). Dia COM ponto so troca de turno com
--   justificativa - e a regra vive no BANCO, nao so na tela: toda RPC deste sistema e'
--   GRANTeada a authenticated e pode ser chamada direto (armadilha 12 do CLAUDE.md).
--
-- MESMO PADRAO DE 20260819230000 (troca de jornada): trigger como rede de seguranca, que pega
--   QUALQUER caminho de escrita, e RPC para carregar a justificativa - a trigger sozinha nao
--   teria como receber texto. A RPC publica o texto num GUC local a transacao e a trigger o
--   consome. Um unico ponto de gravacao do historico, dois caminhos de entrada.
--
-- NENHUM CAMINHO EM MASSA E' AFETADO (medido no codigo em 21/08/2026): "Aplicar Template" nao
--   gera turno para dia protegido por presenca (generateTemplate recebe skipDays e nunca grava
--   result[dia] para eles) e o "Gerador Inteligente" pula explicitamente hasPresenceForDay.
--   O upsert do "Salvar Previsao" reenvia a mesma linha, e IS NOT DISTINCT FROM sai na hora.

-- 1. Tabela de historico
CREATE TABLE IF NOT EXISTS public.escala_diaria_turno_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escala_diaria_id UUID REFERENCES public.escala_diaria(id) ON DELETE SET NULL,
    escala_mensal_id UUID REFERENCES public.escala_mensal(id) ON DELETE CASCADE,
    servidor_id UUID,
    dia INTEGER,
    mes INTEGER,
    ano INTEGER,
    categoria TEXT,
    turno_anterior_id UUID REFERENCES public.dicionario_turnos(id) ON DELETE SET NULL,
    turno_novo_id UUID REFERENCES public.dicionario_turnos(id) ON DELETE SET NULL,
    tinha_ponto BOOLEAN NOT NULL DEFAULT false,
    justificativa TEXT,
    alterado_por UUID,
    alterado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edth_escala_mensal
    ON public.escala_diaria_turno_historico (escala_mensal_id, alterado_em DESC);
CREATE INDEX IF NOT EXISTS idx_edth_servidor_competencia
    ON public.escala_diaria_turno_historico (servidor_id, ano, mes, dia);

COMMENT ON TABLE public.escala_diaria_turno_historico IS
    'Append-only. Uma linha por troca efetiva de escala_diaria.dicionario_turnos_id. Escrita '
    'apenas pela trigger trg_registrar_troca_turno; nunca por aplicacao. tinha_ponto separa a '
    'correcao de planejamento (dia futuro) da mudanca que reescreve a premissa de um dia ja '
    'trabalhado - esta ultima exige justificativa.';

-- 2. Trigger: bloqueia sem justificativa quando o dia tem ponto, e registra sempre
CREATE OR REPLACE FUNCTION public.trg_registrar_troca_turno()
RETURNS TRIGGER AS $trg$
DECLARE
    v_justificativa TEXT;
    v_tem_ponto BOOLEAN;
    v_servidor UUID;
    v_mes INTEGER;
    v_ano INTEGER;
BEGIN
    -- So a troca efetiva interessa. O "Salvar Previsao" reenvia todas as linhas da grade.
    IF NEW.dicionario_turnos_id IS NOT DISTINCT FROM OLD.dicionario_turnos_id THEN
        RETURN NEW;
    END IF;

    -- Ponto = qualquer passo com horario gravado OU a linha confirmada pelo coordenador.
    -- Lido de OLD: e' o estado que existia ANTES desta troca.
    v_tem_ponto := OLD.presenca_entrada_em IS NOT NULL
                OR OLD.presenca_saida_em IS NOT NULL
                OR OLD.presenca_intervalo_saida_em IS NOT NULL
                OR OLD.presenca_intervalo_retorno_em IS NOT NULL
                OR COALESCE(OLD.presenca_confirmada, false);

    -- GUC local publicado por fn_alterar_turno_escala_diaria. Ausente = troca por outro caminho.
    v_justificativa := NULLIF(btrim(COALESCE(current_setting('sisescala.justificativa_turno', true), '')), '');

    IF v_tem_ponto AND v_justificativa IS NULL THEN
        RAISE EXCEPTION 'O dia % ja possui ponto registrado: a troca de turno exige justificativa.', NEW.dia
            USING HINT = 'Informe a justificativa na grade (fn_alterar_turno_escala_diaria).';
    END IF;

    SELECT em.servidor_id, em.mes, em.ano INTO v_servidor, v_mes, v_ano
    FROM public.escala_mensal em
    WHERE em.id = NEW.escala_mensal_id;

    INSERT INTO public.escala_diaria_turno_historico (
        escala_diaria_id, escala_mensal_id, servidor_id, dia, mes, ano, categoria,
        turno_anterior_id, turno_novo_id, tinha_ponto, justificativa, alterado_por
    ) VALUES (
        NEW.id, NEW.escala_mensal_id, v_servidor, NEW.dia, v_mes, v_ano, NEW.categoria::text,
        OLD.dicionario_turnos_id, NEW.dicionario_turnos_id, v_tem_ponto, v_justificativa, auth.uid()
    );

    RETURN NEW;
END;
$trg$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_registrar_troca_turno ON public.escala_diaria;
CREATE TRIGGER trg_registrar_troca_turno
    BEFORE UPDATE OF dicionario_turnos_id ON public.escala_diaria
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_registrar_troca_turno();

-- 3. RPC da troca deliberada, com justificativa
DROP FUNCTION IF EXISTS public.fn_alterar_turno_escala_diaria(uuid, integer, text, uuid, text);
CREATE OR REPLACE FUNCTION public.fn_alterar_turno_escala_diaria(
    p_escala_mensal_id UUID,
    p_dia INTEGER,
    p_categoria TEXT,
    p_dicionario_turnos_id UUID,
    p_justificativa TEXT
)
RETURNS JSONB AS $fn$
DECLARE
    v_ed_id UUID;
    v_turno_ant UUID;
    v_cod_ant TEXT;
    v_cod_novo TEXT;
    v_servidor UUID;
    v_mes INTEGER;
    v_ano INTEGER;
    v_unidade UUID;
    v_setor UUID;
    v_status TEXT;
    v_tem_ponto BOOLEAN;
    v_tz TEXT;
    v_autor TEXT;
    v_carimbo TEXT;
    v_just_id UUID;
    v_just_texto TEXT;
BEGIN
    IF p_justificativa IS NULL OR btrim(p_justificativa) = '' THEN
        RAISE EXCEPTION 'Justificativa obrigatoria para alterar o turno de um dia ja trabalhado.';
    END IF;

    IF p_dicionario_turnos_id IS NULL THEN
        RAISE EXCEPTION 'Turno de destino obrigatorio.';
    END IF;

    SELECT ed.id, ed.dicionario_turnos_id,
           (ed.presenca_entrada_em IS NOT NULL
             OR ed.presenca_saida_em IS NOT NULL
             OR ed.presenca_intervalo_saida_em IS NOT NULL
             OR ed.presenca_intervalo_retorno_em IS NOT NULL
             OR COALESCE(ed.presenca_confirmada, false)),
           em.servidor_id, em.mes, em.ano, em.unidade_id, em.setor_id, em.status
      INTO v_ed_id, v_turno_ant, v_tem_ponto, v_servidor, v_mes, v_ano, v_unidade, v_setor, v_status
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.escala_mensal_id = p_escala_mensal_id
       AND ed.dia = p_dia
       AND ed.categoria = p_categoria::public.escala_categoria;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nao existe lancamento de % no dia % desta escala.', p_categoria, p_dia;
    END IF;

    IF v_status = 'Fechada' THEN
        RAISE EXCEPTION 'Escala fechada: reabra antes de alterar o turno.';
    END IF;

    IF v_turno_ant IS NOT DISTINCT FROM p_dicionario_turnos_id THEN
        RETURN jsonb_build_object('alterado', false, 'motivo', 'o turno ja e esse');
    END IF;

    SELECT codigo INTO v_cod_ant  FROM public.dicionario_turnos WHERE id = v_turno_ant;
    SELECT codigo INTO v_cod_novo FROM public.dicionario_turnos WHERE id = p_dicionario_turnos_id;
    IF v_cod_novo IS NULL THEN
        RAISE EXCEPTION 'Turno de destino inexistente.';
    END IF;

    -- Publica a justificativa para a trigger. is_local = true: morre no fim da transacao.
    PERFORM set_config('sisescala.justificativa_turno', btrim(p_justificativa), true);

    UPDATE public.escala_diaria
       SET dicionario_turnos_id = p_dicionario_turnos_id
     WHERE id = v_ed_id;

    PERFORM set_config('sisescala.justificativa_turno', '', true);

    -- Justificativa do evento, para o relatorio de plantao. A tabela tem UMA linha por
    -- (servidor, dia, mes, ano, categoria) - uq_justificativa_evento - e no dia da dobra ja
    -- costuma existir a justificativa do plantao original. ACRESCENTA em vez de substituir:
    -- as duas coisas sao verdade e as duas precisam aparecer no relatorio.
    SELECT NULLIF((valor#>>'{}')::text, '') INTO v_tz
      FROM public.configuracoes_globais WHERE chave = 'timezone';
    v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

    SELECT full_name INTO v_autor FROM public.profiles WHERE id = auth.uid();

    v_carimbo := format('[%s - turno alterado de %s para %s por %s] %s',
        to_char(now() AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI'),
        COALESCE(v_cod_ant, '(vazio)'), v_cod_novo, COALESCE(v_autor, 'sistema'),
        btrim(p_justificativa));

    SELECT id, texto_justificativa INTO v_just_id, v_just_texto
      FROM public.justificativas_eventos
     WHERE servidor_id = v_servidor AND dia = p_dia AND mes = v_mes AND ano = v_ano
       AND categoria = p_categoria;

    IF v_just_id IS NOT NULL THEN
        UPDATE public.justificativas_eventos
           SET texto_justificativa = v_just_texto || chr(10) || chr(10) || v_carimbo,
               escala_diaria_id = v_ed_id,
               updated_at = now()
         WHERE id = v_just_id;
    ELSE
        INSERT INTO public.justificativas_eventos (
            escala_diaria_id, servidor_id, escala_mensal_id, unidade_id, setor_id,
            dia, mes, ano, categoria, texto_justificativa,
            origem, status, registrado_por_id, registrado_por_nome,
            validado_por_id, validado_por_nome, data_validacao
        ) VALUES (
            v_ed_id, v_servidor, p_escala_mensal_id, v_unidade, v_setor,
            p_dia, v_mes, v_ano, p_categoria, v_carimbo,
            'coordenador', 'aprovada', auth.uid(), v_autor,
            auth.uid(), v_autor, now()
        )
        RETURNING id INTO v_just_id;
    END IF;

    RETURN jsonb_build_object(
        'alterado', true,
        'escala_diaria_id', v_ed_id,
        'codigo_anterior', v_cod_ant,
        'codigo_novo', v_cod_novo,
        'tinha_ponto', v_tem_ponto,
        'justificativa_evento_id', v_just_id
    );
END;
$fn$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;

COMMENT ON FUNCTION public.fn_alterar_turno_escala_diaria(uuid, integer, text, uuid, text) IS
    'Troca o turno de uma celula da grade carregando a justificativa. Unico caminho capaz de '
    'trocar turno de dia que ja tem ponto - a trigger recusa qualquer outro. A justificativa e '
    'ACRESCENTADA a justificativa do evento daquele dia (justificativas_eventos), que e o que o '
    'relatorio de plantao imprime. SECURITY INVOKER de proposito: a RLS de escala_diaria e de '
    'justificativas_eventos decide quem pode alterar.';

GRANT EXECUTE ON FUNCTION public.fn_alterar_turno_escala_diaria(uuid, integer, text, uuid, text) TO authenticated;

-- 4. RLS do historico: leitura para papeis de gestao, escrita so pela trigger.
-- Denylist, nao allowlist: fn_painel_sobreaviso_dia nasceu com allowlist de papel e deixou
-- 'rh' e 'rh_unidade' de fora por meses.
ALTER TABLE public.escala_diaria_turno_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestao le historico de turno" ON public.escala_diaria_turno_historico;
CREATE POLICY "Gestao le historico de turno"
ON public.escala_diaria_turno_historico
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role NOT IN ('servidor', 'comum')
    )
);

GRANT SELECT ON public.escala_diaria_turno_historico TO authenticated;

-- 5. Conferencia
-- SELECT h.alterado_em, s.nome, h.dia, h.categoria, ta.codigo AS de, tn.codigo AS para,
--        h.tinha_ponto, h.justificativa
--   FROM public.escala_diaria_turno_historico h
--   LEFT JOIN public.servidores s ON s.id = h.servidor_id
--   LEFT JOIN public.dicionario_turnos ta ON ta.id = h.turno_anterior_id
--   LEFT JOIN public.dicionario_turnos tn ON tn.id = h.turno_novo_id
--  ORDER BY h.alterado_em DESC LIMIT 50;
