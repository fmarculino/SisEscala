import { headers } from 'next/headers'

/**
 * URL pública da instalação — FONTE ÚNICA.
 *
 * ⚠️ `new URL(request.url).origin` NÃO é confiável atrás do proxy do Coolify: já produziu
 * `http://localhost:3000` num download real (o bind interno do servidor standalone, não o
 * domínio público), e esse valor inútil foi parar no `config.yaml` de quem tentava instalar o
 * coletor. Esta função existe por causa disso.
 *
 * A lógica vinha de `resolverUrlPublica`, em `src/app/api/coletor-rep/download/route.ts`, onde
 * está em produção e funcionando. Foi extraída em 30/08/2026 quando o link mágico de sobreaviso
 * precisou da mesma resposta — o comentário daquela função já dizia que as duas eram a mesma
 * necessidade.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ORDEM DE CONFIANÇA, e ela importa
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * 1. **`NEXT_PUBLIC_SITE_URL`** — propriedade da INSTALAÇÃO, não da requisição. É a única fonte
 *    que um atacante não influencia. **É a que deve estar configurada.**
 *
 * 2. **`X-Forwarded-Host` + `X-Forwarded-Proto`** — o Traefik (proxy do Coolify) os define a
 *    partir do `Host` da requisição.
 *
 *    ⚠️ Isso é um degrau ABAIXO em confiança: quem controla o `Host` influencia o resultado.
 *    Para o link de sobreaviso — que vai por WhatsApp carregando o token do chamado — isso
 *    importa. **Configure `NEXT_PUBLIC_SITE_URL` e esse degrau deixa de ser usado.**
 *
 *    O fallback existe porque, sem ele, a ausência da variável derruba a função inteira; e
 *    porque é estritamente melhor que o que havia antes no sobreaviso, que era o `origin`
 *    mandado pelo NAVEGADOR (achado 12: totalmente controlado por quem chama, sem proxy nenhum
 *    no caminho).
 *
 * 3. `null` — quem chama decide o que fazer, e deve falhar explicitamente.
 */
export function urlPublicaDeRequest(request: Request): string | null {
  const daVariavel = process.env.NEXT_PUBLIC_SITE_URL
  if (daVariavel) return daVariavel.replace(/\/$/, '')

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (forwardedHost) {
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
    return `${forwardedProto}://${forwardedHost}`
  }

  return null
}

/**
 * Mesma resolução, para Server Action — que não recebe um `Request`, e por isso lê os cabeçalhos
 * pelo `headers()` do Next.
 */
export async function urlPublicaDeHeaders(): Promise<string | null> {
  const daVariavel = process.env.NEXT_PUBLIC_SITE_URL
  if (daVariavel) return daVariavel.replace(/\/$/, '')

  const h = await headers()
  const forwardedHost = h.get('x-forwarded-host') || h.get('host')
  if (forwardedHost) {
    const forwardedProto = h.get('x-forwarded-proto') || 'https'
    return `${forwardedProto}://${forwardedHost}`
  }

  return null
}

/** `true` quando a URL veio da variável de ambiente (a fonte confiável), não de cabeçalho. */
export function urlPublicaVemDeVariavel(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SITE_URL)
}
