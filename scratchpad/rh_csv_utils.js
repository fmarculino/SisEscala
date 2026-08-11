/**
 * Utilitários compartilhados pelos scripts rh_*.js (mapeamento de unidades, normalização de
 * cargos, importação). Um módulo só para não divergir o parser/a correção de encoding entre eles.
 */

/** Parser CSV simples com suporte a campos entre aspas (podem conter vírgula). */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue }
        inQuotes = false; continue
      }
      field += c; continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

/**
 * Corrige mojibake (texto UTF-8 relido com outra codificação de 1 byte e regravado como UTF-8)
 * campo a campo.
 *
 * POR QUE ISTO EXISTE
 *   O CSV do RH NAO e uniformemente corrompido, e nao e um unico tipo de corrupcao - medido em
 *   10/08/2026: Bairro tem 4.360 ocorrencias de mojibake (via Latin-1), Cargo tem pelo menos um
 *   caso via Windows-1252 ("SERVIÇOS" virou "SERVIÃ‡OS" - o "Ç" foi relido com a pagina de codigo
 *   errada, nao so Latin-1 puro), e Nome/Departamento praticamente nao tem nenhum. Corrigir o
 *   arquivo inteiro de uma vez (reinterpretar tudo como Latin-1) QUEBRA os campos que ja estao
 *   certos - testado: introduz 1.194 caracteres de substituicao se aplicado ao arquivo inteiro.
 *
 *   Por isso a correcao e POR VALOR, e tenta CP-1252 (que cobre Latin-1 + os caracteres
 *   tipograficos da faixa 0x80-0x9F que o Windows usa nessa faixa - aspas curvas, travessao,
 *   "Ç" antes de acentuacao, etc.): reconstroi os bytes originais letra por letra usando o mapa
 *   reverso de CP-1252, decodifica como UTF-8, e SO aceita o resultado se (a) toda letra da
 *   entrada tinha um byte correspondente e (b) o resultado nao contem caractere de substituicao.
 *   Texto que ja esta certo nunca bate a assinatura e passa batido, sem alteracao.
 */
const decoderCp1252 = new TextDecoder('windows-1252')
const MAPA_REVERSO_CP1252 = new Map()
for (let b = 0x80; b <= 0x9f; b++) {
  MAPA_REVERSO_CP1252.set(decoderCp1252.decode(Uint8Array.of(b)), b)
}

// Assinatura minima pra tentar a reversao: 'Ã' ou 'Â' (primeiro byte de um par UTF-8 de 2 bytes
// relido 1 byte por vez) em algum lugar da string. Sem isso, nem tenta - a maioria dos valores
// não tem.
const RE_TEM_ASSINATURA = /[ÃÂ]/

function corrigirMojibake(v) {
  if (!v || !RE_TEM_ASSINATURA.test(v)) return v

  const bytes = []
  for (const ch of v) {
    const cp = ch.codePointAt(0)
    if (cp <= 0xff) { bytes.push(cp); continue }
    const byte = MAPA_REVERSO_CP1252.get(ch)
    if (byte === undefined) return v // caractere que nao existe em CP-1252 nessa faixa - desiste
    bytes.push(byte)
  }

  const tentativa = Buffer.from(bytes).toString('utf8')
  if (tentativa.includes('�')) return v // byte invalido como UTF-8 - a reversao nao fazia sentido
  return tentativa
}

module.exports = { parseCsv, corrigirMojibake }
