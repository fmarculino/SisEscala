import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * O coletor reporta aqui os `device_user_id` que, na última leitura do relógio
 * (`load_objects.fcgi`, ver `rep/client.go`), aparecem com biometria cadastrada. Só liga
 * `rep_vinculos_servidor.tem_biometria` — nunca desliga: uma leitura parcial ou falha de rede
 * não pode fazer alguém que já cadastrou o dedo voltar a aparecer como pendente.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const auth = await autenticarDispositivoRep(request, rawBody)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const deviceUserIds: number[] = Array.isArray(body?.device_user_ids) ? body.device_user_ids : []

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_atualizar_biometria_vinculos', {
    p_dispositivo_id: auth.dispositivoId,
    p_device_user_ids: deviceUserIds,
  })
  if (error) {
    console.error('Falha ao atualizar biometria dos vínculos:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, atualizados: data })
}
