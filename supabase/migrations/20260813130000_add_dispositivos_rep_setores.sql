-- Migration: tabela de juncao dispositivo REP <-> setores (relogio compartilhado por N setores)
-- Data: 2026-08-13
--
-- MOTIVACAO
--   dispositivos_rep.setor_id e uma FK unica e opcional: um relogio so pode ser "de um setor" ou
--   "de toda a unidade" (setor_id NULL). Nao existe meio-termo. Caso real que motivou isto: o
--   relogio da LACEM vai passar a ser usado por Informatica + Regulacao + TFD (cada setor com
--   escala e coordenacao proprias), nao por todos os setores da unidade nem por um so.
--
--   Ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md - inclui a
--   revisao de impacto que confirma que este campo NAO alimenta a folha de ponto hoje (a
--   reconciliacao que ligaria relogio -> folha, Fase 5, nao tem nenhum chamador em src/ ainda).
--
-- ESTA MIGRATION E SOMENTE ADITIVA
--   Cria a tabela nova e faz o backfill. NENHUMA funcao existente e alterada aqui -
--   fn_enfileirar_cadastros_rep, fn_cobertura_ponto_dispositivo, fn_cobertura_ponto_resumo e
--   fn_ingerir_afd continuam lendo dispositivos_rep.setor_id exatamente como hoje ate a proxima
--   migration reescreve-las. Reversivel com DROP TABLE se algo parecer errado - nada mais
--   referencia esta tabela ainda.
--
-- SEMANTICA (espelha o que setor_id IS NULL ja significa hoje)
--   0 linhas para um dispositivo_id = "toda a unidade" (igual a setor_id NULL)
--   >=1 linhas                      = so os setores listados
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, backfill por INSERT ... WHERE NOT EXISTS,
-- DROP POLICY IF EXISTS antes de recriar. Seguro rodar nos dois ambientes e seguro reaplicar
-- (CLAUDE.md armadilha 3).


-- ============================================================================
-- 1. TABELA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dispositivos_rep_setores (
    dispositivo_id uuid NOT NULL REFERENCES public.dispositivos_rep(id) ON DELETE CASCADE,
    setor_id       uuid NOT NULL REFERENCES public.setores(id),
    criado_por_id  uuid REFERENCES public.profiles(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (dispositivo_id, setor_id)
);

-- EXISTS reverso ("quais relogios atendem este setor") nao tem tela hoje, mas e barato manter.
CREATE INDEX IF NOT EXISTS idx_dispositivos_rep_setores_setor
    ON public.dispositivos_rep_setores (setor_id);

COMMENT ON TABLE public.dispositivos_rep_setores IS
    'Setores que um relogio REP atende, quando NAO e "toda a unidade". 0 linhas para um '
    'dispositivo_id tem a MESMA semantica de dispositivos_rep.setor_id IS NULL: sem restricao. '
    'Ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md.';


-- ============================================================================
-- 2. BACKFILL
-- ============================================================================
-- Reproduz o setor_id atual de cada dispositivo como uma linha na tabela nova. Quem esta em
-- "toda a unidade" (setor_id NULL) nao ganha linha nenhuma - e a semantica correta, nao uma
-- omissao.

INSERT INTO public.dispositivos_rep_setores (dispositivo_id, setor_id)
SELECT d.id, d.setor_id
  FROM public.dispositivos_rep d
 WHERE d.setor_id IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM public.dispositivos_rep_setores x
        WHERE x.dispositivo_id = d.id AND x.setor_id = d.setor_id
   );


-- ============================================================================
-- 3. RLS
-- ============================================================================
-- Mesma forma de dispositivos_rep (20260808010000): leitura por escopo de unidade para qualquer
-- authenticated, escrita administrativa. dispositivos_rep_setores nao tem unidade_id proprio -
-- o escopo vem do dispositivo pai.

ALTER TABLE public.dispositivos_rep_setores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura de setores do dispositivo por escopo" ON public.dispositivos_rep_setores;
CREATE POLICY "Leitura de setores do dispositivo por escopo" ON public.dispositivos_rep_setores
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.dispositivos_rep d
         WHERE d.id = dispositivos_rep_setores.dispositivo_id
           AND public.fn_unidade_no_escopo(d.unidade_id)
    ));

DROP POLICY IF EXISTS "Gestao de setores do dispositivo por admin" ON public.dispositivos_rep_setores;
CREATE POLICY "Gestao de setores do dispositivo por admin" ON public.dispositivos_rep_setores
    FOR ALL TO authenticated
    USING ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role))
    WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin'::public.user_role, 'admin'::public.user_role));

-- Mesmo padrao de dispositivos_rep/rep_cadastros_fila: so SELECT vai para authenticated. Escrita
-- de verdade passa por RPC SECURITY DEFINER (fn_definir_setores_dispositivo_rep, proxima
-- migration) chamada via admin client - a policy "Gestao..." acima e so defesa em profundidade
-- para quem porventura escrever direto pela sessao do usuario.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dispositivos_rep_setores FROM anon;
GRANT SELECT ON public.dispositivos_rep_setores TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) O backfill reproduz exatamente os dispositivos com setor_id preenchido hoje:
--
--   SELECT count(*) FROM public.dispositivos_rep_setores;
--   SELECT count(*) FROM public.dispositivos_rep WHERE setor_id IS NOT NULL;
--   -- os dois numeros tem que bater. Nos dois ambientes conhecidos ate 13/08/2026 (piloto da TI
--   -- e LACEM) o esperado e 0 nos dois lados - nenhum dispositivo usa "um setor so" ainda.
--
--   2) NENHUMA funcao existente mudou de comportamento - esta migration nao toca em nenhum corpo
--      de funcao. fn_cobertura_ponto_resumo(8, 2026) tem que devolver os mesmos numeros de
--      sempre para a LACEM (39 escalados, 27 sem vinculo, 10 fora do relogio, 1 sem biometria,
--      1 ok), porque ela ainda le dispositivos_rep.setor_id diretamente, nao a tabela nova:
--
--   SELECT dispositivo_nome, escalados, ok, sem_vinculo, sem_biometria, fora_do_relogio
--     FROM public.fn_cobertura_ponto_resumo(8, 2026);
--
--   3) A tabela existe com RLS ligada e as duas policies:
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'dispositivos_rep_setores';  -- esperado: true
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.dispositivos_rep_setores'::regclass;
--
--   ROLLBACK, se algo parecer errado (nada mais referencia esta tabela ainda):
--   DROP TABLE public.dispositivos_rep_setores;
