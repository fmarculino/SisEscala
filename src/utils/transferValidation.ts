/**
 * Utilitário de Validação de Datas de Transferência de Servidor
 * Regras:
 * 1. Não pode ser retroativa (< hoje).
 * 2. Não pode ser na mesma data vigente (== hoje).
 * 3. Deve respeitar o prazo mínimo em dias úteis configurado em configuracoes_globais (dias_uteis_transferencia_servidor).
 */

export function calcularDataMinimaTransferencia(
  diasUteisMinimos: number = 1,
  feriadosList: string[] = [],
  dataBase: Date = new Date()
): { dataMinimaStr: string; dataMinimaFormatada: string } {
  const nDiasUteis = Math.max(1, Math.floor(diasUteisMinimos || 1))
  
  const curr = new Date(dataBase.getFullYear(), dataBase.getMonth(), dataBase.getDate())
  let uteisContados = 0

  // Incrementa a partir de amanhã
  while (uteisContados < nDiasUteis) {
    curr.setDate(curr.getDate() + 1)
    const dayOfWeek = curr.getDay() // 0 = Domingo, 6 = Sábado
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const dateStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`
    const isHoliday = feriadosList.includes(dateStr)

    if (!isWeekend && !isHoliday) {
      uteisContados++
    }
  }

  const year = curr.getFullYear()
  const month = String(curr.getMonth() + 1).padStart(2, '0')
  const day = String(curr.getDate()).padStart(2, '0')
  
  const dataMinimaStr = `${year}-${month}-${day}`
  const dataMinimaFormatada = `${day}/${month}/${year}`

  return { dataMinimaStr, dataMinimaFormatada }
}

export function validarDataTransferencia(
  dataTransferenciaStr: string,
  diasUteisMinimos: number = 1,
  feriadosList: string[] = [],
  dataBase: Date = new Date()
): { valido: boolean; erro?: string; dataMinimaStr: string; dataMinimaFormatada: string } {
  const { dataMinimaStr, dataMinimaFormatada } = calcularDataMinimaTransferencia(diasUteisMinimos, feriadosList, dataBase)

  if (!dataTransferenciaStr) {
    return { valido: false, erro: 'A data de transferência é obrigatória.', dataMinimaStr, dataMinimaFormatada }
  }

  const hojeYear = dataBase.getFullYear()
  const hojeMonth = String(dataBase.getMonth() + 1).padStart(2, '0')
  const hojeDay = String(dataBase.getDate()).padStart(2, '0')
  const hojeStr = `${hojeYear}-${hojeMonth}-${hojeDay}`

  if (dataTransferenciaStr <= hojeStr) {
    return {
      valido: false,
      erro: 'A solicitação de transferência não pode ser retroativa e nem para a data vigente (hoje). Escolha uma data futura.',
      dataMinimaStr,
      dataMinimaFormatada
    }
  }

  if (dataTransferenciaStr < dataMinimaStr) {
    return {
      valido: false,
      erro: `A transferência exige no mínimo ${diasUteisMinimos} dia(s) útil(eis) de antecedência conforme as configurações do sistema. A data mínima permitida é ${dataMinimaFormatada}.`,
      dataMinimaStr,
      dataMinimaFormatada
    }
  }

  return { valido: true, dataMinimaStr, dataMinimaFormatada }
}
