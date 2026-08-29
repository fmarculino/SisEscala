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

  // O heartbeat é a única chamada que TODO ciclo faz — o sync incremental (v0.5.0) pode não ter
  // lote nenhum a enviar num relógio sem batida nova. Por isso é aqui que a versão do coletor se
  // mantém fresca no card de /marcacoes. Coletor anterior à 0.8.0 não manda esses campos: fica
  // com o que a rota de marcações gravou no último lote, nunca com um valor inventado aqui.
  const atualizacao: Record<string, any> = {}

  let derivaSegundos: number | null = null
  const relogioDevice: string | undefined = body?.relogio_device
  if (relogioDevice) {
    const deviceMs = Date.parse(relogioDevice)
    if (Number.isFinite(deviceMs)) {
      derivaSegundos = Math.round((deviceMs - Date.now()) / 1000)
      atualizacao.deriva_segundos = derivaSegundos
    }
  }

  const coletorVersao: string | undefined = body?.coletor_versao
  if (typeof coletorVersao === 'string' && coletorVersao.trim()) {
    atualizacao.coletor_versao = coletorVersao.trim().slice(0, 32)
    atualizacao.coletor_versao_em = new Date().toISOString()
    const coletorHost: string | undefined = body?.coletor_host
    if (typeof coletorHost === 'string' && coletorHost.trim()) {
      atualizacao.coletor_host = coletorHost.trim().slice(0, 128)
    }
    // IP da máquina do coletor NA REDE DA UNIDADE — não confundir com ultimo_ip_origem, que é
    // o IP público por onde a requisição chegou (o mesmo para todas as máquinas de uma unidade,
    // e inútil para alcançar o computador certo). Coletor anterior à v0.13.0 não manda: o campo
    // fica como está, nunca preenchido com um palpite daqui.
    const coletorIp: string | undefined = body?.coletor_ip
    if (typeof coletorIp === 'string' && coletorIp.trim()) {
      atualizacao.coletor_ip = coletorIp.trim().slice(0, 64)
    }
  }

  if (Object.keys(atualizacao).length > 0) {
    const supabase = await createAdminClient()
    const { error } = await supabase
      .from('dispositivos_rep')
      .update(atualizacao)
      .eq('id', auth.dispositivoId)
    if (error) console.error('Falha ao gravar estado do coletor:', error.message)
  }

  return NextResponse.json({ success: true, deriva_segundos: derivaSegundos })
}
