import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * `fn_autenticar_dispositivo_rep` já atualiza `ultimo_contato_em`/`ultimo_ip_origem` como
 * efeito colateral da autenticação bem-sucedida. Esta rota soma a deriva de relógio: o
 * coletor nunca ajusta o relógio do REP em silêncio (é operação legalmente registrável num
 * REP-C), só reporta a diferença para o módulo alertar.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const auth = await autenticarDispositivoRep(request, rawBody)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    body = {}
  }

  let derivaSegundos: number | null = null
  const relogioDevice: string | undefined = body?.relogio_device
  if (relogioDevice) {
    const deviceMs = Date.parse(relogioDevice)
    if (Number.isFinite(deviceMs)) {
      derivaSegundos = Math.round((deviceMs - Date.now()) / 1000)
      const supabase = await createAdminClient()
      const { error } = await supabase
        .from('dispositivos_rep')
        .update({ deriva_segundos: derivaSegundos })
        .eq('id', auth.dispositivoId)
      if (error) console.error('Falha ao gravar deriva de relógio:', error.message)
    }
  }

  return NextResponse.json({ success: true, deriva_segundos: derivaSegundos })
}
