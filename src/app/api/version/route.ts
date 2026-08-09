import { NextResponse } from 'next/server'

// Versão que o SERVIDOR está servindo. O terminal de ponto compara com a versão que ele próprio
// carregou (`NEXT_PUBLIC_APP_VERSION`, inlinada no bundle no momento do build) para saber que
// está rodando código velho — ver src/app/presenca/page.tsx.
//
// Os dois lados leem o MESMO literal, inlinado por next.config.js no build. Nada é calculado em
// tempo de execução aqui: se este valor pudesse mudar sem o bundle mudar, o terminal entraria em
// laço de recarga.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? null },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
