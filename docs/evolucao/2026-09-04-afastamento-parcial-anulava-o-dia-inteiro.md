# Afastamento de meio período anulava o dia inteiro (04/09/2026)

> Relato do usuário: *"a Luana teve alguns atestados parciais, ou seja, parte do dia, nos dias 25
> e 27. No entanto na folha de ponto não está constando o período que ela trabalhou de fato — o
> sistema deixa o dia todo em branco. Deveria contar o período que ela trabalhou, e o outro sim
> seria o atestado."*

## O que a folha mostrava

`LUANA JESUS DE OLIVEIRA` (mat. 52705), DMAC/SMS, competência 08/2026, jornada `08H ÀS 18H`
(turno `MT`, 10h de vão com 2h de intervalo). Registro do dia 25 em `folha_ponto.registros`:

```json
{"dia":25,"entrada":"","saida":"","saida_intervalo":"","retorno_intervalo":"",
 "turno_codigo":null,"hora_extra_minutos":0,
 "observacao":"AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M) | FOLGA"}
```

Dia 27, idêntico. O `| FOLGA` no fim é a assinatura do defeito: a folha não estava tratando aquilo
como dia de trabalho com meio período afastado — estava tratando como **dia sem escala nenhuma**.

## A causa, em três camadas

O rótulo `(M)` vem do ramo de **slot** de `getAfastamentoObservacao` (se fosse por horas sairia
`08:00 às 10:00 (2h00m)`). Confirmado em `servidores_eventos`: `periodo_tipo = 'slot'`,
`slots = {M}`, `hora_inicio = NULL`, nos dois dias.

Afastamento por slot disparava três coisas em cadeia, e **as três usavam INTERSEÇÃO onde a regra
correta é CONTENÇÃO**:

| camada | o que fazia |
|---|---|
| `fn_clean_conflicting_shifts` (AFTER INSERT em `servidores_eventos`) | **apagava** a `escala_diaria` do dia. E apagava sem olhar slot nenhum — o `DELETE` filtrava só por data e ausência de presença |
| `fn_prevent_shift_during_event` (BEFORE INSERT/UPDATE em `escala_diaria`) | impedia relançar: `se.slots && v_turno_slots` (`{M}` cruza `MT`) |
| as 4 cópias da geração de folha | `isShiftOverlappingAfastamento` marcava o dia como anulado; sem `escala_diaria`, o dia caía no ramo `!shift` e virava `FOLGA` |

Confirmado em produção: os dias 25 e 27 **não têm linha em `escala_diaria`** — foram removidos
pelo trigger no momento em que a declaração foi lançada. Os dias 24, 26 e 28 estão lá, com `MT`.

⚠️ **O caminho que já fazia a coisa certa existia e não era este.** O afastamento *por horas*
(`periodo_tipo = 'horas'`, migration `20260817210000`) nunca bloqueia nem apaga — o servidor
continua escalado e o tempo vira abono. O por **slot** simplesmente nunca ganhou esse tratamento.

## A regra nova

Migration `20260904120000`, fonte única em `src/utils/afastamentoParcial.ts`:

| o afastamento do dia... | alcance | efeito |
|---|---|---|
| é integral (sem slots) | `anula` | dia inteiro afastado (**inalterado**) |
| COBRE todos os slots do turno | `anula` | dia inteiro afastado (**inalterado**) |
| alcança PARTE dos slots | **`parcial`** | **preserva a escala e não bloqueia (novo)** |
| não alcança nenhum slot | `nao_alcanca` | não é parcial; a limpeza continua apagando (**inalterado**) |

🚨 **A última linha é deliberada e não pode ser "consertada" junto.** Medido em produção: há
**Férias** e **Licença Prêmio** lançadas com `slots = {M,T}` sobre jornada `19H ÀS 07H` (turno `N`)
— interseção **vazia**. É uso indevido do campo, mas a escala daqueles dias precisa continuar
sendo apagada. Tratar interseção vazia como "parcial" deixaria a servidora **escalada durante as
próprias férias**. Por isso a limpeza pergunta `ehParcial`, e não `!anula`.

⚠️ **A leitura é do DIA, nunca de um evento isolado.** Duas declarações de comparecimento no mesmo
dia (uma `{M}` e outra `{T}` — caso KETHURY CHAVES, 14/08/2026) são parciais uma a uma e, **juntas,
cobrem** o turno `MT`. `fn_afastamento_dia` devolve a união; sem isso, um dia inteiramente afastado
passaria como meio período.

⚠️ **Um furo achado na própria revisão:** o guard do `DELETE` passava `FALSE` fixo como
`p_integral`. Um afastamento integral convivendo com um parcial no mesmo dia seria classificado
como parcial, e a escala deixaria de ser apagada. O guard passa a ler o `integral` da própria
`fn_afastamento_dia`. (Na prática `fn_prevent_overlapping_event` já impede esse cadastro — o guard
é defesa em profundidade, descoberta ao tentar montar o caso em homologação.)

## O que a folha faz agora num dia parcial

- o turno **continua** na escala e na folha (`turno_codigo: "MT"`), aceitando os horários da tarde;
- observação `AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M)`, **sem** o `| FOLGA`;
- **horas normais integrais**, com o meio período em `abono_minutos` (decisão do usuário,
  04/09/2026: *jornada integral, com o período abonado*) — a mesma regra que o afastamento por
  horas já seguia, e não uma segunda regra inventada para o slot;
- `afastamento_slots` preenchido no registro.

🚨 **`afastamento_slots` existe para uma coisa só: impedir que o dia parcial vire atraso.** O
`previsto` de `calcularDia` vem do NOME da jornada e vale para o dia inteiro. Sem esse campo, quem
tem declaração pela manhã e volta às 13:10 numa jornada `08H ÀS 18H` apareceria com **5h10 de
atraso** — e, com declaração da tarde, com 6h de "saída antecipada". É o mesmo princípio que já
rege `previstoDaJornada`: sem previsto confiável, não há atraso a medir.

⚠️ **Recortar o previsto pelo slot foi considerado e descartado.** Onde cai o intervalo naquele dia
e a que horas a declaração terminou não estão no dado — um previsto recortado para `12:00–18:00`
acusaria 2h de atraso em quem volta às 14:00, que é o horário normal de retorno numa jornada com
intervalo 12:00–14:00. Trocaria um erro grande por um erro menor, ainda inventado.

⚠️ **A HORA EXTRA continua sendo medida, e isso é proposital.** Ela compara a SAÍDA contra o fim
previsto da jornada, que o afastamento matinal não move: quem foi liberada de manhã e saiu às 18:30
fez 30 min depois do horário, com atestado ou sem.

⚠️ **Dia parcial sem nenhum horário não vira FALTA** — o guard já existia
(`if (!registro.observacao && !temMarcacao)`), e a observação de afastamento parcial o desarma.

## Extensão medida em produção, ANTES de aplicar

`scratchpad/an_impacto_parcial.mjs`, 04/09/2026:

```
495 servidores_eventos | 48 por slot | 242 pares (servidor, dia) alcançados
  sem escala mensal ......... 89
  sem linha em escala_diaria  152   <- ja apagadas pelo trigger
  afastamento COBRE o turno .   0
  interseção vazia .........    1
  PARCIAL ..................    0
```

✅ **Nenhuma folha existente muda de valor.** Com a escala viva não há um único dia parcial hoje —
o trigger já apagou todos. A migration não recalcula nada: ela passa a **permitir** o que hoje é
impossível. Os 152 dias já apagados **não voltam sozinhos**; relançá-los é ato do coordenador na
grade.

## 🚨 O erro que quase foi para produção: copiar da migration errada

A primeira versão do gerador copiou as **três** funções de `20260820120000`. A migration teria
sido aplicada com sucesso e **não teria efeito nenhum na grade**: `fn_check_shift_conflicts` foi
reescrita depois, em `20260821100000`, ganhando o 7º argumento `p_escala_mensal_id` — e é a de 7
que o `ScaleGrid` chama. A cópia de 6 argumentos seria uma **sobrecarga morta**, e pior: ressuscitá-la
reabriria a ambiguidade que aquela migration tinha fechado com um `DROP`.

Só apareceu ao aplicar em homologação, com
`ERROR 42725: function public.fn_check_shift_conflicts(...) is not unique`.

É exatamente a armadilha 1 do `CLAUDE.md` — *"descubra qual migration define a versão vigente; não
é necessariamente a que o nome sugere"* — e o motivo pelo qual o gerador agora lê **duas fontes** e
confere invariantes contra cada uma:

```
fn_check_shift_conflicts      <- 20260821100000  (7 args, com p_escala_mensal_id)
fn_prevent_shift_during_event <- 20260820120000
fn_clean_conflicting_shifts   <- 20260820120000
```

O invariante `exclusao da propria celula preservada` existe só para isso: se alguém regerar a
partir da fonte errada, o gerador aborta em vez de escrever uma migration inócua.

## Portões

| portão | o que cobre |
|---|---|
| `node scratchpad/sim_afastamento_parcial.js` | 62 casos: alcance, bloqueio, abono, veredito da folha e `calcularDia` |
| `node scratchpad/val_sim_afastamento_parcial.js` | injeta 4 regressões e exige que o portão reprove cada uma |
| `node scratchpad/gen_afastamento_parcial.js` | 20 invariantes estruturais sobre a migration gerada |
| `node scratchpad/gen_folha_afastamento_parcial.js` | 7 contagens por arquivo nas 4 cópias da geração de folha |

Transpile antes do primeiro:

```bash
npx tsc src/utils/afastamentoParcial.ts src/utils/afastamentos.ts \
  src/utils/folha/afastamentosDia.ts --outDir scratchpad/_sim --module commonjs --target es2020
```

**Validado em homologação contra o banco real** (9 de 9): escala preservada no parcial, relançamento
aceito, RPC de 7 args liberando, `{M}+{T}` voltando a apagar e a recusar, integral apagando e
recusando, férias `{M,T}` sobre turno `N` continuando a apagar, e afastamento por horas intacto.

## O caso concreto da Luana continua em aberto

A migration não ressuscita `escala_diaria` apagada. Para os dias 25 e 27 aparecerem na folha dela:

1. aplicar a migration em produção;
2. reabrir a competência 08/2026 da DMAC (a grade está **inativa por prazo**, em modo de
   visualização);
3. lançar `MT` nos dias 25 e 27 na grade e salvar a previsão;
4. sincronizar a folha e preencher os horários da tarde.

⚠️ Ela **não bate ponto em relógio nem terminal** — as marcações dela são sintéticas, de origem
`ajuste_coordenador` (validação manual). Existem inclusive 4 marcações órfãs do dia 25
(08:00/12:00/14:00/18:00) gravadas *antes* de o afastamento apagar a escala; elas descrevem o dia
inteiro, não a tarde, então **não servem** como horário do período trabalhado. O coordenador
precisa informar os horários reais da tarde.
