/**
 * Aplica as HORAS NORMAIS LIQUIDAS (sem o intervalo) em todos os pontos que somam carga do dia.
 *
 * `horas_totais` e o VAO do relogio (08H AS 18H = 10h), nao o tempo de trabalho. Somar aquele
 * campo contava o almoco como jornada: 9.217h em 08/2026, 14,1% do total. Ver
 * horasNormaisDaJornada em src/utils/folha/cargaDiaria.ts.
 *
 * Vale a partir de 09/2026: competencia anterior e documento assinado. ABORTA na divergencia.
 *
 * ⚠️ A ORDEM IMPORTA. O padrao de 4 espacos ("    const ...") casa DENTRO da linha de 8 espacos
 * do laco de autoCorrigirTodasFolhasPonto. Por isso a de 8 vem primeiro, e as de 4 sao ancoradas
 * com a quebra de linha.
 */
const fs = require('fs')
const path = require('path')
const RAIZ = path.join(__dirname, '..')
const ARQ_FOLHA = path.join(RAIZ, 'src/app/(dashboard)/folha-ponto/actions.ts')
const ARQ_PORTAL = path.join(RAIZ, 'src/app/consultar-escala/actions.ts')
const conta = (t, p) => t.split(p).length - 1

function editar(arquivo, pares) {
  let s = fs.readFileSync(arquivo, 'utf8')
  const crlf = s.includes('\r\n')
  const n2 = t => (crlf ? t.replace(/\n/g, '\r\n') : t)
  for (const [alvo, novo, esperado, rotulo] of pares) {
    const a = n2(alvo)
    const n = conta(s, a)
    if (n !== esperado) throw new Error(`${path.basename(arquivo)} / ${rotulo}: esperava ${esperado}, achou ${n}`)
    s = s.split(a).join(n2(novo))
  }
  fs.writeFileSync(arquivo, s)
}

const GLOBAL_ANTES = `    const globalHorasNormaisDiarias = globalJornadaDetails?.horas_totais ?? 8`
const GLOBAL_DEPOIS = `    const globalHorasNormaisDiarias = horasNormaisDaJornada(globalJornadaDetails, descontarIntervalo)`
const DIA_ANTES = `      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : (activeJornada?.horas_totais ?? 8)`
const DIA_DEPOIS = `      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : horasNormaisDaJornada(activeJornada, descontarIntervalo)`

editar(ARQ_FOLHA, [
  [GLOBAL_ANTES, GLOBAL_DEPOIS, 2, 'jornada do mes (geracao x2)'],
  [DIA_ANTES, DIA_DEPOIS, 2, 'jornada do dia (geracao x2)'],
  // 8 espacos PRIMEIRO (laco por folha: a vigencia e resolvida por competencia)
  [
    `        const horasNormaisDiarias = jornadaInfo?.horas_totais ?? 8`,
    `        const horasNormaisDiarias = horasNormaisDaJornada(jornadaInfo, horasNormaisLiquidasVigente(folha.mes, folha.ano, vigenciaHorasLiquidas))`,
    1, 'recalculo (autoCorrigirTodasFolhasPonto)',
  ],
  [
    `\n    const horasNormaisDiarias = jornadaInfo?.horas_totais ?? 8`,
    `\n    const horasNormaisDiarias = horasNormaisDaJornada(jornadaInfo, descontarIntervalo)`,
    1, 'recalculo (autoCorrigirFolhaPonto)',
  ],
  [
    `\n    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8`,
    `\n    const horasNormaisDiarias = horasNormaisDaJornada(jornadaDetails, descontarIntervalo)`,
    1, 'recalculo (salvarFolhaPonto)',
  ],
  [
    `    const cargaPorJornada = montarCargaPorJornada(todasJornadas)`,
    `    const cargaPorJornada = montarCargaPorJornada(todasJornadas, descontarIntervalo)`,
    1, 'mapa (salvarFolhaPonto)',
  ],
  [
    `    const cargaPorJornada = montarCargaPorJornada(todasJornadasAuto)`,
    `    const cargaPorJornada = montarCargaPorJornada(todasJornadasAuto, descontarIntervalo)`,
    1, 'mapa (autoCorrigirFolhaPonto)',
  ],
  [
    `import { montarCargaPorJornada, horasNormaisDoDia } from '@/utils/folha/cargaDiaria'`,
    `import { montarCargaPorJornada, horasNormaisDoDia, horasNormaisDaJornada } from '@/utils/folha/cargaDiaria'`,
    1, 'import (folha-ponto)',
  ],
])

editar(ARQ_PORTAL, [
  [GLOBAL_ANTES, GLOBAL_DEPOIS, 2, 'jornada do mes (geracao x2)'],
  [DIA_ANTES, DIA_DEPOIS, 2, 'jornada do dia (geracao x2)'],
  [
    `\n    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8`,
    `\n    const horasNormaisDiarias = horasNormaisDaJornada(jornadaDetails, descontarIntervalo)`,
    1, 'recalculo (salvarFolhaPontoServidor)',
  ],
  [
    `    const cargaPorJornada = montarCargaPorJornada(todasJornadas)`,
    `    const cargaPorJornada = montarCargaPorJornada(todasJornadas, descontarIntervalo)`,
    1, 'mapa (salvarFolhaPontoServidor)',
  ],
  [
    `import { montarCargaPorJornada, horasNormaisDoDia } from '@/utils/folha/cargaDiaria'`,
    `import { montarCargaPorJornada, horasNormaisDoDia, horasNormaisDaJornada } from '@/utils/folha/cargaDiaria'`,
    1, 'import (portal)',
  ],
])

for (const arq of [ARQ_FOLHA, ARQ_PORTAL]) {
  const s = fs.readFileSync(arq, 'utf8')
  const restante = conta(s, 'horas_totais ?? 8')
  if (restante !== 0) throw new Error(`${path.basename(arq)}: sobraram ${restante} somas brutas de horas_totais`)
  console.log(`${path.basename(arq)}: nenhuma soma bruta restante`)
}
