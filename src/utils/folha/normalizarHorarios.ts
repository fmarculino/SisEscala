/**
 * Módulo de Normalização e Realinhamento Automático de Horários da Folha de Ponto.
 *
 * Corrige:
 * 1. Horários invertidos (ex: Saída do Intervalo > Retorno do Intervalo).
 * 2. Batidas de jornadas diretas (2 batidas) que caíram indevidamente na coluna de intervalo.
 * 3. Batidas do dia seguinte que vazaram para o dia anterior em plantões consecutivos.
 * 4. Limpeza automática de 'FALTA - AGUARDANDO JUSTIFICATIVA' em dias preenchidos.
 * 5. Recálculo limpo de horas extras sem loops anômalos de múltiplos dias.
 */

export interface NormalizacaoResult {
  registros: any[]
  diasCorrigidos: number
  detalhes: Array<{ dia: number; motivo: string }>
}

function timeToMin(timeStr?: string | null): number | null {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null
  const [h, m] = timeStr.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

function formatMinutesToTime(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function normalizarRegistrosFolha(
  registros: any[],
  mes: number,
  ano: number,
  jornadaPadrao?: { nome?: string; horas_totais?: number; intervalo_minutos?: number }
): NormalizacaoResult {
  if (!Array.isArray(registros) || registros.length === 0) {
    return { registros: registros || [], diasCorrigidos: 0, detalhes: [] }
  }

  const result = registros.map(r => ({ ...r }))
  let diasCorrigidos = 0
  const detalhes: Array<{ dia: number; motivo: string }> = []

  // Passo 1: Desacoplar batidas do dia seguinte que vazaram para o dia anterior
  // Exemplo: Dia D com Retorno=07:34 e Saída=12:34 quando o Dia D+1 tem Entrada=07:34 e Saída Intervalo=12:34
  for (let i = 0; i < result.length - 1; i++) {
    const diaAtual = result[i]
    const diaSeguinte = result[i + 1]

    if (!diaAtual.turno_codigo || !diaSeguinte.turno_codigo) continue

    const proxEntrada = diaSeguinte.entrada
    const proxSaidaInt = diaSeguinte.saida_intervalo

    if (proxEntrada && (diaAtual.retorno_intervalo === proxEntrada || diaAtual.saida === proxEntrada)) {
      // O dia atual herdou batidas da manhã do dia seguinte
      if (diaAtual.saida === proxSaidaInt && diaAtual.retorno_intervalo === proxEntrada) {
        diaAtual.retorno_intervalo = null
        diaAtual.origem_retorno_intervalo = null
        diaAtual.saida = null
        diaAtual.origem_saida = null
        diasCorrigidos++
        detalhes.push({
          dia: diaAtual.dia,
          motivo: `Removidas batidas das ${proxEntrada} e ${proxSaidaInt} que pertencem ao dia seguinte (Dia ${diaSeguinte.dia}).`
        })
      } else if (diaAtual.retorno_intervalo === proxEntrada) {
        diaAtual.retorno_intervalo = null
        diaAtual.origem_retorno_intervalo = null
        diasCorrigidos++
        detalhes.push({
          dia: diaAtual.dia,
          motivo: `Removida batida das ${proxEntrada} que pertence à entrada do dia seguinte (Dia ${diaSeguinte.dia}).`
        })
      }
    }
  }

  // Passo 2: Reorganizar cada dia em ordem cronológica e tratar jornadas diretas
  for (const r of result) {
    if (!r.turno_codigo || r.afastamento || r.feriado) continue

    const jornadaNome = r.jornada_nome || jornadaPadrao?.nome || ''
    const match = jornadaNome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
    let startHour = 8
    let startMin = 0
    let endHour = 18
    let endMin = 0
    let isNoturno = false

    if (match) {
      startHour = parseInt(match[1], 10)
      startMin = match[2] ? parseInt(match[2], 10) : 0
      endHour = parseInt(match[3], 10)
      endMin = match[4] ? parseInt(match[4], 10) : 0
      if (endHour <= startHour) {
        isNoturno = true
      }
    }

    // Coletar todas as marcações válidas do dia e suas origens
    const marcacoes: Array<{ time: string; min: number; origem: string }> = []
    if (r.entrada) marcacoes.push({ time: r.entrada, min: timeToMin(r.entrada)!, origem: r.origem_entrada || 'real' })
    if (r.saida_intervalo) marcacoes.push({ time: r.saida_intervalo, min: timeToMin(r.saida_intervalo)!, origem: r.origem_saida_intervalo || 'real' })
    if (r.retorno_intervalo) marcacoes.push({ time: r.retorno_intervalo, min: timeToMin(r.retorno_intervalo)!, origem: r.origem_retorno_intervalo || 'real' })
    if (r.saida) marcacoes.push({ time: r.saida, min: timeToMin(r.saida)!, origem: r.origem_saida || 'real' })

    // Remover duplicatas exatas de horário no mesmo dia
    const unicos: typeof marcacoes = []
    const seen = new Set<string>()
    for (const m of marcacoes) {
      if (!seen.has(m.time)) {
        seen.add(m.time)
        unicos.push(m)
      }
    }

    if (unicos.length === 0) continue

    const eMin = timeToMin(r.entrada)
    const siMin = timeToMin(r.saida_intervalo)
    const riMin = timeToMin(r.retorno_intervalo)
    const sMin = timeToMin(r.saida)

    const isPlantaoNoturno = isNoturno || (eMin !== null && eMin >= 12 * 60) || unicos.some(u => u.min >= 12 * 60) && unicos.some(u => u.min < 12 * 60)

    let siAdj = siMin
    if (isPlantaoNoturno && eMin !== null && siMin !== null && siMin < eMin) siAdj = siMin + 1440
    let riAdj = riMin
    const refSi = siAdj ?? eMin
    if (isPlantaoNoturno && refSi !== null && riMin !== null && riMin < (refSi % 1440)) riAdj = riMin + 1440
    else if (isPlantaoNoturno && siAdj !== null && siAdj >= 1440 && riMin !== null) riAdj = riMin + 1440
    let sAdj = sMin
    const refRi = riAdj ?? siAdj ?? eMin
    if (isPlantaoNoturno && refRi !== null && sMin !== null && sMin < (refRi % 1440)) sAdj = sMin + 1440
    else if (isPlantaoNoturno && refRi !== null && refRi >= 1440 && sMin !== null) sAdj = sMin + 1440

    const isInvertido = (
      (eMin !== null && siAdj !== null && eMin >= siAdj) ||
      (siAdj !== null && riAdj !== null && siAdj >= riAdj) ||
      (refRi !== null && sAdj !== null && refRi >= sAdj)
    )

    const sortMarcacoes = (a: typeof unicos[0], b: typeof unicos[0]) => {
      if (isPlantaoNoturno) {
        const valA = a.min >= 12 * 60 ? a.min : a.min + 24 * 60
        const valB = b.min >= 12 * 60 ? b.min : b.min + 24 * 60
        return valA - valB
      }
      return a.min - b.min
    }

    // Caso 1: Apenas 2 horários no dia (Entrada e Saída Direta)
    // Se foram distribuídos em Entrada e Saída_Intervalo, mover Saída_Intervalo para Saída Final
    if (unicos.length === 2) {
      unicos.sort(sortMarcacoes)

      const antesEntrada = r.entrada
      const antesSaida = r.saida
      const antesSi = r.saida_intervalo

      r.entrada = unicos[0].time
      r.origem_entrada = unicos[0].origem
      r.saida_intervalo = null
      r.origem_saida_intervalo = null
      r.retorno_intervalo = null
      r.origem_retorno_intervalo = null
      r.saida = unicos[1].time
      r.origem_saida = unicos[1].origem

      if (antesEntrada !== r.entrada || antesSaida !== r.saida || antesSi !== r.saida_intervalo) {
        diasCorrigidos++
        detalhes.push({
          dia: r.dia,
          motivo: `Jornada direta realinhada: Entrada ${r.entrada} e Saída ${r.saida}.`
        })
      }
    }
    // Caso 2: 4 horários no dia (Entrada, Saída Int, Retorno Int, Saída Final)
    else if (unicos.length === 4 && isInvertido) {
      unicos.sort(sortMarcacoes)

      r.entrada = unicos[0].time
      r.origem_entrada = unicos[0].origem
      r.saida_intervalo = unicos[1].time
      r.origem_saida_intervalo = unicos[1].origem
      r.retorno_intervalo = unicos[2].time
      r.origem_retorno_intervalo = unicos[2].origem
      r.saida = unicos[3].time
      r.origem_saida = unicos[3].origem

      diasCorrigidos++
      detalhes.push({
        dia: r.dia,
        motivo: `Horários reordenados cronologicamente: ${r.entrada} -> ${r.saida_intervalo} -> ${r.retorno_intervalo} -> ${r.saida}.`
      })
    }
    // Caso 3: 3 horários no dia
    else if (unicos.length === 3 && isInvertido) {
      unicos.sort(sortMarcacoes)
      r.entrada = unicos[0].time
      r.origem_entrada = unicos[0].origem
      r.saida_intervalo = unicos[1].time
      r.origem_saida_intervalo = unicos[1].origem
      r.retorno_intervalo = null
      r.origem_retorno_intervalo = null
      r.saida = unicos[2].time
      r.origem_saida = unicos[2].origem

      diasCorrigidos++
      detalhes.push({
        dia: r.dia,
        motivo: `Horários de 3 batidas reordenados: ${r.entrada} -> ${r.saida_intervalo} -> Saída ${r.saida}.`
      })
    }

    // Limpeza de Falta Automática se o dia possui marcações
    const temHorarios = !!r.entrada || !!r.saida || !!r.saida_intervalo || !!r.retorno_intervalo
    if (temHorarios && r.observacao && (r.observacao.includes('FALTA') || r.observacao.includes('AGUARDANDO JUSTIFICATIVA'))) {
      r.observacao = ''
      detalhes.push({
        dia: r.dia,
        motivo: `Removido aviso de Falta Automática (dia com horário preenchido).`
      })
    }

    // Recálculo limpo de Hora Extra do dia
    const oldExtraMin = r.hora_extra_minutos || 0
    if (r.entrada && r.saida) {
      const eM = timeToMin(r.entrada)!
      const sM = timeToMin(r.saida)!
      const startMinOfficial = startHour * 60 + startMin
      const endMinOfficial = endHour * 60 + endMin

      let scheduledExitMin = endMinOfficial
      if (isNoturno && endMinOfficial <= startMinOfficial) {
        scheduledExitMin += 24 * 60
      }

      let realExitMin = sM
      if (isNoturno && sM <= eM) {
        realExitMin += 24 * 60
      } else if (!isNoturno && sM < eM) {
        // Horário de saída menor que entrada em turno diurno é erro de data
        realExitMin = sM
      }

      if (realExitMin > scheduledExitMin) {
        const extraMin = realExitMin - scheduledExitMin
        // Trava para evitar números anômalos (> 12h de extra num único dia)
        r.hora_extra_minutos = Math.min(extraMin, 12 * 60)
        r.hora_extra_tipo = (isNoturno || eM >= 22 * 60 || sM < 5 * 60) ? '100%' : '50%'
      } else {
        r.hora_extra_minutos = 0
        r.hora_extra_tipo = null
      }
    } else {
      r.hora_extra_minutos = 0
      r.hora_extra_tipo = null
    }

    if (Math.abs(oldExtraMin - (r.hora_extra_minutos || 0)) > 60) {
      diasCorrigidos++
      detalhes.push({
        dia: r.dia,
        motivo: `Hora extra corrigida de ${(oldExtraMin / 60).toFixed(1)}h para ${((r.hora_extra_minutos || 0) / 60).toFixed(1)}h.`
      })
    }
  }

  return {
    registros: result,
    diasCorrigidos,
    detalhes
  }
}
