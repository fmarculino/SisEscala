import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { sendWhatsAppMessageAction } from '@/app/actions/communication'

/**
 * Worker do aviso de ponto por WhatsApp.
 *
 * Drena `avisos_ponto_fila`, enfileirada pelo gatilho `trg_enfileirar_aviso_ponto`
 * (migration 20260809120000). Chamado por cron a cada minuto, no mesmo padrão de
 * `/api/cron` — protegido por CRON_SECRET.
 *
 * POR QUE UM WORKER, E NÃO ENVIO NO ATO DA BATIDA
 *   1. O terminal chama `fn_registrar_ponto` direto do navegador. Um timeout de 12 s da API do
 *      AstraCalls no caminho da confirmação vira 12 s de tela travada — e servidor impaciente
 *      batendo de novo.
 *   2. O terminal fica dias aberto sem recarregar. Se o disparo dependesse do bundle do cliente,
 *      um terminal desatualizado deixaria de enviar em silêncio — exatamente a falha de
 *      09/08/2026 que motivou a v1.27.0.
 *
 * O lote é pequeno de propósito. O número em uso também serve o acionamento de sobreaviso; um
 * banimento derrubaria o fluxo de urgência da rede junto.
 */

const LOTE_PADRAO = 20

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    const authHeader = request.headers.get('authorization')

    const expectedSecret = process.env.CRON_SECRET || 'sis-escala-cron-token-2026'
    const providedSecret = secret || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null)

    if (providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const limite = Math.min(Math.max(parseInt(searchParams.get('limite') || '', 10) || LOTE_PADRAO, 1), 50)

    const supabase = await createAdminClient()

    // Reserva o lote e já incrementa a tentativa. FOR UPDATE SKIP LOCKED lá dentro garante que
    // duas execuções sobrepostas do cron não peguem o mesmo aviso.
    const { data: pendentes, error } = await supabase.rpc('fn_avisos_ponto_pendentes', {
      p_limite: limite,
    })

    if (error) {
      return NextResponse.json({ error: `Falha ao ler a fila: ${error.message}` }, { status: 500 })
    }

    const fila: any[] = Array.isArray(pendentes) ? pendentes : []
    let enviados = 0
    let falhas = 0

    // Sequencial de propósito: disparo em paralelo é justamente o padrão que o WhatsApp
    // classifica como bulk. O lote é pequeno, então o tempo total não é problema.
    for (const aviso of fila) {
      let sucesso = false
      let motivo: string | null = null

      try {
        const res = await sendWhatsAppMessageAction({
          phone: aviso.telefone,
          message: aviso.mensagem,
          // Resolve o canal próprio da unidade e cai no global quando não houver.
          unidadeId: aviso.unidade_id || undefined,
        })
        sucesso = !!res.success
        // `fallbackUrl` é ignorado: não há humano na frente para clicar no WhatsApp Web.
        if (!sucesso) motivo = res.error || 'Falha desconhecida no envio.'
      } catch (err: any) {
        motivo = err?.message || 'Exceção no envio.'
      }

      // Fechar a fila não pode derrubar o lote inteiro.
      const { error: concluirError } = await supabase.rpc('fn_concluir_aviso_ponto', {
        p_id: aviso.id,
        p_sucesso: sucesso,
        p_motivo: motivo,
      })
      if (concluirError) {
        console.error('Falha ao concluir aviso de ponto', aviso.id, concluirError.message)
      }

      if (sucesso) enviados++
      else falhas++
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processados: fila.length,
      enviados,
      falhas,
    })
  } catch (error: any) {
    console.error('Erro no worker de avisos de ponto:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
