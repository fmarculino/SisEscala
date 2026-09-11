import type { Capitulo } from '../tipos'

export const ponto: Capitulo = {
  id: 'ponto',
  titulo: 'Ponto e Folha',
  icone: 'Fingerprint',
  descricao: 'Como a batida vira folha, o que fazer com pendências e como fechar o mês.',
  secoes: [
    {
      id: 'como-bate',
      titulo: 'As formas de bater ponto',
      resumo: 'Relógio biométrico, terminal na tela e o que acontece depois da batida.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'p',
          texto: 'Uma unidade pode ter relógio, terminal, ou os dois. Para o servidor, muda pouco:',
        },
        {
          tipo: 'tabela',
          colunas: ['Forma', 'Como o servidor usa', 'O que é preciso'],
          linhas: [
            [
              'Relógio biométrico (REP)',
              'Encosta o dedo no equipamento.',
              'Estar cadastrado **naquele** relógio, com a digital coletada presencialmente.',
            ],
            [
              'Terminal da unidade',
              'Digita matrícula e PIN na tela.',
              'Ter matrícula e PIN, e estar lotado na unidade daquele terminal.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Quem responde pelo terminal não precisa ser chefe de quem bate',
          texto:
            'No cadastro do terminal existe um **coordenador responsável** — ele é o supervisor do equipamento, para efeito de registro. Quem pode bater ali é decidido pela **unidade e pelo setor do próprio terminal**, não pelo escopo desse coordenador. Ele pode ser de outra unidade sem que isso atrapalhe ninguém.',
        },
        { tipo: 'titulo', texto: 'Os quatro passos do dia' },
        {
          tipo: 'p',
          texto:
            'O sistema entende sozinho qual passo você está registrando, pela hora da batida: **entrada**, **saída para o intervalo**, **retorno do intervalo** e **saída**. Não existe botão de escolher.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Jornada de até 6 horas registra só entrada e saída',
          texto:
            'O intervalo só é exigido acima de 6 horas de trabalho contínuo. Em jornada curta, os dois passos do meio não existem — e isso não é falta de registro.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Duas batidas seguidas no mesmo minuto contam como uma',
          texto:
            'Se a pessoa encostar o dedo duas vezes em menos de um minuto, a segunda é descartada como repetição. Ao trocar de turno no mesmo dia, espere alguns minutos entre uma batida e outra.',
        },
      ],
    },

    {
      id: 'cores-terminal',
      titulo: 'As cores do terminal (importante)',
      resumo: 'Verde, âmbar e vermelho querem dizer coisas bem diferentes.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'tabela',
          colunas: ['Cor', 'Significa', 'O servidor deve'],
          linhas: [
            ['Verde', 'Registrado, dentro do horário previsto.', 'Seguir o dia.'],
            [
              'Âmbar',
              '**Registrado**, mas fora do horário previsto. Vai para revisão do coordenador.',
              'Seguir o dia. A batida foi guardada — não precisa bater de novo.',
            ],
            [
              'Vermelho',
              '**Nada foi registrado.** Matrícula ou PIN errados.',
              'Conferir a matrícula e o PIN e tentar de novo.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Âmbar não é erro',
          texto:
            'Muita gente vê o âmbar, acha que falhou e bate de novo. A batida foi aceita e está guardada; ela só precisa que o coordenador confirme depois. Só o **vermelho** exige repetir.',
        },
      ],
    },

    {
      id: 'nao-apareceu',
      titulo: 'Bati o ponto e não apareceu',
      resumo: 'As causas reais, na ordem em que devem ser conferidas.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Administrador Geral'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'É a queixa mais comum, e quase nunca é o equipamento. Confira nesta ordem — as duas primeiras respondem a maioria dos casos:',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'A pessoa está vinculada àquele relógio?',
              texto:
                'Em Marcações → **Cobertura de Ponto**, procure pelo nome. Se aparecer como fora do relógio ou sem biometria, o equipamento aceita a digital mas o sistema não sabe de quem é. Este é o caso mais frequente, e é silencioso dos dois lados.',
            },
            {
              titulo: 'A batida chegou, mas ficou pendente?',
              texto:
                'Em Marcações → **Pendências**, veja se existe registro daquele dia esperando revisão. Se existir, é só aceitar — o horário real está lá.',
            },
            {
              titulo: 'A escala do dia existe?',
              texto:
                'Sem turno lançado, o sistema não tem onde encaixar a batida. Ela fica guardada, mas não aparece na folha. Lance o turno e a batida se encaixa.',
            },
            {
              titulo: 'A escala foi lançada depois da batida?',
              texto:
                'Se o turno foi lançado depois de a pessoa bater, pode ser preciso reprocessar aquele dia. Fale com quem administra o sistema — o horário não se perdeu.',
            },
            {
              titulo: 'A pessoa bateu no relógio de outra unidade?',
              texto:
                'Quem trabalha em duas unidades bate em cada uma delas, e o sistema encaixa a batida na escala **daquela** unidade. Se ela bateu no relógio errado, o horário fica em Pendências e não entra na folha sozinho.',
            },
            {
              titulo: 'A folha já foi gerada antes da correção?',
              texto:
                'A folha é uma fotografia. Corrigiu depois de gerar? Clique em **Sincronizar** na folha.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'A batida nunca é jogada fora',
          texto:
            'Batida sem escala, fora do horário, duplicada ou de alguém que o sistema não reconheceu — todas ficam gravadas. Recuperar é sempre possível; o que muda é quanto trabalho dá.',
        },
      ],
    },

    {
      id: 'folha',
      titulo: 'A Folha de Ponto',
      resumo: 'O que ela mostra, como gerar, o que é preservado ao sincronizar.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Folha de Ponto'], href: '/folha-ponto' },
        {
          tipo: 'p',
          texto:
            'A folha é o documento do mês: um servidor, uma competência, dia a dia, com previsto e realizado lado a lado. É o que se imprime e se assina.',
        },
        { tipo: 'titulo', texto: 'Gerar e sincronizar' },
        {
          tipo: 'tabela',
          colunas: ['Ação', 'O que faz'],
          linhas: [
            ['Gerar', 'Cria a folha a partir da escala e do ponto registrado.'],
            [
              'Sincronizar',
              'Atualiza uma folha existente com o que mudou na escala depois de ela ter sido gerada.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'O que sobrevive ao Sincronizar',
          texto:
            'Sincronizar **preserva** o que uma pessoa decidiu — horário digitado pelo coordenador, ajuste aprovado do servidor. E **regera** o que veio do ponto, para que a folha receba a correção de uma batida mal encaixada. Sincronizar não desfaz o seu trabalho.',
        },
        { tipo: 'titulo', texto: 'Os status' },
        {
          tipo: 'tabela',
          colunas: ['Status', 'Significa', 'Pode editar?'],
          linhas: [
            ['Rascunho', 'Está sendo montada.', 'Sim.'],
            ['Gerada', 'Pronta para conferência.', 'Sim.'],
            ['Revisada', 'Conferida e fechada.', 'Só depois de reaberta por RH ou Administrador.'],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Horário de batida real é protegido',
          texto:
            'Alterar à mão um horário que veio do relógio ou do terminal é recusado — só o Administrador Geral consegue. Não é burocracia: é o que impede que o registro original de ponto seja reescrito.',
        },
      ],
    },

    {
      id: 'atraso-compensacao',
      titulo: 'Atraso, hora extra e compensação',
      resumo: 'Por que o sistema pergunta, e o que cada resposta significa na folha.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'A folha mede as **duas pontas** do dia: a entrada e a saída. Quando alguém chega atrasado e sai depois do previsto, aparecem as duas coisas no mesmo dia — um atraso e um tempo a mais no fim.',
        },
        {
          tipo: 'p',
          texto:
            'O sistema **não decide sozinho** o que fazer com isso. Ele mostra o dia e pede a sua decisão:',
        },
        {
          tipo: 'tabela',
          colunas: ['Decisão', 'Efeito na folha'],
          linhas: [
            [
              'É compensação',
              'O tempo a mais no fim do dia cobre o atraso da manhã. Não vira hora extra.',
            ],
            [
              'É hora extra',
              'O atraso permanece como atraso e o tempo a mais é pago como hora extra.',
            ],
            [
              'Pendente',
              'Nada muda ainda. A folha continua exatamente como está, e o fechamento cobra a decisão.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'legal',
          titulo: 'Por que precisa de decisão humana',
          texto:
            'Compensar atraso depende de autorização da chefia — não é automático. Por isso o sistema pergunta em vez de decidir, e por isso "pendente" não altera valor nenhum: enquanto ninguém decide, a folha não muda.',
        },
        {
          tipo: 'lista',
          itens: [
            'A compensação acontece **dentro do próprio dia** — não existe saldo que atravessa o mês.',
            'Há um teto diário para o que pode ser compensado.',
            'Dia incompleto (faltando entrada ou saída) não compensa.',
          ],
        },
      ],
    },

    {
      id: 'autorizar-extra',
      titulo: 'Autorizar a hora extra',
      resumo: 'Por que a folha pergunta, e o que muda em cada resposta.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Folha de Ponto'], href: '/folha-ponto' },
        {
          tipo: 'p',
          texto:
            'Quando alguém sai depois do horário previsto, a folha registra esse tempo como hora extra. A norma do ponto eletrônico da Secretaria (Art. 8º) exige que a chefia **autorize** a sobrejornada — e até agora não havia onde registrar essa autorização.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Enquanto ninguém decide, nada muda',
          texto:
            'O dia aparece com a etiqueta **extra — autorizar?** e continua contando a hora extra exatamente como antes. O sistema **não** decide por você: ele apenas passa a perguntar, e a pergunta volta quando você fecha a folha.',
        },
        {
          tipo: 'tabela',
          colunas: ['Sua resposta', 'O que acontece'],
          linhas: [
            [
              '**Autorizar**',
              'A hora extra continua contando, agora com o seu nome e a data como quem autorizou.',
            ],
            [
              '**Não autorizar**',
              'O tempo excedente deixa de contar como hora extra. **O horário batido continua registrado e impresso na folha** — o que muda é o pagamento, não o registro.',
            ],
            [
              '**Decidir depois**',
              'O dia fica pendente e volta a perguntar no fechamento. Nenhum valor muda.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Primeiro a compensação, depois a autorização',
          texto:
            'Se a pessoa chegou atrasada e saiu depois, o sistema pergunta antes se aquele tempo **repõe o atraso**. Só o que sobra depois dessa decisão vira pergunta de autorização — você nunca decide duas vezes sobre o mesmo minuto.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'A decisão é reversível enquanto a folha estiver aberta',
          texto:
            'Errou a resposta? Reabra a folha e decida de novo. Toda mudança fica no histórico com o nome de quem fez. Competências anteriores a setembro de 2026 não são afetadas.',
        },
        { tipo: 'veja', secaoId: 'atraso-compensacao', texto: 'A decisão que vem antes desta' },
      ],
    },

    {
      id: 'duas-unidades',
      titulo: 'Quem trabalha em duas unidades',
      resumo: 'Cada batida conta para a unidade onde o dedo encostou — e não para a outra.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Administrador Geral'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'É cada vez mais comum a mesma pessoa ter escala em duas unidades no mesmo dia — plantão em um hospital de manhã e expediente em uma unidade básica à tarde, por exemplo. Ela bate o ponto no relógio de cada lugar, e o sistema encaixa **cada batida na escala da unidade onde ela foi feita**.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A batida no relógio errado não entra na folha sozinha',
          texto:
            'Se a pessoa tinha turno na unidade A e bateu no relógio da unidade B, aquele horário **não** preenche a escala de A. Ele não se perde: fica em Marcações → Pendências, para quem cuida da unidade B. O passo em A aparece vazio, esperando decisão.',
        },
        {
          tipo: 'titulo',
          texto: 'Quando a pessoa realmente trabalhou aqui, mas bateu no relógio de lá',
        },
        {
          tipo: 'p',
          texto:
            'Acontece — o relógio da unidade fora do ar, e a pessoa bate no da unidade vizinha. Nesse caso você usa a batida normalmente: abra a validação manual do dia, e ela estará na lista, marcada em vermelho com **bateu em** e o nome da unidade e do relógio. Selecione, e o horário real vai para a folha.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'A etiqueta vermelha existe para você não decidir às cegas',
          texto:
            'Antes, uma batida feita a quilômetros dali podia virar o horário desta escala sem ninguém notar. Hoje o sistema não faz mais isso sozinho — mas ainda deixa você fazer, de propósito, porque só você sabe se a pessoa cumpriu o turno aqui. Use quando tiver certeza; na dúvida, confirme com a chefia da outra unidade.',
        },
        {
          tipo: 'titulo',
          texto: 'Turnos que se encostam, em unidades diferentes',
        },
        {
          tipo: 'p',
          texto:
            'Sair de um plantão às 12:00 em uma unidade e entrar às 12:00 em outra são **dois turnos**, não um só. O sistema trata cada um separadamente: cada unidade tem sua entrada, sua saída e seu intervalo. Espere duas batidas próximas na virada — uma fechando lá, outra abrindo aqui — e isso é o certo.',
        },
        { tipo: 'veja', secaoId: 'nao-apareceu', texto: 'Bati o ponto e não apareceu' },
      ],
    },

    {
      id: 'marcacoes',
      titulo: 'A tela Marcações',
      resumo: 'As nove abas do módulo de ponto e para que serve cada uma.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Marcações'], href: '/marcacoes' },
        {
          tipo: 'p',
          texto:
            'É o centro de controle do ponto. Você não usa todas as abas todo dia — a maioria serve na instalação e na manutenção dos equipamentos.',
        },
        {
          tipo: 'tabela',
          colunas: ['Aba', 'Para que serve', 'Com que frequência'],
          linhas: [
            [
              'Entrada',
              'Visão geral do que está chegando dos relógios e terminais.',
              'Sempre que quiser conferir se o ponto está fluindo.',
            ],
            [
              'Terminais Locais',
              'Cadastrar e ativar o terminal de ponto de uma unidade, e revogar o acesso dele.',
              'Na instalação, e quando um computador é trocado.',
            ],
            [
              'Dispositivos REP',
              'Cadastro dos relógios biométricos: endereço, setores atendidos, download do aplicativo coletor.',
              'Na instalação de um relógio novo.',
            ],
            [
              'Cobertura de Ponto',
              'Quem consegue e quem **não consegue** bater ponto, com o motivo.',
              'A mais útil no dia a dia. Confira mensalmente.',
            ],
            [
              'Pendências',
              'Batidas que precisam de revisão do coordenador.',
              'Durante o mês, para não acumular no fechamento.',
            ],
            [
              'Biometria Pendente',
              'Quem já está cadastrado no relógio mas ainda não coletou a digital.',
              'Enquanto a unidade está implantando.',
            ],
            [
              'Higiene do Relógio',
              'Quem está cadastrado no equipamento e não deveria estar — típico de relógio reaproveitado de outro sistema.',
              'Uma vez, na implantação.',
            ],
            [
              'Importar por Pendrive',
              'Trazer as batidas de um relógio sem rede até o servidor, por arquivo.',
              'Só em unidade sem rede até o sistema.',
            ],
            [
              'Autorizações do RH',
              'O RH libera, por servidor e período, quais passos o coordenador pode declarar em massa na grade — sem justificar dia a dia. Todo gestor consulta; quem libera é o RH Geral, ou o RH da Unidade nos servidores lotados nas unidades dele.',
              'Quando houver ofício autorizando.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Autorização do RH não dispensa a batida',
          texto:
            'Mesmo com a autorização, a saída continua vindo do relógio. O que é declarado sai na folha como **manual**, com a justificativa e o número do ofício — nunca como se fosse batida. A autorização vale por um período (até 12 meses) e é renovável por novo ato.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Nem todo perfil vê todas as abas',
          texto:
            'Terminais Locais, Dispositivos REP, Higiene do Relógio e Importar por Pendrive mexem em equipamento, e aparecem para o RH Geral, o RH da Unidade, o Diretor e o Administrador Geral. O Coordenador e o Ass. Administrativo veem as demais. Quem é RH da Unidade enxerga só os equipamentos das unidades vinculadas ao perfil dele — a tela avisa isso no topo.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Se você for olhar só uma aba, olhe Cobertura de Ponto',
          texto:
            'É a única tela que responde "todo mundo do meu setor consegue registrar ponto?" antes de o mês acabar. Todas as outras respondem depois.',
        },
      ],
    },

    {
      id: 'trocar-relogio',
      titulo: 'Quando o relógio é trocado',
      resumo: 'O que fazer quando o aparelho queima e vem outro no lugar.',
      papeis: ['Administrador Geral'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Marcações', 'Dispositivos REP'], href: '/marcacoes' },
        {
          tipo: 'p',
          texto:
            'Relógio queima, e às vezes vem um aparelho novo com o mesmo endereço e a mesma senha. Para quem olha de fora nada mudou — mas o sistema precisa saber que o aparelho é outro.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Sem esse aviso, o ponto da unidade some sem ninguém perceber',
          texto:
            'Cada relógio numera as batidas em sequência, e um aparelho novo recomeça do zero. O sistema continua pedindo a partir da numeração que o aparelho antigo tinha alcançado, o aparelho novo responde que não tem nada com aquele número, e **a sincronização é registrada como bem-sucedida** — todo ciclo, sem erro em tela nenhuma. Quem trabalha ali continua encostando o dedo, o relógio continua aceitando, e a batida nunca chega.',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Registre a troca ANTES de ligar o aparelho novo na rede',
              texto:
                'Abra o relógio em Dispositivos REP e clique em "Trocamos o aparelho". Se o aparelho novo já estiver coletando, as primeiras batidas dele podem se perder — é a única parte irreversível.',
            },
            {
              titulo: 'Descreva o que houve',
              texto:
                'O texto fica guardado com o seu nome e a data. Ele é o que explica, meses depois, por que a numeração daquele ponto recomeçou.',
            },
            {
              titulo: 'Confira a hora do aparelho novo',
              texto:
                'Relógio novo costuma vir com a hora errada, e batida com data errada não entra na folha de ninguém. O aplicativo coletor acerta sozinho, mas confira antes de liberar o uso.',
            },
            {
              titulo: 'Cadastre as pessoas de novo',
              texto:
                'O aparelho novo chega vazio. Use "Sincronizar cadastros" e depois acompanhe pela Cobertura de Ponto quem ainda falta coletar a digital — ela não vem junto com o cadastro.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Nada do que já foi registrado se perde',
          texto:
            'As batidas do aparelho anterior continuam guardadas e continuam valendo como prova daquele período. A troca só ensina o sistema a não confundir a numeração de um com a do outro.',
        },
        { tipo: 'veja', secaoId: 'cobertura-ponto', texto: 'Depois da troca, acompanhe por aqui' },
      ],
    },

    {
      id: 'cobertura-ponto',
      titulo: 'Cobertura de Ponto',
      resumo: 'A tela que mostra quem não consegue bater — e por quê.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Estar cadastrado no sistema **não é** estar apto a bater ponto. Falta o cadastro no equipamento e a biometria coletada. Esta aba mostra a situação de cada pessoa, com o que fazer em cada caso.',
        },
        {
          tipo: 'tabela',
          colunas: ['Situação', 'O que quer dizer', 'O que fazer'],
          linhas: [
            ['Pronto', 'Cadastrado no relógio, com biometria, e vinculado.', 'Nada.'],
            [
              'Sem biometria',
              'Está no relógio, mas a digital nunca foi coletada. **Não consegue bater.**',
              'Levar a pessoa até o equipamento para coletar a digital.',
            ],
            [
              'Fora do relógio',
              'Nem chegou a ser cadastrado no equipamento.',
              'Usar "Sincronizar cadastros" na tela do dispositivo, ou verificar se falta CPF/PIS na ficha.',
            ],
            [
              'Sem vínculo',
              'A batida chega, mas o sistema não consegue dizer de quem é.',
              'Criar o vínculo pela própria tela.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A cobertura é por relógio',
          texto:
            'Numa unidade com mais de um equipamento, a mesma pessoa aparece uma vez por relógio — e isso está certo: para bater num relógio é preciso ter digital **naquele**. A tela distingue quem não bate em lugar nenhum de quem usa outra entrada da unidade.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'A lista inclui quem está lotado, não só quem está escalado',
          texto:
            'Assim você enxerga também quem ainda não foi escalado neste mês mas já precisa estar apto — que é justamente quem costuma passar despercebido.',
        },
      ],
    },

    {
      id: 'cobertura-escala',
      titulo: 'Cobertura da Escala',
      resumo: 'Quem está escalado onde ainda não consegue bater ponto.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Enquanto a Cobertura de Ponto responde **por relógio**, esta aba responde pelo município inteiro: de todo mundo escalado no mês, quem **não consegue registrar ponto no lugar onde foi escalado**. A lista vem ordenada pelo primeiro dia escalado, então o mais urgente aparece primeiro. Quem já consegue bater não aparece.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Plantão em outra unidade exige digital naquela unidade',
          texto:
            'Quem é lotado num lugar e faz plantão em outro aparece aqui marcado como **externo**. O cadastro dele chega sozinho ao relógio da outra unidade, mas **a digital não** — ela precisa ser coletada lá, uma vez. Se ninguém fizer isso antes do primeiro plantão, a pessoa trabalha e o dia sai em branco.',
        },
        {
          tipo: 'tabela',
          colunas: ['Situação', 'O que quer dizer', 'O que fazer'],
          linhas: [
            [
              'Sem biometria',
              'Está cadastrada no relógio da unidade, sem digital.',
              'Levar a pessoa ao equipamento para coletar a digital.',
            ],
            [
              'Fora do relógio',
              'Ainda não foi cadastrada no equipamento daquela unidade.',
              'A rotina diária resolve sozinha. Para não esperar, use "Sincronizar cadastros" na aba Dispositivos REP — depois ainda falta a digital.',
            ],
            [
              'Setor sem relógio',
              'O setor onde ela foi escalada não é atendido por equipamento nenhum.',
              'Vincular o setor a um relógio, ou confirmar que ali o ponto é registrado por outro meio.',
            ],
            [
              'Só em um relógio',
              'Tem digital em parte dos relógios do setor, não em todos.',
              'Quando os equipamentos ficam no mesmo computador, o sistema copia a digital sozinho no próximo ciclo.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'A coluna "já bate em" poupa viagem',
          texto:
            'Cada linha diz onde aquela pessoa já consegue bater hoje. Quem já bate em alguma unidade só precisa da coleta na nova — quem não bate em lugar nenhum nunca teve digital coletada, e costuma ser gente recém-admitida.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A digital não passa de uma unidade para outra',
          texto:
            'A cópia automática de digital só acontece entre relógios **da mesma unidade** atendidos pelo **mesmo computador**. Entre unidades diferentes não há caminho: quem trabalha em duas unidades cadastra a digital nas duas, uma vez em cada.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Exportar para distribuir',
          texto:
            'O botão **Exportar CSV** gera a lista filtrada para enviar a cada unidade, com nome, matrícula, setor, situação e o primeiro dia escalado.',
        },
      ],
    },

    {
      id: 'justificativas',
      titulo: 'Justificativas',
      resumo: 'Registrar por escrito o motivo de uma falta ou ocorrência.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Justificativas'], href: '/justificativas' },
        {
          tipo: 'p',
          texto:
            'A justificativa é o texto que explica uma ocorrência do mês — uma falta, uma alteração de turno, um dia atípico. Ela acompanha a folha e sai nos relatórios.',
        },
        {
          tipo: 'lista',
          itens: [
            'Pode nascer aqui, lançada pelo coordenador.',
            'Pode nascer de uma alteração de turno em dia com ponto — nesse caso o motivo que você escreveu entra automaticamente na justificativa do dia.',
            'Pode nascer de um pedido do servidor pelo Portal.',
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          texto:
            'Justificativa não é afastamento. Se a pessoa ficou fora por atestado, férias ou licença, lance em **Afastamentos** ou **Férias e Licenças** — esses sim mudam a escala e a folha.',
        },
      ],
    },
  ],
}
