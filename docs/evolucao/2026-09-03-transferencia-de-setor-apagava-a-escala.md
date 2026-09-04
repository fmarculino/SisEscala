# A transferência de setor apagava a escala em vez de movê-la (03/09/2026)

Relato do usuário, olhando a grade de `USF ENFERMEIRA ZEZINHA / AMBULATÓRIO CLÍNICO` em 09/2026:

> esses servidores foram inseridos na escala errada, eles deveriam estar na escala do mais medicos.
> eu fiz a transferencia de setor deles mas as escalas continuam no mesmo setor de antes […]
> acredito que isso o sistema já faz correto, verifique essa situação

A suposição estava certa na intenção e **errada no ponto que importa**.

## O que foi medido antes de mexer

4 servidores (ANDRE, ISAAC, KETHURY, MARCELO) transferidos `AMBULATÓRIO CLÍNICO → MAIS MEDICOS`
com `data_transferencia = 09/09/2026`, registrado em 03/09/2026 16:03.

| | 08/2026 | 09/2026 | em MAIS MEDICOS |
|---|---|---|---|
| todos os 4 | AMBULATÓRIO, Fechada | AMBULATÓRIO, Rascunho | **nada** |

LARA COSTA SOUSA aparecia no mesmo recorte da tela mas **não tinha sido transferida** — continua
lotada em AMBULATÓRIO CLÍNICO, e a escala dela está no lugar certo.

## O código

`registrarTransferenciaEfetivada` (`servidores/actions.ts`) fazia quatro coisas, **todas DELETE**:

| | o que fazia |
|---|---|
| A | origem, mês da transferência: apagava os dias ≥ 9 sem ponto |
| B | destino, mesmo mês: apagava os dias < 9 — **só se a escala de destino já existisse** |
| C | origem, meses seguintes: apagava a escala inteira |
| D | destino, meses anteriores: idem |

Ou seja: o sistema **dividia por data**, o que é a intenção certa — mas a metade "depois da
transferência" era **destruída, nunca movida**, e a escala do setor novo **nunca era criada**. Não
existia "escala parcial no setor novo"; existia um buraco.

Foi exatamente o que se viu: os dias 1–8 ficaram no AMBULATÓRIO (**correto**, eles trabalharam lá
até o dia 9), os dias ≥ 9 sumiram, e MAIS MEDICOS não recebeu nada.

**Quatro defeitos, em ordem de gravidade:**

1. **A metade "depois" era destruída em vez de movida.**
2. **Nunca perguntava.** Sempre dividia, mesmo quando a intenção era mover o mês inteiro.
3. **Falhava em silêncio.** O bloco inteiro rodava num `try/catch` que só fazia `console.error`: a
   transferência "dava certo" sem ter tocado em escala alguma, e a tela não dizia nada. É a
   armadilha 22 (relatar o calculado, não o que mudou) na forma pior — relatar sucesso sem ter
   mudado nada.
4. **O DELETE não respeitava competência encerrada.** `trg_escala_diaria_guard_competencia` é
   `BEFORE UPDATE` e só olha colunas de presença — DELETE passava. O dano era limitado (só linha
   sem ponto), mas turno planejado de mês fechado podia ser apagado.

## Por que mover e dividir são baratos

⚠️ **`escala_diaria` não tem setor nem unidade próprios — herda de `escala_mensal`.** Então:

- **mover** = `UPDATE escala_mensal SET setor_id, unidade_id` — uma linha, e todos os dias vão junto;
- **dividir** = criar a segunda `escala_mensal` + `UPDATE escala_diaria SET escala_mensal_id WHERE dia >= D`.

Nos dois casos **nada é fabricado e nada é apagado**: a presença viaja na própria linha, e
`marcacoes_ponto` mantém o `setor_id` onde a batida foi registrada — que é o fato, e deve ficar
onde está.

## Decisões do usuário

| pergunta | resposta |
|---|---|
| folha de ponto na divisão | **duas folhas parciais**, uma por setor (`folha_ponto` já é chaveada por `escala_mensal_id` e não guarda setor — sai de graça) |
| competência Fechada / encerrada | **recusar sempre**; a porta é reabrir a competência em Configurações |
| alcance na grade | **só a competência da tela** |
| os 4 agora | **mover 09/2026 inteiro** para MAIS MEDICOS |

## O que foi construído

`20260903120000` — `fn_mover_escala_mensal`, `fn_dividir_escala_mensal`, a tabela append-only
`escala_mensal_movimentos`, e a correção dos 4 **por id explícito**.

Guards em `fn_validar_destino_escala` (fonte única das recusas, para mover e dividir não
divergirem): competência encerrada, escala Fechada, setor inativo, setor de outra unidade,
destino igual à origem, colisão com escala já existente do mesmo servidor no destino, e permissão
**nos dois lados** (`fn_pode_mover_escala_mensal` reusa `fn_pode_solicitar_excecao_carga`, que já
espelha a policy de escrita de `escala_mensal` — não se inventa critério novo).

⚠️ **A folha segue sozinha no "mover" e não segue no "dividir".** `folha_ponto` aponta para
`escala_mensal_id` e não tem coluna de setor, então mover leva a folha junto sem regerar nada.
Dividir é diferente: a folha existente continua presa à escala de **origem** cobrindo dias que
foram embora. Por isso a divisão **recusa** quando já existe folha fora de Rascunho, e devolve
`folha_sincronizar` para a tela mandar sincronizar.

⚠️ **Não há sobreposição nova a temer** (armadilha 23): mover não muda o conjunto de (dia, slots)
do servidor, só a quem eles são atribuídos — e a única escala que poderia colidir no destino já foi
recusada pelo guard.

### Na grade

Botão **"Transferir Escala"**: marca um ou mais servidores, escolhe o destino (na árvore de
seleção única do mesmo dia) e justifica. Relata servidor por servidor o que moveu **e o que não
moveu, com o motivo**.

### No cadastro

Ao transferir alguém com escala aberta, o modal **pergunta**: *mover inteira* · *dividir na data*
· *não mexer*.

⚠️ **O default de `registrarTransferenciaEfetivada` passou a ser `'nao_mexer'`.** Quem chamar sem
escolher não apaga mês de trabalho por omissão — mexer em escala é decisão de quem transfere,
tomada na tela, nunca efeito colateral de um `UPDATE` em `servidores`.

⚠️ **Falha na escala não é mais engolida.** A transferência já foi efetivada e não se desfaz por
causa da escala, mas o resultado volta como texto legível dizendo o que ficou para trás e por quê.

⚠️ **Na transferência o alcance é o mês da transferência E os posteriores** (na grade é só a
competência da tela). Deixar escala futura no setor antigo seria o mesmo defeito de novo. Os meses
**anteriores** ficam onde estão — a pessoa trabalhou lá, e reescrever mês passado é o oposto do
que a transferência afirma.

⚠️ **A escolha do modal mora num `useRef`, não em `useState`.** `handleSubmit` a lê no mesmo tick
em que o modal a define; o `setState` só chegaria no render seguinte e o formulário sairia sem a
escolha.

## Conferido em produção depois de aplicar

| conferência | resultado |
|---|---|
| as 4 escalas de 09/2026 | em MAIS MEDICOS, Rascunho — ANDRE 5 dias/1 com ponto, KETHURY 5/2, ISAAC 6/1, MARCELO 3/1 (idêntico ao medido antes) |
| 08/2026 dos 4 | intacta em AMBULATÓRIO CLÍNICO, Fechada, 16/14/17/7 dias |
| histórico | 4 linhas `mover`, com dias e dias com ponto |
| folha de 09/2026 | seguiu junto, sem regerar |
| restam no AMBULATÓRIO em 09/2026 | 5 escalas, todas de gente que é daquele setor (LARA incluída) |

## Um ponto em aberto

Mover 09/2026 inteiro **contradiz de propósito** a `data_transferencia = 09/09/2026` gravada em
`historico_transferencias` — passa a dizer que estavam em MAIS MEDICOS desde o dia 1. Foi decisão
do usuário (a lotação já estava errada desde o início do mês), mas os dois registros ficam se
contradizendo. Se a data 09/09 é que estava errada, ela também merece correção.
