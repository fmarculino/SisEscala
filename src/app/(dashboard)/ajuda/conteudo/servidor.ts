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
              titulo: 'Avisos de ponto',
              texto: 'Preferência de como quer ser lembrado das pendências dele.',
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
            'Depois de algumas tentativas erradas, o acesso fica bloqueado por alguns minutos. É proteção contra tentativa de adivinhação. Basta esperar — ou pedir um PIN novo ao coordenador.',
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
