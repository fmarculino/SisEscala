# O intervalo do plantão vinha do expediente de quem o fazia

**22/08/2026** — migrations `20260822120000` e `20260822130000`.

## Como apareceu

Um print da grade da **HMI — Hospital Materno Infantil**, agosto/2026, sábado dia 22. Duas
servidoras do RH, o **mesmo turno `MT` de 12h**, lado a lado:

| servidora | jornada | célula do plantão |
|---|---|---|
| AGNES ROCHA PINHEIRO | `08H ÀS 18H` (10h) | com segmentos de intervalo |
| INGRID STEFANI CUTRIM PEREIRA | `07H ÀS 13H` (6h) | **sem** |

A hipótese levantada foi: *"acredito que isso ocorre pelo fato da Ingrid estar no horário
somente pela manhã, mas o plantão é uma coisa independente — ela vai estar trabalhando das 7h
às 19h e precisa bater o intervalo."*

Estava certa, e a mecânica é mais específica do que "o sistema ignora o plantão".

## A mecânica

`fn_jornada_tem_intervalo(duracao, intervalo_minutos)` é a fonte única da regra desde
`20260806000000`. Nos três sítios que montam blocos, ela era chamada assim:

```sql
v_permite_int := COALESCE(r.permite_marca_intervalo, false)
    AND public.fn_jornada_tem_intervalo(v_end_min - v_start_min, r.intervalo_minutos);
```

Os dois argumentos vinham de fontes **diferentes**, e só um tinha sido corrigido para plantão:

| argumento | origem | certo? |
|---|---|---|
| duração (`v_end_min - v_start_min`) | do **turno** quando a categoria não é Regular (`horas_computadas`) → `MT` = 720 min | ✅ |
| `intervalo_minutos` | `COALESCE(j.intervalo_minutos, 60)` — sempre a **jornada Regular do servidor** | ❌ |

E o cadastro fecha a armadilha: **toda jornada de até 6h tem `intervalo_minutos = 0`**, o que é
correto para o expediente dela. Esse zero **anulava o guard inteiro**, qualquer que fosse a
duração do plantão: `fn_jornada_tem_intervalo(720, 0)` = `false`.

Rodado contra produção, `fn_blocos_previstos_dia` para 22/08/2026:

| servidora | bloco | intervalo previsto | `permite_intervalo` |
|---|---|---|---|
| AGNES | Plantão 08:00 → 20:00 | 12:00 → **14:00** | `true` |
| INGRID | Plantão 07:00 → 19:00 | — | **`false`** |

Repare que a AGNES ganhava **120 minutos** — não porque alguém decidiu isso para o plantão, mas
porque é o que a jornada `08H ÀS 18H` dela manda. Os dois lados estavam errados pelo mesmo
motivo: o expediente da pessoa vazando para dentro do plantão.

## O prejuízo já tinha acontecido, com batida assinada do relógio

Em `escala_diaria`, dia 22/08/2026:

| servidora | entrada | saída | origem da saída |
|---|---|---|---|
| INGRID (HMI) | 07:00 (`ajuste_coordenador`) | **14:41** | **`rep`** — AFD NSR 124058 |
| GISELE (LACEM) | 07:04 (`rep`) | **13:00** | **`rep`** |

Duas batidas reais do relógio, em plantões de 12h que iam até 19:00, gravadas como **saída**.
Um plantão ficou registrado como 7h41; o outro como 5h56. **Não havia passo de intervalo para
elas caírem**, e a alocação pôs a batida no único passo que sobrava.

⚠️ **`logs_tentativas_presenca` está vazio para as duas naquele dia.** A falha é silenciosa dos
dois lados: nem a servidora, nem o coordenador têm sinal de que a batida foi para o passo errado.

## Alcance medido

Competências 06–08/2026, `Plantão`/`Extra` com mais de 6h em unidade que marca intervalo —
**380 lançamentos**:

| intervalo previsto | lançamentos | de onde vinha |
|---|---|---|
| **0 min → sem intervalo nenhum** | **106** | jornadas de 4h e 6h |
| 60 min | 206 | jornadas de 8h/9h/12h |
| **120 min** | **68** | jornadas de 10h |

Dos 106: 46 em competência **Fechada** (06 e 07/2026), 60 em Rascunho. **As 22 linhas com batida
real (`rep`/`terminal`) estão todas em agosto/2026, todas em Rascunho** — nenhuma competência
fechada tem batida real nesse grupo.

Concentração: LACEM 89, SMS 12, o resto pulverizado. Códigos: `MT` 102, `TN` 3, `M7` 1.

## A base legal, que decidiu onde o campo deve morar

**Lei 17.331/2008 — Regime Jurídico Único dos servidores de Marabá**, Art. 17:

> **§ 2º** Regulamento disciplinará a jornada de trabalho dos titulares de cargos de provimento
> efetivo cujo exercício exija **regime de turno ou plantão**.

O próprio estatuto **separa plantão da jornada comum** e manda regulamento próprio discipliná-lo.
Isso dá base legal direta ao "o plantão é uma coisa independente" — e significa que o número
precisa ser **cadastrável**, porque quando esse regulamento sair ele trará um número.

Esse regulamento não existe hoje. O parâmetro aplicável subsidiariamente é a **CLT Art. 71,
caput**:

> "Em qualquer trabalho contínuo, cuja duração exceda de 6 (seis) horas, é obrigatória a
> concessão de um intervalo para repouso ou alimentação, o qual será, no mínimo, de 1 (uma) hora
> e, salvo acordo escrito ou contrato coletivo em contrário, não poderá exceder de 2 (duas) horas."

A âncora é **"trabalho contínuo, cuja duração exceda"** — a duração do que foi trabalhado, não o
contrato de quem trabalhou. Um plantão de 12h é trabalho contínuo de 12h, seja de quem for.
`Art. 59-A` (12x36) confirma: o intervalo é **observado ou indenizado**.

## Decisão do usuário sobre a fronteira (22/08/2026)

> "Jornadas de até 6h não devem ter intervalos de ponto — registra só entrada e saída. Ou seja,
> só vai ter intervalo jornada maior que 6h."

Por isso a faixa de **15 minutos** do Art. 71 §1º (acima de 4h e até 6h), que o RJU de Marabá
também prevê no Art. 17 §3º para turnos ininterruptos, **não é implementada** — nem sequer de
forma inerte. `fn_intervalo_minimo_legal` tem duas faixas: acima de 360 min → 60; senão → 0.
Isso mantém a fronteira idêntica à de `fn_jornada_tem_intervalo`, e preserva sem nenhuma
mudança o comportamento de todo o expediente Regular.

## A correção

Três camadas, com papéis distintos:

| camada | onde | papel |
|---|---|---|
| expediente | `jornadas.intervalo_minutos` (já existia) | intervalo do turno **Regular** — está certo onde está |
| plantão | **`dicionario_turnos.intervalo_minutos`** (nova, *nullable*) | intervalo do **turno**. `NULL` = "não regulamentado" |
| piso | **`fn_intervalo_minimo_legal(duracao)`** | a regra do caput, derivada da duração |

Resolvidas em fonte única por **`fn_intervalo_previsto_minutos(cat, dur, jornada, turno)`**:

```
Regular        → GREATEST(jornada.intervalo_minutos,          minimo_legal(duração))
Plantão/Extra  → GREATEST(COALESCE(turno.intervalo_minutos,0), minimo_legal(duração))
```

⚠️ **Só a coluna nova não bastaria.** Dependeria de alguém cadastrar corretamente os 53 códigos
de plantão, e um código esquecido volta a ser o bug de hoje, em silêncio. O piso derivado da
duração é o que torna a regra **impossível de esquecer** — mesma filosofia de
`fn_jornada_tem_intervalo`. Todos os códigos ficam `NULL` de propósito: preencher só serve para
**elevar** acima do piso (o caput admite até 2h), nunca para rebaixar.

Os defaults são diferentes de propósito: `Regular` cai em 60 para preservar exatamente o
`COALESCE(j.intervalo_minutos, 60)` que os cursores sempre usaram quando não há jornada casada;
`Plantão`/`Extra` caem em 0, porque o piso já garante o mínimo pela duração e um default de 60
daria intervalo a turno curto que não tem direito a ele.

### Sítios tocados

| # | função | migration de origem |
|---|---|---|
| 1–2 | `fn_confirmar_presenca` — cursor de ontem e de hoje | `20260819220000` |
| 3 | `fn_blocos_previstos_dia` (propaga para alocação / projeção / conferência) | `20260819220000` |
| 4 | `fn_confirmar_presenca_manual` | **`20260809000000`** — a versão vigente dela é mais antiga |
| + | espelho `src/utils/intervaloIntrajornada.ts`, usado nos 2 sítios de `ScaleGrid.tsx` | — |

⚠️ **A função manual não estava na mesma migration das outras duas.** Corrigir só o lado do
terminal deixaria a validação manual do coordenador ainda gravando 2 passos num plantão de 12h,
e recusando o passo de intervalo com a mensagem *"Jornada de 6h não possui intervalo
intrajornada"* — afirmação falsa sobre um dia de 12h. A mensagem passou a citar a duração do
**turno**, que é quem de fato decide.

Gerado por `scratchpad/gen_intervalo_plantao.js`, cópia mecânica com 24 invariantes estruturais
conferidos e **abortando** em qualquer divergência (armadilha 1). O `diff` contra as fontes
mostra só as substituições pretendidas em ~2.400 linhas.

## O que a correção NÃO muda

- **Horas pagas do plantão.** `horas_computadas` e `decomporPlantao` (unidades PL) não descontam
  intervalo. Ninguém perde PL12 por causa disto.
- **Folha de ponto**, que lê só `Regular` e `Extra`.
- **Jornada Regular de até 6h**, que continua registrando só entrada e saída.
- **Nada é reprocessado.** O intervalo previsto é derivado em runtime por
  `fn_blocos_previstos_dia`, então recriar as funções já corrige a previsão de todo mês, inclusive
  os fechados.

## Simulação sobre produção antes de aplicar

`scratchpad/simula_intervalo_plantao.js` transcreve as funções novas em JS e roda sobre as
**10.152 linhas** reais de `escala_diaria`:

| categoria | transição | linhas |
|---|---|---|
| Regular | COM → COM | 5.871 |
| Regular | sem → sem | 3.122 |
| Extra | sem alteração | 419 |
| **Plantão** | **sem → COM** | **106** |
| Plantão | COM → COM | 273 |
| Plantão | sem → sem | 263 |
| qualquer | **COM → sem** | **0** |

Os 106 que ganham o passo são todos `Plantão` acima de 6h de servidores com jornada de 4h ou 6h —
`MT` (12h) em 102 deles, `TN` (18h) em 3, `M7` (7h) em 1.

### Os 68 que passam de 120 para 60 min

É a única mudança que atinge quem já funcionava. Os dois riscos foram medidos e estão vazios:

- **`servidores.intervalo_flexivel = true` em 0 de 500 servidores.**
  `fn_ajuste_intervalo_flexivel` está inerte em produção, então encurtar o intervalo previsto
  **não antecipa a saída esperada de ninguém**.
- Só **6** dos 68 têm batida de intervalo gravada, e o maior intervalo realmente praticado foi de
  **94 minutos** — nenhum encostou nos 120.

Se o RH decidir que o `MT` merece 2h, agora isso se cadastra **uma vez, no código `MT`**, valendo
para todo mundo — em vez de a AGNES ter 2h e a INGRID nenhuma porque os expedientes delas são
diferentes.

## Pendências deixadas em aberto

⚠️ **As ~22 linhas de agosto/2026 cuja batida real já foi alocada errada continuam como estão.**
Corrigir a função conserta o futuro; o que já está gravado em `escala_diaria` só muda rodando
`fn_reconciliar_marcacoes_dia`. **Não reconciliar em massa** — já foi medido antes que reconciliar
agosto inteiro pioraria mais dias do que corrigiria, porque a projeção nem sempre é melhor que o
que o terminal gravou. O caminho é levar caso a caso ao coordenador da unidade. A consulta que
lista exatamente essas linhas está no rodapé de `20260822120000`.

ℹ️ **As 6 jornadas de 6h com `intervalo_minutos = 0`** (`07H ÀS 13H`, `13H ÀS 19H`, `08H ÀS 14H`,
`12H ÀS 18H`, `10H ÀS 16H`, `17H ÀS 23H`) permanecem como estão, por decisão do usuário. O RJU
Art. 17 §3º e a CLT Art. 71 §1º previriam 15 minutos ali; ligar isso acrescentaria dois passos de
marcação ao expediente diário de muita gente e é decisão de RH/jurídico, não conserto de bug.
