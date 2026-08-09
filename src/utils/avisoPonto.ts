/**
 * Termos de ciência do aviso de ponto por WhatsApp.
 *
 * FONTE ÚNICA, e isso é o ponto: o texto exibido na tela e o texto gravado em
 * `logs_preferencia_aviso_ponto.termo_texto` têm de ser o MESMO literal. Se a tela renderizasse
 * um texto e a action gravasse outro, o registro provaria ciência de algo que o servidor nunca
 * leu — que é justamente o valor que o log existe para ter.
 *
 * Ao alterar qualquer termo, **suba a versão**. Consentimentos antigos continuam válidos com o
 * texto que estava vigente quando foram dados; nada é reescrito.
 */

export const TERMO_VERSAO = '1.0'

export const TERMO_ATIVACAO = `Você está ativando o aviso de registro de ponto por WhatsApp.

A cada registro no terminal, o SisEscala enviará uma mensagem para o telefone cadastrado no seu nome, contendo a data, o horário e o local do registro.

Este aviso é informativo. Ele NÃO é o Comprovante de Registro de Ponto do Trabalhador e não substitui a sua folha de ponto — seus registros oficiais continuam disponíveis aqui no Portal do Servidor.

Ativar ou não ativar este aviso não altera em nada o registro do seu ponto.

Você pode desativar a qualquer momento nesta mesma tela.

Esta escolha fica registrada em seu nome, com data e hora.`

export const TERMO_DESATIVACAO = `Você está desativando o aviso de registro de ponto por WhatsApp.

A partir de agora você não receberá mensagem quando registrar seu ponto no terminal.

Isso não altera em nada o registro do seu ponto — as batidas continuam sendo gravadas normalmente e permanecem disponíveis para consulta aqui no Portal do Servidor.

Você pode reativar a qualquer momento nesta mesma tela.

Esta escolha fica registrada em seu nome, com data e hora.`
