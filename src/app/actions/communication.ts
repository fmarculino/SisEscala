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
import { escaparHtml } from '@/utils/htmlSeguro'
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
 * Envia a credencial de acesso ao Portal (matricula + PIN) por E-MAIL.
 *
 * ⚠️ **E-mail e o caminho preferido para credencial, e nao so por causa do bloqueio do WhatsApp.**
 * O PIN e um dado de acesso: por e-mail ele fica recuperavel na caixa do servidor, chega mesmo
 * com o numero da Secretaria restrito, e nao depende de o telefone cadastrado ser exclusivo
 * daquela pessoa — telefone compartilhado em unidade e caso real (`fn_telefone_aviso_ponto`
 * existe justamente para detectar isso).
 *
 * O WhatsApp continua disponivel como alternativa manual, para quem nao tem e-mail.
 */
export async function sendPinEmailAction(params: {
  to: string
  nome: string
  mensagem: string
  unidadeId?: string
}) {
  await exigirSessao()

  const corpo = escaparHtml(params.mensagem).replace(/\n/g, '<br>')
  return await enviarEmailInterno({
    to: params.to,
    subject: 'SisEscala — Seu acesso ao Portal do Servidor',
    text: params.mensagem,
    // ⚠️ `escaparHtml` obrigatorio: `mensagem` carrega nome e matricula vindos do banco.
    // Mesma regra dos relatorios (armadilha 37).
    html: `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#18181b;max-width:560px">
  <p style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#71717a;margin:0 0 14px">
    Secretaria Municipal de Saúde · Marabá / PA
  </p>
  <div style="padding:18px 20px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px">${corpo}</div>
  <p style="font-size:12px;color:#71717a;margin:18px 0 0">
    Guarde este PIN. Ele dá acesso à sua escala e à sua folha de ponto no Portal do Servidor.
    Se não foi você que solicitou, avise a coordenação da sua unidade.
  </p>
</div>`,
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
