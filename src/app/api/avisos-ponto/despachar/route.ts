import { NextResponse } from 'next/server'
import { conferirSegredoCron } from '@/utils/segredoCron'
import { createAdminClient } from '@/utils/supabase/server'
import { enviarWhatsAppInterno, enviarEmailInterno } from '@/utils/comunicacao/enviar'
import { resolverCanalAvisoPonto } from '@/utils/avisoPontoCanal'
import { escaparHtml } from '@/utils/htmlSeguro'

/**
 * Worker do aviso de ponto — E-MAIL por padrão, WhatsApp como alternativa.
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

/**
 * Espaçamento entre envios de WhatsApp — obtido pela CADÊNCIA DO CRON, não por espera dentro da
 * requisição.
 *
 * 🚨 **Não use `setTimeout` para espaçar aqui.** A primeira versão desta correção esperava
 * 30–90 s entre cada envio dentro do mesmo laço: um lote de 20 levaria ~20 minutos, e nenhum
 * proxy segura uma requisição HTTP aberta por tanto tempo — o cron receberia timeout e o lote
 * ficaria pela metade, com a fila já marcada como tentada.
 *
 * O desenho certo aproveita o que já existe: **o cron roda a cada minuto**. Então basta enviar
 * **no máximo `MAX_WHATSAPP_POR_RODADA` por invocação** e deixar o intervalo entre rodadas fazer
 * o espaçamento — a requisição termina em segundos.
 *
 * ⚠️ Mas 1 por minuto exato é *cadência regular*, que é justamente o padrão que se quer evitar.
 * Daí `CHANCE_DE_PULAR`: em parte das rodadas o WhatsApp é pulado de propósito, o que espalha o
 * intervalo real entre ~1 e ~5 minutos, com média perto de 2. Sem espera, sem requisição longa.
 *
 * ⚠️ Nada disso vale para e-mail: ele não bloqueia número, e atrasá-lo seria adiar o aviso sem
 * ganho nenhum. O lote de e-mail sai inteiro, na mesma rodada.
 */
const MAX_WHATSAPP_POR_RODADA = 1
const CHANCE_DE_PULAR = 0.45

/** Assunto do e-mail. Curto e estável — quem recebe precisa reconhecer de onde vem. */
function assuntoAviso(tipo: string): string {
  switch (tipo) {
    case 'resumo_semanal': return 'SisEscala — Resumo semanal dos seus registros de ponto'
    case 'resumo_diario': return 'SisEscala — Resumo dos seus registros de ponto'
    case 'confirmacao_optin': return 'SisEscala — Confirmação do aviso de ponto'
    default: return 'SisEscala — Aviso de registro de ponto'
  }
}

/**
 * Corpo HTML do e-mail, a partir da MESMA mensagem que iria por WhatsApp.
 *
 * ⚠️ O texto é o mesmo de propósito — não existe uma segunda redação para manter em dia. O que
 * muda é só a moldura.
 *
 * ⚠️ `escaparHtml` é obrigatório aqui: a mensagem carrega nome de servidor e nome de unidade,
 * vindos do banco. É a mesma regra dos relatórios (armadilha 37) — texto de banco nunca entra em
 * HTML sem escape.
 */
function corpoEmail(mensagem: string): string {
  const corpo = escaparHtml(mensagem).replace(/\n/g, '<br>')
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#18181b;max-width:560px">
  <p style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#71717a;margin:0 0 14px">
    Secretaria Municipal de Saúde · Marabá / PA
  </p>
  <div style="padding:18px 20px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px">${corpo}</div>
  <p style="font-size:12px;color:#71717a;margin:18px 0 0">
    Este aviso é informativo e não substitui a sua folha de ponto. Seus registros oficiais estão
    no Portal do Servidor. Para trocar o canal ou a frequência deste aviso, acesse o Portal.
  </p>
</div>`
}

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
    // ⚠️ O teto de WhatsApp DESTA rodada vai para a RPC, e não é aplicado aqui depois de
    // reservar: a função incrementa `tentativas` no momento em que reserva. Reservar 20 e enviar
    // 1 devolveria os outros 19 à fila com uma tentativa gasta sem nada ter sido tentado — e em
    // 3 rodadas eles morreriam como falha sem que uma única mensagem tivesse saído.
    //
    // `pularWhatsAppNestaRodada` é o que evita a cadência regular de "1 por minuto": em ~45% das
    // rodadas nenhum WhatsApp é reservado, o que espalha o intervalo real entre ~1 e ~5 minutos.
    const pularWhatsAppNestaRodada = Math.random() < CHANCE_DE_PULAR
    const { data: pendentes, error } = await supabase.rpc('fn_avisos_ponto_pendentes', {
      p_limite: limite,
      p_limite_whatsapp: pularWhatsAppNestaRodada ? 0 : MAX_WHATSAPP_POR_RODADA,
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
    let enviadosWhatsApp = 0
    let enviadosEmail = 0

    for (const aviso of fila) {
      let sucesso = false
      let motivo: string | null = null

      // O canal vem RESOLVIDO e GRAVADO pela RPC (`fn_avisos_ponto_pendentes`, migration
      // 20260830150000). `telefone` continua sendo lido como último recurso só para as linhas
      // antigas, enfileiradas antes da coluna existir.
      const canal: 'email' | 'whatsapp' = aviso.canal === 'email' ? 'email' : 'whatsapp'
      const destino: string = aviso.destino || aviso.telefone

      try {
        if (!destino) {
          motivo = 'Sem destino resolvido para o canal.'
        } else if (canal === 'email') {
          // 🚨 Primeiro chamador real de `enviarEmailInterno` no sistema. O motor de e-mail
          // existia desde sempre e nunca tinha sido usado por ninguém — ver o plano em
          // docs/planos/2026-08-30-estrategia-de-canais-e-bloqueios-do-whatsapp.md.
          const res = await enviarEmailInterno({
            to: destino,
            subject: assuntoAviso(aviso.tipo),
            text: aviso.mensagem,
            html: corpoEmail(aviso.mensagem),
            unidadeId: aviso.unidade_id || undefined,
          })
          sucesso = !!res.success
          if (!sucesso) motivo = res.error || 'Falha desconhecida no envio de e-mail.'
          if (sucesso) enviadosEmail++
        } else {
          const res = await enviarWhatsAppInterno({
            phone: destino,
            message: aviso.mensagem,
            // Resolve o canal próprio da unidade e cai no global quando não houver.
            unidadeId: aviso.unidade_id || undefined,
            // Quando existe canal dedicado ao aviso, ele vence os dois — é o mais específico.
            overrideConfigs: overrideCanal,
          })
          sucesso = !!res.success
          // `fallbackUrl` é ignorado: não há humano na frente para clicar no WhatsApp Web.
          if (!sucesso) motivo = res.error || 'Falha desconhecida no envio.'
          if (sucesso) enviadosWhatsApp++
        }
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
      // Quebra por canal: é a medida que diz se a migração para e-mail está funcionando — o
      // objetivo do trabalho é `porWhatsApp` cair, não `enviados` subir.
      porEmail: enviadosEmail,
      porWhatsApp: enviadosWhatsApp,
      whatsappPuladoNestaRodada: pularWhatsAppNestaRodada,
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
