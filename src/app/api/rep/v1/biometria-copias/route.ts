import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * Sincronização de biometria entre relógios da MESMA unidade.
 *
 * O dispositivo autenticado é sempre o **destino** — quem está recebendo a digital. O GET
 * responde quem falta e em qual outro relógio da unidade buscar; o POST registra o resultado.
 *
 * ⚠️ **O template não passa por aqui.** A cópia é equipamento → equipamento, feita pelo coletor
 * dentro da unidade (a mesma máquina enxerga os dois relógios, e o servidor não tem rota até essa
 * rede de qualquer forma). Este endpoint move nomes e identificadores, nunca dado biométrico —
 * uma cópia a mais de digital, num sistema que não precisa dela, é risco sem contrapartida.
 */
export async function GET(request: Request) {
  const auth = await autenticarDispositivoRep(request, '')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_biometria_faltante_dispositivo', {
    p_destino_id: auth.dispositivoId,
  })
  if (error) {
    console.error('Falha ao listar biometria faltante:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ pendencias: data || [] })
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

  const servidorId: string = body?.servidor_id
  const origemId: string = body?.origem_id
  if (!servidorId || !origemId) {
    return NextResponse.json({ error: 'servidor_id e origem_id são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_registrar_copia_biometria', {
    p_destino_id: auth.dispositivoId,
    p_servidor_id: servidorId,
    p_origem_id: origemId,
    p_sucesso: body?.sucesso === true,
    p_templates: Number(body?.templates ?? 0) || 0,
    p_erro: body?.erro ?? null,
    p_formato_usado: body?.formato_usado ?? null,
    p_coletor_host: body?.coletor_host ?? null,
  })
  if (error) {
    console.error('Falha ao registrar cópia de biometria:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data })
}
