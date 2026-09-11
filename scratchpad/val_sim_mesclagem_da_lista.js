/**
 * Valida o PORTAO: injeta regressoes de proposito no modulo transpilado e exige que
 * sim_mesclagem_da_lista.js reprove cada uma. Portao que nunca falha nao vale nada.
 *
 * ⚠️ Confere que a substituicao foi de fato APLICADA antes de rodar o portao (armadilha 48 do
 * CLAUDE.md: um replace no-op faz o teste "passar" e o teste do teste mentir).
 *
 * Rodar (depois de transpilar, ver o cabecalho do sim):
 *   node scratchpad/val_sim_mesclagem_da_lista.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.join(__dirname, '_sim/mesclagemCadastro.js')
const PORTAO = path.join(__dirname, 'sim_mesclagem_da_lista.js')

if (!fs.existsSync(ALVO)) {
  console.error('Transpile primeiro: npx tsc src/utils/mesclagemCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020')
  process.exit(1)
}

const original = fs.readFileSync(ALVO, 'utf8')

// ⚠️ As ancoras sao o texto do JS COMPILADO, nao o do TypeScript: o tsc reescreve `if (x) return`
// em duas linhas e some com as chaves de bloco de uma instrucao so. Por isso o laco abaixo confere
// que a substituicao foi de fato aplicada antes de rodar o portao.
const regressoes = [
  {
    // A PIOR de todas: liberar a declaracao para telefone e e-mail. Medido em producao em
    // 11/09/2026: 6 dos 10 grupos com CPF divergente sao por telefone e 3 por e-mail, e um desses
    // enderecos e compartilhado por 12 pessoas. Isso seria oferecer "junte estas duas pessoas".
    nome: 'declaracao liberada para telefone e e-mail (junta DUAS PESSOAS)',
    de: "    if (grupo.criterio !== 'nome') {",
    para: '    if (false) {',
  },
  {
    nome: 'declaracao liberada com 3+ cadastros (nao da para dizer qual par)',
    de: '    if (grupo.servidores.length !== 2) {',
    para: '    if (false) {',
  },
  {
    nome: 'declaracao liberada com cadastro ja inativado',
    de: "    if (grupo.servidores.some(s => s.status !== 'Ativo')) {",
    para: '    if (false) {',
  },
  {
    nome: 'declaracao liberada com CPF invalido/incompleto',
    de: '    if (grupo.servidores.some(s => soDigitos(s.cpf).length !== 11)) {',
    para: '    if (false) {',
  },
  {
    // Sem o motivo escrito, a unica prova de que sao a mesma pessoa deixa de existir.
    nome: 'motivo da declaracao deixa de ser exigido',
    de: '    if (limpo.length >= exports.MOTIVO_DECLARACAO_MINIMO)',
    para: '    if (true)',
  },
  {
    // O aviso voltaria a falar so do CPF — escondendo PIS, nascimento e nome da mae divergentes,
    // que sao o que denuncia ficha de outra pessoa.
    nome: 'aviso deixa de citar os outros campos de identidade divergentes',
    de: "    const outros = divergencias.filter(d => d.campo !== 'cpf');",
    para: '    const outros = [];',
  },
  {
    nome: 'oferece mesclagem sem o grupo existir no banco (promete o que nao ha)',
    de: '    if (!gruposComAcao.some(g => soDigitos(g.cpf) === cpf)) {',
    para: '    if (false) {',
  },
  {
    nome: 'esconde a escala fundida do relato (armadilha 22)',
    de: 'return fundidas.map(f =>',
    para: 'return [].map(f =>',
  },
]

let tudoCerto = true

for (const r of regressoes) {
  if (!original.includes(r.de)) {
    console.error(`NAO APLICADA: o trecho da regressao "${r.nome}" nao existe no transpilado.`)
    console.error(`  procurado: ${r.de}`)
    tudoCerto = false
    continue
  }

  const quebrado = original.split(r.de).join(r.para)
  if (quebrado === original) {
    console.error(`NAO APLICADA (substituicao no-op): ${r.nome}`)
    tudoCerto = false
    continue
  }

  fs.writeFileSync(ALVO, quebrado)
  let reprovou = false
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  } catch (e) {
    reprovou = true
  }
  fs.writeFileSync(ALVO, original)

  if (reprovou) {
    console.log(`OK   o portao reprova: ${r.nome}`)
  } else {
    console.error(`FALHA o portao PASSOU com a regressao: ${r.nome}`)
    tudoCerto = false
  }
}

// E, sem regressao nenhuma, ele tem que passar -- senao "reprova sempre" nao prova nada.
try {
  execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  console.log('OK   o portao passa com o codigo intacto')
} catch (e) {
  console.error('FALHA o portao reprova o codigo INTACTO')
  tudoCerto = false
}

process.exit(tudoCerto ? 0 : 1)
