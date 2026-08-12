-- Migration: fn_atualizar_biometria_vinculos passa a casar por identificador_afd, nao device_user_id
-- Data: 2026-08-12
--
-- MOTIVACAO
--   Teste real contra o rele de 10.110.2.89 (load_users.fcgi, 6 usuarios do piloto devolvidos
--   com sucesso) revelou que este equipamento (linha REP-C/iDClass) NAO tem um campo "id"
--   interno separado - o objeto "user" so tem pis/registration/code/rfid/templates/etc, todos
--   como numero JSON. A migration 20260812000000 desenhou fn_atualizar_biometria_vinculos
--   assumindo um device_user_id bigint que nao existe de verdade neste hardware.
--
--   identificador_afd (ja usado em rep_vinculos_servidor para o sentido AFD->servidor) e' o
--   identificador real e estavel: e o mesmo "pis" do device, no formato de 12 digitos.
--   fn_confirmar_cadastro_rep ja o grava a partir do proprio servidor da fila - nao precisa de
--   nenhum id sintetico vindo do rele.
--
-- IDEMPOTENTE: DROP FUNCTION IF EXISTS antes de recriar com assinatura diferente (mudar o tipo
-- do parametro exige isso - CREATE OR REPLACE nao troca tipo de parametro). Seguro rodar nos
-- dois ambientes (CLAUDE.md armadilha 3).

DROP FUNCTION IF EXISTS public.fn_atualizar_biometria_vinculos(uuid, bigint[]);

CREATE OR REPLACE FUNCTION public.fn_atualizar_biometria_vinculos(p_dispositivo_id uuid, p_identificadores_afd text[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH atualizados AS (
        UPDATE public.rep_vinculos_servidor
           SET tem_biometria = true
         WHERE dispositivo_id = p_dispositivo_id
           AND vigente_ate IS NULL
           AND tem_biometria = false
           AND identificador_afd = ANY(p_identificadores_afd)
        RETURNING 1
    )
    SELECT count(*)::integer FROM atualizados
$fn$;

REVOKE ALL ON FUNCTION public.fn_atualizar_biometria_vinculos(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_atualizar_biometria_vinculos(uuid, text[]) TO service_role;

-- CONFERENCIA APOS APLICAR
--
--   SELECT public.fn_atualizar_biometria_vinculos(
--            (SELECT id FROM public.dispositivos_rep WHERE numero_serie = 'REP-TESTE-TI'),
--            ARRAY['011144477735']);
--   -- esperado: 0 ou 1, sem erro de tipo
