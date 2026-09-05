/**
 * Revezamento de Vigias/Agentes de Portaria — SisEscala
 *
 * Módulo puro (sem I/O) que gera a escala de um grupo de 2+ servidores que revezam a portaria
 * um por dia civil. A "forma" do turno de cada dia é decidida só pelo calendário — quem está na
 * vez é só consequência da alternância simples, contínua, dia após dia, independente do tipo de
 * dia (não existe rodízio separado para fim de semana):
 *
 *   dia normal (com equipe do dia)                    → 12h (N) + 1h extra (1N), sempre
 *   dia sem equipe seguido de outro dia sem equipe     → 24h (N + MT), sem extra
 *   dia sem equipe seguido de dia normal (virada)      → 24h (N + MT) + 1h extra (1N)
 *
 * "Sem equipe" = sábado, domingo, feriado, ou ponto facultativo de dia inteiro. Ponto facultativo
 * PARCIAL (saída antecipada/entrada tardia) não conta — a equipe do dia ainda esteve lá parte do
 * expediente. O mapeamento por setor de `ponto_facultativo_setores` não é usado aqui: ele responde
 * se AQUELE setor libera o próprio pessoal, não se a administração/equipe diurna da unidade como
 * um todo está de folga — pergunta diferente da que importa pro vigia.
 *
 * Por isso quem aplica isto na tela DEVE mostrar uma prévia dia-a-dia antes de gravar: a regra
 * acima é uma aproximação institucional, não uma fonte de verdade por unidade.
 */

export type ClassificacaoDiaVigia = 'normal' | 'sem_equipe'

export interface ContextoCalendarioVigia {
  /** Datas 'YYYY-MM-DD' de feriados (institucional, sempre conta). */
  feriados: Set<string>
  /** Datas 'YYYY-MM-DD' de pontos facultativos de DIA INTEIRO (parcial não entra aqui). */
  facultativosDiaTodo: Set<string>
}

export interface TurnosVigia {
  /** turnoId (uuid) do código N — NOITE 12h. */
  regular: string
  /** turnoId (uuid) do código MT — MANHÃ+TARDE 12h. */
  plantao: string
  /** turnoId (uuid) do código 1N — 1 Hora Extra Noturna. */
  extra: string
}

export type CategoriaVigia = 'Regular' | 'Plantão' | 'Extra'

/**
 * O `tipo` que o `dicionario_turnos` precisa declarar para o código poder ser lançado em cada
 * linha da grade. É a mesma régua que o input da célula aplica (`targetTipo` em ScaleGrid):
 * escrever fora dela produziria um lançamento que a própria tela recusaria na digitação.
 */
export const TIPO_EXIGIDO_POR_CATEGORIA: Record<CategoriaVigia, string> = {
  'Regular': 'Normal',
  'Plantão': 'Plantão',
  'Extra': 'Extra'
}

/**
 * Os slots que o agente ocupa no dia, conforme o tipo de dia. Dia normal é só a noite; dia sem
 * equipe é o dia inteiro mais a noite.
 *
 * ⚠️ Serve para as checagens de afastamento e de sobreposição olharem o período CERTO. Usar a
 * união M+T+N em todo dia faria um afastamento parcial da manhã (declaração de comparecimento,
 * armadilha 21/49) bloquear um dia em que o agente só trabalharia à noite — o dia ficaria vazio
 * sem motivo, e o coordenador teria que descobrir isso sozinho.
 */
export function slotsDoDiaVigia(classificacao: ClassificacaoDiaVigia): string[] {
  return classificacao === 'normal' ? ['N'] : ['M', 'T', 'N']
}

export interface TurnoLancado {
  categoria: CategoriaVigia
  turnoId: string
}

export interface DiaVigiaGerado {
  dia: number
  servidorId: string
  classificacao: ClassificacaoDiaVigia
  /** Só é significativo quando classificacao === 'sem_equipe': é a última noite do bloco. */
  viradaParaNormal: boolean
  turnos: TurnoLancado[]
  pulado: boolean
  motivoPulado?: string
}

export function construirContextoCalendarioVigia(
  feriados: { data: string }[],
  pontosFacultativos: { data: string; inicio_liberacao_em?: string | null; fim_liberacao_em?: string | null }[]
): ContextoCalendarioVigia {
  return {
    feriados: new Set(feriados.map(f => f.data)),
    facultativosDiaTodo: new Set(
      pontosFacultativos
        .filter(pf => !pf.inicio_liberacao_em && !pf.fim_liberacao_em)
        .map(pf => pf.data)
    )
  }
}

/**
 * `dia` pode estourar o mês (0 = último dia do mês anterior; daysInMonth+1 = dia 1 do mês
 * seguinte) — `Date` normaliza sozinho, o que é exatamente o que se quer para olhar 1 dia além
 * das duas pontas do intervalo sem precisar carregar o mês vizinho inteiro.
 */
export function classificarDiaVigia(
  ano: number,
  mes: number,
  dia: number,
  ctx: ContextoCalendarioVigia
): ClassificacaoDiaVigia {
  const d = new Date(ano, mes - 1, dia)
  const diaSemana = d.getDay() // 0=Dom, 6=Sáb
  if (diaSemana === 0 || diaSemana === 6) return 'sem_equipe'

  const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (ctx.feriados.has(chave) || ctx.facultativosDiaTodo.has(chave)) return 'sem_equipe'

  return 'normal'
}

export function turnosDoDiaVigia(
  classificacaoHoje: ClassificacaoDiaVigia,
  classificacaoAmanha: ClassificacaoDiaVigia,
  turnos: TurnosVigia
): TurnoLancado[] {
  if (classificacaoHoje === 'normal') {
    return [
      { categoria: 'Regular', turnoId: turnos.regular },
      { categoria: 'Extra', turnoId: turnos.extra }
    ]
  }

  const lancamentos: TurnoLancado[] = [
    { categoria: 'Regular', turnoId: turnos.regular },
    { categoria: 'Plantão', turnoId: turnos.plantao }
  ]
  if (classificacaoAmanha === 'normal') {
    lancamentos.push({ categoria: 'Extra', turnoId: turnos.extra })
  }
  return lancamentos
}

/**
 * Gera dia a dia, de `startDay` até `daysInMonth`, revezando `servidorIds` um por dia civil a
 * partir de quem está de plantão em `servidorInicialId`.
 *
 * Dia recusado por `podeEscalarDia` (presença confirmada / afastamento / conflito de setor) NÃO
 * escreve turno nenhum — mas o revezamento AVANÇA normalmente para o próximo servidor no dia
 * seguinte. Não redistribui a vaga do dia perdido para não criar uma segunda regra de rodízio.
 */
export function gerarRevezamentoVigias(params: {
  servidorIds: string[]
  servidorInicialId: string
  startDay: number
  daysInMonth: number
  ano: number
  mes: number
  calendario: ContextoCalendarioVigia
  turnos: TurnosVigia
  /**
   * Recebe a classificação do dia para poder checar afastamento/sobreposição contra os slots
   * REAIS daquele dia (ver `slotsDoDiaVigia`), e não contra a união de todos eles.
   */
  podeEscalarDia: (
    servidorId: string,
    dia: number,
    classificacao: ClassificacaoDiaVigia
  ) => { permitido: true } | { permitido: false; motivo: string }
}): DiaVigiaGerado[] {
  const { servidorIds, servidorInicialId, startDay, daysInMonth, ano, mes, calendario, turnos, podeEscalarDia } = params

  const idxInicial = servidorIds.indexOf(servidorInicialId)
  if (servidorIds.length === 0 || idxInicial === -1) return []

  const resultado: DiaVigiaGerado[] = []

  for (let dia = startDay; dia <= daysInMonth; dia++) {
    const idx = (idxInicial + (dia - startDay)) % servidorIds.length
    const servidorId = servidorIds[idx]

    const classificacao = classificarDiaVigia(ano, mes, dia, calendario)
    const classificacaoAmanha = classificarDiaVigia(ano, mes, dia + 1, calendario)
    const viradaParaNormal = classificacao === 'sem_equipe' && classificacaoAmanha === 'normal'

    const checagem = podeEscalarDia(servidorId, dia, classificacao)
    if (checagem.permitido === false) {
      resultado.push({
        dia, servidorId, classificacao, viradaParaNormal,
        turnos: [], pulado: true, motivoPulado: checagem.motivo
      })
      continue
    }

    resultado.push({
      dia, servidorId, classificacao, viradaParaNormal,
      turnos: turnosDoDiaVigia(classificacao, classificacaoAmanha, turnos),
      pulado: false
    })
  }

  return resultado
}

export interface TurnoDisponivel {
  id: string
  codigo: string
  tipo?: string | null
  ativo?: boolean
}

/** O turno serve para esta linha da grade? Mesma régua do input da célula. */
export function turnoServeParaCategoria(turno: TurnoDisponivel | undefined, categoria: CategoriaVigia): boolean {
  if (!turno || turno.ativo === false || !turno.tipo) return false
  return turno.tipo.split(',').map(s => s.trim()).includes(TIPO_EXIGIDO_POR_CATEGORIA[categoria])
}

/**
 * Palpite inicial dos 3 turnos, só para pré-preencher a tela: `N` (noite), `MT` (dia inteiro) e
 * a hora extra de passagem de turno.
 *
 * ⚠️ **É palpite, não regra.** Qual código de hora extra a unidade usa (`1` diurna ou `1N`
 * noturna) muda o percentual pago, e isso é decisão de quem escala — não de quem escreve o
 * código. Por isso os três ficam editáveis na tela; aqui só se escolhe o que aparece marcado.
 */
export function sugerirTurnosVigia(turnosDisponiveis: TurnoDisponivel[]): Partial<TurnosVigia> {
  const acha = (codigos: string[], categoria: CategoriaVigia) => {
    for (const codigo of codigos) {
      const t = turnosDisponiveis.find(x => x.codigo === codigo)
      if (turnoServeParaCategoria(t, categoria)) return t!.id
    }
    return undefined
  }
  return {
    regular: acha(['N'], 'Regular'),
    plantao: acha(['MT'], 'Plantão'),
    extra: acha(['1N', '1'], 'Extra')
  }
}

/**
 * Confere a escolha antes de gerar: o turno existe, está ativo e declara o `tipo` da linha em
 * que vai ser lançado. Sem isto, uma edição no Dicionário de Turnos produziria um lançamento
 * que a própria grade recusaria na digitação — e o erro só apareceria ao salvar, ou nem isso.
 */
export function validarTurnosVigia(
  turnosDisponiveis: TurnoDisponivel[],
  escolha: Partial<TurnosVigia>
): { ok: true; turnos: TurnosVigia } | { ok: false; erros: string[] } {
  const erros: string[] = []
  const conferir = (id: string | undefined, categoria: CategoriaVigia, rotulo: string) => {
    if (!id) {
      erros.push(`Escolha o turno de ${rotulo}.`)
      return
    }
    const t = turnosDisponiveis.find(x => x.id === id)
    if (!t) {
      erros.push(`O turno de ${rotulo} não existe mais no dicionário.`)
      return
    }
    if (!turnoServeParaCategoria(t, categoria)) {
      erros.push(`O turno ${t.codigo} não pode ser lançado na linha ${categoria} (precisa do tipo "${TIPO_EXIGIDO_POR_CATEGORIA[categoria]}" e estar ativo).`)
    }
  }

  conferir(escolha.regular, 'Regular', 'noite (linha Regular)')
  conferir(escolha.plantao, 'Plantão', 'dia inteiro (linha Plantão)')
  conferir(escolha.extra, 'Extra', 'hora extra de passagem de turno (linha Extra)')

  if (erros.length > 0) return { ok: false, erros }
  return {
    ok: true,
    turnos: { regular: escolha.regular!, plantao: escolha.plantao!, extra: escolha.extra! }
  }
}

/**
 * A hora em que a hora extra de passagem de turno começa: o FIM da jornada do agente, lido do
 * nome dela ("18H ÀS 06H" → "06:00"). É o mesmo valor que `sugerirHoraInicio` propõe hoje na
 * grade quando o coordenador lança essa célula à mão.
 *
 * ⚠️ Precisa ser gravada. O código de 1 hora extra não é ancorado (`horario_inicio` nulo no
 * dicionário), então sem esta hora a célula fica "?h" na tela e `hora_inicio_prevista` vai NULA
 * ao banco — o previsto daquela hora passa a ser resolvido pela cascata legada (armadilha 4) em
 * vez de pelo que o coordenador informa hoje. `null` quando o nome da jornada não diz a hora:
 * inventar seria pior, e a grade mostra "?h" para ele resolver.
 */
export function horaExtraPassagemTurno(nomeJornada: string | null | undefined): string | null {
  if (!nomeJornada) return null
  const m = nomeJornada.match(/(?:ÀS|AS|ÁS|A)\s*([0-9]{1,2})/i)
  if (!m) return null
  const hora = parseInt(m[1], 10)
  if (!Number.isFinite(hora) || hora < 0 || hora > 23) return null
  return `${String(hora).padStart(2, '0')}:00`
}

/** Mescla o resultado de `gerarRevezamentoVigias` numa estrutura pronta pra injetar no gridData. */
export function mesclarRevezamentoNoGrid(
  dias: DiaVigiaGerado[]
): Record<string, Partial<Record<CategoriaVigia, Record<number, string>>>> {
  const out: Record<string, Partial<Record<CategoriaVigia, Record<number, string>>>> = {}
  for (const d of dias) {
    if (d.pulado) continue
    const doServidor = (out[d.servidorId] = out[d.servidorId] || {})
    for (const t of d.turnos) {
      const daCategoria = (doServidor[t.categoria] = doServidor[t.categoria] || {})
      daCategoria[d.dia] = t.turnoId
    }
  }
  return out
}

export function contarDiasVigia(dias: DiaVigiaGerado[]) {
  const porServidor = new Map<string, number>()
  let pulados = 0
  for (const d of dias) {
    if (d.pulado) { pulados++; continue }
    porServidor.set(d.servidorId, (porServidor.get(d.servidorId) || 0) + 1)
  }
  return { porServidor, pulados, totalDias: dias.length }
}
