/**
 * Autorizações do RH para validação coletiva na FOLHA DE PONTO — fonte única (27/08/2026).
 *
 * Plano: docs/planos/2026-08-27-dispensa-de-registro-de-ponto.md
 *
 * Quando o RH autoriza (Ofício 249/2026, Programa Porta a Porta), o coordenador declara em massa
 * os passos liberados e a folha precisa DIZER isso: sem o número do ofício impresso, o dia
 * aparece como horário manual qualquer, e é justamente o documento que responde à fiscalização.
 *
 * ⚠️ A observação sai da AUTORIZAÇÃO, não da justificativa gravada em cada dia. A autorização é
 * o ato administrativo — vale para o dia mesmo que naquele dia ninguém tenha declarado nada, e
 * é ela que explica por que falta a batida de entrada.
 *
 * ⚠️ Isto NÃO preenche horário nenhum. A folha continua recebendo os horários de `escala_diaria`,
 * e a saída continua vindo do relógio.
 */

export interface AutorizacaoPontoFolha {
  passos: string[]
  documento: string
  vigencia_inicio: string
  vigencia_fim: string
}

const ROTULO_PASSO: Record<string, string> = {
  entrada: 'ENTRADA',
  intervalo_saida: 'SAÍDA PARA INTERVALO',
  intervalo_retorno: 'RETORNO DO INTERVALO',
}

/**
 * A autorização que cobre esta data, ou null.
 *
 * Compara data pura (`YYYY-MM-DD`) como string: `vigencia_inicio` e `vigencia_fim` são `date` no
 * banco e chegam nesse formato. Converter para `Date` reintroduziria o erro de fuso da armadilha
 * 12 do CLAUDE.md — `new Date('2026-08-10')` é meia-noite UTC e vira 09/08 em São Paulo.
 */
export function autorizacaoDoDia(
  autorizacoes: AutorizacaoPontoFolha[] | null | undefined,
  dataISO: string
): AutorizacaoPontoFolha | null {
  if (!autorizacoes || autorizacoes.length === 0) return null
  return autorizacoes.find(a => dataISO >= a.vigencia_inicio && dataISO <= a.vigencia_fim) || null
}

/** Ex.: `REGISTRO DE ENTRADA DISPENSADO CONF. OFÍCIO 249/2026` */
export function descreverAutorizacao(autorizacao: AutorizacaoPontoFolha): string {
  const passos = (autorizacao.passos || []).map(p => ROTULO_PASSO[p] || p.toUpperCase())
  const lista = passos.length > 1
    ? passos.slice(0, -1).join(', ') + ' E ' + passos[passos.length - 1]
    : (passos[0] || '')

  // Concorda em número: é texto que sai num documento assinado pelo servidor.
  const cabecalho = passos.length > 1 ? 'REGISTROS DE' : 'REGISTRO DE'
  const participio = passos.length > 1 ? 'DISPENSADOS' : 'DISPENSADO'

  return `${cabecalho} ${lista} ${participio} CONF. ${autorizacao.documento.toUpperCase()}`
}

/**
 * Acrescenta a observação ao registro do dia, preservando o que já estava lá.
 *
 * ⚠️ Acrescenta, nunca substitui: afastamento parcial, feriado e ponto facultativo continuam
 * sendo a informação principal daquele dia — a dispensa convive com eles.
 */
export function aplicarObservacaoAutorizacao(
  registro: { observacao?: string | null },
  autorizacao: AutorizacaoPontoFolha | null
): void {
  if (!autorizacao) return

  const texto = descreverAutorizacao(autorizacao)
  if (registro.observacao && registro.observacao.includes(texto)) return

  registro.observacao = registro.observacao
    ? `${registro.observacao} | ${texto}`
    : texto
}
