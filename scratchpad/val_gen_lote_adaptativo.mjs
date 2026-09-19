// Valida o portao do fatiamento adaptativo INJETANDO regressoes em ciclo.go e exigindo que
// `go test ./ciclo/` reprove cada uma. Restaura o arquivo ao final, sempre.
import fs from 'fs'
import { execSync } from 'child_process'

const ARQ = 'tools/coletor-rep/ciclo/ciclo.go'
const original = fs.readFileSync(ARQ, 'utf8')
const N = original.includes('\r\n') ? '\r\n' : '\n'
const nl = t => t.replace(/\n/g, N)

const REGRESSOES = [
  {
    nome: 'tamanho do lote volta a 500',
    de: 'tamanhoLotePadrao = 150',
    para: 'tamanhoLotePadrao = 500',
  },
  {
    nome: 'refatia tambem em recusa do servidor (perde a distincao)',
    de: 'if !ehFalhaDeTransporte(err) || len(trecho) <= tamanhoLoteMinimo {',
    para: 'if len(trecho) <= tamanhoLoteMinimo {',
  },
  {
    nome: 'fatiamento removido (falha vira desistencia, como antes da v0.18.0)',
    de: nl('\tmeio := len(trecho) / 2\n'),
    para: nl('\treturn [][]string{trecho}\n\tmeio := len(trecho) / 2\n'),
  },
  {
    nome: 'piso removido: divide ate 1 linha',
    de: 'len(trecho) <= tamanhoLoteMinimo {',
    para: 'len(trecho) <= 1 {',
  },
]

let falhouAlgum = false
try {
  for (const r of REGRESSOES) {
    const ocorrencias = original.split(r.de).length - 1
    if (ocorrencias !== 1) {
      console.log(`  ERRO DE ANCORA: "${r.nome}" casou ${ocorrencias}x — a injecao nao testaria nada`)
      falhouAlgum = true
      continue
    }
    fs.writeFileSync(ARQ, original.replace(r.de, r.para))
    // Confere que a substituicao foi MESMO aplicada (armadilha 48: injecao no-op "passa").
    if (fs.readFileSync(ARQ, 'utf8') === original) {
      console.log(`  ERRO: "${r.nome}" nao alterou o arquivo`)
      falhouAlgum = true
      continue
    }
    let reprovou = false
    let saida = ''
    try {
      execSync('go test ./ciclo/', { cwd: 'tools/coletor-rep', stdio: 'pipe' })
    } catch (e) {
      reprovou = true
      saida = String(e.stdout || '') + String(e.stderr || '')
    }
    const testes = [...saida.matchAll(/--- FAIL: (\w+)/g)].map(m => m[1])
    if (reprovou) console.log(`  OK      reprovou: ${r.nome}  ->  ${testes.join(', ') || 'build/test falhou'}`)
    else { console.log(`  FALHA   PASSOU (nao deveria): ${r.nome}`); falhouAlgum = true }
  }
} finally {
  fs.writeFileSync(ARQ, original)
}

// o arquivo restaurado precisa passar
try {
  execSync('go test ./ciclo/', { cwd: 'tools/coletor-rep', stdio: 'pipe' })
  console.log('  OK      arquivo restaurado passa nos testes')
} catch (e) {
  console.log('  FALHA   arquivo restaurado NAO passa')
  falhouAlgum = true
}

console.log(falhouAlgum ? '\nVALIDACAO REPROVADA' : `\nVALIDACAO OK: ${REGRESSOES.length} regressoes injetadas, ${REGRESSOES.length} reprovadas`)
process.exit(falhouAlgum ? 1 : 0)
