# A batida de uma unidade virando ponto na escala de outra (08/09/2026)

## O relato

Uma coordenadora abriu duas abas lado a lado e viu o mesmo problema dos dois ângulos.

**JEOSEANE CAVALCANTE NASCIMENTO (mat. 67689)** tem duas escalas em 09/2026: Regular no **CRISMU**
(`07H ÀS 16H`) e Plantão no **HMI**. No dia 7 ela não cumpriu o expediente do CRISMU — foi fazer
plantão no HMI, no mesmo horário. Bateu o ponto lá.

E o SisEscala **validou o horário regular dela no CRISMU**, onde ela não pôs os pés.

> *"o sistema tem que ser capaz de identificar as marcações do relógio na unidade correta, não tem
> como uma pessoa registrar um horário em uma unidade e ser inserido na escala de outra unidade"*

Está certa. E o dado que resolveria isso já existia, correto, desde sempre.

## O que o banco mostrou

Todas as batidas do dia 7 dela são do `REP-iDClass-HMI-02`:

| hora | relógio | gravado como |
|---|---|---|
| 07:01 | HMI-02 | saída do plantão do dia 6 (HMI) ✅ |
| **07:14** | **HMI-02** | **entrada do Regular no CRISMU** ❌ |
| **12:59** | **HMI-02** | **retorno do intervalo no CRISMU** ❌ |
| **14:03** | **HMI-02** | **saída do Regular no CRISMU** ❌ |
| 19:00 | HMI-02 | entrada do plantão `N` (HMI) ✅ |
| **06:54 (dia 8)** | **CRISMU** | **saída do plantão do HMI** ❌ |

Cruzamento nos dois sentidos. E como a batida das 06:54 no CRISMU foi levada para o HMI, a
**entrada do dia 8 no CRISMU ficou vazia** — o erro se propagando para o dia seguinte.

`marcacoes_ponto.unidade_id` estava certo o tempo todo: para origem `rep` ele vem de
`dispositivos_rep.unidade_id`, o equipamento físico. **Nenhuma das duas funções que decidem a
presença o consultava.**

## Dois defeitos, não um

**A — o casamento batida↔passo era só proximidade de horário.** Em `fn_alocar_marcacoes_dia`, a
busca de candidatas filtra por servidor, origem e janela de tempo; os slots não sabiam a que
unidade pertenciam. O Regular do CRISMU prevê 07:00, ela bateu 07:14 no HMI, casou com 14 minutos
de distância.

**B — o bloco fundia turnos de unidades diferentes.** Este não estava no relato, e é o pior.
`fn_blocos_previstos_dia` e `fn_confirmar_presenca` listam os turnos do dia filtrando por servidor,
mês, dia e categoria — nunca por unidade. Dois turnos encostados de unidades distintas viravam
**um bloco só**.

A fronteira interna de um bloco tem os dois slots previstos no **mesmo instante** — a saída do
turno que fecha e a entrada do que abre — e o desempate é por ordem de inserção, não por lugar.
Então as duas batidas da virada **trocam de lado**:

```
MARIA DA CONCEIÇÃO (mat. 1272), 01/09/2026
  BLOCO 1 Plantão @ HMI + USF-DAA : 07:00 -> 18:00 | intervalo: NENHUM
  batidas reais: 06:07 HMI | 12:10 HMI | 12:20 DAA | 18:10 DAA

  gravado:  Plantão HMI  entrada 06:07 [HMI]   saída 12:20 [USF-DAA]   <- trocado
            Regular DAA  entrada 12:10 [HMI]   saída 18:10 [USF-DAA]   <- trocado
```

Ela saiu do HMI às 12:10 e entrou na USF-DAA às 12:20. O sistema inverteu exatamente as duas do
meio, e repetiu em 01, 03 e 08/09 — não é acaso, é o desenho.

Note o `intervalo: NENHUM`. Um bloco carrega **um intervalo só** (armadilha 6 do `CLAUDE.md`):
fundir 6h no HMI com 6h na USF-DAA produzia 11h contínuas sem intervalo previsto.

## Medição

Base inteira, 08/09/2026 — 37.017 linhas de `escala_diaria`, 25,6 mil marcações referenciadas:

| | |
|---|---|
| passos preenchidos por batida de outra unidade | **15** (8 pares, 4 pessoas) |
| pares (servidor, dia) com escala em 2+ unidades | **25**, todos em 09/2026 |
| desses, que **fundiam** unidades | **18** |
| passos de origem `terminal` com unidade divergente | **0** |
| escalas de 09/2026 em unidade sem relógio | **0** |
| folhas geradas para os afetados | **nenhuma** |

⚠️ **Produção é viva.** A mesma medição deu 18 passos de manhã e 15 à tarde, porque a coordenadora
mexeu na escala no meio do trabalho. Reconfira antes de decidir com base em qualquer número daqui.

Os 4 passos de 08/2026 são do **administrador do parque** testando relógios no CEI e na USF-JBB —
os dois casos que a armadilha 13 já registrava como "continuam na folha".

## A correção

| migration | o que faz |
|---|---|
| `20260908140000` | o **bloco** não funde turnos de unidades diferentes (12 sítios de fusão) |
| `20260908150000` | o **casamento** batida↔passo não atravessa unidade |
| `20260908160000` | `fn_marcacoes_mes` devolve o **lugar** da batida, para a tela rotular |

Nada foi redigitado: `scratchpad/gen_bloco_unidade.js` e `gen_alocacao_unidade.js` fazem a cópia
mecânica e **abortam** se qualquer contagem divergir.

### Quatro decisões

**Proibir, não penalizar.** Casamento entre unidades diferentes tem custo infinito, não alto. Com
penalidade a troca volta sempre que não houver candidata melhor, e o preço de errar é ponto de
servidor público em folha.

**Só para `origem = 'rep'` com `dispositivo_id`.** Em origem `terminal`,
`marcacoes_ponto.unidade_id` é a **lotação** do servidor (`fn_registrar_ponto` lê
`servidores.unidade_id`), não o lugar da batida — aplicar a regra ali derrubaria o ponto do
Servidor Externo, lotado em A e escalado em B. Mesmo campo, significado diferente por origem.

**Nunca descartar batida.** O cursor de candidatas continua sem filtro de unidade: a batida é
lida, disputa o DP e, se não casar, vira pendência de tipo próprio `outra_unidade` — que a aba
Pendências já lista sozinha, filtrando por `m.unidade_id`, ou seja, para quem cuida da unidade
**onde a pessoa bateu**.

**As duas metades andam juntas.** Sem rótulo na tela, a correção trocaria um erro silencioso por
outro: a batida some da presença, aparece na lista do modal idêntica às demais, e o coordenador a
devolve à folha sem saber que foi feita a quilômetros dali. Daí a terceira migration e o
`bateu em <unidade> · <relógio>` em vermelho no modal de validação manual. **Na dúvida, não
acusa**: só se afirma "outra unidade" quando os dois lados são conhecidos e diferem.

## Validação

Homologação, cenário sintético revertido por `RAISE EXCEPTION`, **nos dois sentidos cada**:

```
Bloco     A) turnos contíguos em unidades DIFERENTES → 2 blocos, 0 mistos
          B) os mesmos turnos na MESMA unidade       → 1 bloco com 2 turnos
Alocação  A) batida no relógio de OUTRA unidade → 0 alocações + 1 pendência outra_unidade
          B) batida no relógio da PRÓPRIA       → 1 alocação
```

O sentido B importa tanto quanto o A: proibir demais quebraria Regular + Extra + Plantão
emendados, que é o caso dominante e a razão de a fusão existir. As conferências dentro das
migrations **executam** as funções e abortam nos dois sentidos.

## Depois de aplicar

Correção de dados por lista fechada com ensaio antes/depois
(`scratchpad/fix_batida_outra_unidade.mjs`), nunca em massa: **15 → 8 passos**, e os 8 restantes
são exatamente os deixados de fora de propósito. Nenhum campo passou de correto para errado.

### O efeito colateral: escala com previsto sobreposto

Separar os blocos **expôs** um caso que a fusão escondia. MARIA, 01/09: Plantão `M` no HMI
07:00–13:00 e Regular na USF-DAA 12:00–18:00 — **1h de sobreposição no previsto**. Ela saiu 12:10
e entrou 12:20, mas os slots ordenados por instante ficam `12:00 (entrada DAA)` antes de
`13:00 (saída HMI)`, e o alinhamento é **monotônico**: casar as duas exigiria cruzar.

Resultado: a entrada da DAA fica certa (12:20) e a saída do plantão do HMI vira pendência, com a
batida real das 12:10 disponível no modal — do próprio HMI, sem rótulo vermelho, a um clique.

**Não é regressão.** Antes o bloco único escondia a sobreposição ao custo de gravar dois horários
**falsos**. Agora um campo fica correto e o outro fica vazio-e-visível.

**A raiz é a escala, não a alocação**: 18 fronteiras sobrepostas, todas em 09/2026, de **2 pessoas
só** — 60 min na MARIA (plantão até 13:00 e regular desde 12:00) e 660 min na JULIANA. Ajustada a
escala, o DP casa sozinho. `scratchpad/an_blocos_sobrepostos.mjs` mede.

## O terceiro defeito, que é de cadastro

**JULIANA DOS SANTOS RODRIGUES GONÇALVES (mat. 68184)** faz plantão noturno no HMI e expediente
diurno na SMS/REGULAÇÃO. A escala está **certa** (`Regular N` no HMI + `Plantão M@08:00` na SMS) —
mas a jornada dela é `07H ÀS 19H`, e o nível 3 da cascata resolve `Regular` por **regex sobre o
nome da jornada** (armadilha 4). O previsto do `N` sai **07:00→19:00, invertido**:

```
05/09  bloco Regular @ HMI : 07:00 -> 19:00     ← e ela entra às 19:08
```

E isso engole as batidas da SMS: em 09/2026 o Plantão dela na SMS está com **todos os passos
vazios**, apesar de ela bater lá todo dia útil. Agrava que `Regular` **não aceita**
`hora_inicio_prevista` (constraint `chk_hora_prevista_nao_regular`) — não há como informar a hora
na célula. O conserto é a jornada, `19H ÀS 07H`.

Por isso ela ficou **fora** da lista de reconciliação: reconciliar contra previsto invertido troca
um erro por outro.

⚠️ Registro de uma leitura errada minha, para quem for reabrir isto: na primeira análise afirmei
que "a escala Regular no HMI descreve algo que não acontece" e que era caso de RH. Inferi da
jornada sem olhar o turno lançado. O turno é `N` e está correto — quem está errada é a jornada.
Olhar o previsto, não o nome.
