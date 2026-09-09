import type { Capitulo } from '../tipos'

export const pessoas: Capitulo = {
  id: 'pessoas',
  titulo: 'Pessoas e ausências',
  icone: 'Users',
  descricao: 'Cadastro de servidor, afastamentos, férias, licenças e transferências.',
  secoes: [
    {
      id: 'servidores',
      titulo: 'Cadastro de Servidores',
      resumo: 'O que preencher e por que cada campo importa mais adiante.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['CADASTROS', 'Servidores'], href: '/servidores' },
        {
          tipo: 'p',
          texto:
            'A ficha do servidor alimenta tudo o que vem depois: escala, ponto, folha e relatório. Cinco campos merecem atenção especial, porque a falta de qualquer um deles causa um problema silencioso semanas depois.',
        },
        {
          tipo: 'tabela',
          colunas: ['Campo', 'Por que importa', 'O que acontece se faltar'],
          linhas: [
            [
              'CPF',
              'É o que identifica a pessoa no relógio de ponto e o que impede cadastro duplicado.',
              'Não dá para enviar ao relógio, e a pessoa pode ser recadastrada em duplicidade.',
            ],
            [
              'PIS/PASEP',
              'Alguns relógios identificam por PIS em vez de CPF.',
              'Nesses relógios, a batida chega e não se sabe de quem é.',
            ],
            [
              'Matrícula',
              'É o login do servidor no terminal e no Portal.',
              'A pessoa não consegue bater ponto nem consultar a escala.',
            ],
            [
              'Jornada',
              'Diz quantas horas por dia a pessoa deve.',
              'A folha não sabe calcular atraso, extra nem carga do mês.',
            ],
            [
              'Unidade e Setor',
              'Definem onde ela aparece e o que o coordenador enxerga.',
              'Ela some das telas de quem deveria gerenciá-la.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Uma linha = um vínculo',
          texto:
            'A mesma pessoa com dois cargos tem **duas fichas**, com o mesmo CPF. Isso é legítimo e existe. Por causa disso, o sistema pede confirmação em vez de bloquear o CPF repetido — e é aí que mora o risco de cadastro duplicado por engano.',
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Duplo vínculo e o relógio de ponto',
          texto:
            'O relógio identifica a **pessoa**, não a matrícula — é assim por lei, e por isso ele não aceita a mesma pessoa cadastrada duas vezes. **Ela bate o ponto uma vez só, com a digital de sempre.** Quem separa as batidas entre as duas matrículas é o sistema, pelo horário previsto em cada escala: a batida das 07h vai para a matrícula do turno da manhã, a das 19h para a do turno da noite. Não é preciso fazer nada de diferente no equipamento.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'As duas matrículas não podem ter turnos no mesmo horário',
          texto:
            'A pessoa continua sendo uma só: ela não pode estar em dois lugares ao mesmo tempo. Se você tentar escalar as duas matrículas em horários que se cruzam, a grade recusa e **diz qual é a outra matrícula** — procurar o lançamento na sua própria escala não vai adiantar, ele está na escala da outra. Turnos que se completam (manhã numa matrícula, noite na outra) continuam liberados: é justamente o arranjo mais comum de quem tem dois vínculos.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'PIN de acesso',
          texto:
            'O PIN é a senha do servidor no terminal e no Portal. Você pode gerar um novo na ficha. PIN novo tem 6 dígitos; os antigos de 4 continuam valendo.',
        },
      ],
    },

    {
      id: 'pendencias-cadastro',
      titulo: 'Pendências de Cadastro',
      resumo: 'A tela que mostra o que está errado ou faltando nos cadastros.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['CADASTROS', 'Pendências de Cadastro'], href: '/servidores/pendencias' },
        {
          tipo: 'p',
          texto:
            'É a tela de diagnóstico do cadastro. Nada aqui bloqueia o sistema — são coisas que, se não forem tratadas, viram problema de ponto ou de folha mais tarde.',
        },
        {
          tipo: 'tabela',
          colunas: ['Seção', 'O que mostra', 'Ação'],
          linhas: [
            [
              'Importados aguardando cadastro',
              'Vínculos vindos do relatório do RH cujo CPF ainda não existe no sistema.',
              'Completar unidade, setor e cargo para virar cadastro.',
            ],
            [
              'Transferências pendentes',
              'Pedidos de mudança de lotação esperando avaliação.',
              'Aprovar (definindo o destino) ou rejeitar com motivo.',
            ],
            [
              'Documentos com dígito inválido',
              'CPF ou PIS que não passam na validação.',
              'Corrigir na ficha.',
            ],
            ['Servidores sem CPF', 'Fichas sem CPF preenchido.', 'Preencher.'],
            [
              'Cadastros duplicados',
              'O mesmo CPF em mais de uma ficha, com a opção de **mesclar**.',
              'Só o Administrador Geral.',
            ],
            [
              'Possíveis duplicidades',
              'Grupos suspeitos por CPF, nome, telefone ou e-mail.',
              'Conferir. Onde o CPF é o mesmo, o grupo traz o atalho para mesclar.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Homônimo não é duplicata',
          texto:
            'Agrupamento por nome, telefone ou e-mail é uma **pista**, não uma conclusão — duas pessoas podem dividir o mesmo telefone. Só há mesclagem onde o CPF é o mesmo nos dois lados, e é assim de propósito: mesclar pessoas diferentes faria o ponto de uma virar ponto da outra.',
        },
      ],
    },

    {
      id: 'mesclar',
      titulo: 'Mesclando cadastros duplicados',
      resumo: 'Juntar duas fichas da mesma pessoa sem perder ponto nem escala.',
      papeis: ['Administrador Geral'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Quando a mesma pessoa foi cadastrada duas vezes, o histórico fica dividido entre as duas fichas. Mesclar move **tudo** da ficha errada para a correta: ponto, escala, folha, afastamento, vínculo de relógio.',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Abra o grupo e compare',
              texto:
                'A tela mostra os dois lados com o peso de cada um: quantas escalas, folhas e batidas cada ficha carrega.',
            },
            {
              titulo: 'Marque qual cadastro FICA',
              texto:
                'Há uma sugestão (a matrícula definitiva costuma vencer a temporária), mas nada vem marcado — a escolha é sua.',
            },
            {
              titulo: 'Leia os impedimentos, se houver',
              texto:
                'O sistema confere antes e recusa quando mesclar criaria problema, dizendo exatamente onde.',
            },
            { titulo: 'Confirme' },
          ],
        },
        { tipo: 'titulo', texto: 'O que pode impedir' },
        {
          tipo: 'tabela',
          colunas: ['Impedimento', 'Como resolver'],
          linhas: [
            ['CPF diferente entre as fichas', 'Corrija o CPF errado, ou não mescle — pode não ser a mesma pessoa.'],
            [
              'As duas fichas escaladas no mesmo dia e horário',
              'Apague na grade o lançamento que não aconteceu.',
            ],
            [
              'As duas escaladas no mesmo dia com turnos diferentes',
              'A mensagem diz o setor, o mês, os dias e o turno de cada lado. Decida qual vale e apague o outro.',
            ],
            ['Competência encerrada ou escala fechada', 'Reabra antes.'],
            ['Folha presa à escala que seria fundida', 'Apague a folha em Rascunho da ficha duplicada.'],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'O cadastro errado é inativado, não excluído',
          texto:
            'A matrícula dele pode já ter sido impressa em folha e escala. Se a linha sumisse, aquele número ficaria sem explicação em lugar nenhum. Ela fica Inativa, apontando para a ficha que a absorveu — e some das telas e das checagens de CPF, então não atrapalha.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Escala e setor',
          texto:
            'Se o setor que cadastrou errado também escalou a pessoa, essa escala vem junto e continua no setor onde foi lançada. Quem decide qual é a escala "de verdade" é a grade — a mesclagem não adivinha.',
        },
      ],
    },

    {
      id: 'afastamentos',
      titulo: 'Afastamentos',
      resumo: 'Atestado, declaração de comparecimento e ausências em geral.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Afastamentos'], href: '/afastamentos' },
        {
          tipo: 'p',
          texto:
            'Afastamento é toda ausência prevista ou justificada que **muda a escala**. Lançado, ele impede que a pessoa seja escalada naquele período e aparece na folha.',
        },
        { tipo: 'titulo', texto: 'Integral, por período ou por horas' },
        {
          tipo: 'tabela',
          colunas: ['Tipo', 'Como lançar', 'Efeito'],
          linhas: [
            ['Dia inteiro', 'Sem marcar período nem horário.', 'Bloqueia qualquer turno naquele dia.'],
            [
              'Meio período',
              'Marcando manhã e/ou tarde.',
              'Bloqueia só os turnos que cruzam aquele período. Se o turno do dia é só noite, ele continua valendo.',
            ],
            [
              'Por horas (declaração de comparecimento)',
              'Informando hora de início e fim.',
              '**Não bloqueia nada** — a pessoa trabalha o resto do dia. O tempo entra como abono na folha.',
            ],
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Meio período preserva o turno',
          texto:
            'Uma declaração de comparecimento pela manhã, num dia de turno `MT`, não apaga o dia inteiro: a escala continua e a tarde é trabalhada. E o dia não é contado como atraso — o sistema sabe que parte dele estava abonada.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'Dois afastamentos no mesmo dia é normal',
          texto:
            'Uma declaração de manhã e outra à tarde são dois fatos, com documentos próprios. Lance os dois — a folha descreve os dois separadamente.',
        },
      ],
    },

    {
      id: 'ferias',
      titulo: 'Férias e Licenças',
      resumo: 'Programação de férias, licenças longas e o pedido pelo Portal.',
      papeis: ['RH da Unidade', 'RH Geral', 'Administrador Geral', 'Coordenador', 'Diretor'],
      blocos: [
        { tipo: 'caminho', itens: ['OPERAÇÃO', 'Férias e Licenças'], href: '/ferias-licencas' },
        {
          tipo: 'p',
          texto:
            'Aqui ficam as ausências longas e programadas. Diferente do afastamento pontual, elas costumam ser combinadas com antecedência e atravessam meses.',
        },
        {
          tipo: 'lista',
          itens: [
            'Lançadas aqui, elas **bloqueiam a grade** no período — nem digitando, nem por template, nem pelo Gerador.',
            'O servidor pode **solicitar** férias pelo Portal; o pedido aparece para quem avalia.',
            'Um período lançado com antecedência evita o retrabalho de desfazer escala depois.',
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          texto:
            'Se a escala do período já foi lançada antes das férias entrarem, a grade vai avisar do conflito. Ajuste a escala primeiro; o sistema não apaga o trabalho de ninguém sem avisar.',
        },
      ],
    },

    {
      id: 'transferencia',
      titulo: 'Transferência de lotação',
      resumo: 'Mudar o servidor de unidade ou setor, e o que fazer com a escala dele.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Administrador Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Transferir é mudar a lotação da ficha. Quem tem perfil de RH Geral ou Administrador transfere direto; os demais **solicitam**, e o pedido vai para avaliação em Pendências de Cadastro.',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Quem solicita informa origem, destino e motivo',
              texto: 'O destino pode ficar em aberto, para o RH definir.',
            },
            {
              titulo: 'Quem avalia escolhe a unidade e depois o setor',
              texto:
                'A lista de setores só aparece depois de escolhida a unidade — e traz apenas os setores daquela unidade.',
            },
            {
              titulo: 'Ao aprovar, o sistema pergunta o que fazer com a escala',
              texto:
                'Mover o mês inteiro para o setor novo, dividir na data da transferência, ou não mexer.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Escolha conscientemente o que acontece com a escala',
          texto:
            'O padrão é **não mexer**, para nada ser alterado por omissão. Mas deixar a escala futura no setor antigo costuma ser o que ninguém quer — decida na hora, e não depois.',
        },
      ],
    },
  ],
}
