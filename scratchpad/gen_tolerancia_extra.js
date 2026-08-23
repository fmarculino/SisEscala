/**
 * Aplica a tolerancia do Art. 58 §1º da CLT nas 4 copias do calculo de hora extra da GERACAO.
 *
 * As 4 copias sao identicas (CLAUDE.md manda mexer nas quatro pelo mesmo criterio). O script
 * ABORTA se a contagem de ocorrencias nao for exatamente a esperada.
 *
 * Os outros 2 sitios que calculam hora extra — FolhaPontoEditor.recalculateOvertimeForDay e
 * normalizarHorarios.normalizarRegistrosFolha — tem forma propria e sao editados a mao.
 *
 * Uso: node scratchpad/gen_tolerancia_extra.js [--aplicar]
 */
const fs = require('fs'), path = require('path')
const APLICAR = process.argv.includes('--aplicar')
const die = m => { console.error('ABORTADO: ' + m); process.exit(1) }

const ARQUIVOS = [
  { p: 'src/app/(dashboard)/folha-ponto/actions.ts', nLeitura: 2, nBloco: 2 },
  { p: 'src/app/consultar-escala/actions.ts', nLeitura: 2, nBloco: 2 },
]

const LEITURA_DE_LF = `    definirTimezone(timezone)\n`
const LEITURA_PARA_LF = `    definirTimezone(timezone)

    // Tolerancia de variacao de horario (CLT Art. 58 §1º). Configuravel porque regra local pode
    // divergir; ausente, cai no default da CLT. Ver src/utils/folha/toleranciaExtra.ts.
    const { data: cfgTolerancia } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')
      .in('chave', ['tolerancia_extra_minutos_por_marcacao', 'tolerancia_extra_minutos_diaria'])
    const limitesTolerancia = lerLimitesTolerancia(cfgTolerancia)
`

const BLOCO_DE_LF = `        if (evalExit && registro.entrada && evalExit > effectiveScheduledExit) {
          let extra50Min = 0`
const BLOCO_PARA_LF = `        // TOLERANCIA DO ART. 58 §1º DA CLT — limiar, nao franquia (Sumula 366 do TST): dentro do
        // limite nao ha hora extra nenhuma; fora dele, computa-se a TOTALIDADE do excedente.
        // A antecipacao da entrada entra so na decisao, nunca no valor pago.
        const excedenteSaidaMin = minutosEntre(evalExit, effectiveScheduledExit)
        const antecipacaoEntradaMin = minutosEntre(scheduledEntrance, realEntradaTime)
        const absorvidoPelaTolerancia = toleranciaAbsorve({
          excedenteSaidaMin,
          antecipacaoEntradaMin,
          limites: limitesTolerancia,
        })

        if (evalExit && registro.entrada && evalExit > effectiveScheduledExit && !absorvidoPelaTolerancia) {
          let extra50Min = 0`

const IMPORT = `import { lerLimitesTolerancia, minutosEntre, toleranciaAbsorve } from '@/utils/folha/toleranciaExtra'`

let trocas = 0
for (const { p, nLeitura, nBloco } of ARQUIVOS) {
  const full = path.join(__dirname, '..', p)
  let txt = fs.readFileSync(full, 'utf8')
  // As fontes deste projeto usam CRLF. Procurar por LF puro nao casa nada e o gerador aborta
  // dizendo "achei 0" — foi exatamente o que aconteceu na primeira execucao deste script.
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10)
  const EOL = txt.includes(CR + LF) ? CR + LF : LF
  const nl = t => t.split(LF).join(EOL)
  const LEITURA_DE = nl(LEITURA_DE_LF), LEITURA_PARA = nl(LEITURA_PARA_LF)
  const BLOCO_DE = nl(BLOCO_DE_LF), BLOCO_PARA = nl(BLOCO_PARA_LF)

  const cL = txt.split(LEITURA_DE).length - 1
  if (cL !== nLeitura) die(p + ': esperava ' + nLeitura + ' definirTimezone, achei ' + cL)
  const cB = txt.split(BLOCO_DE).length - 1
  if (cB !== nBloco) die(p + ': esperava ' + nBloco + ' blocos de hora extra, achei ' + cB)

  // invariantes que precisam sobreviver
  for (const inv of ['scheduledEntrance', 'realEntradaTime', 'effectiveScheduledExit']) {
    if (!txt.includes(inv)) die(p + ': invariante ausente ANTES: ' + inv)
  }

  txt = txt.split(LEITURA_DE).join(LEITURA_PARA)
  txt = txt.split(BLOCO_DE).join(BLOCO_PARA)
  if (!txt.includes("from '@/utils/folha/toleranciaExtra'")) {
    const i = txt.indexOf('\n', txt.indexOf('import ')) + 1
    txt = txt.slice(0, i) + IMPORT + '\n' + txt.slice(i)
  }

  const depois = txt.split('absorvidoPelaTolerancia').length - 1
  if (depois !== nBloco * 2) die(p + ': esperava ' + (nBloco * 2) + ' usos de absorvidoPelaTolerancia, achei ' + depois)
  const usos = txt.split('limitesTolerancia').length - 1
  if (usos !== nLeitura + nBloco) die(p + ': limitesTolerancia fora de conta: ' + usos)

  trocas += nBloco
  if (APLICAR) fs.writeFileSync(full, txt, 'utf8')
  console.log('  ' + p + ': ' + nBloco + ' blocos, ' + nLeitura + ' leituras de config')
}
console.log((APLICAR ? 'APLICADO' : 'ENSAIO') + ': ' + trocas + ' blocos de calculo de hora extra')
if (!APLICAR) console.log('(nada escrito; rode com --aplicar)')
