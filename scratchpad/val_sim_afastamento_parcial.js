/*
 * Valida o PORTAO: injeta regressoes de proposito no codigo transpilado e exige que
 * sim_afastamento_parcial.js REPROVE cada uma.
 *
 * ⚠️ Armadilha 48 do CLAUDE.md: confirmar que a substituicao foi APLICADA. Um `replace` que nao
 * casa (por indentacao do JS compilado, por exemplo) deixa o portao "passar" e o teste do teste
 * mente. Aqui cada injecao aborta se nao mudar o arquivo.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.join(__dirname, '..')
const SIM = path.join(__dirname, 'sim_afastamento_parcial.js')

const REGRESSOES = [
  {
    nome: 'voltar a bloquear por INTERSECAO (o bug original: {M} anulando um MT)',
    arquivo: 'scratchpad/_sim/afastamentoParcial.js',
    de: 'return alcancados.length === ts.length ? \'anula\' : \'parcial\';',
    para: 'return \'anula\';',
  },
  {
    nome: 'resumo do dia deixar de marcar o afastamento INTEGRAL',
    arquivo: 'scratchpad/_sim/afastamentoParcial.js',
    de: 'integral = true;',
    para: 'integral = false;',
  },
  {
    nome: 'calcularDia voltar a medir atraso em dia parcial',
    arquivo: 'scratchpad/_sim/folha/calculoDia.js',
    de: 'const diaParcial = !!registro.afastamento_slots?.length;',
    para: 'const diaParcial = false;',
  },
  {
    nome: 'abono do meio periodo virar 0 (a folha nao explicaria as 8h com 4h trabalhadas)',
    arquivo: 'scratchpad/_sim/afastamentoParcial.js',
    de: 'total++;',
    para: '',
  },
]

let falhouAlgum = false

for (const r of REGRESSOES) {
  const p = path.join(RAIZ, r.arquivo)
  const original = fs.readFileSync(p, 'utf8')

  if (!original.includes(r.de)) {
    console.error(`ABORTADO: o alvo da injecao "${r.nome}" nao existe em ${r.arquivo}.`)
    console.error(`   procurado: ${r.de}`)
    process.exit(1)
  }
  const alterado = original.split(r.de).join(r.para)
  if (alterado === original) {
    console.error(`ABORTADO: a injecao "${r.nome}" foi um no-op.`)
    process.exit(1)
  }

  fs.writeFileSync(p, alterado, 'utf8')
  let reprovou = false
  try {
    execFileSync(process.execPath, [SIM], { stdio: 'pipe' })
  } catch (e) {
    reprovou = true
  } finally {
    fs.writeFileSync(p, original, 'utf8')
  }

  console.log((reprovou ? 'ok    portao REPROVA: ' : 'FALHA portao ACEITOU: ') + r.nome)
  if (!reprovou) falhouAlgum = true
}

// E, restaurado tudo, o portao precisa voltar a passar.
try {
  const saida = execFileSync(process.execPath, [SIM], { stdio: 'pipe' }).toString().trim()
  console.log('ok    portao passa com o codigo intacto — ' + saida.split('\n').pop())
} catch (e) {
  console.error('FALHA o portao nao passa com o codigo intacto:\n' + e.stdout)
  falhouAlgum = true
}

if (falhouAlgum) process.exit(1)
