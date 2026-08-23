/**
 * SO LEITURA. Classifica cada formatacao sem timeZone em src/:
 *
 *   HORA      exibe hora de um timestamp -> erra o HORARIO conforme a maquina  (critico)
 *   DATA_TS   exibe data de um timestamp -> pode errar o DIA (armadilha 12)     (critico)
 *   DATA_CAL  data de calendario (new Date(a,m,d) / 'YYYY-MM-DD' + T00:00)      (inocuo)
 *   MES       so nome de mes/ano                                               (inocuo)
 */
const fs = require('fs'), path = require('path')
const RAIZ = path.join(__dirname, '..', 'src')
const arquivos = []
;(function anda(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) anda(p); else if (/\.(ts|tsx)$/.test(e.name)) arquivos.push(p)
  }
})(RAIZ)

function fechaParenteses(txt, abre) {
  let n = 0
  for (let i = abre; i < txt.length; i++) {
    if (txt[i] === '(') n++
    else if (txt[i] === ')') { n--; if (n === 0) return i }
  }
  return -1
}
const linhaDe = (txt, i) => txt.slice(0, i).split('\n').length
const RE = /\.(toLocaleTimeString|toLocaleDateString|toLocaleString)\s*\(|new\s+Intl\.DateTimeFormat\s*\(/g

const achados = []
for (const f of arquivos) {
  const txt = fs.readFileSync(f, 'utf8')
  const rel = path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/')
  RE.lastIndex = 0
  let m
  while ((m = RE.exec(txt)) !== null) {
    const abre = txt.indexOf('(', m.index)
    const fecha = fechaParenteses(txt, abre)
    if (fecha < 0) continue
    const call = txt.slice(m.index, fecha + 1)
    if (/timeZone/.test(call)) continue
    const metodo = (m[1] || 'Intl.DateTimeFormat')
    // contexto: 200 chars antes, para ver de onde vem o Date
    const ini = txt.lastIndexOf('\n', Math.max(0, m.index - 200)) + 1
    const ctx = txt.slice(ini, fecha + 1).replace(/\s+/g, ' ')
    const opts = call.slice(call.indexOf('(') + 1, -1)

    let classe
    const soMes = /month\s*:\s*'(long|short|2-digit|numeric)'/.test(opts) &&
                  !/day\s*:/.test(opts) && !/hour\s*:/.test(opts)
    const dataCalendario = /new Date\(\s*\w[\w.]*\s*,\s*\w/.test(ctx) ||
                           /T00:00:00/.test(ctx) ||
                           /new Date\([^)]*\+\s*'T00/.test(ctx)
    if (soMes) classe = 'MES'
    else if (metodo === 'toLocaleTimeString' || /hour\s*:/.test(opts) || metodo === 'toLocaleString') classe = 'HORA'
    else if (dataCalendario) classe = 'DATA_CAL'
    else classe = 'DATA_TS'
    if (classe === 'HORA' && dataCalendario && metodo !== 'toLocaleTimeString') classe = 'DATA_CAL'

    achados.push({ arq: rel, linha: linhaDe(txt, m.index), metodo, classe, opts: opts.replace(/\s+/g, ' ').slice(0, 70), ctx: ctx.slice(-110) })
  }
}

const cont = {}
for (const a of achados) cont[a.classe] = (cont[a.classe] || 0) + 1
console.log('total sem timeZone: ' + achados.length)
console.log(JSON.stringify(cont))
console.log('')
for (const cls of ['HORA', 'DATA_TS', 'DATA_CAL', 'MES']) {
  const lista = achados.filter(a => a.classe === cls)
  console.log('=== ' + cls + ' (' + lista.length + ') ' + (cls === 'HORA' || cls === 'DATA_TS' ? '<<< PRECISA CORRIGIR' : '(inocuo)'))
  if (cls === 'DATA_CAL' || cls === 'MES') { console.log(''); continue }
  for (const a of lista) console.log('  ' + a.arq + ':' + a.linha + '  ' + a.metodo + '(' + a.opts + ')')
  console.log('')
}
fs.writeFileSync(path.join(__dirname, 'fuso_achados.json'), JSON.stringify(achados, null, 1))
