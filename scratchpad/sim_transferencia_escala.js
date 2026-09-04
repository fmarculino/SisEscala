/**
 * Portão de `src/utils/transferenciaEscala.ts` — o que acontece com a ESCALA numa transferência.
 *
 * Transpile antes:
 *   npx tsc src/utils/transferenciaEscala.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Rode:  node scratchpad/sim_transferencia_escala.js
 *
 * O defeito que este portão existe para não deixar voltar (medido em 03/09/2026): a rotina de
 * transferência APAGAVA os dias posteriores no setor de origem e nunca criava nada no destino.
 * Aqui isso vira asserção: 'nao_mexer' não planeja nada, e nenhum plano jamais é destrutivo.
 */

const {
  planejarCompetencias,
  competenciasAlcancadas,
  descreverRelato,
  relatoVazio,
  rotuloCompetencia,
} = require('./_sim/transferenciaEscala')

let falhas = 0
let total = 0
function conferir(nome, real, esperado) {
  total++
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  if (a === b) console.log(`OK    ${nome}`)
  else { falhas++; console.log(`FALHA ${nome}\n        esperado: ${b}\n        real:     ${a}`) }
}

const TRANSF = { dia: 9, mes: 9, ano: 2026 }

// ---------------------------------------------------------------------------
// 1. Alcance: mes da transferencia e os POSTERIORES; os anteriores ficam
// ---------------------------------------------------------------------------
{
  const todas = [
    { mes: 7, ano: 2026 }, { mes: 8, ano: 2026 },
    { mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }, { mes: 1, ano: 2027 },
  ]
  conferir('1a: alcanca 09/2026 em diante', competenciasAlcancadas(todas, TRANSF),
    [{ mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }, { mes: 1, ano: 2027 }])
  conferir('1b: mes anterior nao e' + ' tocado', competenciasAlcancadas(todas, TRANSF).some(c => c.mes === 8), false)
  conferir('1c: virada de ano ordenada', competenciasAlcancadas(todas, TRANSF).map(c => `${c.mes}/${c.ano}`),
    ['9/2026', '10/2026', '1/2027'])
}

// ---------------------------------------------------------------------------
// 2. 'nao_mexer' NAO planeja nada -- o default nunca toca em escala
// ---------------------------------------------------------------------------
{
  conferir('2a: nao_mexer planeja zero operacoes',
    planejarCompetencias([{ mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }], 'nao_mexer', TRANSF), [])
}

// ---------------------------------------------------------------------------
// 3. 'mover' move TODAS as competencias alcancadas, inclusive a do mes
// ---------------------------------------------------------------------------
{
  const p = planejarCompetencias([{ mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }], 'mover', TRANSF)
  conferir('3a: todas viram mover', p.map(x => x.operacao), ['mover', 'mover'])
  conferir('3b: mover nunca leva dia de corte', p.every(x => x.diaCorte === undefined), true)
}

// ---------------------------------------------------------------------------
// 4. 'dividir' so divide o MES DA TRANSFERENCIA; os seguintes vao inteiros
// ---------------------------------------------------------------------------
{
  const p = planejarCompetencias(
    [{ mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }, { mes: 1, ano: 2027 }], 'dividir', TRANSF)
  conferir('4a: so o mes da transferencia divide', p.map(x => x.operacao), ['dividir', 'mover', 'mover'])
  conferir('4b: o corte e' + ' o dia da transferencia', p[0].diaCorte, 9)
}

// ---------------------------------------------------------------------------
// 5. Transferencia no dia 1: 'dividir' vira MOVER
// ---------------------------------------------------------------------------
// Dividir no dia 1 deixaria a escala de ORIGEM sem nenhum dia -- uma casca vazia no setor antigo.
{
  const p = planejarCompetencias([{ mes: 9, ano: 2026 }], 'dividir', { dia: 1, mes: 9, ano: 2026 })
  conferir('5a: dia 1 nao divide, move', p.map(x => x.operacao), ['mover'])
  conferir('5b: e nao guarda corte', p[0].diaCorte, undefined)
}

// ---------------------------------------------------------------------------
// 6. Nenhum plano e' DESTRUTIVO -- o defeito original, virado assercao
// ---------------------------------------------------------------------------
{
  const cenarios = ['mover', 'dividir', 'nao_mexer']
  const operacoes = new Set()
  for (const acao of cenarios) {
    planejarCompetencias([{ mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }], acao, TRANSF)
      .forEach(p => operacoes.add(p.operacao))
  }
  conferir('6a: so existem mover e dividir (nunca apagar)', [...operacoes].sort(), ['dividir', 'mover'])
}

// ---------------------------------------------------------------------------
// 7. O relato SEMPRE diz o que nao mudou
// ---------------------------------------------------------------------------
{
  conferir('7a: nao_mexer diz que a escala ficou onde estava',
    descreverRelato(relatoVazio('nao_mexer')).includes('continua no setor de origem'), true)

  const r = {
    acao: 'mover', movidas: ['09/2026'], divididas: [],
    naoMexidas: [{ competencia: '10/2026', motivo: 'escala Fechada' }], folhaSincronizar: false,
  }
  const texto = descreverRelato(r)
  conferir('7b: nomeia o que moveu', texto.includes('09/2026'), true)
  conferir('7c: nomeia o que NAO moveu e por que', texto.includes('10/2026') && texto.includes('escala Fechada'), true)

  conferir('7d: mover sem nada encontrado nao mente',
    descreverRelato(relatoVazio('mover')).includes('Nenhuma escala foi encontrada'), true)

  const rDiv = {
    acao: 'dividir', movidas: [], divididas: [{ competencia: '09/2026', diaCorte: 9, dias: 4 }],
    naoMexidas: [], folhaSincronizar: true,
  }
  conferir('7e: divisao pede sincronizar a folha',
    descreverRelato(rDiv).includes('Sincronize a folha'), true)
}

// ---------------------------------------------------------------------------
// 8. rotuloCompetencia
// ---------------------------------------------------------------------------
{
  conferir('8a: mes com zero a esquerda', rotuloCompetencia(9, 2026), '09/2026')
  conferir('8b: mes de dois digitos', rotuloCompetencia(12, 2026), '12/2026')
}

console.log(`\n${total - falhas}/${total} casos OK`)
process.exit(falhas === 0 ? 0 : 1)
