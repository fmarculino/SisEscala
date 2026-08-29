// Substituicao segura em arquivo com CRLF: normaliza, aplica, restaura o final de linha.
const fs = require('fs')
module.exports = function edit(p, pares) {
  let s = fs.readFileSync(p, 'utf8')
  const crlf = /\r\n/.test(s)
  s = s.replace(/\r\n/g, '\n')
  for (const [de, para, esperado = 1] of pares) {
    const n = s.split(de).length - 1
    if (n !== esperado) throw new Error(`${p}: "${de.slice(0, 60)}..." apareceu ${n}x, esperado ${esperado}`)
    s = s.split(de).join(para)
  }
  fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s)
  return true
}
