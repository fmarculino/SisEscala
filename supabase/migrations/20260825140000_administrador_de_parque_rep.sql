-- ============================================================================
-- Administrador do parque: excecao de ponto que ALCANCA relogio novo (25/08/2026)
-- ============================================================================
--
-- 🚨 CORRIGE A 20260825120000, QUE NAO FUNCIONA. Aquela migration herdava a excecao de quem
-- fosse excecao em TODOS os demais equipamentos. Medido em producao no mesmo dia: o
-- administrador do parque tem excecao em 5 dos 14 relogios, entao o criterio nunca e' satisfeito
-- - o backfill inseriu ZERO linhas e o gatilho nao dispararia no proximo relogio. Pior: o
-- criterio e' INSATISFAZIVEL por construcao, porque quem administra o parque tem, de proposito,
-- UM relogio sem excecao (aquele onde ele realmente bate o ponto). "Excecao em todos os demais"
-- nunca vale para ele.
--
-- MEDIDO EM PRODUCAO (25/08/2026), servidor mat. 69497:
--   * cadastrado com biometria em 8 equipamentos, com excecao em NENHUM deles;
--   * as 5 excecoes existentes sao justamente para relogios onde ele nao esta cadastrado;
--   * 2 dias de folha ficaram com ENTRADA vinda de relogio onde ele so testou: 15/08 (CEI) e
--     24/08 (USF-JBB). Os outros 8 dias vieram do relogio da TI, que e' o dele - legitimo.
--
-- O DESENHO NOVO E EXPLICITO, e essa e' a licao: quem administra o parque e' um FATO
-- ADMINISTRATIVO, nao algo a inferir da forma das excecoes ja gravadas. Inferir foi o que
-- produziu um gatilho que nunca dispara.
--
-- ⚠️ dispositivo_ponto_id e' o relogio onde a pessoa REALMENTE bate. Ele nunca recebe excecao -
-- criar excecao ali faria o ponto real dela parar de contar, que e' o erro na direcao contraria
-- e o unico caro dos dois.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING, CREATE OR REPLACE.


-- ----------------------------------------------------------------------------
-- 1. Quem administra o parque
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rep_administradores_parque (
    servidor_id          uuid PRIMARY KEY REFERENCES public.servidores(id) ON DELETE CASCADE,
    -- O relogio onde esta pessoa bate ponto de verdade. NULL = nao bate em nenhum (ex.: alguem
    -- da TI que so' configura equipamento e registra ponto pelo terminal).
    dispositivo_ponto_id uuid REFERENCES public.dispositivos_rep(id) ON DELETE SET NULL,
    motivo               text NOT NULL DEFAULT 'Administra os equipamentos REP; precisa estar cadastrado em todos',
    created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rep_administradores_parque IS
    'Quem precisa estar cadastrado em TODOS os relogios para configura-los. Todo relogio novo '
    'gera excecao de ponto para estas pessoas automaticamente, menos no dispositivo_ponto_id '
    'delas (onde o ponto e real).';

ALTER TABLE public.rep_administradores_parque ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestao de administradores de parque REP" ON public.rep_administradores_parque;
CREATE POLICY "Gestao de administradores de parque REP"
    ON public.rep_administradores_parque FOR ALL TO authenticated
    USING (public.get_my_role() IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK (public.get_my_role() IN ('super_admin'::public.user_role, 'admin'::public.user_role));


-- ----------------------------------------------------------------------------
-- 2. Seed: o administrador do sistema, com o relogio dele
--
--    Mesma matricula do seed de 20260820030000, e o mesmo relogio que aquela migration ja
--    excluia por UUID - agora dito uma vez so, num lugar consultavel, em vez de repetido em
--    cada WHERE de cada migration nova.
-- ----------------------------------------------------------------------------
INSERT INTO public.rep_administradores_parque (servidor_id, dispositivo_ponto_id, motivo)
SELECT s.id,
       '76c51155-023b-415a-8d8a-a6b22f81ff72'::uuid,   -- REP iDClass - Reg/TI/TFD
       'Administrador do sistema; cadastrado em todos os equipamentos para configura-los e '
       'cadastrar outros administradores. Bate ponto no relogio da TI.'
  FROM public.servidores s
 WHERE s.matricula = '69497'
ON CONFLICT (servidor_id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 3. O gatilho, agora com criterio satisfazivel
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_herdar_excecoes_ponto_dispositivo_novo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    -- Todo administrador do parque vira excecao no relogio recem-cadastrado. O
    -- dispositivo_ponto_id dele nunca e' o relogio novo (ele acabou de ser criado), entao o
    -- filtro abaixo e' defensivo, nao decorativo: protege quem, no futuro, apontar o proprio
    -- dispositivo_ponto para um equipamento e reprocessar este gatilho.
    INSERT INTO public.rep_excecoes_ponto (servidor_id, dispositivo_id, motivo)
    SELECT a.servidor_id, NEW.id,
           'Administrador do parque; excecao criada junto com o cadastro deste relogio'
      FROM public.rep_administradores_parque a
     WHERE a.dispositivo_ponto_id IS DISTINCT FROM NEW.id
    ON CONFLICT ON CONSTRAINT uq_rep_excecao_servidor_dispositivo DO NOTHING;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_herdar_excecoes_ponto_dispositivo_novo() IS
    'Cria excecao de ponto para todo administrador do parque quando um relogio e cadastrado. '
    'Substitui o criterio "excecao em todos os demais" da 20260825120000, que era '
    'INSATISFAZIVEL: quem administra o parque tem, de proposito, um relogio sem excecao.';

-- O gatilho em si ja existe desde a 20260825120000; recriado aqui para a migration ser
-- aplicavel sozinha num banco que nao tenha recebido aquela.
DROP TRIGGER IF EXISTS trg_herdar_excecoes_ponto_dispositivo_novo ON public.dispositivos_rep;

CREATE TRIGGER trg_herdar_excecoes_ponto_dispositivo_novo
    AFTER INSERT ON public.dispositivos_rep
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_herdar_excecoes_ponto_dispositivo_novo();


-- ----------------------------------------------------------------------------
-- 4. Backfill: os relogios que ja existem
--
--    Sem isto, so' os PROXIMOS relogios ficariam protegidos - e o problema medido hoje e
--    justamente nos 8 equipamentos onde o administrador ja esta cadastrado sem excecao.
--
--    ⚠️ Nao alcanca ponto ja atribuido. A excecao age na ATRIBUICAO (fn_ponto_excecao, consultada
--    na ingestao e no reparse), e marcacoes_ponto nao tem caminho para tirar o dono de uma
--    marcacao - e nao deve ter (armadilha 20). Os 2 dias ja afetados (15/08 CEI, 24/08 USF-JBB)
--    se resolvem por marcacoes_tratamentos com tipo 'desconsiderar', que e decisao de quem
--    assina a folha, nao efeito colateral de migration.
-- ----------------------------------------------------------------------------
INSERT INTO public.rep_excecoes_ponto (servidor_id, dispositivo_id, motivo)
SELECT a.servidor_id, d.id,
       'Backfill 25/08/2026: administrador do parque'
  FROM public.rep_administradores_parque a
  CROSS JOIN public.dispositivos_rep d
 WHERE a.dispositivo_ponto_id IS DISTINCT FROM d.id
ON CONFLICT ON CONSTRAINT uq_rep_excecao_servidor_dispositivo DO NOTHING;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. Todo administrador do parque tem excecao em TODO relogio, menos no proprio (deve vir vazio):
--   SELECT s.nome, d.nome AS relogio_sem_excecao
--     FROM public.rep_administradores_parque a
--     JOIN public.servidores s ON s.id = a.servidor_id
--     CROSS JOIN public.dispositivos_rep d
--    WHERE a.dispositivo_ponto_id IS DISTINCT FROM d.id
--      AND NOT EXISTS (SELECT 1 FROM public.rep_excecoes_ponto e
--                       WHERE e.servidor_id = a.servidor_id AND e.dispositivo_id = d.id);
--
-- 2. O relogio de ponto do administrador NAO pode ter excecao (senao o ponto real dele para de
--    contar) — deve vir vazio:
--   SELECT s.nome, d.nome
--     FROM public.rep_administradores_parque a
--     JOIN public.servidores s ON s.id = a.servidor_id
--     JOIN public.dispositivos_rep d ON d.id = a.dispositivo_ponto_id
--     JOIN public.rep_excecoes_ponto e ON e.servidor_id = a.servidor_id AND e.dispositivo_id = d.id;
--
-- 3. Depois de cadastrar o proximo relogio, o gatilho tem que ter agido:
--   SELECT s.nome, e.motivo FROM public.rep_excecoes_ponto e
--     JOIN public.servidores s ON s.id = e.servidor_id
--    WHERE e.dispositivo_id = (SELECT id FROM public.dispositivos_rep ORDER BY created_at DESC LIMIT 1);
--
-- 4. O que ficou para tras (ponto ja atribuido vindo de relogio com excecao) - so' para saber o
--    tamanho, a correcao e' por tratamento:
--   SELECT d.nome, count(*) AS marcacoes_atribuidas_apesar_da_excecao
--     FROM public.marcacoes_ponto m
--     JOIN public.rep_excecoes_ponto e
--       ON e.servidor_id = m.servidor_id AND e.dispositivo_id = m.dispositivo_id
--     JOIN public.dispositivos_rep d ON d.id = m.dispositivo_id
--    GROUP BY d.nome ORDER BY 2 DESC;
