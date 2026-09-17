/**
 * Montagem do documento de apuração de um período que não é o mês civil.
 *
 * Plano: docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md (Fase 2)
 *
 * A folha mensal continua sendo a folha. Este módulo RECORTA as folhas que já existem e junta os
 * pedaços num documento do período — para o Mais Médicos, os dias 21..31 de um mês somados aos
 * 1..20 do seguinte.
 *
 * 🚨 A REGRA CENTRAL, E A RAZÃO DE ESTE MÓDULO EXISTIR: `totaisFolha` recebe UMA competência e UMA
 * carga por dia (ver OpcoesTotais em calculoDia.ts), e as regras de folha têm vigência POR
 * COMPETÊNCIA. Medido em 16/09/2026 nos 4 médicos do Mais Médicos:
 *
 *     dias 21..31/08 (folha Revisada)  -> 10,00 h/dia   (vão bruto da jornada, regra antiga)
 *     dias  1..20/09 (folha Rascunho)  ->  7,58 h/dia   (líquido; horas_normais_liquidas_desde
 *                                                        = 2026-09)
 *
 * Chamar `totaisFolha` uma vez sobre os 31 dias aplicaria a régua de setembro aos dias de agosto:
 * −40h somando as 4 apurações, num documento que o servidor assina e divergindo da folha de
 * agosto, que está Revisada. Então: UMA CHAMADA POR METADE, e os resultados somados.
 *
 * A apuração DERIVA da folha. Nunca recalcula, nunca "uniformiza a régua" — duas réguas dentro do
 * período é o que a realidade tem, porque a regra mudou no meio, e a folha de cada lado está certa.
 */

import {
  totaisFolha,
  horasNormaisLiquidasVigente,
  type RegistroDia,
  type TotaisFolha,
} from './calculoDia'
import { horasNormaisDaJornada } from './cargaDiaria'
import { isFaltaDefinitiva } from './faltaAutomatica'
import type { JanelaPeriodo, MetadePeriodo } from './periodoApuracao'
import { metadesDoPeriodo } from './periodoApuracao'

/** A folha de uma competência, como ela chega do banco. */
export interface FolhaDaCompetencia {
  id: string
  mes: number
  ano: number
  status: string
  registros: RegistroDia[]
  escala_mensal_id?: string | null
  /** Para o cabeçalho quando a lotação muda no meio do período. */
  unidade_nome?: string | null
  setor_nome?: string | null
  jornada?: { nome?: string | null; horas_totais?: number | null; intervalo_minutos?: number | null } | null
}

export interface OpcoesApuracao {
  /** `YYYY-MM` — de onde a folha passa a descontar o intervalo. */
  horasLiquidasDesde?: string | null
  compensacaoVigenteDesde?: string | null
  autorizacaoExtraVigenteDesde?: string | null
  /** Competências encerradas, para marcar a metade como congelada. */
  competenciasEncerradas?: Array<{ mes: number; ano: number }>
}

/** Um dia do documento, já com a data para poder ser ordenado e lido. */
export interface DiaApuracao {
  /** `YYYY-MM-DD` — é por ela que o documento ordena. */
  data: string
  /** O número do dia DENTRO da competência dele. É o que casa com folha_ponto.registros. */
  dia: number
  mes: number
  ano: number
  competencia: string
  registro: RegistroDia | null
  /** true quando a competência daquele dia tem folha, mas o dia não está nela. */
  semRegistro: boolean
}

/** Uma competência do período, com o que foi encontrado nela. */
export interface MetadeApurada extends MetadePeriodo {
  competencia: string
  /** Pode ser mais de uma: escala dividida por transferência (armadilha 47). */
  folhas: Array<{ id: string; status: string; unidade_nome?: string | null; setor_nome?: string | null }>
  /** Horas da jornada por dia usadas NESTA metade — 10h em 08/2026, 8h em 09/2026. */
  horasNormaisPorDia: number
  descontaIntervalo: boolean
  jornadaNome: string | null
  totais: TotaisFolha | null
  /** Nenhuma folha encontrada nesta competência. */
  semFolha: boolean
  /** Competência encerrada: o dado está congelado, e isso é desejável. */
  congelada: boolean
  diasNoPeriodo: number
  diasComRegistro: number
}

export type MotivoLacuna = 'sem_folha' | 'dia_sem_registro'

export interface LacunaApuracao {
  motivo: MotivoLacuna
  competencia: string
  /** Os dias (números, dentro da competência) que faltam. */
  dias: number[]
  descricao: string
}

export interface ApuracaoMontada {
  janela: JanelaPeriodo
  dias: DiaApuracao[]
  metades: MetadeApurada[]
  /** A soma das metades. Nunca o resultado de uma chamada única sobre o período todo. */
  totais: TotaisFolha
  lacunas: LacunaApuracao[]
  /** Dias com decisão pendente (Art. 7 e Art. 8), por competência. */
  pendencias: Array<{ competencia: string; tipo: 'compensacao' | 'autorizacao_extra'; dias: number[] }>
  /** As lotações que aparecem no período, em ordem. Mais de uma = mudou no meio. */
  lotacoes: Array<{ competencia: string; unidade_nome: string; setor_nome: string }>
  /** true se falta folha em alguma metade — o documento sai PARCIAL, nunca zerado. */
  parcial: boolean
  /** true se o período pega duas competências (é onde a soma por metade importa). */
  atravessaCompetencia: boolean
}

function totaisVazios(): TotaisFolha {
  return {
    normaisMinutos: 0,
    noturnoMinutos: 0,
    atrasoMinutos: 0,
    extra50Minutos: 0,
    extra100Minutos: 0,
    faltas: 0,
    abonoMinutos: 0,
    pendentesCompensacao: [],
    compensavelPendenteMinutos: 0,
    pendentesAutorizacaoExtra: [],
    extraNaoAutorizadaMinutos: 0,
    extraPendenteAutorizacaoMinutos: 0,
  }
}

/**
 * Soma dois conjuntos de totais.
 *
 * ⚠️ `pendentesCompensacao` e `pendentesAutorizacaoExtra` são listas de NÚMERO DE DIA, e dia 5
 * pode existir nas duas metades. Concatenar sem a competência ao lado produziria uma lista
 * ambígua — por isso as pendências do documento saem em `ApuracaoMontada.pendencias`, agrupadas
 * por competência, e estes campos ficam só com a contagem somada de cada metade.
 */
function somarTotais(a: TotaisFolha, b: TotaisFolha): TotaisFolha {
  return {
    normaisMinutos: a.normaisMinutos + b.normaisMinutos,
    noturnoMinutos: a.noturnoMinutos + b.noturnoMinutos,
    atrasoMinutos: a.atrasoMinutos + b.atrasoMinutos,
    extra50Minutos: a.extra50Minutos + b.extra50Minutos,
    extra100Minutos: a.extra100Minutos + b.extra100Minutos,
    faltas: a.faltas + b.faltas,
    abonoMinutos: a.abonoMinutos + b.abonoMinutos,
    pendentesCompensacao: [...a.pendentesCompensacao, ...b.pendentesCompensacao],
    compensavelPendenteMinutos: a.compensavelPendenteMinutos + b.compensavelPendenteMinutos,
    pendentesAutorizacaoExtra: [...a.pendentesAutorizacaoExtra, ...b.pendentesAutorizacaoExtra],
    extraNaoAutorizadaMinutos: a.extraNaoAutorizadaMinutos + b.extraNaoAutorizadaMinutos,
    extraPendenteAutorizacaoMinutos:
      a.extraPendenteAutorizacaoMinutos + b.extraPendenteAutorizacaoMinutos,
  }
}

function comp(mes: number, ano: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}`
}

function isoDe(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Monta o documento do período a partir das folhas mensais.
 *
 * Os cinco casos de borda tratados (§4.5 do plano), e nenhum deles vira silêncio:
 *
 *   1. falta uma das metades (servidor admitido no meio) -> documento PARCIAL, com os dias
 *      faltantes listados. Não é erro, e não é zero.
 *   2. duas folhas na mesma metade (escala dividida por transferência) -> soma as duas e mantém
 *      as DUAS lotações. Escolher uma apagaria metade do mês de alguém.
 *   3. lotação ou jornada diferente entre as metades -> as duas vão no cabeçalho, nunca a mais
 *      recente só.
 *   4. metade em competência encerrada -> entra normalmente (é leitura) e é marcada como
 *      congelada. É o estado desejável: aquele lado não se move mais.
 *   5. decisão pendente no período (Art. 7 compensação, Art. 8 autorização de extra) ->
 *      devolvida em `pendencias`, para a emissão exigir confirmação em vez de gravar número que
 *      ainda vai mudar.
 */
export function montarApuracao(
  janela: JanelaPeriodo,
  folhas: FolhaDaCompetencia[],
  opcoes: OpcoesApuracao = {}
): ApuracaoMontada {
  const recortes = metadesDoPeriodo(janela)
  const encerradas = opcoes.competenciasEncerradas || []

  const metades: MetadeApurada[] = []
  const dias: DiaApuracao[] = []
  const lacunas: LacunaApuracao[] = []
  const pendencias: ApuracaoMontada['pendencias'] = []
  const lotacoes: ApuracaoMontada['lotacoes'] = []

  let totais = totaisVazios()

  for (const recorte of recortes) {
    const competencia = comp(recorte.mes, recorte.ano)
    const daMetade = folhas.filter(f => f.mes === recorte.mes && f.ano === recorte.ano)

    // A régua desta metade: é aqui que as duas competências divergem, e é por isso que
    // `totaisFolha` é chamada uma vez por metade em vez de uma vez para o período.
    const descontaIntervalo = horasNormaisLiquidasVigente(
      recorte.mes, recorte.ano, opcoes.horasLiquidasDesde
    )
    const jornada = daMetade.find(f => f.jornada)?.jornada || null
    const horasNormaisPorDia = horasNormaisDaJornada(jornada, descontaIntervalo)
    const jornadaNome = jornada?.nome ?? null

    const congelada = encerradas.some(c => c.mes === recorte.mes && c.ano === recorte.ano)

    // Os registros da metade, recortados pelo intervalo de dias — e de TODAS as folhas daquela
    // competência, não só da primeira (caso de borda 2).
    const registrosDaMetade: RegistroDia[] = []
    for (const f of daMetade) {
      for (const r of f.registros || []) {
        const d = Number(r.dia)
        if (d >= recorte.diaInicio && d <= recorte.diaFim) registrosDaMetade.push(r)
      }
    }

    const totaisMetade = daMetade.length
      ? totaisFolha(registrosDaMetade, {
          horasNormaisPorDia,
          jornadaNome,
          mes: recorte.mes,
          ano: recorte.ano,
          isFaltaDefinitiva,
          compensacaoVigenteDesde: opcoes.compensacaoVigenteDesde,
          autorizacaoExtraVigenteDesde: opcoes.autorizacaoExtraVigenteDesde,
        })
      : null

    if (totaisMetade) totais = somarTotais(totais, totaisMetade)

    // Os dias do documento, em ordem de DATA. Ordenar por `dia` poria setembro antes de agosto.
    const porDia = new Map<number, RegistroDia>()
    for (const r of registrosDaMetade) porDia.set(Number(r.dia), r)

    const semRegistroNaMetade: number[] = []
    for (let d = recorte.diaInicio; d <= recorte.diaFim; d++) {
      const registro = porDia.get(d) || null
      if (!registro && daMetade.length) semRegistroNaMetade.push(d)
      dias.push({
        data: isoDe(recorte.ano, recorte.mes, d),
        dia: d,
        mes: recorte.mes,
        ano: recorte.ano,
        competencia,
        registro,
        semRegistro: !registro,
      })
    }

    // Caso 1: a competência não tem folha nenhuma.
    if (!daMetade.length) {
      lacunas.push({
        motivo: 'sem_folha',
        competencia,
        dias: Array.from(
          { length: recorte.diaFim - recorte.diaInicio + 1 },
          (_, i) => recorte.diaInicio + i
        ),
        descricao:
          `Não há folha de ${competencia}: os dias ${recorte.diaInicio} a ${recorte.diaFim} `
          + 'ficaram fora do documento.',
      })
    } else if (semRegistroNaMetade.length) {
      lacunas.push({
        motivo: 'dia_sem_registro',
        competencia,
        dias: semRegistroNaMetade,
        descricao:
          `A folha de ${competencia} existe, mas não tem linha para `
          + `${semRegistroNaMetade.length} dia(s) do período.`,
      })
    }

    // Caso 5: as pendências, com a competência ao lado — dia 5 existe nas duas metades.
    if (totaisMetade?.pendentesCompensacao.length) {
      pendencias.push({
        competencia, tipo: 'compensacao', dias: [...totaisMetade.pendentesCompensacao],
      })
    }
    if (totaisMetade?.pendentesAutorizacaoExtra.length) {
      pendencias.push({
        competencia, tipo: 'autorizacao_extra', dias: [...totaisMetade.pendentesAutorizacaoExtra],
      })
    }

    // Casos 2 e 3: toda lotação que aparece entra, nunca só a última.
    for (const f of daMetade) {
      const u = f.unidade_nome || 'Sem unidade'
      const s = f.setor_nome || 'Sem setor'
      if (!lotacoes.some(l => l.competencia === competencia && l.unidade_nome === u && l.setor_nome === s)) {
        lotacoes.push({ competencia, unidade_nome: u, setor_nome: s })
      }
    }

    metades.push({
      ...recorte,
      competencia,
      folhas: daMetade.map(f => ({
        id: f.id, status: f.status, unidade_nome: f.unidade_nome, setor_nome: f.setor_nome,
      })),
      horasNormaisPorDia,
      descontaIntervalo,
      jornadaNome,
      totais: totaisMetade,
      semFolha: !daMetade.length,
      congelada,
      diasNoPeriodo: recorte.diaFim - recorte.diaInicio + 1,
      diasComRegistro: porDia.size,
    })
  }

  dias.sort((a, b) => a.data.localeCompare(b.data))

  return {
    janela,
    dias,
    metades,
    totais,
    lacunas,
    pendencias,
    lotacoes,
    parcial: metades.some(m => m.semFolha),
    atravessaCompetencia: metades.length > 1,
  }
}

/**
 * O relato do que o documento tem — e do que NÃO tem.
 *
 * ⚠️ Relata o que MUDOU/ENTROU, e o motivo do que ficou de fora (armadilha 22). Um documento
 * parcial que não diz que é parcial é pior que nenhum documento: quem recebe soma como se fosse
 * o período inteiro.
 */
export function descreverApuracao(a: ApuracaoMontada): string[] {
  const linhas: string[] = []
  const comRegistro = a.dias.filter(d => d.registro).length

  linhas.push(
    `Período ${a.janela.inicio} a ${a.janela.fim}: ${a.dias.length} dias, `
    + `${comRegistro} com lançamento na folha.`
  )

  for (const m of a.metades) {
    if (m.semFolha) {
      linhas.push(`${m.competencia}: SEM FOLHA — ${m.diasNoPeriodo} dia(s) fora do documento.`)
      continue
    }
    const status = m.folhas.map(f => f.status).join(', ')
    linhas.push(
      `${m.competencia}: ${m.diasComRegistro} de ${m.diasNoPeriodo} dia(s), `
      + `${m.horasNormaisPorDia}h por dia trabalhado [${status}]`
      + `${m.congelada ? ' — competência encerrada, dado congelado' : ''}`
      + `${m.folhas.length > 1 ? ` — ${m.folhas.length} folhas nesta competência` : ''}`
    )
  }

  if (a.lotacoes.length > 1) {
    linhas.push(
      'A lotação muda no período: '
      + a.lotacoes.map(l => `${l.unidade_nome} / ${l.setor_nome} (${l.competencia})`).join(' · ')
    )
  }

  for (const p of a.pendencias) {
    const rotulo = p.tipo === 'compensacao'
      ? 'compensação de atraso (Art. 7º)'
      : 'autorização de hora extra (Art. 8º)'
    linhas.push(
      `Pendente de decisão em ${p.competencia}: ${rotulo} nos dias ${p.dias.join(', ')}.`
    )
  }

  return linhas
}

/**
 * O fingerprint do documento: o que foi emitido, reduzido a uma linha comparável.
 *
 * 🚨 É ele que permite detectar, meses depois, que a folha mudou em relação ao que foi entregue —
 * sem congelar a folha (ver §4.3 do plano: congelar impede a correção de batida mal alocada).
 *
 * ⚠️ Entra o que muda o DOCUMENTO: a janela, cada horário de cada dia e os totais em minutos.
 * Não entra `id` de folha nem timestamp: sincronizar a folha sem alterar horário nenhum não pode
 * aparecer como divergência, senão o aviso vira ruído e ninguém mais olha.
 */
export function fingerprintApuracao(a: ApuracaoMontada): string {
  const linhas = a.dias.map(d => {
    const r = d.registro
    if (!r) return `${d.data}|-`
    return [
      d.data,
      r.entrada || '', r.saida_intervalo || '', r.retorno_intervalo || '', r.saida || '',
      r.turno_codigo || '',
      Number(r.hora_extra_minutos) || 0,
      Number(r.abono_minutos) || 0,
      (r.observacao || '').trim(),
    ].join('|')
  })

  const t = a.totais
  linhas.push([
    'T', t.normaisMinutos, t.noturnoMinutos, t.atrasoMinutos,
    t.extra50Minutos, t.extra100Minutos, t.faltas, t.abonoMinutos,
    t.extraNaoAutorizadaMinutos, t.extraPendenteAutorizacaoMinutos,
  ].join('|'))

  const texto = `${a.janela.inicio}..${a.janela.fim}\n${linhas.join('\n')}`

  // djb2 — o mesmo espírito de `generateFingerprint` da folha: barato, estável e suficiente para
  // dizer "mudou". Não é hash criptográfico e não precisa ser: ninguém está se defendendo de
  // colisão adversarial aqui, e a autoria do documento vem da RPC.
  let hash = 5381
  for (let i = 0; i < texto.length; i++) {
    hash = ((hash << 5) + hash + texto.charCodeAt(i)) | 0
  }
  return `${(hash >>> 0).toString(16)}-${a.dias.length}-${t.normaisMinutos}`
}

/** Quantos dias do período têm linha na folha — é o número que a RPC confere contra o banco. */
export function diasComLinha(a: ApuracaoMontada): number {
  return a.dias.filter(d => d.registro).length
}

/**
 * O documento emitido ainda corresponde à folha de hoje?
 *
 * ⚠️ Divergência NÃO é erro: a folha muda por motivo legítimo (batida que chegou depois,
 * reconciliação, decisão de compensação). O que ela exige é uma **retificação** — versão nova,
 * com motivo —, nunca uma edição do documento que já foi entregue.
 */
export function compararComEmitido(
  atual: ApuracaoMontada,
  emitido: { fingerprint: string; totais: any }
): { divergente: boolean; diferencas: string[] } {
  const fpAtual = fingerprintApuracao(atual)
  if (fpAtual === emitido.fingerprint) return { divergente: false, diferencas: [] }

  const diferencas: string[] = []
  const campos: Array<[keyof TotaisFolha, string]> = [
    ['normaisMinutos', 'horas normais'],
    ['extra50Minutos', 'hora extra 50%'],
    ['extra100Minutos', 'hora extra 100%'],
    ['atrasoMinutos', 'atraso'],
    ['abonoMinutos', 'abono'],
    ['faltas', 'faltas'],
  ]
  for (const [campo, rotulo] of campos) {
    const antes = Number(emitido.totais?.[campo] ?? 0)
    const agora = Number(atual.totais[campo] ?? 0)
    if (antes !== agora) {
      diferencas.push(`${rotulo}: emitido ${antes}, folha hoje ${agora}`)
    }
  }
  if (!diferencas.length) {
    // Fingerprint diferente com totais iguais: mudou horário de algum dia sem mudar o total.
    diferencas.push('algum horário do período mudou, sem alterar os totais')
  }
  return { divergente: true, diferencas }
}

/**
 * A emissão pode seguir?
 *
 * Pendência NÃO bloqueia por si: ela exige confirmação explícita, do mesmo jeito que
 * `salvarFolhaPonto` cobra no fechamento. O que o documento não pode é sair com número que ainda
 * vai mudar sem ninguém ter visto isso.
 */
export function requerConfirmacao(a: ApuracaoMontada): { precisa: boolean; motivos: string[] } {
  const motivos: string[] = []
  if (a.parcial) {
    motivos.push(
      'Falta folha em '
      + a.metades.filter(m => m.semFolha).map(m => m.competencia).join(' e ')
      + ' — o documento sai parcial.'
    )
  }
  if (a.pendencias.length) {
    motivos.push(
      `${a.pendencias.reduce((s, p) => s + p.dias.length, 0)} dia(s) com decisão pendente de `
      + 'compensação ou de autorização de hora extra.'
    )
  }
  const semRegistro = a.dias.filter(d => d.semRegistro && !a.metades.find(m => m.competencia === d.competencia)?.semFolha)
  if (semRegistro.length) {
    motivos.push(`${semRegistro.length} dia(s) do período sem linha na folha.`)
  }
  return { precisa: motivos.length > 0, motivos }
}
