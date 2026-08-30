'use server'

// ENVELOPES autenticados de comunicacao (WhatsApp/SMTP).
//
// ⚠️ ESTE ARQUIVO E' 'use server': TODA funcao exportada daqui e' uma Server Action — um POST
// cujo identificador vai no bundle do navegador e que QUALQUER PESSOA na internet pode chamar,
// com ou sem login. Ate' 30/08/2026 o motor de envio morava aqui, exportado, e com isso:
//
//   - `overrideConfigs` vinha do CLIENTE e VENCIA o config do banco
//     (`{ ...dbConfigs, ...unidadeConfigs, ...overrideConfigs }`). Sobrescrever SO' a URL do
//     provedor fazia a `X-API-Key` REAL ser enviada ao servidor do atacante; sobrescrever SO' o
//     host SMTP entregava usuario e senha como AUTH.
//   - `fetch` para URL arbitraria = SSRF a partir da VPS (alcanca a rede interna).
//   - `to`/`subject`/`html` arbitrarios = relay aberto saindo do e-mail oficial da Secretaria.
//
// O motor foi movido para src/utils/comunicacao/enviar.ts, que NAO e' 'use server' e por isso so'
// alcanca quem o importa (rotas de API e outras actions). Aqui ficam apenas envelopes finos que
// EXIGEM SESSAO antes de delegar — mesmo padrao de envelope da armadilha 1 do CLAUDE.md.
//
// REGRAS QUE NAO PODEM SER DESFEITAS:
//   1. Nenhuma funcao daqui envia nada antes de `exigirSessao()` / `exigirAdminComunicacao()`.
//   2. `overrideConfigs` NUNCA volta para a assinatura do envio comum. Ele so' existe no
//      caminho de TESTE, que e' admin — quem pode testar ja' pode editar aquelas chaves na tela
//      de Configuracoes, entao nao ha' ganho de privilegio.
//   3. Nao reexportar `enviarWhatsAppInterno`/`enviarEmailInterno` daqui: exportar de dentro de
//      um arquivo 'use server' as transforma em Server Action de novo e reabre tudo acima.

import { createClient } from '@/utils/supabase/server'
import { formatarDataHoraComSegundos } from '@/utils/horario'
import { enviarWhatsAppInterno, enviarEmailInterno } from '@/utils/comunicacao/enviar'

/**
 * Exige apenas que exista uma sessao valida. Enviar aviso/credencial por WhatsApp e' operacao
 * corriqueira de quem gerencia servidores (cadastro, edicao, acionamento de sobreaviso) — o que
 * nao pode e' ser ANONIMO.
 */
async function exigirSessao() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  return user
}

/**
 * Exige admin/super_admin. Usado no caminho de TESTE, o unico que aceita `overrideConfigs` —
 * ou seja, o unico que pode apontar o envio para um host informado na hora.
 */
async function exigirAdminComunicacao() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
    throw new Error('Apenas administradores podem testar as configurações de comunicação.')
  }
  return user
}

/**
 * Envia uma mensagem via WhatsApp com as configuracoes ATIVAS (globais ou da unidade).
 *
 * ⚠️ Sem `overrideConfigs` de proposito — ver o cabecalho deste arquivo.
 */
export async function sendWhatsAppMessageAction(params: {
  phone: string
  message: string
  unidadeId?: string
}) {
  await exigirSessao()
  return await enviarWhatsAppInterno({
    phone: params.phone,
    message: params.message,
    unidadeId: params.unidadeId,
  })
}

/**
 * Envia um e-mail com as configuracoes SMTP ativas (globais ou da unidade).
 *
 * ⚠️ Sem `overrideConfigs` de proposito — ver o cabecalho deste arquivo.
 */
export async function sendEmailAction(params: {
  to: string
  subject: string
  html?: string
  text?: string
  unidadeId?: string
}) {
  await exigirSessao()
  return await enviarEmailInterno({
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    unidadeId: params.unidadeId,
  })
}

/**
 * Teste de conexao do WhatsApp. ADMIN — aceita `overrideConfigs` para a tela de Configuracoes
 * poder validar credencial ainda nao salva.
 */
export async function testWhatsAppConnectionAction(phone: string, overrideConfigs?: Record<string, any>) {
  await exigirAdminComunicacao()
  const message = `🤖 *Teste SisEscala - Saúde Marabá*\n\nConexão com a API de WhatsApp configurada e validada com sucesso em ${formatarDataHoraComSegundos(new Date())}!`
  return await enviarWhatsAppInterno({ phone, message, overrideConfigs })
}

/**
 * Teste de conexao do SMTP. ADMIN — mesmo motivo do teste de WhatsApp.
 */
export async function testEmailConnectionAction(toEmail: string, overrideConfigs?: Record<string, any>) {
  await exigirAdminComunicacao()
  const subject = `[SisEscala] Teste de Configuração de E-mail (SMTP)`
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #111827;">
      <h2 style="color: #2563eb;">Conexão SMTP Confirmada com Sucesso! 🎉</h2>
      <p>Este é um e-mail de teste disparado pelo <strong>SisEscala (Gestão de Escalas)</strong> para validar as credenciais do servidor SMTP.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="font-size: 12px; color: #6b7280;">Data/Hora do Teste: ${formatarDataHoraComSegundos(new Date())}</p>
    </div>
  `
  return await enviarEmailInterno({ to: toEmail, subject, html, overrideConfigs })
}
