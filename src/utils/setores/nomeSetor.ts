/**
 * Nome de setor: normalizacao e deteccao de nome parecido — fonte unica.
 *
 * 🚨 POR QUE EXISTE. `resolverDicionarioSetor` busca o nome com `.eq('nome', nome)` e **cria uma
 *   entrada nova sempre que nao acha** — entao o dicionario cresce por digitacao livre. Medido em
 *   14/09/2026: 250 entradas, e a familia ASG sozinha tinha 5 variacoes
 *   (`ASG`, `ASG AGENTE DE SERVICOS GERAIS`, `SERVICOS GERAIS`, `ASG / ALMOXARIFE / AUXILIAR`,
 *   `COPEIRA/ASG/COZINHEIRO`). Duas delas — `SERVICOS GERAIS` (27 setores, 76 lotados) e `ASG`
 *   (1 setor, 10 lotados) — eram sinonimo puro e foram padronizadas.
 *
 *   O estrago nao fica no cadastro: com dois nomes validos na mesma unidade, a transferencia
 *   oferece os dois na arvore de destino e quem aprova escolhe o que **bate com o nome do setor de
 *   origem**. Foi assim que BEATRIZ (mat. 69158) foi transferida da SMS para
 *   `USF Pedro Cavalcante \ SERVICOS GERAIS` em 14/09/2026, ficando sozinha num setor paralelo ao
 *   `ASG AGENTE DE SERVICOS GERAIS` onde estavam as 4 colegas. O sistema **ja pedia** o setor de
 *   destino explicitamente: o defeito era a lista ter duas opcoes onde so uma era valida.
 *
 * ⚠️ AVISO QUE GRITA A TOA E O CAMINHO MAIS CURTO PARA NINGUEM MAIS LER NENHUM. Os criterios daqui
 *   foram calibrados contra o dicionario real (`scratchpad/an_ruido_nome_setor.mjs`) — ao mexer
 *   neles, meca de novo o ruido antes de subir.
 */

/** Palavras que nao distinguem setor nenhum — entram no texto, nunca na comparacao. */
const LIGACOES = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA'])

/**
 * Forma canonica para COMPARAR (nunca para exibir nem para gravar).
 *
 * ⚠️ Preserva o nome original em `dicionario_setores.nome`: a normalizacao decide se dois nomes
 *   sao o mesmo, nao como o nome aparece na tela.
 */
export function normalizarNomeSetor(nome: string): string {
  return (nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // tira acento: SERVIÇOS -> SERVICOS
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')       // pontuacao vira separador: ASG/ALMOXARIFE -> ASG ALMOXARIFE
    .trim()
    .replace(/\s+/g, ' ')
}

/** Palavras significativas do nome, na forma canonica. */
export function palavrasSignificativas(nome: string): string[] {
  return normalizarNomeSetor(nome).split(' ').filter(p => p && !LIGACOES.has(p))
}

/** Distancia de edicao (Levenshtein), usada so para pegar erro de digitacao. */
function distancia(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m || !n) return m || n
  let ant = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const atual = [i]
    for (let j = 1; j <= n; j++) {
      atual[j] = Math.min(
        ant[j] + 1,
        atual[j - 1] + 1,
        ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    ant = atual
  }
  return ant[n]
}

/**
 * Erro de digitacao = os dois nomes tem as MESMAS palavras, menos uma, e essa uma difere por uma
 * letra so'.
 *
 * 🚨 A comparacao e' palavra a palavra, nunca sobre o nome inteiro, e isso saiu de medicao: com a
 *   distancia sobre a string toda, `BLOCO A SHL` acusava `BLOCO B SHL` e `BLOCO A` acusava
 *   `BLOCO B` — a letra que "sobra" ali e' justamente o que distingue os dois setores. Dai o piso
 *   de 4 letras na palavra divergente: em palavra longa uma letra a mais e' engano
 *   (`MAQUEIRO`/`MAQUEIROS`, `LABORATORIO`/`LABORATORIOS`); em palavra curta e' identificador.
 */
function ehErroDeDigitacao(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false
  const divergentes: Array<[string, string]> = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) divergentes.push([a[i], b[i]])
  if (divergentes.length !== 1) return false
  const [x, y] = divergentes[0]
  return Math.min(x.length, y.length) >= 4 && distancia(x, y) === 1
}

export type MotivoParecido = 'identico' | 'contido' | 'digitacao'

export interface NomeParecido {
  nome: string
  motivo: MotivoParecido
}

/**
 * `identico` = mesmo nome depois de normalizar (so muda caixa, acento ou pontuacao).
 *
 * ⚠️ Este caso NAO vira pergunta: `SERVICOS GERAIS` e `SERVIÇOS GERAIS` sao o mesmo setor, e
 *   oferecer escolha ali so ensina a clicar sem ler. Quem resolve e' `resolverDicionarioSetor`,
 *   reusando a entrada existente.
 */
export function encontrarNomeIdentico(nome: string, existentes: string[]): string | null {
  const alvo = normalizarNomeSetor(nome)
  if (!alvo) return null
  return existentes.find(e => normalizarNomeSetor(e) === alvo) ?? null
}

/**
 * Nomes do dicionario parecidos com o digitado, do mais forte para o mais fraco.
 *
 * - `contido`: todas as palavras significativas de um lado aparecem no outro
 *   (`SERVICOS GERAIS` dentro de `ASG AGENTE DE SERVICOS GERAIS`). E o caso que gerou a
 *   duplicidade real, entao e o que mais importa pegar.
 * - `digitacao`: UMA letra trocada, faltando ou sobrando (`MAQUEIRO` x `MAQUEIROS`).
 *
 * 🚨 OS DOIS CORTES ABAIXO SAIRAM DE MEDICAO, NAO DE INTUICAO — a primeira versao disparava em
 *   **94 dos 248** nomes do dicionario (37,9%), e um aviso que grita a toa ensina a clicar sem ler:
 *
 *   1. **o lado menor precisa ter 2+ palavras significativas.** Com 1 palavra o alerta pega a
 *      familia inteira: `ENFERMAGEM` casava com `TEC ENFERMAGEM`, `DIRETOR DE ENFERMAGEM` e
 *      `AMBULATORIO DE ENFERMAGEM`; `PEDIATRIA` com as quatro `PEDIATRIA - *`. Sao setores
 *      diferentes de verdade. O caso que motivou tudo (`SERVICOS GERAIS`, 2 palavras) continua pego.
 *   2. **uma letra numa palavra longa, nunca distancia 2 sobre o nome inteiro.** Com 2, `CARDIOLOGIA` acusava `RADIOLOGIA`,
 *      `MAMOGRAFIA` acusava `TOMOGRAFIA` e `PORTARIA EXTERNA` acusava `PORTARIA INTERNA` — pares
 *      legitimos, e sugerir fundir qualquer um deles seria conselho errado. Com 1 sobra o que
 *      importa: singular/plural e letra trocada (`MAQUEIRO`/`MAQUEIROS`,
 *      `PANEJAMENTO`/`PANEJAMENTOS`, `LABORATORIO`/`LABORATORIOS`).
 */
export function sugerirNomesParecidos(nome: string, existentes: string[], limite = 5): NomeParecido[] {
  const alvo = normalizarNomeSetor(nome)
  const palavrasAlvo = palavrasSignificativas(nome)
  if (!alvo || palavrasAlvo.length === 0) return []

  const achados: NomeParecido[] = []
  for (const existente of existentes) {
    const outro = normalizarNomeSetor(existente)
    if (!outro || outro === alvo) continue          // identico tem caminho proprio
    const palavrasOutro = palavrasSignificativas(existente)
    if (palavrasOutro.length === 0) continue

    const menor = palavrasAlvo.length <= palavrasOutro.length ? palavrasAlvo : palavrasOutro
    const maior = menor === palavrasAlvo ? palavrasOutro : palavrasAlvo
    if (menor.length >= 2 && menor.every(p => maior.includes(p))) {
      achados.push({ nome: existente, motivo: 'contido' })
      continue
    }

    if (ehErroDeDigitacao(palavrasAlvo, palavrasOutro)) {
      achados.push({ nome: existente, motivo: 'digitacao' })
    }
  }

  const peso: Record<MotivoParecido, number> = { identico: 0, contido: 1, digitacao: 2 }
  return achados
    .sort((a, b) => peso[a.motivo] - peso[b.motivo] || a.nome.localeCompare(b.nome))
    .slice(0, limite)
}

/** Texto do aviso — o mesmo na tela e na recusa do servidor, para nao divergirem. */
export function descreverNomesParecidos(nome: string, parecidos: NomeParecido[]): string {
  if (parecidos.length === 0) return ''
  const lista = parecidos.map(p => `"${p.nome}"`).join(', ')
  return `Já existe ${parecidos.length === 1 ? 'o setor' : 'os setores'} ${lista} no cadastro. `
    + `Criar "${nome.trim().toUpperCase()}" como nome novo deixa os dois valendo ao mesmo tempo, e quem for `
    + `transferir um servidor vai ver as duas opções na lista. Use o nome que já existe ou confirme que este é outro setor.`
}
