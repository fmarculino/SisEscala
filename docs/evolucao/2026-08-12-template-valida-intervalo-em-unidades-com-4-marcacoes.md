# "Aplicar Template" — validar dias passados passa a gravar as 4 marcações — 12/08/2026

## Contexto

O botão "Aplicar Template" da grade de escala (`ScaleGrid.tsx`) tem uma opção "Validar
automaticamente dias passados", pensada para poupar o coordenador de confirmar presença dia a
dia ao lançar uma escala nova. O usuário reportou que, depois do módulo de intervalo
intrajornada (v1.17.0 — unidades com `permite_marca_intervalo` passaram a exigir 4 marcações:
entrada, saída de intervalo, retorno de intervalo, saída), essa opção continuou gravando só 2
(entrada/saída).

## Diagnóstico

O bug estava em duas camadas, as duas em `ScaleGrid.tsx`, e as duas precisavam de correção — uma
sozinha não resolvia:

1. **`presenceData` (estado local, visual)** — o handler do botão "Aplicar Template" sempre
   escrevia `{ entrada: true, intervalo_saida: false, intervalo_retorno: false, saida: true }`
   para os dias passados, sem checar se a unidade e a jornada do dia exigem intervalo. Essa
   checagem (`isUnitInterval`) já existe no arquivo — é a mesma que decide se a célula da grade
   mostra 2 ou 4 segmentos — mas o handler do template nunca a chamava.

2. **`handleSave` ("Salvar Previsão")** — é quem de fato persiste `presenceData` em
   `escala_diaria`, via um `upsert` direto do cliente (não passa por `fn_confirmar_presenca_manual`).
   O payload só tinha `presenca_entrada_em`/`presenca_saida_em`. Mesmo corrigindo o item 1, as
   colunas `presenca_intervalo_saida_em`/`presenca_intervalo_retorno_em` nunca apareciam no
   `item` gravado — a marcação de intervalo "sumia" ao salvar, mesmo com o indicador mostrando os
   4 segmentos verdes na tela antes de salvar.

## O que foi corrigido

Ambos em `src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx`, sem tocar em nenhuma
função de banco:

1. O handler de "Aplicar Template" agora calcula `isUnitInterval` por dia — mesma fórmula do
   indicador da grade: `unidadedata.permite_marca_intervalo` **e** a jornada efetiva do dia
   (respeitando jornada temporária, via `jornadasTemporarias`) tem duração > 6h e
   `intervalo_minutos > 0` (CLT Art. 71). Quando verdadeiro, marca as 4 flags; senão, continua
   marcando só entrada/saída como antes.

2. `handleSave` passa a preencher `presenca_intervalo_saida_em`/`presenca_intervalo_retorno_em`
   no payload, reusando a mesma fonte já estabelecida no arquivo para horário sintético
   ("Fonte Única — Fase 3", comentário já existente no código): primeiro tenta o bloco já salvo
   no banco (`blocoDaCelula`, vem de `fn_blocos_previstos_mes` — bate com o que o terminal
   cobraria); na ausência dele (o caso comum aqui, já que o template normalmente cria dias que
   nunca foram salvos antes), cai em `getShiftForecastTime`, que já implementa a cascata
   documentada no CLAUDE.md (armadilha 9): horário personalizado do servidor → padrão cadastrado
   na jornada → fallback início do turno + 4h. Não foi inventada nenhuma fórmula nova — é a
   mesma função já usada para os tooltips das células da grade e para o modal de validação
   manual por célula.

## O que não mudou

- `fn_confirmar_presenca_manual` e as demais funções de presença — o problema era inteiramente
  client-side. A duplicação entre a lógica de presença da grade e a RPC de validação manual já
  existia antes desta correção (documentada no próprio código como "Fase 3 — Fonte Única"); não
  foi criada nem agravada aqui.
- Unidade sem `permite_marca_intervalo`, ou jornada ≤ 6h: continua gravando só entrada/saída,
  comportamento inalterado.
- Nenhuma coluna `presenca_*_manual` é preenchida por este caminho — `handleSave` já não
  preenchia essas flags para entrada/saída antes desta correção, e a mudança manteve o mesmo
  comportamento para consistência (não expandiu escopo além do pedido).

## Verificação

- `npx tsc --noEmit` / `npm run build`.
- Verificação manual sugerida: aplicar template numa unidade com `permite_marca_intervalo = true`
  e jornada > 6h, marcar "Validar automaticamente dias passados", salvar, e conferir em
  `escala_diaria` que os dias passados têm as 4 colunas de presença preenchidas — não só
  entrada/saída.
