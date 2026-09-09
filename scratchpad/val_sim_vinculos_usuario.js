// Valida o PORTAO de vinculosDoUsuario: injeta regressoes de proposito e exige reprovacao.
// Um portao que nunca falha nao vale nada (armadilha 36).
//
// ⚠️ As ancoras sao o texto do JS COMPILADO (scratchpad/_sim/), nao o do TypeScript: o tsc
// quebra `if (x) return []` em duas linhas. Substituicao que nao casa vira no-op e o validador
// "passaria" sem ter testado nada — a armadilha 48. Por isso toda injecao e conferida abaixo.
//
//   node scratchpad/val_sim_vinculos_usuario.js
const fs = require('fs')
const { execFileSync } = require('child_process')

const ALVO = 'scratchpad/_sim/vinculosDoUsuario.js'
const original = fs.readFileSync(ALVO, 'utf8')

const L = (...linhas) => linhas.join('\n')

const REGRESSOES = [
  ['deixa de acusar quando o escopo nao cobre (a funcao vira no-op)',
    s => s.replace('return vinculos.filter(v =>', 'return [] || vinculos.filter(v =>')],

  // "Acesso Total" e protegido DUAS vezes: o early-return de vinculosForaDoEscopo e a checagem
  // dentro de escopoAlcancaUnidade. Tirar so uma nao muda o resultado — a redundancia e boa, e
  // por isso a injecao precisa derrubar as duas para provar que o portao cobre o caso.
  ['passa a acusar mesmo com Acesso Total (as duas defesas removidas)',
    s => s.replace(L('    if (escopo.acessoTodasUnidades)', '        return [];'), '')
          .replace(L('    if (escopo.acessoTodasUnidades)', '        return true;'), '')],

  ['ignora o alcance por SETOR (aviso falso para quem so tem setor vinculado)',
    s => s.replace(/for \(const setorId of escopo\.setorIds\) \{[\s\S]*?\n    \}/,
      '/* alcance por setor removido */')],

  ['passa a acusar servidor SEM CPF (acusa por falta de informacao)',
    s => s.replace(
      L('    if (!cpf)', '        return []; // sem CPF não se afirma nada'),
      L('    if (!cpf)', '        return vinculos.filter(v => v.id !== servidorSelecionadoId);'))],

  ['confunde pessoas diferentes (para de comparar o CPF)',
    s => s.replace('&& cpfNormalizado(v.cpf) === cpf', '')],
]

let falhas = 0
for (const [rot, muta] of REGRESSOES) {
  const mutado = muta(original)
  if (mutado === original) {
    console.log(`ERRO NA INJECAO (substituicao no-op, a ancora nao casou): ${rot}`)
    falhas++
    continue
  }
  fs.writeFileSync(ALVO, mutado)
  let reprovou = false
  try {
    execFileSync('node', ['scratchpad/sim_vinculos_usuario.js'], { stdio: 'pipe' })
  } catch { reprovou = true }
  fs.writeFileSync(ALVO, original)
  console.log(`${reprovou ? 'OK   o portao reprova' : 'FALHA o portao PASSOU'}: ${rot}`)
  if (!reprovou) falhas++
}

try {
  execFileSync('node', ['scratchpad/sim_vinculos_usuario.js'], { stdio: 'pipe' })
  console.log('OK   o portao passa com o modulo intacto')
} catch {
  console.log('FALHA o portao reprova o modulo intacto')
  falhas++
}

process.exit(falhas ? 1 : 0)
