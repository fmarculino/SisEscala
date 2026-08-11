import crypto from 'crypto'

/**
 * Sessão do terminal local (app coletor-rep), sem `supabase.auth`.
 *
 * O terminal /presenca clássico ativa com `supabase.auth.signInWithPassword()` rodando no
 * próprio navegador — o que deixa uma sessão Supabase Auth completa de coordenador naquele
 * computador. Aqui o navegador nunca vê nada além de um cookie httpOnly assinado, que só serve
 * para as duas rotas de `/api/presenca-local/*`. Abrir `/login` ou `/home` no mesmo navegador
 * não autentica nada.
 *
 * O HMAC usa o mesmo esquema do protocolo `/api/rep/v1` (crypto.createHmac, sem dependência
 * nova), só que assina um cookie em vez de um header.
 */

export const TERMINAL_LOCAL_COOKIE = 'terminal_local_session'
// Revogação real é `terminais_locais.ativo`, checado a caractere a cada marcação — não a
// expiração do cookie. 180 dias replica a persistência que o fluxo atual já tem (coordenador
// loga e vai embora por dias).
const MAX_AGE_SEGUNDOS = 180 * 24 * 60 * 60

interface SessionPayload {
  terminal_id: string
  iat: number
}

function getSecret(): string {
  const secret = process.env.TERMINAL_LOCAL_SESSION_SECRET
  if (!secret) {
    throw new Error(
      'TERMINAL_LOCAL_SESSION_SECRET não configurado. Adicione a variável no ambiente '
      + '(Coolify em produção) antes de ativar terminais locais.'
    )
  }
  return secret
}

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('hex')
}

export function criarSessaoTerminalLocal(terminalId: string): { value: string; maxAge: number } {
  const payload: SessionPayload = { terminal_id: terminalId, iat: Date.now() }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const assinatura = sign(payloadB64, getSecret())
  return { value: `${payloadB64}.${assinatura}`, maxAge: MAX_AGE_SEGUNDOS }
}

/** Devolve o terminal_id se o cookie for válido e ainda não tiver expirado; senão, null. */
export function validarSessaoTerminalLocal(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null

  const [payloadB64, assinatura] = cookieValue.split('.')
  if (!payloadB64 || !assinatura) return null

  let secret: string
  try {
    secret = getSecret()
  } catch {
    return null
  }

  const esperada = sign(payloadB64, secret)
  const bufEsperada = Buffer.from(esperada, 'hex')
  const bufRecebida = Buffer.from(assinatura, 'hex')
  if (bufEsperada.length !== bufRecebida.length || !crypto.timingSafeEqual(bufEsperada, bufRecebida)) {
    return null
  }

  let payload: SessionPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (!payload.terminal_id || typeof payload.iat !== 'number') return null
  if (Date.now() - payload.iat > MAX_AGE_SEGUNDOS * 1000) return null

  return payload.terminal_id
}
