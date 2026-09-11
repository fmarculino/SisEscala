// Valida o portao: injeta regressoes de proposito no JS transpilado e exige que
// sim_escopo_gestao.js REPROVE cada uma. Portao que nunca falha nao vale nada.
//
//   npx tsc src/utils/escopoGestao.ts --outDir scratchpad/_sim --module commonjs --target es2020
//   node scratchpad/val_sim_escopo_gestao.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.join(__dirname, '_sim/escopoGestao.js')
const SIM = path.join(__dirname, 'sim_escopo_gestao.js')

if (!fs.existsSync(ALVO)) {
  console.error('ABORTADO: transpile antes -> npx tsc src/utils/escopoGestao.ts --outDir scratchpad/_sim --module commonjs --target es2020')
  process.exit(1)
}
const ORIGINAL = fs.readFileSync(ALVO, 'utf8')

// ⚠️ As ancoras sao do JS COMPILADO, nao do TypeScript. E cada injecao confere que a
// substituicao foi APLICADA: a primeira versao de um validador deste projeto fez um replace
// no-op por diferenca de indentacao e "passou" sem ter testado nada (armadilha 48).
const REGRESSOES = [
  {
    nome: 'RH Geral sai dos irrestritos (o pedido original volta ao zero)',
    de: "PAPEIS_IRRESTRITOS = ['super_admin', 'admin', 'rh']",
    para: "PAPEIS_IRRESTRITOS = ['super_admin', 'admin']",
  },
  {
    nome: 'RH da Unidade ganha a mesclagem (27 grupos cruzados, 31 com ponto)',
    de: "PAPEIS_MESCLAGEM = ['super_admin', 'rh']",
    para: "PAPEIS_MESCLAGEM = ['super_admin', 'rh', 'rh_unidade']",
  },
  {
    nome: 'coordenador entra no modelo de gestao (abrir "para gestores" em vez de "para os RHs")',
    de: "PAPEIS_ESCOPADOS = ['rh_unidade']",
    para: "PAPEIS_ESCOPADOS = ['rh_unidade', 'coordenador']",
  },
  {
    nome: 'grupo de duplicidade exige TODOS os membros no escopo (HMI cai de 52 para 12)',
    de: 'return unidadesDoGrupo.some((u) => unidadeNoEscopo(escopo, u));',
    para: 'return unidadesDoGrupo.every((u) => unidadeNoEscopo(escopo, u));',
  },
  {
    nome: 'unidade nula passa a alcancar (na duvida, ABRE)',
    de: '    if (!unidadeId)\n        return false;',
    para: '    if (!unidadeId)\n        return true;',
  },
  {
    nome: 'montarEscopoGestao esquece profile_setores (perfil por setor abre a tela vazia)',
    de: '        .map((ps) => (Array.isArray(ps.setores) ? ps.setores[0] : ps.setores)?.unidade_id)',
    para: '        .map(() => undefined)',
  },
  {
    nome: 'filtrarPorUnidade devolve tudo para quem nao gerencia (default ABRE)',
    de: '    if (!ehEscopado(escopo.role))\n        return [];',
    para: '    if (!ehEscopado(escopo.role))\n        return itens;',
  },
]

let reprovadas = 0
let problemas = 0

for (const r of REGRESSOES) {
  const c = ORIGINAL.split(r.de).length - 1
  if (c < 1) {
    console.error(`  PROBLEMA  "${r.nome}": ancora nao encontrada no JS compilado — a injecao seria NO-OP`)
    problemas++
    continue
  }
  const alterado = ORIGINAL.split(r.de).join(r.para)
  if (alterado === ORIGINAL) {
    console.error(`  PROBLEMA  "${r.nome}": substituicao nao mudou nada`)
    problemas++
    continue
  }

  fs.writeFileSync(ALVO, alterado)
  let passou
  try {
    execFileSync(process.execPath, [SIM], { stdio: 'pipe' })
    passou = true
  } catch {
    passou = false
  }
  fs.writeFileSync(ALVO, ORIGINAL)

  if (passou) {
    console.error(`  NAO PEGOU  ${r.nome}`)
    problemas++
  } else {
    console.log(`  ok  reprovou: ${r.nome}`)
    reprovadas++
  }
}

// O portao tem que continuar passando com o arquivo intacto.
try {
  execFileSync(process.execPath, [SIM], { stdio: 'pipe' })
  console.log('  ok  passa com o codigo intacto')
} catch (e) {
  console.error('  PROBLEMA  o portao reprova o codigo INTACTO')
  problemas++
}

console.log(`\n${reprovadas}/${REGRESSOES.length} regressoes reprovadas, ${problemas} problema(s)`)
process.exit(problemas === 0 ? 0 : 1)
