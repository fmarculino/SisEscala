-- Migration: Corrige o casamento de CPF em fn_vinculos_sugeridos_afd
-- Data: 2026-08-08
--
-- SINTOMA
--   No teste de ingestao de 08/08/2026, fn_vinculos_sugeridos_afd resolveu corretamente
--   FERNANDO (identificador 053638930459) e HUGO (015473729253), mas devolveu "nao resolvido"
--   para ANDRYA (008943857128) e DAIANE (002035005205) - servidores que existem no cadastro,
--   estao no mesmo setor e tem CPF preenchido.
--
-- CAUSA
--   O casamento usava ltrim(identificador_afd, '0'), que remove TODOS os zeros a esquerda:
--
--     053638930459 -> ltrim -> 53638930459   (11 digitos)  CPF 53638930459   -> casa
--     008943857128 -> ltrim -> 8943857128    (10 digitos)  CPF 08943857128   -> NAO casa
--
--   O identificador do AFD tem 12 posicoes e carrega o CPF com UM zero de preenchimento a
--   esquerda. Quando o proprio CPF ja comeca com zero, ltrim come o zero do CPF junto e
--   sobra um numero de 10 digitos que nao existe.
--
--   Medido em producao em 08/08/2026: dos 127 servidores com CPF preenchido, 47 comecam com
--   zero - 37%. O defeito atingiria mais de um terco da base, de forma aparentemente aleatoria.
--   E o tipo de bug que geraria "orfas fantasma" no modulo de pendencias e levaria alguem a
--   vincular a pessoa errada na mao, em cima de uma sugestao que parecia so estar incompleta.
--
-- CORRECAO
--   right(identificador_afd, 11): pega exatamente as 11 ultimas posicoes, independente do
--   conteudo. E a operacao inversa exata do padStart(12, '0') que gerou o identificador.
--
-- ONDE O DEFEITO NAO EXISTIA
--   fn_ingerir_afd resolve o servidor por igualdade exata de rep_vinculos_servidor
--   .identificador_afd, sem manipular zeros - por isso as duas batidas reais foram atribuidas
--   corretamente no mesmo teste. Apenas a SUGESTAO estava errada.
--
-- IDEMPOTENTE
--   CREATE OR REPLACE de uma funcao de leitura. Nao altera dado nenhum.

CREATE OR REPLACE FUNCTION public.fn_vinculos_sugeridos_afd(p_dispositivo_id uuid)
RETURNS TABLE (
    identificador_afd text,
    nome_no_device    text,
    batidas           bigint,
    servidor_id       uuid,
    servidor_nome     text,
    criterio          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH cadastros AS (
        SELECT DISTINCT ON (r.identificador_afd)
               r.identificador_afd,
               btrim(substring(r.linha_bruta from 48 for 52)) AS nome_device
          FROM public.rep_afd_registros r
         WHERE r.dispositivo_id = p_dispositivo_id
           AND r.tipo_registro = '5'
           AND r.identificador_afd IS NOT NULL
         ORDER BY r.identificador_afd, r.nsr DESC
    ),
    batidas AS (
        SELECT m.identificador_bruto AS ident, count(*) AS n
          FROM public.marcacoes_ponto m
         WHERE m.dispositivo_id = p_dispositivo_id
         GROUP BY 1
    ),
    ja_vinculados AS (
        SELECT v.identificador_afd
          FROM public.rep_vinculos_servidor v
         WHERE v.dispositivo_id = p_dispositivo_id AND v.vigente_ate IS NULL
    )
    SELECT c.identificador_afd,
           c.nome_device,
           COALESCE(b.n, 0),
           s.id,
           s.nome,
           CASE
               WHEN jv.identificador_afd IS NOT NULL THEN 'ja vinculado'
               WHEN s.id IS NOT NULL                 THEN 'cpf'
               ELSE 'nao resolvido'
           END
      FROM cadastros c
      LEFT JOIN batidas b        ON b.ident = c.identificador_afd
      LEFT JOIN ja_vinculados jv ON jv.identificador_afd = c.identificador_afd
      -- right(...,11) e a inversa exata do padStart(12,'0'). NAO usar ltrim(...,'0'):
      -- CPF que comeca com zero perderia um digito. Ver cabecalho desta migration.
      LEFT JOIN public.servidores s
             ON regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g') = right(c.identificador_afd, 11)
            AND regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g') <> ''
     ORDER BY COALESCE(b.n, 0) DESC, c.nome_device
$fn$;

GRANT EXECUTE ON FUNCTION public.fn_vinculos_sugeridos_afd(uuid) TO authenticated, service_role;


-- CONFERENCIA APOS APLICAR
--
--   1) CPF que comeca com zero tem que resolver agora. No dispositivo de teste, ANDRYA
--      (008943857128) e DAIANE (002035005205) devem sair como 'ja vinculado' - e nao
--      'nao resolvido':
--
--   SELECT identificador_afd, nome_no_device, batidas, servidor_nome, criterio
--     FROM public.fn_vinculos_sugeridos_afd(
--            (SELECT id FROM public.dispositivos_rep WHERE numero_serie = 'REP-TESTE-TI'))
--    ORDER BY criterio, nome_no_device;
--
--   2) Sanidade da inversa: para todo vinculo vigente, right(identificador, 11) tem que bater
--      com o CPF do servidor (esperado: 0 linhas):
--
--   SELECT v.identificador_afd, s.nome, s.cpf
--     FROM public.rep_vinculos_servidor v
--     JOIN public.servidores s ON s.id = v.servidor_id
--    WHERE v.vigente_ate IS NULL
--      AND regexp_replace(COALESCE(s.cpf, ''), '\D', '', 'g') <> right(v.identificador_afd, 11);
