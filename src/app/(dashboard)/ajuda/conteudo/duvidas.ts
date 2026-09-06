import type { Capitulo } from '../tipos'

export const duvidas: Capitulo = {
  id: 'duvidas',
  titulo: 'Dúvidas frequentes',
  icone: 'HelpCircle',
  descricao: 'As perguntas que mais chegam ao suporte, com a resposta e o caminho.',
  secoes: [
    {
      id: 'faq-escala',
      titulo: 'Sobre a escala',
      resumo: 'Não consigo lançar, não consigo apagar, o número não bate.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        { tipo: 'titulo', texto: 'Não consigo digitar nesta célula' },
        {
          tipo: 'lista',
          itens: [
            'O dia tem **afastamento** lançado — confira em Afastamentos ou Férias e Licenças.',
            'A competência está **encerrada** — precisa ser reaberta em Configurações.',
            'O dia já tem **ponto registrado** e você está tentando apagar. Para trocar o turno, o sistema pede justificativa em vez de bloquear.',
          ],
        },

        { tipo: 'titulo', texto: '"Salvar Previsão" recusou o mês inteiro' },
        {
          tipo: 'p',
          texto:
            'O salvamento é em bloco: **uma** linha inválida derruba o lote todo. A mensagem diz qual é o problema. As causas mais comuns são afastamento no dia, a mesma pessoa escalada em outro setor no mesmo horário e o teto de horas.',
        },
        {
          tipo: 'aviso',
          tom: 'dica',
          texto:
            'Se a mensagem falar em escala desatualizada, alguém mexeu naquele setor enquanto você estava com a tela aberta. Recarregue antes de salvar de novo.',
        },

        { tipo: 'titulo', texto: 'O total de horas está muito maior que o esperado' },
        {
          tipo: 'lista',
          itens: [
            'Veja o relatório **Carga Consolidada do Mês**: ele soma todas as escalas da pessoa e mostra em quais setores estão as horas, com link para cada grade.',
            'A causa mais comum é a mesma escala lançada duas vezes, em setores diferentes ou sob duas matrículas da mesma pessoa.',
          ],
        },

        { tipo: 'titulo', texto: 'O Gerador Inteligente disse que preencheu, mas eu não vi nada' },
        {
          tipo: 'p',
          texto:
            'Ele relata quantas células **mudaram**. "0 alteradas" quer dizer que o que ele sugeriu já estava lançado igual, ou caiu em dias com ponto e afastamento — que ele nunca sobrescreve.',
        },
      ],
    },

    {
      id: 'faq-ponto',
      titulo: 'Sobre o ponto',
      resumo: 'Batida que não aparece, horário estranho, pendência que não some.',
      papeis: ['Coordenador', 'Ass. Administrativo', 'RH da Unidade', 'RH Geral', 'Diretor'],
      blocos: [
        { tipo: 'titulo', texto: 'A pessoa bateu e o ponto não aparece' },
        { tipo: 'veja', secaoId: 'nao-apareceu', texto: 'Ver o roteiro completo' },

        { tipo: 'titulo', texto: 'O horário aparece diferente do que ela bateu' },
        {
          tipo: 'p',
          texto:
            'Se a diferença é de **3 horas exatas**, é o fuso — avise quem administra o sistema. Se o horário caiu no passo errado (a entrada aparecendo como saída, por exemplo), costuma ser turno que atravessa a meia-noite: a batida da madrugada pertence ao dia anterior.',
        },

        { tipo: 'titulo', texto: 'Aparece hora extra num dia em que a pessoa chegou atrasada' },
        {
          tipo: 'p',
          texto:
            'É o comportamento correto: o sistema mede as duas pontas e mostra as duas. Cabe a você decidir se aquilo é **compensação** do atraso ou hora extra de verdade — a folha não muda enquanto a decisão não for tomada.',
        },
        { tipo: 'veja', secaoId: 'atraso-compensacao', texto: 'Entender atraso e compensação' },

        { tipo: 'titulo', texto: 'A folha continua errada mesmo depois de eu corrigir' },
        {
          tipo: 'p',
          texto:
            'A folha é uma fotografia do momento em que foi gerada. Clique em **Sincronizar** para ela receber a correção.',
        },

        { tipo: 'titulo', texto: 'O servidor não consegue bater no relógio' },
        {
          tipo: 'lista',
          itens: [
            'Confira em **Cobertura de Ponto** se ele está cadastrado **naquele** relógio e com biometria.',
            'Estar cadastrado num relógio não vale para os outros da mesma unidade.',
            'Se a digital não pega, ela pode ser recadastrada presencialmente no equipamento.',
          ],
        },
      ],
    },

    {
      id: 'faq-acesso',
      titulo: 'Sobre acesso e telas',
      resumo: 'Não vejo o menu, não vejo o servidor, o botão está desabilitado.',
      papeis: ['Todos'],
      blocos: [
        { tipo: 'titulo', texto: 'Não vejo um item do menu' },
        {
          tipo: 'p',
          texto:
            'O menu mostra só o que o seu perfil alcança. Se você precisa daquela ferramenta, o caminho é pedir a mudança de perfil a quem administra usuários — não é falha da tela.',
        },

        { tipo: 'titulo', texto: 'Não encontro um servidor que eu sei que existe' },
        {
          tipo: 'p',
          texto:
            'Quase sempre é **escopo**: ele está lotado numa unidade ou setor que a sua conta não alcança. Se ele precisa ser escalado no seu setor sem mudar de lotação, use **Servidor Externo** na grade.',
        },

        { tipo: 'titulo', texto: 'O botão está desabilitado' },
        {
          tipo: 'p',
          texto:
            'Todo botão desabilitado no sistema traz o motivo escrito ao lado ou no rótulo. Se você encontrar um botão cinza **sem explicação nenhuma**, isso é um defeito — reporte.',
        },

        { tipo: 'titulo', texto: 'A tela do terminal parece desatualizada' },
        {
          tipo: 'p',
          texto:
            'O terminal fica aberto por dias e se atualiza sozinho quando está ocioso. Se houver dúvida, recarregue a página do terminal — nunca no meio de um registro.',
        },
      ],
    },

    {
      id: 'glossario',
      titulo: 'Glossário',
      resumo: 'As palavras do sistema, em ordem alfabética.',
      papeis: ['Todos'],
      blocos: [
        {
          tipo: 'tabela',
          colunas: ['Termo', 'Significa'],
          linhas: [
            ['Abono', 'Tempo relevado — a declaração de comparecimento, por exemplo. Não é falta nem trabalho.'],
            ['Categoria', 'A linha da grade: Regular, Plantão, Extra ou Sobreaviso.'],
            ['Competência', 'O mês de referência. É o que se abre, fecha e reabre.'],
            ['Cobertura de ponto', 'Se a pessoa consegue de fato registrar ponto: cadastrada no relógio, com biometria e vinculada.'],
            ['Escala mensal', 'O mês de um servidor num setor. A mesma pessoa pode ter mais de uma.'],
            ['Espelho de ponto', 'O relatório individual, dia a dia, do que foi registrado.'],
            ['Jornada', 'O contrato de horário do servidor: quantas horas por dia e em que faixa.'],
            ['Marcação', 'Um registro de ponto: uma batida.'],
            ['Pré-assinalação', 'O intervalo preenchido pelo sistema, permitido **apenas** onde o servidor não tem como registrá-lo.'],
            ['REP', 'O relógio de ponto biométrico da unidade.'],
            ['Sobreaviso', 'Ficar disponível para ser chamado. Não é presença e não entra na folha.'],
            ['Terminal', 'A tela de ponto do computador da unidade, onde se digita matrícula e PIN.'],
            ['Turno', 'O código lançado na grade (`M`, `T`, `N`, `MT`…) que diz o que a pessoa faz naquele dia.'],
            ['Validar presença', 'Confirmar que a pessoa trabalhou num dia em que o ponto não registrou.'],
          ],
        },
      ],
    },
  ],
}
