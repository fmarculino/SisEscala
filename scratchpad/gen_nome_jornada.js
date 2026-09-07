#!/usr/bin/env node
/**
 * Aplica normalizarNomeJornada() em TODOS os sitios que leem o nome da jornada por regex.
 *
 * POR QUE UM GERADOR: sao 12 substituicoes em 7 arquivos, e o modo de falha de esquecer uma e'
 * SILENCIOSO — a folha passa a comparar contra 08:00-17:00 e ninguem ve. O gerador aborta se
 * qualquer substituicao nao bater na contagem esperada, e nao escreve arquivo nenhum.
 *
 * ⚠️ O segundo argumento de String.replace nunca e' string aqui (armadilha do CLAUDE.md sobre
 * $$ e $'): tudo passa por split/join.
 *
 * Rodar:  node scratchpad/gen_nome_jornada.js
 *         node scratchpad/gen_nome_jornada.js --ensaio   (nao escreve, so relata)
 */
'use strict'
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const ENSAIO = process.argv.includes('--ensaio')

const GRID = 'src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx'
const EDITOR = 'src/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor.tsx'

/**
 * Cada entrada: [arquivo, texto original, texto novo, quantas ocorrencias esperar].
 * A contagem esperada e' o portao: 2 significa "existem exatamente duas copias identicas deste
 * trecho, e as duas tem que mudar".
 */
const TROCAS = [
  // --- ScaleGrid: getShiftStartHour / getShiftEndHour (sem flag i, so casam AS maiusculo) ----
  [GRID,
   'c.match(/^([0-9]+)\\s*H\\s*(?:AS|ÀS|A)\\s*([0-9]+)\\s*H/)',
   'normalizarNomeJornada(c).match(/^([0-9]+)\\s*H\\s*(?:AS|ÀS|A)\\s*([0-9]+)\\s*H/)', 2],

  [GRID,
   'jornada?.nome?.match(/(?:ÀS|AS|A)\\s*([0-9]+)/i)',
   'normalizarNomeJornada(jornada?.nome).match(/(?:ÀS|AS|A)\\s*([0-9]+)/i)', 1],

  [GRID,
   'jornada.nome.match(/(?:ÀS|AS|as|às)\\s*([0-9]+)/)',
   'normalizarNomeJornada(jornada.nome).match(/(?:ÀS|AS|as|às)\\s*([0-9]+)/)', 2],

  [GRID,
   'jornadaReg.nome.match(/(?:ÀS|AS|as|às)\\s*([0-9]+)/)',
   'normalizarNomeJornada(jornadaReg.nome).match(/(?:ÀS|AS|as|às)\\s*([0-9]+)/)', 1],

  // --- complianceEngine: interjornada e ancora do plantao diurno em jornada noturna ----------
  ['src/utils/complianceEngine.ts',
   '/(?:ÀS|AS|as|às)\\s*([0-9]+)/.exec(jornadaNome)',
   '/(?:ÀS|AS|as|às)\\s*([0-9]+)/.exec(normalizarNomeJornada(jornadaNome))', 1],

  ['src/utils/complianceEngine.ts',
   'jornadaNome.match(/(?:ÀS|AS|as|às)\\s*([0-9]+)/)',
   'normalizarNomeJornada(jornadaNome).match(/(?:ÀS|AS|as|às)\\s*([0-9]+)/)', 1],

  // --- os quatro que caem no default de 08:00-17:00 (o caso caro) ----------------------------
  ['src/app/(dashboard)/folha-ponto/actions.ts',
   'nome.match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)',
   'normalizarNomeJornada(nome).match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)', 1],

  ['src/app/consultar-escala/actions.ts',
   'nome.match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)',
   'normalizarNomeJornada(nome).match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)', 1],

  ['src/utils/folha/normalizarHorarios.ts',
   'jornadaNome.match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)',
   'normalizarNomeJornada(jornadaNome).match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)', 1],

  [EDITOR,
   'jornada.nome.match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)',
   'normalizarNomeJornada(jornada.nome).match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)', 1],

  [EDITOR,
   'recordJornadaNome.match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)',
   'normalizarNomeJornada(recordJornadaNome).match(/(\\d{1,2})(?:[hH:](\\d{2})?)?\\s*(?:às|as|to|-|a)\\s*(\\d{1,2})(?:[hH:](\\d{2})?)?/i)', 1],
]

// sequenciaDia.ts tem o regex numa constante, longe do .match — tratado a parte abaixo.
const SEQ = 'src/utils/folha/sequenciaDia.ts'

// calculoDia.ts ja normalizava inline (04/09/2026). Passa a usar a fonte unica, para a regra
// existir num lugar so.
const CALC = 'src/utils/folha/calculoDia.ts'

const IMPORT = "import { normalizarNomeJornada } from '@/utils/folha/nomeJornada'"
const IMPORT_REL = "import { normalizarNomeJornada } from './nomeJornada'"

const falhas = []
const arquivos = new Map()   // caminho -> conteudo em memoria

function ler(rel) {
  if (!arquivos.has(rel)) {
    const p = path.join(RAIZ, rel)
    if (!fs.existsSync(p)) { falhas.push(`arquivo ausente: ${rel}`); arquivos.set(rel, '') }
    else arquivos.set(rel, fs.readFileSync(p, 'utf8'))
  }
  return arquivos.get(rel)
}

function trocar(rel, de, para, esperado) {
  const txt = ler(rel)
  const partes = txt.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    falhas.push(`${rel}: esperava ${esperado} ocorrencia(s) de "${de.slice(0, 55)}…", achou ${achou}`)
    return
  }
  arquivos.set(rel, partes.join(para))
}

for (const [rel, de, para, n] of TROCAS) trocar(rel, de, para, n)

// --- sequenciaDia: o regex mora numa const, o .match vem depois ----------------------------
// ⚠️ Sem \n no padrao: os arquivos deste repositorio oscilam entre LF e CRLF (o git normaliza
// para CRLF ao restaurar), e um padrao que atravessa a quebra de linha deixa de casar sem aviso
// — vira exatamente o no-op silencioso da armadilha 48. Este trecho ja e' unico sozinho.
trocar(SEQ,
  'const match = jornadaNome.match(',
  'const match = normalizarNomeJornada(jornadaNome).match(', 1)

// --- calculoDia: passa a usar a fonte unica em vez do replace inline -------------------------
trocar(CALC,
  "  const semAcento = jornadaNome.replace(/[ÀÁàá]/g, 'a')",
  '  const semAcento = normalizarNomeJornada(jornadaNome)', 1)

// --- imports --------------------------------------------------------------------------------
// Alias `@/` nao resolve dentro de src/utils em todos os arquivos do projeto de forma uniforme,
// entao os de src/utils/folha usam caminho relativo e o resto usa o alias - exatamente como os
// vizinhos de cada arquivo ja fazem.
const IMPORTS = [
  [GRID, IMPORT],
  ['src/utils/complianceEngine.ts', "import { normalizarNomeJornada } from './folha/nomeJornada'"],
  ['src/app/(dashboard)/folha-ponto/actions.ts', IMPORT],
  ['src/app/consultar-escala/actions.ts', IMPORT],
  ['src/utils/folha/normalizarHorarios.ts', IMPORT_REL],
  [EDITOR, IMPORT],
  [SEQ, IMPORT_REL],
  [CALC, IMPORT_REL],
]

for (const [rel, linha] of IMPORTS) {
  let txt = ler(rel)
  if (txt.includes(linha)) continue
  // Depois do ultimo import COMPLETO do topo do arquivo, para nao furar o bloco de
  // 'use client'/'use server'.
  //
  // ⚠️ A ancora exige a linha INTEIRA, terminando no caminho do modulo entre aspas. A primeira
  // versao usava /^import .*$/ e casou com a linha `import {` de um import MULTILINHA em
  // FolhaPontoEditor.tsx - o import novo entrou no meio da lista de nomes e quebrou o arquivo
  // (TS1003 na linha seguinte). Import multilinha e comum neste projeto; a ancora tem que
  // reconhece-lo como "nao e aqui".
  const re = /^import .*from ['"][^'"]+['"];?$/gm
  let ultimo = null, m
  while ((m = re.exec(txt)) !== null) {
    if (m.index > 4000) break   // so o cabecalho
    ultimo = m
  }
  if (!ultimo) {
    // Arquivo sem import nenhum (sequenciaDia, calculoDia): entra depois do bloco de comentario
    // inicial, antes da primeira declaracao exportada.
    const i = txt.search(/^export /m)
    if (i < 0) { falhas.push(`${rel}: nao achei onde por o import`); continue }
    arquivos.set(rel, txt.slice(0, i) + linha + '\n\n' + txt.slice(i))
  } else {
    const fim = ultimo.index + ultimo[0].length
    arquivos.set(rel, txt.slice(0, fim) + '\n' + linha + txt.slice(fim))
  }
}

// --- Conferencia estrutural ------------------------------------------------------------------
for (const [rel, txt] of arquivos) {
  const usa = (txt.match(/normalizarNomeJornada\(/g) || []).length
  const importa = txt.includes("from '@/utils/folha/nomeJornada'")
    || txt.includes("from './nomeJornada'")
    || txt.includes("from './folha/nomeJornada'")
  if (usa > 0 && !importa) falhas.push(`${rel}: usa normalizarNomeJornada e NAO importa`)
  // O replace inline nao pode sobreviver em lugar nenhum - seria a regra em dois lugares.
  if (/replace\(\/\[ÀÁàá\]\/g/.test(txt)) falhas.push(`${rel}: ainda tem o replace de acento inline`)
}

if (falhas.length) {
  console.error('\nABORTADO - nenhum arquivo foi escrito:\n')
  falhas.forEach((f) => console.error('  x ' + f))
  process.exit(1)
}

if (ENSAIO) {
  console.log('ENSAIO - nada escrito. Arquivos que mudariam:')
  for (const rel of arquivos.keys()) console.log('  ' + rel)
  process.exit(0)
}

for (const [rel, txt] of arquivos) fs.writeFileSync(path.join(RAIZ, rel), txt, 'utf8')
console.log(`OK  ${arquivos.size} arquivo(s) atualizado(s), ${TROCAS.length + 2} sitios normalizados`)
for (const rel of arquivos.keys()) console.log('    ' + rel)
