import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { criarSessaoTerminalLocal, TERMINAL_LOCAL_COOKIE } from '@/utils/terminalLocalSession'

/**
 * Ativa um terminal local a partir do token gerado na tela de gestão (`/marcacoes`,
 * aba Terminais Locais) e devolvido pelo app coletor-rep. Chamada pela página
 * `/presenca-local/ativar`, que a página abre uma única vez por sessão longa.
 *
 * Sucesso grava um cookie httpOnly assinado — nunca o token cru, nunca uma sessão
 * Supabase Auth. É esse cookie, e só ele, que autoriza `/api/presenca-local/registrar`.
 */
export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const terminalId: string | undefined = body?.terminal_id
  const token: string | undefined = body?.token
  if (!terminalId || !token) {
    return NextResponse.json({ error: 'terminal_id e token são obrigatórios.' }, { status: 400 })
  }

  const ipOrigem =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

  let sessao: { value: string; maxAge: number }
  try {
    const supabase = await createAdminClient()
    const { data: autenticado, error } = await supabase.rpc('fn_autenticar_terminal_local', {
      p_terminal_id: terminalId,
      p_token: token,
      p_ip: ipOrigem,
    })

    if (error) {
      console.error('Falha ao autenticar terminal local:', error.message)
      return NextResponse.json({ error: 'Falha ao autenticar terminal.' }, { status: 500 })
    }
    if (!autenticado) {
      return NextResponse.json({ error: 'Terminal ou token inválido.' }, { status: 401 })
    }

    sessao = criarSessaoTerminalLocal(terminalId)
  } catch (err: any) {
    // TERMINAL_LOCAL_SESSION_SECRET ausente cai aqui — falha explícita, nunca um segredo
    // fixo no código (é exatamente o padrão que o fallback hardcoded do /api/cron provou ser ruim).
    console.error('Erro ao ativar terminal local:', err.message)
    return NextResponse.json({ error: 'Terminal local não configurado no servidor.' }, { status: 500 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(TERMINAL_LOCAL_COOKIE, sessao.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/presenca-local',
    maxAge: sessao.maxAge,
  })
  return response
}
