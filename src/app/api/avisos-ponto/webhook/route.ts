import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { sendWhatsAppMessageAction } from '@/app/actions/communication'

/**
 * Webhook de resposta do WhatsApp — passo 2 do double opt-in.
 *
 * O servidor aceita o termo no Portal (passo 1) e recebe uma mensagem pedindo que responda SIM.
 * A resposta chega aqui e é o que de fato ativa o aviso.
 *
 * POR QUE ISSO IMPORTA, ALÉM DA FORMALIDADE
 *   1. Antibanimento. O sinal dominante de spam no WhatsApp é conversa de mão única. A resposta
 *      transforma o número em interlocutor — e o número em uso é o mesmo do acionamento de
 *      sobreaviso, então um banimento derrubaria o fluxo de urgência da rede junto.
 *   2. Posse do número. O PIN prova a identidade; a resposta prova que o telefone do cadastro é
 *      daquela pessoa. É o que impede aviso de ponto de chegar na mão de terceiro.
 *   3. LGPD: consentimento confirmado no próprio canal do tratamento, com a resposta bruta
 *      guardada em `logs_preferencia_aviso_ponto`.
 *
 * PARAR é honrado em qualquer estado, inclusive de quem nunca ativou. Ignorar pedido de parada é
 * o caminho mais curto para denúncia — e denúncia é o que bane o número.
 */

/**
 * Extrai telefone e texto de um payload cujo formato ainda não está fixado.
 *
 * Escrito tolerante de propósito: o formato exato do webhook da AstraCalls será confirmado na
 * integração, e um parser rígido falharia em silêncio — a resposta do servidor se perderia e ele
 * ficaria esperando uma ativação que nunca vem. Todo payload recebido é registrado, inclusive os
 * não reconhecidos, para que o formato real possa ser lido dos próprios dados.
 */
function extrairMensagem(body: any): { telefone: string | null; texto: string | null } {
  // ---- Chatwoot (AstraChat) -------------------------------------------------
  // Confirmado com payload real de produção em 09/08/2026
  // (`event: "automation_event.message_created"`): o corpo é a CONVERSA, não a mensagem. O texto
  // vive em `messages[].content` e o telefone em `meta.sender.phone_number`. Um parser que só
  // olhasse o topo — como o primeiro que escrevi — não acha nada aqui.
  if (Array.isArray(body?.messages)) {
    // `message_type` 0 = recebida, 1 = enviada. Pegar a última RECEBIDA cobre tanto o caso normal
    // (array com a mensagem que disparou a regra) quanto um payload que traga histórico junto.
    const recebidas = body.messages.filter((m: any) => m?.message_type === 0 || m?.message_type === 'incoming')
    const msg = recebidas[recebidas.length - 1]

    // Sem nenhuma recebida, o gatilho veio de mensagem que o próprio sistema enviou. Devolver
    // vazio faz o chamador registrar e parar — é o que evita responder à própria mensagem.
    if (msg) {
      const telBruto =
        msg?.sender?.phone_number ??
        body?.meta?.sender?.phone_number ??
        msg?.sender?.identifier ??
        body?.meta?.sender?.identifier ??
        body?.contact_inbox?.source_id ??
        null

      const conteudo = msg?.content ?? msg?.processed_message_content ?? null

      if (telBruto != null && typeof conteudo === 'string' && conteudo.trim()) {
        return {
          telefone: String(telBruto).split('@')[0].replace(/\D/g, '') || null,
          texto: conteudo,
        }
      }
    }

    // `messages` presente mas sem recebida utilizável: não vale cair no genérico abaixo, que
    // poderia pescar o telefone do contato e casar com uma mensagem que não existe.
    return { telefone: null, texto: null }
  }

  // ---- Demais provedores (Baileys, APIs genéricas) ---------------------------
  const cand = body?.message || body?.data?.message || body?.data || body?.payload || body || {}

  /** Percorre um caminho tipo 'conversation.meta.sender.phone_number' sem estourar. */
  const caminho = (obj: any, rota: string) =>
    rota.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

  // Ordem importa: o mais específico primeiro. O Chatwoot (base do AstraChat) aninha o remetente
  // em `sender.phone_number` ou `conversation.meta.sender.phone_number`; provedores tipo Baileys
  // usam `from`/`remoteJid` como string com JID. Aceitar um objeto por engano produziria
  // "[object Object]" e, depois de tirar os não-dígitos, uma string vazia — falha silenciosa.
  const CAMINHOS_TELEFONE = [
    'sender.phone_number',
    'sender.identifier',
    'conversation.meta.sender.phone_number',
    'conversation.meta.sender.identifier',
    'contact.phone_number',
    'from', 'sender', 'phone', 'remoteJid', 'chatId', 'author', 'number', 'waId',
  ]

  let bruto: unknown = null
  for (const obj of [cand, body]) {
    for (const rota of CAMINHOS_TELEFONE) {
      const v = caminho(obj, rota)
      // Só serve valor escalar: objeto aqui é sinal de que o caminho certo é mais fundo.
      if (v != null && (typeof v === 'string' || typeof v === 'number')) { bruto = v; break }
    }
    if (bruto != null) break
  }

  // JIDs vêm como "5594984105178@s.whatsapp.net" — o que interessa é a parte antes do @.
  const telefone = bruto == null ? null : (String(bruto).split('@')[0].replace(/\D/g, '') || null)

  const CAMINHOS_TEXTO = ['content', 'text', 'body', 'message', 'conversation', 'caption', 'processed_message_content']
  let texto: unknown = null
  for (const obj of [cand, body]) {
    for (const rota of CAMINHOS_TEXTO) {
      const v = caminho(obj, rota)
      if (typeof v === 'string' && v.trim()) { texto = v; break }
    }
    if (texto != null) break
  }

  return { telefone, texto: texto == null ? null : String(texto) }
}

/**
 * O Chatwoot dispara automação também para mensagens que ELE mandou (`message_type: 'outgoing'`).
 * Sem esse filtro, a própria mensagem de confirmação enviada pelo sistema voltaria pelo webhook —
 * e a de cortesia responderia a ela, criando eco.
 */
function ehMensagemDoProprioSistema(body: any): boolean {
  // Chatwoot: o tipo fica dentro de `messages[]`, não no topo. Um payload cujo array só tem
  // mensagens enviadas (`message_type: 1`) é eco da mensagem que o próprio sistema mandou.
  if (Array.isArray(body?.messages)) {
    return body.messages.length > 0 &&
      body.messages.every((m: any) => m?.message_type === 1 || m?.message_type === 'outgoing')
  }
  const tipo = body?.message_type ?? body?.message?.message_type ?? body?.data?.message_type
  return tipo === 'outgoing' || tipo === 1 || body?.fromMe === true || body?.key?.fromMe === true
}

export async function POST(request: Request) {
  try {
    // Autenticação por segredo. Sem isso, qualquer um poderia forjar a confirmação de outra
    // pessoa — e a confirmação é justamente o que autoriza mandar dado de ponto para um número.
    const { searchParams } = new URL(request.url)
    const secret =
      searchParams.get('secret') ||
      request.headers.get('x-webhook-secret') ||
      (request.headers.get('authorization')?.startsWith('Bearer ')
        ? request.headers.get('authorization')!.substring(7)
        : null)

    const expected = process.env.WHATSAPP_WEBHOOK_SECRET
    if (!expected) {
      console.error('WHATSAPP_WEBHOOK_SECRET não configurado — webhook recusado.')
      return NextResponse.json({ error: 'Webhook não configurado.' }, { status: 503 })
    }
    if (secret !== expected) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
    }

    const { telefone, texto } = extrairMensagem(body)
    const supabase = await createAdminClient()

    // Grava o payload BRUTO antes de qualquer coisa. É o que permite descobrir o formato real do
    // provedor com um SELECT, em vez de caçar em log de container — e um payload não reconhecido
    // sumiria sem rastro. Depois da integração, continua valendo como evidência de que a resposta
    // do servidor chegou, que é onde o consentimento do double opt-in se apoia.
    const registrar = async (resultado: any) => {
      const { error } = await supabase.from('logs_webhook_whatsapp').insert({
        payload: body,
        telefone,
        texto,
        reconhecido: !!(telefone && texto),
        resultado,
      })
      if (error) console.error('Falha ao registrar payload do webhook:', error.message)
    }

    // Eco da própria mensagem do sistema: registra (ajuda a entender o formato) e para aqui.
    if (ehMensagemDoProprioSistema(body)) {
      await registrar({ motivo: 'mensagem_do_proprio_sistema' })
      return NextResponse.json({ success: false, motivo: 'mensagem_do_proprio_sistema' })
    }

    // Devolver 200 mesmo sem reconhecer: um 4xx faria o provedor reenfileirar e reentregar em
    // laço um payload que nunca vamos entender.
    if (!telefone || !texto) {
      await registrar({ motivo: 'payload_nao_reconhecido' })
      return NextResponse.json({ success: false, motivo: 'payload_nao_reconhecido' })
    }

    const { data, error } = await supabase.rpc('fn_confirmar_aviso_ponto', {
      p_telefone: telefone,
      p_texto: texto,
      p_payload: body,
    })

    if (error) {
      console.error('Webhook WhatsApp: falha na RPC', error.message)
      await registrar({ erro: error.message })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const res: any = Array.isArray(data) ? data[0] : data
    await registrar(res ?? null)

    // Resposta de cortesia — só quando algo de fato mudou. Responder a toda mensagem transformaria
    // o número num bot tagarela, que é o oposto do que se quer aqui.
    if (res?.success && res?.resposta) {
      try {
        await sendWhatsAppMessageAction({ phone: telefone, message: res.resposta })
      } catch (err) {
        console.warn('Não foi possível enviar a confirmação de retorno:', err)
      }
    }

    return NextResponse.json({ success: !!res?.success, acao: res?.acao || null })
  } catch (error: any) {
    console.error('Erro no webhook de aviso de ponto:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * Alguns provedores validam o endpoint com um GET antes de ativar a entrega. Serve também como
 * checagem de saúde: informa **se** o segredo está configurado, jamais qual é.
 *
 * O `configurado` existe porque a falha aqui é silenciosa dos dois lados — com a variável ausente
 * (ou com o nome digitado errado) o POST responde 503, o provedor engole, e o servidor que ativou
 * no Portal fica esperando uma confirmação que nunca chega. Sem este campo, um GET respondendo
 * `ok: true` daria a impressão de que está tudo certo.
 */
export async function GET() {
  const configurado = !!process.env.WHATSAPP_WEBHOOK_SECRET
  return NextResponse.json({
    ok: true,
    endpoint: 'avisos-ponto/webhook',
    configurado,
    aviso: configurado
      ? undefined
      : 'WHATSAPP_WEBHOOK_SECRET ausente — o webhook recusará todas as confirmações com HTTP 503. '
        + 'Confira o NOME da variável no Coolify e refaça o redeploy.',
  })
}
