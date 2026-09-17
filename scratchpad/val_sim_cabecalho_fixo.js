/**
 * Validador de sim_cabecalho_fixo.js: injeta regressoes no JS TRANSPILADO e exige que o
 * portao reprove cada uma. Portao que nunca falha nao vale nada.
 *
 *   npx tsc src/utils/escala/preferenciaGrade.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/val_sim_cabecalho_fixo.js
 *
 * ⚠️ As ancoras sao o texto do JS COMPILADO, nao o do TypeScript -- e cada injecao confere
 * que a substituicao foi de fato aplicada. Injecao que nao muda nada faz o validador
 * "passar" sem ter testado coisa nenhuma.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.join(__dirname, '_sim', 'preferenciaGrade.js')
const PORTAO = path.join(__dirname, 'sim_cabecalho_fixo.js')
const original = fs.readFileSync(ALVO, 'utf8')

const REGRESSOES = [
  {
    nome: 'o padrao volta a ser o layout antigo (o pedido nao alcanca quem pediu)',
    de: 'exports.CABECALHO_FIXO_PADRAO = true',
    para: 'exports.CABECALHO_FIXO_PADRAO = false',
  },
  {
    nome: 'o piso some: em monitor baixo a grade e espremida a nada',
    de: 'return Math.max(piso, Math.round(disponivel))',
    para: 'return Math.round(disponivel)',
  },
  {
    nome: 'medida invalida passa a virar NaN em vez de cair no piso',
    de: 'if (!Number.isFinite(disponivel))',
    para: 'if (false && !Number.isFinite(disponivel))',
  },
  {
    nome: 'quem desligou volta ligado no proximo acesso',
    de: "return valor === '1'",
    para: 'return true',
  },
  {
    nome: 'gravar inverte a escolha',
    de: "valor ? '1' : '0'",
    para: "valor ? '0' : '1'",
  },
  {
    nome: 'falha ao ler o storage deixa de cair no padrao',
    de: 'return exports.CABECALHO_FIXO_PADRAO;\n    }\n}\nfunction gravarPreferenciaCabecalhoFixo',
    para: 'throw new Error("storage");\n    }\n}\nfunction gravarPreferenciaCabecalhoFixo',
  },
  {
    nome: 'a folga inferior some e o card encosta no fim da tela',
    de: 'exports.FOLGA_INFERIOR_GRADE = 24',
    para: 'exports.FOLGA_INFERIOR_GRADE = 0',
  },
]

let falhas = 0
for (const r of REGRESSOES) {
  const de = r.de.split('\n').join(original.includes('\r\n') ? '\r\n' : '\n')
  const ocorrencias = original.split(de).length - 1
  if (ocorrencias !== 1) {
    console.error(`  ABORT: ancora com ${ocorrencias} ocorrencias (esperado 1): ${r.nome}`)
    falhas++
    continue
  }
  const mutante = original.split(de).join(r.para.split('\n').join(original.includes('\r\n') ? '\r\n' : '\n'))
  if (mutante === original) {
    console.error(`  ABORT: injecao nao mudou o arquivo: ${r.nome}`)
    falhas++
    continue
  }
  fs.writeFileSync(ALVO, mutante)
  let reprovou = false
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  } catch {
    reprovou = true
  } finally {
    fs.writeFileSync(ALVO, original)
  }
  if (reprovou) {
    console.log(`  ok  reprovada: ${r.nome}`)
  } else {
    console.error(`  REPROVADO: o portao PASSOU com a regressao "${r.nome}"`)
    falhas++
  }
}

console.log(falhas === 0
  ? `OK: ${REGRESSOES.length} regressoes injetadas, ${REGRESSOES.length} reprovadas`
  : `FALHOU: ${falhas} de ${REGRESSOES.length}`)
process.exit(falhas === 0 ? 0 : 1)
