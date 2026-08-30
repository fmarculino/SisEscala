# Fase 2 da auditoria: XSS armazenado nos relatórios e cabeçalhos de segurança (30/08/2026)

Continuação de [`2026-08-30-fase1-auditoria-de-seguranca.md`](2026-08-30-fase1-auditoria-de-seguranca.md).
Cobre os achados 6, 16 e 17.

---

## 1. Cinco geradores de relatório escreviam HTML sem escape nenhum

Cinco telas montam o relatório com template string e chamam `win.document.write(...)`:

```
afastamentos/page.tsx:1240 · auditoria/page.tsx:479 · folha-ponto/page.tsx:745
relatorios/_components/ReportActions.tsx:64 · servidores/ServidoresClient.tsx:309
```

**Não existia função de escape no projeto** — zero ocorrências de `escapeHtml` — e não há
biblioteca de sanitização no `package.json`.

⚠️ **`window.open('')` abre `about:blank`, que HERDA a origem da aplicação.** Script injetado ali
não roda numa página neutra: roda **como o SisEscala**, com a sessão de quem imprimiu. E não
havia CSP para servir de segunda barreira.

### O caminho mais curto do ataque, confirmado no código

`fn_log_tentativa_negada` (`20260721203000`) grava **cru** o que foi digitado no terminal de ponto:

```sql
INSERT INTO public.logs_tentativas_presenca (matricula_digitada, mensagem_erro, ...)
```

E `/auditoria` imprime esses dois campos. Então:

1. alguém no terminal digita uma "matrícula" contendo HTML;
2. a batida falha e a linha entra em `logs_tentativas_presenca`;
3. um coordenador abre a Auditoria e clica em imprimir;
4. o script roda **com a sessão do coordenador**.

Por isso `/auditoria` foi o primeiro dos cinco.

### A correção: escapar por OMISSÃO, não sítio a sítio

O inventário deu **116 interpolações** nos 5 arquivos. Chamar `escapar(...)` em cada uma tem um
problema estrutural: esquecer **uma** reabre o buraco em silêncio, e ninguém revisa 116 sítios de
novo. Pior — as 116 não são homogêneas: há ternários que devolvem **fragmento HTML**
(`? '<span…>' : ''`) e outros que devolvem **classe CSS**. Escapar em bloco quebraria os
relatórios.

**Fonte única: `src/utils/htmlSeguro.ts`** — uma tag de template literal que escapa toda
interpolação, com `raw()` como única saída explícita.

⚠️ **O ganho não é o escape, é a INVERSÃO DO MODO DE FALHA:**

| esqueceu de… | antes | agora |
|---|---|---|
| escapar texto do banco | XSS silencioso | **impossível** — é o padrão |
| marcar um fragmento HTML | — | tag aparece como **texto** na tela: feio, visível, inofensivo |

A conversão não tocou no conteúdo de nenhum literal: o script
(`scratchpad/gen_html_seguro.js`) só inseriu `h` antes da crase de abertura. **42 literais**
marcados, **3** usos de `raw()`, todos com string literal escrita no código.

⚠️ **Regex não serve para achar template literal.** Eles ANINHAM
(`` `...${ cond ? `outro` : '' }...` ``), e regex não conta profundidade — pegaria o pedaço errado
e produziria arquivo que nem compila. O gerador tem um scanner que rastreia aspas, comentários e
a profundidade de `${}`.

⚠️ **`.join('')` DESFAZ a marcação, e o compilador não avisa.** `itens.map(i => h\`…\`)` devolve
`HtmlSeguro[]`; o `.join('')` transforma isso numa string comum e o literal externo passa a
**escapar** aquelas linhas. Como `h` já concatena array, os **13** `.join('')` saíram. Foi
justamente o modo de falha visível funcionando: `tsc` pegou um deles (`let tableRows = ''`
tipado como string), e os outros 12 vieram por varredura.

⚠️ **`folha-ponto/page.tsx` tinha um `const h` local** (horas, em `formatMinutesToTimeStr`) que
sombreava a tag importada. Renomeado para `horas`. Não quebrava nada hoje — quebraria no dia em
que alguém escrevesse um literal marcado dentro daquela função, com `h is not a function` em
tempo de execução e **nenhum erro de compilação**.

ℹ️ Conferido que o escape **não** danifica o que já funcionava: nenhum bloco `<style>` interpola
valor (escapar `>` quebraria seletor CSS), e as três interpolações em `src="…"` são URLs, onde
escapar aspas é exatamente o que impede quebra de atributo.

---

## 2. Nenhum cabeçalho de segurança estava configurado

`next.config.js` não tinha `headers()`. Passou a ter cinco:

| cabeçalho | por quê |
|---|---|
| `X-Frame-Options: DENY` + `frame-ancestors 'none'` | clickjacking |
| `X-Content-Type-Options: nosniff` | impede o navegador de "adivinhar" o tipo de um arquivo servido |
| `Referrer-Policy: strict-origin-when-cross-origin` | a URL interna carrega id de servidor, unidade e competência |
| `Permissions-Policy` | ⚠️ `geolocation=(self)`, **não** vazio: a chegada do sobreaviso confere GPS |
| `Content-Security-Policy-Report-Only` | ver abaixo |

🚨 **A CSP vai em `Report-Only` de propósito, e trocar o nome do cabeçalho sem antes ler os
relatos quebra quatro coisas ao mesmo tempo:**

1. os 5 relatórios abrem `window.open('')` e carregam o Tailwind de `cdn.tailwindcss.com` —
   e `about:blank` **herda** a CSP de quem abriu;
2. o Tailwind por CDN gera CSS em tempo de execução, o que exige `'unsafe-inline'` em `style-src`;
3. o Next injeta script inline de hidratação, e o layout raiz publica `window.__SISESCALA_TZ__`
   num `<script>` inline;
4. **o terminal de ponto fica aberto por DIAS** numa tela de portaria e não recarrega sozinho —
   uma CSP que quebre a página lá não aparece para ninguém até alguém ir até o equipamento.

O caminho para endurecer: rodar em Report-Only, ler os relatos, tirar o `'unsafe-inline'` de
`script-src` com nonce, e só então trocar para `Content-Security-Policy`.

ℹ️ `'unsafe-eval'` ficou **fora** desde já — conferido que nada no projeto usa `eval`/`new
Function`.

Conferido por fora, com o servidor rodando: os cinco cabeçalhos saem em `/login`.

---

## 3. Achado 17 — `JSON.stringify` não fecha `</script>`

O layout raiz publica o fuso num `<script>` inline. `JSON.stringify` escapa aspas e barras, mas
deixa `<` e `>` intactos — e dentro de um `<script>` a sequência `</script>` **fecha a tag onde
quer que apareça, inclusive dentro de uma string**.

Só `admin`/`super_admin` escrevem `configuracoes_globais.timezone`, então o alcance real é
admin→admin. A correção é uma linha (`.replace(/</g, …)`) e a regra vale para qualquer script
inline.

---

## Portões

| script | o que prova |
|---|---|
| `scratchpad/sim_html_seguro.mjs` | **21 casos** da primitiva: escape simples, `&` escapado uma única vez, quebra de atributo com aspas simples **e** duplas, `h` aninhado, array de `h`, `raw`, e o payload real do terminal |
| `scratchpad/sim_relatorio_render.mjs` | **12 casos** de ponta a ponta: renderiza o template compartilhado com dados reais **+** payload de ataque e exige as duas coisas — o HTML continua HTML **e** o payload não vira tag |

⚠️ **Os dois foram validados desligando o escape de propósito**: caem para 8/21 e 8/12. Portão
que nunca falha não vale nada.

ℹ️ Uma asserção minha estava errada e quase virou "correção" indevida: eu procurava `onerror=`
no HTML e ele **aparece** — dentro do texto escapado (`&lt;img src=x onerror=&quot;…`), onde é
inerte. A asserção certa é que **toda** ocorrência esteja em texto escapado, não que a palavra
não exista. Ao escrever portão de XSS, não confunda "a palavra aparece" com "a palavra executa".

---

## O que esta fase NÃO fez

- **Os 4 geradores dentro de componentes React não foram renderizados de ponta a ponta** — só o
  template compartilhado (`report-templates.ts`), que é função pura. Nos outros quatro a garantia
  vem do `tsc`, da varredura de `.join('')` e da inspeção; o teste real é abrir cada relatório.
- **CSP continua sem bloquear nada** (Report-Only), por desenho.
- **321 RPCs ainda visíveis ao `anon`** (item 13, Fase 3).
