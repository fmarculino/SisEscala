-- ============================================================================
-- Sincronizacao de biometria entre relogios da mesma unidade (25/08/2026)
-- ============================================================================
--
-- MOTIVACAO. Uma unidade com 4 relogios exige que a pessoa esteja cadastrada COM DIGITAL nos 4
-- para bater em qualquer entrada. Cadastrar digital e presencial: sem copia, sao 4 idas ao
-- equipamento por servidor. O caminho manual (pendrive, "Enviar/Receber usuarios") ja funciona e
-- esta documentado em docs/planos/2026-08-25-copia-de-biometria-entre-relogios.md; isto e a
-- versao automatica dele.
--
-- O QUE JA EXISTIA E NAO PRECISOU MUDAR: a DETECCAO. O ciclo do coletor ja le o cadastro de cada
-- relogio e reporta quem tem biometria (ciclo.SincronizarCadastros -> ReportarBiometria e o
-- snapshot de rep_usuarios_dispositivo). O SisEscala ja sabe, sozinho, que fulano tem digital no
-- relogio A e nao tem no B. Faltava so o transporte.
--
-- ⚠️ O TEMPLATE NUNCA PASSA POR AQUI. A copia e' relogio -> relogio, feita pelo coletor DENTRO da
-- unidade (a mesma maquina enxerga os dois equipamentos). Este lado so' diz QUEM falta e onde
-- achar, e recebe de volta o resultado. Dado biometrico e sensivel (LGPD Art. 5, II): o servidor
-- no meio adicionaria uma copia do dado sem adicionar funcao nenhuma.
--
-- ⚠️ SO' ALCANCA QUEM JA ESTA CADASTRADO NO DESTINO SEM DIGITAL. Quem nao esta no relogio de
-- destino e assunto da fila de identidade (rep_cadastros_fila, Fase 7), que ja existe e ja roda
-- no ciclo: quando a identidade chega, a pessoa passa a ser candidata aqui. Uma peca, uma
-- responsabilidade - a copia de biometria nao cria usuario, e por isso nao tem como duplicar
-- cadastro no equipamento.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.


-- ----------------------------------------------------------------------------
-- 1. Registro das copias (append-only na pratica: nao ha UPDATE em lugar nenhum)
--
--    Existe para auditoria: dado biometrico que se move entre equipamentos precisa deixar
--    rastro de quando, de onde para onde, e por qual maquina. Tambem e' o que impede o
--    coletor de reencostar em quem acabou de falhar (ver a funcao abaixo).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rep_biometria_copias (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servidor_id         uuid NOT NULL REFERENCES public.servidores(id) ON DELETE CASCADE,
    origem_id           uuid NOT NULL REFERENCES public.dispositivos_rep(id) ON DELETE CASCADE,
    destino_id          uuid NOT NULL REFERENCES public.dispositivos_rep(id) ON DELETE CASCADE,
    -- Quantos templates foram gravados. NAO guarda template nenhum, so a contagem.
    templates_copiados  integer NOT NULL DEFAULT 0,
    status              text NOT NULL CHECK (status IN ('aplicada', 'falhou')),
    erro                text,
    formato_usado       text,          -- qual candidato de escrita o equipamento aceitou
    coletor_host        text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rep_biometria_copias IS
    'Auditoria da copia de biometria de um relogio para outro da mesma unidade. NAO guarda '
    'template: a copia acontece equipamento-a-equipamento, dentro da unidade, pelo coletor.';

CREATE INDEX IF NOT EXISTS idx_rep_biometria_copias_destino
    ON public.rep_biometria_copias (destino_id, servidor_id, created_at DESC);

ALTER TABLE public.rep_biometria_copias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura de copias de biometria por gestor" ON public.rep_biometria_copias;
CREATE POLICY "Leitura de copias de biometria por gestor"
    ON public.rep_biometria_copias FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('super_admin'::public.user_role, 'admin'::public.user_role,
                                 'rh'::public.user_role, 'rh_unidade'::public.user_role,
                                 'coordenador'::public.user_role)
    );
-- Escrita so' por service_role (o coletor, via rota autenticada por token de dispositivo).


-- ----------------------------------------------------------------------------
-- 2. Quem precisa de digital neste relogio e ja tem em outro da mesma unidade
--
--    Chamada pelo coletor com o dispositivo de DESTINO (o que ele acabou de autenticar).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_biometria_faltante_dispositivo(p_destino_id uuid)
RETURNS TABLE (
    servidor_id               uuid,
    servidor_nome             text,
    matricula                 text,
    destino_identificador_afd text,
    origem_id                 uuid,
    origem_nome               text,
    origem_identificador_afd  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    WITH destino AS (
        SELECT d.id, d.unidade_id FROM public.dispositivos_rep d WHERE d.id = p_destino_id
    ),
    -- Quem esta NO DESTINO, resolvido como servidor, e sem digital la.
    faltando AS (
        SELECT u.servidor_id, u.identificador_afd
          FROM public.rep_usuarios_dispositivo u
          JOIN public.servidores s ON s.id = u.servidor_id
         WHERE u.dispositivo_id = p_destino_id
           AND u.servidor_id IS NOT NULL
           AND NOT u.tem_biometria
           AND s.status = 'Ativo'
    )
    SELECT f.servidor_id,
           s.nome,
           s.matricula,
           f.identificador_afd,
           o.dispositivo_id,
           dorig.nome,
           o.identificador_afd
      FROM faltando f
      JOIN public.servidores s ON s.id = f.servidor_id
      -- A origem: outro relogio ATIVO da MESMA unidade onde essa pessoa ja tem digital.
      -- LATERAL com LIMIT 1 porque basta uma origem; mais de uma so' daria trabalho igual.
      JOIN LATERAL (
          SELECT u2.dispositivo_id, u2.identificador_afd
            FROM public.rep_usuarios_dispositivo u2
            JOIN public.dispositivos_rep d2 ON d2.id = u2.dispositivo_id
           WHERE u2.servidor_id = f.servidor_id
             AND u2.tem_biometria
             AND d2.ativo
             AND d2.id <> p_destino_id
             AND d2.unidade_id = (SELECT unidade_id FROM destino)
           ORDER BY u2.atualizado_em DESC
           LIMIT 1
      ) o ON true
      JOIN public.dispositivos_rep dorig ON dorig.id = o.dispositivo_id
     -- Falha recente nao e' retentada em seguida: se o equipamento recusou o template desta
     -- pessoa, tentar de novo em 5 minutos so' repete o erro. Sucesso tambem sai da lista pelo
     -- proprio snapshot (tem_biometria passa a true), mas o filtro cobre a janela entre a copia
     -- e o proximo relato de cadastro.
       AND NOT EXISTS (
           SELECT 1 FROM public.rep_biometria_copias c
            WHERE c.destino_id = p_destino_id
              AND c.servidor_id = f.servidor_id
              AND c.created_at > now() - interval '24 hours'
       )
     ORDER BY s.nome
$fn$;

COMMENT ON FUNCTION public.fn_biometria_faltante_dispositivo(uuid) IS
    'Servidores cadastrados NESTE relogio sem digital que ja tem digital em outro relogio ativo '
    'da mesma unidade, com onde buscar. Quem nao esta no relogio de destino nao entra aqui - '
    'isso e a fila de identidade (rep_cadastros_fila).';

GRANT EXECUTE ON FUNCTION public.fn_biometria_faltante_dispositivo(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- 3. O coletor reporta o resultado de cada copia
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_registrar_copia_biometria(
    p_destino_id      uuid,
    p_servidor_id     uuid,
    p_origem_id       uuid,
    p_sucesso         boolean,
    p_templates       integer DEFAULT 0,
    p_erro            text    DEFAULT NULL,
    p_formato_usado   text    DEFAULT NULL,
    p_coletor_host    text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.rep_biometria_copias
        (servidor_id, origem_id, destino_id, templates_copiados, status, erro, formato_usado, coletor_host)
    VALUES
        (p_servidor_id, p_origem_id, p_destino_id, COALESCE(p_templates, 0),
         CASE WHEN p_sucesso THEN 'aplicada' ELSE 'falhou' END,
         p_erro, p_formato_usado, p_coletor_host)
    RETURNING id INTO v_id;

    -- Sucesso reflete no snapshot do DESTINO na hora. O proximo relato de cadastro
    -- (fn_registrar_snapshot_usuarios_dispositivo) reconfirma lendo o equipamento - esta escrita
    -- e so' para a tela nao ficar 5 minutos dizendo que falta digital de quem acabou de receber.
    -- Nunca DESLIGA tem_biometria, mesma regra de fn_atualizar_biometria_vinculos.
    IF p_sucesso THEN
        UPDATE public.rep_usuarios_dispositivo
           SET tem_biometria = true, atualizado_em = now()
         WHERE dispositivo_id = p_destino_id
           AND servidor_id = p_servidor_id;

        UPDATE public.rep_vinculos_servidor
           SET tem_biometria = true
         WHERE dispositivo_id = p_destino_id
           AND servidor_id = p_servidor_id
           AND vigente_ate IS NULL;
    END IF;

    RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.fn_registrar_copia_biometria(uuid, uuid, uuid, boolean, integer, text, text, text) IS
    'Registra o resultado de uma copia de biometria entre relogios e, no sucesso, marca a '
    'biometria no snapshot do destino. Nunca desliga tem_biometria.';

GRANT EXECUTE ON FUNCTION public.fn_registrar_copia_biometria(uuid, uuid, uuid, boolean, integer, text, text, text) TO service_role;


-- ============================================================================
-- CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 1. Quanto trabalho existe hoje, por relogio de destino (deve ser 0 em unidade de um relogio so):
--   SELECT d.nome, count(*) AS faltam_digital
--     FROM public.dispositivos_rep d
--     CROSS JOIN LATERAL public.fn_biometria_faltante_dispositivo(d.id) f
--    GROUP BY d.nome ORDER BY 2 DESC;
--
-- 2. Depois de rodar a copia pelo coletor:
--   SELECT s.nome, dorig.nome AS de, ddest.nome AS para, c.status, c.templates_copiados, c.erro
--     FROM public.rep_biometria_copias c
--     JOIN public.servidores s ON s.id = c.servidor_id
--     JOIN public.dispositivos_rep dorig ON dorig.id = c.origem_id
--     JOIN public.dispositivos_rep ddest ON ddest.id = c.destino_id
--    ORDER BY c.created_at DESC LIMIT 50;
--
-- 3. Nenhuma copia pode ter origem e destino em unidades diferentes (a funcao filtra, mas
--    conferir depois de qualquer mudanca nela):
--   SELECT count(*) AS deve_ser_zero
--     FROM public.rep_biometria_copias c
--     JOIN public.dispositivos_rep o ON o.id = c.origem_id
--     JOIN public.dispositivos_rep d ON d.id = c.destino_id
--    WHERE o.unidade_id <> d.unidade_id;
