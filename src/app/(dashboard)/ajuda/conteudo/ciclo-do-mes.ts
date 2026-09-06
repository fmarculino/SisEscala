import type { Capitulo } from '../tipos'

export const cicloDoMes: Capitulo = {
  id: 'ciclo-do-mes',
  titulo: 'O ciclo do mês',
  icone: 'CalendarRange',
  descricao: 'Do lançamento da escala ao fechamento da folha, na ordem em que acontece.',
  secoes: [
    {
      id: 'visao-do-ciclo',
      titulo: 'O mês inteiro em quatro etapas',
      resumo: 'Se você é novo no sistema, comece por aqui: é o caminho completo.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'O trabalho no SisEscala tem um ritmo mensal. Estas quatro etapas se repetem todo mês, e quase toda dúvida do dia a dia cabe em uma delas.',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Antes do mês começar — monte a escala',
              texto:
                'Abra a grade do setor, lance os turnos e salve. Use o Gerador Inteligente ou um Modelo para não digitar tudo à mão. O sistema avisa na hora sobre conflito, férias e excesso de carga.',
            },
            {
              titulo: 'Durante o mês — acompanhe o ponto',
              texto:
                'As batidas chegam sozinhas do relógio e do terminal. Você acompanha na própria grade (a aba "Validado") e trata o que ficou pendente: quem esqueceu de bater, quem bateu fora do horário.',
            },
            {
              titulo: 'Durante o mês — registre as exceções',
              texto:
                'Atestado, férias, licença, falta justificada. Quanto mais cedo lançar, menos retrabalho no fechamento — o afastamento lançado antes já impede o lançamento errado na grade.',
            },
            {
              titulo: 'Depois do mês — feche a folha',
              texto:
                'Gere ou sincronize a folha, revise dia a dia, decida o que fazer com atrasos e pendências, e feche. A partir daí o documento está pronto para o RH.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          titulo: 'A regra de ouro',
          texto:
            'Lance o afastamento **antes** de mexer na escala do dia. Quase todo retrabalho no fechamento vem de escala lançada num dia em que a pessoa já estava de férias ou atestado.',
        },
      ],
    },

    {
      id: 'primeiro-mes',
      titulo: 'Seu primeiro mês no sistema',
      resumo: 'A ordem recomendada quando o setor está começando agora.',
      papeis: ['Coordenador', 'Ass. Administrativo'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Se o seu setor está entrando no SisEscala agora, faça nesta ordem. Cada passo depende do anterior.',
        },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Confira o cadastro dos servidores',
              texto:
                'Abra Cadastros → Servidores e verifique se todo mundo do setor está lá, com **CPF**, **matrícula**, **jornada** e **lotação** corretos. Sem jornada, o sistema não sabe quantas horas a pessoa deve.',
            },
            {
              titulo: 'Confira as pendências de cadastro',
              texto:
                'Cadastros → Pendências de Cadastro lista quem está sem CPF, com documento inválido ou duplicado. Resolver isso agora evita ponto que não aparece depois.',
            },
            {
              titulo: 'Lance férias e afastamentos já conhecidos',
              texto: 'Assim a grade já nasce sabendo quem não pode ser escalado.',
            },
            {
              titulo: 'Monte a escala do mês',
              texto:
                'Comece pelo Regular, depois plantões. Salve com frequência — a grade só grava quando você clica em "Salvar Previsão".',
            },
            {
              titulo: 'Confira a Cobertura de Ponto',
              texto:
                'Em Marcações → Cobertura de Ponto você vê quem **consegue** bater ponto de fato. Estar escalado não basta: a pessoa precisa estar cadastrada no relógio, com biometria.',
            },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'O erro mais comum na implantação',
          texto:
            'A pessoa está cadastrada no sistema, está escalada, encosta o dedo no relógio, o relógio aceita — e o ponto não aparece em lugar nenhum. Isso acontece quando falta o vínculo entre o cadastro dela e o relógio. Nenhuma das duas pontas reclama. A aba **Cobertura de Ponto** existe exatamente para mostrar isso antes que vire problema de folha.',
        },
        { tipo: 'veja', secaoId: 'cobertura-ponto', texto: 'Ver Cobertura de Ponto' },
      ],
    },

    {
      id: 'fechamento',
      titulo: 'Fechando o mês',
      resumo: 'O passo a passo do fechamento e o que conferir antes de fechar.',
      papeis: ['Coordenador', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        {
          tipo: 'p',
          texto:
            'Fechar é o ato de dizer "este mês está conferido". Depois de fechada, a folha só volta a ser editável se alguém com perfil de RH ou Administrador a reabrir — e isso fica registrado.',
        },
        { tipo: 'titulo', texto: 'Antes de fechar, confira' },
        {
          tipo: 'lista',
          itens: [
            '**Dias sem batida**: alguém esqueceu de bater e ninguém validou? Esses dias aparecem em branco na folha.',
            '**Pendências de revisão**: batidas fora do horário previsto ficam esperando alguém aceitar ou recusar.',
            '**Atrasos com decisão pendente**: dias em que a pessoa chegou tarde e saiu depois. O sistema não decide sozinho se aquilo é compensação ou hora extra — você decide.',
            '**Afastamentos do mês**: todo atestado e licença já lançado?',
            '**Total de horas**: bate com o esperado? Um número muito acima costuma indicar escala lançada em duplicidade.',
          ],
        },
        { tipo: 'titulo', texto: 'O fechamento' },
        {
          tipo: 'passos',
          itens: [
            {
              titulo: 'Gere ou sincronize a folha',
              texto:
                'Isso puxa da escala tudo que aconteceu no mês. Você pode sincronizar quantas vezes quiser — o que você editou à mão é preservado.',
            },
            {
              titulo: 'Revise dia a dia',
              texto: 'A folha mostra previsto e realizado lado a lado, com atraso e extra calculados.',
            },
            {
              titulo: 'Resolva as decisões de compensação',
              texto:
                'Onde houver atraso e hora extra no mesmo dia, marque se aquilo compensa o atraso ou se é hora extra de verdade.',
            },
            { titulo: 'Feche', texto: 'A folha muda de status e sai da lista de pendentes.' },
          ],
        },
        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'A folha é uma fotografia, não um espelho',
          texto:
            'Depois de gerada, a folha **não acompanha sozinha** o que muda na escala. Corrigiu uma batida ou um turno depois de gerar? Volte na folha e clique em **Sincronizar** — senão o documento continua com o valor antigo.',
        },
      ],
    },
  ],
}
