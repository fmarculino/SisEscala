/**
 * Montagem de HTML segura para os geradores de relatório — FONTE ÚNICA.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE (achado 6 da auditoria de 30/08/2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Cinco telas montam o relatório com template string e chamam `win.document.write(...)`:
 *
 *   afastamentos/page.tsx · auditoria/page.tsx · folha-ponto/page.tsx
 *   relatorios/_components/ReportActions.tsx · servidores/ServidoresClient.tsx
 *
 * Texto vindo do banco entrava sem escape nenhum — **não existia função de escape no projeto**
 * e não há biblioteca de sanitização no `package.json`.
 *
 * ⚠️ **`window.open('')` abre `about:blank`, que HERDA a origem da aplicação.** Script injetado
 * ali não roda numa página neutra: roda como o SisEscala, com a sessão de quem imprimiu o
 * relatório. E não há CSP para servir de segunda barreira.
 *
 * O caminho mais curto, confirmado: `logs_tentativas_presenca.matricula_digitada` e
 * `mensagem_erro` guardam **cru** o que foi digitado no terminal de ponto
 * (`fn_log_tentativa_negada`). Quem tem acesso físico ao terminal digita uma "matrícula" com
 * HTML, a batida falha, a linha entra no log — e o script executa quando um coordenador imprime
 * a Auditoria. É escalada de quem está no corredor para a sessão de quem administra.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * O DESENHO: escapar por OMISSÃO, e exigir marca explícita para não escapar
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A alternativa era chamar `escapar(...)` em cada interpolação — são **116** delas nos 5
 * arquivos. Esquecer uma reabre o buraco **em silêncio**, e ninguém revisa 116 sítios de novo.
 *
 * Com a tag `h`, o modo de falha inverte:
 *
 *   - esqueceu de marcar um fragmento HTML  →  ele aparece como TEXTO na tela. Feio, visível,
 *     inofensivo, e alguém conserta no mesmo dia.
 *   - esqueceu de escapar texto do banco    →  impossível: é o comportamento padrão.
 *
 * ```ts
 * const linhas = itens.map(i => h`<tr><td>${i.nome}</td></tr>`)   // nome escapado
 * const html   = h`<table>${linhas}</table>`                      // array de h: passa direto
 * win.document.write(html.toString())
 * ```
 *
 * ⚠️ **`raw()` é a única porta de saída, e cada uso precisa ser justificável.** Use só para
 * fragmento HTML que VOCÊ escreveu no código — nunca para valor que veio do banco, da URL ou
 * de um formulário. Portão: `scratchpad/sim_html_seguro.mjs`.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

/**
 * Escapa os caracteres que dão significado a um valor dentro de HTML.
 *
 * ⚠️ `&` PRECISA ser o primeiro da classe de caracteres, senão `<` viraria `&lt;` e o `&` dele
 * seria escapado de novo (`&amp;lt;`), imprimindo `&lt;` literal na tela.
 *
 * Escapa aspas simples e crase além das duplas: atributo sem aspas (`class=${x}`) e atributo
 * entre aspas simples são erros comuns, e o escape não pode depender de quem escreveu o
 * template ter usado aspas duplas.
 */
export function escaparHtml(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor).replace(/[&<>"'`]/g, (c) => ESCAPES[c])
}

/** Marca um trecho como HTML já pronto. Nada aqui dentro é escapado — ver o aviso sobre `raw`. */
export class HtmlSeguro {
  constructor(private readonly conteudo: string) {}
  toString(): string {
    return this.conteudo
  }
}

/**
 * Declara que a string JÁ é HTML confiável e não deve ser escapada.
 *
 * ⚠️ Só para markup escrito no código. Passar valor de banco por aqui reintroduz exatamente o
 * achado 6 — e passa despercebido, porque `raw()` parece uma anotação inofensiva.
 */
export function raw(html: string): HtmlSeguro {
  return new HtmlSeguro(html)
}

function interpolar(valor: unknown): string {
  if (valor instanceof HtmlSeguro) return valor.toString()
  // Array de pedaços (o caso `itens.map(i => h`...`)`) — cada item segue a mesma regra.
  if (Array.isArray(valor)) return valor.map(interpolar).join('')
  return escaparHtml(valor)
}

/**
 * Template literal que escapa toda interpolação, exceto o que for `HtmlSeguro` (vindo de outro
 * `h` ou de `raw`).
 */
export function h(partes: TemplateStringsArray, ...valores: unknown[]): HtmlSeguro {
  let saida = partes[0]
  for (let i = 0; i < valores.length; i++) {
    saida += interpolar(valores[i]) + partes[i + 1]
  }
  return new HtmlSeguro(saida)
}
