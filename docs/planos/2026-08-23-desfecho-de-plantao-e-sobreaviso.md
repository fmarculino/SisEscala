# Desfecho de plantão e sobreaviso — validado, falta, ou em avaliação

**Data:** 23/08/2026 · **Status:** plano, nada implementado · **Versão base:** v2.13.3

O anexo "Demonstrativo de Plantões e Sobreavisos" é comprobatório: é o documento que o servidor
assina e que o RH usa para pagar a unidade de plantão. Hoje ele soma **o que foi escalado**, não o
que foi cumprido. Este plano introduz um terceiro estado — *em avaliação* — e uma decisão explícita
do coordenador que fecha esse estado como **validado** ou como **falta**.

---

## 1. O que está medido em produção (23/08/2026, competência 08/2026, dias 1–22)

### 1.1 O anexo soma plantão sem prova

| situação do plantão | qtd | horas | o anexo hoje |
|---|---|---|---|
| entrada **e** saída registradas | 86 | 730h | soma |
| só entrada **ou** só saída | 70 | 723h | soma |
| nenhum registro | 61 | 654h | soma |
| **total** | **217** | **2.107h** | **soma tudo** |

**65% das horas do anexo (1.377h) não têm registro completo** e mesmo assim entram na "Carga
Horária Total". A observação da linha diz apenas *"Em validação"* — texto, não consequência
(`RelatorioPlantaoSobreavisoAnexo.tsx:398`). O total vem de um `reduce` sobre **todas** as linhas
(`folha-ponto/actions.ts:2572`).

O relatório de `/relatorios/plantao-sobreaviso` faz o mesmo: `plantaoHours += horas` sem olhar
presença nenhuma (`plantao-sobreaviso/page.tsx:236`).

⚠️ **A grade JÁ distingue previsto de validado** (colunas `PREVISÃO 204` / `VALIDADO 108` no
totalizador, `calculateTotals` em `ScaleGrid.tsx:1760`), usando `presence?.entrada`. Os dois
relatórios oficiais são os únicos lugares que não distinguem — e são justamente os que saem
impressos e assinados.

### 1.2 Junho e julho quase não mudam; agosto muda tudo

| competência | plantões | completos | parciais | sem registro |
|---|---|---|---|---|
| 06/2026 (Fechada) | 180 · 1.628h | 153 (1.358h) | 15 | 12 |
| 07/2026 (Fechada) | 154 · 1.428h | 153 (1.416h) | 0 | 1 |
| **08/2026** | **217 · 2.107h** | **86 (730h)** | **70** | **61** |

A completude de 06 e 07 é artefato: são os meses da **validação em massa antiga**, que gravava o
instante da validação nos campos de presença (armadilha 5 do `CLAUDE.md` — "junho e julho/2026 não
são auditáveis por horário"). Agosto é o primeiro mês com REP e terminal de verdade, e por isso é o
primeiro mês em que o buraco aparece. **Não é regressão: é a medição finalmente funcionando.**

### 1.3 A folha de ponto não sabe que plantão existe

`folha-ponto/actions.ts:656`:

```ts
const shift = escalaDiaria?.find((ed) => ed.dia === day && ed.categoria === 'Regular')
...
} else if (!shift) {   // Rest day (folga)
  registro.observacao = dateObj.getDay() === 0 ? 'DOMINGO' : dateObj.getDay() === 6 ? 'SÁBADO' : 'FOLGA'
```

Um dia que só tem Plantão nunca chega à falta automática — ele cai no ramo de folga. Conferido na
folha real de **ANDRESA MELO PEREIRA (mat. 54594), 08/2026**, `status Rascunho`, `total_faltas = 0`:

| dia | escala | folha diz |
|---|---|---|
| 01 (sáb) | Plantão MT 12h, zero batida | `SÁBADO` |
| 08 (sáb) | Plantão MT 12h, zero batida | `SÁBADO` |

E o anexo dela conta essas 24h dentro das 120h. **Os dois documentos da mesma pessoa, no mesmo mês,
afirmam coisas incompatíveis.** É exatamente o caso marcado de vermelho na tela.

### 1.4 O sobreaviso: a validação automática **não existe**

Conferido linha a linha e contra o banco:

- **Todo** sobreaviso escalado entra na fila de justificativas como `pendente` — `getEventosPendentes`
  filtra por categoria (`extra`/`plant`/`sobreaviso`) e nada mais (`justificativas/actions.ts:113`).
  Em 08/2026: **79 sobreavisos escalados, 72 sem acionamento nenhum**, todos cobrando justificativa.
- **"Falhou" nunca é gravado.** O status é derivado na renderização, comparando
  `sobreaviso_tempo_aceite_minutos` (30) e `sobreaviso_tempo_chegada_minutos` (90) contra
  `now()` — e a derivação está **copiada em 4 sítios**: `ScaleGrid.tsx:943`,
  `auditoria/page.tsx:664`, `sobreaviso/[token]/page.tsx:77` e `:117`. A coluna
  `logs_sobreaviso.motivo_falha` existe e está **nula em 100% das 526 linhas**.
- **Falha nunca chega ao anexo nem ao relatório.** Nenhum dos dois lê status de acionamento para
  julgar cumprimento.
- `sobreaviso_desconsiderar_falha = true` em produção faz a grade **pintar a falha como
  desconsiderada** (`ScaleGrid.tsx:3995`) — é a única consequência que a falha tem hoje.

Estado real dos acionamentos em produção: **8 acionamentos de verdade, todos terminados em
`Chegou`**, `motivo_falha` nulo em todos. O caminho da falha **nunca foi exercitado**. Os outros 518
registros de `logs_sobreaviso` são artefatos de `fn_confirmar_presenca` (armadilha 6).

⚠️ **Bug encontrado de passagem:** o anexo lista como "acionamento" qualquer linha de
`logs_sobreaviso` do mesmo `(escala_mensal_id, dia)`, **sem filtrar artefato e sem filtrar
categoria** — diferente do relatório, que já tem `ehAcionamentoReal`
(`plantao-sobreaviso/page.tsx:176`). Medido: **1 caso em 08/2026** onde um artefato de presença de
Plantão apareceria como acionamento presencial de Sobreaviso no documento assinado. Pequeno hoje,
cresce com o uso.

### 1.5 A fila de justificativas decide no escuro

A fila mostra `Servidor · Dia · Categoria · Turno · Status · Justificativa`
(`JustificativasClient.tsx:653`). **Não mostra se houve batida.** O coordenador que abre
"Justificar" no dia 08 da ANDRESA não tem como saber, ali, que não existe registro nenhum — a única
saída é abrir a grade em outra aba.

Cobertura atual: 50 justificativas para 548 eventos de 08/2026. Das 27 de Plantão, **21 estão em
dias com registro completo**, 2 em dia parcial e 4 em dia sem registro nenhum.

---

## 2. O modelo

Três estados, e **um só lugar** decide qual é:

| estado | quando | conta no anexo? |
|---|---|---|
| `registrado` | tem entrada **e** saída (relógio, terminal ou validação manual) | **sim** |
| `validado` | o coordenador decidiu que foi cumprido, com justificativa | **sim**, marcado como validado |
| `falta` | o coordenador decidiu que não foi cumprido por ausência do servidor | **não** — vai para o subtotal de faltas |
| `em_avaliacao` | dia já passou, falta um dos registros ou os dois, e ninguém decidiu | **não** — aparece, não soma |
| `previsto` | dia ainda não aconteceu | **não** |

O critério de "registrado" é **entrada e saída**, conforme decidido. Em 08/2026 isso põe
**131 dos 217 plantões em avaliação** no primeiro dia — ver §6, Risco 1.

### 2.1 O desfecho mora em `justificativas_eventos`

A tabela já tem a granularidade certa (`UNIQUE (servidor_id, dia, mes, ano, categoria)`), já tem
origem/status/validador, já é lida pelo anexo e pela fila. Criar tabela nova duplicaria a chave.

```sql
ALTER TABLE public.justificativas_eventos
  ADD COLUMN resultado text NULL
    CHECK (resultado IS NULL OR resultado IN ('validado', 'falta'));
```

⚠️ **`NULL`, não `DEFAULT 'validado'`.** As 51 justificativas existentes foram escritas como
*motivação* ("Plantão de Reforço em Finais de Semana"), não como atestado de cumprimento — ninguém
tomou a decisão que a coluna representa. Com `DEFAULT 'validado'` o backfill afirmaria, em nome do
coordenador, que 6 plantões sem registro completo foram cumpridos. Com `NULL`, os 21 que já têm
ponto completo continuam somando por conta do próprio ponto, e **só 6 eventos** precisam de decisão
humana.

⚠️ **A chave única não inclui `escala_mensal_id`.** Um servidor com Plantão em duas escalas no mesmo
dia (dobra em unidades diferentes) só consegue um desfecho para os dois. É limitação pré-existente,
não introduzida aqui; medida em 08/2026: **0 casos**. Fica registrada, não tratada.

### 2.2 Fonte única da classificação: `fn_desfecho_evento_dia`

```sql
fn_desfecho_evento_dia(p_escala_diaria_id uuid, p_hoje date)
  RETURNS TABLE (estado text, motivo text, horas numeric)
```

Um lugar só, chamado por: anexo, relatório de plantão, gate de fechamento e a própria fila. **Não
replicar no frontend** — é a mesma disciplina de `fn_precedencia_origem`, que o `CLAUDE.md` já manda
aplicar num ponto só.

⚠️ `RETURNS TABLE` exige `DROP FUNCTION` antes de qualquer `CREATE OR REPLACE` que mude colunas
(erro `42P13`, registrado em 13/08/2026 com `fn_cobertura_ponto_dispositivo`).

### 2.3 Sobreaviso: a regra descrita, implementada

| situação | desfecho | vai para a fila? |
|---|---|---|
| escalado, **sem acionamento** | `validado` automático — prontidão cumprida | **não** |
| acionado e `Chegou` | `validado` automático — o atendimento está documentado | **não** |
| acionado e falhou (não aceitou em 30 min, aceitou e não chegou em 90 min, ou recusou) | **`falta`** (§5.2) | **sim**, para o coordenador poder reverter |
| em andamento (`Aguardando`/`Aceito` dentro do prazo) | `previsto` | não |

Isso tira **72 dos 79 sobreavisos de agosto** da fila e põe lá só o que precisa de gente. Hoje é o
inverso: a fila cobra os 79 e não sabe distinguir nenhum.

**A derivação de falha precisa sair da renderização.** Nova `fn_status_acionamento_sobreaviso`,
SQL, lendo os mesmos `sobreaviso_tempo_aceite_minutos` / `sobreaviso_tempo_chegada_minutos` — e os
4 sítios de JS passam a consumi-la. Sem isso, a fila e a grade discordariam sobre o que é falha,
exatamente como `fn_projecao_marcacoes_dia` precisou ser fonte única de reconciliar e conferir.

⚠️ **`sobreaviso_desconsiderar_falha = true` muda de sentido e precisa de decisão** — ver §5.2.

---

## 3. O que muda em cada tela

### 3.1 Fila de justificativas (`/justificativas`)

**Coluna nova "Ponto"**, antes de "Status": `— sem registro` · `entrada 12:08 · sem saída` ·
`12:08 → 18:00`. Sem ela o coordenador decide no escuro, e a decisão dele é o documento.

**O modal ganha a decisão como primeiro campo, obrigatória**, só para evento em avaliação:

```
Este plantão foi cumprido?
  ( ) Sim — validar o plantão           → texto = motivação do serviço extraordinário
  ( ) Não — registrar FALTA do servidor → texto = o que aconteceu (obrigatório, >= 10 caracteres)
```

Para evento já `registrado`, o modal continua exatamente como é hoje (justificativa motivacional,
sem pergunta) — a decisão já foi tomada pelo relógio.

⚠️ **O botão em lote só oferece "validar".** Marcar falta em massa é decisão individual sobre a
conduta de uma pessoa; o `JustificativaBulkModal` grava `resultado = 'validado'` e ponto.

⚠️ **Excluir o plantão da escala continua sendo o caminho certo para "escalei errado"**, e já
funciona — mas **só quando não há batida nenhuma**: `handleCellChange` recusa apagar célula com
presença ("Direito Adquirido", `ScaleGrid.tsx:1317`). Dos 217 plantões de agosto, **61 podem ser
excluídos e 70 não** — os parciais têm que passar pela fila obrigatoriamente. A tela precisa dizer
isso, senão o coordenador tenta apagar e leva um erro sem saber por quê.

### 3.2 Anexo (`RelatorioPlantaoSobreavisoAnexo`)

- Seção 1 ganha coluna **Situação**: `REGISTRADO` · `VALIDADO` · `EM AVALIAÇÃO` · `FALTA`.
- `Carga Horária Total` passa a somar **só `registrado` + `validado`**, com o rótulo mudando para
  **"Carga horária cumprida"**.
- Rodapé da seção com três subtotais: `cumpridos Nh` · `em avaliação Nh` · `faltas N (Nh)`.
- Linha de falta em vermelho, com a justificativa do coordenador na coluna de observações.
- **Correção do §1.4**: aplicar `ehAcionamentoReal` e filtrar por `categoria = 'Sobreaviso'` na
  montagem de `acionamentos` em `getDadosPlantoesSobreavisosServidor`.

⚠️ **O anexo não pode deixar de mostrar a linha em avaliação.** Some com ela e o servidor perde a
única chance de contestar antes do fechamento — é o mesmo princípio de
`substituida_por_precedencia`: marcação perdedora continua visível.

### 3.3 Relatório de plantão/sobreaviso (`/relatorios/plantao-sobreaviso`)

`plantaoHours` vira três: `plantaoHorasCumpridas`, `plantaoHorasEmAvaliacao`, `plantaoFaltas`
(contagem + horas). `totalEffectiveHours` passa a usar só as cumpridas.

⚠️ **Isso muda relatórios de competências já fechadas.** Medido: 06/2026 muda 27 eventos, 07/2026
muda 1, e ambas estão em `competencias_encerradas`. O relatório é derivado — não há dado a migrar.
Recomendo aplicar uniformemente e registrar no CHANGELOG, porque um critério que vale a partir de
uma data cria dois significados para a mesma coluna.

### 3.4 Folha de ponto — **não muda** (decidido em 23/08/2026)

A falta de plantão vive no anexo e no relatório. `folha_ponto.total_faltas` continua medindo só
falta de **jornada**; o dia sem Regular continua exibindo `SÁBADO`/`FOLGA`. As 4 cópias da geração e
as 4 do recálculo ficam intocadas.

ℹ️ Consequência aceita: a folha e o anexo da mesma pessoa continuam contando coisas diferentes no
mesmo dia — só que agora **de propósito e com rótulo**, em vez de por omissão. São grandezas
distintas: falta de jornada desconta dia; falta de plantão deixa de pagar a unidade PL.

### 3.5 Gate de fechamento

| onde | hoje | proposto |
|---|---|---|
| **Fechar Escala** (grade) | `fn_contar_pendencias_justificativa` cobra justificativa de **todos** os 548 eventos de 08/2026 | mantém a cobrança motivacional (config `justificativa_obrigatoria_fechar_escala`) **e** passa a recusar evento em `em_avaliacao` |
| **Fechar folha** (`salvarFolhaPonto(status='Revisada')`) | não checa nada | recusa se o servidor tiver plantão/sobreaviso `em_avaliacao` no mês, listando os dias |
| **Auto-fechamento** (`autoCloseExpiredScalesAndTimesheets`) | `UPDATE status='Revisada'` direto, sem passar por action nenhuma | **converte em `falta` o que estiver em avaliação**, loga a lista, e fecha — reversível pelo RH (§5.1) |

⚠️ `salvarFolhaPonto` é a única porta com dono, mas **não é a única porta**: `autoClose.ts:112`
escreve `status` direto na tabela. Fechar só a action deixaria o cron fechando folha com pendência,
em silêncio — o modo de falha mais caro possível, porque ninguém olha.

---

## 4. Migrations

| ordem | arquivo | o que faz |
|---|---|---|
| 1 | `20260824100000_desfecho_evento_coluna.sql` | coluna `resultado` + índice parcial `WHERE resultado = 'falta'` |
| 2 | `20260824110000_fn_status_acionamento_sobreaviso.sql` | fonte única do status de acionamento (substitui as 4 cópias de JS) |
| 3 | `20260824120000_fn_desfecho_evento_dia.sql` | classificador dos 5 estados, para plantão e sobreaviso |
| 4 | `20260824130000_gate_desfecho_no_fechamento.sql` | `fn_contar_pendencias_desfecho` + `fn_salvar_justificativa_evento` aceitando `p_resultado` |

⚠️ **Confira o prefixo antes de criar** (`ls supabase/migrations | grep 20260824`) — em 22/08/2026
duas sessões paralelas geraram dois `20260822100000_*` e foi preciso renumerar 26 referências.

⚠️ **Nenhuma dessas migrations toca `fn_confirmar_presenca*`.** Todo o comportamento novo entra por
funções novas que leem `escala_diaria`, nunca por recópia das funções de presença (armadilha 1 —
seis regressões reais).

⚠️ `salvarJustificativa` (server action) faz **upsert direto na tabela**, não chama
`fn_salvar_justificativa_evento` (`justificativas/actions.ts:266`). Os dois caminhos precisam gravar
`resultado`, senão a RPC e a tela divergem.

### Consulta de conferência (obrigatória em cada migration)

Para a migration 3, sobre 08/2026, o resultado esperado é exatamente
`registrado 86 · em_avaliacao 131 · falta 0 · validado 0`, e a soma das horas de `registrado` deve
dar **730h** contra as 2.107h que o anexo imprime hoje.

---

## 5. Decisões

### 5.1 — Falta por decurso no auto-fechamento ✅ **DECIDIDO em 23/08/2026**

O auto-fechamento **converte em `falta`** todo plantão que, no momento de fechar, não estiver
`registrado` pelo ponto nem `validado` pelo coordenador. A conversão é **reversível pelo RH Geral
(`rh`) e pelo RH da Unidade (`rh_unidade`)**.

Espelha `resolverFaltaAutomatica`, que já converte falta de jornada por decurso do prazo
(`justificativa_prazo_dias_uteis = 3` dias úteis após o fim do mês).

Consequências de desenho que isso obriga:

| exigência | por quê |
|---|---|
| a falta por decurso grava `resultado_origem = 'decurso_de_prazo'` | quem reverte precisa distinguir "o coordenador decidiu que faltou" de "ninguém decidiu e o prazo venceu". São coisas diferentes diante do servidor |
| `resultado_revertido_por_id` + `resultado_revertido_em` + motivo, append-only | reverter uma falta é decisão sobre conduta de servidor público — não pode ser um `UPDATE` anônimo |
| o auto-fechamento precisa gravar em `logs_sistema` a lista do que converteu | hoje ele já loga `Escala Fechada Automaticamente`; a conversão em falta é mais grave que o fechamento e não pode ser mais silenciosa |
| a reversão **não** reabre a folha | a folha é snapshot; reverter o desfecho corrige o anexo e o relatório, que são derivados. Reabrir folha continua sendo decisão de `admin`/`super_admin` |

🚨 **Bloqueador descoberto ao detalhar esta decisão: `justificativas_eventos` não tem controle de
acesso nenhum.** A policy é `FOR ALL USING (auth.uid() IS NOT NULL)` (migration `20260805000000`,
seção 12) e `justificativas/actions.ts` tem **zero** checagens de papel — `grep -c role` devolve 0.
Hoje isso grava texto motivacional; com a coluna `resultado`, passa a gravar **veredito sobre
conduta de servidor público**, e qualquer conta autenticada de qualquer unidade poderia escrever ou
apagar um. "Reversível pelo RH" não significa nada enquanto todo mundo puder reverter.

É a mesma lição de `/usuarios` (22/08/2026): *tela filtrada não protege a action*. **A fase 1 não
pode ir ao ar sem fechar isto** — policy por escopo (`fn_unidade_no_escopo OR
fn_unidade_alcancavel_por_setor`, nunca `fn_unidade_no_escopo` sozinha) e autorização dentro de cada
action, com a régua de papéis em fonte única no estilo de `src/utils/gestaoUsuarios.ts`:

| ação | quem |
|---|---|
| validar plantão / justificar | `coordenador`, `admin`, `rh`, `rh_unidade`, `super_admin` — no escopo |
| marcar `falta` | idem |
| **reverter** falta (inclusive a de decurso) | **só `rh`, `rh_unidade`, `super_admin`** |

### 5.2 — Falha de acionamento é falta ✅ **DECIDIDO em 23/08/2026**

O sobreaviso **não soma horas trabalhadas** — confirmado em `calculateTotals`
(`ScaleGrid.tsx:1907`: *"O Sobreaviso NÃO entra no cálculo do total de horas"*); ele é contado em
**unidades de prontidão**, e só `Regular`, `Extra` e `Plantão` entram no total de horas. O desfecho
do sobreaviso decide se a **unidade de prontidão** é paga, não horas.

| situação | desfecho |
|---|---|
| escalado, **sem acionamento** | **válido** — a prontidão foi cumprida. Conta no relatório, não vai para a fila |
| acionado e chegou | **válido** |
| acionado e falhou em **qualquer** estágio — não aceitou, aceitou e não compareceu, ou os dois | **FALTA**, direto. Consta no relatório |
| falta revertida pelo coordenador nas justificativas | **válido**, com a justificativa anexada |

⚠️ **Isto é mais forte do que a regra do plantão, de propósito.** Plantão sem registro fica *em
avaliação* e espera decisão; sobreaviso que falhou **já nasce falta** e espera a decisão em sentido
contrário. A diferença é qual estado carrega o silêncio: no plantão o silêncio pode ser a batida de
transição recusada pelo terminal (§6, Risco 2); no sobreaviso o silêncio é a própria pessoa não ter
aceitado nem comparecido, que é o fato.

🚨 **Consequência que precisa de ação: `sobreaviso_desconsiderar_falha = true` está LIGADO em
produção e contradiz esta regra.** Hoje ele só pinta a célula da grade como desconsiderada
(`ScaleGrid.tsx:3995`); mantido como está, viraria um interruptor global capaz de anular a falta de
sobreaviso em toda a rede, sem log e sem justificativa. **A chave é aposentada** — a única porta
para desfazer uma falta de sobreaviso passa a ser a validação do coordenador na fila, que grava
autor, data e motivo. A migration remove a chave de `configuracoes_globais` e os 4 sítios de JS que
a leem. Custo de reversão medido: **zero** — o caminho da falha nunca rodou em produção (0 de 8
acionamentos terminaram em falha).

### 5.3 — Validação manual do coordenador conta como "registrado" ✅ **DECIDIDO em 23/08/2026**

Validar a presença na grade **já exige justificativa digitada ali**, e isso basta: o plantão conta
como cumprido e **não** volta para a fila de justificativas. Confirmado no código — os quatro
caminhos de validação manual recusam texto vazio antes de chamar a RPC (`ScaleGrid.tsx:2352`
individual, `:2551` em massa por servidor, `:2648` em massa global, `:2720` sobreaviso).
`fn_registrar_presenca_informada` grava origem `ajuste_coordenador` com `sintetica = true`, e o
anexo já rotula "Ajuste Manual Validado" — tratamento autorizado pelo Art. 82, parágrafo único.

⚠️ **Uma exceção: existe UM caminho que valida presença sem ninguém digitar nada.** Ao marcar dias
passados e salvar, `handleSave` fabrica os horários a partir do previsto e grava a frase enlatada
*"Ajuste automático — presença aplicada a partir do horário previsto ao validar dias passados no
Aplicar Template"* (`ScaleGrid.tsx:3044`). O comentário no código diz que dispensar a justificativa
uma a uma é o **objetivo** desse caminho, então não é bug — mas com a regra desta seção ele
validaria plantão em lote sem declaração nenhuma sobre o dia.

Medido em 08/2026 — dos **86** plantões completos: **67** são batida real, **18** são validação
manual com texto digitado e **1** veio do ajuste automático. No mês inteiro, porém, a frase
enlatada aparece em **1.847 linhas** (1.836 `Regular`, 7 `Plantão`, 4 `Extra`): o caminho é
intensamente usado no expediente e quase não tocou plantão ainda.

**Regra adotada:** para `Plantão`, "registrado" exige batida real **ou** validação manual com
justificativa **digitada**. A linha cuja `justificativa_manual` é a frase automática continua **em
avaliação**. Custo hoje: **1 evento**. Sem isso, o dia em que alguém usar "validar dias passados"
sobre a linha de plantão dissolve todo este plano em um clique.

---

## 6. Riscos

**Risco 1 — 131 eventos entram em avaliação no dia do deploy.** É o número real de 08/2026, e a
maior parte não é conduta: é batida de transição recusada pelo terminal (armadilha 6 — casos MAISA e
AGNA) e plantão emendado ao Regular. **Ligar o gate de fechamento antes de tratar essa fila
travaria o fechamento de agosto.** Ordem obrigatória: (a) telas e classificação, (b) fila tratada
pelos coordenadores, (c) gate.

**Risco 2 — o critério "entrada e saída" pune quem foi vítima da fronteira.** Dos 82 plantões
emendados com Regular, os que aparecem "completos" muitas vezes carregam **o mesmo par de batidas do
turno Regular**, porque sem batida na fronteira o par do bloco vai para todas as linhas — é a dupla
contagem do plano `2026-08-23-turno-regular-emendado-com-plantao.md`. Ou seja: *completo* nem sempre
prova o plantão, e *incompleto* nem sempre prova a ausência. Este plano **não resolve** isso e não
deve tentar — depende daquele. Enquanto não sair, "em avaliação" é o estado honesto, e é por isso
que a decisão fica com uma pessoa.

**Risco 3 — falta é registro sobre conduta de servidor público.** Diferente de tudo que o módulo de
justificativas gravava até aqui. Consequências no desenho: nunca em lote, texto obrigatório,
`validado_por_id` sempre preenchido, e **append-only na prática** — trocar `falta` por `validado`
precisa gravar quem trocou e por quê, no mesmo espírito de `escala_diaria_turno_historico`.

**Risco 4 — não há teste automatizado.** O portão é a consulta de conferência de cada migration
(§4) mais um simulador em JS sobre os dados reais de 06, 07 e 08/2026, no modelo de
`scratchpad/sim_gestao_usuarios.js`. Verificar que 06 e 07 mudam exatamente 27 e 1 eventos.

---

## 7. Fases

| fase | entrega | critério de saída |
|---|---|---|
| 0 | migrations 1–3 + simulador sobre 06/07/08 | contagens batem com §4 |
| **0b** | **RLS por escopo e autorização por papel em `justificativas_eventos` (§5.1)** | **conta fora do escopo recusada pela action E pela policy** |
| 1 | coluna "Ponto" na fila + decisão no modal + backfill `NULL` | os 6 eventos indecisos de agosto aparecem como "em avaliação" |
| 2 | anexo: coluna Situação, três subtotais, correção do artefato de acionamento | ✅ **feito em 24/08/2026.** A ANDRESA sai de 120h para **48h cumpridas**, 60h em avaliação e 12h de dia futuro — a conta fecha em 120h. ⚠️ O critério de saída escrito aqui antes ("96h, com 24h em avaliação") **estava errado**: foi estimado só pelos dias 01 e 08 do print, antes de medir o mês dela inteiro. Os dias 11 e 13 têm saída às 18:00 e nenhuma entrada, e os dias 15 e 22 não têm registro nenhum |
| 3 | sobreaviso: `fn_status_acionamento_sobreaviso`, auto-validação, falha vira falta, aposentadoria de `sobreaviso_desconsiderar_falha`, os 4 sítios de JS passam a consumi-la | 72 dos 79 sobreavisos de agosto saem da fila; os 8 acionamentos reais seguem válidos (todos `Chegou`) |
| 4 | relatório de plantão com as três colunas | 06 e 07 mudam 27 e 1 eventos, e nada mais |
| 5 | gate de fechamento (escala, folha) + falta por decurso no cron + tela de reversão do RH | **só depois da fila de agosto tratada** |
