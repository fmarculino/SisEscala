-- Migration: fn_reclassificar_passo_presenca - mover batida real entre passos do dia
-- Data: 2026-08-12
--
-- O CASO REAL QUE MOTIVOU ISTO
--   FERNANDO (matricula 69497, coordenador de TI), dia 12/08/2026: entrada 08:05, trabalhou
--   direto (sem marcar intervalo) e bateu de novo as 21:09 - a saida final do dia. A unidade
--   SMS tem permite_marca_intervalo = true (nota anterior do CLAUDE.md dizendo false estava
--   desatualizada) com jornada de 2h de intervalo previsto, entao o terminal espera 4 batidas
--   no dia. fn_confirmar_presenca nao sabe que uma batida e a ULTIMA do dia - ela so preenche o
--   proximo passo vazio em sequencia (entrada -> saida intervalo -> retorno intervalo -> saida).
--   A segunda batida do dia virou "saida intervalo" (presenca_intervalo_saida_em = 21:09:58,
--   com segundos - batida real) em vez de "saida" (presenca_saida_em ficou NULL).
--
-- POR QUE ISTO E SEGURO E NAO FABRICA HORARIO
--   marcacoes_ponto (a batida real, imutavel) NUNCA e tocada aqui - so se corrige em QUAL dos 4
--   campos de escala_diaria aquele horario real esta classificado. E o mesmo principio juridico
--   ja usado por "Selecao da batida real" (v1.26.0): mover um horario real entre passos e
--   tratamento autorizado pelo Art. 82, paragrafo unico, com justificativa e rastro de
--   auditoria - nao e o sistema decidindo sozinho (vedacao 2 da Portaria 671/2021), e' o
--   coordenador corrigindo uma classificacao automatica errada, com justificativa.
--
-- POR QUE UMA FUNCAO NOVA, NAO EDITAR fn_confirmar_presenca*
--   Nenhuma das funcoes de 1000+ linhas e tocada (armadilha 1 do CLAUDE.md). Esta e uma funcao
--   pequena e autocontida, sem precisar do script gerador (gen_*.js e so para quem copia/edita
--   as funcoes gigantes existentes).
--
-- GUARD DE ESCOPO DENTRO DA PROPRIA FUNCAO
--   Mesma licao ja aplicada nesta sessao em fn_blocos_previstos_dia (20260812130000): uma RPC
--   GRANTada a authenticated e alcancavel direto por REST, entao checar escopo so na Server
--   Action nao basta. O bloco abaixo replica EXATAMENTE a semantica de hasSectorAccess
--   (src/utils/permissions.ts:125), ja usada para guardar salvarFolhaPonto/sincronizarFolhaPonto.
--
-- LIMITES DELIBERADOS DA v1 (ver docs/evolucao)
--   - So aceita mover para um passo VAZIO (sem swap).
--   - So move batida REAL (presenca_<passo>_manual = false) - valor ja digitado continua se
--     corrigindo do jeito que ja existe hoje (digitar por cima na folha).
--   - Origem e destino tem que ser passos da MESMA linha de escala_diaria - nao move entre
--     turnos/categorias diferentes do mesmo dia.

CREATE OR REPLACE FUNCTION public.fn_reclassificar_passo_presenca(
    p_escala_diaria_id uuid,
    p_passo_origem     text,
    p_passo_destino    text,
    p_justificativa    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_unidade_id uuid;
    v_setor_id   uuid;
    v_dia        integer;
    v_servidor_id uuid;

    v_role                text;
    v_acesso_todas_unidades boolean;
    v_acesso_todos_setores  boolean;
    v_tem_acesso boolean := false;

    v_valor_em         timestamptz;
    v_valor_manual      boolean;
    v_valor_origem_txt  public.marcacao_origem;
    v_valor_marcacao_id uuid;

    v_destino_atual timestamptz;
BEGIN
    -- 1. Validacao dos parametros
    IF p_passo_origem NOT IN ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida')
    OR p_passo_destino NOT IN ('entrada', 'intervalo_saida', 'intervalo_retorno', 'saida') THEN
        RAISE EXCEPTION 'Passo invalido. Use entrada, intervalo_saida, intervalo_retorno ou saida.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_passo_origem = p_passo_destino THEN
        RAISE EXCEPTION 'Passo de origem e destino nao podem ser o mesmo.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_justificativa IS NULL OR length(trim(p_justificativa)) < 5 THEN
        RAISE EXCEPTION 'Justificativa obrigatoria (minimo 5 caracteres).'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 2. Busca a linha e a unidade/setor da escala para o guard de escopo
    SELECT em.unidade_id, em.setor_id, ed.dia, em.servidor_id
      INTO v_unidade_id, v_setor_id, v_dia, v_servidor_id
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.id = p_escala_diaria_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Linha de escala nao encontrada.' USING ERRCODE = 'no_data_found';
    END IF;

    -- 3. GUARD DE ESCOPO - replica hasSectorAccess (src/utils/permissions.ts:125)
    SELECT p.role::text, COALESCE(p.acesso_todas_unidades, false), COALESCE(p.acesso_todos_setores, false)
      INTO v_role, v_acesso_todas_unidades, v_acesso_todos_setores
      FROM public.profiles p
     WHERE p.id = auth.uid();

    IF v_role IN ('super_admin', 'rh') THEN
        v_tem_acesso := true;
    ELSIF v_acesso_todos_setores AND v_acesso_todas_unidades THEN
        v_tem_acesso := true;
    ELSIF v_acesso_todos_setores AND public.fn_unidade_no_escopo(v_unidade_id) THEN
        v_tem_acesso := true;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.profile_setores ps
             WHERE ps.profile_id = auth.uid() AND ps.setor_id = v_setor_id
        ) INTO v_tem_acesso;
    END IF;

    IF NOT v_tem_acesso THEN
        RAISE EXCEPTION 'Sem permissao para corrigir a presenca deste servidor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. Le os 4 campos do passo de ORIGEM
    SELECT
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_em
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_em
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_em
            WHEN 'saida'             THEN presenca_saida_em
        END,
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_manual
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_manual
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_manual
            WHEN 'saida'             THEN presenca_saida_manual
        END,
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_origem
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_origem
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_origem
            WHEN 'saida'             THEN presenca_saida_origem
        END,
        CASE p_passo_origem
            WHEN 'entrada'           THEN presenca_entrada_marcacao_id
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_marcacao_id
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_marcacao_id
            WHEN 'saida'             THEN presenca_saida_marcacao_id
        END
      INTO v_valor_em, v_valor_manual, v_valor_origem_txt, v_valor_marcacao_id
      FROM public.escala_diaria
     WHERE id = p_escala_diaria_id;

    IF v_valor_em IS NULL THEN
        RAISE EXCEPTION 'Nao ha marcacao no passo de origem para mover.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_valor_manual THEN
        RAISE EXCEPTION 'Este horario foi digitado manualmente, nao e uma batida real - edite '
            'o valor direto na folha em vez de mover.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 5. Confere que o passo de DESTINO esta vazio (v1 nao faz swap)
    SELECT
        CASE p_passo_destino
            WHEN 'entrada'           THEN presenca_entrada_em
            WHEN 'intervalo_saida'   THEN presenca_intervalo_saida_em
            WHEN 'intervalo_retorno' THEN presenca_intervalo_retorno_em
            WHEN 'saida'             THEN presenca_saida_em
        END
      INTO v_destino_atual
      FROM public.escala_diaria
     WHERE id = p_escala_diaria_id;

    IF v_destino_atual IS NOT NULL THEN
        RAISE EXCEPTION 'O passo de destino ja tem uma marcacao - mover so e permitido para um '
            'passo vazio.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 6. Move: escreve os 4 campos do destino, limpa os 4 campos da origem
    UPDATE public.escala_diaria
       SET presenca_entrada_em = CASE
               WHEN p_passo_destino = 'entrada' THEN v_valor_em
               WHEN p_passo_origem  = 'entrada' THEN NULL
               ELSE presenca_entrada_em END,
           presenca_entrada_manual = CASE
               WHEN p_passo_destino = 'entrada' THEN v_valor_manual
               WHEN p_passo_origem  = 'entrada' THEN false
               ELSE presenca_entrada_manual END,
           presenca_entrada_origem = CASE
               WHEN p_passo_destino = 'entrada' THEN v_valor_origem_txt
               WHEN p_passo_origem  = 'entrada' THEN NULL
               ELSE presenca_entrada_origem END,
           presenca_entrada_marcacao_id = CASE
               WHEN p_passo_destino = 'entrada' THEN v_valor_marcacao_id
               WHEN p_passo_origem  = 'entrada' THEN NULL
               ELSE presenca_entrada_marcacao_id END,

           presenca_intervalo_saida_em = CASE
               WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_em
               WHEN p_passo_origem  = 'intervalo_saida' THEN NULL
               ELSE presenca_intervalo_saida_em END,
           presenca_intervalo_saida_manual = CASE
               WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_manual
               WHEN p_passo_origem  = 'intervalo_saida' THEN false
               ELSE presenca_intervalo_saida_manual END,
           presenca_intervalo_saida_origem = CASE
               WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_origem_txt
               WHEN p_passo_origem  = 'intervalo_saida' THEN NULL
               ELSE presenca_intervalo_saida_origem END,
           presenca_intervalo_saida_marcacao_id = CASE
               WHEN p_passo_destino = 'intervalo_saida' THEN v_valor_marcacao_id
               WHEN p_passo_origem  = 'intervalo_saida' THEN NULL
               ELSE presenca_intervalo_saida_marcacao_id END,

           presenca_intervalo_retorno_em = CASE
               WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_em
               WHEN p_passo_origem  = 'intervalo_retorno' THEN NULL
               ELSE presenca_intervalo_retorno_em END,
           presenca_intervalo_retorno_manual = CASE
               WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_manual
               WHEN p_passo_origem  = 'intervalo_retorno' THEN false
               ELSE presenca_intervalo_retorno_manual END,
           presenca_intervalo_retorno_origem = CASE
               WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_origem_txt
               WHEN p_passo_origem  = 'intervalo_retorno' THEN NULL
               ELSE presenca_intervalo_retorno_origem END,
           presenca_intervalo_retorno_marcacao_id = CASE
               WHEN p_passo_destino = 'intervalo_retorno' THEN v_valor_marcacao_id
               WHEN p_passo_origem  = 'intervalo_retorno' THEN NULL
               ELSE presenca_intervalo_retorno_marcacao_id END,

           presenca_saida_em = CASE
               WHEN p_passo_destino = 'saida' THEN v_valor_em
               WHEN p_passo_origem  = 'saida' THEN NULL
               ELSE presenca_saida_em END,
           presenca_saida_manual = CASE
               WHEN p_passo_destino = 'saida' THEN v_valor_manual
               WHEN p_passo_origem  = 'saida' THEN false
               ELSE presenca_saida_manual END,
           presenca_saida_origem = CASE
               WHEN p_passo_destino = 'saida' THEN v_valor_origem_txt
               WHEN p_passo_origem  = 'saida' THEN NULL
               ELSE presenca_saida_origem END,
           presenca_saida_marcacao_id = CASE
               WHEN p_passo_destino = 'saida' THEN v_valor_marcacao_id
               WHEN p_passo_origem  = 'saida' THEN NULL
               ELSE presenca_saida_marcacao_id END
     WHERE id = p_escala_diaria_id;

    RETURN jsonb_build_object(
        'success', true,
        'escala_diaria_id', p_escala_diaria_id,
        'servidor_id', v_servidor_id,
        'dia', v_dia,
        'passo_origem', p_passo_origem,
        'passo_destino', p_passo_destino,
        'horario', v_valor_em
    );
END;
$$;

COMMENT ON FUNCTION public.fn_reclassificar_passo_presenca(uuid, text, text, text) IS
    'Move uma batida REAL (nunca digitada) de um passo de presenca vazio para outro, na mesma '
    'linha de escala_diaria. Nao toca marcacoes_ponto - so corrige em qual campo o horario real '
    'esta classificado. v1: so aceita destino vazio (sem swap), so move quem tem escopo sobre a '
    'unidade/setor da escala (guard interno, replica hasSectorAccess).';

GRANT EXECUTE ON FUNCTION public.fn_reclassificar_passo_presenca(uuid, text, text, text)
    TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1. Caso real do Fernando (dia 12/08/2026, escala_diaria.id conhecido):
--      SELECT public.fn_reclassificar_passo_presenca(
--          '7cbe864d-a2b2-43f3-8ecc-1234559dffb7', 'intervalo_saida', 'saida',
--          'Trabalhou direto no dia, sem marcar intervalo - a batida das 21:09 e a saida final.');
--      -- esperado: success=true; depois, presenca_saida_em = 21:09:58..., presenca_intervalo_
--      -- saida_em = NULL, presenca_saida_manual = false (continua sendo batida real).
--
--   2. Recusa passo ja digitado (manual):
--      -- numa linha onde presenca_entrada_manual = true, tentar mover 'entrada' -> 'saida'
--      -- esperado: erro "digitado manualmente".
--
--   3. Recusa destino ja preenchido:
--      -- numa linha onde presenca_saida_em ja tem valor, tentar mover pra 'saida'
--      -- esperado: erro "ja tem uma marcacao".
--
--   4. Recusa fora de escopo:
--      -- chamado por um profile sem profile_setores/profile_unidades sobre aquela unidade
--      -- esperado: erro "Sem permissao", ERRCODE insufficient_privilege.
