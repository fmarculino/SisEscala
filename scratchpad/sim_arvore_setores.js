/**
 * Portão de `src/components/setores/arvoreSetores.ts` — a montagem da árvore compartilhada pelo
 * seletor de VÁRIOS setores (Dispositivo REP) e pelo de UM setor (destino de transferência).
 *
 * Transpile antes:
 *   npx tsc src/components/setores/arvoreSetores.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Rode:  node scratchpad/sim_arvore_setores.js
 *
 * As quatro defesas testadas aqui já foram bug de verdade em `formatSectorsHierarchy`
 * (src/utils/sectors.ts): órfão despejado no fim da lista como se pertencesse à raiz anterior,
 * profundidade limitada a 2 níveis, e busca que recortava o ramo pelo meio.
 */

const {
  montarArvore,
  idsDaSubarvore,
  idsComFilhos,
  idsQueCasam,
  caminhoAteONo,
} = require('./_sim/arvoreSetores')

let falhas = 0
let total = 0

function conferir(nome, real, esperado) {
  total++
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`OK    ${nome}`)
  } else {
    falhas++
    console.log(`FALHA ${nome}\n        esperado: ${b}\n        real:     ${a}`)
  }
}

const s = (id, nome, parent_id = null, ativo = true) => ({ id, nome, parent_id, ativo })

// ---------------------------------------------------------------------------
// 1. Hierarquia simples e ordenação alfabética por nível
// ---------------------------------------------------------------------------
{
  const raizes = montarArvore([
    s('b', 'BLOCO B', 'raiz'),
    s('a', 'BLOCO A', 'raiz'),
    s('raiz', 'SHL'),
  ])
  conferir('1a: uma raiz', raizes.map(r => r.id), ['raiz'])
  conferir('1b: filhos em ordem alfabetica', raizes[0].filhos.map(f => f.nome), ['BLOCO A', 'BLOCO B'])
  conferir('1c: profundidade da raiz', raizes[0].profundidade, 0)
  conferir('1d: profundidade dos filhos', raizes[0].filhos.map(f => f.profundidade), [1, 1])
}

// ---------------------------------------------------------------------------
// 2. Profundidade ARBITRARIA — a versao antiga so entendia 2 niveis
// ---------------------------------------------------------------------------
{
  const raizes = montarArvore([
    s('n1', 'ADMINISTRACAO'),
    s('n2', 'APOIO', 'n1'),
    s('n3', 'ENGENHARIA', 'n2'),
    s('n4', 'MANUTENCAO', 'n3'),
  ])
  conferir('2a: continua uma raiz so', raizes.map(r => r.id), ['n1'])
  conferir('2b: nivel 4 tem profundidade 3', raizes[0].filhos[0].filhos[0].filhos[0].profundidade, 3)
  conferir('2c: subarvore completa', idsDaSubarvore(raizes[0]), ['n1', 'n2', 'n3', 'n4'])
}

// ---------------------------------------------------------------------------
// 3. Pai FORA da lista vira raiz — nunca some da tela
// ---------------------------------------------------------------------------
{
  // "orfao" aponta para um pai que nao foi passado (outra unidade, ou filtrado por `ativo`).
  const raizes = montarArvore([s('orfao', 'BLOCO A', 'pai-de-outra-unidade'), s('r', 'SHL')])
  conferir('3a: orfao vira raiz (nao some)', raizes.map(r => r.id).sort(), ['orfao', 'r'])
  conferir('3b: orfao na margem, profundidade 0', raizes.find(r => r.id === 'orfao').profundidade, 0)
}

// ---------------------------------------------------------------------------
// 4. Auto-referencia (parent_id = id) vira raiz — senao o render nao termina
// ---------------------------------------------------------------------------
{
  const raizes = montarArvore([s('x', 'SETOR X', 'x')])
  conferir('4a: auto-referencia vira raiz', raizes.map(r => r.id), ['x'])
  conferir('4b: e nao vira filho de si mesmo', raizes[0].filhos.length, 0)
}

// ---------------------------------------------------------------------------
// 5. idsComFilhos: so no COM filho e recolhivel
// ---------------------------------------------------------------------------
{
  const raizes = montarArvore([s('p', 'PAI'), s('f', 'FILHO', 'p'), s('solto', 'FOLHA')])
  conferir('5a: so o pai e recolhivel', idsComFilhos(raizes).sort(), ['p'])
}

// ---------------------------------------------------------------------------
// 6. Busca: o ANCESTRAL de quem casa entra na lista
// ---------------------------------------------------------------------------
{
  const raizes = montarArvore([
    s('shl', 'SHL'),
    s('bloco', 'BLOCO A', 'shl'),
    s('lab', 'LABORATORIO', 'bloco'),
    s('outro', 'FARMACIA'),
  ])
  const casa = idsQueCasam(raizes, 'laborat')
  conferir(
    '6a: entra o alvo E os ancestrais dele',
    [...casa].sort(),
    ['bloco', 'lab', 'shl']
  )
  conferir('6b: ramo que nao casa fica de fora', casa.has('outro'), false)
  conferir('6c: busca vazia nao filtra nada', idsQueCasam(raizes, '   ').size, 0)
  conferir('6d: busca ignora caixa', idsQueCasam(raizes, 'FARMACIA').has('outro'), true)
}

// ---------------------------------------------------------------------------
// 7. Busca visita TODOS os irmaos (o bug de `.some` que para no primeiro true)
// ---------------------------------------------------------------------------
{
  const raizes = montarArvore([
    s('p', 'PAI'),
    s('a', 'ALFA', 'p'),   // casa
    s('b', 'BETA', 'p'),   // NAO casa
    s('c', 'ALFA 2', 'p'), // casa tambem, e vem DEPOIS de um que casou
  ])
  const casa = idsQueCasam(raizes, 'alfa')
  conferir('7a: irmao posterior que casa nao e' + ' perdido', [...casa].sort(), ['a', 'c', 'p'])
}

// ---------------------------------------------------------------------------
// 8. caminhoAteONo: abre o ramo do que ja esta selecionado
// ---------------------------------------------------------------------------
{
  const raizes = montarArvore([
    s('shl', 'SHL'),
    s('bloco', 'BLOCO A', 'shl'),
    s('lab', 'LABORATORIO', 'bloco'),
  ])
  conferir('8a: trilha da raiz ate o no', caminhoAteONo(raizes, 'lab'), ['shl', 'bloco', 'lab'])
  conferir('8b: no inexistente devolve vazio', caminhoAteONo(raizes, 'nao-existe'), [])
  conferir('8c: raiz devolve so ela', caminhoAteONo(raizes, 'shl'), ['shl'])
}

// ---------------------------------------------------------------------------
// 9. Lista vazia nao quebra
// ---------------------------------------------------------------------------
{
  conferir('9a: sem setores, sem raizes', montarArvore([]), [])
  conferir('9b: idsComFilhos de arvore vazia', idsComFilhos([]), [])
}

console.log(`\n${total - falhas}/${total} casos OK`)
process.exit(falhas === 0 ? 0 : 1)
