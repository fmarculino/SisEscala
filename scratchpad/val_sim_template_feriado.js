/**
 * Valida os dois portoes da issue #5 injetando regressoes no JS transpilado e exigindo
 * reprovacao em cada uma.
 *
 * As ancoras sao o texto COMPILADO. Cada substituicao e conferida: replace que nao casa vira
 * no-op silencioso e o validador "passaria" sem ter testado nada (armadilha 48).
 *
 * Rode depois de transpilar:
 *   npx tsc src/utils/scaleTemplates.ts src/utils/ui/posicaoFlutuante.ts --outDir scratchpad/_sim_ui --module commonjs --target es2020
 */
const fs = require('fs')
const { execFileSync } = require('child_process')

const casos = [
  {
    alvo: 'scratchpad/_sim_ui/scaleTemplates.js',
    portao: 'scratchpad/sim_template_feriado.js',
    regressoes: [
      {
        nome: 'feriado passa a ser resolvido por new Date (erra o dia em UTC)',
        de: "const dia = parseInt(f.data.slice(prefixo.length, prefixo.length + 2), 10);",
        para: "const dia = new Date(f.data).getDate();"
      },
      {
        nome: 'o prefixo deixa de conferir o ano (feriado de outro ano entra)',
        de: "const prefixo = `${ano}-${String(mes).padStart(2, '0')}-`;",
        para: "const prefixo = `-${String(mes).padStart(2, '0')}-`;"
      },
      {
        nome: 'o mes perde o zero a esquerda',
        de: "const prefixo = `${ano}-${String(mes).padStart(2, '0')}-`;",
        para: "const prefixo = `${ano}-${mes}-`;"
      },
      {
        nome: 'dia fora do mes deixa de ser descartado',
        de: "if (Number.isFinite(dia) && dia >= 1 && dia <= daysInMonth)",
        para: "if (Number.isFinite(dia))"
      },
      {
        nome: 'o 12x36 volta a ignorar os dias pulados',
        de: "        if (isWorkDay && !protectedDays.has(day)) {\n            result[day] = config.turnoId;\n        }\n        isWorkDay = !isWorkDay;",
        para: "        if (isWorkDay) {\n            result[day] = config.turnoId;\n        }\n        isWorkDay = !isWorkDay;"
      },
      {
        nome: 'o 5x2 volta a ignorar os dias pulados',
        de: "if (isWeekday && !protectedDays.has(day)) {",
        para: "if (isWeekday) {"
      }
    ]
  },
  {
    alvo: 'scratchpad/_sim_ui/posicaoFlutuante.js',
    portao: 'scratchpad/sim_posicao_flutuante.js',
    regressoes: [
      {
        nome: 'o painel deixa de limitar a altura ao espaco disponivel (volta o item invisivel)',
        de: "const maxHeight = Math.max(alturaMinima, Math.min(painel.altura, espacoDisponivel));",
        para: "const maxHeight = painel.altura;"
      },
      {
        nome: 'nunca abre para cima',
        de: "const paraCima = !cabeAbaixo && espacoAcima > espacoAbaixo;",
        para: "const paraCima = false;"
      },
      {
        nome: 'o painel volta a vazar pela direita',
        de: "const left = Math.min(Math.max(margem, ancora.left), limiteDireita);",
        para: "const left = ancora.left;"
      },
      {
        nome: 'a altura minima some (painel espremido a nada)',
        de: "Math.max(alturaMinima, Math.min(painel.altura, espacoDisponivel))",
        para: "Math.min(painel.altura, espacoDisponivel)"
      }
    ]
  }
]

let reprovadas = 0
let total = 0
const naoDetectadas = []

for (const caso of casos) {
  const original = fs.readFileSync(caso.alvo, 'utf8')

  for (const r of caso.regressoes) {
    total++
    if (original.split(r.de).length - 1 < 1) {
      console.error('ABORTADO: ancora nao encontrada em ' + caso.alvo + ' — ' + r.nome)
      fs.writeFileSync(caso.alvo, original)
      process.exit(1)
    }

    const quebrado = original.split(r.de).join(r.para)
    if (quebrado === original) {
      console.error('ABORTADO: substituicao foi no-op — ' + r.nome)
      fs.writeFileSync(caso.alvo, original)
      process.exit(1)
    }

    fs.writeFileSync(caso.alvo, quebrado)
    let passou = true
    try {
      execFileSync(process.execPath, [caso.portao], { stdio: 'pipe' })
    } catch {
      passou = false
    }

    if (passou) {
      naoDetectadas.push(r.nome)
      console.error('NAO DETECTADA: ' + r.nome)
    } else {
      reprovadas++
      console.log('reprovada como esperado: ' + r.nome)
    }
  }

  fs.writeFileSync(caso.alvo, original)
  try {
    execFileSync(process.execPath, [caso.portao], { stdio: 'pipe' })
  } catch {
    console.error('ABORTADO: o portao ' + caso.portao + ' nao passa sobre o modulo restaurado')
    process.exit(1)
  }
}

console.log('\n' + reprovadas + ' de ' + total + ' regressoes reprovadas')
process.exit(naoDetectadas.length === 0 ? 0 : 1)
