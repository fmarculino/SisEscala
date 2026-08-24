/**
 * Status de um acionamento de sobreaviso — FONTE ÚNICA no frontend (24/08/2026).
 *
 * ⚠️ ESPELHO DE SQL. A autoridade é `public.fn_status_acionamento_sobreaviso`
 * (`20260824110000`, corrigida por `20260824140000`). Ao mexer numa ponta, mexa na outra —
 * mesma disciplina de `intervaloIntrajornada.ts` e `afastamentos.ts`.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   "Falhou" nunca foi um estado do sistema: era uma conta feita na renderização, **copiada em
 *   quatro lugares**, cada um com sua variação:
 *
 *     ScaleGrid.tsx:943             usava `else if` entre os dois prazos — um log `Aceito`
 *                                   nunca chegava a ser testado pelo prazo de aceite
 *     auditoria/page.tsx:664        usava dois `if` independentes
 *     sobreaviso/[token]/page.tsx   dois trechos, e estes PERSISTEM a falha via
 *                                   `mark_sobreaviso_timeout`
 *
 *   Com a decisão de 23/08/2026 (falha de acionamento vira **falta**), uma regra dessas não
 *   pode continuar em quatro cópias: a fila de justificativas e a grade discordariam sobre o
 *   que é falha, e o anexo imprimiria uma terceira coisa.
 *
 * POR QUE UM ESPELHO E NÃO UMA CHAMADA À RPC
 *   Os quatro consumidores são componentes de cliente que já carregaram as linhas de
 *   `logs_sobreaviso` — a grade avalia centenas de células por render. Uma ida ao banco por
 *   linha (ou por render) trocaria quatro cópias divergentes por um problema de latência, sem
 *   ganhar nada: a derivação é pura. O que estava errado não era o cálculo estar no cliente,
 *   era estar escrito quatro vezes.
 */

/** Os mesmos seis estados que a função SQL devolve. */
export type EstadoAcionamento =
  | 'atendido'
  | 'em_andamento'
  | 'falhou_aceite'
  | 'falhou_chegada'
  | 'recusado'
  | 'cancelado'

export interface LogAcionamento {
  status?: string | null
  created_at?: string | null
  data_hora_acionamento?: string | null
  data_hora_aceite?: string | null
  data_hora_chegada?: string | null
  motivo_falha?: string | null
  acionado_por?: string | null
  motivo_acionamento?: string | null
  categoria?: string | null
}

export interface StatusAcionamento {
  estado: EstadoAcionamento
  motivo: string | null
  /** `true` para `falhou_aceite` e `falhou_chegada` — é o que vira falta. */
  falhou: boolean
}

export const LIMITE_ACEITE_PADRAO = 30
export const LIMITE_CHEGADA_PADRAO = 90

/**
 * Timestamps do banco chegam ora como ISO, ora com espaço no lugar do `T` (o formato que o
 * PostgREST devolve em algumas colunas). As quatro cópias já faziam esse `replace`; ele fica.
 */
function instante(v: string | null | undefined): number | null {
  if (!v) return null
  const ms = new Date(String(v).replace(' ', 'T')).getTime()
  return Number.isNaN(ms) ? null : ms
}

function inteiroDaConfig(valor: string | undefined, padrao: number): number {
  const n = parseInt(String(valor ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : padrao
}

/**
 * @param configs `configuracoes_globais` já achatada em `{ chave: valor }`, como as telas usam.
 * @param agoraMs instante de referência. Explícito para a conta ser reproduzível em simulação.
 */
export function statusAcionamento(
  log: LogAcionamento | null | undefined,
  configs: Record<string, string> = {},
  agoraMs: number = Date.now()
): StatusAcionamento {
  const falha = (estado: EstadoAcionamento, motivo: string): StatusAcionamento =>
    ({ estado, motivo, falhou: true })
  const ok = (estado: EstadoAcionamento, motivo: string | null = null): StatusAcionamento =>
    ({ estado, motivo, falhou: false })

  if (!log) return ok('em_andamento')

  const limAceite = inteiroDaConfig(configs['sobreaviso_tempo_aceite_minutos'], LIMITE_ACEITE_PADRAO)
  const limChegada = inteiroDaConfig(configs['sobreaviso_tempo_chegada_minutos'], LIMITE_CHEGADA_PADRAO)

  if (log.status === 'Chegou') return ok('atendido')

  // FALHA JÁ GRAVADA por `mark_sobreaviso_timeout`. Vem antes dos ramos por prazo: o fato já
  // aconteceu e foi registrado — recalcular o relógio aqui poderia desfazê-lo.
  if (log.status === 'Falhou' || log.status === 'Timeout') {
    return log.data_hora_aceite
      ? falha('falhou_chegada', log.motivo_falha || 'Aceitou o chamado e não compareceu no prazo')
      : falha('falhou_aceite', log.motivo_falha || 'Não aceitou o chamado no prazo')
  }

  if (log.status === 'Recusado') return falha('recusado', 'O servidor recusou o acionamento')
  if (log.status === 'Cancelado') return ok('cancelado')

  if (log.status === 'Aceito') {
    const aceite = instante(log.data_hora_aceite)
    if (!log.data_hora_chegada && aceite !== null && aceite + limChegada * 60000 < agoraMs) {
      return falha('falhou_chegada', 'Tempo limite de deslocamento excedido')
    }
    return ok('em_andamento')
  }

  if (log.status === 'Aguardando') {
    const inicio = instante(log.created_at) ?? instante(log.data_hora_acionamento)
    if (inicio !== null && inicio + limAceite * 60000 < agoraMs) {
      return falha('falhou_aceite', 'Tempo limite para aceite excedido')
    }
    return ok('em_andamento')
  }

  // Status desconhecido NUNCA vira falha — falha é acusação, e chutar seria acusar por bug.
  return ok('em_andamento')
}

/**
 * Separa acionamento de verdade do artefato que `fn_confirmar_presenca` grava na mesma tabela.
 * Espelha `public.fn_acionamento_sobreaviso_real`.
 *
 * ⚠️ `logs_sobreaviso` NÃO é uma tabela de acionamentos: o terminal e a grade também escrevem
 * ali ao validar presença, e os artefatos entram com status `Chegou`. Em produção são 513 de
 * 526 linhas. Contar tudo já produziu um relatório afirmando o oposto da realidade.
 */
export function ehAcionamentoReal(log: LogAcionamento | null | undefined): boolean {
  if (!log) return false
  if (log.acionado_por) return true
  const m = log.motivo_acionamento || ''
  return !(/^O próprio usuário confirmou/i.test(m)
        || /^Validação Manual/i.test(m)
        || /^REVERSÃO/i.test(m))
}

/**
 * Instante-limite do ciclo em que o acionamento está — em ms, ou `null` se não há prazo
 * correndo (já chegou, já falhou, foi recusado ou cancelado).
 *
 * Existe para a contagem regressiva da página do servidor não recalcular o prazo por conta
 * própria: o contador e a decisão de falha têm que usar o MESMO limite, senão a tela mostra
 * "faltam 2 minutos" para um chamado que a regra já considera perdido.
 */
export function prazoFinalMs(
  log: LogAcionamento | null | undefined,
  configs: Record<string, string> = {}
): number | null {
  if (!log) return null
  const limAceite = inteiroDaConfig(configs['sobreaviso_tempo_aceite_minutos'], LIMITE_ACEITE_PADRAO)
  const limChegada = inteiroDaConfig(configs['sobreaviso_tempo_chegada_minutos'], LIMITE_CHEGADA_PADRAO)

  if (log.status === 'Aguardando') {
    const inicio = instante(log.created_at) ?? instante(log.data_hora_acionamento)
    return inicio === null ? null : inicio + limAceite * 60000
  }
  if (log.status === 'Aceito') {
    const aceite = instante(log.data_hora_aceite)
    return aceite === null ? null : aceite + limChegada * 60000
  }
  return null
}

/** Rótulo legado, para as telas que ainda exibem `status` como texto. */
export function rotuloLegado(s: StatusAcionamento, statusOriginal?: string | null): string | null {
  if (s.falhou && s.estado !== 'recusado') return 'Falhou'
  if (s.estado === 'atendido') return 'Chegou'
  if (s.estado === 'recusado') return 'Recusado'
  if (s.estado === 'cancelado') return 'Cancelado'
  return statusOriginal ?? null
}
