import type { Capitulo } from '../tipos'

export const escalas: Capitulo = {
  id: 'escalas',
  titulo: 'Escalas',
  icone: 'CalendarDays',
  descricao: 'A grade, os turnos, as ferramentas de preenchimento e as travas que protegem o mês.',
  secoes: [
    {
      id: 'abrir-escala',
      titulo: 'Abrindo a escala do seu setor',
      resumo: 'Como chegar na grade e o que os cartões da tela inicial mostram.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Escalas'], href: '/escalas' },
        {
          tipo: 'p',
          texto:
            'A tela de Escalas lista as escalas do mês, uma por **setor**. Cada cartão mostra a unidade, o setor, quantos servidores estão escalados e o status da competência.',
        },
        {
          tipo: 'passos',
          itens: [
            { titulo: 'Escolha o mês', texto: 'O seletor no topo controla a competência exibida.' },
            {
              titulo: 'Ache o setor',
              texto:
                'Você pode buscar por nome do setor ou por nome/matrícula do servidor — útil quando não lembra em que setor a pessoa está.',
            },
            { titulo: 'Clique no cartão', texto: 'A grade daquele setor abre.' },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          texto:
            'Não existe a escala do mês que você quer? Ela é criada quando alguém lança o primeiro turno. Abra o setor no mês desejado e comece a preencher.',
        },
      ],
    },

    {
      id: 'grade',
      titulo: 'Entendendo a grade',
      resumo: 'Linhas, colunas, as duas abas e o que cada cor significa.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'A grade é uma planilha: **os dias do mês nas colunas**, **os servidores nas linhas**. Cada servidor ocupa quatro linhas — Regular, Plantão, Extra e Sobreaviso —, e você digita o código do turno na célula do dia.',
        },
        { tipo: 'titulo', texto: 'As duas abas' },
        {
          tipo: 'tabela',
          colunas: ['Aba', 'Mostra', 'Quando usar'],
          linhas: [
            [
              'Previsão',
              'O que foi **planejado**: os turnos que você lançou.',
              'Ao montar e ajustar a escala.',
            ],
            [
              'Validado',
              'O que **aconteceu**: presença registrada, falta, pendência.',
              'Durante e depois do mês, para acompanhar e validar.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'São visões da mesma escala',
          texto:
            'Trocar de aba não muda os dados, muda o que está sendo exibido. A previsão continua lá quando você olha o validado, e vice-versa.',
        },
        { tipo: 'titulo', texto: 'As colunas de total, à direita' },
        {
          tipo: 'p',
          texto:
            'No fim da grade ficam os totais de cada servidor. Cada coluna tem duas linhas: **Prev** é o previsto (o que foi lançado) e **Val** é o validado (o que já tem presença confirmada). Passe o mouse sobre **CH** e sobre **Total H/Mês** para ver a conta aberta.',
        },
        {
          tipo: 'tabela',
          colunas: ['Coluna', 'O que conta'],
          linhas: [
            ['CH', 'Horas da linha **Regular** — o expediente contratual.'],
            ['HE 100% / HE 50%', 'Horas da linha **Extra**. Noturna, fim de semana e feriado vão em 100%; as demais em 50%.'],
            ['PL12 / PL6 / PL4', 'Plantões, contados em **unidades de pagamento**. Um plantão de 24h vale 2 PL12, não 1.'],
            ['SOB', 'Sobreavisos, em unidades. **Não** entram no total de horas: sobreaviso é prontidão, não trabalho presencial.'],
            ['Total H/Mês', 'CH + horas extras + plantões. Passe o mouse para ver parcela por parcela.'],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A CH nunca passa da jornada do servidor',
          texto:
            'A coluna CH respeita o **limite diário da jornada** escolhida na coluna Tipo. Se a jornada é `07H ÀS 13H` (6h por dia) e você lança um turno de 12h na linha Regular, a CH continua contando **6h naquele dia** — e o total não muda. Não é falha da tela: a jornada regular não paga hora além do expediente contratual. Aparece um **·** ao lado do número de CH quando isso acontece; passe o mouse para ver quantas horas ficaram de fora e em quantos dias.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Trabalhou além do expediente? Lance na linha certa',
          texto:
            'Hora além da jornada só é contada se for lançada como **Extra** ou **Plantão**. Essas duas linhas não têm limite de jornada — é exatamente para isso que elas existem.',
        },
        { tipo: 'titulo', texto: 'Salvar' },
        {
          tipo: 'p',
          texto:
            'O que você digita fica **só na sua tela** até clicar em **Salvar Previsão**. Enquanto não salvar, ninguém mais vê e nada foi gravado. Se fechar a aba, perde.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Duas pessoas na mesma grade',
          texto:
            'Se você e outra pessoa abrirem o mesmo setor ao mesmo tempo, quem salvar por último sobrescreve. O sistema avisa quando detecta que a tela ficou desatualizada — se aparecer esse aviso, **recarregue antes de salvar**, senão você desfaz o trabalho do colega.',
        },
      ],
    },

    {
      id: 'lancar-turno',
      titulo: 'Lançando um turno',
      resumo: 'Como digitar, o que os códigos significam e quando o sistema pede a hora.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Clique na célula do dia, na linha certa',
              texto:
                'Expediente normal vai em **Regular**. Plantão vai em **Plantão**. A linha errada muda como aquilo é pago.',
            },
            {
              titulo: 'Digite o código do turno',
              texto: 'Os códigos disponíveis mudam conforme a linha — a célula só aceita o que faz sentido ali.',
            },
            {
              titulo: 'Informe a hora, se o sistema pedir',
              texto:
                'Alguns códigos não têm horário fixo (uma hora extra avulsa, por exemplo). Nesses casos abre uma caixinha pedindo a hora de início. É obrigatório: sem ela, o sistema não sabe quando esperar a pessoa.',
            },
            { titulo: 'Salve', texto: 'Clique em **Salvar Previsão** ao terminar.' },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Turno noturno: a hora pode ser do dia seguinte, e a célula avisa',
          texto:
            'Quem faz jornada que atravessa a meia-noite (das 18h às 6h, por exemplo) costuma ter uma hora extra de passagem de turno logo depois — às 6h. Essa hora é do **dia seguinte**, não do dia em que o turno começou. Você informa **06:00** normalmente; a célula passa a mostrar **06:00+1D** para deixar claro de que dia é. Quando não aparece nada depois da hora, é o mesmo dia.',
        },
        { tipo: 'titulo', texto: 'Os códigos mais usados' },
        {
          tipo: 'tabela',
          colunas: ['Código', 'Significa', 'Duração típica'],
          linhas: [
            ['`M`', 'Manhã', '6h'],
            ['`T`', 'Tarde', '6h'],
            ['`N`', 'Noite — atravessa a meia-noite', '12h'],
            ['`MT`', 'Manhã e tarde (o plantão diurno de 12h)', '12h'],
            ['`TN`', 'Tarde e noite', '18h'],
            ['`MTN`', 'O dia inteiro', '24h'],
            ['`M4`, `T4`, `N6`…', 'O número é a duração em horas', 'conforme o número'],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'A lista completa está no sistema',
          texto:
            'São mais de 60 códigos. A lista oficial, com duração e horário de cada um, está em **Cadastros → Dicionário de Turnos**.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Apagar um dia que já tem ponto',
          texto:
            'Se o dia já tem presença registrada, a célula fica protegida — apagar ali apagaria o registro de que a pessoa trabalhou. Para **trocar** o turno de um dia com ponto, o sistema pede uma justificativa, que fica guardada junto com a alteração.',
        },
      ],
    },

    {
      id: 'preencher-rapido',
      titulo: 'Preenchendo rápido: Template e Gerador',
      resumo: 'As duas formas de não digitar o mês inteiro à mão.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        { tipo: 'titulo', texto: 'Aplicar Modelo de Escala' },
        {
          tipo: 'p',
          texto:
            'Serve para o padrão que se repete: "plantão dia sim, dia não", "de segunda a sexta". Você escolhe o servidor, o turno, o dia de início e o ritmo — o sistema preenche o mês.',
        },
        {
          tipo: 'lista',
          itens: [
            'Dá para pedir que ele **pule dias de afastamento**, e vale a pena deixar marcado.',
            'Ele **nunca sobrescreve** dia que já tem ponto batido.',
          ],
        },
        { tipo: 'titulo', texto: 'Gerador Inteligente' },
        {
          tipo: 'p',
          texto:
            'O Gerador olha os **meses anteriores** do próprio setor e sugere a escala do mês seguindo o que já vinha acontecendo. É útil em setor com rotina estável.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Ele sugere, você confere',
          texto:
            'O Gerador acerta bem o Regular e razoavelmente o Plantão. Para **Extra** e **Sobreaviso** ele entra desmarcado de propósito: sugerir hora extra a mais significa hora paga que ninguém decidiu, e você teria que caçar na grade para apagar.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Leia a mensagem do fim',
          texto:
            'Ao terminar, ele diz quantas células **mudaram** — e não quantas foram calculadas. Se aparecer "0 células alteradas", não é falha: quer dizer que o que ele sugeriu já estava lançado, ou caiu em dias com ponto e afastamento, que ele não toca.',
        },
      ],
    },

    {
      id: 'travas',
      titulo: 'Quando o sistema não deixa salvar',
      resumo: 'As quatro travas da grade e o que fazer em cada uma.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'A grade recusa lançamentos que criariam problema na folha depois. Toda recusa vem com o motivo escrito — vale ler a mensagem antes de tentar de novo.',
        },
        {
          tipo: 'tabela',
          colunas: ['A trava', 'Por que existe', 'O que fazer'],
          linhas: [
            [
              'Afastamento no dia',
              'A pessoa está de férias, licença ou atestado naquele dia.',
              'Se o afastamento está errado, corrija em Afastamentos. Se está certo, não escale.',
            ],
            [
              'Mesma pessoa em dois setores no mesmo horário',
              'Um servidor não ocupa dois lugares ao mesmo tempo — e a folha contaria as horas duas vezes.',
              'Decida em qual setor ela fica naquele dia e apague o outro lançamento.',
            ],
            [
              'Teto de horas do mês',
              'Existe um limite mensal por servidor, somando **todas** as escalas dele, em todos os setores.',
              'Reduza, ou peça Autorização de Escala para o RH liberar aquele mês.',
            ],
            [
              'Competência fechada',
              'O mês já foi encerrado e virou documento.',
              'Peça ao RH ou ao Administrador para reabrir a competência.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'O teto é da pessoa, não do seu setor',
          texto:
            'Se o mesmo servidor trabalha em dois setores, as horas dos dois somam. Pode acontecer de a sua grade parecer dentro do limite e o sistema recusar mesmo assim — é a outra escala dele contando junto. A tela informa onde estão as outras horas.',
        },
        { tipo: 'veja', secaoId: 'autorizacoes', texto: 'Como pedir autorização de carga' },
      ],
    },

    {
      id: 'validar-presenca',
      titulo: 'Validando presença pela grade',
      resumo: 'O que fazer com o dia em que a pessoa trabalhou mas o ponto não registrou.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Na aba **Validado**, um dia sem registro aparece como pendente. Se a pessoa de fato trabalhou, você valida — e há duas formas de fazer isso, com pesos diferentes.',
        },
        {
          tipo: 'tabela',
          colunas: ['Forma', 'Quando usar', 'Como fica registrado'],
          linhas: [
            [
              'Selecionar a batida',
              'Existe batida no sistema, só não foi encaixada no passo certo (bateu fora do horário previsto, por exemplo).',
              'Como **batida real**, com o horário exato e a origem preservados.',
            ],
            [
              'Digitar o horário',
              'Não existe batida nenhuma: a pessoa esqueceu, o relógio estava fora do ar.',
              'Como **declaração do coordenador**, com justificativa. A folha mostra que aquilo foi informado, não medido.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Prefira sempre selecionar',
          texto:
            'Quando a batida existe, selecione em vez de digitar. Digitar por cima de uma batida real perde os segundos, a origem e o vínculo com o registro do relógio — e transforma um fato em declaração.',
        },
        {
          tipo: 'aviso',
          tom: 'legal',
          titulo: 'Declarar é legítimo, e tem nome',
          texto:
            'O coordenador declarar a jornada de quem esqueceu de bater é previsto em lei, desde que fique registrado como tal, com justificativa. O que a lei proíbe é o **sistema** preencher sozinho, como se fosse batida.',
        },
        { tipo: 'titulo', texto: 'Validação em massa' },
        {
          tipo: 'p',
          texto:
            'Dá para validar vários dias de uma vez. A validação em massa **pula automaticamente** os dias que têm batida pendente de revisão — onde existe horário real disponível, ele ganha do declarado. Os dias pulados aparecem na mensagem, para você tratar um a um.',
        },
        { tipo: 'veja', secaoId: 'preencher-batidas', texto: 'Quando há muitos dias assim, comece por aqui' },
      ],
    },

    {
      id: 'preencher-batidas',
      titulo: 'Preencher pelas batidas de uma vez',
      resumo: 'Quando a escala foi lançada depois que o pessoal já bateu o ponto.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Acontece muito no começo do mês: o pessoal bate o ponto normalmente, mas a escala ainda não foi lançada. Quando você lança os turnos depois, as células ficam **vazias** — as batidas existem, só não foram encaixadas nos dias. Uma a uma, isso é muito clique.',
        },
        {
          tipo: 'caminho',
          itens: ['Escalas', 'abrir a grade do setor', 'Ferramentas', 'Preencher pelas Batidas'],
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'O sistema confere e mostra antes de mexer',
              texto: 'Ao abrir, ele lista o que encontrou. **Nada é gravado nesse momento** — é só uma conferência.',
            },
            {
              titulo: 'Você lê o que vai ser preenchido',
              texto: 'Cada dia aparece com o servidor e os horários que entrariam, com a origem de cada um.',
            },
            {
              titulo: 'Clica em Preencher',
              texto: 'Só então os horários entram na grade, como batida real — do mesmo jeito que se você tivesse selecionado uma a uma.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Ele só preenche o que está vazio',
          texto:
            'Se em algum dia a batida mudaria um horário que já está gravado, esse dia **não entra**. Ele aparece na lista "Precisam da sua decisão", com o horário atual e o que a batida diria — e você resolve na célula, como sempre. Isso é proposital: trocar um horário já registrado é decisão sua, não do sistema.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Nenhum horário é inventado',
          texto:
            'Todo horário preenchido vem de uma batida que existe. Onde não houver batida, a célula continua vazia — e aí o caminho é a validação manual, digitando com justificativa.',
        },
        {
          tipo: 'p',
          texto:
            'Se a lista vier vazia, está tudo certo: não há dia com batida que a grade ainda não tenha aproveitado. É o resultado mais comum depois da primeira rodada do mês.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A folha de ponto é um documento à parte',
          texto:
            'Preencher a grade não mexe na folha já gerada. Depois de usar o botão, abra a folha da competência e clique em **Sincronizar** para que os horários apareçam lá.',
        },
        {
          tipo: 'lista',
          itens: [
            'Dias de hoje nunca entram — pode faltar a saída só porque a pessoa ainda está trabalhando.',
            'Escala **Fechada** e competência encerrada aparecem como bloqueadas: reabra antes.',
            'Sobreaviso não entra: ele não marca presença.',
          ],
        },
        { tipo: 'veja', secaoId: 'validar-presenca', texto: 'Como validar dia a dia' },
      ],
    },

    {
      id: 'servidor-externo',
      titulo: 'Escalando alguém de outro setor',
      resumo: 'O "Servidor Externo": quem é lotado em outro lugar mas vai trabalhar no seu.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Precisa escalar alguém que não é lotado no seu setor? Use **Adicionar Servidor Externo** na grade. A pessoa entra na sua escala sem mudar a lotação dela no cadastro.',
        },
        {
          tipo: 'passos',
          itens: [
            { titulo: 'Clique em "Servidor Externo"' },
            {
              titulo: 'Busque por nome ou matrícula — ou navegue por unidade e setor',
              texto: 'As duas formas funcionam; a busca é mais rápida quando você sabe o nome.',
            },
            { titulo: 'Adicione e lance os turnos normalmente' },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Ele conta no teto de horas dele',
          texto:
            'As horas que você lançar somam com as do setor de origem. Se o teto estourar, a trava aparece para você — mesmo que a maior parte das horas tenha sido lançada por outra pessoa, em outro setor.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Ponto do externo',
          texto:
            'Ele bate ponto onde tem biometria cadastrada. Se ele vai trabalhar fisicamente no seu setor e o relógio de lá não o conhece, confira a Cobertura de Ponto — senão a batida dele não será registrada.',
        },
      ],
    },

    {
      id: 'mover-escala',
      titulo: 'Transferindo a escala para outro setor',
      resumo: 'Quando a escala foi lançada no setor errado, ou a pessoa mudou de lotação.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Dá para **mover** a escala de um servidor para outro setor sem apagar e relançar. O ponto já registrado vai junto.',
        },
        {
          tipo: 'tabela',
          colunas: ['Opção', 'O que faz', 'Quando usar'],
          linhas: [
            [
              'Mover a competência inteira',
              'Todo o mês vai para o setor novo.',
              'A escala foi lançada no setor errado desde o começo.',
            ],
            [
              'Dividir na data',
              'Até a data escolhida fica no setor antigo; do dia da mudança em diante vai para o novo.',
              'A pessoa mudou de setor no meio do mês.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Dividir gera duas folhas no mês',
          texto:
            'É proposital: cada chefia assina o período que chefiou. Se a folha do mês já foi gerada, o sistema pede que ela seja sincronizada antes.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Mês fechado não se move',
          texto:
            'Se a competência estiver encerrada ou a escala Fechada, a operação é recusada. Reabra primeiro — reabrir é um ato registrado, e é essa a porta certa.',
        },
      ],
    },

    {
      id: 'sobreaviso',
      titulo: 'Sobreaviso: acionar e registrar chegada',
      resumo: 'O ciclo completo do sobreaviso, que não passa pela folha de ponto.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Sobreaviso é **estar disponível**. Enquanto ninguém é chamado, não há nada a registrar. Quando surge a necessidade, começa o ciclo:',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Acionar',
              texto:
                'Na célula de sobreaviso do dia, você aciona e escreve o motivo. O servidor recebe um link por WhatsApp ou e-mail.',
            },
            {
              titulo: 'Escolher o destino',
              texto:
                'Você informa **para onde** a pessoa foi chamada. Quem está de sobreaviso atende a rede inteira, não só a unidade dele.',
            },
            { titulo: 'Aceite', texto: 'O servidor confirma pelo link que recebeu.' },
            {
              titulo: 'Chegada',
              texto:
                'Ao chegar, ele registra — e o sistema confere a localização contra o **local do chamado**. Se não houver como registrar pelo celular, você valida manualmente.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Acionar só funciona dentro da janela do plantão',
          texto:
            'O botão "Novo Acionamento neste Dia" fica desabilitado fora do horário do sobreaviso daquele dia, e o sistema mostra a janela exata ao lado. Para registrar um atendimento que já aconteceu, use **Validar Este Chamado (Manual)**.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          texto:
            'Quem pode **ver** o painel de sobreaviso é toda a gestão. Quem pode **acionar** depende da configuração do setor: alguns acionam a rede inteira, outros só a própria unidade.',
        },
      ],
    },

    {
      id: 'autorizacoes',
      titulo: 'Autorizações de Escala',
      resumo: 'Pedir e conceder liberação para passar do teto mensal de horas.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'Diretor', 'RH da Unidade', 'RH Geral'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Autorizações de Escala'], href: '/autorizacoes-escala' },
        {
          tipo: 'p',
          texto:
            'Existe um limite de horas por servidor por mês. Quando a escala precisa passar dele — cobertura de férias, falta de pessoal —, alguém com autoridade precisa autorizar. Esta tela é os dois lados do pedido.',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Quem lança a escala pede',
              texto:
                'Ao esbarrar no teto, use o escudo na linha do servidor para abrir o pedido, dizendo quantas horas a mais e por quê.',
            },
            {
              titulo: 'Quem tem autoridade decide',
              texto:
                'Diretor e RH da Unidade decidem dentro do escopo deles; RH Geral e Administrador, em qualquer lugar.',
            },
            {
              titulo: 'Aprovado, o teto sobe naquele mês',
              texto: 'A grade volta a aceitar o lançamento na hora.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A autorização é uma por servidor, por mês — e vale para todas as escalas dele',
          texto:
            'Se a mesma pessoa trabalha em dois setores, a autorização concedida a partir de um deles vale para os dois. Ao conceder, a tela mostra quem já autorizou aquele mês, de qual unidade e quando — para ninguém sobrescrever sem ver.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          texto:
            'Na grade, o escudo **azul** quer dizer que já existe um pedido em aberto para aquele servidor. Não precisa pedir de novo.',
        },
      ],
    },
  ],
}
