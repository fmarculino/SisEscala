# Plantão diurno em jornada noturna — âncora espelho, não-fusão e batida de transição

**Data:** 09/08/2026
**Migration:** `20260809000000_night_double_shift_anchor_and_transition_punch.sql` — **aplicada em produção em 09/08/2026**
**Gerador:** `scratchpad/gen_dobra.js` (cópia mecânica; aborta se qualquer contagem divergir)

## Conferido depois de aplicar

Sonda de leitura em `fn_blocos_previstos_dia` (produção, 09/08/2026), ILMAR:

```
2026-08-08  #1 Plantão 06:00 -> 18:00  int 10:00-11:00
            #2 Regular 18:00 -> 06:00  int 22:00-23:00
2026-08-16  #1 Plantão 06:00 -> 18:00  int 10:00-11:00
            #2 Regular 18:00 -> 07:00  int 22:00-23:00   (ainda com a 1h de Extra)
```

Bate exatamente com `scratchpad/sim.js` nos dois dias — inclusive na diferença entre eles, que é a
Extra removida no dia 8 e mantida no 16. O simulador foi conferido **contra a função viva**, não só
contra si mesmo.

## O caso

Dois agentes de portaria da **USF ENFERMEIRA ZEZINHA** têm jornada Regular `18H ÀS 06H` e foram
escalados com um **Plantão MT** (12h) no mesmo dia. A intenção do coordenador:

> chega às **06:00**, cumpre o plantão até as **18:00**, e às 18:00 emenda o turno normal dele,
> que vai até as **06:00** do dia seguinte.

Uma dobra de 24h — **duas jornadas de 12h**, não uma de 24h. O sistema não se comportava assim.

## Por que quebrava

A cadeia de precedência de horário (CLAUDE.md, armadilha 4) tratava plantão como **sequência do
expediente**. O nível 2 (âncora do dicionário, `MT = 07:00`) só vale quando **não há** Regular no
dia; havendo Regular, a cascata legada alinhava o plantão pelo **início** da jornada. Com jornada
noturna isso dá 18:00 — o plantão inteiro sobreposto ao Regular:

| linha | como resolvia | janela cobrada |
|---|---|---|
| Regular `N` | regex do nome da jornada | 18:00 → 06:00 (+1) ✓ |
| Plantão `MT` | **mesmo regex do nome da jornada** | 18:00 → 06:00 (+1) ✗ |
| Extra `1` | ancorada no fim do Regular | 06:00 → 07:00 (+1) |

Como `v_s2_inicio (1080) <= v_s1_fim (1800)`, os três fundiam em **um bloco 18:00 → 07:00**.

No terminal, passo a passo:

| momento | o que acontecia |
|---|---|
| 06:00 | nenhum passo casa (entrada cobra 17:30–18:30). `fn_registrar_ponto` grava a batida como marcação **pendente de revisão**. Nada entra na folha. |
| 18:00 | casa como **ENTRADA** e grava 18:00 nos **três** registros. As 12h já trabalhadas desaparecem. |
| 06:00 (+1) | o bloco fecha às 07:00 por causa da extra — a batida de saída também cai fora. |

Dois agravantes encontrados no mesmo diagnóstico:

- `ORDER BY start_hour` ficava **empatado** (Regular e Plantão ambos em 18), então qual dos dois
  era o "primeiro" do bloco era indefinido — e é isso que decide quais horários a
  `fn_salvar_saida_bloco` fabrica no checkout.
- `fn_salvar_saida_bloco` é de 06/07/2026 e **nunca recebeu os níveis 1 e 2** da ancoragem de
  08/08/2026: para o `MT` devolvia `slots[1]='M' → 07:00`, divergindo da janela que o próprio
  terminal tinha cobrado. **As duas funções já discordavam entre si.**

## Medido em produção (09/08/2026, leitura)

```
jornadas que cruzam a meia-noite:   2 de 17   ("18H ÀS 06H", "19H ÀS 07H")
escala_mensal com jornada noturna:  8 de 319

combinações que convivem com Regular de jornada noturna:
   105x  18H ÀS 06H | reg=N | Extra:1
     8x  18H ÀS 06H | reg=N | Extra:1 + Plantão:MT   ← os casos afetados
     1x  18H ÀS 06H | reg=N | (só Regular)
```

Os 8 casos: **2 servidores, 1 unidade, todos em 08/2026, nenhum com presença gravada nem
confirmada.** A mudança é inteiramente prospectiva, **sem backfill**. Não existe caso irmão com
plantão noturno.

⚠️ Existe um padrão **vizinho, e ele não é alcançado por esta migration**: MARCOS SOUSA SANTOS e
UILSON LEI PEREIRA DE SOUZA têm MT em dia **sem** Regular, precedido de noite. Ali o nível 2 vale
(âncora 07:00) e nada muda. Como a janela de saída de ontem (06:30–07:30, por causa da extra) se
sobrepõe à de entrada do MT, esses dias exigem **duas batidas** por volta das 07:00 — a primeira
fecha ontem, a segunda abre hoje. A batida de transição desta migration é **intra-dia**; a
travessia entre dias fica como pendência.

## O que a migration faz

### 1. Nível 2-A: âncora espelho da jornada noturna

Quando o Regular do dia cruza a meia-noite (`end_hour < start_hour`) e o plantão declara período
diurno (`slots[1] IN ('M','T')`), o plantão ancora no **fim** da jornada, não no início. A "manhã"
de quem faz noite começa quando a noite dela terminaria: `MT → 06:00`.

Entra **acima** do nível 2 — a âncora fixa do dicionário (`MT = 07:00`) não conhece a jornada do
servidor e erraria por uma hora. **Abaixo** do nível 1: o coordenador continua podendo informar a
hora e vencer tudo. Efeito colateral desejado: acaba o empate do `ORDER BY` (6 < 18).

A cadeia passa a ter 5 níveis:

| nível | fonte | quando |
|---|---|---|
| 1 | `escala_diaria.hora_inicio_prevista` | o coordenador informou |
| **2-A** | **fim do Regular do dia** | **Regular cruza a meia-noite + plantão diurno** |
| 2 | `dicionario_turnos.horario_inicio` | não há Regular no dia |
| 3 | regex sobre `jornadas.nome` | Regular |
| 4 | cascata legada | último recurso |

### 2. O plantão diurno de dobra não funde com nenhum bloco

A unidade tem `permite_marca_intervalo = true` e `tipo_intervalo = rigido`, e a jornada de 12h tem
`intervalo_minutos = 60` — cada uma das duas jornadas tem intervalo próprio. **Um bloco carrega um
intervalo só** (`v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)`), então fundir as
duas apagaria o intervalo da segunda: 12h seguidas sem repouso registrado, em unidade que exige
marcação.

O guard tem a mesma forma dos guards de Sobreaviso de `20260807000000` e cobre os **12 sítios de
fusão** das três funções. **Regular + Extra continuam fundindo** — a extra *é* sequência do
expediente.

### 3. Batida de transição

Fechado um bloco, se o bloco seguinte começa no mesmo instante em que este termina e ainda não tem
entrada, a **mesma batida** abre o próximo. O horário gravado é a **batida real**, nunca o
previsto. Sem isso o servidor teria de bater duas vezes no mesmo minuto, e quem esquecesse a
segunda deixaria a jornada seguinte sem entrada.

### 4. `fn_salvar_saida_bloco` passa a enxergar os níveis 1 e 2

É ela quem fabrica os horários de transição de um bloco com vários turnos. Enquanto derivar por
conta própria, divide o bloco num horário que o terminal nunca cobrou.

## Resultado

Antes e depois, simulados sobre agosto/2026 inteiro em produção (`scratchpad/sim.js`):

```
dias-servidor avaliados: 3290
  inalterados: 3282
  ALTERADOS:   8

  antes : 18:00->31:00 int 22:00-23:00 [Plantão:MT+Regular:N+Extra:1]
  depois: 06:00->18:00 int 10:00-11:00 [Plantão:MT] | 18:00->31:00 int 22:00-23:00 [Regular:N+Extra:1]
```

Sequência de batidas que o terminal passa a cobrar no dia da dobra:

| hora | passo |
|---|---|
| 06:00 | entrada (plantão MT) |
| 10:00 | saída para o intervalo |
| 11:00 | retorno do intervalo |
| 18:00 | **transição** — saída do MT **e** entrada do Regular, ambas com a hora real |
| 22:00 | saída para o intervalo |
| 23:00 | retorno do intervalo |
| 07:00 (+1) | saída |

## O que ficou de fora

1. **A 1h de Extra dos dias de plantão.** Ela é ancorada no **fim** do Regular, ou seja
   06:00–07:00 do dia **seguinte**: no dia da dobra o servidor iria de 06:00 do dia D às 07:00 do
   dia D+1 — **25h seguidas** — e é ela que mantém o fechamento do bloco às 07:00 em vez das 06:00.
   Tirar a extra desses 8 dias é ajuste de escala na grade, **decisão do coordenador**. Feito isso,
   o bloco 2 fecha às 06:00, que é a hora em que a pessoa vai embora.
2. **O ramo do nível 3 dentro de `fn_salvar_saida_bloco`** (regex do nome da jornada). Essa
   divergência é anterior e alcança dias já validados; mexer nela sem medir mudaria folha fechada.
3. **A travessia entre dias** (batida de transição do cursor de ontem para o de hoje) — ver o aviso
   na seção de medição.
4. **A dobra de 24h em si.** Ela estoura a interjornada de 11h; o motor de compliance aponta, e é
   correto que aponte. É decisão administrativa, não defeito de software.

## Frontend

- `complianceEngine.ts` ganhou `fimDeJornadaNoturna()` e passou a receber a jornada por servidor:
  `getShiftStartHour`/`getShiftEndHour` espelham a âncora 2-A. Sem isso a grade calcularia
  interjornada sobre um horário que o terminal não cobra mais.
- `ScaleGrid.tsx` ganhou `permiteHoraInicio` ao lado de `precisaHoraInicio`. O coordenador passa a
  poder informar a hora **também em código ancorado** — é a válvula de escape do nível 1 para a
  exceção que nenhuma regra prevê. O banco já aceitava; era a grade que não deixava. Em código
  ancorado a célula mostra em cinza o horário que o **banco** prevê
  (`fn_blocos_previstos_mes`, mesma fonte do terminal), e clicar sobrepõe.

## Como conferir depois de aplicar

```sql
-- os 8 dias passam a ter DOIS blocos, o primeiro comecando as 06:00
SELECT ed.dia, b.bloco_ordem, b.inicio_previsto, b.fim_previsto,
       b.intervalo_inicio_previsto, b.intervalo_fim_previsto
  FROM public.escala_diaria ed
  JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
  CROSS JOIN LATERAL public.fn_blocos_previstos_dia(em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia)) b
 WHERE em.mes = 8 AND em.ano = 2026
   AND ed.categoria = 'Plantão'
   AND EXISTS (SELECT 1 FROM public.escala_diaria r
                WHERE r.escala_mensal_id = ed.escala_mensal_id AND r.dia = ed.dia
                  AND r.categoria = 'Regular')
 ORDER BY ed.dia, b.bloco_ordem;

-- nada mais mudou
SELECT * FROM public.fn_conferir_reconciliacao(2026, 8);
```
