# Portal do servidor: de editor da folha a solicitante de ajuste — v1.23.0

**Data:** 08/08/2026

## O que a v1.22.0 abriu sem querer

O portal do servidor sempre permitiu editar qualquer célula da folha de ponto cuja origem não
fosse `real`. A edição escrevia direto em `folha_ponto.registros`, com origem `manual` — sem
passar por `escala_diaria`, sem criar marcação, sem revisão de ninguém.

Enquanto entrada e saída **sempre** recebiam um horário fictício gerado pelo sistema, isso era
um risco limitado: o servidor ajustava uma invenção, ancorada perto do horário previsto.

A v1.22.0 (mesma data) removeu essa geração automática por exigência da Portaria 671/2021 —
dia sem batida passou a ficar **vazio**. Combinado com a edição livre do portal, o resultado foi
pior que o problema original: o servidor passou a poder digitar qualquer horário numa célula
vazia da folha oficial, sem nenhuma conferência. Trocamos "ajustar uma invenção limitada" por
"declarar do zero, sem controle".

Três consequências concretas:

1. o servidor virou seu próprio registrador de ponto;
2. a folha se desconectou de `marcacoes_ponto` — o espelho de ponto (que vai para o fiscal) e as
   marcações passavam a poder discordar em silêncio;
3. nenhum rastro de quem editou o quê, quando ou com base em que informação.

## A solução: canalizar, não calar

Simplesmente bloquear a edição empurraria todo o trabalho para o coordenador, que teria de
perguntar ao servidor de qualquer jeito — o servidor é quem sabe o horário real, e essa
informação não deveria ser descartada.

A infraestrutura para canalizar já existia desde a Fase 1 da integração com relógio de ponto:
o enum `marcacao_origem` tem `ajuste_servidor` com **precedência 4**, a mais baixa das quatro
(perde para relógio, terminal e ajuste do coordenador). É exatamente o peso correto para uma
autodeclaração.

### O fluxo

| passo | o que acontece |
|---|---|
| 1 | Servidor vê a célula vazia na folha do portal e clica em "informar horário" |
| 2 | Informa o horário e o motivo; `fn_solicitar_ajuste_ponto` valida e cria uma `marcacao_ponto` de origem `ajuste_servidor`, pendente |
| 3 | A solicitação cai na mesma fila de revisão construída para o terminal (`fn_marcacoes_pendentes_revisao`), agora com a coluna `origem` para distinguir batida real de autodeclaração |
| 4 | Coordenador aceita (`fn_aceitar_marcacao_pendente`) e o horário informado entra em `escala_diaria` |

A folha em si passou a ser **somente leitura** no portal. Bloqueio em duas camadas: os quatro
inputs de horário e a observação ficam desabilitados quando `isPortal` (interface), e
`salvarFolhaPontoServidor` recusa no servidor qualquer alteração de horário — importa porque o
portal autentica apenas por PIN e a server action é chamável diretamente, sem depender da UI
respeitar o `disabled`.

### Regras da solicitação

- **IDOR fechado no banco.** `fn_solicitar_ajuste_ponto` confere que o dia pertence ao servidor
  que está pedindo. É a única barreira real, já que a autenticação do portal é só por PIN.
- **Passo já registrado recusa a solicitação.** Contestar um horário existente é mais grave que
  preencher uma lacuna — fica com o coordenador, não é autoatendimento.
- **Sobreaviso fica fora**, mesma razão de sempre: ciclo próprio, não registra presença.
- **Competência encerrada recusa.**
- A solicitação **nunca** escreve em `escala_diaria` — só a decisão do coordenador escreve.

### O atestado em massa também passou a respeitar

Pela mesma razão da correção anterior (v1.22.1) para batidas do terminal: `fn_atestar_jornada_bulk`
agora pula também os dias com solicitação de ajuste pendente, e devolve a lista ao chamador com
uma flag (`tem_solicitacao`) para diferenciar do caso de batida do terminal.

## Decisões de implementação

- **Não foi criada rota nova de UI**; a solicitação vive dentro do próprio `FolhaPontoEditor`,
  via prop `onSolicitarAjuste` — o mesmo componente que a grade do coordenador usa, sem
  duplicar a tabela.
- **`fn_confirmar_presenca_manual` e `fn_confirmar_presenca_manual_bulk` não foram alteradas.**
- O botão "informar horário" só aparece em dia de trabalho com entrada **ou** saída vazia —
  exatamente o caso de esquecimento de batida, que é o cenário que a solicitação existe para
  resolver.

## Verificação

`npx tsc --noEmit` e `npm run build` limpos. Roteiro de conferência no rodapé de
`20260808130000_solicitacao_de_ajuste_pelo_servidor.sql`; o item 2 (IDOR) é o mais importante.

## Nota sobre um erro corrigido durante a implementação

A primeira versão de `fn_solicitar_ajuste_ponto` falhou no `CREATE FUNCTION` com
`42601: record variable cannot be part of multiple-item INTO list` — em plpgsql, uma variável
`%ROWTYPE` não pode dividir a lista `INTO` com escalares. Corrigido separando em dois `SELECT`.
Diferente dos erros de resolução de nome que só aparecem em execução, este é sintático e por
isso barrou a aplicação da migration antes de qualquer efeito.
