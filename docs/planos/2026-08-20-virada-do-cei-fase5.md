# Virada do CEI para `fonte_ponto_oficial = 'rep'` — Fase 5

Primeira unidade a virar a chave. Roteiro medido em produção em 19/08/2026, competência 08/2026.

## Por que o CEI

O plano original mandava começar por unidade **sem** marcação de intervalo. Esse critério caiu:
as 4 unidades com relógio têm `permite_marca_intervalo = true` (o `CLAUDE.md` ainda diz que a SMS
é `false` — desatualizado). O critério novo é **cobertura de ponto**, e o CEI é o único com 100%:

| unidade | escalados | ok | sem biometria |
|---|---:|---:|---:|
| **CEI** | **17** | **17** | **0** |
| LACEM | 40 | 39 | 1 |
| ENF-ZEZINHA | 50 | 37 | 13 |
| Reg/TI/TFD | 57 | 44 | 13 |
| SMS | 58 | 33 | 24 |
| Almox-Pat-CAF | 45 | 3 | 42 |

`sem_vinculo = 0`, `fora_do_relogio = 0` e `batidas_perdidas = 0` em todas — mas só o CEI não tem
ninguém impedido de bater.

## Pré-requisitos — todos já aplicados

| migration | o que dá |
|---|---|
| `20260820000000` | a coluna `fonte_ponto_oficial` (a chave nunca existiu antes disto) |
| `20260820010000` | criar vínculo aciona reparse + reconcilia só os dias afetados |
| `20260820020000` | escrita direta neutralizada; marcação dispara reconciliação com precedência |

Enquanto toda unidade estiver em `terminal`, as três são inertes.

## Simulação da virada (feita, não estimada)

Comparei, para **todos** os 359 dias-linha do CEI em 08/2026, o que está gravado contra o que a
projeção produziria:

| resultado | pares (servidor, dia) |
|---|---:|
| sem presença nenhuma — nada a fazer | 169 |
| **idênticos** — a virada não muda nada | **169** |
| **mudariam** | **9** |

Os 9 são **todos do mesmo servidor**: LUCAS REIS CAMPOS (58822), que tem
**Regular 08:00–17:00 + Plantão 18:00–00:00 no mesmo dia**.

⚠️ **As 9 mudanças são correções, não perdas.** Exemplo medido no dia 18/08: ele bateu 07:48,
12:35 e 13:13 — todas do Regular, nenhuma do Plantão. O que está gravado hoje replica a batida das
**07:48 na linha do Plantão da noite** (armadilha 6: "a projeção grava o mesmo par em todas as
linhas do bloco"). A projeção nova, corrigida pelas migrations de 19/08, deixa o Plantão vazio —
que é o correto, porque não houve batida nele.

Nos dias 3, 4, 5, 10 e 11 o padrão é o mesmo em outra forma: `ent: 08:00 -> 18:00` move a entrada
do Plantão para o horário em que o Plantão de fato começa.

**Efeito colateral esperado e desejado:** LUCAS passa a ter pendência (saída vazia) onde hoje tem
horário duplicado. É a regra da Fase 5 — dia sem batida vira pendência, nunca horário fabricado.
Avise o coordenador do CEI antes, senão ele lê como defeito.

## Executar

```sql
-- 1. Virar
UPDATE public.unidades
   SET fonte_ponto_oficial = 'rep'
 WHERE id = '2b9f38cb-3e78-4498-bfdc-4a54636f108b';   -- CEI

-- 2. Conferir que virou, e SO ela
SELECT nome, fonte_ponto_oficial FROM public.unidades WHERE fonte_ponto_oficial = 'rep';
-- esperado: 1 linha, CEI
```

Não é preciso reconciliar o mês inteiro para valer — a partir daqui cada batida nova reconcilia o
seu dia sozinha. Os 9 dias do LUCAS só se ajustam se você reconciliar aqueles pares
explicitamente, e isso é decisão à parte (mexe em ponto já registrado).

## O que observar nas primeiras 48h

1. **O terminal não pode dar erro.** O guard neutraliza em silêncio, não aborta. Se alguém do CEI
   relatar erro ao bater, desfaça imediatamente — significa que o desenho de neutralização falhou.
2. **Toda batida vira linha em `marcacoes_ponto`.** Confira que a contagem do dia cresce.
3. **A origem gravada tem que ser a de maior precedência do dia** (rep > terminal >
   ajuste_coordenador > ajuste_servidor). Era exatamente isto que vazava: 41 dias com REP presente
   e entrada gravada como `terminal`, mais 8 como `ajuste_coordenador`.
4. **Pendências sobem, e isso é esperado** — dia sem batida deixa de ganhar horário fabricado.

## Critério objetivo de reversão

Desfaça se **qualquer** um ocorrer:

- servidor do CEI recebe erro ao bater no terminal;
- batida registrada em `marcacoes_ponto` **não** aparece em `escala_diaria` no mesmo dia;
- horário de origem `rep` for sobrescrito por origem inferior (o defeito que a virada existe para
  fechar continuar acontecendo);
- qualquer horário some sem que exista marcação correspondente que explique o vazio.

```sql
-- Reversão: imediata, sem efeito colateral
UPDATE public.unidades
   SET fonte_ponto_oficial = 'terminal'
 WHERE id = '2b9f38cb-3e78-4498-bfdc-4a54636f108b';
```

Reverter **não** desfaz o que a reconciliação já gravou — devolve o terminal à escrita direta
daí em diante. `marcacoes_ponto` é INSERT-only, então nenhuma batida se perde em nenhuma direção.

## Depois do CEI

Ordem sugerida, por cobertura: **LACEM** (39/40) → **ENF-ZEZINHA** e **Reg/TI/TFD** (13
sem biometria cada) → **SMS** (24) → **Almox-Pat-CAF** (42 de 45, precisa de mutirão de
biometria antes).

O gargalo dessas quatro não é código: é **biometria presencial**, 93 servidores no total.
