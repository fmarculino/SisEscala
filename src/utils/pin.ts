/**
 * Regras de PIN — o lado TypeScript.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A REGRA VALE NA ESCRITA, NUNCA NA LEITURA (30/08/2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * O login compara hash bcrypt e não sabe quantos dígitos o PIN tem. Então **PIN de 4 dígitos já
 * emitido continua entrando para sempre** — no Portal e no terminal de ponto. O piso de 6 dígitos
 * alcança exclusivamente quem **define um PIN novo**.
 *
 * ⚠️ Quem for mexer nisso: forçar a troca dos antigos seria barrar no LOGIN, e aí sim tira gente
 * do ar. É uma decisão diferente desta, e não foi tomada.
 *
 * ⚠️ **A autoridade é o banco, não este arquivo.** `fn_validar_pin_novo` roda dentro do trigger
 * `hash_servidor_pin`, por onde todo PIN passa antes de virar hash — as duas telas do coordenador
 * e a RPC do portal caem nele. O que existe aqui serve para **avisar antes de salvar** e para
 * traduzir o código de recusa; nunca para substituir a checagem. Se as duas divergirem, quem
 * decide é o banco, e o usuário vê a mensagem de `mensagemRecusaPin`.
 */

/** Espelha o default de `pin_min_digitos` em `configuracoes_globais`. */
export const PIN_MIN_DIGITOS = 6
export const PIN_MAX_DIGITOS = 8

/** Códigos devolvidos por `fn_validar_pin_novo` / `fn_trocar_pin_portal`. */
export type MotivoRecusaPin =
  | 'vazio'
  | 'nao_numerico'
  | 'curto'
  | 'longo'
  | 'repetido'
  | 'sequencia'
  | 'igual_matricula'

/**
 * Traduz o código estruturado do banco. O SQL devolve código, nunca frase pronta — assim a copy
 * em português vive num lugar só, em vez de num COMMENT de migration que ninguém revisa.
 */
export function mensagemRecusaPin(
  motivo: string | undefined,
  extras?: { minimo?: number; maximo?: number }
): string {
  const min = extras?.minimo ?? PIN_MIN_DIGITOS
  const max = extras?.maximo ?? PIN_MAX_DIGITOS

  switch (motivo) {
    case 'vazio':
      return 'Digite o novo PIN.'
    case 'nao_numerico':
      return 'O PIN deve conter apenas números.'
    case 'curto':
      return `O PIN precisa ter pelo menos ${min} dígitos.`
    case 'longo':
      return `O PIN pode ter no máximo ${max} dígitos.`
    case 'repetido':
      return 'Não use o mesmo dígito repetido (como 000000).'
    case 'sequencia':
      return 'Não use uma sequência (como 123456 ou 654321).'
    case 'igual_matricula':
      return 'O PIN não pode ser a sua matrícula — ela aparece em todo lugar do sistema.'
    default:
      return `Escolha um PIN de ${min} a ${max} dígitos, sem repetir o mesmo dígito e sem sequência.`
  }
}

/** Espelho de `fn_pin_e_sequencia`: todo par de dígitos vizinhos difere de +1, ou de −1. */
function ehSequencia(pin: string): boolean {
  if (pin.length < 2) return false
  let cresce = true
  let decresce = true
  for (let i = 0; i < pin.length - 1; i++) {
    const passo = pin.charCodeAt(i + 1) - pin.charCodeAt(i)
    if (passo !== 1) cresce = false
    if (passo !== -1) decresce = false
  }
  return cresce || decresce
}

/**
 * Espelho de `fn_validar_pin_novo` para dar retorno imediato na tela. Devolve `null` quando passa.
 * Ver o aviso do cabeçalho: isto **não** é a checagem que vale.
 */
export function conferirPinNovo(pin: string, matricula?: string | null): string | null {
  if (!pin || !pin.trim()) return mensagemRecusaPin('vazio')
  if (!/^[0-9]+$/.test(pin)) return mensagemRecusaPin('nao_numerico')
  if (pin.length < PIN_MIN_DIGITOS) return mensagemRecusaPin('curto')
  if (pin.length > PIN_MAX_DIGITOS) return mensagemRecusaPin('longo')
  if (new Set(pin).size === 1) return mensagemRecusaPin('repetido')
  if (ehSequencia(pin)) return mensagemRecusaPin('sequencia')
  if (matricula && pin === matricula.replace(/[^0-9]/g, '')) return mensagemRecusaPin('igual_matricula')
  return null
}

/**
 * Gera um PIN que **passa** na regra.
 *
 * ⚠️ O gerador antigo era `Math.floor(1000 + Math.random() * 9000)` — 4 dígitos, 9.000
 * possibilidades. Ele ficou nas duas telas do coordenador; sem trocá-lo aqui, o botão "Gerar PIN"
 * produziria um valor que o próprio banco recusa, e a tela pareceria quebrada.
 *
 * ⚠️ E sortear às cegas não basta: `000000` e `123456` estão no espaço amostral. O laço redesenha
 * até passar, com teto — um `while (true)` num gerador é um travamento esperando um bug de regra.
 */
export function gerarPin(matricula?: string | null, digitos: number = PIN_MIN_DIGITOS): string {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    let pin = ''
    for (let i = 0; i < digitos; i++) pin += Math.floor(Math.random() * 10).toString()
    if (!conferirPinNovo(pin, matricula)) return pin
  }
  // Inalcançável na prática (a chance de 50 sorteios seguidos caírem em PIN inválido é
  // desprezível), mas um gerador precisa terminar. Este valor passa na regra por construção.
  return '482590'.slice(0, Math.max(PIN_MIN_DIGITOS, digitos))
}
