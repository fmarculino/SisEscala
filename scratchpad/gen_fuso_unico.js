/**
 * Reescreve as formatacoes de data/hora de src/ para a fonte unica src/utils/horario.ts.
 *
 * Cobre os DOIS defeitos:
 *   - sem timeZone      -> usava o fuso da MAQUINA de quem abriu a tela
 *   - timeZone literal  -> ignorava configuracoes_globais.timezone
 *
 * NAO toca (e conta, para conferencia):
 *   - nome de mes/ano isolado ({ month: 'long' } etc.) — nao depende de fuso
 *   - new Date(ano, mes, dia) — data de calendario montada em memoria, sem instante
 *
 * Uso:  node scratchpad/gen_fuso_unico.js [--aplicar]
 * Sem --aplicar, so relata.
 */
const fs = require('fs'), path = require('path')

const RAIZ = path.join(__dirname, '..', 'src')
const APLICAR = process.argv.includes('--aplicar')
const die = m => { console.error('ABORTADO: ' + m); process.exit(1) }

const arquivos = []
;(function anda(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) anda(p); else if (/\.(ts|tsx)$/.test(e.name)) arquivos.push(p)
  }
})(RAIZ)

function fechaParen(txt, abre) {
  let n = 0
  for (let i = abre; i < txt.length; i++) {
    if (txt[i] === '(') n++
    else if (txt[i] === ')') { n--; if (n === 0) return i }
  }
  return -1
}

/** Anda para tras a partir do ponto e devolve o inicio da expressao receptora. */
function inicioReceptor(txt, pontoIdx) {
  let i = pontoIdx - 1
  while (i >= 0 && /\s/.test(txt[i])) i--
  for (;;) {
    if (i < 0) return i + 1
    const c = txt[i]
    if (c === ')' || c === ']') {
      const abrir = c === ')' ? '(' : '['
      let n = 0
      while (i >= 0) {
        if (txt[i] === c) n++
        else if (txt[i] === abrir) { n--; if (n === 0) break }
        i--
      }
      i--
      while (i >= 0 && /[A-Za-z0-9_$]/.test(txt[i])) i--   // nome antes do ( — ex.: Date(
      // `new Date(...)`
      const antes = txt.slice(Math.max(0, i - 4), i + 1)
      if (/\bnew\s*$/.test(txt.slice(0, i + 1).slice(-5))) {
        i = txt.slice(0, i + 1).lastIndexOf('new') - 1
      }
      void antes
    } else if (/[A-Za-z0-9_$.?!]/.test(c)) {
      while (i >= 0 && /[A-Za-z0-9_$.?!]/.test(txt[i])) i--
    } else return i + 1
    while (i >= 0 && /\s/.test(txt[i])) {
      const j = i
      while (i >= 0 && /\s/.test(txt[i])) i--
      if (i < 0 || !/[.)\]]/.test(txt[i])) { i = j; break }
    }
    if (i < 0) return 0
    if (!/[.)\]A-Za-z0-9_$]/.test(txt[i])) return i + 1
  }
}

/**
 * `new Date(X)` -> `X`, e `new Date(X + 'T00:00:00')` -> `X`.
 *
 * ⚠️ O sufixo T00:00:00 existia justamente para impedir que `new Date('2026-08-10')` (meia-noite
 * UTC) virasse 09/08. Manter o sufixo E formatar com timeZone traria o erro de volta pelo outro
 * lado: a string sem offset e lida no fuso do PROCESSO (UTC no Coolify) e convertida para
 * America/Sao_Paulo daria 09/08 21:00. Passando a data pura, formatarData nao converte nada.
 */
function desembrulhaNewDate(expr) {
  const t = expr.trim()
  const m = /^new\s+Date\s*\(/.exec(t)
  if (!m) return t
  const fecha = fechaParen(t, t.indexOf('('))
  if (fecha !== t.length - 1) return t
  let dentro = t.slice(t.indexOf('(') + 1, fecha).trim()
  if (dentro === '') return t                       // new Date() = agora
  if (/^[^,]*,[^,]*,/.test(dentro)) return t        // new Date(a, m, d) = calendario
  const sufixo = /^(.*?)\s*\+\s*'T(?:00:00:00|12:00:00)'$/.exec(dentro)
  if (sufixo) dentro = sufixo[1].trim()
  return dentro
}

function alvo(metodo, opts) {
  const tem = k => new RegExp('\\b' + k + '\\s*:').test(opts)
  const soMes = tem('month') && !tem('day') && !tem('hour') && !tem('weekday')
  if (soMes) return null                            // nome de mes: nao depende de fuso
  // Sem NENHUMA opcao de formato (so o locale, ou locale + timeZone), cada metodo tem um
  // resultado proprio e fixo. Errar isto SOME COM A HORA: `toLocaleString('pt-BR')` devolve
  // "10/08/2026, 08:03:40", nao "10/08/2026".
  const semFormato = !tem('day') && !tem('month') && !tem('year') &&
                     !tem('hour') && !tem('minute') && !tem('second') && !tem('weekday')
  if (semFormato) {
    if (metodo === 'toLocaleTimeString') return 'formatarHoraComSegundos'
    if (metodo === 'toLocaleDateString') return 'formatarData'
    return 'formatarDataHoraComSegundos'
  }
  if (tem('weekday')) return 'formatarDataExtenso'
  const temHora = metodo === 'toLocaleTimeString' || tem('hour')
  const temData = metodo === 'toLocaleDateString' || tem('day') || tem('year') ||
                  (metodo === 'toLocaleString' && !tem('hour'))
  const seg = tem('second') || (opts.trim() === '' || /^'[^']*'$/.test(opts.trim()))
  if (metodo === 'toLocaleTimeString' && !temData) return seg ? 'formatarHoraComSegundos' : 'formatarHora'
  if (metodo === 'toLocaleDateString' && !tem('hour')) return tem('year') || opts.trim() === '' || /^'[^']*'$/.test(opts.trim()) ? 'formatarData' : 'formatarDataCurta'
  if (temHora && temData) {
    if (tem('second')) return 'formatarDataHoraComSegundos'
    if (!tem('year')) return 'formatarDataHoraCurta'
    return metodo === 'toLocaleString' && /^'[^']*'$/.test(opts.trim()) ? 'formatarDataHoraComSegundos' : 'formatarDataHora'
  }
  if (temHora) return seg ? 'formatarHoraComSegundos' : 'formatarHora'
  return 'formatarData'
}

const RE = /\.(toLocaleTimeString|toLocaleDateString|toLocaleString)\s*\(/g
let totalTrocas = 0, totalPulos = 0, arquivosMexidos = 0
const relatorio = []

for (const f of arquivos) {
  if (f.endsWith(path.join('utils', 'horario.ts'))) continue
  let txt = fs.readFileSync(f, 'utf8')
  const rel = path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/')
  const edicoes = []

  RE.lastIndex = 0
  let m
  while ((m = RE.exec(txt)) !== null) {
    const ponto = m.index
    const abre = txt.indexOf('(', ponto)
    const fecha = fechaParen(txt, abre)
    if (fecha < 0) continue
    const opts = txt.slice(abre + 1, fecha)
    // ⚠️ `new Date(new Date().toLocaleString('en-US', { timeZone }))` e o padrao canonico do
    // projeto para obter a hora LOCAL (CLAUDE.md, armadilha 12). Nao e exibicao: e calculo, e o
    // resultado alimenta getDate()/getMonth(). Trocar por formatarData quebraria a logica de
    // negocio, nao so a tela.
    if (/'en-US'|"en-US"/.test(opts)) { totalPulos++; continue }
    const fn = alvo(m[1], opts)
    if (!fn) { totalPulos++; continue }

    const ini = inicioReceptor(txt, ponto)
    const receptor = txt.slice(ini, ponto)
    if (!receptor.trim()) { totalPulos++; continue }
    const arg = desembrulhaNewDate(receptor)
    if (/^new\s+Date\s*\(\s*\w[\w.]*\s*,/.test(arg.trim())) { totalPulos++; continue }

    edicoes.push({ ini, fim: fecha + 1, texto: fn + '(' + arg + ')', antes: txt.slice(ini, fecha + 1).replace(/\s+/g, ' ') })
  }

  if (!edicoes.length) continue
  edicoes.sort((a, b) => b.ini - a.ini)
  for (const e of edicoes) txt = txt.slice(0, e.ini) + e.texto + txt.slice(e.fim)

  // import
  const usadas = [...new Set(edicoes.map(e => e.texto.slice(0, e.texto.indexOf('('))))].sort()
  const imp = "import { " + usadas.join(', ') + " } from '@/utils/horario'"
  if (!/from '@\/utils\/horario'/.test(txt)) {
    const primeiroImport = txt.search(/^import /m)
    if (primeiroImport >= 0) {
      const fimLinha = txt.indexOf('\n', primeiroImport)
      txt = txt.slice(0, fimLinha + 1) + imp + '\n' + txt.slice(fimLinha + 1)
    } else {
      const usaCliente = /^'use client'|^"use client"/.test(txt)
      const pos = usaCliente ? txt.indexOf('\n') + 1 : 0
      txt = txt.slice(0, pos) + imp + '\n' + txt.slice(pos)
    }
  }

  totalTrocas += edicoes.length
  arquivosMexidos++
  relatorio.push({ arq: rel, n: edicoes.length, exemplos: edicoes.slice(-3).map(e => e.antes.slice(0, 95) + '  ->  ' + e.texto.replace(/\s+/g, ' ').slice(0, 70)) })
  if (APLICAR) fs.writeFileSync(f, txt, 'utf8')
}

console.log((APLICAR ? 'APLICADO' : 'ENSAIO') + ': ' + totalTrocas + ' trocas em ' + arquivosMexidos + ' arquivos | pulados (mes/calendario): ' + totalPulos)
console.log('')
for (const r of relatorio.sort((a, b) => b.n - a.n)) {
  console.log('  ' + r.arq + '  (' + r.n + ')')
  for (const e of r.exemplos) console.log('      ' + e)
}
if (!APLICAR) console.log('\n(nada foi escrito; rode com --aplicar)')
