/**
 * Valida o portao sim_folha_navegacao.js: injeta regressoes de proposito no modulo transpilado
 * e EXIGE reprovacao em cada uma. Portao que nunca falha nao vale nada.
 *
 * As ancoras sao o texto do JS COMPILADO, nao o do TypeScript. Cada substituicao e conferida:
 * replace que nao casa vira no-op silencioso e o validador "passaria" sem ter testado nada
 * (armadilha 48).
 *
 * Rode depois de transpilar:
 *   npx tsc src/utils/folhaNavegacao.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/val_sim_folha_navegacao.js
 */
const fs = require('fs')
const { execFileSync } = require('child_process')

const ALVO = 'scratchpad/_sim/folhaNavegacao.js'
const original = fs.readFileSync(ALVO, 'utf8')

// A cadeia inteira de desempate, como o tsc a compila. Derruba-la e voltar ao localeCompare puro.
const CADEIA_DESEMPATE = [
  "|| (a.matricula || '').localeCompare(b.matricula || '')",
  "        || (a.escala_mensal_id || '').localeCompare(b.escala_mensal_id || '')",
  "        || (a.servidor_id || '').localeCompare(b.servidor_id || '')"
].join('\n')

const regressoes = [
  {
    nome: 'ordem volta a localeCompare puro (duplo vinculo fica indefinido)',
    de: CADEIA_DESEMPATE,
    para: ''
  },
  {
    nome: 'ordem perde SO o desempate por matricula',
    de: "|| (a.matricula || '').localeCompare(b.matricula || '')\n",
    para: '\n'
  },
  {
    nome: 'ordem perde SO o desempate pela escala',
    de: "        || (a.escala_mensal_id || '').localeCompare(b.escala_mensal_id || '')\n",
    para: ''
  },
  {
    nome: 'ordenar passa a MUTAR o array recebido',
    de: 'return [...lista].sort(',
    para: 'return lista.sort('
  },
  {
    nome: 'mes e ano deixam de ir sempre na URL',
    de: "sp.set('mes', f.mes);",
    para: "if (f.mes !== filtrosPadraoFolha().mes) sp.set('mes', f.mes);"
  },
  {
    nome: 'urlDaFolha para de codificar a origem (o & vaza para a query externa)',
    de: "'?origem=' + encodeURIComponent(origem)",
    para: "'?origem=' + origem"
  },
  {
    nome: 'sequencia passa a incluir quem nao tem folha gerada',
    de: '.filter(s => !!s.folha_id)',
    para: '.filter(s => true)'
  },
  {
    nome: 'busca global perde o piso de 3 caracteres',
    de: '>= exports.MINIMO_BUSCA_GLOBAL',
    para: '>= 1'
  },
  {
    nome: 'campo ausente na URL vira undefined em vez do padrao',
    de: "escalaStatus: sp.get('escala') ?? padrao.escalaStatus,",
    para: "escalaStatus: sp.get('escala'),"
  },
  {
    nome: 'indice passa a casar por servidor em vez de folha',
    de: 's.folha_id === folhaId',
    para: 's.servidor_id === folhaId'
  }
]

let reprovadas = 0
const naoDetectadas = []

for (const r of regressoes) {
  const ocorrencias = original.split(r.de).length - 1
  if (ocorrencias < 1) {
    console.error('ABORTADO: ancora nao encontrada no JS compilado — ' + r.nome)
    fs.writeFileSync(ALVO, original)
    process.exit(1)
  }

  const quebrado = original.split(r.de).join(r.para)
  if (quebrado === original) {
    console.error('ABORTADO: substituicao foi no-op — ' + r.nome)
    fs.writeFileSync(ALVO, original)
    process.exit(1)
  }

  fs.writeFileSync(ALVO, quebrado)
  let passou = true
  try {
    execFileSync(process.execPath, ['scratchpad/sim_folha_navegacao.js'], { stdio: 'pipe' })
  } catch {
    passou = false
  }

  if (passou) {
    naoDetectadas.push(r.nome)
    console.error('NAO DETECTADA: ' + r.nome)
  } else {
    reprovadas++
    console.log('reprovada como esperado: ' + r.nome)
  }
}

fs.writeFileSync(ALVO, original)

// O modulo tem de voltar ao estado bom, e o portao tem de passar sobre ele.
try {
  execFileSync(process.execPath, ['scratchpad/sim_folha_navegacao.js'], { stdio: 'pipe' })
} catch {
  console.error('ABORTADO: o portao nao passa sobre o modulo restaurado')
  process.exit(1)
}

console.log('\n' + reprovadas + ' de ' + regressoes.length + ' regressoes reprovadas')
process.exit(naoDetectadas.length === 0 ? 0 : 1)
