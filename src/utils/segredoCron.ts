import crypto from 'crypto'

/**
 * Autenticação das rotas de máquina (`/api/cron`, `/api/avisos-ponto/despachar`) — FONTE ÚNICA.
 *
 * Achado 15 da auditoria de 30/08/2026. Duas correções sobre o que existia:
 *
 * 1. **O segredo deixa de ser aceito por query string.** `?secret=…` aparece em log de acesso do
 *    proxy, em histórico de terminal, no `Referer` de qualquer link seguido a partir da resposta
 *    e em qualquer captura de tráfego do lado do servidor. Um segredo que autoriza FECHAR
 *    escalas e folhas não pode viver na URL. Só `Authorization: Bearer <segredo>`.
 *
 * 2. **A comparação passa a ser em tempo constante.** `!==` desiste no primeiro byte diferente,
 *    o que em tese vaza o prefixo correto. Contra um segredo aleatório o ataque é impraticável
 *    pela rede — mas `timingSafeEqual` custa uma linha e tira a discussão da mesa.
 *
 * ⚠️ **Sem `CRON_SECRET` no ambiente, as rotas devolvem 500 e o cron NÃO roda** — comportamento
 * herdado de 22/08/2026 e deliberado. O que existia antes era `process.env.CRON_SECRET ||
 * '<literal>'` num repositório PÚBLICO (armadilha 18): quem lesse o repo fechava escalas.
 * Falhar alto é o modo de falha desejado; nunca reintroduza um valor embutido.
 */

export type ResultadoSegredo =
  | { ok: true }
  | { ok: false; status: 401 | 500; erro: string }

export function conferirSegredoCron(request: Request): ResultadoSegredo {
  const esperado = process.env.CRON_SECRET
  if (!esperado) {
    return {
      ok: false,
      status: 500,
      erro: 'CRON_SECRET não configurado no ambiente (Coolify em produção).',
    }
  }

  const authHeader = request.headers.get('authorization')
  const fornecido = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

  if (!fornecido) {
    return {
      ok: false,
      status: 401,
      erro: 'Não autorizado. Use o cabeçalho Authorization: Bearer <segredo>.',
    }
  }

  if (!iguaisEmTempoConstante(fornecido, esperado)) {
    return { ok: false, status: 401, erro: 'Não autorizado' }
  }

  return { ok: true }
}

/**
 * Comparação de segredo em tempo constante.
 *
 * ⚠️ `timingSafeEqual` LANÇA quando os buffers têm tamanhos diferentes — e o tamanho do que foi
 * enviado é escolhido por quem chama. Comparar o comprimento antes é obrigatório, e não vaza
 * nada de útil: o tamanho de um segredo não é o segredo.
 *
 * Exportada porque o webhook do WhatsApp (`/api/avisos-ponto/webhook`) precisa dela mas **não**
 * pode usar `conferirSegredoCron`: ele usa outro segredo (`WHATSAPP_WEBHOOK_SECRET`) e, ao
 * contrário do cron, **quem o chama é um provedor externo** (AstraCall). Exigir
 * `Authorization: Bearer` ali depende de o provedor permitir cabeçalho customizado — se não
 * permitir, a confirmação de aviso de ponto para de chegar. Por isso o webhook mantém a query
 * string e ganha só a comparação em tempo constante. **Se for confirmado que o provedor envia
 * cabeçalho, feche a query string lá também.**
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}
