// /relatorios/consolidado passa a usar a fonte unica de horas de escala (05/09/2026).
// A formula aqui ja estava CERTA — o problema era ser a terceira copia dela. Duas copias certas
// e uma errada foi exatamente o estado que produziu 37.223h de divergencia entre o painel e este
// relatorio; unificar e o que impede a proxima copia de divergir de novo.
const fs = require('fs')
const P = 'src/app/(dashboard)/relatorios/consolidado/page.tsx'
const CR = String.fromCharCode(13), NL = String.fromCharCode(10)
let s = fs.readFileSync(P, 'utf8')
const CRLF = s.indexOf(CR + NL) >= 0
if (CRLF) s = s.split(CR + NL).join(NL)
const antes = s.length
let n = 0
function sub(velho, novo, esperado = 1) {
  const c = s.split(velho).length - 1
  if (c !== esperado) {
    console.error('ABORTA: ' + c + ' ocorrencia(s), esperado ' + esperado + NL + '---' + NL + velho.slice(0, 240) + NL + '---')
    process.exit(1)
  }
  s = s.split(velho).join(novo)
  n++
}

sub(
  "import { buscarTodasPaginas } from '@/utils/paginacao'",
  "import { buscarTodasPaginas } from '@/utils/paginacao'" + NL +
  "import { horasDaLinhaEscala, horasProntidaoSobreaviso } from '@/utils/escala/horasLinha'"
)

sub([
  '    const jornada = jornadas?.find(j => j.id === item.jornada_id)',
  '    const intervaloHoras = (jornada?.intervalo_minutos || 0) / 60'
].join(NL),
  '    const jornada = jornadas?.find(j => j.id === item.jornada_id)'
)

sub([
  '      if (cat === \'Regular\') {',
  '        let liquidHours = horas',
  '        if (jornada && Number(jornada.horas_totais) > 0) {',
  '          const journeyMaxLiquid = Math.max(0, Number(jornada.horas_totais) - intervaloHoras)',
  '          liquidHours = Math.min(horas, journeyMaxLiquid)',
  '        }',
  '        totals.regular += liquidHours',
  '      } else if (cat === \'Extra\') {',
  '        // Extras in this report are usually simplified, but let\'s sum them',
  '        totals.extra += horas',
  '      } else if (cat === \'Plantão\') {',
  '        totals.plantao += horas',
  '      } else if (cat === \'Sobreaviso\') {'
].join(NL), [
  '      // Fonte única em src/utils/escala/horasLinha.ts — a mesma que o painel usa. A fórmula',
  '      // do Regular (teto líquido da jornada) estava correta aqui e ERRADA lá; unificar é o que',
  '      // impede as duas telas de responderem coisas diferentes sobre a mesma competência.',
  '      if (cat === \'Regular\') {',
  '        totals.regular += horasDaLinhaEscala(cat, t.horas_computadas, jornada)',
  '      } else if (cat === \'Extra\') {',
  '        totals.extra += horasDaLinhaEscala(cat, t.horas_computadas, jornada)',
  '      } else if (cat === \'Plantão\') {',
  '        totals.plantao += horasDaLinhaEscala(cat, t.horas_computadas, jornada)',
  '      } else if (cat === \'Sobreaviso\') {'
].join(NL))

sub([
  '        let val = Number(t.horas_computadas) || 0',
  '        if (val === 0) {',
  '          val = (t.codigo === \'MTN\') ? 24 : (t.codigo === \'MT\' || t.codigo === \'N\' ? 12 : 0)',
  '        }',
  '        totals.sobreaviso += val'
].join(NL),
  '        totals.sobreaviso += horasProntidaoSobreaviso(t.horas_computadas, t.codigo)'
)

fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
console.log(P + ': ' + n + ' substituicoes, ' + antes + ' -> ' + s.length + ' bytes')
