# Dois nomes para o mesmo setor: padronização do ASG e aviso de nome parecido

**14/09/2026**

## O que aconteceu

O usuário abriu a USF Pedro Cavalcante e viu, na mesma unidade, dois setores que são a mesma
coisa: **ASG AGENTE DE SERVIÇOS GERAIS** e **SERVIÇOS GERAIS**.

Não era um caso isolado. Medido em produção (`scratchpad/an_asg_setores.mjs`):

| entrada do dicionário | setores | servidores | escalas | marcações |
|---|---|---|---|---|
| `SERVIÇOS GERAIS` | **27** (26 unidades + 1 com os dois) | 76 | 91 | 640 |
| `ASG AGENTE DE SERVIÇOS GERAIS` | 4 | — | — | — |
| `ASG` | 1 (HMI, subsetor de `BANCO DE LEITE`) | 10 | 21 | 8 |

## Como o par nasceu na Pedro Cavalcante

`historico_transferencias` respondeu na hora: **BEATRIZ XAVIER VERAS (mat. 69158)**, transferida em
14/09/2026 (efeito em 17/09) de `SMS \ SERVIÇOS GERAIS` para
`USF Pedro Cavalcante \ SERVIÇOS GERAIS`, motivo *"REMANEJADO PARA COBRIR FERIAS"*. Ela ficou
sozinha num setor paralelo enquanto as 4 colegas estavam no `ASG AGENTE DE SERVIÇOS GERAIS`.

🚨 **A hipótese inicial era que a transferência não pedia o setor de destino. Não é isso.** A
aprovação **já recusa** sem destino explícito (*"Para aprovar a transferência, por favor selecione
a unidade e o setor de destino do servidor"*), a escolha é numa árvore de setor único, e nenhum
caminho do sistema cria setor sozinho — o único `insert` em `setores` é a tela de Setores.

**O que falhou foi a lista ter duas opções válidas**, e quem aprovou escolheu a que tinha o mesmo
nome do setor de origem. Pedir mais uma confirmação não teria mudado nada: a pessoa confirmaria o
mesmo setor errado.

## A raiz

`resolverDicionarioSetor` busca o nome com `.eq('nome', nome)` e **cria uma entrada nova sempre que
não acha**. O campo é texto livre, então o dicionário cresce por digitação: 250 entradas em ~2
meses, com a família ASG em 5 variações.

## Passo 1 — padronizar o que já existia

| operação | resultado |
|---|---|
| `fn_fundir_setor` na USF Pedro Cavalcante (0 impedimentos) | 1 servidora, 1 histórico, 1 solicitação e 1 log movidos; setor errado excluído |
| repontar `dicionario_setor_id` nos outros 26 | 76 lotados, 91 escalas e 640 marcações preservados |
| repontar o `ASG` do HMI | 10 lotados preservados |
| excluir `SERVIÇOS GERAIS` e `ASG` do dicionário | só `setores` referencia o dicionário — conferido antes |

✅ **Conferido depois de aplicar** (`scratchpad/ver_padroniza_asg.mjs`): 0 setores nas entradas
antigas, 31 no nome correto, BEATRIZ junto das colegas, nenhum servidor ativo sem setor.

⚠️ **Repontar não é gambiarra — é exatamente o que a tela faz ao renomear**: o nome mora em
`dicionario_setores` e `setores` guarda só o `dicionario_setor_id`, então `updateSetor` renomeia
repontando. O setor continua sendo o mesmo registro, e por isso nada de ponto, escala ou folha se
move.

⚠️ **Só a Pedro Cavalcante exigiu fusão.** Nas outras 26 unidades só existia o nome errado, e aí
renomear resolve sem mover nada.

## Passo 2 — impedir que volte

Fonte única: **`src/utils/setores/nomeSetor.ts`**.

| situação | o que acontece |
|---|---|
| nome idêntico depois de normalizar (`SERVICOS GERAIS` × `SERVIÇOS GERAIS`) | **reusa a entrada existente**, sem perguntar |
| nome parecido (`contido` ou uma letra numa palavra longa) | **recusa**, lista os parecidos e só segue com confirmação explícita |
| nome que já está no dicionário | nada — não há entrada nova a criar |

A tela avisa enquanto se digita (`AvisoNomeSetorParecido`), com botão *"Usar «nome existente»"* e a
caixa de confirmação. **A tela não é a defesa**: server action é um POST chamável direto
(armadilha 33), então quem decide é a action.

### O critério saiu de medição, não de intuição

A primeira versão disparava em **94 dos 248** nomes do dicionário (37,9%) — e um aviso que grita à
toa ensina a clicar sem ler. Pior, acusava pares legítimos:

| par acusado | por quê era falso |
|---|---|
| `CARDIOLOGIA` × `RADIOLOGIA` | distância de edição 2 sobre o nome inteiro |
| `MAMOGRAFIA` × `TOMOGRAFIA` | idem |
| `PORTARIA EXTERNA` × `PORTARIA INTERNA` | idem |
| `BLOCO A` × `BLOCO B` | uma letra, mas é ela que distingue os dois |
| `ENFERMAGEM` × `TEC ENFERMAGEM` | uma palavra contida pega a família inteira |

Três cortes, e o número caiu para **35 de 248 (14,1%)**, média de 1,2 sugestão, com o caso real
(`SERVIÇOS GERAIS` → `ASG AGENTE DE SERVIÇOS GERAIS`) continuando pego:

1. **o lado menor precisa ter 2+ palavras significativas** — tira `ENFERMAGEM`, `PEDIATRIA`,
   `PORTARIA`, `COORDENAÇÃO` acusando as próprias famílias;
2. **a distância de edição é por PALAVRA, nunca sobre o nome inteiro**;
3. **a palavra divergente precisa ter 4+ letras** — em palavra curta uma letra é identificador
   (`BLOCO A` × `BLOCO B`), em palavra longa é engano (`MAQUEIRO` × `MAQUEIROS`).

O que sobrou é majoritariamente duplicidade real: `LABORATORIO` / `LABORATÓRIO` / `LABORATÓRIOS`,
`MAQUEIRO` / `MAQUEIROS`, `PANEJAMENTO` / `PANEJAMENTOS`.

⚠️ **O aviso não aparece quando o nome digitado já está no dicionário** — mesma condição da action.
Sem isso, abrir a edição de `CENTRO CIRÚRGICO` (que convive legitimamente com
`ENF CENTRO CIRÚRGICO`) mostraria alerta sem ninguém ter mexido em nada.

⚠️ **A confirmação zera a cada tecla.** Marcar, trocar o nome e enviar passaria sem que a nova
lista tivesse sido vista — e o campo só existe enquanto o aviso está na tela.

## Portões

- `node scratchpad/sim_nome_setor.js` — **40 asserções**
- `node scratchpad/val_sim_nome_setor.js` — **7 regressões injetadas, 7 reprovadas**
- `node scratchpad/sim_manual.js` — 803 asserções (manual atualizado no mesmo commit)

Transpile antes:
`npx tsc src/utils/setores/nomeSetor.ts --outDir scratchpad/_sim --module commonjs --target es2020`

Medição reproduzível: `node scratchpad/an_ruido_nome_setor.mjs`.

## O que ficou de fora

- As outras variações da família ASG (`ASG / ALMOXARIFE / AUXILIAR`,
  `COPEIRA/ASG/COZINHEIRO`, `COPEIRO / COZINHEIRO / ASG`) **não** foram tocadas: são cargos
  combinados, não sinônimo puro de ASG.
- O dicionário tem outras duplicidades que o aviso agora acusaria mas que já estão gravadas
  (`LABORATORIO` × `LABORATÓRIO` × `LABORATÓRIOS`, `MAQUEIRO` × `MAQUEIROS`,
  `PANEJAMENTO` × `PANEJAMENTOS`). Resolver é fusão caso a caso, com medição própria.
