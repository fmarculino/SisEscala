# "Voltar à lista" devolvia a Folha de Ponto zerada (17/09/2026)

**Versão:** v2.70.2. **Sem migration.** Uma tela, um arquivo.

## O relato

> "quando clica no menu voltar à lista ele deveria voltar com o filtro que foi selecionado
> ativo"

Coordenador filtra a Folha de Ponto por **CAPS III / setembro / 2026**, abre a folha de alguém,
clica em **Voltar à lista** — e a lista volta **sem unidade nenhuma**, pedindo que ele refaça o
filtro. Era exatamente o trabalho que a v2.69.0 tinha ido eliminar.

## O que NÃO era

Quase tudo o que parecia suspeito estava certo, e vale registrar para a próxima investigação
não recomeçar por aí:

| suspeita | medido |
|---|---|
| o botão monta a URL errada | não — `urlDaListaDeFolhas(origem)` devolve `/folha-ponto?mes=9&ano=2026&unidade=…` |
| a folha é aberta sem os filtros de origem | não — os **dois** caminhos (clique na linha e botão Editar) passam `origemAtual` |
| a lista não sabe ler filtro da URL | não — `filtroInicial` lia, e a precedência URL > sessionStorage > padrão estava escrita e comentada |
| a página da folha redireciona e perde a query | não — é Server Component, não redireciona |

A navegação **Anterior / Próxima**, da mesma barra, funcionava. Era o mesmo mecanismo, a mesma
querystring, a mesma fonte única (`folhaNavegacao.ts`). Só o voltar falhava.

## A causa: QUANDO a lista lia a URL

`filtroInicial` era chamada dentro dos inicializadores de `useState`, ou seja, **durante o
render**:

```tsx
if (window.location.search) return lerFiltrosFolha(window.location.search)[campo]
```

No App Router quem atualiza a barra de endereços é o `HistoryUpdater` do Next, e ele faz isso
num **`useInsertionEffect`** — medido no pacote instalado (`next@15.5.19`,
`node_modules/next/dist/client/components/app-router.js`, o `pushState` na linha 111). Insertion
effect roda no commit: **depois** do render.

Então, no primeiro render de quem chega por `router.push`, `window.location` ainda é a **URL da
folha**:

```
?origem=mes%3D9%26ano%3D2026%26unidade%3D<uuid>
```

Essa string é *truthy*, então a condição passava. Mas ela não tem `mes`, não tem `unidade`, não
tem `folha`: `lerFiltrosFolha` devolvia o **padrão** — e o `sessionStorage`, que teria os valores
certos, **nem era consultado**, justamente porque "havia query".

🚨 **A falha era silenciosa dos dois lados**: a URL continha os filtros, a lista os ignorava, e
o efeito seguinte reescrevia a barra de endereços com os padrões — apagando a prova.

ℹ️ **Por que `/escalas` escapa disso:** ela lê a URL dentro de um `useEffect` (`init`), que roda
depois do insertion effect. Mesma ideia, ordem diferente, resultado oposto. As setas
Anterior/Próxima da própria folha também leem em `useEffect` — daí funcionarem.

## A correção

A query passa a vir do **roteador**, não do `window`:

```tsx
const paramsDaEntrada = useSearchParams()
const queryDeEntrada = useRef(paramsDaEntrada.toString()).current
```

`useSearchParams` é avaliado no render e já reflete a URL de **destino** — é o estado que causou
aquele render. Congelado com `useRef` porque a tela reescreve a própria URL a cada filtro
(`history.replaceState`), e os inicializadores só podem enxergar o estado de entrada.

`filtroInicial(query, campo, chaveSessao)` passou a **receber** a query em vez de descobri-la
sozinha, e as 11 chamadas passam a mesma — inclusive as duas que rodam mais tarde, dentro do
`init()`, para a precedência ser uma só em todos os pontos.

⚠️ **O conteúdo foi para dentro de um `<Suspense>`.** `useSearchParams` num componente cliente
exige limite de Suspense no App Router. O layout do dashboard já é dinâmico (lê cookies), então
o build passaria sem ele — o limite está lá para uma mudança de layout não transformar a página
inteira em client-side rendering, mesmo cuidado já tomado em `SetoresClient`.

## A varredura

`window.location.search` aparece em **5 sítios** do repositório. Quatro estão dentro de
`useEffect` (`/escalas`, `NavegacaoEscalas`, `NavegacaoFolhas`) e por isso leem a URL já
atualizada. O quinto era este. Não há outro caso da mesma classe hoje.

## A lição transferível

🚨 **No App Router, `window.location` durante o render é a URL de ONDE VOCÊ VEIO.** Qualquer
decisão tomada no render a partir dela — filtro inicial, estado inicial, redirecionamento —
decide com a página anterior. Quem precisa da URL no render usa `useSearchParams` /
`usePathname`; `window.location` só é confiável dentro de effect.

⚠️ E o agravante que transformou "ler cedo demais" em "perder o filtro": a condição era
`if (query)`, não `if (query tem os campos)`. **Uma query que existe mas não é a sua faz um
fallback bem escrito ser pulado** — o sessionStorage tinha a resposta certa e ficou fora do
caminho.

## Portões

| arquivo | o que cobre |
|---|---|
| `scratchpad/sim_volta_a_lista_folha.js` | 25 asserções: a ida e a volta ponta a ponta (CAPS III, 09/2026, página 3), a prova de que a query da folha **não** é uma query de filtros, e a estrutura da tela (query do roteador, congelada, sem `window.location.search`, todas as chamadas passando a query, precedência URL > sessionStorage, Suspense, e os dois caminhos de abertura levando a origem) |
| `scratchpad/val_sim_volta_a_lista_folha.js` | injeta **8 regressões nos arquivos reais** e exige reprovação nas 8 — incluindo o retorno exato da causa original |

⚠️ O validador confere que **cada substituição foi aplicada** antes de rodar o portão: injeção
que não casa por uma diferença de espaço "passaria" sem ter testado nada (armadilha 48).

A varredura de `window.location.search` no portão roda sobre **código**, não sobre o arquivo
cru: o comentário acima de `filtroInicial` cita a expressão de propósito, e a linha da
sincronização usa `window.location.pathname`, que é legítima.

## Verificação

`npx tsc --noEmit` limpo, `npm run build` completo, `npm run lint` sem erros novos (só o
`exhaustive-deps` de sempre, para uma constante congelada por desenho).

## O manual não mudou

`SUPORTE → Ajuda` já dizia o comportamento certo — *"Devolve a listagem com os filtros e a página
que você tinha. Você não precisa escolher tudo de novo."* Era o código que divergia do que estava
escrito, não o contrário.
