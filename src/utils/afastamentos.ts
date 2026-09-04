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
 * 2. Afastamento por SLOT (`slots = ['M']`, por exemplo) bloqueia apenas os turnos que ele
 *    COBRE POR INTEIRO. Afastamento integral (`slots` nulo/vazio) bloqueia qualquer turno.
 *    🚨 Era INTERSEÇÃO até 04/09/2026, e é a mudança desta rodada: `{M}` sobre um turno `MT`
 *    bloqueava o dia todo e a escala era apagada, então o período que o servidor realmente
 *    trabalhava (a tarde) sumia da folha. Ver `afastamentoParcial.ts` e a migration
 *    20260904120000.
 * 3. CATEGORIA: `Regular` e `Sobreaviso` são sempre bloqueados. `Plantão` e `Extra`
 *    dependem da configuração global `permitir_plantao_extra_durante_eventos` — que,
 *    pelo próprio nome, nunca foi sobre sobreaviso.
 */

import { afastamentoAnulaTurno, afastamentoBloqueiaEscala, resumoAfastamentoDia } from './afastamentoParcial'

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

/** Afastamento por horas não tira o servidor da escala do dia. Definida em `afastamentoParcial`. */
export { afastamentoBloqueiaEscala } from './afastamentoParcial'

/**
 * Slots do afastamento × slots do turno — **um evento isolado**.
 *
 * ⚠️ Isto responde "alcança?", NÃO "bloqueia?". Desde 04/09/2026 a regra de bloqueio é a
 * CONTENÇÃO, avaliada sobre a união dos afastamentos do dia (`alcanceNoTurno`): um afastamento
 * `{M}` alcança um turno `MT` sem anulá-lo — o servidor trabalha a tarde. Continua servindo para
 * pintar e explicar a célula; para decidir bloqueio, use `encontrarAfastamentosBloqueantes`.
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
 * Os afastamentos bloqueantes do dia que alcançam este turno — a lista para EXIBIR.
 *
 * ⚠️ Um dia pode ter mais de um evento — uma declaração de comparecimento pela manhã e
 *    outra à tarde, por exemplo. Para BLOQUEAR basta que o conjunto anule o turno; para
 *    EXIBIR é preciso a lista, senão a tela nomeia só o primeiro e o coordenador conclui
 *    que o segundo se perdeu.
 */
export function afastamentosDoDiaNoTurno(params: {
  eventos: AfastamentoEvento[]
  servidorId: string
  dataISO: string
}): AfastamentoEvento[] {
  const { eventos, servidorId, dataISO } = params
  return eventos.filter(ev =>
    ev.servidor_id === servidorId &&
    dataISO >= ev.data_inicio &&
    dataISO <= ev.data_fim &&
    afastamentoBloqueiaEscala(ev)
  )
}

/**
 * TODOS os afastamentos que impedem lançar este turno neste dia.
 *
 * 🚨 A regra é a CONTENÇÃO, não a interseção — mudou em 04/09/2026, junto com a migration
 *    20260904120000. Antes, um afastamento `{M}` bloqueava um turno `MT` inteiro, e a escala do
 *    dia era apagada: o período que o servidor de fato trabalhava sumia da folha. Agora só
 *    bloqueia o que ANULA o turno (integral, ou cobrindo todos os slots dele). Ver
 *    `alcanceNoTurno` em `afastamentoParcial.ts`, que este módulo apenas aplica.
 *
 * ⚠️ A avaliação é sobre a UNIÃO dos afastamentos do dia, nunca evento a evento: duas
 *    declarações parciais (`{M}` e `{T}`) juntas cobrem um turno `MT` e ali o bloqueio é correto.
 *
 * @param turnoSlots slots do turno que se pretende lançar. Célula vazia entra como `[]`,
 *                   e nesse caso só um afastamento integral bloqueia.
 */
export function encontrarAfastamentosBloqueantes(params: {
  eventos: AfastamentoEvento[]
  servidorId: string
  dataISO: string
  categoria: CategoriaEscala | string
  turnoSlots?: string[] | null
  permitirPlantaoExtra: boolean
}): AfastamentoEvento[] {
  const { eventos, servidorId, dataISO, categoria, turnoSlots, permitirPlantaoExtra } = params

  if (!categoriaBloqueadaPorAfastamento(categoria, permitirPlantaoExtra)) return []

  const doDia = afastamentosDoDiaNoTurno({ eventos, servidorId, dataISO })
  if (!afastamentoAnulaTurno(resumoAfastamentoDia(doDia), turnoSlots)) return []

  // Anulou: quem é exibido são os que efetivamente alcançam o turno. O integral alcança sempre.
  return doDia.filter(ev => afastamentoConflitaComSlots(ev, turnoSlots))
}

/** O primeiro dos bloqueantes. Bloqueio e binario; para EXIBIR use a versao no plural. */
export function encontrarAfastamentoBloqueante(params: {
  eventos: AfastamentoEvento[]
  servidorId: string
  dataISO: string
  categoria: CategoriaEscala | string
  turnoSlots?: string[] | null
  permitirPlantaoExtra: boolean
}): AfastamentoEvento | null {
  return encontrarAfastamentosBloqueantes(params)[0] || null
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

/**
 * Rótulo do evento para tooltip: nome, período (horas ou slots) e a observação digitada.
 */
export function rotuloAfastamento(evento: AfastamentoEvento): string {
  const nome = evento.tipos_eventos?.nome || 'Afastamento'
  let periodo = ''
  if (evento.hora_inicio) {
    periodo = ` [${evento.hora_inicio.substring(0, 5)} às ${(evento.hora_fim || '').substring(0, 5) || '--:--'}]`
  } else if (evento.slots && evento.slots.length > 0) {
    periodo = ` [Período: ${evento.slots.join(', ')}]`
  }
  const obs = evento.observacao ? ` - ${evento.observacao}` : ''
  return `${nome}${periodo}${obs}`
}
