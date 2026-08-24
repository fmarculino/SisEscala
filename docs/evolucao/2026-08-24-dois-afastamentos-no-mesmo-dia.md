# Dois afastamentos no mesmo dia, e o sistema lia só o primeiro (24/08/2026)

## O relato

KETHURY CHAVES BITARAES DE FREITAS (matrícula T2600016, USF ENFERMEIRA ZEZINHA / AMBULATÓRIO
CLÍNICO), competência 08/2026. No dia **14/08** foram lançados **dois** afastamentos — uma
Declaração de Comparecimento para o período **M** e outra para o período **T**. A tela de
Afastamentos mostra os dois. Nenhuma outra tela mostrava.

- **Folha de ponto**, dia 14: `AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M) | FOLGA`
- **Anexo de ocorrências** (verso da folha, "Observação / Justificativa"): a mesma linha, com o
  mesmo texto — ele deriva de `folha_ponto.registros`, não consulta `servidores_eventos`
- **Grade de escala**: um marcador só na célula do dia

## A causa

Uma linha, repetida em cinco lugares:

```ts
const rawAfastamento = afastamentos?.find(af => dateStr >= af.data_inicio && dateStr <= af.data_fim)
```

`Array.prototype.find` devolve **o primeiro**. O modelo nunca proibiu mais de um evento por
(servidor, dia) — e não deve proibir: uma declaração de comparecimento pela manhã e outra à tarde
são dois fatos distintos, com horários e documentos distintos. O que estava errado era a
**leitura**, não o lançamento: as duas linhas sempre estiveram em `servidores_eventos`.

O modo de falha é silencioso dos dois lados. Quem lança vê os dois na tela de Afastamentos; quem
lê a folha vê um. Ninguém recebe erro.

## Onde estava, e onde passou a estar

| sítio | antes | agora |
|---|---|---|
| `executeGerarFolhaPonto` | `.find()` | `afastamentosDoDia()` |
| `sincronizarFolhaPonto` | `.find()` | idem |
| `gerarFolhaPontoServidor` (portal) | `.find()` | idem |
| `sincronizarFolhaPontoServidor` (portal) | `.find()` | idem |
| `ScaleGrid.getActiveEventForDay` | `.find()` | `getEventosDoDia()` |
| `encontrarAfastamentoBloqueante` | `.find()` | `encontrarAfastamentosBloqueantes()` |

Fonte única nova: **`src/utils/folha/afastamentosDia.ts`**. Ela também recolhe
`getAfastamentoNome` / `getAfastamentoObservacao` / `isShiftOverlappingAfastamento`, que estavam
**duplicados** entre `folha-ponto/actions.ts` e `consultar-escala/actions.ts` — mais duas cópias
que podiam divergir e ainda não tinham divergido.

As quatro cópias da geração foram alteradas por script com contagem de ocorrências
(`scratchpad/aplica_afastamentos_multiplos.js`), e a grade por
`scratchpad/aplica_afastamentos_grade.js`, que aborta se qualquer trecho alvo não bater exatamente.

## Decisões

⚠️ **Ordem é do relógio, e o desempate é pela descrição — não pela ordem de chegada.** As quatro
consultas a `servidores_eventos` não têm `ORDER BY`, então a ordem do PostgREST não é garantida.
Sem desempate determinístico, regerar a mesma folha duas vezes poderia trocar a ordem do texto
impresso num documento que o servidor assina. Integral vem primeiro, depois pela hora de início
(a do relógio quando é por horas; a do período quando é por slot).

⚠️ **Bloqueio continua binário; só a EXIBIÇÃO virou plural.** `encontrarAfastamentoBloqueante`
sobrevive como envelope de `[0]` e continua servindo os quatro sítios da grade que só precisam
saber *se* bloqueia (digitação na célula, aviso da linha, Aplicar Template, Gerador Inteligente).
Trocar a semântica do bloqueio não fazia parte do problema.

⚠️ **A célula da grade não tem largura para dois rótulos.** Ela mostra a sigla do primeiro e
`+N` para o resto (`VIS+1`) — o tooltip lista todos por extenso. Mostrar só o primeiro, como
antes, é exatamente o que fez o coordenador concluir que o segundo lançamento tinha se perdido.

⚠️ **Descrições repetidas não são fundidas.** Dois eventos do mesmo tipo saem como
`DECLARAÇÃO DE COMPARECIMENTO (M) + DECLARAÇÃO DE COMPARECIMENTO (T)`, e não como
`DECLARAÇÃO DE COMPARECIMENTO (M, T)`. É mais verboso e é **um item por lançamento** — em
documento comprobatório, fundir dois registros num rótulo esconde que houve dois.

## O que isso NÃO faz

**A folha é um snapshot** (armadilha da seção "A folha é um snapshot" do `CLAUDE.md`):
`folha_ponto.registros` é jsonb, não uma view. As folhas já geradas continuam com o texto
antigo até alguém clicar em **Sincronizar** naquela competência. Nenhuma migration foi
necessária e nenhum dado foi alterado — o conserto é de leitura.

Nenhum horário muda. `registro.afastamento` passa a descrever todos os eventos que anulam o
turno, mas a condição de anular o dia é a mesma de antes (basta um evento cruzar os slots do
turno), então a contagem de horas normais e de faltas não se move.

## Extensão medida em produção (24/08/2026)

Autorizado pelo usuário. Varredura de **todas** as 164 linhas de `servidores_eventos`, expandidas
dia a dia por data civil (`scratchpad/mede_afastamentos_duplicados.js`, leitura pura):

| pares (servidor, dia) com mais de um afastamento | 1 |
|---|---|
| competência | 08/2026 |
| quem | KETHURY CHAVES BITARAES DE FREITAS (T2600016), 14/08/2026 |
| folhas a sincronizar | 1 (`3d70d28c-417a-4293-bf68-b4973519c5f5`, status **Rascunho**) |

**O caso relatado é o único da base.** Nenhuma competência Fechada é afetada, e a única folha
atingida ainda é rascunho — nada de reabrir competência.

Antes e depois conferidos contra o registro real da folha:

```
folha HOJE       -> "AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M) | FOLGA"
apos SINCRONIZAR -> "AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M) + DECLARAÇÃO DE COMPARECIMENTO (T) | FOLGA"
```

## Achado colateral: o dia 14 virou FOLGA, e isso não é bug desta correção

Os oito eventos de KETHURY em 08/2026 se repartem em dois modos:

| dia | tipo | modo | efeito na escala |
|---|---|---|---|
| 05, 12, 19 | Visita Domiciliar | integral | bloqueia o dia |
| 07, 21 | Estudo da Plataforma | **horas** 14:00–18:00 | **não** bloqueia — o dia segue escalado |
| 10 | Declaração de Comparecimento | **horas** 17:00–18:00 | idem (folha mostra `08:13 às 16:51`) |
| **14** | Declaração de Comparecimento **×2** | **slot** `M` e slot `T` | limpou o turno `MT`; o dia ficou sem Regular |

A Declaração de Comparecimento por **horas** (armadilha 14, migration `20260817210000`) existe
justamente para o servidor continuar escalado no resto do dia — é o que aconteceu no dia 10. No
dia 14 os dois lançamentos foram por **período**, e período bloqueia: `M` + `T` cobriram o turno
`MT` inteiro, `fn_clean_conflicting_shifts` limpou a linha e a folha passou a ler o dia como FOLGA.

Isso é o comportamento projetado, não um efeito da leitura por `.find()` — e continua igual depois
da correção. Se a intenção era "compareceu de manhã e à tarde, mas trabalhou o resto do dia", o
lançamento certo é **por horas**, como no dia 10. `tipos_eventos` não tem coluna que force o modo
(conferido: só `nome`, `cor`, `descricao`, `ativo`), então a escolha é do operador a cada
lançamento — decisão do usuário, não algo a corrigir em código sem que ele peça.
