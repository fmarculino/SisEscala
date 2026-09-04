# Folha de ponto: HH:MM, rodapé do cartão antigo, e o atraso que virava hora extra

**Data:** 04/09/2026
**Plano:** [`docs/planos/2026-09-04-ajustes-folha-de-ponto-hhmm-atraso-e-compensacao.md`](../planos/2026-09-04-ajustes-folha-de-ponto-hhmm-atraso-e-compensacao.md)
**Base legal:** Portaria 382/2019-GAB-MAB/SMS (ponto eletrônico da Secretaria), Art. 7º §1º/§2º/§3º/§5º

## O pedido, e o que ele estava cobrindo

O RH pediu duas coisas simples — horas em `HH:MM` em vez de `0.8h`, e o rodapé no vocabulário do
cartão antigo (Control iD/SISREF). Medindo produção para planejar isso, apareceu o motivo real de
a folha não fechar com o que o RH espera:

**a folha nunca mediu atraso.** O cálculo de hora extra compara o *instante* da saída contra o
instante previsto e nunca olha a entrada. Então quem chega atrasado e sai mais tarde para repor
recebe aquilo como **hora extra**.

Medido em 08/2026 (547 folhas, 6.412 dias com entrada e saída):

| | |
|---|---|
| dias com atraso na entrada (> 5 min) | **1.363 — 646h27**, invisíveis na folha |
| dias em que chegou atrasado **e** saiu depois | **622 dias, 141 pessoas** |
| hora extra lançada nesses dias | **489h09** |
| parcela que apenas repõe o atraso | **253h21** |

51% da hora extra da competência nasce em dia que começou com atraso. Caso real: MARIA DE JESUS
(mat. 10370), 8 dias em 08/2026 — `14:29 → 18:12` numa jornada 14H–18H: 12 min pagos como extra
num dia em que faltaram 17 min para fechar a jornada.

## O que foi feito

Fonte única nova: **`src/utils/folha/calculoDia.ts`** (módulo puro), usada pelo editor, pela
impressão em lote, pela Server Action e pelo recálculo ao salvar.

| entrega | onde |
|---|---|
| tudo em `HH:MM` | `formatarMinutosHHMM` — rodapé, verso, célula de extra, listagem |
| coluna **Visto** removida | editor + impressão em lote |
| rodapé com 7 indicadores | Horas Normais · Horas Noturnas · Dias de Falta · Falta e Atraso · Abono · Extra Diurna (50%) · Extra Not./Dom. (100%) |
| atraso, saída antecipada e noturno medidos | `calcularDia` |
| decisão de compensação | selo inline na linha do dia + `decidirCompensacaoDia` |
| cobrança da decisão no fechamento | `requerDecisaoCompensacao` em `salvarFolhaPonto` |

**O Portal do Servidor renderiza o mesmo `FolhaPontoEditor`**, então herdou tudo — inclusive a
impressão, que é `window.print()` sobre o mesmo DOM. O selo de decisão **não** aparece lá: quem
autoriza é coordenação/RH (`podeDecidirCompensacao = podeReclassificar`), e a Server Action confere
o papel de novo no servidor.

## As decisões que mais pesaram

### 1. Medir as duas pontas, sem trocar o modelo de cálculo

Seria tentador passar ao modelo de *duração* do cartão antigo (trabalhado × devido), que anula
atraso contra excedente sozinho. **Isso é justamente o que a Portaria veda**: o Art. 7º exige
autorização da chefia para o atraso virar compensação. O sistema mede e propõe; a decisão é humana.

### 2. `pendente` não muda valor nenhum

As duas alternativas erravam:

| default | efeito |
|---|---|
| "é compensação até autorizarem" | tiraria **253h** de extra de **141 pessoas** de uma vez, numa folha que o servidor assina |
| "é hora extra até compensarem" | mantinha o problema |

O dia nasce `pendente`, **o total não muda**, e a decisão é cobrada no fechamento — reusando o
mecanismo que já existia para falta pendente (`requerConfirmacaoFaltas` + modal). Conferido contra
produção: **0 de 1.164 folhas** (547 de 08/2026 + 617 de 09/2026) mudam de valor de hora extra ou
de falta com a mudança aplicada e nenhuma decisão tomada.

### 3. "Abono" não é "dia de afastamento"

A primeira versão contava dia com afastamento e dava **1.173 "abonos"** em 08/2026 — que são
Férias (304), Licença Prêmio (206), Licença saúde (197), Licença Maternidade (124). Rotular aquilo
de abono engana quem confere folha.

Abono é **tempo relevado**: declaração de comparecimento e afins, lançadas por horas, com
`regime_abono` diferente de `a_compensar` (`minutosAbonadosDoDia`). Por isso sai em `HH:MM`, e a
geração grava `abono_minutos` no registro. Folha antiga mostra `0:00` — zero honesto em vez de
número inventado.

### 4. Previsto que não se sabe é `null`, nunca 08:00–17:00

`parseJornadaNome` das actions cai num default de `08:00–17:00` quando o nome da jornada não
parseia. Para hora extra isso é contido; para **atraso** seria desastre — todo mundo que entra
depois das 08:00 apareceria atrasado todo dia. `previstoDaJornada` devolve `null`, e sem previsto
nada de atraso é medido.

De quebra, o regex novo aceita **`ÁS` (A agudo)**: as jornadas `08H ÁS 20H` e `09H ÁS 21H` estão no
catálogo e não casavam com o padrão original. Nenhuma escala ativa as usa hoje (0 dias em 06, 07 e
08/2026), mas são selecionáveis — no dia em que alguém escolhesse, a folha compararia contra
17:00 em silêncio.

## Duas hipóteses que a medição derrubou

Registradas porque quase entraram no plano como fato:

1. **"O regex está fabricando horário previsto em produção."** Não está — as duas jornadas com
   acento agudo não são usadas por nenhuma escala ativa. Mina no catálogo, não incêndio.
2. **"878 dias de 09/2026 estão sendo calculados contra horário fabricado."** É o número de dias
   com `jornada_nome` **vazio no snapshot** (13,7% do mês). Conferido um a um contra a jornada da
   escala: **o cálculo está certo** (58 de 61 casos com extra batem exatamente; os 3 restantes
   divergem 2 min, dentro da tolerância do Art. 58 §1º). O que falta é só o campo. Por isso
   `calcularDia` recebe o **fallback** do nome da jornada da folha — sem ele, esses dias cairiam
   sem previsto.

E um erro da própria medição virou requisito: minha primeira conta de saída antecipada deu
1.348 min/dia médios em turno `18H ÀS 06H` — aritmética de minutos quebrando na virada da
meia-noite. Por isso o módulo usa `sequenciaDia.ts`, que já resolve isso, em vez de contar minutos
na mão.

## Portões

- `node scratchpad/sim_calculo_dia.js` — **52 casos**: Art. 7º §1º/§2º/§3º/§5º, jornada ≤6h sem
  intervalo, turno que cruza a meia-noite, jornada com acento agudo, `jornada_nome` vazio, total
  mensal acima de 24h, e "abono não se deduz de afastamento".
  **Validado injetando 3 regressões de propósito** — compensar sem autorização, `% 24` no total
  mensal, e previsto fabricado: as três reprovam.
- `node scratchpad/an_confere_totais_novos.mjs` — conferência contra produção: nenhum valor muda
  sem decisão.
- `scratchpad/gen_preserva_compensacao.js` e `gen_abono_minutos.js` — aplicam nas **4 cópias** da
  geração e abortam se a contagem divergir.

## O que ficou de fora, de propósito

- **Colunas novas em `folha_ponto`** para atraso/noturno. Os dois renderizadores calculam dos
  `registros` (que é o que torna a impressão exata); as colunas do banco só servem à listagem, e
  gravá-las exigiria mexer nos 8 sítios de escrita de totais sem ganho visível hoje.
- 🚨 **Compensação entre meses: DESCARTADA por decisão do usuário (04/09/2026)** — "a compensação
  tem que ocorrer dentro do próprio mês, ela não pode ser compensada nos meses subsequentes".
  O Art. 7º caput da Portaria *admite* compensar até o fim do mês subsequente, mas é teto, não
  obrigação, e a Secretaria optou por não usá-lo.
  - A implementação já é compatível **por construção**: a compensação é do **mesmo dia**, que é
    necessariamente dentro do mês. Não há saldo atravessando competência em lugar nenhum.
  - Consequência operacional: o atraso não compensado até o fechamento **morre ali**, virando
    desconto ou justificativa (Art. 7º §4º / Art. 19º I). É mais um motivo para o gate de
    fechamento existir — depois de fechada, não há segunda chance de compensar.
  - ⚠️ **Não construir saldo que atravessa competência.** Seria banco de horas por outro nome, e
    esbarra nas mesmas perguntas de regime jurídico que continuam sem resposta desde 14/08/2026.
- **Autorização prévia de hora extra** (Art. 8º — 473h em 08/2026 nasceram sem gate nenhum).
  Continua em aberto. Ver seção 6 do plano.
- **Recálculo em `autoCorrigirFolhaPonto`/`autoCorrigirTodasFolhasPonto`/portal** ainda ignora a
  compensação ao gravar as colunas do banco. `salvarFolhaPonto` já honra (é o caminho que roda
  logo depois de uma decisão); os outros só afetam a listagem, nunca o documento.
