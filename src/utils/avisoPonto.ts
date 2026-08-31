/**
 * Termos de ciência do aviso de registro de ponto (e-mail por padrão, WhatsApp opcional).
 *
 * FONTE ÚNICA, e isso é o ponto: o texto exibido na tela e o texto gravado em
 * `logs_preferencia_aviso_ponto.termo_texto` têm de ser o MESMO literal. Se a tela renderizasse
 * um texto e a action gravasse outro, o registro provaria ciência de algo que o servidor nunca
 * leu — que é justamente o valor que o log existe para ter.
 *
 * Ao alterar qualquer termo, **suba a versão**. Consentimentos antigos continuam válidos com o
 * texto que estava vigente quando foram dados; nada é reescrito.
 */

/**
 * 1.1 — 30/08/2026. Duas coisas que o texto 1.0 afirmava deixaram de ser verdade:
 *   - **o canal**: o aviso passou a sair por E-MAIL por padrão, com o WhatsApp como alternativa
 *     escolhível no Portal (o número da Secretaria foi restringido pela Meta duas vezes);
 *   - **a frequência**: deixou de ser "a cada registro" e virou resumo, hoje semanal por padrão.
 *
 * ⚠️ Consentimentos dados sob a 1.0 continuam válidos, com o texto que estava vigente quando
 * foram dados — `logs_preferencia_aviso_ponto` guarda o literal, não uma referência. Ninguém é
 * reconsentido à força, e nada é reescrito.
 *
 * ℹ️ A mudança é **menos intrusiva** que o consentido (menos mensagens, e o canal é escolhível
 * pela própria pessoa), então não se exigiu novo aceite. Se a Secretaria entender que o troca de
 * canal pede reconsentimento explícito, isso é decisão administrativa — o mecanismo existe.
 */
export const TERMO_VERSAO = '1.1'

export const TERMO_ATIVACAO = `Você está ativando o aviso de registro de ponto.

O SisEscala enviará um resumo dos seus registros — a data, o horário e o local de cada batida. O padrão é um resumo por semana, e você pode mudar para diário nesta mesma tela.

O aviso é enviado para o e-mail cadastrado no seu nome. Se você não tiver e-mail cadastrado, ele vai para o seu telefone por WhatsApp. Você também pode escolher o canal nesta tela.

Este aviso é informativo. Ele NÃO é o Comprovante de Registro de Ponto do Trabalhador e não substitui a sua folha de ponto — seus registros oficiais continuam disponíveis aqui no Portal do Servidor.

Ativar ou não ativar este aviso não altera em nada o registro do seu ponto.

Você pode desativar a qualquer momento nesta mesma tela.

Esta escolha fica registrada em seu nome, com data e hora.`

export const TERMO_DESATIVACAO = `Você está desativando o aviso de registro de ponto.

A partir de agora você não receberá o resumo dos seus registros de ponto, por nenhum canal.

Isso não altera em nada o registro do seu ponto — as batidas continuam sendo gravadas normalmente e permanecem disponíveis para consulta aqui no Portal do Servidor.

Você pode reativar a qualquer momento nesta mesma tela.

Esta escolha fica registrada em seu nome, com data e hora.`
