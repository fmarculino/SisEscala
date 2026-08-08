# Ancoragem de horário dos plantões — diagnóstico e plano

**Data:** 08/08/2026
**Status:** Plano — nada implementado. **Fase 0 (censo em produção, somente leitura) CONCLUÍDA em 08/08/2026.**
**Origem:** servidora LUCILIA LIMA AZEVEDO (CAF, jornada regular `13H ÀS 19H`) não conseguiu
registrar a entrada de um plantão `MT` no dia 08/08/2026. Tentativa às 07:34:26 negada.

---

## 1. O que aconteceu com a LUCILIA (causa exata)

No dia 08/08 ela tem **só o plantão `MT`** — a linha `13H ÀS 19H` está com `-` nesse dia.
`MT` é, no mundo real, 07:00–19:00.

`fn_confirmar_presenca` calcula o `start_hour` do plantão por uma cascata de `COALESCE`
(20260807050000, linhas 353–390). Para `MT`:

| # | regra | resultado |
|---|---|---|
| 1 | `codigo LIKE 'T%' OR slots[1]='T'` | falso (`slots[1]='M'`) |
| 2–3 | `codigo LIKE 'N%' OR slots[1]='N'` | falso |
| 4 | `codigo LIKE 'M%'` **E** hora de início do turno **Regular do dia** entre 12 e 15 | `fn_obter_horario_regular_dia` retorna **NULL** — não há Regular no dia 08. `NULL BETWEEN` → não dispara |
| 5 | `codigo LIKE 'T%'` … | falso |
| 6 | **`substring(j.nome from '^([0-9]+)')`** | `j` é a **jornada contratual da servidora**, `13H ÀS 19H` → **13** |

Ou seja: o plantão `MT` foi ancorado às **13:00**, e o fim em `13 + horas_computadas (12)` = **01:00**.
O bloco previsto virou **13:00 → 01:00**. A janela de entrada é `início ± 30 min` = **12:30–13:30**.
A batida das **07:34** caiu 326 minutos fora. Daí o `Entrada Faltante`.

**A regra nº 6 usa o horário da jornada regular da pessoa para ancorar um plantão que não tem
nada a ver com a jornada dela** — que é exatamente a queixa.

### Confirmação empírica (homologação, 169 dias-servidor com plantão)

Rodei `fn_blocos_previstos_dia` (função consultável, `STABLE`, sem escrita) em todos os dias com
plantão de homologação e comparei com a leitura canônica e com a regra do frontend:

```
61x  MT semReg (jor 07H ÀS 16H) => backend 07:00-19:00   ✅ (por coincidência)
21x  M  +Reg   (jor 13H ÀS 19H) => backend 07:00-19:00   ✅ M em 07-13 encadeado
21x  T4 +Reg   (jor 07H ÀS 13H) => backend 07:00-17:00   ✅ T4 em 13-17 encadeado
20x  T4 +Reg   (jor 08H ÀS 14H) => backend 08:00-18:00   ✅ T4 em 14-18 encadeado
 9x  MT semReg (jor 18H ÀS 06H) => backend 18:00-06:00   ❌ deveria 07:00-19:00
 8x  MT semReg (jor 13H ÀS 19H) => backend 13:00-01:00   ❌ ← CASO LUCILIA
 6x  MT semReg (jor 08H ÀS 14H) => backend 08:00-20:00   ❌
 6x  MT semReg (jor 07H ÀS 13H) => backend 07:00-19:00   ✅ (coincidência)
 4x  MT semReg (jor 08H ÀS 18H) => backend 08:00-20:00   ❌
 4x  MT semReg (jor 08H ÀS 12H) => backend 08:00-20:00   ❌
 3x  MT semReg (jor 07H ÀS 19H) => backend 07:00-19:00   ✅ (coincidência)
 2x  MT +Reg   (jor 07H ÀS 16H) => backend 07:00-19:00   ✅
 1x  MT semReg (jor 19H ÀS 07H) => backend 19:00-07:00   ❌
 1x  M  +Reg   (jor 19H ÀS 07H) => backend 19:00-07:00   ❌ M deveria ser 07-13
 2x  N  +Reg   (jor 08H ÀS 18H) => 1 caso vira bloco único 07:00-19:00  ❌
```

**~33 de 169 dias-servidor (20%) têm janela de presença materialmente errada só em homologação.**
E os 70 casos de `MT` que funcionam **funcionam por acidente**: a jornada da pessoa começa às 07:00,
então a regra nº 6 acerta o número certo pelo motivo errado.

---

## 1-B. Censo em produção (08/08/2026, somente leitura, autorizado)

Base: `escala_diaria` = **6.514 linhas** (06, 07 e 08/2026), 319 escalas mensais, 184 servidores,
16 unidades. Paginação por header `Range` (armadilha 8). Nenhuma escrita.

### Volume real

**527 dias-servidor com Plantão.** Dos 64 códigos do dicionário, **apenas 13 são usados em
produção** — 48 nunca foram usados uma única vez:

```
3576x Regular/MT   1074x Regular/M    594x Regular/T    333x Plantão/MT   277x Extra/2
 158x Regular/N     147x Extra/1       81x Plantão/T4    65x Plantão/T     51x Regular/T4
  42x Regular/M4     40x Sobrea./N12   37x Plantão/M     24x Sobrea./D12    5x Plantão/M2N
   3x Sobrea./MTNS    2x Plantão/N      1x Extra/MT       1x Plantão/N4     1x Plantão/M7
   1x Plantão/N6      1x Plantão/M4N

NUNCA USADOS: 1.5 1.5N 1N 2N I IT4 M1 M2 M3 M3N M4I M5 M5N M6 M7N M8 M8N MN MT3 MT4
              MT4N MT5 MT7 MT8 MTN N1 N10 N11 N2 N3 N5 N7 N8 N9 T1 T2 T2N T3 T3N T4N
              T5 T5N T6 T7 T7N T8 T8N TN
```

Isso **reduz drasticamente o escopo**: a Classe A que importa é `MT`, `M`, `T`, `N`. A Classe B
que importa é `T4`, e residualmente `N4`, `N6`, `M7`. A Classe C ambígua se reduz a `M2N` (5x)
e `M4N` (1x).

### Divergência medida

Rodei `fn_blocos_previstos_dia` (é `STABLE`, não escreve) nos 527 dias. Isolando os casos em que
o plantão está **sozinho no bloco** — aí o início do bloco *é* o início do plantão, sem
contaminação de fusão:

| | |
|---|---|
| Plantões Classe A sozinhos no bloco | **346** |
| **Desses, com horário errado** | **138 (40%)** |
| Servidores atingidos | **26** |
| Já com entrada gravada (folha derivada de janela errada) | 95 |
| Sem entrada (a pessoa não conseguiu bater) | 43 |
| Em agosto/2026 — **competência ainda aberta** | **46** (39 sem entrada) |

```
 44x  MT  jor=08H ÀS 18H  => sistema 08:00-20:00  | correto 07:00-19:00
 25x  MT  jor=18H ÀS 06H  => sistema 18:00-06:00  | correto 07:00-19:00
 23x  MT  jor=08H ÀS 12H  => sistema 08:00-20:00  | correto 07:00-19:00
 22x  MT  jor=13H ÀS 19H  => sistema 13:00-01:00  | correto 07:00-19:00   ← LUCILIA
  8x  MT  jor=08H ÀS 14H  => sistema 08:00-20:00  | correto 07:00-19:00
  8x  M   jor=08H ÀS 18H  => sistema 08:00-14:00  | correto 07:00-13:00
  3x  T   jor=08H ÀS 18H  => sistema 08:00-14:00  | correto 13:00-19:00
  2x  T   jor=14H ÀS 18H  => sistema 14:00-20:00  | correto 13:00-19:00
  1x  MT  jor=14H ÀS 18H  => sistema 14:00-02:00  | correto 07:00-19:00
  1x  MT  jor=12H ÀS 18H  => sistema 12:00-00:00  | correto 07:00-19:00
  1x  MT  jor=10H ÀS 14H  => sistema 10:00-22:00  | correto 07:00-19:00
```

Confirma que a variável determinante é a **jornada contratual da pessoa**, não o código do turno.
Os 190 casos que acertam acertam porque a jornada delas começa às 07:00.

Um caso é especialmente ruim: **`MT` + Regular `N` (jornada 18H ÀS 06H) + Extra `1`, 8x** — o
plantão `MT` de 12h é ancorado às 18:00, **exatamente em cima do turno Regular**, e desaparece
dentro do mesmo bloco. 12 horas de plantão viram zero janela própria.

### Dano concreto: batidas reais recusadas

`logs_tentativas_presenca` tem 964 linhas em produção. Aplicando o filtro canônico de
`fn_batidas_reais_recusadas` (armadilha 7: exige `servidor_id` **e** mensagem de janela/erro
interno) → 416 tentativas que provam presença. Cruzando com os 138 dias de janela errada, e
mantendo só as que estão **longe da janela do sistema (>60min) e perto da correta (≤60min)**:

**16 batidas reais foram recusadas por este bug**, de 6 servidores:

```
FERNANDA VIEGAS DANTAS DOS SANTOS  MT jor=08H ÀS 14H  08/08 06:07 06:22 06:29 06:48 06:59
LUCILIA LIMA AZEVEDO               MT jor=13H ÀS 19H  08/08 06:37 06:38 07:34 07:34
LUCIA LAYANE ROSA SAMPAIO          T  jor=08H ÀS 18H  11/07 12:02 12:02 18:11
LAUREN MONTEIRO MINUZZI            MT jor=08H ÀS 18H  08/08 06:36 06:56
MARCOS SOUSA SANTOS                MT jor=18H ÀS 06H  19/07 07:27
JESSICA FERREIRA BARROS            MT jor=13H ÀS 19H  25/07 07:46
```

**Hoje, 08/08/2026, três servidoras não conseguiram registrar a entrada do plantão:** LUCILIA,
LAUREN e FERNANDA. Não é um caso isolado — é o padrão do dia.

Observação: `escala_prevista_inicio`/`fim` ficam **NULL** quando a mensagem é
`Fora da janela de presença permitida.` (só as mensagens `Fora da janela de ENTRADA/SAÍDA`
preenchem). Isso limita a auditoria pelo log e vale corrigir junto.

---

## 2. A causa estrutural: três motores de inferência que discordam entre si

O horário de início/fim de um turno agendado **não está gravado em lugar nenhum**. Confirmado:

- `dicionario_turnos` → `id, codigo, descricao, horas_computadas, tipo, slots, ativo`. Sem hora.
- `escala_diaria` → sem `hora_inicio`/`hora_fim`. Só `dicionario_turnos_id` + `categoria`.

Então o horário é **re-inferido em três lugares independentes, com regras diferentes**:

| # | onde | regra |
|---|---|---|
| 1 | `fn_confirmar_presenca` (terminal) + a cópia `fn_blocos_previstos_dia` | cascata de 20 linhas com `LIKE 'M%'`, `slots[1]` e alinhamento à jornada Regular |
| 2 | `fn_confirmar_presenca_manual` | cópia da nº 1 |
| 3 | `ScaleGrid.tsx` → `getShiftStartHour` / `getShiftEndHour` (linhas 537–575) | prefixo do código → `M*`=7, `T*`=13, `N*`=19. **Sem nenhum alinhamento.** |

Para a LUCILIA a grade desenha `MT` em **07:00–19:00** (regra 3) enquanto o terminal exige
**13:00** (regra 1). O coordenador vê uma coisa e o terminal cobra outra — não há como
alguém descobrir isso pela tela.

**Em homologação, backend e frontend divergem em 76 dos 169 dias-servidor com plantão (45%).**

### Duas armadilhas menores no mesmo trecho

- **`slots[1]` não é o primeiro período cronológico.** No dicionário: `MT` → `["M","T"]`, mas
  `MT4` → `["T","M"]`, `M2N` → `["N","M"]`, `MT4N` → `["N","T","M"]`. A ordem do array é
  arbitrária. Toda regra que lê `slots[1]` é uma moeda ao ar.
- **`turno.horario_inicio` / `turno.horario_fim` já são lidos por `ScaleGrid.tsx:1451-1463`,
  mas essas colunas não existem no banco.** É um ramo morto que sempre cai no fallback — ou
  seja, o frontend **já foi escrito prevendo** que o dicionário teria hora. Isso baixa o custo
  da solução proposta abaixo.

---

## 3. O dicionário tem 64 códigos, e eles não são todos do mesmo tipo

Essa é a razão pela qual "melhorar a heurística" nunca vai fechar. Levantei os 64 códigos ativos
e eles se dividem em duas classes com naturezas diferentes:

### Classe A — o código determina a âncora (não precisa adivinhar)

| código | h | leitura |
|---|---|---|
| `M` | 6 | 07:00 → 13:00 |
| `T` | 6 | 13:00 → 19:00 |
| `N` | 12 | 19:00 → 07:00 (+1) |
| `MT` | 12 | 07:00 → 19:00 |
| `MT3` `MT4` `MT5` `MT7` `MT8` | 9,10,11,13,14 | 07:00 → 07:00 + h (manhã cheia, tarde truncada/estendida) |
| `TN` | 18 | 13:00 → 07:00 (+1) |
| `MTN` | 24 | 07:00 → 07:00 (+1) |

Para esses, ancorar na jornada da pessoa é **sempre errado**. É a maior parte do volume real
(`MT` sozinho é 104 dos 169 dias-servidor de plantão em homologação).

### Classe B — o código dá duração e período, **não** a âncora

`M1 M2 M3 M4 M5 M7 M8` · `T1 T2 T3 T4 T5 T7 T8` · `N1`…`N11` · `I` · `M4I` · `IT4`

São exatamente o que você descreveu: "`M2` são 2h de plantão que podem se encaixar em qualquer
ponto da manhã", "`T1` é 1h que encaixa em qualquer ponto da tarde", "`N4` estende o expediente
até as 24h". **Essa informação não existe no código do turno. Ela existe na cabeça do
coordenador na hora de escalar.**

Hoje o sistema tenta adivinhar ancorando na jornada Regular do dia — e a intenção está certa
(esses plantões geralmente são sequência do expediente). O que está errado é (a) aplicar isso
também à Classe A, e (b) a forma de encadear (ver 3.1).

### Classe C — ambígua, precisa de decisão sua

Não consegui resolver pelo dicionário nem pelos dados. Ver seção 8.

`MN` (18h) · `M2N M3N M4N M5N M7N M8N` · `T2N T3N T4N T5N T7N T8N` · `MT4N` (22h)

Exemplo do impasse: `M4N` = "MANHÃ: 4HRS, NOITE: 12HRS", 16h. Duas leituras contíguas plausíveis:
`15:00 → 07:00` (as 4h vêm antes da noite) ou `19:00 → 11:00` (a noite emenda na manhã seguinte).
A segunda é a única em que o trecho "manhã" cai de fato de manhã, mas é uma leitura minha,
não um dado. **O fato de eu não conseguir inferir é a prova de que a codificação é lossy** e de
que a âncora precisa ser gravada, não deduzida.

### 3.1 Defeito adicional: turnos encadeados ancoram todos no mesmo ponto

Encontrado na leitura do código, **ainda não reproduzido** (homologação não tem nenhum dia com
Regular + Extra + Plantão simultâneos):

No seu exemplo — Regular `08H ÀS 18H` + 2h Extra + Plantão `N4` — o `start_hour` do **Extra** é
o fim do turno Regular (18h) e o `start_hour` do **`N4`** também cai em 18h (regra nº 3:
`codigo LIKE 'N%'` e `end_hour` do Regular entre 17 e 20). Os dois ancoram **no mesmo instante**
em vez de se encadearem. O bloco fundido fecharia às 22:00 em vez das **24:00** que você
descreveu, e as 2h extras somem da janela.

A ancoragem precisa ser **sequencial** (Regular → Extra → Plantão, cada um começando onde o
anterior terminou), não radial em torno do turno Regular.

---

## 4. Por que não vou propor "melhorar a heurística"

Já foram cinco tentativas nessa direção — `20260704202241`, `20260804040000`, `20260804050000`,
`20260804070000`, `20260804080000` — cada uma somando um `WHEN … BETWEEN x AND y` na cascata.
A cascata hoje tem 20 linhas e continua errando 20% dos dias.

E há um custo escondido: cada rodada dessas exige `CREATE OR REPLACE` do corpo inteiro de
`fn_confirmar_presenca` (~1.030 linhas), que é exatamente a operação que já produziu **seis
regressões reais** (CLAUDE.md, armadilha 1), cinco delas saídas de uma única migration.
Mais heurística = mais recópia = mais risco, para um problema que heurística nenhuma resolve,
porque **para a Classe B a informação simplesmente não está no dado**.

---

## 5. Solução proposta: uma cadeia de precedência, gravada, com fonte única

### 5.1 O modelo

Criar **uma** função — `fn_horario_previsto_turno(p_escala_diaria_id)` → `(inicio, fim, origem)` —
que resolve o horário por precedência explícita, e fazer **todo mundo** chamar ela:

| ordem | fonte | quando preenche | resolve |
|---|---|---|---|
| 1 | `escala_diaria.hora_inicio_prevista` / `hora_fim_prevista` **(nova, NULL por padrão)** | o coordenador digitou na grade ao escalar | Classe B e qualquer exceção |
| 2 | `dicionario_turnos.horario_inicio` / `horario_fim` **(novas, NULL para Classe B)** | cadastro do turno | Classe A |
| 3 | `Regular` → regex sobre o nome da jornada | como hoje | Regular |
| 4 | encadeamento sequencial (fim do turno anterior do dia) | Extra e Plantão Classe B | o caso `N4` até as 24h |
| 5 | a cascata legada, **intacta** | resto | não quebra nada que hoje funciona |

Os níveis 1 e 2 são **dado gravado**, não inferência. O nível 5 permanece como está, então
nenhum caso que hoje acerta passa a errar.

### 5.2 O ponto mais importante do plano

**`fn_horario_previsto_turno` passa a ser a fonte única, e `ScaleGrid.tsx` passa a consumi-la via
RPC em vez de ter a sua própria `getShiftStartHour`.** A divergência grade↔terminal é o defeito
estrutural; corrigir só o cálculo do backend deixaria a grade continuando a mentir.

É o mesmo princípio que o módulo de marcações já adotou com `fn_projecao_marcacoes_dia`
("fonte única compartilhada por reconciliar e conferir") — CLAUDE.md.

### 5.3 Por que isso não é um remendo maior

Porque troca inferência por dado. Depois disso, um plantão novo, exótico ou fora de padrão
(`M2` às 10h da manhã de uma terça específica) deixa de exigir migration: o coordenador digita
o horário na célula. É o fim da categoria inteira de bug.

---

## 6. Plano faseado

Cada fase é independente e reversível. Nenhuma fase depende da seguinte para ter valor.

### Fase 0 — Censo em produção (só leitura) — ✅ **CONCLUÍDA 08/08/2026**

Resultado na seção 1-B. Autorizada pelo usuário, somente leitura via PostgREST, nenhuma escrita.
Escopo confirmado: **138 dias-servidor errados, 26 servidores, 16 batidas reais recusadas, 46
dias em agosto (competência aberta), e apenas 13 dos 64 códigos em uso.**

### Fase 1 — Âncora no dicionário (Classe A) — ✅ **MIGRATION GERADA, aguardando aplicação**

Arquivo: [`supabase/migrations/20260808100000_anchor_plantao_start_hour.sql`](../../supabase/migrations/20260808100000_anchor_plantao_start_hour.sql)

- `ALTER TABLE dicionario_turnos ADD COLUMN horario_inicio time` + `CHECK` de hora cheia.
- Preenche **11 códigos**, todos confirmados pelo usuário em 08/08/2026:
  - período cheio: `MT`=07:00, `M`=07:00, `T`=13:00, `N`=19:00
  - família `M?N` (a noite emenda na manhã seguinte, todos começando às 19:00):
    `MN`→13:00, `M2N`→09:00, `M3N`→10:00, `M4N`→11:00, `M5N`→12:00, `M7N`→14:00, `M8N`→15:00.
    Só `M2N` (5x) e `M4N` (1x) têm uso real — os outros cinco recebem a âncora porque seguem
    a **mesma regra confirmada**, e sem isso o primeiro lançamento de um `M5N` cairia
    exatamente neste bug.
- Os outros 53 códigos ficam `NULL` e mantêm o comportamento atual.
- **Não cria `horario_fim`**: o fim já sai correto de `start_hour + horas_computadas` nos quatro
  (`MT` 07+12=19, `M` 07+6=13, `T` 13+6=19, `N` 19+12=31). Criar uma coluna que o motor ignora
  é exatamente como `justificativa_manual` passou três dias sendo escrita sem existir.
- Nível 2 da cadeia inserido nas **três** funções.

#### ⚠️ Descoberta que mudou o desenho: a âncora só vale quando não há turno Regular no dia

A primeira versão aplicava a âncora indistintamente. A simulação sobre os 527 dias reais mostrou
que isso mudaria **187 dias, não 138** — e os 49 extras são todos casos em que o plantão é
sequência do expediente:

| dias | caso | efeito da âncora irrestrita |
|---|---|---|
| 20 | ANDRESA: Regular `M` (jor 08H ÀS 14H) + Plantão `T` | `T` iria para 13:00, **sobrepondo 1h do turno Regular que só termina às 14:00**. Escala impossível. |
| 20 | ANDRESA: Regular `M` (jor 08H ÀS 12H) + Plantão `T` | quebraria a fusão: de 1 bloco 08:00–18:00 (2 batidas) para 2 blocos (4 batidas) |
| 8 | Regular `N` + Extra + Plantão `MT` | bloco viraria **24h corridas** |
| 1 | Regular `MT` + Plantão `N` | bloco único viraria dois |

Quando há turno Regular no dia, o alinhamento atual **expressa a intenção correta** — é o
"plantão como sequência do expediente" que o usuário descreveu. A âncora entra só onde essa
referência não existe, que é exatamente onde a cascata cai no fallback errado (a jornada pessoal).

Guard na migration: `CASE WHEN fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL THEN ... END`.
**Com a restrição: 144 dias corrigidos, ZERO mudança de fusão, ZERO efeito colateral.**

#### Como foi produzida e verificada

Gerada por `scratchpad/gen_ancora.js` (substitui o `gen_blocos.js` perdido e cobre as **três**
funções de uma vez, removendo a chance de divergirem). O script:

1. extrai cada função da sua versão **vigente** — `fn_confirmar_presenca` de `20260807050000`,
   `fn_confirmar_presenca_manual` de `20260807100000` (**não** a cópia superada que também
   existe em `20260807050000`), `fn_blocos_previstos_dia` de `20260808040000`;
2. confere 21 invariantes **antes** da substituição (14+1+7 guards `<> 'Sobreaviso'`, 10 casts
   `p_categoria::escala_categoria`, 7 `justificativa_manual`, 8 `presenca_entrada_manual`,
   `ORDER BY start_hour ASC`, `fn_jornada_tem_intervalo`, `fn_ajuste_intervalo_flexivel`…);
3. aplica 4 inserções por regex tolerante a indentação (as três funções indentam diferente —
   é o erro que quebrou o gerador de `20260807080000`);
4. **aborta** se qualquer contagem divergir, e reconfere tudo **depois**;
5. exige que nº de âncoras == nº de guards de "sem turno Regular".

`diff` entre antes e depois: **só linhas adicionadas**, nada removido ou alterado.

#### Ajuste no frontend que a Fase 1 exigiu

A âncora do `M?N` **criaria uma divergência nova** na grade se o frontend não fosse ajuntado
junto: `getShiftStartHour('M2N')` caía em `c.startsWith('M')` e devolvia 7, enquanto o backend
passa a devolver 19. A grade desenharia 07:00–21:00 e o terminal cobraria 19:00–09:00 —
**12 horas de diferença**, em 6 dias já escalados (15, 22 e 29/08, LAUREN e FERNANDA).

Corrigido em [`ScaleGrid.tsx:537`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L537)
e `:552` com o teste `/^M[0-9]*N$/`, posicionado **antes** do `startsWith('M')`. A regex não
casa `MTN` nem `MT4N` (têm `T`), que não são ancorados. Conferido: os 11 códigos ancorados agora
dão o mesmo início e fim nos dois lados, 0 divergências.

Os outros dois pontos do `ScaleGrid.tsx` que fixam hora por prefixo (linhas ~2986 e ~3952) são
**exclusivos de Sobreaviso** (`D12 M6 T6 N12 MTNS`), que não recebe âncora — não precisam mudar.

Isso é um remendo pontual, não a Fase 3: a grade continua tendo a sua própria cópia da regra.
A unificação de verdade é a Fase 3.

**Risco declarado:** muda o horário sintético que a validação manual grava em dias ainda não
validados. Não é retroativo — a função só age quando o coordenador valida. Os 95 dias que já
têm entrada gravada mantêm o timestamp que têm; a janela muda, a batida não.

### Fase 2 — Âncora por dia (Classe B) — ✅ **APLICADA E VERIFICADA em 08/08/2026**

Conferência pós-aplicação:

| teste | resultado |
|---|---|
| coluna existe, 0 preenchidas (homolog 1.055 / prod 6.514) | ✅ |
| `13:30` em Plantão | ✅ recusado por `chk_hora_inicio_prevista_hora_cheia` |
| `13:00` em Regular | ✅ recusado por `chk_hora_prevista_nao_regular` |
| `15:00` em Plantão | ✅ aceito |
| **527 dias-servidor de produção, pós-Fase-1 vs pós-Fase-2** | ✅ **526 idênticos**, 1 diferença que **não é regressão**: a escala da FLAVIA no dia 08/08 foi editada no app às 15:11 (`MT` → `T`, id da linha mudou porque o save faz delete+insert) e o novo `13:00–19:00` é o correto para `T` |
| teste funcional do nível 1 (homologação, Plantão `T4` 4h) | ✅ ver abaixo |

```
sem hora informada (cascata)  : 08:00-18:00 (1 bloco, 2 turnos fundidos)
com hora_inicio_prevista=20:00: 08:00-14:00  +  20:00-00:00
revertido para NULL           : 08:00-18:00  (volta ao original)
```

É exatamente o caso relatado: o plantão passa a fechar **à meia-noite**, e vira bloco separado
porque há intervalo de 6h entre ele e o turno Regular.

#### Desenho

Migration: [`20260808110000_add_hora_inicio_prevista_escala_diaria.sql`](../../supabase/migrations/20260808110000_add_hora_inicio_prevista_escala_diaria.sql)
· gerador `scratchpad/gen_hora_dia.js` · UI em `ScaleGrid.tsx`.

- `escala_diaria.hora_inicio_prevista time` + duas constraints: hora cheia, e **proíbe valor em
  `Regular`** — lá o nome da jornada manda, e um valor gravado seria dado morto que aparenta valer.
- Nível 1 da cadeia inserido nas três funções (4 inserções, 26 invariantes conferidos,
  `diff` só com adições, e o gerador **verifica que o nível 1 precede o nível 2**).
- **Sem backfill, de propósito.** Preencher automaticamente reintroduziria a adivinhação que a
  migration existe para eliminar — e o valor inferido ficaria gravado como se fosse decisão do
  coordenador. **Efeito imediato da migration: nenhum**, até alguém preencher pela grade.
- UI: ao lançar `T4`/`N4`/`N6`/`M7` na célula, abre modal pedindo a hora, **pré-preenchida pelo
  encadeamento** (fim do Regular + horas do Extra do dia) — é o caso `08–18 + 2h Extra + N4`,
  que sugere 20:00 e fecha o bloco às 24:00. A célula passa a mostrar a hora, ou `?h` em âmbar
  quando falta. Clicar reabre.
- Quem decide se a célula pede hora é o **banco**, não uma lista no frontend:
  `isTurnoAncorado` lê `dicionario_turnos.horario_inicio`. Ancorar um código novo no dicionário
  já tira o campo da grade, sem tocar em código.

#### Por que hora cheia e não minutos

O motor de blocos trabalha em horas inteiras (`v_start_min := r.start_hour * 60`); aceitar
`13:30` truncaria em silêncio. A `CHECK` faz **falhar** em vez de truncar. Conferido em produção:
as 17 jornadas e todos os turnos do dicionário começam em hora cheia — nenhum caso real é
perdido. Minutos entram na Fase 3, que reescreve as funções de qualquer forma; lá a constraint
cai com um `DROP CONSTRAINT`, sem reescrever função de presença.

#### Divergência pré-existente que a Fase 2 reduz mas não elimina

`getShiftForecastTime` (`ScaleGrid.tsx:1451`) usa a âncora do dicionário **sempre**, enquanto o
backend a aplica só quando não há turno Regular no dia. Num dia de ANDRESA (Regular `M` 08–14 +
Plantão `T`) a previsão da grade mostra 13:00 e o terminal espera 14:00. **Isso já existia antes
da Fase 1** — o frontend sempre usou a hora canônica. Preencher `hora_inicio_prevista` faz os
dois lados lerem o mesmo campo; a eliminação real é a Fase 3.

#### Desenho original (mantido para referência)

- `ALTER TABLE escala_diaria ADD COLUMN hora_inicio_prevista time;`
- Nível 1 da cadeia (precede a âncora do dicionário).
- **UI: o horário é informado na hora de escalar** (decisão do usuário). Ao lançar um plantão
  de Classe B na célula da grade, aparece o campo de horário, pré-preenchido com a sugestão do
  encadeamento (fim do turno anterior do dia) e editável. Visível no tooltip da célula.
- Como a decisão é "na hora de escalar", **não** é preciso construir regra de edição pós-
  fechamento nem trilha de auditoria de alteração — a previsão fecha já com o dado completo.
- A partir daqui `T4`, `N4`, `N6`, `M7` param de ser adivinhação. São os únicos da Classe B com
  uso real em produção (84 lançamentos).

### Fase 3 — Fonte única — ✅ **APLICADA E VERIFICADA em 08/08/2026**

| conferência | resultado |
|---|---|
| lote vs. chamadas individuais (maior setor de 08/2026, 21 escalas, 444 dias-servidor) | ✅ **430 = 430, ZERO divergências** — incluindo `escala_diaria_ids`, campos de intervalo e `permite_intervalo` |
| custo | ✅ **493 ms** numa ida só, contra ~34 s uma a uma (**69×**) |

A igualdade está **provada sobre dados reais**, não assumida. O frontend não precisou de
redeploy: a RPC é chamada em runtime.


Migration: [`20260808120000_add_fn_blocos_previstos_mes.sql`](../../supabase/migrations/20260808120000_add_fn_blocos_previstos_mes.sql)
· frontend em `ScaleGrid.tsx`.

#### O desenho mudou: não extraí `fn_horario_previsto_turno`

O plano original era extrair a cascata de `start_hour` de `fn_confirmar_presenca` para uma
função nova e fazer todo mundo chamá-la. **Descartado.** Extrair aquele `COALESCE` exige
*reestruturar* o corpo da função — exatamente a operação que já produziu seis regressões reais.

E é desnecessário: **`fn_blocos_previstos_dia` já é a fonte única.** Ela nasceu como cópia
mecânica do motor de blocos, e as Fases 1 e 2 a mantiveram em sincronia — as três funções foram
alteradas pelo mesmo script, no mesmo commit. Faltava só poder consultá-la para uma **grade
inteira** de uma vez.

`fn_blocos_previstos_mes(uuid[])` é um `LATERAL` sobre ela. **Zero lógica nova** — o mesmo padrão
que `fn_conferir_reconciliacao` já usa. Por construção, o que a grade desenha é literalmente o
que o terminal vai cobrar; não "uma regra equivalente". Se um dia divergir, o bug está na função
envelopada, nunca no envelope.

**A migration não altera nenhuma função existente.** Cria uma função nova que ninguém chamava.

#### Por que em lote

Medido em produção: a maior grade de 08/2026 tem 21 servidores. Uma chamada por (servidor, dia)
via HTTP daria ~651 chamadas × 52 ms ≈ **34 s** — quase tudo latência de rede. Em lote o
`LATERAL` roda inteiro no servidor. A função percorre só os dias que têm linha em
`escala_diaria`, não `1..31`.

#### O que mudou no frontend

- `getShiftForecastTime` passa a ler o bloco do banco; o cálculo local só roda para célula
  ainda não salva ou se a RPC não respondeu (degrada, não quebra).
- Passo de intervalo nulo é resposta **legítima** (bloco sem intervalo por CLT Art. 71 ou
  unidade sem marcação) — não cai no cálculo local, que inventaria um horário.
- **O salvamento também.** `ScaleGrid.tsx` usava a regra local para gravar os timestamps
  sintéticos de entrada/saída em `escala_diaria`. Ali a divergência não era cosmética: virava
  horário errado gravado. Agora usa o bloco do banco.

#### O que a Fase 3 NÃO cobriu

`getShiftStartHour`/`getShiftEndHour` continuam existindo e sendo usadas pelo motor de
compliance (interjornada/DSR), pela geração de PDF e pela sugestão de encadeamento. Não são as
que causam o descasamento com o terminal, e cada uma tem semântica própria a conferir antes de
migrar. Ficam para uma Fase 3b, se valer a pena.

### Fase 4 — Encadeamento sequencial — ⚠️ **provavelmente desnecessária**

O desenho original era substituir a ancoragem radial (tudo em torno do Regular) por
encadeamento na ordem Regular → Extra → Plantão, dentro do motor.

**A Fase 2 tornou isso quase todo dispensável.** O encadeamento já existe — como *sugestão
pré-preenchida* no modal da grade (`sugerirHoraInicio`), não como comportamento do motor. O
coordenador recebe a hora encadeada pronta e confirma; o resultado é o mesmo, sem tocar na
função de presença.

Isso importa porque a Fase 4 era **a fase de maior risco de regressão** do plano: mexeria no
comportamento que hoje acerta os 81 `T4` e os 37 `M` de produção, dentro da função que já
produziu seis regressões reais (CLAUDE.md armadilha 1).

Trocar "motor adivinha melhor" por "coordenador confirma um palpite bom" elimina o risco e
ainda deixa o dado auditável — fica gravado que **alguém decidiu** aquele horário, em vez de
uma regra tê-lo inferido.

**Recomendação: não executar.** Reavaliar só se o volume de preenchimento manual incomodar na
prática.

### Fase 5 — Recuperar as batidas negadas — ❌ **CANCELADA (decisão do usuário, 08/08/2026)**

Não haverá migration de dados. Depois da Fase 1, as **16 batidas recusadas caem dentro da
tolerância de 90 min** de `fn_batidas_reais_recusadas` (conferido uma a uma), então a validação
normal do coordenador já grava o **horário real** em vez do sintético — com `justificativa_manual`
e `confirmado_por_id`, que uma migration de dados não teria.

Auditoria que sustenta a decisão: verifiquei entradas **e** saídas dos 138 dias de janela errada
contra o horário correto. **Zero timestamps sintéticos divergentes.** Nenhuma folha tem hora
fabricada a partir da janela errada. O dano do bug foi **impedir batidas**, não corromper
horários.

**Junho e julho ficam como estão** (decisão do usuário): competência `Fechada`, folha `Revisada`,
nenhum horário fabricado. Sobram 5 batidas recusadas de 3 servidores (LUCIA LAYANE 11/07,
MARCOS SOUSA 19/07, JESSICA BARROS 25/07) — tratamento administrativo, fora do sistema.

---

## 6-B. Decisões tomadas em 08/08/2026

| # | pergunta | decisão |
|---|---|---|
| 1 | destravar hoje | corrigir a âncora (Fase 1) |
| 2 | leitura canônica | `MT`=07-19, `M`=07-13, `T`=13-19, `N`=19-07 |
| 3 | `M`/`T` com jornada 08h | 07-13 e 13-19 **sempre**, não depende da unidade |
| 4 | Classe B (`T4`, `N4`…) | horário informado **na hora de escalar** |
| 5 | `M2N` / `M4N` | a noite emenda na manhã seguinte → começam às **19:00** |
| 6 | 16 batidas recusadas | **sem migration** — coordenador valida pelo fluxo normal |
| 7 | 92 dias de jun/jul | **nada** — competência fechada, sem horário fabricado |

### Fase 3c — âncoras restantes (`20260808130000`) — pronta, aguardando aplicação

Fecha a armadilha dos códigos nunca usados: eles continuavam no dropdown e cairiam no mesmo
fallback que quebrou a LUCILIA. Migration **só de dados** — nenhuma função é tocada, porque o
mecanismo de âncora existe desde a Fase 1.

Base: a planilha original do sistema, passada pelo usuário em 08/08/2026.

| família | âncora | conferência |
|---|---|---|
| `T?N` (7) | tarde antes da noite, `19h − (duração − 12)` | planilha: "TARDE Xh, NOITE 12h" ✅ |
| `MT?` + `MTN` (6) | 07:00, manhã cheia + tarde de X horas | planilha: "MANHÃ 6h, TARDE Xh" ✅ |
| `I` `M4I` `IT4` (3) | intermediário = **11:00–15:00** | única leitura em que os três fecham contíguos |

Total: **27 códigos ancorados**. `MT4N` fica `NULL` — genuinamente ambíguo e nunca usado.

**Efeito: zero, e a migration aborta se deixar de ser.** Nenhum dos 16 códigos aparece em uma
linha de `escala_diaria` (6.514 linhas). Um guard conta os usos e falha se algum tiver passado a
ser escalado entre o levantamento e a aplicação.

#### O falso alarme do `M?N` — e como se resolveu

A planilha lista `M2N` como "MANHÃ: 2HRS, NOITE: 12HRS", mesma ordem que `T2N` usa
cronologicamente. Isso parecia contradizer a âncora de 19:00 já aplicada, e eu levantei como
possível erro em produção. **Era alarme falso — dei peso demais à ordem das palavras.**

O teste que decide: a noite é fixa 19:00–07:00; a outra parte encosta antes (termina 19:00) ou
depois (começa 07:00). Qual das duas põe o trecho no período que o **nome** dele diz?

| família | encostando ANTES | encostando DEPOIS |
|---|---|---|
| `T?N` | **5 de 7** caem de tarde | 0 de 7 |
| `M?N` | 2 de 7 caem de manhã | **7 de 7** caem de manhã |

`M2N` antes seria 17:00–19:00, que é *tarde*. Depois é 07:00–09:00, manhã de verdade.
A planilha expande as letras na ordem do código (`M2N`), não na ordem do relógio — no `T2N` as
duas coincidem por acaso.

Reforçando: todo código combinado do dicionário é **um bloco contínuo**; e o motor monta blocos
a partir de linhas distintas, nunca divide uma linha em duas — `M?N` como dois blocos não seria
representável. Quem precisar de manhã + noite separadas lança `M2` + `N`, que já funciona.

**Conclusão: a âncora de 19:00 está correta. Nada a reverter.**

### Ainda em aberto (não bloqueia nada)

- **Família `T?N`** (`TN`, `T2N`…`T8N`) — nunca usada em produção. Pela simetria com `M?N`, a
  tarde viria **antes** da noite (`TN`=13:00→07:00, `T4N`=15:00→07:00), mas isso é dedução minha,
  não regra confirmada. Ficam `NULL` até alguém precisar.
- **`MT3` `MT4` `MT5` `MT7` `MT8`** — também nunca usadas. Provavelmente 07:00 + duração
  (manhã cheia, tarde truncada ou estendida). Não confirmadas, ficam `NULL`.
- **`I` / `M4I` / `IT4`** ("intermediário") — nunca usadas, semântica desconhecida.

---

## 7. Regras do sistema que a solução não pode quebrar

Checklist a conferir no resultado de **toda** migration que recriar função de presença:

| # | regra | onde conferir |
|---|---|---|
| 1 | Os **8 guards `<> 'Sobreaviso'`** nas fusões de bloco continuam presentes | `fn_confirmar_presenca`, `fn_blocos_previstos_dia` |
| 2 | `ed.categoria IN ('Regular','Plantão','Extra')` — Sobreaviso fora da montagem de blocos | idem |
| 3 | Sobreaviso **não recebe** `horario_inicio` no dicionário (`D12 M6 T6 N12 MTNS`) — dar âncora a ele reabriria a fusão que `20260807000000` fechou | Fase 1 |
| 4 | As checagens de **acesso** do coordenador (as sem `ORDER BY start_hour`) continuam aceitando Sobreaviso de propósito | `fn_confirmar_presenca` |
| 5 | `CHECK chk_sobreaviso_sem_presenca` intacto | `escala_diaria` |
| 6 | Guard `fn_jornada_tem_intervalo` (CLT Art. 71, > 6h) presente — mudar a janela **muda a duração do bloco** e portanto muda se há ou não intervalo. `MT` em 07–19 = 12h → tem intervalo; em 13–01 = 12h → também. Mas `MT semReg(08H ÀS 12H)` sai de 08–20 para 07–19: conferir caso a caso | ambas as funções |
| 7 | Ramos do intervalo flexível (`fn_ajuste_intervalo_flexivel`, passos 2 e 3 do terminal) preservados | `20260807050000` |
| 8 | `COALESCE(campo, sintético)` e flags `presenca_*_manual` preservados — validação manual **não** pode sobrescrever batida real | `fn_confirmar_presenca_manual` |
| 9 | Os 3 escopos manuais gravam 2/2/4 passos conforme a tabela do CLAUDE.md | idem |
| 10 | Cast `p_categoria::public.escala_categoria` presente | idem |
| 11 | Toda coluna escrita **existe no banco** — conferir nos **dois** ambientes, produção não é superset | armadilha 3 |
| 12 | **Nunca fabricar horário** no módulo de marcações: passo sem marcação vira pendência | `fn_projecao_marcacoes_dia` |
| 13 | `fn_precedencia_origem` aplicada **só** na reconciliação, não replicada no frontend | Fase 3 |

### Procedimento obrigatório ao recriar `fn_confirmar_presenca*`

1. `grep -rln "FUNCTION public.fn_confirmar_presenca" supabase/migrations/ | sort | tail -1`
   para achar a versão vigente (hoje: `20260807050000` para o terminal,
   `20260807100000` para a manual).
2. Gerar a nova migration **copiando o arquivo vigente** e aplicando substituições por script,
   com `diff` de conferência. O script **aborta** se a contagem de ocorrências divergir.
3. Arquivos são **CRLF** — o script precisa tratar.
4. `npx tsc --noEmit` e `npm run build` **não detectam** erro de coluna nem de operador em
   plpgsql. Verificação manual na grade e no terminal é obrigatória.

### ⚠️ Bloqueador operacional

`fn_blocos_previstos_dia` (`20260808040000`) é cópia mecânica de `fn_confirmar_presenca` e o
CLAUDE.md manda regerá-la pelo script `scratchpad/gen_blocos.js`. **Esse script não existe mais
no repositório** — o diretório `scratchpad/` sumiu e `.gitignore` não o cobre. Ele precisa ser
reconstruído **antes** da Fase 1, ou as duas funções vão divergir na primeira alteração e o
portão da Fase 2 do módulo de marcações deixa de valer.

---

## 8. Perguntas — ✅ todas respondidas em 08/08/2026

Ver a tabela de decisões na seção 6-B e os itens que permanecem em aberto (nenhum bloqueante).

---

## 9. Resumo em três linhas

O horário de um turno não está gravado em lugar nenhum — é adivinhado por três motores que
discordam entre si, e um deles ancora o plantão na jornada pessoal do servidor, que é
justamente o dado sem relação com ele. A correção não é uma heurística melhor: é **gravar a
âncora** (fixa no dicionário para os códigos que a determinam, por dia para os que não
determinam) e fazer grade, terminal e reconciliação lerem **a mesma função**.
