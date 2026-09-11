import { RedefinirPinClient } from './RedefinirPinClient'

/**
 * "Esqueci meu PIN" — passo 2: a pessoa abriu o link do e-mail e escolhe o PIN novo.
 *
 * O token só é QUEIMADO quando o formulário é enviado, nunca ao abrir a página. Isso protege
 * contra filtro de e-mail corporativo e antivírus, que abrem os links da mensagem antes de
 * entregá-la — com consumo no GET, um robô gastaria o link e a pessoa veria "já usado".
 *
 * Rota pública por construção: quem chega aqui não tem sessão e não tem o PIN. A prova é a
 * posse do token, que só existe no e-mail cadastrado.
 */
export default async function RedefinirPinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <RedefinirPinClient token={token} />
}
