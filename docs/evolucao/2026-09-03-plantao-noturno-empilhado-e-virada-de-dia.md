# O plantão noturno que nascia às 07:00, e o modal que não sabia de que dia era a batida

**03/09/2026**

Dois relatos no mesmo dia, com o mesmo sintoma para quem olha a tela — "as marcações do plantão
noturno não fazem sentido" — e **causas completamente diferentes**. Tratá-los como um só levaria a
corrigir a metade errada.

| | CHARLENE (mat. 69250, HMI/FISIOTERAPIA, 02/09) | NEURIAN (mat. 17227, SMS/REGULAÇÃO, 01/09) |
|---|---|---|
| onde estava o defeito | **banco**: a previsão do plantão | **frontend**: o modal de validação |
| a previsão do banco estava | **errada** (07:00–19:00) | **certa** (19:00 → 07:00+1) |

---

## Caso A — a batida não foi esquecida

O relato foi: *"ela está na escala M 07h às 13h, e nesse dia tem um plantão N que por padrão é das
19h às 07h; a saída do regular dela está às 18:45, que seria a entrada do plantão — possivelmente
o servidor esqueceu de bater a saída às 13h"*.

Ela **não** esqueceu. As batidas, todas de origem `rep`:

```
06:50   13:00   18:45   21:35   22:35        (02/09)
06:57   07:15                                (03/09)
```

O que estava gravado:

| linha | previsto **pelo banco** | entrada | saída |
|---|---|---|---|
| Regular `M` | 07:00 → **19:00** | 06:50 | **18:45** |
| Plantão `N` | **07:00 → 19:00** | **13:00** | **21:35** |
| Regular `M` do dia 3 | 07:00 → 13:00 | 06:57 | **07:15** |

Expediente de 6h aparecendo com **11h55** — ~5h55 de hora extra que não existiu.

### A causa

`fn_blocos_previstos_dia` devolvia **um bloco só**: `07:00 → 19:00`, `permite_intervalo FALSE`,
`turnos_fim [13:00, 19:00]`. O Plantão `N` nascia às **07:00**.

A cadeia de horário do Plantão (armadilha 4) percorre: nível 1 (`hora_inicio_prevista`) — nulo;
2-A (espelho da jornada noturna) — só vale para `slots[1]` em `M`/`T`; nível 2 (âncora `N` = 19:00)
— **bloqueado**, porque só vale "quando não há Regular no dia"; ramos de emenda — nenhum casa
(`07H ÀS 13H` não começa nem termina entre 17h e 20h); e então o **último ramo**:
`substring(j.nome from '^([0-9]+)')` → **7**.

O último recurso da cascata é **o início da jornada Regular**. Para plantão noturno em jornada
diurna isso não emenda nada — empilha o plantão em cima do expediente. Aí a fusão de blocos
(armadilha 6) junta os dois, e o plantão de 12h ainda perde o passo de intervalo (armadilha 9).

O DP é o amplificador, não a causa. Com 4 slots (`07:00 entrada` · `07:00 entrada-fronteira` ·
`13:00 saída-fronteira` · `19:00 saída`):

```
06:50 → 07:00 (10)   13:00 → 07:00 (360)   18:45 → 13:00 (345)   21:35 → 19:00 (155)
custo 1590   <   descartar as duas do meio: 1440 + 15 + 10 = 2185
```

Como não casar custa 720 (`v_tol_ontem * 2`), **casar a seis horas de distância compensa**. Isso já
estava registrado ("o DP prefere quantidade a qualidade") e foi simulado e descartado em
19/08/2026 — não era ali que se devia mexer.

⚠️ **A grade e o banco discordavam em silêncio.** `getShiftStartHour` sempre resolveu `N` pela
âncora fixa de 19:00, sem olhar a jornada. Compliance e PDF viam `19:00 → 07:00`; terminal,
reconciliação e folha usavam `07:00 → 19:00`. Nenhuma tela mostrava o horário que o banco usava —
por isso o erro só aparecia depois, como hora extra estranha na folha.

### Extensão

`fn_blocos_previstos_mes` sobre **2.216** escalas ativas (32.345 blocos): **156 linhas de Plantão
previstas sobrepostas ao Regular** do mesmo dia, 54 com ponto, 5 unidades, 28 servidores.

⚠️ A medição precisou ser refeita: **o RPC também corta em 1000 linhas** (armadilha 8), em
silêncio. Com lotes de 100 escalas a Charlene simplesmente não aparecia no resultado.

| família | casos | causa |
|---|---|---|
| **A** — código com âncora | 64 | fallback pelo nome da jornada |
| **B** — Classe B (`T4`, `N4`, `N6`, `M7`) | 71 | o código dá duração, não hora |
| **C** — não cabe no dia | 21 | `MT` 12h + Regular `07H ÀS 19H` = 24h previstas |

### A correção: nível 2-B

`20260903100000` acrescenta um ramo à cascata do Plantão, **depois** de todos os ramos de emenda e
**antes** do fallback pelo nome da jornada:

> se o turno tem âncora no dicionário **e** a janela `[âncora, âncora + duração]` **não se
> sobrepõe** à janela prevista do Regular do dia, use a âncora.

Por construção não altera nenhum dia em que um ramo de emenda já casa: Regular `07H ÀS 17H` + `N`
continua 17:00; `12H ÀS 18H` + `M` continua 06:00; jornada `18H ÀS 06H` + `MT` continua no 2-A.

⚠️ **O ramo não pode subir.** Acima dos ramos de emenda ele quebraria o comportamento medido em 49
dias reais em 08/08/2026, que é o motivo de existir a condição do nível 2. E **essa condição
continua no lugar** — o 2-B passa por baixo dela com a checagem explícita de não-colisão, que é o
próprio critério que ela dizia proteger.

### Como isso foi verificado antes de aplicar

A migration é cópia mecânica (armadilha 1) de **duas fontes diferentes** — `fn_confirmar_presenca`
vem de `20260901120000` (2 cursores) e `fn_blocos_previstos_dia` + `fn_confirmar_presenca_manual`
de `20260822130000` —, gerada por `scratchpad/gen_ancora_livre.js`, com 4 substituições,
invariantes por contagem exata e conferência estrutural do arquivo inteiro.

⚠️ **O gerador foi validado injetando três regressões**, e a primeira versão dele **reprovou no
teste**: ela só comparava a contagem de invariantes **antes × depois**, e uma fonte com o guard de
`Sobreaviso` removido passava batido (0 == 0). Conferir contra um **número esperado** é o que pega
fonte quebrada — o caso caro, porque plpgsql só reclama disso em tempo de execução.

⚠️ E o **primeiro teste de regressão também estava errado**: quebrei a ocorrência do bloco do
*Regular*, não a do Plantão, e o gerador acertou de propósito. Um portão que "passa" precisa ser
lido com a mesma desconfiança de um que falha.

Portão de efeito (`scratchpad/sim_nivel2b.mjs`): a réplica da cascata em JS reproduz
**3.010 de 3.010** plantões (100%) — só então ela serve para prever. Previsão: **60** plantões
mudam, todos código `N`, todos em 09/2026 (`7h→19h` em 56, `8h→19h` em 3, `10h→19h` em 1), nenhum
Regular ou Extra alcançado, nenhuma competência fechada tocada.

### Depois de aplicar

Medido em produção: **156 → 96** sobreposições (queda de exatamente 60). O bloco da Charlene:

```
bloco 1 Regular  02/09 07:00 -> 02/09 13:00   intervalo=false
bloco 2 Plantão  02/09 19:00 -> 03/09 07:00   intervalo=true  23:00/00:00
```

Os 9 dias que já tinham ponto foram reconciliados por **lista fechada**, com ensaio antes:
14 ganhos, 12 trocas, 1 "perda". A Charlene ficou `Regular 06:50 → 13:00` e
`Plantão 18:45 → 06:57(+1)`, com intervalo 21:35/22:35 — a leitura que qualquer humano faz das
batidas dela.

⚠️ **A "perda" não era perda.** FABIANA (29316) tinha **uma só** batida (19:21), gravada como
*saída* do bloco errado; com o bloco certo ela virou **entrada**, e a saída passou a ser a
pendência que sempre foi. Ler linha a linha é o que separa isso de apagar ponto.

Casos distorcidos em 09/2026: **11 → 4**. Hora extra aparente indevida: **16h20 → 5h38**. Os 4
restantes são famílias B e C, que o 2-B não cobre por desenho.

---

## Caso B — o modal era cego à virada de dia

*"Ela chegou às 18:58 e saiu às 07:02, só que foi do outro dia. Como na tela de seleção não aparece
a data, não tenho como saber se essas batidas de 7h foram do dia anterior ou do outro dia."*

Aqui o banco estava **certo**: bloco previsto `19:00 → 07:00+1`, alocação casando 18:58 com a
entrada (2 min) e 07:06 com a saída do dia seguinte (6 min), projeção idem.

O defeito era o filtro do modal:

```ts
const d = new Date(iso)
return d.getDate() === dia && d.getMonth() + 1 === mes && d.getFullYear() === ano
```

**Dia civil.** Num turno que atravessa a meia-noite isso erra dos dois lados: descarta a saída real
(07:02 do dia 2) e admite as batidas de 07:00/07:02 do dia 1, que são a saída do plantão da
**véspera**.

🚨 O efeito não era só falta de informação: **o modal oferecia, como saída do plantão do dia 1, uma
batida ocorrida 12 horas antes da entrada dele.**

Fonte única nova: `src/utils/janelaBatidas.ts`. A lista passou a ser a **união** do dia civil com a
janela prevista do bloco — união, nunca substituição, porque trocar um critério pelo outro
esconderia batida que hoje aparece, e batida escondida vira ponto perdido em silêncio. Toda batida
mostra `+1D` / `−1D` com a data completa no `title`; as do turno vêm primeiro, as que só dividem o
dia civil vêm depois, rotuladas "fora do turno previsto" — visíveis e selecionáveis, porque o
coordenador é a autoridade; o que não pode é ele escolher às cegas.

⚠️ **Dois achados dentro desse:**

1. **A deduplicação precisava da data.** `07:02` do dia 1 e `07:02` do dia 2 são batidas físicas
   diferentes, e a chave só de horário fazia a **segunda ser descartada** como repetida.
2. **Conferir a ordem por `HH:MM` não serve para batida selecionada.**
   `avaliarSequenciaPresenca` normaliza monotonicamente — num turno que cruza a meia-noite ela
   empurra para "+1 dia" todo passo menor que o anterior. Correto para horário *digitado*; para
   batida **selecionada** o instante é conhecido, e normalizar esconderia exatamente o erro. A
   seleção passou a guardar o `instante`, e o envio confere a ordem pelos instantes reais. O
   `instante` não trafega ao banco — o que vai é o `id`.

Portão: `node scratchpad/sim_janela_batidas.js`, 16 casos.

---

## Caso C — o que a investigação da NEURIAN revelou

A linha dela tinha `reconciliado_em IS NULL` e entrada de origem `terminal`. Nunca fora
reconciliada.

`fn_ingerir_afd` chama `fn_reconciliar_marcacoes_dia` para **o dia da batida**, nunca o do bloco; e
`trg_reconciliar_apos_marcacao` é **inerte** enquanto nenhuma unidade estiver em
`fonte_ponto_oficial = 'rep'`. Quando a escala é lançada ou ajustada *depois* de a batida chegar,
ninguém reprojeta. Um `fn_reconciliar_marcacoes_dia(NEURIAN, '2026-09-02')` resolveu: a saída
`02/09 07:06` entrou e a entrada subiu de `terminal` para `rep` pela precedência.

Extensão medida em 08–10/2026: dos 65 turnos que cruzam a meia-noite com um passo faltando, apenas
**2 eram recuperáveis**. Não é epidêmico — mas não tem detecção nenhuma.

🚨 **E a solução não é reconciliar em massa.** Remedido sobre 09/2026 (1.614 pares servidor/dia):
**4 ganhos contra 43 trocas e 7 perdas**, uma delas tirando `16:36 → 12:02` de uma saída já
gravada. Bate com o registro de 19/08/2026.

---

## O que ficou pendente

- **Camada 2** — exigir a hora nos códigos Classe B e recusar plantão que sobrepõe o Regular.
  `precisaHoraInicio` (`ScaleGrid.tsx:1282`) **já** faz metade disso, mas o único chamador é
  `handleCellChange`: Aplicar Template e Gerador Inteligente escrevem direto no `gridData` e nunca
  passam por ali. É a armadilha 14/23/26 pela quarta vez, agora no eixo "hora do plantão".
- **Camada 3** — detector de alocação suspeita: plantão sobreposto, batida casada a mais de 90 min
  do previsto (138 ocorrências em três dias de 09/2026), duração praticada muito acima da prevista.
- **Reconciliação disparada por mudança de escala** — não existe; decidir se vira gatilho, ação de
  tela ou item do detector.
- `fn_confirmar_presenca_manual` **não tem** o guard `dobra_diurna` que as outras duas funções têm
  (0 ocorrências contra 31 e 17). Divergência anterior a este trabalho, registrada para não se
  perder.

Plano completo em
[`docs/planos/2026-09-03-plantao-noturno-previsao-e-virada-de-dia.md`](../planos/2026-09-03-plantao-noturno-previsao-e-virada-de-dia.md).
