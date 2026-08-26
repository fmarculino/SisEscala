-- ============================================================================
-- Relogio novo herda as excecoes de ponto de quem e' excecao em TODOS os outros
-- (25/08/2026)
-- ============================================================================
--
-- MOTIVACAO. `rep_excecoes_ponto` (20260820030000) impede que a batida de quem administra o
-- parque vire ponto: essa pessoa precisa estar cadastrada em TODOS os equipamentos para
-- configura-los e cadastrar os outros administradores, e desde 17-18/08/2026 a identidade
-- resolve direto por CPF/PIS - basta estar cadastrada para a batida ganhar dono (CLAUDE.md,
-- armadilha 13). Caso real medido: o teste de biometria no relogio do CEI, em 15/08/2026, virou
-- a ENTRADA do plantao do administrador na folha.
--
-- ⚠️ O comentario do seed daquela migration dizia "feito por SELECT ... para que todo relogio
-- novo tambem entre". A INTENCAO era essa; o efeito nao. Um INSERT roda uma vez: ele alcancou os
-- equipamentos que existiam em 20/08/2026 e nenhum dos criados depois. Numa unidade que vai
-- ganhar o segundo, o terceiro e o quarto relogio, isso significa que **cada relogio novo volta
-- a converter em ponto o teste de quem o esta instalando** - em silencio, e descoberto so quando
-- alguem estranha a folha.
--
-- O QUE ESTA MIGRATION FAZ. Um gatilho AFTER INSERT em dispositivos_rep que copia para o
-- equipamento novo as excecoes de quem hoje e' excecao em **todos** os demais.
--
-- ⚠️ "Em todos os demais" nao e' detalhe: e' o que distingue quem administra o parque de quem
-- tem uma excecao pontual num relogio so' (alguem que passa na frente de um equipamento que nao
-- e o dele). Copiar excecao pontual para um relogio novo apagaria ponto legitimo - o erro na
-- direcao contraria, e o unico caro dos dois.
--
-- Nao mexe em nada ja gravado: excecao age na ATRIBUICAO, e o gatilho so' vale para INSERT.
--
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS antes do CREATE TRIGGER. O backfill
-- do fim tambem e' idempotente (ON CONFLICT DO NOTHING).

CREATE OR REPLACE FUNCTION public.fn_herdar_excecoes_ponto_dispositivo_novo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_outros integer;
BEGIN
    SELECT count(*) INTO v_outros
      FROM public.dispositivos_rep d
     WHERE d.id <> NEW.id;

    -- Primeiro relogio do sistema: nao ha de quem herdar, e "excecao em todos os demais" com
    -- zero demais seria verdadeiro para todo mundo (count = 0 = 0). Sair aqui e' o que impede
    -- essa armadilha de conjunto vazio.
    IF v_outros = 0 THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.rep_excecoes_ponto (servidor_id, dispositivo_id, motivo)
    SELECT e.servidor_id,
           NEW.id,
           'Herdada ao cadastrar este relogio: ja era excecao em todos os equipamentos anteriores'
      FROM public.rep_excecoes_ponto e
     WHERE e.dispositivo_id <> NEW.id
     GROUP BY e.servidor_id
    HAVING count(DISTINCT e.dispositivo_id) = v_outros
    ON CONFLICT ON CONSTRAINT uq_rep_excecao_servidor_dispositivo DO NOTHING;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_herdar_excecoes_ponto_dispositivo_novo() IS
    'Copia para um relogio recem-cadastrado as excecoes de ponto de quem ja e excecao em TODOS '
    'os equipamentos anteriores (quem administra o parque). Excecao pontual em um relogio so '
    'NAO e herdada - copiar essa apagaria ponto legitimo.';

DROP TRIGGER IF EXISTS trg_herdar_excecoes_ponto_dispositivo_novo ON public.dispositivos_rep;

CREATE TRIGGER trg_herdar_excecoes_ponto_dispositivo_novo
    AFTER INSERT ON public.dispositivos_rep
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_herdar_excecoes_ponto_dispositivo_novo();


-- ----------------------------------------------------------------------------
-- Backfill: os relogios criados DEPOIS do seed de 20260820030000
--
-- Mesmo criterio do gatilho, aplicado ao que ja existe. Um dispositivo cadastrado entre
-- 20/08 e hoje nunca recebeu as excecoes; sem isto, so' os proximos ficariam protegidos.
-- ----------------------------------------------------------------------------
INSERT INTO public.rep_excecoes_ponto (servidor_id, dispositivo_id, motivo)
SELECT alvo.servidor_id,
       d.id,
       'Backfill 25/08/2026: excecao em todos os demais equipamentos'
  FROM public.dispositivos_rep d
  CROSS JOIN LATERAL (
      SELECT e.servidor_id
        FROM public.rep_excecoes_ponto e
       WHERE e.dispositivo_id <> d.id
       GROUP BY e.servidor_id
      HAVING count(DISTINCT e.dispositivo_id) = (
          SELECT count(*) FROM public.dispositivos_rep d2 WHERE d2.id <> d.id
      )
  ) alvo
ON CONFLICT ON CONSTRAINT uq_rep_excecao_servidor_dispositivo DO NOTHING;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. Quem e excecao, e em quantos dos relogios existentes:
--   SELECT s.nome, s.matricula, count(*) AS relogios,
--          (SELECT count(*) FROM public.dispositivos_rep) AS total_relogios
--     FROM public.rep_excecoes_ponto e
--     JOIN public.servidores s ON s.id = e.servidor_id
--    GROUP BY s.nome, s.matricula ORDER BY relogios DESC;
--
-- 2. Relogio que ficou SEM a excecao de quem e excecao em todos os outros (deve vir vazio):
--   SELECT d.nome
--     FROM public.dispositivos_rep d
--    WHERE EXISTS (
--        SELECT 1 FROM public.rep_excecoes_ponto e
--         WHERE e.dispositivo_id <> d.id
--         GROUP BY e.servidor_id
--        HAVING count(DISTINCT e.dispositivo_id) = (SELECT count(*) FROM public.dispositivos_rep d2 WHERE d2.id <> d.id)
--           AND NOT EXISTS (SELECT 1 FROM public.rep_excecoes_ponto e2
--                            WHERE e2.dispositivo_id = d.id AND e2.servidor_id = e.servidor_id)
--    );
--
-- 3. Depois de cadastrar o proximo relogio, confira que o gatilho agiu:
--   SELECT s.nome, e.motivo FROM public.rep_excecoes_ponto e
--     JOIN public.servidores s ON s.id = e.servidor_id
--    WHERE e.dispositivo_id = (SELECT id FROM public.dispositivos_rep ORDER BY created_at DESC LIMIT 1);
