/**
 * SO LEITURA. Conferencia estrutural de um arquivo plpgsql: BEGIN/END, IF/END IF, LOOP/END LOOP,
 * CASE/END CASE.
 *
 * Nem `npx tsc` nem `npm run build` enxergam SQL, e o Postgres so acusa no CREATE. Um END IF
 * faltando derruba a funcao inteira — e nesta base isso significa o terminal de ponto parado.
 *
 * Uso: node scratchpad/confere_estrutura_plpgsql.js <arquivo.sql>
 */
const fs = require('fs')
const arq = process.argv[2]
if (!arq) { console.error('uso: node confere_estrutura_plpgsql.js <arquivo.sql>'); process.exit(2) }

const txt = fs.readFileSync(arq, 'utf8')
const linhas = txt.split(/\r?\n/)

// Remove comentarios de linha e literais, para nao contar palavra dentro de texto/comentario.
function limpa(l) {
  let s = l.replace(/--.*$/, '')
  s = s.replace(/'([^']|'')*'/g, "''")
  return s
}

const pilha = []
const erros = []
let dentroDollar = false

linhas.forEach((bruta, i) => {
  const n = i + 1
  const dol = (bruta.match(/\$\$|\$fn\w*\$/g) || []).length
  if (dol % 2 === 1) dentroDollar = !dentroDollar
  if (!dentroDollar && !/\$\$|\$fn\w*\$/.test(bruta)) return

  const l = limpa(bruta)
  const up = l.toUpperCase()

  // fecha primeiro, para `END IF;` nao ser lido como abertura de IF
  const fechaIf = (up.match(/\bEND\s+IF\s*;/g) || []).length
  const fechaLoop = (up.match(/\bEND\s+LOOP\s*;/g) || []).length
  const fechaCase = (up.match(/\bEND\s+CASE\s*;/g) || []).length
  for (let k = 0; k < fechaIf; k++) { const t = pilha.pop(); if (t?.tipo !== 'IF') erros.push(`L${n}: END IF sem IF (topo: ${t?.tipo || 'vazio'} da L${t?.linha})`) }
  for (let k = 0; k < fechaLoop; k++) { const t = pilha.pop(); if (t?.tipo !== 'LOOP') erros.push(`L${n}: END LOOP sem LOOP (topo: ${t?.tipo || 'vazio'} da L${t?.linha})`) }
  for (let k = 0; k < fechaCase; k++) { const t = pilha.pop(); if (t?.tipo !== 'CASE') erros.push(`L${n}: END CASE sem CASE (topo: ${t?.tipo || 'vazio'} da L${t?.linha})`) }

  const semFecho = up
    .replace(/\bEND\s+IF\s*;/g, ' ')
    .replace(/\bEND\s+LOOP\s*;/g, ' ')
    .replace(/\bEND\s+CASE\s*;/g, ' ')

  // BEGIN / END (bloco). END sozinho, seguido de ; ou nada.
  for (const _ of semFecho.match(/\bBEGIN\b/g) || []) pilha.push({ tipo: 'BEGIN', linha: n })

  // IF de comando (inicio de statement), nao o CASE WHEN ... END inline
  for (const _ of semFecho.match(/(^|\s)IF\s/g) || []) pilha.push({ tipo: 'IF', linha: n })
  for (const _ of semFecho.match(/\bLOOP\b/g) || []) {
    // `END LOOP` ja foi removido; `EXIT ... LOOP` nao existe. FOR/WHILE ... LOOP abre.
    pilha.push({ tipo: 'LOOP', linha: n })
  }
  for (const _ of semFecho.match(/\bCASE\s+WHEN\b|\bCASE\b(?!\s*$)/g) || []) {
    // CASE de expressao fecha com END (sem ;) na mesma expressao — nao empilha.
  }
  for (const _ of semFecho.match(/(^|\s)END\s*;/g) || []) {
    const t = pilha.pop()
    if (t?.tipo !== 'BEGIN') erros.push(`L${n}: END; sem BEGIN (topo: ${t?.tipo || 'vazio'} da L${t?.linha})`)
  }
})

console.log('arquivo: ' + arq)
console.log('linhas: ' + linhas.length)
if (pilha.length) {
  console.log('ABERTOS SEM FECHAR: ' + pilha.length)
  for (const t of pilha.slice(0, 10)) console.log('   ' + t.tipo + ' aberto na L' + t.linha)
}
if (erros.length) {
  console.log('ERROS: ' + erros.length)
  for (const e of erros.slice(0, 15)) console.log('   ' + e)
}
if (!pilha.length && !erros.length) console.log('OK — BEGIN/END, IF/END IF e LOOP/END LOOP balanceados.')
process.exit(pilha.length || erros.length ? 1 : 0)
