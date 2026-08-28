// Portao de buildSectorPathMap/formatSectorPaths (28/08/2026). Nao ha framework de teste.
// Transpile antes:
//   npx tsc src/utils/sectors.ts --outDir scratchpad/_sim --module commonjs --target es2020
const { buildSectorPathMap, formatSectorPaths } = require('./_sim/sectors')

const setores = [
  { id: 'shl', unidade_id: 'u1', parent_id: null, nome: 'SHL', ativo: true },
  { id: 'a1', unidade_id: 'u1', parent_id: 'shl', nome: 'BLOCO A', ativo: true },
  { id: 'adm', unidade_id: 'u1', parent_id: null, nome: 'ADMINISTRACAO', ativo: true },
  { id: 'a2', unidade_id: 'u1', parent_id: 'adm', nome: 'BLOCO A', ativo: false },
  { id: 'neto', unidade_id: 'u1', parent_id: 'a2', nome: 'SALA 3', ativo: true },
  { id: 'orfao', unidade_id: 'u1', parent_id: 'fora-do-escopo', nome: 'ENGENHARIA', ativo: true },
  // Ciclo em parent_id: nao pode estourar a pilha.
  { id: 'ciclo1', unidade_id: 'u1', parent_id: 'ciclo2', nome: 'X', ativo: true },
  { id: 'ciclo2', unidade_id: 'u1', parent_id: 'ciclo1', nome: 'Y', ativo: true },
]

const SEP = String.raw` \ `
const mapa = buildSectorPathMap(setores)

const esperado = {
  shl: 'SHL',
  // O caso que motivou tudo: duas "BLOCO A" em ramos diferentes.
  a1: `SHL${SEP}BLOCO A`,
  a2: `ADMINISTRACAO${SEP}BLOCO A`,
  neto: `ADMINISTRACAO${SEP}BLOCO A${SEP}SALA 3`,
  // Pai fora da lista (fora do escopo de leitura): caminho comeca nele mesmo.
  orfao: 'ENGENHARIA',
}

let falhas = 0
for (const [id, alvo] of Object.entries(esperado)) {
  const ok = mapa.get(id) === alvo
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${id} => ${JSON.stringify(mapa.get(id))}${ok ? '' : ' (esperado ' + JSON.stringify(alvo) + ')'}`)
}

const ciclos = [mapa.get('ciclo1'), mapa.get('ciclo2')]
const cicloOk = ciclos.every(v => typeof v === 'string' && v.length > 0 && v.length < 100)
if (!cicloOk) falhas++
console.log(`${cicloOk ? 'OK  ' : 'FALHA'} ciclo em parent_id nao estoura a pilha => ${JSON.stringify(ciclos)}`)

const lista = formatSectorPaths(setores)
console.log('\nordem do <select>:')
lista.forEach(s => console.log('  ' + s.nome + (s.ativo === false ? '   [inativo]' : '')))

const preserva = lista.find(s => s.id === 'a2')?.ativo === false
  && lista.find(s => s.id === 'a1')?.unidade_id === 'u1'
  && lista.length === setores.length
if (!preserva) falhas++
console.log(`\n${preserva ? 'OK  ' : 'FALHA'} formatSectorPaths preserva ativo/unidade_id e nao perde linha`)

// Filhos do mesmo pai ficam juntos, sem recuo.
const nomes = lista.map(s => s.nome)
const agrupado = nomes.indexOf(`ADMINISTRACAO${SEP}BLOCO A`) === nomes.indexOf('ADMINISTRACAO') + 1
if (!agrupado) falhas++
console.log(`${agrupado ? 'OK  ' : 'FALHA'} filho aparece logo abaixo do pai`)

console.log(falhas === 0 ? '\ntodos os casos OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
