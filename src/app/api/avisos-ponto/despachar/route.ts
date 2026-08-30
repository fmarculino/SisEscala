import { NextResponse } from 'next/server'
import { conferirSegredoCron } from '@/utils/segredoCron'
import { createAdminClient } from '@/utils/supabase/server'
import { enviarWhatsAppInterno } from '@/utils/comunicacao/enviar'
import { resolverCanalAvisoPonto } from '@/utils/avisoPontoCanal'

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

    // Fonte unica: src/utils/segredoCron.ts. O segredo deixou de ser aceito por QUERY STRING em
    // 30/08/2026 (achado 15) - `?secret=` vaza para log de proxy, historico de terminal e
    // Referer -, e a comparacao passou a ser em tempo constante.
    const auth = conferirSegredoCron(request)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro }, { status: auth.status })
    }

    const limite = Math.min(Math.max(parseInt(searchParams.get('limite') || '', 10) || LOTE_PADRAO, 1), 50)

    const supabase = await createAdminClient()

    // Expira aqui, e não num agendamento separado: o Supabase desta instalação não tem `pg_cron`
    // (conferido em 09/08/2026 — `schema "cron" does not exist`), e uma tarefa que depende de
    // alguém rodar SQL manualmente toda semana não é uma tarefa, é uma dívida.
    //
    // Rodar a cada minuto é irrelevante em custo: é um UPDATE filtrado sobre uma tabela de ~180
    // linhas que, na prática, casa com zero. E amarra o ciclo de vida do opt-in ao mesmo processo
    // que envia — se o worker não roda, nada é enviado, então nada precisava expirar mesmo.
    const { data: expirados, error: expirarError } = await supabase.rpc('fn_expirar_optin_aviso_ponto')
    if (expirarError) {
      // Não aborta o envio: expirar é higiene, despachar é o trabalho.
      console.error('Falha ao expirar opt-ins vencidos:', expirarError.message)
    }

    // Produz os resumos diários e semanais que já venceram. Fica aqui, e não num agendamento
    // próprio, pelo mesmo motivo da expiração: não há `pg_cron`. Rodar a cada minuto é o que faz
    // o resumo diário chegar em até 1 minuto depois da saída — na prática, "na última batida".
    // É idempotente por (servidor, tipo, referência), então repetir não duplica mensagem.
    const { data: resumos, error: resumoError } = await supabase.rpc('fn_gerar_resumos_aviso_ponto')
    if (resumoError) {
      console.error('Falha ao gerar resumos de ponto:', resumoError.message)
    }

    // Expurgo de logs. A função tem controle próprio de 24 h, então pode ser chamada a cada
    // minuto sem pensar — e vem **desligada** por padrão: só expurga as categorias que tiverem
    // chave configurada em `configuracoes_globais`. Registro de ponto nunca entra nela.
    const { data: expurgados, error: expurgoError } = await supabase.rpc('fn_expurgar_logs_se_devido')
    if (expurgoError) {
      console.error('Falha no expurgo de logs:', expurgoError.message)
    }

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

    // Canal dedicado ao aviso, quando configurado. Resolvido em @/utils/avisoPontoCanal para que
    // o worker e o webhook usem exatamente a mesma caixa — ver o comentário lá.
    const overrideCanal = await resolverCanalAvisoPonto()

    // Sequencial de propósito: disparo em paralelo é justamente o padrão que o WhatsApp
    // classifica como bulk. O lote é pequeno, então o tempo total não é problema.
    for (const aviso of fila) {
      let sucesso = false
      let motivo: string | null = null

      try {
        const res = await enviarWhatsAppInterno({
          phone: aviso.telefone,
          message: aviso.mensagem,
          // Resolve o canal próprio da unidade e cai no global quando não houver.
          unidadeId: aviso.unidade_id || undefined,
          // Quando existe canal dedicado ao aviso, ele vence os dois — é o mais específico.
          overrideConfigs: overrideCanal,
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
      optinsExpirados: typeof expirados === 'number' ? expirados : 0,
      resumosGerados: typeof resumos === 'number' ? resumos : 0,
      logsExpurgados: typeof expurgados === 'number' ? expurgados : 0,
    })
  } catch (error: any) {
    console.error('Erro no worker de avisos de ponto:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
