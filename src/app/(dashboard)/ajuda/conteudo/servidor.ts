import type { Capitulo } from '../tipos'

export const servidor: Capitulo = {
  id: 'servidor',
  titulo: 'Para o servidor',
  icone: 'UserCheck',
  descricao: 'O Portal, o terminal e o PIN — o que orientar quando o servidor perguntar.',
  secoes: [
    {
      id: 'portal',
      titulo: 'O Portal do Servidor',
      resumo: 'Onde o servidor consulta a própria escala e folha, sem conta de sistema.',
      papeis: ['Servidor', 'Todos'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'O Portal é a área do servidor. Ele entra com **matrícula e PIN** — não precisa de usuário e senha do sistema, e não enxerga nada além dos próprios dados.',
        },
        { tipo: 'titulo', texto: 'O que ele encontra lá' },
        {
          tipo: 'cartoes',
          itens: [
            {
              titulo: 'A escala do mês',
              texto: 'Os turnos lançados, dia a dia, do mês atual e dos anteriores.',
            },
            {
              titulo: 'A folha de ponto',
              texto: 'O que foi registrado em cada dia, com os horários. Dá para imprimir.',
            },
            {
              titulo: 'Pedir ajuste de horário',
              texto:
                'Quando faltou uma batida, ele solicita com justificativa. Vira uma pendência para o coordenador.',
            },
            {
              titulo: 'Pedir férias',
              texto: 'A solicitação chega a quem avalia, com o histórico do pedido.',
            },
            { titulo: 'Trocar o PIN', texto: 'Exige o PIN atual e um novo de 6 dígitos.' },
            {
              titulo: 'Esqueceu o PIN',
              texto:
                'Na tela de entrada, o próprio servidor pede um link por e-mail e escolhe um PIN novo — sem depender de ninguém.',
            },
            {
              titulo: 'Aviso de registro de ponto',
              texto:
                'Um resumo das batidas dele, por e-mail ou WhatsApp. Ele liga, escolhe o canal e a frequência.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'No Portal ele SOLICITA, não edita',
          texto:
            'O servidor não altera a própria folha. Ele pede, com justificativa, e o pedido entra como uma marcação de menor peso, esperando o coordenador. Isso protege os dois lados: a folha continua sendo um documento validado por quem tem autoridade.',
        },
      ],
    },

    {
      id: 'pin',
      titulo: 'O PIN',
      resumo: 'A senha do servidor no terminal e no Portal — e o cuidado ao trocar.',
      papeis: ['Servidor', 'Coordenador', 'RH da Unidade', 'RH Geral'],
      blocos: [
        {
          tipo: 'lista',
          itens: [
            'O PIN é **o mesmo** no terminal de ponto e no Portal.',
            'PIN novo tem **6 dígitos**. Os de 4 dígitos já emitidos continuam valendo, sem prazo.',
            'Não pode ser sequência (`123456`) nem repetição (`000000`).',
            'O coordenador pode gerar um novo pela ficha do servidor; o próprio servidor troca pelo Portal.',
            'Esqueceu? Na tela de entrada do Portal há **Esqueci meu PIN**: o link chega no e-mail cadastrado e vale 30 minutos.',
          ],
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Trocou o PIN à noite? Use o novo no dia seguinte',
          texto:
            'Como o PIN é o mesmo do terminal, quem troca e no dia seguinte digita o antigo **leva recusa** e o ponto não é registrado. É a única coisa que ainda recusa uma batida — vale avisar o servidor na hora da troca.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Errou o PIN várias vezes?',
          texto:
            'Depois de algumas tentativas erradas, o acesso fica bloqueado por alguns minutos. É proteção contra tentativa de adivinhação. Dá para esperar, usar o **Esqueci meu PIN** (o link libera o acesso na hora) ou pedir um PIN novo ao coordenador.',
        },
        { tipo: 'titulo', texto: 'Esqueci meu PIN' },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Digite a matrícula e clique em Verificar',
              texto: 'O link Esqueci meu PIN aparece logo abaixo do campo do PIN.',
            },
            {
              titulo: 'Clique em Esqueci meu PIN',
              texto:
                'O sistema envia um link para o e-mail cadastrado na ficha. A tela responde sempre a mesma frase, mesmo quando não há e-mail — é proposital, para ninguém descobrir de fora quais matrículas existem.',
            },
            {
              titulo: 'Abra o e-mail e clique no link',
              texto: 'Ele vale 30 minutos e serve uma vez só. Se não chegar, confira a caixa de spam.',
            },
            {
              titulo: 'Escolha o PIN novo',
              texto: 'De 6 a 8 números. O bloqueio por tentativas erradas cai junto.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Sem e-mail na ficha, não há link',
          texto:
            'O link só chega a quem tem e-mail cadastrado — hoje cerca de dois terços dos servidores. Quem não tem continua dependendo do coordenador para receber um PIN novo. Cadastrar o e-mail na ficha resolve isso de uma vez.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Pedido de outra pessoa não tira o PIN de ninguém',
          texto:
            'Se alguém digitar a matrícula de um colega e pedir o link, nada acontece com o PIN dele: o sistema só envia um e-mail, e o PIN atual continua valendo até que alguém abra aquela caixa e escolha outro.',
        },
      ],
    },

    {
      id: 'aviso-de-ponto',
      titulo: 'O aviso de registro de ponto',
      resumo: 'O resumo das batidas que o servidor pode ligar por conta própria.',
      papeis: ['Servidor', 'Coordenador', 'RH da Unidade', 'RH Geral'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Na aba **Minha Conta** do Portal, o servidor pode ligar um resumo dos próprios registros — data, horário e local de cada batida. Vem **desligado**: só o próprio servidor liga, e ele pode desligar quando quiser.',
        },
        {
          tipo: 'aviso',
          tom: 'legal',
          titulo: 'O aviso não é o comprovante, e ligar não muda o ponto',
          texto:
            'É informativo. Não substitui a folha, e ativar ou não ativar **não altera em nada** o registro do ponto — as batidas continuam sendo gravadas do mesmo jeito. Quando o servidor perguntar se precisa ligar, a resposta é: só se ele quiser acompanhar.',
        },
        { tipo: 'titulo', texto: 'Como o servidor liga' },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Ele clica em Ativar aviso e lê o termo',
              texto: 'A escolha fica registrada em nome dele, com data e hora.',
            },
            {
              titulo: 'O sistema pede uma confirmação',
              texto:
                'Se o canal dele é e-mail, chega um link — ele abre a mensagem e clica. Se é WhatsApp, chega uma mensagem e ele responde SIM naquela conversa.',
            },
            {
              titulo: 'Só depois disso o aviso passa a valer',
              texto:
                'Sem a confirmação nada é enviado, e o pedido expira sozinho em 48 horas. É o que garante que o e-mail ou o telefone é mesmo dele.',
            },
            {
              titulo: 'Com o aviso ligado, ele escolhe canal e frequência',
              texto: 'E-mail ou WhatsApp; resumo semanal (padrão) ou diário.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Mandou confirmar e não chegou nada?',
          texto:
            'Pela ordem: confira a **caixa de spam**; veja se o e-mail da ficha está certo; e lembre que o aviso é liberado **setor por setor** — onde ainda não foi liberado, a tela diz isso e o botão nem fica disponível.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Ficha sem e-mail e sem telefone não ativa',
          texto:
            'Não há para onde mandar a confirmação. O botão fica desabilitado e a tela explica o que falta — quem resolve é quem cuida do cadastro.',
        },
      ],
    },

    {
      id: 'orientar-servidor',
      titulo: 'O que orientar na implantação',
      resumo: 'O roteiro curto para explicar ao servidor no primeiro dia.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade'],
      blocos: [
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Bata na entrada e na saída, todo dia',
              texto:
                'E também na saída e no retorno do intervalo, quando a unidade exigir marcação de intervalo.',
            },
            {
              titulo: 'Se a tela ficar âmbar, está registrado',
              texto: 'Não precisa bater de novo. Só o vermelho exige repetir.',
            },
            {
              titulo: 'Esqueceu de bater? Avise no mesmo dia',
              texto:
                'Quanto mais perto do fato, mais fácil de resolver — e o servidor pode pedir o ajuste pelo Portal.',
            },
            {
              titulo: 'Confira a folha antes do fechamento',
              texto:
                'O Portal mostra a folha durante o mês. Erro achado no dia 10 é ajuste; achado depois do fechamento é reabertura.',
            },
            {
              titulo: 'Guarde o PIN',
              texto: 'É a chave do ponto e do Portal.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Antes de liberar o relógio, confira a hora dele',
          texto:
            'Equipamento recém-instalado pode estar com a data errada. Batida carimbada com data errada não é atribuída a ninguém — e o ponto da pessoa some sem erro nenhum na tela.',
        },
      ],
    },
  ],
}
