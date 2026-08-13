-- Migration: corrige duplicidade de identificador_afd no snapshot de usuarios do dispositivo
--
-- Fase 7b (higiene de cadastros do dispositivo REP) presumia que cada identificador_afd
-- (pis/CPF, 12 digitos) aparece uma unica vez na resposta de load_users.fcgi do rele. Um device
-- reaproveitado de outro sistema pode trazer o mesmo identificador cadastrado mais de uma vez
-- (cadastro antigo nao limpo). O INSERT em lote violava a constraint unica
-- uq_usuario_dispositivo e a funcao inteira dava rollback (incluindo o DELETE anterior),
-- deixando a tela de Higiene sem snapshot nenhum para aquele dispositivo -- confirmado em
-- producao na LACEN em 13/08/2026 (64 usuarios lidos do rele, HTTP 500 "duplicate key value
-- violates unique constraint uq_usuario_dispositivo").
--
-- Correcao: dedup por identificador_afd antes do INSERT, preferindo o registro com biometria
-- cadastrada quando um dos duplicados a tiver -- para nao perder esse sinal na aba
-- "Biometria Pendente".

CREATE OR REPLACE FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(
    p_dispositivo_id uuid,
    p_usuarios       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_total integer := 0;
    v_sem_match integer := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.dispositivos_rep WHERE id = p_dispositivo_id) THEN
        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;
    END IF;

    DELETE FROM public.rep_usuarios_dispositivo WHERE dispositivo_id = p_dispositivo_id;

    WITH bruto AS (
        SELECT
            btrim(u->>'identificador_afd')                         AS identificador_afd,
            NULLIF(btrim(u->>'registration_bruto'), '')             AS registration_bruto,
            NULLIF(btrim(u->>'nome'), '')                           AS nome,
            COALESCE((u->>'tem_biometria')::boolean, false)         AS tem_biometria
          FROM jsonb_array_elements(COALESCE(p_usuarios, '[]'::jsonb)) AS u
         WHERE btrim(COALESCE(u->>'identificador_afd', '')) <> ''
    ),
    entrada AS (
        -- Dedup: um device reaproveitado pode ter o mesmo identificador_afd cadastrado mais de
        -- uma vez. Mantem o registro com biometria quando algum dos duplicados tiver.
        SELECT DISTINCT ON (identificador_afd)
               identificador_afd, registration_bruto, nome, tem_biometria
          FROM bruto
         ORDER BY identificador_afd, tem_biometria DESC, nome NULLS LAST
    ),
    resolvido AS (
        SELECT e.*,
               COALESCE(vinc.servidor_id, cpf_match.id)             AS servidor_id,
               CASE WHEN vinc.servidor_id IS NOT NULL THEN 'vinculo'
                    WHEN cpf_match.id IS NOT NULL THEN 'cpf'
                    ELSE NULL END                                   AS origem_match
          FROM entrada e
          LEFT JOIN public.rep_vinculos_servidor vinc
            ON vinc.dispositivo_id = p_dispositivo_id
           AND vinc.identificador_afd = e.identificador_afd
           AND vinc.vigente_ate IS NULL
          LEFT JOIN public.servidores cpf_match
            ON cpf_match.status = 'Ativo'
           AND right(regexp_replace(COALESCE(cpf_match.cpf, ''), '\D', '', 'g'), 11)
               = right(e.identificador_afd, 11)
           AND length(regexp_replace(COALESCE(cpf_match.cpf, ''), '\D', '', 'g')) >= 11
    ),
    inseridos AS (
        INSERT INTO public.rep_usuarios_dispositivo
               (dispositivo_id, identificador_afd, registration_bruto, nome_no_device,
                tem_biometria, servidor_id, origem_match)
        SELECT p_dispositivo_id, identificador_afd, registration_bruto, nome,
               tem_biometria, servidor_id, origem_match
          FROM resolvido
        RETURNING servidor_id
    )
    SELECT count(*), count(*) FILTER (WHERE servidor_id IS NULL)
      INTO v_total, v_sem_match
      FROM inseridos;

    RETURN jsonb_build_object('total', v_total, 'sem_correspondencia', v_sem_match);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb) TO service_role;

-- Sonda pos-deploy (nao destrutiva, nao mexe em dado real):
--   SELECT public.fn_registrar_snapshot_usuarios_dispositivo(
--     (SELECT id FROM public.dispositivos_rep LIMIT 1),
--     '[{"identificador_afd":"999999999999","nome":"A","tem_biometria":false},
--       {"identificador_afd":"999999999999","nome":"B","tem_biometria":true}]'::jsonb
--   );
--   -- esperado: {"total":1,"sem_correspondencia":1} (nao {"total":2,...} nem erro de duplicate key)
--   -- e a linha remanescente em rep_usuarios_dispositivo com nome_no_device = 'B' (tem_biometria=true venceu)
--   -- rode fn_registrar_snapshot_usuarios_dispositivo de novo com o snapshot real do dispositivo
--   -- em seguida, para restaurar o estado antes do teste.
