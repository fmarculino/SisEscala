import type { Capitulo } from '../tipos'

export const comeceAqui: Capitulo = {
  id: 'comece-aqui',
  titulo: 'Comece por aqui',
  icone: 'Compass',
  descricao: 'O que o sistema faz, como ele se organiza e onde ficam as coisas.',
  secoes: [
    {
      id: 'o-que-e',
      titulo: 'O que é o SisEscala',
      resumo: 'Em uma frase: é onde a escala é planejada, o ponto é registrado e a folha é fechada.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'O SisEscala é o sistema de **escalas e ponto digital** da Secretaria Municipal de Saúde de Marabá. Ele junta, num lugar só, três coisas que antes viviam separadas: o **planejamento** (quem trabalha em que dia), o **registro** (quem de fato veio, a que horas) e o **fechamento** (a folha de ponto que vira pagamento).',
        },
        {
          tipo: 'cartoes',
          itens: [
            {
              titulo: '1. Você planeja',
              texto:
                'Na grade de escala, lança quem trabalha em cada dia e em que turno. O sistema avisa na hora se aquilo fere alguma regra — férias, descanso, carga horária.',
            },
            {
              titulo: '2. O servidor registra',
              texto:
                'Ele bate o ponto no relógio biométrico ou no terminal da unidade. Esse registro entra sozinho no sistema, no dia e no passo certos.',
            },
            {
              titulo: '3. Você compara',
              texto:
                'A folha mostra lado a lado o que foi **previsto** e o que foi **realizado**, com atraso, hora extra e falta calculados.',
            },
            {
              titulo: '4. O mês fecha',
              texto:
                'Você revisa, decide o que fazer com as pendências e fecha. O documento fechado é o que o RH usa.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'legal',
          titulo: 'Por que o sistema é "chato" em algumas coisas',
          texto:
            'Folha de ponto é documento legal. A Portaria 671/2021 proíbe o sistema de **inventar horário** e de **recusar uma batida por causa do horário**. É por isso que o sistema nunca preenche sozinho a entrada e a saída de alguém, e por isso o relógio aceita a batida mesmo fora do previsto — ela entra para revisão, não é descartada.',
        },
      ],
    },

    {
      id: 'tres-lugares',
      titulo: 'Os três lugares do sistema',
      resumo: 'Retaguarda, terminal de ponto e portal do servidor — quem usa cada um.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Nem todo mundo usa a mesma tela. O SisEscala tem três frentes, com públicos diferentes:',
        },
        {
          tipo: 'tabela',
          colunas: ['Onde', 'Quem usa', 'Para quê'],
          linhas: [
            [
              'Retaguarda',
              'Coordenador, RH, Diretor, Administrador',
              'É esta área, com o menu à esquerda. Monta escala, trata exceção, fecha folha, cadastra.',
            ],
            [
              'Terminal / relógio',
              'Todo servidor',
              'Bater o ponto. Pode ser o relógio biométrico da unidade ou o terminal na tela do computador.',
            ],
            [
              'Portal do Servidor',
              'Todo servidor',
              'Consultar a própria escala e a folha, pedir ajuste de horário, pedir férias, trocar o PIN. Entra com matrícula e PIN, sem senha de sistema.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          texto:
            'O servidor **não precisa de conta de usuário** para consultar a escala dele. O Portal usa matrícula e PIN, e todo servidor cadastrado já tem os dois.',
        },
      ],
    },

    {
      id: 'menu',
      titulo: 'Achando as coisas no menu',
      resumo: 'O que tem em cada grupo do menu da esquerda.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'O menu é agrupado por **momento de uso**, não por assunto. O que você usa todo dia está em cima; o que se mexe uma vez por ano está embaixo.',
        },
        {
          tipo: 'tabela',
          colunas: ['Grupo', 'O que tem', 'Com que frequência se usa'],
          linhas: [
            [
              'Dashboard',
              'Painel com os números do mês e quem está de serviço hoje.',
              'Todo dia, para dar uma olhada.',
            ],
            [
              'OPERAÇÃO',
              'Escalas, Autorizações, Afastamentos, Férias e Licenças, Folha de Ponto, Justificativas, Marcações.',
              'É o dia a dia. A maior parte do trabalho acontece aqui.',
            ],
            [
              'CADASTROS',
              'Unidades, Setores, Servidores, Pendências, Cargos, Feriados, Jornadas, Dicionário de Turnos, Tipos de Afastamento.',
              'Quando entra gente nova ou muda alguma regra fixa.',
            ],
            [
              'AUDITORIA & GESTÃO',
              'Auditoria Digital e Relatórios.',
              'No fechamento do mês e quando alguém pergunta "por que isso aconteceu?".',
            ],
            [
              'SISTEMA',
              'Configurações, Usuários, Backup, Segurança.',
              'Raramente, e só quem administra o sistema.',
            ],
            ['SUPORTE', 'Este manual.', 'Sempre que a dúvida aparecer.'],
            ['MEU PERFIL', 'Seus dados e sua senha.', 'Quando precisar.'],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Não vê um item do menu?',
          texto:
            'O menu mostra só o que o **seu perfil** alcança. Se um item que este manual descreve não aparece para você, é porque o seu perfil não tem acesso àquela ferramenta — não é erro.',
        },
      ],
    },

    {
      id: 'perfis',
      titulo: 'Perfis: o que cada um pode fazer',
      resumo: 'Do Servidor ao Administrador Geral, quem alcança o quê.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Seu perfil aparece embaixo do seu nome, no canto inferior do menu. Ele decide duas coisas: **quais telas** você abre e **quais unidades e setores** você enxerga dentro delas.',
        },
        {
          tipo: 'tabela',
          colunas: ['Perfil', 'Enxerga', 'Faz'],
          linhas: [
            [
              'Coordenador',
              'As unidades e setores vinculados a ele.',
              'Monta a escala, valida presença, trata afastamento e justificativa, gera e fecha folha do setor dele.',
            ],
            [
              'Ass. Administrativo',
              'As unidades e setores vinculados.',
              'Apoia a operação: lança escala, cuida de afastamento e justificativa.',
            ],
            [
              'Diretor',
              'A unidade dele.',
              'Tudo da operação da unidade, mais autorizar carga horária acima do teto na unidade dele.',
            ],
            [
              'RH da Unidade',
              'As unidades vinculadas, com todos os setores delas.',
              'Operação completa naquelas unidades, reabertura de folha, avaliação de transferência e criação de usuários dentro do escopo.',
            ],
            [
              'RH Geral',
              'A rede inteira.',
              'Tudo do RH da Unidade, sem limite de unidade. Transfere servidor direto, autoriza carga em qualquer lugar.',
            ],
            [
              'Administrador Geral',
              'A rede inteira.',
              'Tudo, incluindo Configurações, Backup, Segurança, exclusão de usuário e mesclagem de cadastros duplicados.',
            ],
            [
              'Servidor',
              'Só a si mesmo, pelo Portal.',
              'Consulta escala e folha, pede ajuste, pede férias, troca o PIN.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Escopo não é o mesmo que perfil',
          texto:
            'Dois coordenadores têm o mesmo perfil e podem enxergar coisas completamente diferentes — depende das unidades e setores vinculados à conta de cada um. Quando alguém diz "não estou vendo o servidor X", a causa quase sempre é escopo, não permissão.',
        },
      ],
    },

    {
      id: 'vocabulario',
      titulo: 'O vocabulário do sistema',
      resumo: 'Turno, jornada, categoria, competência — o que cada palavra quer dizer aqui.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Cinco palavras aparecem o tempo todo e são fáceis de confundir. Entender estas cinco resolve a maior parte das dúvidas:',
        },
        {
          tipo: 'tabela',
          colunas: ['Palavra', 'O que é', 'Exemplo'],
          linhas: [
            [
              'Jornada',
              'O **contrato de horário** do servidor: quantas horas ele deve por dia e em que faixa.',
              '`08H ÀS 18H` — 8 horas de trabalho com 2 de intervalo.',
            ],
            [
              'Turno',
              'O **código** que você digita na grade para dizer o que a pessoa faz naquele dia.',
              '`M` (manhã), `T` (tarde), `N` (noite), `MT` (manhã e tarde, 12h).',
            ],
            [
              'Categoria',
              'A **linha** da grade em que o turno é lançado. Cada servidor tem quatro.',
              'Regular, Plantão, Extra, Sobreaviso.',
            ],
            [
              'Competência',
              'O **mês de referência**. É o que se abre, fecha e reabre.',
              'Competência 09/2026.',
            ],
            [
              'Escala',
              'O conjunto do mês de um servidor **num setor**. A mesma pessoa pode ter duas, em setores diferentes.',
              'A escala de setembro da Maria no Bloco B.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'A diferença que mais confunde',
          texto:
            '**Jornada** é do servidor e vale o mês todo. **Turno** é do dia. Um servidor com jornada `08H ÀS 18H` pode ter um Plantão `N` lançado num sábado — a jornada não muda, o turno daquele dia é que é outro.',
        },
      ],
    },

    {
      id: 'quatro-linhas',
      titulo: 'As quatro linhas de cada servidor',
      resumo: 'Regular, Plantão, Extra e Sobreaviso — o que vai em cada uma.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Na grade, cada servidor ocupa **quatro linhas**. Elas existem porque o mesmo dia pode ter mais de uma natureza de trabalho, e cada uma é paga de um jeito.',
        },
        {
          tipo: 'tabela',
          colunas: ['Linha', 'O que vai nela', 'Entra na folha?'],
          linhas: [
            [
              'Regular',
              'O expediente normal, o que o contrato já prevê.',
              'Sim. É a base da carga horária do mês.',
            ],
            [
              'Plantão',
              'Plantão além do expediente, pago por unidade de plantão (PL12, PL6, PL4).',
              'Sim, e sai também no relatório de plantões.',
            ],
            [
              'Extra',
              'Hora extra avulsa, autorizada caso a caso.',
              'Sim, com o percentual conforme o código lançado.',
            ],
            [
              'Sobreaviso',
              'Ficar disponível para ser chamado. **Não é presença.**',
              'Não. Tem ciclo e relatório próprios.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Sobreaviso não marca ponto',
          texto:
            'Quem está de sobreaviso não bate ponto por causa disso e não aparece na folha por causa disso. O sobreaviso tem um fluxo próprio: acionamento, aceite e chegada. Se você lançou sobreaviso esperando que virasse hora na folha, lance na linha certa.',
        },
      ],
    },
  ],
}
