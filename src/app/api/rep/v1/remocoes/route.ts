import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * Fila de remoção de usuário do dispositivo REP (Fase 7b — higiene de cadastros de outro
 * sistema, 12/08/2026). Só existe item aqui depois que um admin/super_admin revisou a lista na
 * tela de higiene (`/marcacoes`) e confirmou explicitamente — `fn_enfileirar_remocao_usuarios_dispositivo`
 * já recusa quem tem `rep_vinculos_servidor` vigente para um servidor Ativo.
 *
 * GET  — o coletor pergunta quem está pendente de remoção para o dispositivo autenticado.
 * POST — o coletor confirma o resultado de cada remoção (sucesso ou falha).
 */
export async function GET(request: Request) {
  const auth = await autenticarDispositivoRep(request, '')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_remocoes_pendentes_dispositivo', {
    p_dispositivo_id: auth.dispositivoId,
  })
  if (error) {
    console.error('Falha ao listar remoções pendentes:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data || [])
}

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

  const filaId: string | undefined = body?.fila_id
  const sucesso: boolean | undefined = body?.sucesso
  if (!filaId || typeof sucesso !== 'boolean') {
    return NextResponse.json({ error: 'fila_id e sucesso são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase.rpc('fn_confirmar_remocao_usuario_dispositivo', {
    p_fila_id: filaId,
    p_sucesso: sucesso,
    p_erro: body?.erro ?? null,
    // ⚠️ ITEM 10 DA AUDITORIA — ver o comentário em pendencias/route.ts.
    p_dispositivo_id: auth.dispositivoId,
  })
  if (error) {
    console.error('Falha ao confirmar remoção REP:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
