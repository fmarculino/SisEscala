# Plantão noturno: previsão empilhada no expediente e virada de dia invisível

**Data:** 03/09/2026
**Origem:** dois casos relatados no mesmo dia —
CHARLENE LARCERDA DA SILVA (mat. 69250, HMI/FISIOTERAPIA, 02/09) e
NEURIAN MARIA SANTANA NUNES (SMS/DMAC/REGULAÇÃO, 01/09).
**Estado:** camada 0 aplicada no código e validada; camada 1 escrita, simulada e **aguardando o
usuário aplicar a migration**; camadas 2 e 3 pendentes. Ver "ESTADO DA EXECUÇÃO", no fim.
**Competências 06 e 07/2026 estão Fechadas e não serão tocadas** (decisão do usuário, 03/09/2026).

São **dois defeitos diferentes** que produzem o mesmo sintoma para quem olha a tela ("as
marcações do plantão noturno não fazem sentido"). Tratá-los como um só leva a corrigir a metade
errada.

| | caso A — CHARLENE | caso B — NEURIAN |
|---|---|---|
| onde está o defeito | **banco**: a previsão do plantão | **frontend**: o modal de validação |
| o que quebra | o plantão nasce 07:00–19:00 em vez de 19:00–07:00 | as batidas do outro lado da meia-noite não aparecem, e as que aparecem não dizem de que dia são |
| a previsão do banco está | **errada** | **certa** (19:00 → 07:00+1) |
| risco de correção | alto (funções de presença) | baixo (só exibição e filtro) |

---

# CASO A — o plantão noturno empilhado em cima do expediente

## A.1 O caso, reproduzido

Escala de 02/09: **Regular `M`** (jornada `07H ÀS 13H`) + **Plantão `N`** (12h, âncora 19:00 no
dicionário).

Batidas reais no REP (todas `origem = rep`, nenhuma sintética):

```
06:50   13:00   18:45   21:35   22:35        (02/09)
06:57   07:15                                (03/09)
```

Leitura evidente para qualquer humano: entrou 06:50, saiu do expediente 13:00, entrou no plantão
18:45, intervalo 21:35→22:35, saiu 07:15.

O que ficou gravado em `escala_diaria`:

| linha | previsto **pelo banco** | entrada | saída |
|---|---|---|---|
| Regular `M` | 07:00 → **19:00** (bloco) | 06:50 | **18:45** |
| Plantão `N` | **07:00 → 19:00** | **13:00** | **21:35** |
| Regular `M` do dia 3 | 07:00 → 13:00 | 06:57 | **07:15** |

O expediente de 6h aparece com **11h55** — **~5h55 de hora extra que não existiu**; o plantão de
12h aparece com 8h35 e termina às 21:35; e o dia 3 registra um expediente de 18 minutos.

⚠️ **O servidor não recebeu nenhum sinal.** Nenhuma tentativa recusada, nenhuma pendência,
nenhum alerta de compliance. Silencioso dos dois lados.

## A.2 A causa raiz não é a batida esquecida

`fn_blocos_previstos_dia(CHARLENE, 2026-09-02)` devolve **um único bloco**:

```
inicio_previsto 07:00   fim_previsto 19:00   permite_intervalo FALSE
turnos_inicio [07:00, 07:00]   turnos_fim [13:00, 19:00]
```

O **Plantão `N` foi previsto como 07:00 → 19:00**. Ele nasce em cima do expediente e, por começar
no mesmo instante, **funde** com ele (armadilha 6) num bloco 07:00–19:00 — que, de quebra, herda
`permite_intervalo = false` do expediente de 6h, então o plantão de 12h **perde o passo de
intervalo** e desfaz na prática a correção de 22/08/2026 (armadilha 9).

### Por que a cascata produz 07:00

A resolução de horário do Plantão (armadilha 4) percorre:

| nível | resultado neste dia |
|---|---|
| 1 — `escala_diaria.hora_inicio_prevista` | `NULL` (o coordenador não informou) |
| 2-A — espelho da jornada noturna | não se aplica (`slots[1] = 'N'`; a regra é só para `M`/`T`) |
| 2 — âncora do dicionário (`N` = 19:00) | **bloqueado**: só vale "quando NÃO há turno Regular no dia" |
| 4 — cascata legada, ramos de emenda | nenhum casa (a jornada não começa nem termina entre 17h e 20h) |
| 4 — **último ramo** | `substring(j.nome from '^([0-9]+)')` → `07H ÀS 13H` → **7** |

O último recurso é **o início da jornada Regular**. Para um plantão noturno em dia de jornada
diurna isso não emenda nada: **empilha o plantão em cima do expediente**.

⚠️ A condição do nível 2 existe para *evitar* sobreposição — o comentário dela diz literalmente
"forçar a âncora ali sobreporia o plantão ao turno Regular". Aqui ela produz exatamente a
sobreposição que queria evitar, porque o fallback que ela deixa passar não emenda.

### O DP é o amplificador, não a causa

Com o bloco 07:00–19:00 fundido, `fn_alocar_marcacoes_dia` monta 4 slots
(`07:00 entrada` · `07:00 entrada-fronteira` · `13:00 saída-fronteira` · `19:00 saída`) e o DP
escolhe o alinhamento de menor custo:

```
06:50 → 07:00 (10)   13:00 → 07:00 (360)   18:45 → 13:00 (345)   21:35 → 19:00 (155)
custo 1590   <   descartar as duas do meio: 1440 + 15 + 10 = 2185
```

Como o custo de não casar (`v_tol_ontem * 2` = 720) é sempre maior que o pior casamento aceito
(≤ 360), **casar a seis horas de distância compensa**. Já registrado no CLAUDE.md ("o DP prefere
quantidade a qualidade") e **simulado e descartado** em 19/08/2026 — não é o que se deve mexer.

### A grade e o banco discordam, e ninguém vê

`getShiftStartHour` (`ScaleGrid.tsx`) resolve `N` pela **âncora fixa: 19:00**, sem olhar a jornada
do dia. A grade, o motor de compliance e o PDF enxergam `19:00 → 07:00`; o terminal, a
reconciliação e a folha enxergam `07:00 → 19:00`. **Nenhuma tela mostra o horário que o banco está
usando** — por isso o erro só aparece depois, como hora extra estranha na folha.

## A.3 Extensão, medida em produção (03/09/2026)

Método: `fn_blocos_previstos_mes` sobre as **2.216** escalas mensais ativas (32.345 blocos),
comparando a janela prevista de cada Plantão com a do Regular do mesmo dia.
⚠️ A medição foi refeita depois de bater na armadilha 8 — **o RPC também corta em 1000 linhas**,
em silêncio; lotes de 25 escalas.

**156 linhas de Plantão previstas sobrepostas ao Regular do mesmo dia**, 54 delas já com ponto
gravado, em 5 unidades e 28 servidores.

| competência | casos | | forma | casos |
|---|---|---|---|---|
| 06/2026 (Fechada) | 21 | | início **idêntico** ao do Regular (empilhado) | 139 |
| 07/2026 (Fechada) | 24 | | início dentro da janela do Regular | 17 |
| 09/2026 | 102 | | | |
| 10/2026 | 9 | | | |

Três famílias, com causas diferentes:

| família | casos | causa | a âncora do dicionário resolve? |
|---|---|---|---|
| **A** — código com âncora (`N`, `MT`, `T`, `M`) | 64 | fallback pelo nome da jornada | **sim** |
| **B** — código Classe B (`T4`, `N4`, `N6`, `M7`) | 71 | o código dá duração, não hora; ninguém preencheu o nível 1 | **não** — só o nível 1 resolve |
| **C** — não cabe no dia | 21 | `MT` 12h + Regular `07H ÀS 19H` = 24h previstas; `N` + jornada `19H ÀS 07H` | **não** — é erro de escala |

Os 11 casos de 09/2026 que já têm ponto estão **todos** distorcidos:

```
CHARLENE (69250)   d2  Regular 06:50→18:45 = 11h55 (previsto 6h)    Plantão 13:00→21:35
ELIZANGELA (15857) d2  Regular 07:09→00:32 = 17h23 (previsto 12h)   Plantão MT sem entrada
CARLA C. (1065)    d2  Regular 10:58→18:48 =  7h50 (previsto 4h)    Plantão 15:01→23:02
PAULO R. (31753)   d2  Regular entrada 04:03 sem saída              Plantão T 07:16→19:41
ROSINEIDE (15095)  d1  Regular 07:14→12:12 =  4h57 (previsto 4h)    Plantão sem entrada
FABIANA (29316)    d1  Plantão N sem entrada, saída 19:21           (a ENTRADA virou SAÍDA)
```

**≈16h20 de hora extra aparente e indevida** só nos dias 1–3 de 09/2026.

⚠️ O padrão mais insidioso é o das linhas "sem entrada": a batida real de **entrada** do plantão
noturno (perto das 19:00) é gravada como a **saída** dele, porque o plantão foi previsto para
*terminar* às 19:00. O plantão aparece como cumprido no instante em que estava começando.

### Dimensionamento da família B

| | |
|---|---|
| códigos no dicionário com âncora / Classe B | 27 / 37 |
| linhas de Plantão na base | 3.016 |
| … com `hora_inicio_prevista` preenchida (nível 1) | 580 |
| … de código Classe B **sem** hora informada | 125 |
| … destas, **com Regular no mesmo dia** → empilhamento garantido | **119** |

### Distância dos casamentos (dias 1–3 de 09/2026, 4.024 alocações)

| distância | 0–15 | 16–30 | 31–60 | 61–120 | 121–240 | 241–360 |
|---|---|---|---|---|---|---|
| alocações | 2.566 | 470 | 470 | 307 | 142 | **69** |

**138 casamentos de entrada/saída acima de 90 min** em três dias; 61 acima de 180 min. Batida
casada a 4–6 horas do previsto é sempre suspeita e hoje não é sinalizada em lugar nenhum.
Distância grande em passo de **intervalo** é diferente — em unidade de intervalo flexível é
esperada, e por isso o detector proposto na camada 3 não olha esses passos.

## A.4 O que foi descartado, e por quê

| hipótese | por que não |
|---|---|
| "o servidor esqueceu de bater a saída das 13h" | ele **bateu** — 13:00 está em `marcacoes_ponto`. O erro é de alocação |
| baixar `rep_tolerancia_alocacao_minutos` (360) | fecha este caso e quebra outros; e o teto de 720 já foi medido em 19/08/2026 — baixá-lo desliga `ignora_janela_presenca` |
| mexer no custo de não casar do DP | **simulado e descartado** em 19/08/2026: corrige 2 duplicações e quebra 3 dias saudáveis |
| guard de não-fusão para este caso | não corrige a previsão: o plantão continuaria previsto 07:00–19:00, agora disputando as mesmas batidas em dois blocos. Provavelmente piora |
| fazer a âncora do dicionário vencer sempre | reintroduz o problema de 08/08/2026 (49 dias medidos): com Regular `07H ÀS 17H`, `N` deve emendar às 17:00, não esperar até 19:00 |

---

# CASO B — o modal de validação é cego à virada de dia

## B.1 O caso

NEURIAN, 01/09, **Plantão `N`** sem Regular no dia. Chegou **18:58** e saiu **07:02 do dia 02**.
Aqui a previsão do banco está **certa** (sem Regular no dia, o nível 2 vale e o bloco é
19:00 → 07:00+1) — o defeito é de tela.

O modal "Validar Presença" do dia 1 oferece:

```
Batidas registradas no terminal neste dia:
  [ ] 07:00:00
  [ ] 07:02:00
```

Duas coisas erradas de uma vez:

1. **A batida de saída real (07:02 do dia 02) não está na lista.** As que aparecem são as de
   **07:00/07:02 do dia 01**, que pertencem ao plantão da **véspera (31/08)**.
2. **Sem a data, `07:02` é indecidível.** Num plantão que atravessa a meia-noite, `07:02` pode ser
   a saída deste plantão (dia 2) ou a saída do anterior (dia 1) — e a tela não diz qual.

🚨 O efeito prático é pior que "faltar informação": o modal está oferecendo, como **Saída** do
plantão do dia 1, uma batida que aconteceu **12 horas antes da entrada dele**. Marcada, grava
saída anterior à entrada.

## B.2 A causa, no código

`ScaleGrid.tsx` (~linha 7220) filtra as batidas do modal por **dia civil da célula**:

```ts
const noDiaDaCelula = (iso: string) => {
  const d = new Date(iso)
  return d.getDate() === manualPresenceModal.dia && d.getMonth() + 1 === mes && d.getFullYear() === ano
}
```

- **O critério é o dia civil, não a janela do bloco.** Para um turno que cruza a meia-noite, metade
  das batidas dele está no dia seguinte e é descartada; e as batidas do turno da véspera, que caem
  neste dia civil, entram.
- **A lista renderizada mostra só `HH:MM:SS`**, sem data nem marcador de dia.

✅ **O dado já está no cliente.** `fn_marcacoes_mes` carrega o mês **± 1 dia**
(`20260818090000`), então a batida das 07:02 do dia 2 já foi buscada — é o filtro do modal que a
esconde. **A correção é inteiramente de frontend**, sem migration.

⚠️ Nesse mesmo trecho, `new Date(iso).getDate()` deriva data de domínio **sem fixar fuso**
(armadilha 12). Hoje funciona porque o navegador do coordenador está em `-03`, mas é o padrão que
o projeto já eliminou em 125 sítios. Ao mexer nessa linha, usar `dataISOLocal()`/`src/utils/horario.ts`.

---

# PLANO DE CORREÇÃO

Quatro camadas **independentes**. Cada uma tem valor sozinha e pode ir em release próprio.
Ordem recomendada: **0 → 2 → 1 → 3**, da menor para a maior superfície de risco.

## Camada 0 — a data na tela e a janela certa no modal (caso B)

Só frontend, sem migration, sem tocar em nenhuma função de presença.

| mudança | detalhe |
|---|---|
| **filtrar pela janela do BLOCO, não pelo dia civil** | o modal já tem `blocoDaCelula` (previsto vindo de `fn_blocos_previstos_mes`). Usar `inicio_previsto − tolerância` … `fim_previsto + tolerância` — a **mesma** janela de `fn_alocar_marcacoes_dia` (`v_busca_ini`/`v_busca_fim`), para a tela oferecer exatamente o que a reconciliação consideraria |
| **mostrar a data** | batida fora do dia civil da célula sai como `07:02:00 (+1D)` / `(−1D)`, com a data completa no `title`. `+1D` é a linguagem que a escala já usa; a data crua fica para quem passa o mouse |
| **rótulo de coerência** | batida **anterior à entrada já gravada** não é selecionável para `saida` — hoje o modal permite gravar saída antes da entrada |
| usar `src/utils/horario.ts` | trocar os `new Date(iso).getDate()` por `dataISOLocal()`; o fuso vem de `configuracoes_globais.timezone`, nunca do navegador |

⚠️ **Não filtrar por "só o dia seguinte".** A janela do bloco resolve os dois lados de uma vez —
inclusive o plantão que começa no fim do mês (30/09 → 01/10), que um filtro por dia do mês deixaria
de fora.

## Camada 1 — nível 2-B: âncora que não colide (família A, 64 casos)

Acrescentar à cascata do Plantão, **abaixo** de todos os ramos de emenda da cascata legada e
**acima** do fallback `substring(j.nome from '^([0-9]+)')`, um ramo novo:

> Se o turno tem `dicionario_turnos.horario_inicio` e a janela
> `[âncora, âncora + horas_computadas]` **não se sobrepõe** à janela prevista do Regular do dia,
> use a âncora.

Propriedades que tornam isso seguro:

- **Não altera nenhum dia em que um ramo de emenda casa hoje.** Regular `07H ÀS 17H` + `N`
  continua 17:00; Regular `12H ÀS 18H` + `M` continua 06:00; jornada `18H ÀS 06H` + `MT` continua
  resolvido pelo nível 2-A.
- **Só age onde hoje se cai no fallback pelo nome da jornada** — que é exatamente o empilhamento.
- **A condição de não-sobreposição é o próprio critério que o nível 2 dizia proteger.**
- Fica abaixo do nível 1: hora informada pelo coordenador continua mandando.

⚠️ **Quatro sítios, em duas migrations-fonte diferentes** (o caso de 22/08/2026, armadilha 9):

| função | migration vigente |
|---|---|
| `fn_confirmar_presenca` (cursor de ontem **e** de hoje) | `20260901120000` |
| `fn_blocos_previstos_dia` | `20260822130000` |
| `fn_confirmar_presenca_manual` | `20260822130000` |

Gerar por script que lê **as duas fontes**, confere a contagem de ocorrências e **aborta** na
divergência — modelo `scratchpad/gen_intervalo_plantao.js`. Não redigitar corpo de função
(armadilha 1). Conferir que **os dois blocos `DECLARE`** de `fn_confirmar_presenca` declaram
qualquer variável nova (o erro `42601` de 23/08/2026).

**Espelho no frontend:** `getShiftStartHour`/`getShiftEndHour` já usam a âncora fixa, ou seja já
produzem o resultado certo para a família A. Depois desta camada as duas fontes **convergem** para
o caso dominante — hoje elas divergem em silêncio. Nenhuma alteração necessária ali.

**Portão (antes de aplicar):** rodar `fn_blocos_previstos_mes` sobre as 2.216 escalas ativas antes
e depois, e conferir que
(a) exatamente os 64 casos da família A mudam de janela,
(b) **zero** linhas que hoje não sobrepõem passam a sobrepor,
(c) `Regular` e `Extra` ficam **inteiramente inalterados**.

**Efeito retroativo:** `marcacoes_ponto` é INSERT-only, então basta rodar
`fn_reconciliar_marcacoes_dia` nos dias afetados — as batidas reais são realocadas contra a
previsão certa, sem fabricar nada. A **folha** é snapshot (`folha_ponto.registros`): precisa de
"Sincronizar", e os campos de origem `real` são regerados
(`src/utils/folha/preservacao.ts`), enquanto `manual`/`ajuste_*` continuam preservados.
⚠️ **Competências 06 e 07 estão Fechadas** — reconciliar ali é decisão à parte, não parte desta
correção.

## Camada 2 — exigir a hora quando o código não a dá (famílias B e C, 92 casos)

Fonte única nova no frontend — `src/utils/janelaTurno.ts` — que calcula a janela prevista de uma
célula e responde uma pergunta só: **este Plantão se sobrepõe ao Regular do mesmo dia?**

| situação | resposta |
|---|---|
| código **Classe B** (sem âncora) + Regular no dia | **exigir `hora_inicio_prevista`**: "o código `T4` diz 4 horas, não diz a hora — informe o início" |
| código com âncora, e mesmo com ela a janela sobrepõe o Regular | **recusar**: são duas jornadas no mesmo horário (`MT` 12h + Regular 12h = 24h previstas no dia) |
| não sobrepõe | passa, sem interferência |

⚠️ **Tem de entrar nos quatro caminhos de escrita da grade** — célula, Salvar Previsão, Aplicar
Template e Gerador Inteligente. As armadilhas 14, 23 e 26 são três repetições do mesmo defeito: a
validação existe e só a digitação célula a célula a chama. Pendurar em `conflitoEscala.ts` /
`limiteCargaMensal.ts`, que já rodam nesses quatro pontos.

⚠️ **Sem trigger duro no banco**, pelo motivo registrado na armadilha 26: a decisão aqui é
"informe a hora", e um trigger derrubaria o upsert em lote inteiro do "Salvar Previsão" por causa
de uma célula. A rede de segurança é a camada 3.

⚠️ **Nada retroage sozinho.** As 119 linhas Classe B sem hora que já existem continuam como estão
até alguém abrir a escala — é a camada 3 que as torna visíveis.

## Camada 3 — detector: relatar o que ficou incoerente

Função de conferência (`fn_conferir_alocacao_suspeita(mes, ano, unidade)`), no espírito de
`fn_conferir_reconciliacao`, que devolve **sem alterar nada**:

1. **plantão previsto sobreposto ao Regular** do mesmo dia — o que a camada 2 impede daqui pra
   frente e a camada 1 conserta na família A;
2. **batida de entrada/saída casada a mais de 90 min do previsto** — 138 ocorrências em três dias;
   passos de intervalo ficam de fora de propósito;
3. **duração praticada acima da prevista por mais de 90 min** numa linha de origem `rep` ou
   `terminal` — é assim que "5h55 de extra que não existiu" aparece **antes** de virar folha.

Superfície: aba em `/marcacoes` ou coluna na Folha de Ponto, por competência e escopo. **Não
bloqueia nada** — lista para o coordenador revisar, como a "Cobertura da Escala" fez com o
"bate e não registra".

⚠️ **Relatar o que MUDOU, não o que foi calculado** (armadilha 22): a tela precisa dizer quantos
casos foram encontrados **e** quantos foram filtrados por já terem tratamento
(`marcacoes_tratamentos`) ou validação manual — senão vira um contador em que ninguém confia.

---

## O que não fazer

- **Não remover a condição "só vale quando não há Regular no dia"** do nível 2. Ela continua
  correta; o nível 2-B passa por baixo dela sem desfazê-la.
- **Não mexer no custo do DP, no teto de 720 nem na tolerância de 360.** Os três já foram medidos
  e descartados em 19/08/2026, e o teto está amarrado a `ignora_janela_presenca`.
- **Não fabricar horário** para o passo que ficou sem batida. Slot sem marcação vira pendência,
  nunca timestamp sintético.
- **Não bloquear plantão no mesmo dia do expediente.** É legítimo e comum; o que não é legítimo é
  o plantão ocupar o mesmo horário do expediente.
- **Não reconciliar competência Fechada** como efeito colateral da camada 1.
- **Não resolver o caso B mexendo na previsão.** Ali a previsão está certa; mexer nela para
  "consertar a tela" quebraria o caso que já funciona.

---

---

# ESTADO DA EXECUÇÃO (03/09/2026)

## ✅ Camada 0 — aplicada no código, validada

`src/utils/janelaBatidas.ts` (novo) + `ScaleGrid.tsx`. Portão:
`node scratchpad/sim_janela_batidas.js` — **16/16 casos**.

| mudança | efeito |
|---|---|
| filtro do modal passa a ser **união** do dia civil com a janela do bloco | a saída real do plantão noturno aparece; nada do que aparecia antes some |
| `+1D` / `−1D` ao lado da hora, data completa no `title` | `07:02` deixa de ser indecidível |
| dedup e "já utilizada" passam a ter a **data** na chave | `07:02` do dia 1 não apaga mais `07:02` do dia 2 |
| as batidas do turno vêm primeiro; as que só dividem o dia civil vêm depois, rotuladas | o candidato natural aparece no topo |
| o palpite de passo ignora batida fora do turno | deixa de pré-selecionar a batida errada |
| guarda nova no envio, pelos **instantes reais** | recusa gravar saída anterior à entrada |

⚠️ A guarda nova é necessária porque `avaliarSequenciaPresenca` trabalha em `HH:MM` e, num turno
que cruza a meia-noite, **empurra para "+1 dia"** todo passo menor que o anterior. Correto para
horário digitado; para batida **selecionada** o instante é conhecido, e normalizar esconderia
exatamente o erro que se quer pegar.

## ✅ Camada 1 — migration escrita e simulada, **falta o usuário aplicar**

`supabase/migrations/20260903100000_ancora_do_plantao_que_nao_colide_com_o_regular.sql`
(2.799 linhas), gerada por `scratchpad/gen_ancora_livre.js` — cópia mecânica das duas fontes,
4 substituições, invariantes conferidos por **contagem exata** e conferência estrutural do arquivo.

**Gerador validado com três regressões injetadas** — marcador quebrado, guard de `Sobreaviso`
removido e `dobra_diurna` removido: as três abortam.
⚠️ A primeira versão do gerador só comparava a contagem **antes × depois** e **passou** por uma
fonte corrompida (0 == 0). Conferir o invariante contra um número **esperado** é o que pega fonte
quebrada — que é justamente o caso caro, porque plpgsql só reclama em tempo de execução.

**Portão de efeito** (`node scratchpad/sim_nivel2b.mjs`), rodado contra produção antes de aplicar:

| | |
|---|---|
| fidelidade da réplica da cascata | **3.010 / 3.010 plantões (100%)** — a réplica reproduz o presente, então serve para prever |
| plantões que mudam de horário | **60**, todos em **09/2026** |
| o que muda | `N 7h → 19h` (40, jornada `07H ÀS 13H`) · `N 7h → 19h` (16, `07H ÀS 11H`) · `N 8h → 19h` (3) · `N 10h → 19h` (1) |
| outros códigos | **nenhum** |
| Regular / Extra | **inalterados** — o ramo vive dentro de `CASE WHEN ed.categoria = 'Plantão'` |
| competências fechadas | **nenhuma tocada** |
| desses 60, já com ponto gravado | **9** (dias 1, 2 e 3) |

Depois de aplicar: `node scratchpad/fix_pos_nivel2b.mjs` (ensaio) e `--aplicar`.

## ⏳ Camada 2 — parcialmente existente, e o furo é o de sempre

`precisaHoraInicio` (`ScaleGrid.tsx:1282`) **já** detecta código Classe B em Plantão/Extra e abre o
modal pedindo a hora. Só que o único chamador é `handleCellChange` — **a digitação célula a
célula**. Aplicar Template e Gerador Inteligente escrevem direto no `gridData` e nunca passam por
ali. É a armadilha 14/23/26 pela quarta vez, agora no eixo "hora do plantão".

Falta, então: (a) chamar a checagem nos outros caminhos de escrita e (b) a parte nova — recusar
quando a janela do plantão **sobrepõe** a do Regular do dia (família C).

⚠️ **Fazer isso só DEPOIS de aplicar a camada 1**: 60 dos 156 casos deixam de existir, e construir
a validação contra o cenário antigo é validar contra um estado que vai mudar.

## ⏳ Camada 3 — não iniciada

## Achados extras desta sessão

⚠️ **Reconciliação em massa continua não sendo neutra — remedido em 03/09/2026.** Sobre 09/2026
(1.614 pares servidor/dia com presença): **4 ganhos, 43 trocas, 7 perdas**. Uma das perdas tirava
`16:36 → 12:02` de uma saída já gravada. Bate com o que o CLAUDE.md registrava de 19/08/2026
("corrigia 4 dias e PIORAVA 11"). **Reconcilie por lista fechada, nunca por varredura.**

⚠️ **A reconciliação não é disparada por mudança de escala, e é isso que produz linha órfã**
(caso NEURIAN). A alocação, a projeção e o bloco previsto dela estavam **todos corretos**; o que
faltava era alguém ter rodado a reconciliação depois. `fn_ingerir_afd` reconcilia **o dia da
batida**, e `trg_reconciliar_apos_marcacao` é **inerte** enquanto nenhuma unidade estiver em
`fonte_ponto_oficial = 'rep'` (Fase 5 não ligada). Quando a escala é lançada ou ajustada *depois*
de a batida chegar, ninguém reprojeta.
✅ Corrigido no caso dela em 03/09/2026 (`fn_reconciliar_marcacoes_dia(NEURIAN, '2026-09-02')`):
saída `02/09 07:06` entrou e a entrada subiu de `terminal` para `rep` pela precedência.
✅ Extensão medida: dos 65 turnos que cruzam a meia-noite com um passo faltando em 08–10/2026,
apenas **2 eram recuperáveis** (e são o mesmo evento). Não é epidêmico — mas não tem detecção
nenhuma, e é candidato natural à camada 3.

## Pendências

- Camadas 2 e 3.
- A reconciliação disparada por **mudança de escala** não existe. Decidir se vira gatilho, ação de
  tela ou item do detector da camada 3.
- `fn_confirmar_presenca_manual` **não tem** o guard `dobra_diurna` que as outras duas funções têm
  (0 contra 31 e 17 ocorrências). Divergência anterior a esta correção, fora do escopo dela —
  registrada aqui para não se perder.

## Scripts de medição desta análise

```
scratchpad/q.mjs               cliente REST paginado (lê .env.production)
scratchpad/an_sobrep.mjs       os 156 casos de sobreposição (lotes de 25 — armadilha 8)
scratchpad/an_dano.mjs         o dano concreto nos 11 dias de 09/2026 com ponto
scratchpad/sim_regra.mjs       simulação da regra do nível 2-B sobre os 156
scratchpad/an_perspectiva.mjs  dimensionamento da família B (Classe B sem hora)
scratchpad/an_dist.mjs         distribuição da distância de casamento do DP
scratchpad/an_neurian*.mjs     caso B — investigação e diagnóstico
scratchpad/an_divergencia.mjs  projeção × gravado em 09/2026 (por que não reconciliar em massa)
scratchpad/an_cruza_midnight.mjs  turnos que cruzam a meia-noite com passo faltando
scratchpad/sim_janela_batidas.js  portão da camada 0 (16 casos)
scratchpad/gen_ancora_livre.js    gerador da migration da camada 1
scratchpad/sim_nivel2b.mjs        portão de efeito da camada 1 (réplica 100% fiel)
scratchpad/fix_pos_nivel2b.mjs    reconciliação dos 9 dias, com ensaio
```
