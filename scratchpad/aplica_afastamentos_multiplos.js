/**
 * Aplica a leitura de MULTIPLOS afastamentos por dia nas quatro copias da geracao de folha.
 *
 * Duas em folha-ponto/actions.ts (executeGerarFolhaPonto, sincronizarFolhaPonto) e duas em
 * consultar-escala/actions.ts (gerarFolhaPontoServidor, sincronizarFolhaPontoServidor).
 * Aborta se a contagem de ocorrencias divergir do esperado — o mesmo padrao de
 * scratchpad/aplica_preservacao.js. Idempotente: reexecutar nao muda nada.
 */
const fs = require('fs')

const ALVOS = [
  { arquivo: 'src/app/(dashboard)/folha-ponto/actions.ts', copias: 2 },
  { arquivo: 'src/app/consultar-escala/actions.ts', copias: 2 },
]

// [regex, substituicao, ocorrencias esperadas por copia]
const SUBS = [
  [/const rawAfastamento = afastamentos\?\.find\(\(?af(?:: any)?\)? => dateStr >= af\.data_inicio && dateStr <= af\.data_fim\)/g,
   'const afastamentosDia = afastamentosDoDia(afastamentos, dateStr)', 1],
  [/const afastamento = isShiftOverlappingAfastamento\(rawAfastamento, (shift|currentShift)\) \? rawAfastamento : null/g,
   (_m, s) => `const afastamentosAnulantes = afastamentosDia.filter(af => isShiftOverlappingAfastamento(af, ${s}))`, 1],
  [/afastamento: afastamento \? getAfastamentoObservacao\(afastamento\) : null/g,
   'afastamento: afastamentosAnulantes.length > 0 ? descreverAfastamentos(afastamentosAnulantes) : null', 1],
  [/if \(rawAfastamento\) \{/g, 'if (afastamentosDia.length > 0) {', 4],
  [/getAfastamentoObservacao\(rawAfastamento\)/g, 'descreverAfastamentos(afastamentosDia)', 4],
]

// Helpers locais que passam a vir do modulo compartilhado.
const BLOCO_HELPERS = /function getAfastamentoNome\(tiposEventos: any\): string \| null \{[\s\S]*?\n\}\r?\n\r?\nfunction getAfastamentoObservacao\(af: any\): string \{[\s\S]*?\n\}\r?\n\r?\nfunction isShiftOverlappingAfastamento\(afastamento: any, shift: any\): boolean \{[\s\S]*?\n\}\r?\n/

const IMPORT = "import { afastamentosDoDia, descreverAfastamentos, getAfastamentoObservacao, isShiftOverlappingAfastamento } from '@/utils/folha/afastamentosDia'"

let mudou = false

for (const { arquivo, copias } of ALVOS) {
  const antes = fs.readFileSync(arquivo, 'utf8')
  const crlf = antes.includes('\r\n')
  const nl = crlf ? '\r\n' : '\n'

  if (antes.includes('afastamentosDoDia(')) {
    console.log(`= ${arquivo}: ja aplicado, nada a fazer`)
    continue
  }

  let texto = antes
  for (const [re, rep, porCopia] of SUBS) {
    const esperado = porCopia * copias
    const achou = (texto.match(re) || []).length
    if (achou !== esperado) {
      throw new Error(`${arquivo}: padrao ${re} apareceu ${achou}x, esperado ${esperado}x`)
    }
    texto = texto.replace(re, rep)
  }

  // Remove os tres helpers locais (duplicados entre os dois arquivos) e importa a fonte unica.
  const achouBloco = (texto.match(BLOCO_HELPERS) || []).length
  if (achouBloco !== 1) {
    throw new Error(`${arquivo}: bloco dos helpers locais apareceu ${achouBloco}x, esperado 1x`)
  }
  texto = texto.replace(BLOCO_HELPERS, '')

  // O import entra depois do ultimo import ja existente no topo do arquivo.
  const imports = [...texto.matchAll(/^import .*$/gm)]
  if (imports.length === 0) throw new Error(`${arquivo}: nenhum import encontrado`)
  const ultimo = imports[imports.length - 1]
  const fim = ultimo.index + ultimo[0].length
  texto = texto.slice(0, fim) + nl + IMPORT + texto.slice(fim)

  // Conferencia estrutural: nada de rawAfastamento sobrando, e os simbolos novos presentes.
  if (/rawAfastamento/.test(texto)) throw new Error(`${arquivo}: sobrou referencia a rawAfastamento`)
  if ((texto.match(/const afastamentosDia = /g) || []).length !== copias) {
    throw new Error(`${arquivo}: afastamentosDia declarado fora das ${copias} copias`)
  }
  if ((texto.match(/const afastamentosAnulantes = /g) || []).length !== copias) {
    throw new Error(`${arquivo}: afastamentosAnulantes declarado fora das ${copias} copias`)
  }
  if ((texto.match(/^import .*afastamentosDia'$/gm) || []).length !== 1) {
    throw new Error(`${arquivo}: import da fonte unica nao ficou unico`)
  }

  fs.writeFileSync(arquivo, texto)
  mudou = true
  console.log(`+ ${arquivo}: ${copias} copias atualizadas`)
}

console.log(mudou ? 'ok' : 'nada mudou')
