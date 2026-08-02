'use server'

import { createAdminClient } from '@/utils/supabase/server'
import nodemailer from 'nodemailer'

export interface WhatsAppSendParams {
  phone: string
  message: string
  unidadeId?: string
  overrideConfigs?: Record<string, any>
}

export interface EmailSendParams {
  to: string
  subject: string
  html?: string
  text?: string
  unidadeId?: string
  overrideConfigs?: Record<string, any>
}

export interface WhatsAppResult {
  success: boolean
  mode?: string
  error?: string
  fallbackUrl?: string
  canFallback?: boolean
  isManualMode?: boolean
  data?: any
}

export interface EmailResult {
  success: boolean
  error?: string
  messageId?: string
}

// Auxiliar para carregar dicionário de configurações globais do banco
async function getCommunicationConfigs() {
  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')

    if (error || !data) {
      return {}
    }

    const configs: Record<string, any> = {}
    data.forEach(item => {
      configs[item.chave] = item.valor
    })
    return configs
  } catch (err) {
    console.error('Erro ao buscar configurações de comunicação:', err)
    return {}
  }
}

/**
 * Função utilitária para formatar telefone para WhatsApp (DDI 55 + DDD + Número)
 */
/**
 * Função utilitária para formatar telefone para WhatsApp no Brasil (trata a regra do 9º dígito em DDDs >= 31)
 */
function getWhatsAppPhoneVariants(phone: string): { primary: string; secondary?: string } {
  let clean = phone.replace(/\D/g, '')
  if (!clean) return { primary: '' }

  if (clean.length === 10 || clean.length === 11) {
    clean = '55' + clean
  }

  // Regra do Brasil (55)
  if (clean.startsWith('55') && clean.length === 13) {
    const ddd = parseInt(clean.substring(2, 4), 10)
    // Para DDDs >= 31 (ex: 94, 81, 91, 71, 31, etc.), o JID do WhatsApp costuma ser registrado SEM o 9º dígito (12 dígitos)
    if (ddd >= 31 && clean[4] === '9') {
      const without9 = clean.substring(0, 4) + clean.substring(5)
      return {
        primary: without9,
        secondary: clean
      }
    }
  }

  // Se tiver 12 dígitos e DDD >= 31, a variante secundária é com o 9 (13 dígitos)
  if (clean.startsWith('55') && clean.length === 12) {
    const ddd = parseInt(clean.substring(2, 4), 10)
    if (ddd >= 31) {
      const with9 = clean.substring(0, 4) + '9' + clean.substring(4)
      return {
        primary: clean,
        secondary: with9
      }
    }
  }

  return { primary: clean }
}

function formatPhoneForWhatsApp(phone: string): string {
  return getWhatsAppPhoneVariants(phone).primary
}

/**
 * Envia uma mensagem via WhatsApp de acordo com as configurações ativas (globais ou da unidade)
 */
export async function sendWhatsAppMessageAction({ phone, message, unidadeId, overrideConfigs }: WhatsAppSendParams): Promise<WhatsAppResult> {
  const dbConfigs = await getCommunicationConfigs()

  let unidadeConfigs: Record<string, any> = {}
  if (unidadeId) {
    const unitKey = `unidade_comunicacao_${unidadeId}`
    const unitRaw = dbConfigs[unitKey]
    if (unitRaw && (typeof unitRaw === 'object') && unitRaw.usar_global === false) {
      unidadeConfigs = unitRaw
    }
  }

  const configs = { ...dbConfigs, ...unidadeConfigs, ...(overrideConfigs || {}) }
  const phoneVariants = getWhatsAppPhoneVariants(phone)
  const cleanPhone = phoneVariants.primary

  if (!cleanPhone) {
    return {
      success: false,
      error: 'Telefone inválido ou não informado.'
    }
  }

  const modo = configs['whatsapp_modo'] || 'api_astracall'
  const fallbackPermitido = configs['whatsapp_permitir_fallback'] !== 'false'
  const fallbackUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`

  // Modo Manual (WhatsApp Web)
  if (modo === 'manual') {
    return {
      success: false,
      isManualMode: true,
      fallbackUrl,
      error: 'O sistema está configurado para envio manual via WhatsApp Web.'
    }
  }

  // 1. Modo AstraCalls API (Padrão)
  if (modo === 'api_astracall') {
    let baseUrl = (configs['whatsapp_astracall_url'] || 'https://astracall.atb.app.br').trim()
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)

    let sid = (configs['whatsapp_astracall_sid'] || 'default').trim()
    const apiKey = (configs['whatsapp_astracall_key'] || '').trim()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (apiKey) {
      headers['X-API-Key'] = apiKey
    }

    // Função interna para realizar a chamada de envio de texto no AstraCalls
    const attemptSend = async (sessionSid: string, destinationPhone: string) => {
      const endpoint = `${baseUrl}/api/sessions/${encodeURIComponent(sessionSid)}/messages/text`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 12000)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: destinationPhone,
          text: message
        }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      let resData: any = null
      const resText = await response.text()
      try { resData = JSON.parse(resText) } catch { resData = resText }

      return { ok: response.ok, status: response.status, data: resData }
    }

    try {
      // 1ª Tentativa com o número primário (sem o 9º dígito para DDD >= 31)
      let res = await attemptSend(sid, phoneVariants.primary)

      // Se falhou e temos uma variante secundária (com o 9º dígito), tentar a variante
      if (!res.ok && phoneVariants.secondary) {
        console.log(`[AstraCalls 9th Digit Retry] Tentando variante secundária: ${phoneVariants.secondary}`)
        const retryRes = await attemptSend(sid, phoneVariants.secondary)
        if (retryRes.ok) {
          res = retryRes
        }
      }

      // Se falhou por causa do SID (404/400/503), tentar auto-buscar o ID real da sessão conectada
      if (!res.ok) {
        try {
          const sessionsRes = await fetch(`${baseUrl}/api/sessions`, { headers })
          if (sessionsRes.ok) {
            const sessionsJson = await sessionsRes.json()
            const sessionsList = Array.isArray(sessionsJson?.sessions) ? sessionsJson.sessions : (Array.isArray(sessionsJson) ? sessionsJson : [])
            
            const matchedSession = sessionsList.find((s: any) => 
              s.id === sid || 
              s.name === sid || 
              (s.name && s.name.toLowerCase() === sid.toLowerCase())
            ) || sessionsList.find((s: any) => 
              (s.state === 'open' || s.paired === true) && (s.name && (s.name.includes(sid) || sid.includes(s.name)))
            ) || sessionsList.find((s: any) => s.state === 'open' || s.paired === true)

            if (matchedSession && matchedSession.id && matchedSession.id !== sid) {
              res = await attemptSend(matchedSession.id, phoneVariants.primary)
              if (!res.ok && phoneVariants.secondary) {
                res = await attemptSend(matchedSession.id, phoneVariants.secondary)
              }
            }
          }
        } catch (autoErr) {
          console.warn('[AstraCalls Auto-Resolution] Não foi possível consultar GET /api/sessions:', autoErr)
        }
      }

      if (res.ok) {
        return {
          success: true,
          mode: 'api_astracall',
          data: res.data
        }
      } else {
        const errorDetail = typeof res.data === 'object' && res.data?.message ? res.data.message : (typeof res.data === 'string' ? res.data : `Status HTTP ${res.status}`)
        return {
          success: false,
          mode: 'api_astracall',
          error: `AstraCalls API Error (${res.status}): ${errorDetail}`,
          fallbackUrl,
          canFallback: fallbackPermitido
        }
      }
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Tempo limite (timeout) excedido ao conectar com a API AstraCalls.' : err.message || 'Erro de conexão de rede'
      return {
        success: false,
        mode: 'api_astracall',
        error: `Erro ao conectar na API AstraCalls: ${errorMsg}`,
        fallbackUrl,
        canFallback: fallbackPermitido
      }
    }
  }

  // 2. Modo Chatwoot API
  if (modo === 'api_chatwoot') {
    let baseUrl = (configs['whatsapp_chatwoot_url'] || '').trim()
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)

    const accountId = (configs['whatsapp_chatwoot_account_id'] || '').trim()
    const inboxId = (configs['whatsapp_chatwoot_inbox_id'] || '').trim()
    const token = (configs['whatsapp_chatwoot_token'] || '').trim()

    if (!baseUrl || !accountId || !token) {
      return {
        success: false,
        mode: 'api_chatwoot',
        error: 'Configurações do Chatwoot incompletas (URL, Account ID e Token são obrigatórios).',
        fallbackUrl,
        canFallback: fallbackPermitido
      }
    }

    const endpoint = `${baseUrl}/api/v1/accounts/${accountId}/conversations`

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api_access_token': token
        },
        body: JSON.stringify({
          source_id: cleanPhone,
          inbox_id: inboxId || undefined,
          message: {
            content: message
          }
        })
      })

      if (response.ok) {
        return {
          success: true,
          mode: 'api_chatwoot',
          data: await response.json()
        }
      } else {
        const errorText = await response.text()
        return {
          success: false,
          mode: 'api_chatwoot',
          error: `Chatwoot API Error (${response.status}): ${errorText}`,
          fallbackUrl,
          canFallback: fallbackPermitido
        }
      }
    } catch (err: any) {
      return {
        success: false,
        mode: 'api_chatwoot',
        error: `Erro ao conectar com Chatwoot: ${err.message}`,
        fallbackUrl,
        canFallback: fallbackPermitido
      }
    }
  }

  // 3. Modo API HTTP Genérica / Customizada
  if (modo === 'api_custom') {
    const customUrl = (configs['whatsapp_custom_url'] || '').trim()
    const method = (configs['whatsapp_custom_method'] || 'POST').trim().toUpperCase()
    const rawHeaders = (configs['whatsapp_custom_headers'] || '').trim()
    const rawPayload = (configs['whatsapp_custom_payload'] || '{"to": "{{phone}}", "text": "{{message}}"}').trim()

    if (!customUrl) {
      return {
        success: false,
        mode: 'api_custom',
        error: 'URL da API Customizada não foi configurada.',
        fallbackUrl,
        canFallback: fallbackPermitido
      }
    }

    // Processar Headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (rawHeaders) {
      try {
        if (rawHeaders.startsWith('{')) {
          Object.assign(headers, JSON.parse(rawHeaders))
        } else {
          // Formato linha a linha "Header-Name: Value"
          rawHeaders.split('\n').forEach((line: string) => {
            const parts = line.split(':')
            if (parts.length >= 2) {
              const k = parts[0].trim()
              const v = parts.slice(1).join(':').trim()
              if (k && v) headers[k] = v
            }
          })
        }
      } catch (err) {
        console.warn('Erro ao processar headers customizados do WhatsApp:', err)
      }
    }

    // Substituir marcadores {{phone}} e {{message}}
    const processedUrl = customUrl.replace(/\{\{phone\}\}/g, cleanPhone).replace(/\{\{message\}\}/g, encodeURIComponent(message))
    
    let processedBody: any = undefined
    if (method !== 'GET' && method !== 'HEAD') {
      const jsonBodyString = rawPayload
        .replace(/\{\{phone\}\}/g, cleanPhone)
        .replace(/\{\{message\}\}/g, JSON.stringify(message).slice(1, -1)) // escapa caracteres especiais no JSON
      
      try {
        processedBody = JSON.stringify(JSON.parse(jsonBodyString))
      } catch {
        processedBody = jsonBodyString
      }
    }

    try {
      const response = await fetch(processedUrl, {
        method,
        headers,
        body: processedBody
      })

      const resText = await response.text()
      let resData: any = resText
      try { resData = JSON.parse(resText) } catch {}

      if (response.ok) {
        return {
          success: true,
          mode: 'api_custom',
          data: resData
        }
      } else {
        return {
          success: false,
          mode: 'api_custom',
          error: `API Customizada Error (${response.status}): ${typeof resData === 'string' ? resData : JSON.stringify(resData)}`,
          fallbackUrl,
          canFallback: fallbackPermitido
        }
      }
    } catch (err: any) {
      return {
        success: false,
        mode: 'api_custom',
        error: `Erro ao conectar na API Customizada: ${err.message}`,
        fallbackUrl,
        canFallback: fallbackPermitido
      }
    }
  }

  return {
    success: false,
    error: `Modo de WhatsApp desconhecido: ${modo}`,
    fallbackUrl,
    canFallback: fallbackPermitido
  }
}

/**
 * Envia um e-mail utilizando as configurações de SMTP ativas (globais ou da unidade)
 */
export async function sendEmailAction({ to, subject, html, text, unidadeId, overrideConfigs }: EmailSendParams): Promise<EmailResult> {
  const dbConfigs = await getCommunicationConfigs()

  let unidadeConfigs: Record<string, any> = {}
  if (unidadeId) {
    const unitKey = `unidade_comunicacao_${unidadeId}`
    const unitRaw = dbConfigs[unitKey]
    if (unitRaw && (typeof unitRaw === 'object') && unitRaw.usar_global === false) {
      unidadeConfigs = unitRaw
    }
  }

  const configs = { ...dbConfigs, ...unidadeConfigs, ...(overrideConfigs || {}) }

  const habilitado = configs['email_smtp_habilitado'] !== 'false'
  if (!habilitado) {
    return {
      success: false,
      error: 'O envio de e-mails via SMTP está desabilitado nas configurações do sistema.'
    }
  }

  const host = (configs['email_smtp_host'] || '').trim()
  const porta = parseInt(configs['email_smtp_porta'] || '587', 10)
  const usuario = (configs['email_smtp_usuario'] || '').trim()
  const senha = (configs['email_smtp_senha'] || '').trim()
  const seguranca = configs['email_smtp_seguranca'] || 'tls'
  const remetenteEmail = (configs['email_smtp_remetente_email'] || usuario).trim()
  const remetenteNome = (configs['email_smtp_remetente_nome'] || 'SisEscala').trim()

  if (!host || !usuario) {
    return {
      success: false,
      error: 'Configurações de SMTP incompletas. Informe o Servidor Host e Usuário em Configurações.'
    }
  }

  try {
    const isSecure = seguranca === 'ssl' || porta === 465

    const transporter = nodemailer.createTransport({
      host,
      port: porta,
      secure: isSecure,
      auth: {
        user: usuario,
        pass: senha
      },
      tls: {
        rejectUnauthorized: false // Flexibilidade para ambientes corporativos com certificados autoassinados
      }
    })

    const fromAddress = remetenteNome ? `"${remetenteNome}" <${remetenteEmail}>` : remetenteEmail

    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: text || html?.replace(/<[^>]*>?/gm, ''),
      html: html || `<p>${text}</p>`
    })

    return {
      success: true,
      messageId: info.messageId
    }
  } catch (err: any) {
    console.error('Erro ao enviar e-mail via SMTP:', err)
    return {
      success: false,
      error: err.message || 'Falha ao conectar no servidor SMTP.'
    }
  }
}

/**
 * Ação de teste para validar a integração do WhatsApp
 */
export async function testWhatsAppConnectionAction(phone: string, overrideConfigs?: Record<string, any>): Promise<WhatsAppResult> {
  const message = `🤖 *Teste SisEscala - Saúde Marabá*\n\nConexão com a API de WhatsApp configurada e validada com sucesso em ${new Date().toLocaleString('pt-BR')}!`
  return await sendWhatsAppMessageAction({ phone, message, overrideConfigs })
}

/**
 * Ação de teste para validar as configurações do Servidor de E-mail (SMTP)
 */
export async function testEmailConnectionAction(toEmail: string): Promise<EmailResult> {
  const subject = `[SisEscala] Teste de Configuração de E-mail (SMTP)`
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #111827;">
      <h2 style="color: #2563eb;">Conexão SMTP Confirmada com Sucesso! 🎉</h2>
      <p>Este é um e-mail de teste disparado pelo <strong>SisEscala (Gestão de Escalas)</strong> para validar as credenciais do servidor SMTP.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="font-size: 12px; color: #6b7280;">Data/Hora do Teste: ${new Date().toLocaleString('pt-BR')}</p>
    </div>
  `
  return await sendEmailAction({ to: toEmail, subject, html })
}
