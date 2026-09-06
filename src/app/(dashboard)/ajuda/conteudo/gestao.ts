import type { Capitulo } from '../tipos'

export const gestao: Capitulo = {
  id: 'gestao',
  titulo: 'Relatórios e gestão',
  icone: 'BarChart3',
  descricao: 'Painel, relatórios, auditoria e os cadastros que definem as regras do sistema.',
  secoes: [
    {
      id: 'painel',
      titulo: 'O Painel (Dashboard)',
      resumo: 'Os números da tela inicial e o que cada um responde.',
      papeis: ['Todos'],
      blocos: [
        { tipo: 'caminho', itens: ['Dashboard'], href: '/home' },
        {
          tipo: 'p',
          texto:
            'O painel dá a visão do mês em poucos números. Ele mostra escala **prevista** — o que foi planejado —, não hora efetivamente trabalhada. Hora trabalhada é a folha.',
        },
        {
          tipo: 'tabela',
          colunas: ['Indicador', 'Responde'],
          linhas: [
            ['Escalas ativas', 'Quantas grades de setor existem no mês e quantas já foram fechadas.'],
            ['Em serviço hoje', 'Quantas **pessoas** estão escaladas hoje — cada uma contada uma vez.'],
            ['Servidores', 'O tamanho do quadro, por situação.'],
            ['Comparativo de horas', 'Quanto foi previsto em cada categoria, mês a mês.'],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Variação grande entre meses costuma ser implantação',
          texto:
            'Quando uma unidade entra no sistema, o número dela salta de um mês para o outro. Isso é o sistema alcançando o que já acontecia, não trabalho novo. Antes de concluir que houve aumento, veja se alguma unidade entrou naquele mês.',
        },
      ],
    },

    {
      id: 'relatorios',
      titulo: 'Relatórios',
      resumo: 'Os seis relatórios e qual deles responde a sua pergunta.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['AUDITORIA & GESTÃO', 'Relatórios'], href: '/relatorios' },
        {
          tipo: 'tabela',
          colunas: ['Relatório', 'Responde', 'Formato'],
          linhas: [
            [
              'Consolidado de Horas',
              'Quanto cada setor somou de carga, hora extra e sobreaviso.',
              'Tela e impressão.',
            ],
            [
              'Frequência Mensal',
              'O espelho de ponto individual, dia a dia.',
              'Impressão, para assinatura.',
            ],
            [
              'Distribuição de Plantões',
              'Como os plantões se distribuem por unidade e turno — onde falta e onde sobra cobertura.',
              'Tela e impressão.',
            ],
            [
              'Diagnóstico de Plantões & Sobreavisos',
              'O ano inteiro de plantão e sobreaviso, para conferência.',
              'Tela e impressão.',
            ],
            ['Folha de RH', 'O consolidado que o RH usa para processar.', 'Tela e impressão.'],
            [
              'Carga Consolidada do Mês',
              'Quanto cada servidor somou **em todas as escalas**, somando setores.',
              'Tela, com link para a grade de origem.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Quando o total surpreender, comece pela Carga Consolidada',
          texto:
            'Ela é a única que soma as escalas de todos os setores da mesma pessoa e mostra **onde** estão as horas, com link direto para cada grade. É o caminho mais curto para achar escala lançada em duplicidade.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Se aparecer aviso de dados incompletos, não use o número',
          texto:
            'Quando um relatório não consegue carregar tudo, ele **avisa** em vez de mostrar um total menor sem explicação. Recarregue; se persistir, avise quem administra o sistema.',
        },
      ],
    },

    {
      id: 'auditoria',
      titulo: 'Auditoria Digital',
      resumo: 'Quem fez o quê, quando — e o rastro das batidas recusadas.',
      papeis: ['RH Geral', 'Administrador Geral', 'Diretor', 'RH da Unidade'],
      blocos: [
        { tipo: 'caminho', itens: ['AUDITORIA & GESTÃO', 'Auditoria Digital'], href: '/auditoria' },
        {
          tipo: 'p',
          texto:
            'A auditoria responde "por que isso está assim?". Ela guarda as ações relevantes do sistema e as tentativas de ponto que foram recusadas.',
        },
        {
          tipo: 'lista',
          itens: [
            'Validações manuais de presença, com quem validou e a justificativa.',
            'Alterações de turno em dias com ponto, com o motivo escrito na hora.',
            'Fechamentos e reaberturas de folha e competência.',
            'Tentativas de ponto recusadas, com a hora exata e o motivo.',
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Tentativa recusada nem sempre prova presença',
          texto:
            'A maior parte das recusas é matrícula ou PIN errados — e aí não há confirmação de quem era. Só as tentativas em que a pessoa **foi identificada** servem como horário. O sistema já faz essa separação; não converta uma recusa de PIN em horário de folha.',
        },
      ],
    },

    {
      id: 'cadastros-base',
      titulo: 'Os cadastros que definem as regras',
      resumo: 'Unidades, setores, jornadas, turnos, cargos, feriados e tipos de afastamento.',
      papeis: ['RH Geral', 'Administrador Geral', 'RH da Unidade', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'São cadastros que se mexem pouco, mas que **mudam o comportamento do sistema inteiro**. Alterar um deles no meio do mês afeta escalas e folhas já lançadas.',
        },
        {
          tipo: 'tabela',
          colunas: ['Cadastro', 'Define', 'Cuidado'],
          linhas: [
            [
              'Unidades',
              'Os locais, e as regras de ponto de cada um (se marca intervalo, se é rígido ou flexível).',
              'Mudar o modo de intervalo muda quantas batidas o sistema espera por dia.',
            ],
            [
              'Setores',
              'A árvore de setores dentro de cada unidade.',
              'Setor com vínculos não é excluído: ele é **fundido** com outro, movendo tudo junto.',
            ],
            [
              'Jornadas',
              'Os contratos de horário: faixa e intervalo.',
              'A jornada é usada por nome. Renomear afeta o cálculo de quem a usa.',
            ],
            [
              'Dicionário de Turnos',
              'Os códigos que você digita na grade, com duração e horário.',
              'É a lista oficial. Consulte aqui quando não souber um código.',
            ],
            ['Cargos', 'Os cargos disponíveis na ficha do servidor.', '—'],
            [
              'Feriados',
              'Os dias que o sistema trata como feriado.',
              'Afeta cálculo e relatório do mês.',
            ],
            [
              'Tipos de Afastamento',
              'Os tipos disponíveis ao lançar um afastamento, e como cada um se comporta.',
              'Define se aquele tipo abona, bloqueia ou apenas registra.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Trocar a jornada no meio do mês reescreve o mês inteiro',
          texto:
            'A jornada vale para **todos os dias** da competência, e não só dali para frente. Trocá-la no dia 12 muda também como os dias 1 a 11 são julgados — a batida não se perde, mas atraso e hora extra são recalculados contra um horário que não valia naqueles dias. Para mudança com data certa, use jornada temporária.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Desativar em vez de excluir',
          texto:
            'Unidade e setor desativados somem das telas de **escolha** (não dá para lotar ninguém neles), mas continuam nos **filtros** de relatório, rotulados como inativos — senão o histórico deles sumiria junto.',
        },
      ],
    },

    {
      id: 'sistema',
      titulo: 'Configurações, Usuários, Backup e Segurança',
      resumo: 'O que se administra no grupo SISTEMA.',
      papeis: ['Administrador Geral', 'RH Geral'],
      blocos: [
        { tipo: 'titulo', texto: 'Configurações' },
        {
          tipo: 'p',
          texto:
            'As regras globais do sistema: fuso horário, teto de horas mensal, regras de ponto e de fechamento, abertura e encerramento de competência.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          texto:
            'É daqui que se **reabre uma competência encerrada**. É o caminho certo quando algo precisa ser corrigido num mês já fechado — e fica registrado.',
        },
        { tipo: 'titulo', texto: 'Usuários' },
        {
          tipo: 'p',
          texto:
            'Contas de acesso à retaguarda. Cada conta tem um perfil e um escopo — as unidades e setores que ela enxerga.',
        },
        {
          tipo: 'lista',
          itens: [
            'RH Geral e RH da Unidade também administram usuários, cada um dentro do escopo que alcança.',
            'O RH da Unidade só administra contas cujo escopo cabe inteiro nas unidades dele, e só concede perfis abaixo do dele.',
            '**Excluir** usuário é só do Administrador Geral. Os demais **inativam**, que é reversível e fica registrado.',
            'Vincular a conta ao cadastro de servidor é o que faz o e-mail da ficha e o login andarem juntos.',
          ],
        },
        { tipo: 'titulo', texto: 'Backup e Segurança' },
        {
          tipo: 'p',
          texto:
            'Rotinas de cópia dos dados e o painel de segurança do sistema. Exclusivos do Administrador Geral.',
        },
      ],
    },
  ],
}
