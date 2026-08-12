import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * O coletor reporta aqui os `identificador_afd` (formato 12 dígitos, mesma convenção de
 * `rep_vinculos_servidor`) que, na última leitura do relógio (`load_users.fcgi`, ver
 * `rep/client.go`), aparecem com biometria cadastrada. Casa por `identificador_afd`, não por um
 * "id" de dispositivo — confirmado em 12/08/2026 que esta linha de equipamento (REP-C/iDClass)
 * não expõe um id interno separado de `pis`/`registration`. Só liga
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

  const identificadoresAfd: string[] = Array.isArray(body?.identificadores_afd) ? body.identificadores_afd : []

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_atualizar_biometria_vinculos', {
    p_dispositivo_id: auth.dispositivoId,
    p_identificadores_afd: identificadoresAfd,
  })
  if (error) {
    console.error('Falha ao atualizar biometria dos vínculos:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, atualizados: data })
}
