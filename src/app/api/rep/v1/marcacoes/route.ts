import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * Recebe um lote de linhas de AFD do coletor-rep e delega para `fn_ingerir_afd`, que já faz
 * parse, cadeia de hash e resolução de vínculo servidor↔identificador em transação única. Ver
 * `fn_ingerir_afd` em `supabase/migrations/20260808080000_add_rep_ingestion.sql`.
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

  const { lote_id, linhas, arquivo_sha256, coletor_versao, coletor_host } = body || {}
  if (!lote_id || !Array.isArray(linhas)) {
    return NextResponse.json({ error: 'lote_id e linhas são obrigatórios.' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_ingerir_afd', {
    p_dispositivo_id: auth.dispositivoId,
    p_lote_id: lote_id,
    p_linhas: linhas,
    p_canal: 'coletor_http',
    p_arquivo_sha256: arquivo_sha256 || null,
    p_coletor_versao: coletor_versao || null,
    p_coletor_host: coletor_host || null,
    p_ip: ip,
    p_importado_por: null,
    p_assinatura_ok: null,
  })

  if (error) {
    console.error('Falha ao ingerir AFD:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
