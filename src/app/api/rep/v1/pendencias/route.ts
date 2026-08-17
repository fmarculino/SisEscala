import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * Fila de pendências de cadastro (push SisEscala -> REP, Fase 7 — parte de identidade). A
 * biometria em si nunca passa por aqui: sempre exige alguém presente no equipamento (o sensor
 * captura o dedo, não é enviável por API). O que o coletor recebe daqui é matrícula/nome/CPF
 * pronto para virar um usuário "vazio" no relógio — quem for cadastrar a digital não precisa
 * digitar tudo na telinha do aparelho.
 *
 * GET  — o coletor pergunta o que está pendente para o dispositivo autenticado.
 * POST — o coletor confirma o resultado de cada item (sucesso com device_user_id, ou falha).
 */
export async function GET(request: Request) {
  const auth = await autenticarDispositivoRep(request, '')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_cadastros_pendentes_dispositivo', {
    p_dispositivo_id: auth.dispositivoId,
  })
  if (error) {
    console.error('Falha ao listar cadastros pendentes:', error.message)
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
  const { error } = await supabase.rpc('fn_confirmar_cadastro_rep', {
    p_fila_id: filaId,
    p_sucesso: sucesso,
    p_device_user_id: body?.device_user_id ?? null,
    p_erro: body?.erro ?? null,
    // O identificador que o RELÓGIO reportou, não o que o SisEscala calcularia do CPF — é isso
    // que faz o vínculo casar com as linhas do AFD num relógio cadastrado por PIS. Ausente cai no
    // cálculo por CPF (migration 20260817180000).
    p_identificador_afd: body?.identificador_afd ?? null,
    // Falha de transporte volta para a fila com espera; recusa do equipamento é definitiva.
    p_transitorio: body?.transitorio === true,
  })
  if (error) {
    console.error('Falha ao confirmar cadastro REP:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
