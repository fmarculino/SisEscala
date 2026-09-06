/**
 * Portao do manual do usuario (SUPORTE -> Ajuda).
 *
 * O manual e conteudo, e conteudo apodrece em silencio: um link para uma secao que foi renomeada
 * vira um botao que nao faz nada, uma tabela com uma celula a menos desalinha a coluna, e dois
 * ids iguais fazem a busca levar sempre para a mesma secao. Nada disso quebra o build -- por isso
 * existe este portao.
 *
 * Transpile antes:
 *   npx tsc "src/app/(dashboard)/ajuda/tipos.ts" "src/app/(dashboard)/ajuda/conteudo/index.ts" \
 *     --outDir scratchpad/_sim_manual --module commonjs --target es2020 --skipLibCheck
 * Rodar:
 *   node scratchpad/sim_manual.js
 */
const path = require('path')
const { MANUAL, TODAS_AS_SECOES } = require('./_sim_manual/conteudo/index.js')
const { textoDoBloco, indiceDaSecao, normalizar } = require('./_sim_manual/tipos.js')

let passou = 0
const falhas = []
const ok = (rotulo, condicao, detalhe) => {
  if (condicao) { passou++; return }
  falhas.push(rotulo + (detalhe ? ' -- ' + detalhe : ''))
}

const secoes = TODAS_AS_SECOES.map(s => s.secao)
const idsDeSecao = new Set(secoes.map(s => s.id))

// ---------------------------------------------------------------------------
// 1. Estrutura
// ---------------------------------------------------------------------------
ok('o manual tem capitulos', MANUAL.length > 0)
ok('todo capitulo tem secao', MANUAL.every(c => c.secoes.length > 0),
   MANUAL.filter(c => !c.secoes.length).map(c => c.id).join(','))

{
  const ids = MANUAL.map(c => c.id)
  ok('id de capitulo nao se repete', new Set(ids).size === ids.length, ids.join(','))
}
{
  const ids = secoes.map(s => s.id)
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i)
  // Id repetido e o pior defeito silencioso daqui: a busca acha as duas e sempre abre a primeira.
  ok('id de secao nao se repete', repetidos.length === 0, repetidos.join(','))
}

ok('todo capitulo tem icone', MANUAL.every(c => !!c.icone))
ok('toda secao tem resumo', secoes.every(s => (s.resumo || '').length > 10),
   secoes.filter(s => (s.resumo || '').length <= 10).map(s => s.id).join(','))
ok('toda secao tem conteudo', secoes.every(s => s.blocos.length > 0),
   secoes.filter(s => !s.blocos.length).map(s => s.id).join(','))

// ---------------------------------------------------------------------------
// 2. Blocos
// ---------------------------------------------------------------------------
const TIPOS = new Set(['p', 'titulo', 'passos', 'lista', 'tabela', 'aviso', 'cartoes', 'veja', 'caminho'])
const TONS = new Set(['atencao', 'cuidado', 'dica', 'legal'])

for (const s of secoes) {
  for (const [i, b] of s.blocos.entries()) {
    const onde = `${s.id}[${i}] (${b.tipo})`
    ok('tipo de bloco conhecido: ' + onde, TIPOS.has(b.tipo))

    if (b.tipo === 'tabela') {
      // Celula faltando nao quebra nada -- so desalinha a coluna, e ninguem percebe lendo o codigo.
      const erradas = b.linhas.filter(l => l.length !== b.colunas.length)
      ok('tabela com linhas do tamanho do cabecalho: ' + onde, erradas.length === 0,
         `${erradas.length} de ${b.linhas.length} linhas divergem de ${b.colunas.length} colunas`)
      ok('tabela nao vazia: ' + onde, b.linhas.length > 0 && b.colunas.length > 0)
    }
    if (b.tipo === 'aviso') {
      ok('tom de aviso valido: ' + onde, TONS.has(b.tom), b.tom)
      ok('aviso com texto: ' + onde, (b.texto || '').length > 15)
    }
    if (b.tipo === 'veja') {
      // Secao renomeada e o link quebra sem aviso: o botao existe e nao vai a lugar nenhum.
      ok('link "veja" aponta para secao existente: ' + onde, idsDeSecao.has(b.secaoId), b.secaoId)
    }
    if (b.tipo === 'passos') {
      ok('passos nao vazio: ' + onde, b.itens.length > 0)
      ok('todo passo tem titulo: ' + onde, b.itens.every(it => (it.titulo || '').length > 3))
    }
    if (b.tipo === 'cartoes') {
      ok('cartoes com titulo e texto: ' + onde,
         b.itens.every(it => it.titulo && it.texto))
    }
    if (b.tipo === 'lista') ok('lista nao vazia: ' + onde, b.itens.length > 0)
    if (b.tipo === 'caminho') ok('caminho nao vazio: ' + onde, b.itens.length > 0)
  }
}

// Marcacao de negrito sempre em par: um `**` solto aparece cru na tela.
for (const s of secoes) {
  const texto = s.blocos.map(textoDoBloco).join(' ')
  const asteriscos = (texto.match(/\*\*/g) || []).length
  ok('negrito balanceado em ' + s.id, asteriscos % 2 === 0, `${asteriscos} ocorrencias de **`)
  const crases = (texto.match(/`/g) || []).length
  ok('crase balanceada em ' + s.id, crases % 2 === 0, `${crases} crases`)
}

// ---------------------------------------------------------------------------
// 3. A busca precisa achar o que o manual promete
// ---------------------------------------------------------------------------
const indice = secoes.map(s => ({ id: s.id, texto: indiceDaSecao(s) }))
const acha = termo => indice.filter(i => normalizar(termo).split(/\s+/).every(p => i.texto.includes(p)))

for (const termo of ['ferias', 'PIN', 'plantao', 'folha', 'relogio', 'sobreaviso', 'atraso',
                     'afastamento', 'transferencia', 'biometria', 'justificativa', 'intervalo']) {
  ok(`a busca acha "${termo}"`, acha(termo).length > 0)
}

// Sem acento e sem caixa: quem digita "ferias" tem que achar "Férias".
ok('busca ignora acento', acha('férias').length === acha('ferias').length)
ok('busca ignora caixa', acha('PLANTAO').length === acha('plantao').length)

// ---------------------------------------------------------------------------
// 4. Linguagem: o manual e para o coordenador, nao para quem desenvolve
// ---------------------------------------------------------------------------
// Termo tecnico aqui nao e feio -- e inutil: quem le nao tem como agir sobre ele, e a frase toda
// se perde. Se um destes aparecer, reescreva a frase do ponto de vista da TELA.
const PROIBIDOS = [
  'fn_', 'escala_diaria', 'escala_mensal', 'marcacoes_ponto', 'folha_ponto', 'servidores_eventos',
  'supabase', 'postgres', 'migration', 'trigger', 'rpc', 'jsonb', 'uuid', 'null',
]
for (const s of secoes) {
  const texto = normalizar(s.blocos.map(textoDoBloco).join(' ') + ' ' + s.titulo + ' ' + s.resumo)
  const achados = PROIBIDOS.filter(p => texto.includes(normalizar(p)))
  ok('sem jargao tecnico em ' + s.id, achados.length === 0, achados.join(', '))
}

// ---------------------------------------------------------------------------
// 5. Cobertura: o manual precisa falar de cada item do menu
// ---------------------------------------------------------------------------
// Tela que existe e nao esta no manual e a forma mais comum de o manual envelhecer -- some do
// radar justamente porque ninguem lembra do que nao esta escrito.
const textoTodo = normalizar(secoes.map(s => `${s.titulo} ${s.resumo} ${s.blocos.map(textoDoBloco).join(' ')}`).join(' '))
const TELAS = [
  'escalas', 'autorizacoes de escala', 'afastamentos', 'ferias e licencas', 'folha de ponto',
  'justificativas', 'marcacoes', 'unidades', 'setores', 'servidores', 'pendencias de cadastro',
  'cargos', 'feriados', 'jornadas', 'dicionario de turnos', 'tipos de afastamento',
  'auditoria', 'relatorios', 'configuracoes', 'usuarios', 'backup', 'seguranca', 'portal',
]
for (const tela of TELAS) {
  ok(`o manual cobre "${tela}"`, textoTodo.includes(normalizar(tela)))
}

// ---------------------------------------------------------------------------
console.log(`\n${passou} assercoes passaram, ${falhas.length} falharam`)
console.log(`${MANUAL.length} capitulos, ${secoes.length} secoes, ` +
            `${secoes.reduce((n, s) => n + s.blocos.length, 0)} blocos`)
if (falhas.length) {
  console.log('\nFALHAS:')
  falhas.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
