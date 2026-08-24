/**
 * A grade passa a EXIBIR todos os afastamentos do dia, nao so o primeiro.
 *
 * `getActiveEventForDay` e `encontrarAfastamentoBloqueante` usam `.find()`: num dia com duas
 * declaracoes de comparecimento (uma pela manha, outra a tarde) a celula nomeava so uma, e o
 * coordenador concluia que a outra nao tinha sido lancada. Bloqueio continua binario — o que
 * muda e o rotulo e o tooltip. Aborta se qualquer trecho alvo nao bater exatamente.
 */
const fs = require('fs')

const ARQ = 'src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx'
let t = fs.readFileSync(ARQ, 'utf8')
const nl = t.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(nl)

if (t.includes('getEventosDoDia')) { console.log('= ja aplicado'); process.exit(0) }

const CORPO_BLOQUEANTE = [
  '      eventos: servidoresEventos as AfastamentoEvento[],',
  '      servidorId,',
  '      dataISO: dataISODoDia(ano, mes, day),',
  '      categoria,',
  '      turnoSlots,',
  '      permitirPlantaoExtra: permitirPlantaoExtraEventos',
  '    })',
  '  }, [servidoresEventos, mes, ano, permitirPlantaoExtraEventos])',
]

const SUBS = [
  // 1. import da versao no plural e do rotulo de tooltip
  [ L('import {',
      '  encontrarAfastamentoBloqueante,',
      '  dataISODoDia,',
      '  siglaAfastamento,',
      '  type AfastamentoEvento',
      "} from '@/utils/afastamentos'"),
    L('import {',
      '  encontrarAfastamentosBloqueantes,',
      '  dataISODoDia,',
      '  siglaAfastamento,',
      '  rotuloAfastamento,',
      '  type AfastamentoEvento',
      "} from '@/utils/afastamentos'") ],

  // 2. eventos do dia no plural
  [ L('  const getActiveEventForDay = useCallback((servidorId: string, day: number) => {',
      "    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`",
      '    return servidoresEventos.find(se => ',
      '      se.servidor_id === servidorId && ',
      '      dateStr >= se.data_inicio && ',
      '      dateStr <= se.data_fim',
      '    )',
      '  }, [servidoresEventos, mes, ano])'),
    L('  /**',
      '   * TODOS os eventos do servidor naquele dia. Um dia pode ter mais de um afastamento —',
      '   * declaracao de comparecimento pela manha e outra a tarde, por exemplo — e ate',
      '   * 24/08/2026 a grade usava `.find()`, nomeando so o primeiro.',
      '   */',
      '  const getEventosDoDia = useCallback((servidorId: string, day: number) => {',
      "    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`",
      '    return servidoresEventos.filter(se =>',
      '      se.servidor_id === servidorId &&',
      '      dateStr >= se.data_inicio &&',
      '      dateStr <= se.data_fim',
      '    )',
      '  }, [servidoresEventos, mes, ano])') ],

  // 3. bloqueantes no plural; o singular vira envelope, para os quatro sitios que so precisam
  //    saber SE bloqueia (digitacao, aviso da linha, template, gerador inteligente)
  [ L('  const getAfastamentoBloqueante = useCallback((',
      '    servidorId: string,',
      '    day: number,',
      '    categoria: RowCategory | string,',
      '    turnoSlots?: string[] | null',
      '  ): AfastamentoEvento | null => {',
      '    return encontrarAfastamentoBloqueante({',
      ...CORPO_BLOQUEANTE),
    L('  const getAfastamentosBloqueantes = useCallback((',
      '    servidorId: string,',
      '    day: number,',
      '    categoria: RowCategory | string,',
      '    turnoSlots?: string[] | null',
      '  ): AfastamentoEvento[] => {',
      '    return encontrarAfastamentosBloqueantes({',
      ...CORPO_BLOQUEANTE,
      '',
      '  /** O primeiro bloqueante. Basta para RECUSAR; para EXIBIR use a lista. */',
      '  const getAfastamentoBloqueante = useCallback((',
      '    servidorId: string,',
      '    day: number,',
      '    categoria: RowCategory | string,',
      '    turnoSlots?: string[] | null',
      '  ): AfastamentoEvento | null =>',
      '    getAfastamentosBloqueantes(servidorId, day, categoria, turnoSlots)[0] || null,',
      '  [getAfastamentosBloqueantes])') ],

  // 4. uso no render
  [ L('                        const activeEvent = getActiveEventForDay(em.servidor_id, day)',
      '                        const dayTempJourney = serverTempJourneys.find(jt => dateStr >= jt.data_inicio && dateStr <= jt.data_fim)',
      '                        const blockingEvent = getAfastamentoBloqueante(em.servidor_id, day, cat, currentSlots)',
      '                        const isCellBlockedByEvent = !!blockingEvent',
      "                        const eventAbbr = blockingEvent ? siglaAfastamento(blockingEvent) : ''"),
    L('                        const eventosDoDia = getEventosDoDia(em.servidor_id, day)',
      '                        const activeEvent = eventosDoDia[0] || null',
      '                        const dayTempJourney = serverTempJourneys.find(jt => dateStr >= jt.data_inicio && dateStr <= jt.data_fim)',
      '                        const blockingEvents = getAfastamentosBloqueantes(em.servidor_id, day, cat, currentSlots)',
      '                        const blockingEvent = blockingEvents[0] || null',
      '                        const isCellBlockedByEvent = !!blockingEvent',
      '                        // Sigla do primeiro mais o quanto sobrou: o `+1` denuncia o segundo',
      '                        // lancamento, que a celula nao tem largura para escrever.',
      '                        const eventAbbr = blockingEvent',
      "                          ? `${siglaAfastamento(blockingEvent)}${blockingEvents.length > 1 ? `+${blockingEvents.length - 1}` : ''}`",
      "                          : ''") ],

  // 5. tooltip do bloqueio: lista todos
  [ "                                ? `\u26A0\uFE0F BLOQUEADO: Servidor em afastamento (${blockingEvent!.tipos_eventos?.nome})${blockingEvent!.slots && blockingEvent!.slots.length > 0 ? ` [Período: ${blockingEvent!.slots.join(', ')}]` : ''}${blockingEvent!.observacao ? ` - ${blockingEvent!.observacao}` : ''}`",
    "                                ? `\u26A0\uFE0F BLOQUEADO: Servidor em afastamento — ${blockingEvents.map(rotuloAfastamento).join(' | ')}`" ],

  // 6. tooltip do evento nao-bloqueante: lista todos
  [ "                                          ? `\u2139\uFE0F Servidor em afastamento (${activeEvent.tipos_eventos?.nome})${(activeEvent.periodo_tipo === 'horas' || activeEvent.hora_inicio) ? ' por horas - não bloqueia a escala do dia' : ' - alocação permitida nesta linha'}`",
    "                                          ? `\u2139\uFE0F Servidor em afastamento — ${eventosDoDia.map(ev => `${rotuloAfastamento(ev)}${(ev.periodo_tipo === 'horas' || ev.hora_inicio) ? ' (por horas, não bloqueia a escala do dia)' : ' (alocação permitida nesta linha)'}`).join(' | ')}`" ],

  // 7. bolinha indicadora: title com todos
  [ "                                    title={`Afastamento: ${activeEvent.tipos_eventos?.nome}`}",
    "                                    title={`Afastamento: ${eventosDoDia.map(rotuloAfastamento).join(' | ')}`}" ],
]

for (const [de, para] of SUBS) {
  const n = t.split(de).length - 1
  if (n !== 1) throw new Error(`trecho apareceu ${n}x, esperado 1x:\n${de.slice(0, 140)}`)
  t = t.split(de).join(para)
}

if (/getActiveEventForDay|encontrarAfastamentoBloqueante\b/.test(t)) {
  throw new Error('sobrou referencia ao caminho singular do utilitario')
}
for (const [nome, esperado] of [['getEventosDoDia', 2], ['getAfastamentosBloqueantes', 4], ['getAfastamentoBloqueante', 5]]) {
  const n = (t.match(new RegExp(nome + '\\b', 'g')) || []).length
  if (n !== esperado) throw new Error(`${nome} aparece ${n}x, esperado ${esperado}x`)
}

fs.writeFileSync(ARQ, t)
console.log('ok: 7 trechos atualizados')
