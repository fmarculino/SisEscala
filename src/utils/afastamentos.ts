/**
 * Regra de bloqueio de escala por afastamento — fonte única do frontend.
 *
 * Espelha o que o banco já faz em `fn_prevent_shift_during_event` (trigger BEFORE
 * INSERT OR UPDATE em `escala_diaria`) e em `fn_check_shift_conflicts`. O banco é quem
 * de fato recusa a gravação; este módulo existe para que a tela não ofereça — nem
 * aplique localmente — o que o banco vai recusar depois, derrubando o lote inteiro
 * do "Salvar Previsão".
 *
 * A regra tem três eixos, e os três precisam bater com o SQL:
 *
 * 1. Afastamento por HORAS (`periodo_tipo = 'horas'` ou `hora_inicio` preenchida) NÃO
 *    bloqueia nada. É a declaração de comparecimento (migration 20260817210000): o
 *    servidor trabalha o resto do dia e continua escalado.
 * 2. Afastamento por SLOT (`slots = ['M']`, por exemplo) bloqueia apenas os turnos cujos
 *    slots cruzam os do afastamento. Afastamento integral (`slots` nulo/vazio) bloqueia
 *    qualquer turno.
 * 3. CATEGORIA: `Regular` e `Sobreaviso` são sempre bloqueados. `Plantão` e `Extra`
 *    dependem da configuração global `permitir_plantao_extra_durante_eventos` — que,
 *    pelo próprio nome, nunca foi sobre sobreaviso.
 */

export type CategoriaEscala = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'

export interface AfastamentoEvento {
  servidor_id: string
  data_inicio: string
  data_fim: string
  slots?: string[] | null
  periodo_tipo?: string | null
  hora_inicio?: string | null
  observacao?: string | null
  tipos_eventos?: { nome?: string | null; cor?: string | null } | null
  [key: string]: any
}

/**
 * Afastamento por horas não tira o servidor da escala do dia.
 */
export function afastamentoBloqueiaEscala(evento: AfastamentoEvento): boolean {
  const tipo = evento.periodo_tipo || 'integral'
  return tipo !== 'horas' && !evento.hora_inicio
}

/**
 * Slots do afastamento × slots do turno. Afastamento sem slots é integral: bloqueia tudo.
 * Turno sem slots conhecidos só é barrado por afastamento integral — igual ao SQL, onde
 * `se.slots && v_turno_slots` com array vazio dá falso.
 */
export function afastamentoConflitaComSlots(
  evento: AfastamentoEvento,
  turnoSlots: string[] | null | undefined
): boolean {
  const evSlots = evento.slots
  if (!evSlots || evSlots.length === 0) return true
  const slots = turnoSlots || []
  return slots.some(s => evSlots.includes(s))
}

/**
 * `Regular` e `Sobreaviso` nunca são liberados pela configuração de governança.
 */
export function categoriaBloqueadaPorAfastamento(
  categoria: CategoriaEscala | string,
  permitirPlantaoExtra: boolean
): boolean {
  if (categoria === 'Regular' || categoria === 'Sobreaviso') return true
  return !permitirPlantaoExtra
}

/**
 * Devolve o afastamento que impede lançar este turno neste dia, ou null.
 *
 * @param turnoSlots slots do turno que se pretende lançar. Célula vazia entra como `[]`,
 *                   e nesse caso só um afastamento integral bloqueia.
 */
export function encontrarAfastamentoBloqueante(params: {
  eventos: AfastamentoEvento[]
  servidorId: string
  dataISO: string
  categoria: CategoriaEscala | string
  turnoSlots?: string[] | null
  permitirPlantaoExtra: boolean
}): AfastamentoEvento | null {
  const { eventos, servidorId, dataISO, categoria, turnoSlots, permitirPlantaoExtra } = params

  if (!categoriaBloqueadaPorAfastamento(categoria, permitirPlantaoExtra)) return null

  return eventos.find(ev =>
    ev.servidor_id === servidorId &&
    dataISO >= ev.data_inicio &&
    dataISO <= ev.data_fim &&
    afastamentoBloqueiaEscala(ev) &&
    afastamentoConflitaComSlots(ev, turnoSlots)
  ) || null
}

/**
 * Data no formato que `servidores_eventos` usa. Montada por aritmética de inteiros, nunca
 * por `Date`: o processo Node roda em UTC e `getDate()` de um timestamp erra por 3 horas
 * (armadilha 12 do CLAUDE.md).
 */
export function dataISODoDia(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Rótulo curto do afastamento para pintar a célula bloqueada.
 */
export function siglaAfastamento(evento: AfastamentoEvento): string {
  return (evento.tipos_eventos?.nome || 'AFA').substring(0, 3).toUpperCase()
}
