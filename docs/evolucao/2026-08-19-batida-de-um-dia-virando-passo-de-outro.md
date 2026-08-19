# A batida de um dia virando passo de outro (19/08/2026)

## O relato

O coordenador da TI bateu o ponto na manhã de 19/08 e a folha dele saiu assim:

| dia | entrada | saída int. | retorno int. | saída |
|---|---|---|---|---|
| 18 | 07:34 | 12:34 | 14:54 | **21:20** |
| 19 | **21:20** (do dia 18) | **08:23** | — | — |

A batida real da manhã (08:23) virou *saída para o intervalo*, e a *entrada* do dia 19 passou a
ser a batida de saída da véspera. A mesma marcação ficou gravada em dois dias.

## O que foi medido em produção antes de mexer

`fn_alocar_marcacoes_dia`, chamada direto (é `STABLE`, não escreve):

```
=== 2026-08-19   bloco Regular 08:00 -> 18:00, intervalo 12:00/14:00
  ALOC entrada          prev 19/08 08:00  dist 640  marc 24e9f07e…   <- batida de 18/08 21:20
  ALOC intervalo_saida  prev 19/08 12:00  dist 217  marc a3235a48…   <- batida de 19/08 08:23
  PEND passo_sem_marcacao intervalo_retorno / saida

=== 2026-08-18   bloco Regular 08:00 -> 18:00
  ALOC saida            prev 18/08 18:00  dist 200  marc 24e9f07e…   <- a MESMA marcação
```

E a cascata vinha de antes: o dia 17 estava gravado com `intervalo_retorno` e `saída` vindos das
batidas do dia 18 — resíduo do teto de 1440 min que a `20260819120000` corrigiu ontem.

## As duas causas

**1. Nada impedia um passo de casar com batida de outro dia civil.** O teto de 720 min
(`20260819120000`) é metade do período da escala, então *toda* batida entre 20:00 e 24:00 da
véspera alcança o slot de entrada das 08:00 do dia seguinte. 640 ≤ 720: passou.

**2. O DP prefere quantidade a qualidade.** O custo de não casar é `v_tol_ontem * 2`, sempre
maior que o pior casamento aceito (`<= v_tol_ontem`). Casar 640 + 217 custa 857; casar só a
batida certa (23) e deixar uma pendente custa mais. O algoritmo escolheu casar as duas.

**3. (o que torna as duas visíveis) A alocação roda por dia e nenhum dia sabe do outro.** Cada
`fn_reconciliar_marcacoes_dia` grava só o seu dia; o dia 18 já tinha a batida das 21:20 como
saída quando o dia 19 a tomou como entrada. Ninguém sobrescreve ninguém — as duas ficam.

## A correção — `20260819180000`

Duas regras, nenhuma delas um número novo para calibrar:

**Piso de meia-noite.** Um passo nunca casa com batida anterior à meia-noite do dia civil em que
o **bloco** daquele passo começa. Chegar cedo nunca significa chegar no dia civil anterior; se
aconteceu, é anomalia para o coordenador ver, não alocação silenciosa. Blocos que cruzam a
meia-noite não são afetados — o piso é o do *início* do bloco, então um plantão 18:00 → 06:00
continua aceitando batida das 05:50 na saída.

**Regra do dono.** A batida pertence ao dia cujo passo previsto está mais perto dela. Os passos
dos blocos dos dias vizinhos que não entram nos slots do dia viram *sombras*: nunca recebem
alocação, só desqualificam candidatas que são do vizinho. O desempate (slot mais antigo vence no
empate exato) faz os dois dias chegarem a decisões opostas — exatamente um fica com a batida,
**independente da ordem em que forem reconciliados**.

Gerada por `scratchpad/gen_dono_e_piso.js`, cópia mecânica de `20260819120000` (armadilha 1).

## A medição (agosto/2026 real, 272 servidores, 6.774 blocos previstos)

`scratchpad/simula_variantes_alocacao.js` reproduz o DP do SQL passo a passo:

| variante | batida em 2 passos | dias impossíveis | dias que mudam |
|---|---|---|---|
| hoje (só teto 720) | 62 | 3 | — |
| + piso | 34 | 0 | 32 |
| **+ piso + dono (esta)** | **15** | **0** | **55** |
| + custo de pular = teto/2 | 13 | 0 | 58 |

**Zero alocações plausíveis perdidas**: nenhum passo que tinha batida a ≤ 120 min do previsto
ficou sem batida.

**A quarta linha foi simulada e descartada.** Corrige 2 duplicações a mais e quebra três dias
saudáveis — entre eles uma jornada matutina cuja entrada real (06:57, a 3 min do previsto)
passava a ser recusada. Não aplicar sem evidência nova.

Exemplos do que muda (todos com o mesmo padrão do relato):

```
WILKENS DA MOTA FRANCO — 04/08
  HOJE : 03/08 19:06 -> 04/08 19:06   (24,1 h)
  NOVO : 04/08 07:22 -> 04/08 19:06   (11,7 h)

LUCILIA LIMA AZEVEDO — 17/08
  HOJE : 17/08 12:32 -> 18/08 06:37   (18,1 h)
  NOVO : 17/08 06:57 -> 17/08 12:32   ( 5,6 h)
```

## O que esta correção NÃO resolve (medido, não suposto)

Restam 15 casos de batida em dois passos, de dois tipos — nenhum deles o bug acima:

- **Batida de transição entre blocos encostados.** Noturno 18:00 → 07:00 seguido de plantão
  07:00 → 19:00: a batida das 07:00 fecha um e abre o outro. É o comportamento desejado, já
  descrito na armadilha 6 do `CLAUDE.md`.
- **Instabilidade de bloco que cruza a meia-noite.** Ele é alocado tanto ao processar o dia dele
  quanto o dia seguinte, e o conjunto de slots concorrentes difere entre as duas execuções — o
  resultado gravado passa a depender de qual dia foi reconciliado por último. Não corrompe dia
  isolado. Fica como pendência conhecida.

## O segundo bug, que escondia a correção do primeiro

Aplicada a migration e reconciliada a `escala_diaria`, **a grade ficou certa e a folha continuou
errada** — e "Sincronizar" não adiantava.

`folha_ponto.registros` é um **snapshot jsonb**: não lê `escala_diaria` na hora de exibir. Quem
leva o horário da escala para a folha é a geração/sincronização — e as quatro cópias dela
preservavam **tudo** que já estivesse preenchido:

```ts
const shouldPreserve = true                 // executeGerarFolhaPonto, gerarFolhaPontoServidor
const shouldPreserve = !scaleChangedForDay  // sincronizarFolhaPonto(+Servidor) — o mesmo, quando
                                            // a escala não mudou, que é justamente este caso
```

O comentário acima da linha dizia *"Check manual edits in existing record to preserve them"* — a
intenção era preservar **edição humana**, mas o código preservava também o valor derivado da
escala. Consequência: horário corrigido no banco **nunca mais** chegava à folha.

**A correção** é `src/utils/folha/preservacao.ts`, fonte única usada pelas quatro cópias:

| origem do campo | o que acontece ao regerar/sincronizar |
|---|---|
| `manual`, `ajuste_coordenador`, `ajuste_servidor` | **preserva** — alguém decidiu aquilo |
| `real`, `pre_assinalado`, nulo, ausente | **regera** a partir de `escala_diaria` |

Preservar `real` parece conservador ("não mexer em batida"), mas é o oposto: `real` é exatamente
o valor que a `escala_diaria` manda, e congelá-lo impede a folha de receber a correção de uma
batida mal alocada. Batida real continua protegida onde importa — `salvarFolhaPonto` recusa que
quem não é `super_admin` **altere** um horário de origem `real`.

Quatro cópias, um critério só, pelo mesmo motivo que criou `sequenciaDia.ts`: elas já divergiram
entre si antes. Trocadas por `scratchpad/aplica_preservacao.js`, que aborta se a contagem de
ocorrências divergir (16 = 4 campos × 4 cópias).

## Como aplicar

1. Aplicar `supabase/migrations/20260819180000_dono_da_batida_e_piso_de_meia_noite.sql`.
   **Só troca a função — não escreve nenhum dado.** Já validada em homologação
   (`sisescala-dev`): compila, executa e roda em 1,6 ms por chamada mesmo consultando quatro
   dias de blocos em vez de dois.
2. `node scratchpad/portao_dono_piso.js` — **dry-run**, lista todo dia cujo horário gravado
   diverge do que a projeção nova produz. Ler a lista antes de seguir.
3. `node scratchpad/portao_dono_piso.js --aplicar` — reconcilia esses dias. Isto **mexe em ponto
   já projetado**: é passo separado e deliberado.
4. A `folha_ponto` já gerada não se atualiza sozinha — usar "Sincronizar" na folha do servidor.
   **Isso só funciona a partir do deploy que traz `src/utils/folha/preservacao.ts`**; antes dele,
   sincronizar preservava o valor errado.

## Resultado da aplicação (19/08/2026)

Migration aplicada em produção pelo usuário; reconciliação rodada em agosto/2026 com
`portao_dono_piso.js --aplicar`: **104 dias reconciliados, 0 falhas**. Uma segunda conferência
acusou 7 dias que não convergem — são o caso conhecido do bloco que cruza a meia-noite, alocado
tanto no dia dele quanto no seguinte (por isso o script roda em ordem crescente de data e
reconfere; a terceira rodada não muda mais nada).

Caso que originou tudo, depois da reconciliação:

| dia | antes | depois |
|---|---|---|
| 17 | 08:09 → 12:34 (do dia 18) | 08:09 → 22:22 |
| 18 | 07:34 → 21:20 | 07:34 → 21:20 (inalterado) |
| 19 | **21:20 (do dia 18)** → int. 08:23 | **08:23**, demais passos pendentes |
