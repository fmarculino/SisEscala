# A folha estava gerada e a tela dizia "Não Gerada" — 15/09/2026

**v2.62.0.** Sem migration: o defeito é de **leitura**, nenhum dado ficou errado no banco.

## O relato

> "Na página da Folha de Ponto, ex. o ALDENIR DA SILVA BARBOSA, clico em Gerar, o sistema
> apresenta a mensagem que gerou, aí quando volta pra página não está gerado. Várias pessoas
> estão me relatando esse bug."

## O que realmente acontecia

A folha **era gerada**, e a mensagem de sucesso era verdadeira. Medido em produção no mesmo dia,
antes de tocar em qualquer código:

```
ALDENIR DA SILVA BARBOSA, mat. 40002, USF HIROSHI MATSUDA
folha c0d11d0e-0a06-4bf8-8f99-e9dbfecccf4b | status Gerada | 09/2026 | 126h | gerado_em 15/09 23:44 UTC
```

O que estava errado era a **listagem**. `getServidoresFolhaPonto` buscava as folhas da
competência assim:

```ts
.from('folha_ponto').select(...).eq('mes', mes).eq('ano', ano)   // sem paginação
```

É a **armadilha 8**: o PostgREST devolve no máximo 1.000 linhas e **não avisa**. Em 09/2026:

| competência | folhas reais | a tela enxergava | invisíveis |
|---|---|---|---|
| 07/2026 | 77 | 77 | 0 |
| 08/2026 | 710 | 710 | 0 |
| **09/2026** | **1.289** | **1.000** | **289** |

As 289 invisíveis estavam **geradas no banco** e a tela as mostrava como "Não Gerada", em
**19 unidades** — SMS 92, HMI 45, ENF. ZEZINHA 33, USF Hiroshi Matsuda 12, e assim por diante.
Por isso "várias pessoas": não era uma pessoa nem uma unidade, era todo mundo que caía fora do
lote de 1.000.

E o laço se fechava: clicar em Gerar fazia o `upsert` (por `escala_mensal_id`) gravar
corretamente, a mensagem de sucesso aparecia, a tela recarregava — e a linha voltava igual,
**para sempre**.

⚠️ **08/2026 cabia em 1.000 e parecia perfeito.** O bug nasceu com o crescimento da base, não
com uma mudança de código. É exatamente o que `src/utils/paginacao.ts` já avisava desde
05/09/2026: *um relatório que hoje cabe não está seguro; ele só ainda não estourou.*

## A correção

`getServidoresFolhaPonto` passou a usar `buscarTodasPaginas` (fonte única) nas **duas** buscas —
escalas e folhas — com `.order('id')`.

⚠️ **O `.order` não é cosmético.** Sem ordem estável o Postgres não garante a ordem entre
páginas: a linha pode repetir numa página e faltar na outra, e aí o resultado fica errado *com*
paginação.

Quando há unidade/setor no filtro, o universo é recortado **antes** de paginar, via embed
`escala_mensal!inner(unidade_id, setor_id)` — 50 linhas na USF Hiroshi Matsuda em vez de 1.289.
Conferido **executando** contra produção, porque embed só se prova executando (armadilha 8b).

A action passou a devolver `completo`, e a tela mostra **"Listagem incompleta"** quando a busca
falha no meio: aqui o parcial não é "um total menor", é **status de folha errado na linha** —
quem olhasse geraria de novo sem saber (armadilha 22).

## O mesmo corte estava em mais quatro lugares, e dois eram DESTRUTIVOS

🚨 **`autoGenerateMissingTimesheets` (cron diário) e a rota `regerar-competencia` escolhem o alvo
por AUSÊNCIA de folha.** Com o mapa truncado, folha existente é lida como inexistente — e o
`upsert` de `executeGerarFolhaPonto` a **reescreve como Rascunho**.

Medido em 15/09/2026, simulando o cron sobre 09/2026 (`scratchpad/an_autogenerate_risco.mjs`):

```
escalas vistas 1000 (de 1.639) | folhas vistas 1000 (de 1.289)
"faltando folha" segundo o código atual: 390
DESSAS, já tinham folha e seriam REESCRITAS: 175  -> { Rascunho: 106, Gerada: 69 }
```

Sobre 08/2026 (710 × 710) o efeito é **zero** — e é por isso que nunca apareceu. O cron roda
sobre a **competência anterior**: em **01/10/2026** ele alcançaria 09/2026 e rebaixaria 69 folhas
`Gerada` para `Rascunho` sozinho, de madrugada.

Os dois passaram a paginar **e a abortar sem escrever nada** quando a busca vem parcial — o
default de uma rotina que escreve tem de ser não fazer nada.

Os outros dois eram só incompletos, e ganharam paginação + relato honesto:

| onde | o que fazia |
|---|---|
| `gerarFolhasEmLote` ("Gerar Todas") | geraria as 1.000 primeiras de 1.639 e diria "sucesso" |
| `autoCorrigirTodasFolhasPonto` ("Auto-Corrigir Lote") | 289 folhas nunca eram sequer **olhadas**; hoje relata `totalFolhasAnalisadas` |

## Conferência

`scratchpad/ver_folha_listagem_nova.mjs` roda a consulta nova contra produção, unidade a unidade,
e sai com código 1 se qualquer asserção falhar. Resultado: **22 de 22 unidades com contagem
idêntica à real**, soma 1.289 = 1.289, a folha do ALDENIR aparecendo na USF Hiroshi Matsuda, e o
caminho antigo ainda cortando em 1.000.

Portões: `node scratchpad/sim_paginacao_folha.js` (22 asserções) e
`node scratchpad/val_sim_paginacao_folha.js` — **8 regressões injetadas, 8 reprovadas**, entre
elas a paginação perdendo o `.order` e o cron voltando a seguir com busca parcial.

## O que ficou de fora

- **Nenhum dado foi corrigido, porque nada estava errado.** As 289 folhas já existiam com o
  status certo; o que mudou é a tela passar a enxergá-las.
- `getFolhasPontoPrintData` usa `.in('id', folhaIds)` com o que o usuário marcou. Com uma unidade
  grande (HMI tem 541 folhas em 09/2026) uma seleção completa monta URI de dezenas de KB — o
  mesmo estouro de gateway que o comentário de `getServidoresFolhaPonto` já registra. **Não
  medido ainda**; fica como pendência conhecida.
- A varredura (`scratchpad/scan_corte_1000.js`) achou outros candidatos fora da folha de ponto
  (`PlanningDeadlineAlert.tsx`, `relatorios/distribuicao`) que não foram tocados nesta rodada.

---

## Segunda rodada, no mesmo dia: "ainda não está funcionando" (v2.63.0)

Minutos depois do deploy, o print voltou com o ALDENIR ainda em "Não Gerada". **A correção estava
certa e já no ar.** A cronologia, medida:

| horário (local) | o que aconteceu |
|---|---|
| 20:14 | o coordenador abre a Folha de Ponto (rodapé do print: **versão 2.60.0**) |
| **21:21:06** | push da correção — o build do Coolify começa agora |
| **21:21:45** | ele clica em **Gerar** (39 s depois). O servidor **ainda roda a versão anterior** |
| 21:24:25 | a v2.62.0 entra no ar |
| 21:26 | o print é tirado **da mesma aba**, carregada às 20:14 |

O banco comprova: a folha foi regravada às `21:21:45` e, pelo caminho novo, a tela monta
**50 escalas / 50 folhas, todas `Gerada`** na USF Hiroshi Matsuda — o ALDENIR entre elas
(`scratchpad/ver_tela_hiroshi.mjs`). O que o print mostra é o código antigo rodando numa aba que
ninguém recarregou.

🚨 **E isso não é "erro do usuário": é um defeito nosso que estava sem dono.** O deploy é
automático a cada push, o dashboard fica aberto o dia inteiro, e **nada na tela dizia que ela
estava velha**. Toda correção de tela tinha uma janela em que quem está usando continua vendo o
defeito — e reportando de novo. O mesmo risco já estava registrado para o terminal de ponto desde
09/08/2026; o dashboard nunca foi coberto.

`src/components/AvisoVersaoDesatualizada.tsx` compara a versão do bundle aberto
(`NEXT_PUBLIC_APP_VERSION`, inlinada no build) com `/api/version` a cada 5 minutos e mostra uma
tarja âmbar no topo.

⚠️ **Ela não recarrega sozinha, e a diferença para o terminal é deliberada.** O terminal só tem
matrícula e PIN na tela e recarrega quando está ocioso. No dashboard há grade de escala não salva,
folha em edição, cadastro pela metade — recarregar por conta própria apagaria trabalho de alguém.
A tarja avisa, explica e oferece o botão; o momento é de quem está usando.

⚠️ **A tarja vive DENTRO do `<main>`**, que é o elemento com scroll. `sticky` num pai que não rola
não gruda em nada e some na primeira rolagem.

### E havia mesmo um erro na tela, o que o print mostrava sem ninguém ter reparado

O botão dizia **"IMPRIMIR SELECIONADAS ($0)"**. O código era
`Imprimir Selecionadas (` + cifrão + `{selectedFolhas.size})` — template literal escrito dentro de
JSX, onde o cifrão sai **literal** e só as chaves interpolam. Uma varredura
(`scratchpad/scan_dollar_jsx.js`) achou 135 candidatos no projeto e **este era o único real**: os
demais são literais multilinha dos relatórios, onde a crase está em linha anterior.
