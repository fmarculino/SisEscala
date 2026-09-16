#!/usr/bin/env node
/**
 * Valida o portao sim_sugestao_relogio.js injetando regressoes DE PROPOSITO.
 * Um portao que nunca reprova nao vale nada (CLAUDE.md, armadilha 36).
 *
 * ⚠️ As ancoras sao o texto do JS COMPILADO, nao o do TypeScript. Cada injecao confere que a
 * substituicao foi mesmo APLICADA - um replace no-op faria o validador "passar" sem ter
 * testado nada (armadilha 48).
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ALVO = path.resolve(__dirname, '_sim/sugestaoRelogio.js')
const PORTAO = path.resolve(__dirname, 'sim_sugestao_relogio.js')
const original = fs.readFileSync(ALVO, 'utf8')

const REGRESSOES = [
  {
    nome: 'palpite passa a vir PRE-MARCADO (o defeito que a regra existe para impedir)',
    de: 's.forca >= exports.FORCA_EVIDENCIA',
    para: 's.forca >= exports.FORCA_PALPITE',
  },
  {
    nome: 'pre-marcacao marca TUDO, sem olhar forca',
    de: '.filter((s) => s.forca >= exports.FORCA_EVIDENCIA)',
    para: '.filter(() => true)',
  },
  {
    nome: 'temEvidencia mente: diz que ha evidencia sempre',
    de: 'return (sugestoes || []).some((s) => s.forca >= exports.FORCA_EVIDENCIA);',
    para: 'return true;',
  },
  {
    nome: 'o texto do palpite promete que "ja vem marcado"',
    de: "'Palpite pela hierarquia dos setores. Confirme antes de aplicar:'",
    para: "'Relógio provável — já vem marcado:'",
  },
  {
    nome: 'o aviso de palpite some',
    de: 'if (temEvidencia(sugestoes))\n        return null;',
    para: 'return null;',
  },
  {
    nome: 'as forcas se invertem (palpite vira o sinal forte)',
    de: 'exports.FORCA_EVIDENCIA = 2;',
    para: 'exports.FORCA_EVIDENCIA = 0;',
  },
]

let reprovadas = 0
const problemas = []

for (const r of REGRESSOES) {
  const ocorrencias = original.split(r.de).length - 1
  if (ocorrencias < 1) {
    problemas.push(`ANCORA NAO ENCONTRADA para "${r.nome}" — a injecao nao testaria nada`)
    continue
  }
  const mutado = original.split(r.de).join(r.para)
  if (mutado === original) {
    problemas.push(`INJECAO NO-OP para "${r.nome}"`)
    continue
  }

  fs.writeFileSync(ALVO, mutado)
  let passou = true
  try {
    execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
  } catch {
    passou = false
  }
  fs.writeFileSync(ALVO, original)

  if (passou) problemas.push(`O PORTAO NAO PEGOU: ${r.nome}`)
  else { reprovadas++; console.log(`  ok reprovou: ${r.nome}`) }
}

// o portao tem que voltar a passar com o arquivo original
try {
  execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' })
} catch {
  problemas.push('O PORTAO REPROVA O ARQUIVO ORIGINAL — restauracao falhou')
}

console.log(`\n${reprovadas} de ${REGRESSOES.length} regressoes foram pegas`)
for (const p of problemas) console.log('  FALHOU: ' + p)
process.exit(problemas.length ? 1 : 0)
