-- Migration: Log bruto das mensagens recebidas no webhook do WhatsApp
-- Data: 2026-08-09
--
-- POR QUE ESTA TABELA EXISTE
--   O parser de /api/avisos-ponto/webhook foi escrito tolerante porque o formato do payload da
--   AstraCalls ainda nao esta fixado (ver docs/planos/2026-08-09-comprovante-de-ponto-por-whatsapp.md).
--   Sem um lugar para guardar o que chega, descobrir o formato real exigiria ler log de container -
--   e um payload nao reconhecido some sem deixar rastro consultavel.
--
--   Com esta tabela, achar o formato vira um SELECT:
--
--     SELECT payload FROM logs_webhook_whatsapp ORDER BY recebido_em DESC LIMIT 1;
--
--   Ela tambem tem valor permanente depois disso: e a evidencia de que a resposta do servidor
--   chegou, e quando. O consentimento do double opt-in se apoia justamente nisso.
--
-- NAO CONTEM SEGREDO
--   O segredo do webhook e conferido ANTES de gravar. Payload rejeitado por segredo invalido nao
--   chega aqui - senao a tabela viraria coletor de lixo de qualquer varredura da internet.

CREATE TABLE IF NOT EXISTS public.logs_webhook_whatsapp (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payload       jsonb NOT NULL,
    telefone      text,              -- extraido pelo parser; NULL quando nao reconhecido
    texto         text,              -- idem
    reconhecido   boolean NOT NULL DEFAULT false,
    resultado     jsonb,             -- o que fn_confirmar_aviso_ponto devolveu
    recebido_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_webhook_whatsapp_recente
    ON public.logs_webhook_whatsapp (recebido_em DESC);

COMMENT ON TABLE public.logs_webhook_whatsapp IS
    'Toda mensagem recebida no webhook do WhatsApp, com o payload bruto. Serve para descobrir o '
    'formato real do provedor e como evidencia da resposta que confirma o opt-in.';

ALTER TABLE public.logs_webhook_whatsapp ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.logs_webhook_whatsapp FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.logs_webhook_whatsapp TO authenticated;
GRANT ALL    ON public.logs_webhook_whatsapp TO service_role;

DROP POLICY IF EXISTS "Webhook visivel a quem administra" ON public.logs_webhook_whatsapp;
CREATE POLICY "Webhook visivel a quem administra"
    ON public.logs_webhook_whatsapp FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.role IN ('admin', 'super_admin', 'coordenador')
    ));


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. A tabela existe e esta vazia:
--
--      SELECT count(*) FROM logs_webhook_whatsapp;
--
--   2. Depois de mandar UMA mensagem de teste para o numero do sistema, o payload real:
--
--      SELECT recebido_em, reconhecido, telefone, texto, jsonb_pretty(payload)
--        FROM logs_webhook_whatsapp
--       ORDER BY recebido_em DESC LIMIT 1;
--
--      reconhecido = false significa que o parser nao achou telefone/texto naquele formato -
--      e o payload acima e exatamente o que falta para ajusta-lo.
