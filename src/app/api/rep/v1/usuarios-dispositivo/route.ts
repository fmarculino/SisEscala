import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * Higiene de cadastros do dispositivo REP (Fase 7b, 12/08/2026) — o coletor reporta aqui o
 * snapshot COMPLETO de quem está cadastrado no relógio agora (`load_users.fcgi`), não só quem
 * o SisEscala já conhece. Um relógio usado antes por outro sistema chega com cadastros de gente
 * que pode não fazer mais parte do quadro — isto alimenta a tela de higiene em `/marcacoes` para
 * identificar quem não corresponde a nenhum servidor ativo.
 *
 * Só o coletor chama isto (leitura no equipamento, nunca grava nada nele) — a ação de remover
 * fica em `/api/rep/v1/remocoes`, sempre depois de alguém revisar na tela.
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

  const usuarios = Array.isArray(body?.usuarios) ? body.usuarios : []

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_registrar_snapshot_usuarios_dispositivo', {
    p_dispositivo_id: auth.dispositivoId,
    p_usuarios: usuarios,
  })
  if (error) {
    console.error('Falha ao registrar snapshot de usuários do dispositivo:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, ...(data || {}) })
}
