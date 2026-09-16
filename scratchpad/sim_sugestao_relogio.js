#!/usr/bin/env node
/**
 * Portao da regra de sugestao de relogio (Parte 2 do plano de 15/09/2026).
 *
 * Transpile antes:
 *   npx tsc src/utils/setores/sugestaoRelogio.ts --outDir scratchpad/_sim --module commonjs --target es2020
 */
const path = require('path')
const S = require(path.resolve(__dirname, '_sim/sugestaoRelogio.js'))

let ok = 0
const falhas = []
function eq(rotulo, achado, esperado) {
  const a = JSON.stringify(achado)
  const e = JSON.stringify(esperado)
  if (a === e) { ok++ } else { falhas.push(`${rotulo}: achou ${a}, esperava ${e}`) }
}
function verdade(rotulo, cond) {
  if (cond) { ok++ } else { falhas.push(rotulo) }
}

const evid = (id) => ({ dispositivo_id: id, dispositivo_nome: id, unidade_nome: 'U', forca: 2, motivo: 'bate' })
const palp = (id) => ({ dispositivo_id: id, dispositivo_nome: id, unidade_nome: 'U', forca: 1, motivo: 'pai' })

// ---------------------------------------------------------------------------
// preMarcadas: SO o sinal forte
// ---------------------------------------------------------------------------
eq('lista vazia nao marca nada', S.preMarcadas([]), [])
eq('nulo nao quebra', S.preMarcadas(null), [])
eq('evidencia vem marcada', S.preMarcadas([evid('a')]), ['a'])
eq('duas evidencias vem marcadas', S.preMarcadas([evid('a'), evid('b')]), ['a', 'b'])

// 🚨 O caso que motivou a regra: os polos do CAF. Palpite NUNCA vem marcado.
eq('palpite NAO vem marcado', S.preMarcadas([palp('caf-01')]), [])
eq('dois palpites NAO vem marcados', S.preMarcadas([palp('caf-01'), palp('caf-02')]), [])
eq('mistura marca so a evidencia', S.preMarcadas([palp('x'), evid('y'), palp('z')]), ['y'])

// forca desconhecida (0, ou futura) nunca e' tratada como forte por acidente
eq('forca 0 nao marca', S.preMarcadas([{ ...palp('a'), forca: 0 }]), [])
eq('forca acima de 2 marca (sinal mais forte ainda)', S.preMarcadas([{ ...evid('a'), forca: 3 }]), ['a'])

// ---------------------------------------------------------------------------
// temEvidencia
// ---------------------------------------------------------------------------
verdade('temEvidencia false em lista vazia', S.temEvidencia([]) === false)
verdade('temEvidencia false so com palpite', S.temEvidencia([palp('a'), palp('b')]) === false)
verdade('temEvidencia true com uma evidencia', S.temEvidencia([palp('a'), evid('b')]) === true)

// ---------------------------------------------------------------------------
// textoIntroducao: a frase muda com a DECISAO que se pede
// ---------------------------------------------------------------------------
verdade('sem sugestao, texto explica por que nao sabe',
  /Não dá para sugerir/.test(S.textoIntroducao([])))
verdade('com evidencia, texto diz que ja vem marcado',
  /já vem marcado/.test(S.textoIntroducao([evid('a')])))
verdade('com palpite, texto PEDE confirmacao',
  /Confirme antes de aplicar/.test(S.textoIntroducao([palp('a')])))
verdade('com palpite, texto NAO promete que ja vem marcado',
  !/já vem marcado/.test(S.textoIntroducao([palp('a')])))

// ---------------------------------------------------------------------------
// avisoPalpite: so aparece quando e palpite puro
// ---------------------------------------------------------------------------
verdade('sem sugestao nao mostra aviso de palpite', S.avisoPalpite([]) === null)
verdade('com evidencia nao mostra aviso de palpite', S.avisoPalpite([evid('a')]) === null)
verdade('mistura nao mostra aviso de palpite', S.avisoPalpite([palp('a'), evid('b')]) === null)
verdade('palpite puro mostra o aviso', typeof S.avisoPalpite([palp('a')]) === 'string')
verdade('o aviso fala de PREDIO, que e o eixo real da decisao',
  /outro prédio/.test(S.avisoPalpite([palp('a')]) || ''))

// ---------------------------------------------------------------------------
// Invariante estrutural: as constantes nao podem se inverter
// ---------------------------------------------------------------------------
verdade('evidencia e mais forte que palpite', S.FORCA_EVIDENCIA > S.FORCA_PALPITE)
verdade('o corte da pre-marcacao e a evidencia',
  S.preMarcadas([{ ...palp('a'), forca: S.FORCA_EVIDENCIA }]).length === 1 &&
  S.preMarcadas([{ ...palp('a'), forca: S.FORCA_PALPITE }]).length === 0)

console.log(`${ok} assercoes passaram, ${falhas.length} falharam`)
for (const f of falhas) console.log('  FALHOU: ' + f)
process.exit(falhas.length ? 1 : 0)
