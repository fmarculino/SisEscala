import { ConfirmarAvisoClient } from './ConfirmarAvisoClient'

/**
 * Passo 2 do opt-in do aviso de ponto, pelo link do e-mail.
 *
 * 🚨 A confirmação NÃO acontece ao abrir a página, e isso não é preciosismo: filtro de e-mail
 * corporativo e antivírus **abrem os links da mensagem** para checá-los antes de entregá-la.
 * Confirmar no GET faria o token ser queimado por um robô, e a pessoa encontraria "este link já
 * foi usado" sem nunca ter clicado. Por isso a página só mostra o que vai acontecer, e quem
 * confirma é o clique no botão.
 *
 * A rota é pública por construção — quem chega aqui não tem sessão do Portal. A prova é o token
 * de uso único, que só existe dentro do e-mail enviado ao endereço cadastrado.
 */
export default async function ConfirmarAvisoPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <ConfirmarAvisoClient token={token} />
}
