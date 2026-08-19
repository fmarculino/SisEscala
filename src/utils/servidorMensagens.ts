export interface MensagemAcessoPortalParams {
  nome?: string | null
  matricula?: string | null
  pin: string
}

/**
 * Gera a mensagem formatada para envio via WhatsApp contendo as credenciais de acesso
 * (link do portal, matrícula e PIN) e um breve resumo dos recursos disponíveis no Portal do Servidor.
 */
export function gerarMensagemAcessoPortal({
  nome,
  matricula,
  pin,
}: MensagemAcessoPortalParams): string {
  const nomeFormatado = (nome || '').trim() || 'Servidor(a)'
  const matriculaTexto = matricula?.trim() ? `\n👤 *Matrícula:* ${matricula.trim()}` : ''
  const portalUrl = 'https://sisescala.maraba.pa.gov.br/consultar-escala'

  return `Olá, *${nomeFormatado}*! 👋

Aqui estão seus dados de acesso ao *Portal do Servidor (SisEscala)*:

🔗 *Link de Acesso:* ${portalUrl}${matriculaTexto}
🔑 *PIN de Acesso:* *${pin}*

📌 *Como acessar:*
1. Acesse o link: ${portalUrl}
2. Informe sua *Matrícula* e o seu *PIN* de acesso.

✨ *No Portal do Servidor você pode:*
• 📅 Consultar suas escalas mensais e plantões
• 🔄 Solicitar e acompanhar trocas de plantão
• ⏱️ Visualizar seu espelho/folha de ponto
• 📄 Enviar e acompanhar justificativas/atestados
• 🏖️ Consultar programação de férias e licenças
• 🔔 Ativar avisos de registro de ponto no WhatsApp

_Guarde seu PIN com segurança. Você também precisará dele para registrar sua entrada e saída nos terminais de ponto._`
}
