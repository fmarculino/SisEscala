// VALIDADOR do portao sim_batida_retida.js: injeta regressoes no MODULO COMPILADO e exige que
// o portao REPROVE cada uma. Portao que nunca falha nao vale nada.
//
// ⚠️ As ancoras sao o texto do JS COMPILADO, nao o do TypeScript (o tsc reformata). Cada
//    injecao CONFERE que a substituicao foi de fato aplicada -- um replace no-op faria o
//    validador "passar" sem ter testado nada (armadilha 48).
//
// Uso:
//   npx tsc src/utils/reconciliacaoPendente.ts --outDir scratchpad/_sim --module commonjs --target es2020
//   node scratchpad/val_sim_batida_retida.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.join(__dirname, '_sim', 'reconciliacaoPendente.js')
const PORTAO = path.join(__dirname, 'sim_batida_retida.js')
const original = fs.readFileSync(ALVO, 'utf8')

const REGRESSOES = [
  {
    nome: 'campo ausente passa a significar "ha batida retida" (acusaria o parque inteiro)',
    de: 'Number(l.batidas_retidas ?? 0)',
    para: 'Number(l.batidas_retidas ?? 1)',
  },
  {
    nome: 'a linha de DIAGNOSTICO volta a virar campo de conflito (rotulo vazio na tela)',
    de: `        if (l.tipo === 'batida_retida') {`,
    para: `        if (false) {`,
  },
  {
    nome: 'batida retida torna o dia inelegivel sozinha (celula fica vazia por precaucao)',
    de: '    for (const d of mapa.values()) {\n        if (d.conflitos.length > 0)',
    para: '    for (const d of mapa.values()) {\n        if (d.batidasRetidas > 0)\n            d.elegivel = false;\n        if (d.conflitos.length > 0)',
  },
  {
    nome: 'restaurar passa a oferecer os dias ELEGIVEIS em vez dos que tem batida retida',
    de: 'return dias.filter(d => d.batidasRetidas > 0).map(d => ({ servidorId: d.servidorId, data: d.data }));',
    para: 'return dias.filter(d => d.elegivel).map(d => ({ servidorId: d.servidorId, data: d.data }));',
  },
  {
    nome: 'o aviso deixa de dizer O QUE FAZER (vira alarme sem saida)',
    de: '+ ` use "Restaurar Batidas" para ${n === 1 ? \'devolvê-la\' : \'devolvê-las\'} e então preencher.`;',
    para: '+ ` Procure o administrador.`;',
  },
  {
    nome: 'batida retida volta a ser contada como dia bloqueado (esconde o motivo real)',
    de: `diasBloqueados: dias.filter(d => !!d.impedimento && d.impedimento !== 'batida_retida').length,`,
    para: `diasBloqueados: dias.filter(d => !!d.impedimento).length,`,
  },
  {
    nome: 'o status batida_retida perde o motivo proprio no relato',
    de: `        case 'batida_retida': return 'Há batida real fora de circulação neste dia — restaure antes de preencher.';`,
    para: ``,
  },
  {
    nome: 'a contagem do dia passa a SOMAR a repeticao das linhas em vez de tomar o maior',
    de: 'if (Number.isFinite(retidas) && retidas > d.batidasRetidas)\n            d.batidasRetidas = retidas;',
    para: 'if (Number.isFinite(retidas))\n            d.batidasRetidas += retidas;',
  },
]

function rodaPortao() {
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
    return true   // passou
  } catch {
    return false  // reprovou
  }
}

// 0. Com o modulo intacto o portao TEM de passar -- senao nada abaixo significa nada.
if (!rodaPortao()) {
  console.error('ABORTADO: o portao reprova o modulo INTACTO. Corrija antes de validar regressoes.')
  process.exit(1)
}
console.log('base: portao passa com o modulo intacto.\n')

let pegas = 0
const escapadas = []
for (const r of REGRESSOES) {
  const ocorrencias = original.split(r.de).length - 1
  if (ocorrencias !== 1) {
    fs.writeFileSync(ALVO, original, 'utf8')
    console.error(`ABORTADO: a ancora de "${r.nome}" aparece ${ocorrencias} vez(es) no compilado (esperado 1).`)
    console.error('  Injecao no-op faria este validador "passar" sem testar nada. Reveja a ancora.')
    process.exit(1)
  }

  const mutante = original.split(r.de).join(r.para)
  if (mutante === original) {
    fs.writeFileSync(ALVO, original, 'utf8')
    console.error(`ABORTADO: a injecao de "${r.nome}" nao mudou o arquivo.`)
    process.exit(1)
  }

  fs.writeFileSync(ALVO, mutante, 'utf8')
  const passou = rodaPortao()
  fs.writeFileSync(ALVO, original, 'utf8')

  if (passou) escapadas.push(r.nome)
  else { pegas++; console.log(`  ✓ reprovou: ${r.nome}`) }
}

// Garantia de que o arquivo ficou como estava.
if (fs.readFileSync(ALVO, 'utf8') !== original) {
  console.error('ABORTADO: o modulo compilado nao voltou ao original.')
  process.exit(1)
}

console.log(`\n${pegas} de ${REGRESSOES.length} regressoes reprovadas.`)
if (escapadas.length) {
  console.log('\nESCAPARAM (o portao nao as pega):')
  for (const e of escapadas) console.log('  ✗ ' + e)
  process.exit(1)
}
console.log('VALIDADOR OK — o portao pega todas as regressoes injetadas.')
