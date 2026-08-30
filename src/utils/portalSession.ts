import crypto from 'crypto'

/**
 * Sessão do Portal do Servidor (/consultar-escala), assinada por HMAC.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE (achado 1 da auditoria de 30/08/2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Até 30/08/2026 a "sessão" do portal era o UUID do servidor gravado EM TEXTO PURO num cookie:
 *
 *     cookieStore.set('portal_servidor_id', servidor.id, { httpOnly: true, ... })
 *
 * `httpOnly` impede que o JavaScript da página LEIA o cookie. Não impede — e nunca impediu —
 * que alguém MONTE a requisição com o cookie que quiser:
 *
 *     curl -H 'Cookie: portal_servidor_id=<uuid de qualquer servidor>' ...
 *
 * E o UUID necessário era entregue pela própria aplicação: `findServidorByMatricula` é uma
 * Server Action SEM AUTENTICAÇÃO, chamável a partir de /consultar-escala — rota que o middleware
 * isenta de login (src/utils/supabase/middleware.ts:115). Matrícula é numérica e curta, então
 * enumerar era trivial. Resultado: qualquer pessoa montava a sessão de qualquer servidor da rede
 * municipal sem nunca conhecer o PIN, e o bloqueio de 5 tentativas ficava decorativo.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * REGRAS QUE NÃO PODEM SER DESFEITAS
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * 1. O cookie NUNCA volta a ser um identificador cru. O que vai nele é `payload.assinatura`, e
 *    `validarSessaoPortal` é o único jeito de tirar um `servidor_id` de lá.
 *
 * 2. As Server Actions do portal DERIVAM o `servidor_id` daqui — nunca o recebem do cliente.
 *    Derivar é mais forte que comparar (`if (cookie !== param) return erro`): comparar exige que
 *    cada ação nova lembre de fazê-lo, e 12 das 30 ações do portal não lembraram. Ver o portão
 *    em scratchpad/sim_portal_sessao.js, que reprova quem aceitar `servidorId` do cliente.
 *
 * 3. `findServidorByMatricula` NÃO devolve o UUID. Devolve só o nome, para a tela confirmar
 *    "é você?". Quem entrega identidade antes do PIN entrega a chave da sessão junto.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SEGREDO
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Primário: `PORTAL_SESSION_SECRET`.
 *
 * Se ele não existir, cai para `TERMINAL_LOCAL_SESSION_SECRET` — que já está no ambiente de
 * produção desde 11/08/2026. Isso é deliberado e é o oposto do anti-padrão que o CLAUDE.md
 * proíbe: o proibido é `process.env.X || 'valor-literal'`, um segredo PUBLICADO no código de um
 * repositório público. Aqui não há valor embutido; há uma segunda variável de ambiente, para que
 * o deploy desta correção não derrube o portal de ~500 servidores caso a variável nova ainda não
 * tenha sido cadastrada no Coolify.
 *
 * A reutilização é segura porque a assinatura leva SEPARAÇÃO DE DOMÍNIO (`CONTEXTO`): um cookie
 * de terminal local jamais valida como sessão de portal, e vice-versa, mesmo com o mesmo segredo.
 *
 * ⚠️ Sem NENHUMA das duas variáveis, isto LANÇA. É o modo de falha desejado — igual ao de
 * `TERMINAL_LOCAL_SESSION_SECRET` e ao do `CRON_SECRET` depois de 22/08/2026.
 */

export const PORTAL_COOKIE = 'portal_sessao'

/**
 * Nome do cookie ANTIGO (UUID cru). Continua aqui só para ser APAGADO no login e no logout —
 * enquanto ele existir no navegador de alguém, existe um cookie forjável em circulação.
 * ⚠️ Nada deve LER este cookie. Se algum código voltar a lê-lo, a correção inteira é anulada.
 */
export const PORTAL_COOKIE_LEGADO = 'portal_servidor_id'

/** Mesma validade de antes (4 h). Trocar isto muda quanto tempo o servidor fica logado. */
const MAX_AGE_SEGUNDOS = 4 * 60 * 60

/**
 * Separação de domínio. Entra na mensagem assinada, então a mesma chave produz assinaturas
 * diferentes para propósitos diferentes. ⚠️ Mudar esta string invalida toda sessão em circulação.
 */
const CONTEXTO = 'sisescala:portal-servidor:v1'

interface PortalSessionPayload {
  servidor_id: string
  iat: number
}

function getSecret(): string {
  const secret = process.env.PORTAL_SESSION_SECRET || process.env.TERMINAL_LOCAL_SESSION_SECRET
  if (!secret) {
    throw new Error(
      'PORTAL_SESSION_SECRET não configurado. Adicione a variável no ambiente '
      + '(Coolify em produção) para o Portal do Servidor funcionar.'
    )
  }
  return secret
}

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${CONTEXTO}.${payloadB64}`).digest('hex')
}

export function criarSessaoPortal(servidorId: string): { value: string; maxAge: number } {
  const payload: PortalSessionPayload = { servidor_id: servidorId, iat: Date.now() }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const assinatura = sign(payloadB64, getSecret())
  return { value: `${payloadB64}.${assinatura}`, maxAge: MAX_AGE_SEGUNDOS }
}

/**
 * Devolve o `servidor_id` se o cookie for válido e não tiver expirado; senão, `null`.
 *
 * Qualquer defeito — assinatura errada, formato quebrado, payload adulterado, expirado — cai no
 * mesmo `null`. Não distinguir os casos é intencional: nada aqui deve contar a quem tentou
 * forjar em QUE ponto ele falhou.
 */
export function validarSessaoPortal(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null

  const partes = cookieValue.split('.')
  if (partes.length !== 2) return null
  const [payloadB64, assinatura] = partes
  if (!payloadB64 || !assinatura) return null

  let secret: string
  try {
    secret = getSecret()
  } catch {
    return null
  }

  // Comparação em tempo constante. `timingSafeEqual` exige buffers do mesmo tamanho — daí a
  // checagem de comprimento antes, que não vaza nada (o tamanho da assinatura é público).
  const esperada = sign(payloadB64, secret)
  const bufEsperada = Buffer.from(esperada, 'hex')
  const bufRecebida = Buffer.from(assinatura, 'hex')
  if (bufEsperada.length !== bufRecebida.length || !crypto.timingSafeEqual(bufEsperada, bufRecebida)) {
    return null
  }

  let payload: PortalSessionPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (!payload.servidor_id || typeof payload.servidor_id !== 'string') return null
  if (typeof payload.iat !== 'number') return null
  if (Date.now() - payload.iat > MAX_AGE_SEGUNDOS * 1000) return null

  return payload.servidor_id
}

/**
 * Opções do cookie de sessão do portal.
 *
 * ⚠️ `sameSite: 'lax'` fecha o achado 19: sem ele o navegador mandava o cookie em requisição
 * cross-site, e uma página externa conseguia disparar ação do portal no lugar do servidor (CSRF).
 * 'lax' preserva a navegação normal (clicar num link e chegar logado) e barra POST de terceiro.
 *
 * `path: '/'` é obrigatório e NÃO deve virar '/consultar-escala': a página e as Server Actions
 * podem ser servidas em caminhos distintos, e o cookie precisa alcançar as duas — foi exatamente
 * esse o defeito do terminal local em 11/08/2026, onde ativar funcionava e bater ponto não.
 */
export function opcoesCookiePortal(maxAge: number) {
  return {
    maxAge,
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  }
}
