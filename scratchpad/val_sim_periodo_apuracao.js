// Validador do portao sim_periodo_apuracao.js: injeta regressoes de proposito e EXIGE reprovacao.
//
// Um portao que nunca falha nao vale nada. Cada injecao abaixo e um defeito plausivel — a maioria
// e a primeira coisa que alguem escreveria ao reimplementar a regra.
//
// ⚠️ As ancoras sao o texto do JS COMPILADO, nao o do TypeScript. Por isso cada injecao confere
// que a substituicao foi de fato APLICADA antes de rodar o portao: `replace` que nao casa e
// no-op silencioso, e o validador "passaria" sem ter testado nada (CLAUDE.md armadilha 48).
//
// Uso: node scratchpad/val_sim_periodo_apuracao.js
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ALVO = path.join(__dirname, '_sim', 'periodoApuracao.js')
const PORTAO = path.join(__dirname, 'sim_periodo_apuracao.js')
const original = fs.readFileSync(ALVO, 'utf8')

const REGRESSOES = [
  {
    nome: 'inicio = dia_corte + 1 do mes anterior (quebra corte 28 em marco)',
    de: 'const fimAnterior = iso(ant.ano, ant.mes, corte);\n    const inicio = somarUmDia(fimAnterior);',
    para: 'const inicio = iso(ant.ano, ant.mes, corte + 1);'
  },
  {
    nome: 'competencia = o mes que ABRE (desloca o documento um mes inteiro)',
    de: 'const ant = competenciaAnterior(mes, ano);',
    para: 'const ant = { mes, ano };'
  },
  {
    nome: 'mes civil tratado como corte 31 (fevereiro passa a terminar no dia 31)',
    de: 'if (corte === null) {',
    para: 'if (false) {'
  },
  {
    nome: 'corte 31 aceito no cadastro',
    de: 'corte < 1 || corte > 28',
    para: 'corte < 1 || corte > 31'
  },
  {
    nome: 'metadesDoPeriodo devolve UMA metade (o bug das duas reguas: -40h no documento)',
    de: '    if (aI === aF && mI === mF) {\n        return [{ mes: mI, ano: aI, diaInicio: dI, diaFim: dF }];\n    }',
    para: '    return [{ mes: mF, ano: aF, diaInicio: dI, diaFim: dF }];\n    if (false) {}'
  },
  {
    nome: 'regimeDoServidor ignora a vigencia GLOBAL (o corte nunca volta para a rede)',
    de: 'const daRede = maisRecente((vigencias || []).filter(v => v.servidor_id === null && vigenteEm(v)));',
    para: 'const daRede = null;'
  },
  {
    nome: 'regimeDoServidor devolve null sem atribuicao (apuracao falha em silencio)',
    de: 'return regimes.find(r => r.padrao) || null;',
    para: 'return null;'
  },
  {
    nome: 'rotulo perde as datas (periodo que atravessa a virada fica indecidivel)',
    de: 'rotulo: `Apuracao ${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`',
    para: 'rotulo: `Apuracao ${mes}/${ano}`'
  },
  {
    nome: 'vigencia deixa de respeitar o FIM (regime encerrado continua valendo)',
    de: 'v.vigencia_inicio <= data && (v.vigencia_fim === null || v.vigencia_fim >= data)',
    para: 'v.vigencia_inicio <= data'
  }
]

function portaoPassa() {
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

console.log('Conferindo que o portao passa com o codigo intacto...')
if (!portaoPassa()) {
  console.error('REPROVA: o portao nao passa nem com o codigo original. Corrija antes de validar.')
  process.exit(1)
}
console.log('  ok\n')

let pegas = 0, escaparam = 0
for (const r of REGRESSOES) {
  const injetado = original.replace(r.de, r.para)

  // A conferencia que separa "testei" de "achei que testei".
  if (injetado === original) {
    console.error(`  ANCORA NAO CASOU: ${r.nome}`)
    console.error('    a injecao foi no-op — o portao nao foi exercitado. Reveja a ancora no JS compilado.')
    escaparam++
    continue
  }

  fs.writeFileSync(ALVO, injetado)
  const passou = portaoPassa()
  fs.writeFileSync(ALVO, original)

  if (passou) {
    console.error(`  ESCAPOU: ${r.nome}`)
    escaparam++
  } else {
    console.log(`  pega: ${r.nome}`)
    pegas++
  }
}

fs.writeFileSync(ALVO, original)
console.log(`\n${escaparam === 0 ? 'OK' : 'REPROVADO'}: ${pegas} de ${REGRESSOES.length} regressoes reprovadas pelo portao, ${escaparam} escaparam.`)
process.exit(escaparam === 0 ? 0 : 1)
