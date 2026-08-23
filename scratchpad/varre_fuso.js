/**
 * SO LEITURA. Varre src/ atras de formatacao de data/hora que depende do fuso da MAQUINA.
 *
 * Um sistema de ponto nao pode exibir horario diferente conforme quem abre a tela. Toda
 * formatacao precisa fixar o fuso configurado (armadilha 12 do CLAUDE.md).
 */
const fs = require('fs'), path = require('path')

const RAIZ = path.join(__dirname, '..', 'src')
const arquivos = []
;(function anda(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) anda(p)
    else if (/\.(ts|tsx)$/.test(e.name)) arquivos.push(p)
  }
})(RAIZ)

// Chamadas de formatacao: pega a chamada inteira, mesmo quebrada em varias linhas.
const CHAMADAS = /\.(toLocaleTimeString|toLocaleDateString|toLocaleString)\s*\(/g
const INTL = /new\s+Intl\.DateTimeFormat\s*\(/g
// Leitura de componente de data a partir de um Date (mente quando o processo nao esta no fuso)
const GETTERS = /\.(getHours|getMinutes|getDate|getMonth|getFullYear|getDay)\s*\(\s*\)/g

function fechaParenteses(txt, abre) {
  let n = 0
  for (let i = abre; i < txt.length; i++) {
    if (txt[i] === '(') n++
    else if (txt[i] === ')') { n--; if (n === 0) return i }
  }
  return -1
}
const linhaDe = (txt, i) => txt.slice(0, i).split('\n').length

const semFuso = []
const comFuso = []
const getters = []

for (const f of arquivos) {
  const txt = fs.readFileSync(f, 'utf8')
  const rel = path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/')

  for (const re of [CHAMADAS, INTL]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(txt)) !== null) {
      const abre = txt.indexOf('(', m.index)
      const fecha = fechaParenteses(txt, abre)
      if (fecha < 0) continue
      const call = txt.slice(m.index, fecha + 1)
      const alvo = { arq: rel, linha: linhaDe(txt, m.index), trecho: call.replace(/\s+/g, ' ').slice(0, 110) }
      if (/timeZone/.test(call)) comFuso.push(alvo); else semFuso.push(alvo)
    }
  }

  GETTERS.lastIndex = 0
  let g
  while ((g = GETTERS.exec(txt)) !== null) {
    const ini = txt.lastIndexOf('\n', g.index) + 1
    const linha = txt.slice(ini, txt.indexOf('\n', g.index)).trim()
    // new Date(ano, mes, dia) e aritmetica de calendario sao imunes — filtra os casos obvios
    if (/new Date\(\s*\w+\s*,/.test(linha)) continue
    getters.push({ arq: rel, linha: linhaDe(txt, g.index), trecho: linha.slice(0, 110) })
  }
}

const porArquivo = lista => {
  const m = new Map()
  for (const x of lista) { if (!m.has(x.arq)) m.set(x.arq, []); m.get(x.arq).push(x) }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
}

console.log('arquivos .ts/.tsx varridos: ' + arquivos.length)
console.log('')
console.log('### FORMATACAO SEM timeZone: ' + semFuso.length + '  (usa o fuso da maquina)')
console.log('### FORMATACAO COM timeZone: ' + comFuso.length)
console.log('')
for (const [arq, itens] of porArquivo(semFuso)) {
  console.log('  ' + arq + '  (' + itens.length + ')')
  for (const i of itens.slice(0, 6)) console.log('      L' + String(i.linha).padStart(5) + '  ' + i.trecho)
  if (itens.length > 6) console.log('      ... mais ' + (itens.length - 6))
}
console.log('')
console.log('### GETTERS de Date (getHours/getDate/...): ' + getters.length)
for (const [arq, itens] of porArquivo(getters).slice(0, 12)) console.log('  ' + arq + '  (' + itens.length + ')')
