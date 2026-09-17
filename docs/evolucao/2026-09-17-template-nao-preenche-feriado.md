# Aplicar Template deixa de preencher feriado, e o menu de Ferramentas sai do card (17/09/2026)

**Issue:** [#5 — Ferramenta aplicar templates ignorar feriados](https://github.com/fmarculino/SisEscala/issues/5).
**Versão:** v2.70.0. **Sem migration.**

## O pedido

> "O sistema não deve preencher o dia que for feriado pois na maioria das vezes o servidor não
> trabalha nesse dia e como tem a opção para gerar a marcação retroativa ao gerar a marcação o
> coordenador fica impossibilitado de remover aquele dia."

E, junto: o menu **Ferramentas** ficava cortado quando a escala tinha poucos servidores.

## Por que preencher o feriado é caro e deixar vazio é barato

🚨 **A razão não é o calendário, é a ASSIMETRIA DO ERRO.**

| erro | custo |
|---|---|
| deixar o feriado **vazio** quando houve trabalho | uma célula digitada à mão, e o buraco é **visível** na grade |
| **preencher** o feriado quando não houve | com *Validar dias passados*, vira presença gravada que o coordenador **não consegue mais apagar** — a célula com ponto é protegida pelo "Direito Adquirido" |

O segundo é o que o usuário relatou. É o mesmo princípio que já rege o resto do sistema: **onde o
sistema não tem como saber, ele não preenche** (é a regra da pré-assinalação, da v1.22.0).

## O que entrou

`diasDeFeriado` (em `src/utils/scaleTemplates.ts`) devolve os dias da competência que são feriado,
e eles entram no **mesmo canal** que já existia para ponto batido, afastamento e sobreposição
entre setores: o `skipDays` de `generateTemplate`.

⚠️ **Compara STRING `YYYY-MM-DD`, nunca `new Date(...)`** (armadilha 12). O processo roda em UTC, e
`new Date('2026-09-07')` é meia-noite UTC = **dia 6** em `America/Sao_Paulo`: uma implementação por
`Date` pularia o dia errado, e o portão tem uma asserção só para isso.

⚠️ **Vale para TODOS os modelos, inclusive os cíclicos** (12×36, 12×48, 6×1), que caem em qualquer
dia da semana de propósito. É justamente o plantonista que gera a presença retroativa impossível de
apagar. Quem trabalha em todo feriado **desmarca a caixa**, que é nova no modal e nasce marcada.

⚠️ **O ciclo não se desloca.** Pular um dia não empurra o resto da escala — o dia fica vazio e o
ciclo segue como se nada tivesse acontecido, igual ao que já acontecia com afastamento. O portão
confere isso nos três modelos cíclicos.

⚠️ **A caixa mostra QUAIS são os feriados do mês.** Caixa marcada sem a lista ao lado seria decisão
às cegas: o coordenador não teria como saber se aquilo muda alguma coisa naquela competência. Sem
feriado cadastrado, o texto diz isso em vez de sumir.

⚠️ **O relato final lista os dias que ficaram de fora** (armadilha 22), ao lado dos que já eram
relatados por ponto, afastamento e conflito de setor — e sugere o lançamento manual. Sem isso o
coordenador descobriria o feriado vazio só ao conferir a grade dia a dia.

ℹ️ **Ponto facultativo ficou de fora**, de propósito: não é feriado, e a decisão de trabalhar ou
não é da unidade. Se virar pedido, é outra caixa.

## O menu de Ferramentas era recortado pelo card

🚨 **`position: absolute` dentro de um ancestral com `overflow: hidden` é RECORTADO.** O card da
grade tem `overflow-hidden` — o arredondamento e a rolagem do cabeçalho fixo (v2.68.0) dependem
dele. Com muitos servidores o card é alto e o menu cabia; **com um servidor só, o menu era cortado
na terceira opção, sem barra de rolagem e sem nada indicando que havia mais quatro ferramentas
abaixo**. Na prática, "Revezamento de Vigias", "Preencher pelas Batidas" e "Validar em Massa" não
existiam para quem abria uma escala pequena.

A correção é desenhar o painel em **portal** (fora do card), com a posição calculada por
**`src/utils/ui/posicaoFlutuante.ts`**. O precedente já estava no repositório:
`IndicadoresPontoServidor.tsx` resolve o mesmo problema assim.

🚨 **Clicar fora precisou conhecer o menu do portal, e esquecer isso seria pior que o bug
original.** O painel deixou de ser descendente do `ref` do botão: sem consultar o `ref` do menu, o
`mousedown` sobre um item conta como "clique fora", o menu é desmontado antes do `mouseup` e o
`click` **nunca dispara** — menu visível, itens inertes.

⚠️ **`maxHeight` vem da mesma conta e não é enfeite:** é ele que troca "item escondido" por "menu
que rola". Abrir para cima quando não cabe embaixo é o complemento; e há um piso de altura, porque
um painel espremido a 20px é tão inútil quanto um cortado.

⚠️ **O listener de `scroll` usa captura (`true`)**: a grade rola num container próprio e esse
evento não borbulha até a `window`. Sem isso o menu ficaria parado enquanto a barra sai de baixo
dele.

ℹ️ O popover de `IndicadoresPontoServidor.tsx` tem uma cópia dessa conta e **não foi migrado** —
ele foi ajustado em campo duas vezes (v2.65.1 e v2.65.2) e mexer nele por unificação seria risco
sem retorno. Está registrado no cabeçalho do util como o candidato natural.

## Detalhe de processo

⚠️ **O gerador precisou virar IDEMPOTENTE, e isso saiu de um erro real.** A primeira execução
abortou numa âncora do segundo arquivo **depois** de já ter gravado o primeiro; ao corrigir e
rodar de novo, `diasDeFeriado` foi inserida **duas vezes** em `scaleTemplates.ts`. Um gerador que
só conta ocorrências da âncora não percebe que já rodou — agora cada bloco tem uma marca de
"já aplicado".

## Portões

- `node scratchpad/sim_template_feriado.js` — **29 asserções**.
- `node scratchpad/sim_posicao_flutuante.js` — **17 asserções**.
- `node scratchpad/val_sim_template_feriado.js` — **10 regressões injetadas, 10 reprovadas**.
- `node scratchpad/sim_manual.js` — 937 asserções (o manual entrou no mesmo commit).

Transpile antes com:

```bash
npx tsc src/utils/scaleTemplates.ts src/utils/ui/posicaoFlutuante.ts \
  --outDir scratchpad/_sim_ui --module commonjs --target es2020
```

## Não foi feito

- **Escala já lançada não é corrigida.** A mudança vale para as próximas aplicações do template; o
  feriado que já está na grade (e a presença já validada nele) continua onde está — mexer em ponto
  passado é decisão de quem responde pela folha, por lista fechada.
- **O Gerador Inteligente não ganhou a regra.** Ele sugere a partir do histórico real do setor: se
  a equipe trabalhou no feriado nos meses anteriores, sugerir o feriado é o comportamento correto.
