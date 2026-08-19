# Batida de transição entre turnos (19/08/2026)

## O pedido

No anexo de plantões, o plantão aparecia com o horário do expediente regular. A ideia do usuário:
orientar o servidor a **bater a saída do regular e a entrada do plantão** na transição, para que
cada um tenha o próprio horário.

## Por que não funcionava — medido, não suposto

MAISA MIRANDA BASTOS ATAIDE (mat. 32269), 18/08/2026. Jornada `07H ÀS 13H` (Regular M) mais
Plantão `T` com `hora_inicio_prevista = 13:00`. Ela **já fez exatamente isso**: bateu quatro vezes.

```
fn_blocos_previstos_dia → bloco 1 Regular 07:00 -> 19:00  permite_intervalo=false  (2 linhas)
fn_alocar_marcacoes_dia → slots = 2
   ALOC entrada  prev 07:00  dist 4      (07:04)
   ALOC saida    prev 19:00  dist 9      (19:09)
   PEND fora_da_janela  13:07
   PEND fora_da_janela  13:10
batidas: 07:04/rep  13:07/rep  13:10/rep  19:09/rep
```

Duas causas somadas:

1. **Regular + Plantão fundem num bloco só** (armadilha 6) e o bloco tem no máximo quatro passos:
   entrada, intervalo (quando há) e saída. **Não existia passo na fronteira dos dois turnos.**
   Aqui nem os passos de intervalo existiam: jornada de 6h não tem intervalo (CLT Art. 71), então
   o bloco tinha só 2 slots. As batidas do meio não tinham onde cair.
2. **A projeção grava o mesmo par entrada/saída em todas as linhas do bloco** — por isso a linha
   do plantão recebia o horário do expediente (07:04 → 19:09), e era esse o horário que subia
   para o anexo.

## A correção — `20260819200000`

Cada fronteira interna do bloco ganha **dois slots opcionais**: a saída do turno que fecha e a
entrada do turno que abre, ambos previstos no mesmo instante, e ambos gravados na **linha** do seu
turno — não no bloco inteiro.

| função | o que muda |
|---|---|
| `fn_blocos_previstos_dia` | expõe `turnos_inicio[]` / `turnos_fim[]` — o previsto de cada turno fundido, na ordem de `escala_diaria_ids`. **A regra de fusão não muda.** |
| `fn_alocar_marcacoes_dia` | cria os slots de fronteira e **ordena os slots por instante previsto**. Slot opcional sem batida não vira pendência. |
| `fn_projecao_marcacoes_dia` | desempata a favor da alocação de fronteira (específica de uma linha) contra a do bloco (vale para todas). |

⚠️ **A ordenação não é cosmética.** O DP é um alinhamento monotônico: casa a k-ésima batida com o
s-ésimo slot sem cruzar. Os slots de fronteira nascem no fim do array (13:00 *depois* da saída das
19:00) — sem reordenar, o alinhamento fica impossível e a batida de transição seria recusada
exatamente como antes.

Ordem final validada em Postgres real:

```
1  entrada  07:00  (bloco, 2 linhas)
2  saida    13:00  (fronteira → linha do Regular)
3  entrada  13:00  (fronteira → linha do Plantão)
4  saida    19:00  (bloco, 2 linhas)
```

Com as batidas 07:04 / 13:07 / 13:10 / 19:09 o alinhamento fica 4, 7, 10 e 9 minutos — cada passo
com a sua batida.

## O que não muda

- **Quem bate só duas vezes continua igual.** Os slots de fronteira ficam vazios, não geram
  pendência nem horário nenhum. A esmagadora maioria dos dias em bloco contínuo é assim, e isso é
  normal — não é falta.
- **Nada é fabricado.** Sem batida na fronteira, a linha do plantão segue com o horário do bloco,
  como hoje. A Portaria 671/2021 veda marcação automática com horário predeterminado; preencher a
  partir de uma batida real que existe é outra coisa.
- A fusão de blocos, os guards de Sobreaviso e o guard de escopo de `fn_blocos_previstos_dia`
  seguem intactos — conferidos por contagem no gerador.

## Validação feita

- Gerada por `scratchpad/gen_batida_transicao.js` (cópia mecânica; aborta se a contagem divergir):
  17 substituições em `fn_blocos_previstos_dia`, 9 em `fn_alocar_marcacoes_dia`.
- `diff` contra os corpos vigentes: só as inserções pretendidas, nada mais.
- As construções SQL novas (`ARRAY(SELECT … WITH ORDINALITY)`, `unnest` multi-array com
  `ORDINALITY` e `array_agg … ORDER BY`, indexação `(r.campo)[i]`) executadas em Postgres real
  (homologação): compilam e produzem a ordem esperada.
- `fn_blocos_previstos_dia` muda a lista de colunas do `RETURNS TABLE` → precisa de `DROP` antes do
  `CREATE` (42P13). Sem `CASCADE`, de propósito. `fn_blocos_previstos_mes` lista as colunas que
  consome uma a uma e a chamada direta em `marcacoes/actions.ts` recebe objeto — nenhuma quebra
  com colunas novas.

## Como aplicar

1. Aplicar `supabase/migrations/20260819200000_batida_de_transicao_entre_turnos.sql`.
   **Só troca funções — não escreve dado.**
2. `node scratchpad/portao_dono_piso.js` — dry-run: lista todo dia cujo horário gravado passa a
   divergir da projeção. Aqui devem aparecer justamente os dias com batida de transição perdida.
3. `node scratchpad/portao_dono_piso.js --aplicar` — reconcilia.
4. "Sincronizar" na folha do servidor para a folha refletir (ver
   [`2026-08-19-batida-de-um-dia-virando-passo-de-outro.md`](2026-08-19-batida-de-um-dia-virando-passo-de-outro.md)).

## Resultado da aplicação (19/08/2026)

Migrations `20260819200000` e `20260819210000` aplicadas em produção; reconciliação de agosto/2026:
**94 dias, 0 falhas**. MAISA, os dois dias em que houve batida na transição:

| dia | Regular (frente da folha) | Plantão (anexo) |
|---|---|---|
| 17 | — → 13:23 | 13:29 → 19:14 |
| 18 | 07:04 → 13:07 | 13:10 → 19:09 |

Antes, as duas linhas tinham `07:04 → 19:09` e a folha cobrava 6h de hora extra além do plantão.

⚠️ **A folha só reflete isso depois de "Sincronizar"** — `folha_ponto.registros` é snapshot.

### Pendências que ficaram (medidas, não supostas)

- **6 dias não convergem** na conferência: bloco que cruza a meia-noite, alocado tanto no dia dele
  quanto no seguinte. Já registrado no diário do dono/piso.
- **9 blocos de agosto têm a janela de intervalo FORA do próprio bloco** — todos plantão noturno
  `19:00 → 07:00` com intervalo previsto às `12:00/14:00`. `fn_blocos_previstos_dia` usa
  `jornadas.intervalo_inicio_padrao`, que é **hora absoluta**, mesmo para turno que começa às
  19:00; o fallback relativo (`v_start_min + 240`) só entra quando a jornada não tem padrão.
  Efeito: a linha do plantão recebe intervalo antes da própria entrada — ICARO HENRIQUE, 18/08,
  está assim **desde antes desta mudança** (entrada 19:03, intervalo 13:02/13:37, saída 06:55),
  então não é regressão. Correção: ignorar o intervalo padrão quando ele cai fora da janela do
  turno e usar o relativo. Não feita nesta rodada.

## Efeito no anexo de plantões

Com a linha do plantão passando a ter horário próprio, o anexo mostra o que de fato aconteceu no
plantão. Junto disso, a coluna **HORÁRIO PREVISTO** deixou de mostrar `T (6h)` e passa a mostrar
`13:00 às 19:00` (`formatarJanelaPrevista` em `folha-ponto/actions.ts`, níveis 1 e 2 da cadeia da
armadilha 4 — não usa `fn_blocos_previstos_dia`, que devolveria o bloco fundido 07:00→19:00).
