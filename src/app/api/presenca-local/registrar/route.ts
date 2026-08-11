import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/utils/supabase/server'
import { validarSessaoTerminalLocal, TERMINAL_LOCAL_COOKIE } from '@/utils/terminalLocalSession'

/**
 * Registra uma batida a partir da tela `/presenca-local`. Autentica só pelo cookie de sessão
 * do terminal — nunca por sessão Supabase Auth. `fn_registrar_ponto_terminal_local` confere
 * escopo de unidade/setor e se o terminal continua ativo antes de delegar para o caminho
 * normal (`fn_registrar_ponto`), então a resposta segue o mesmo formato que o terminal
 * clássico já trata (`success`/`tipo`/`message`).
 */
export async function POST(request: Request) {
  const cookieStore = await cookies()
  const terminalId = validarSessaoTerminalLocal(cookieStore.get(TERMINAL_LOCAL_COOKIE)?.value)

  if (!terminalId) {
    return NextResponse.json(
      { success: false, tipo: 'nao_ativado', message: 'Terminal não ativado. Reabra pelo aplicativo local.' },
      { status: 401 }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const matricula: string | undefined = body?.matricula
  const pin: string | undefined = body?.pin
  if (!matricula || !pin) {
    return NextResponse.json({ error: 'matricula e pin são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_registrar_ponto_terminal_local', {
    p_terminal_id: terminalId,
    p_matricula: matricula,
    p_pin_servidor: pin,
  })

  if (error) {
    console.error('Falha ao registrar ponto no terminal local:', error.message)
    return NextResponse.json(
      { success: false, tipo: 'erro', message: 'Ocorreu um erro de comunicação com o servidor.' },
      { status: 500 }
    )
  }

  const resultado = Array.isArray(data) ? data[0] : data
  return NextResponse.json(resultado)
}
