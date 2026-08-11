import crypto from 'crypto'
import { createAdminClient } from '@/utils/supabase/server'

/**
 * Autenticação das rotas `/api/rep/v1/*`, chamadas pelo coletor-rep (não por navegador).
 *
 * Deliberadamente NÃO copia o padrão de `/api/cron` (segredo único compartilhado, com
 * fallback hardcoded no código) — ver a seção "Protocolo" de
 * docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md. Cada dispositivo tem seu próprio
 * token (`fn_gerar_token_dispositivo_rep`/`fn_autenticar_dispositivo_rep`), e cada requisição
 * carrega uma assinatura anti-replay derivada desse token.
 *
 * Headers exigidos:
 *   Authorization: Bearer <token>
 *   X-SisEscala-Dispositivo: <uuid>
 *   X-SisEscala-Timestamp: <epoch ms>
 *   X-SisEscala-Assinatura: HMAC-SHA256(token, timestamp || sha256(body)), em hex
 *
 * `body` é o corpo bruto da requisição (string vazia em GET). Timestamp com desvio maior que
 * 5 minutos é recusado.
 */
export async function autenticarDispositivoRep(
  request: Request,
  rawBody: string
): Promise<{ ok: true; dispositivoId: string } | { ok: false; status: number; error: string }> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const dispositivoId = request.headers.get('x-sisescala-dispositivo')
  const timestamp = request.headers.get('x-sisescala-timestamp')
  const assinatura = request.headers.get('x-sisescala-assinatura')

  if (!token || !dispositivoId || !timestamp || !assinatura) {
    return { ok: false, status: 401, error: 'Autenticação incompleta.' }
  }

  const agora = Date.now()
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(agora - ts) > 5 * 60 * 1000) {
    return { ok: false, status: 401, error: 'Timestamp fora da janela permitida (anti-replay).' }
  }

  const bodySha256 = crypto.createHash('sha256').update(rawBody).digest('hex')
  const esperada = crypto.createHmac('sha256', token).update(timestamp + bodySha256).digest('hex')

  let assinaturaValida: boolean
  try {
    const bufEsperada = Buffer.from(esperada, 'hex')
    const bufRecebida = Buffer.from(assinatura, 'hex')
    assinaturaValida = bufEsperada.length === bufRecebida.length && crypto.timingSafeEqual(bufEsperada, bufRecebida)
  } catch {
    assinaturaValida = false
  }
  if (!assinaturaValida) {
    return { ok: false, status: 401, error: 'Assinatura inválida.' }
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const supabase = await createAdminClient()
  const { data: autenticado, error } = await supabase.rpc('fn_autenticar_dispositivo_rep', {
    p_dispositivo_id: dispositivoId,
    p_token: token,
    p_ip: ip,
  })

  if (error) {
    console.error('Falha ao autenticar dispositivo REP:', error.message)
    return { ok: false, status: 500, error: 'Falha ao autenticar dispositivo.' }
  }
  if (!autenticado) {
    return { ok: false, status: 401, error: 'Dispositivo ou token inválido.' }
  }

  return { ok: true, dispositivoId }
}
