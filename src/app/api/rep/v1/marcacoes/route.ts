import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'
import { reconciliarSincronizacaoAfd } from '@/utils/reconciliacaoHelper'

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

  // Espelha a versão do coletor no próprio dispositivo, além da linha de rep_sincronizacoes que
  // `fn_ingerir_afd` já grava. É o que faz a tela de /marcacoes mostrar a versão de coletor
  // ANTERIOR à 0.8.0 (que não reporta nada no heartbeat, mas sempre mandou coletor_versao aqui).
  // Falha em silêncio de propósito: nunca pode derrubar a ingestão de uma batida.
  if (typeof coletor_versao === 'string' && coletor_versao.trim()) {
    const { error: erroVersao } = await supabase
      .from('dispositivos_rep')
      .update({
        coletor_versao: coletor_versao.trim().slice(0, 32),
        coletor_host: typeof coletor_host === 'string' && coletor_host.trim() ? coletor_host.trim().slice(0, 128) : null,
        coletor_versao_em: new Date().toISOString(),
      })
      .eq('id', auth.dispositivoId)
    if (erroVersao) console.error('Falha ao gravar versão do coletor:', erroVersao.message)
  }

  // Reconciliação em tempo real de escala_diaria para os servidores que bateram ponto no lote
  if (data?.sincronizacao_id && (data?.marcacoes || 0) > 0) {
    await reconciliarSincronizacaoAfd(data.sincronizacao_id)
  }

  return NextResponse.json(data)
}
