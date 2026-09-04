/**
 * Fonte unica do que se mede em UM DIA da folha de ponto, e dos totais do mes.
 *
 * O QUE ESTE ARQUIVO RESOLVE
 *   A folha media o INSTANTE da saida contra o instante previsto, e nunca olhava a entrada.
 *   Resultado medido em producao em 04/09/2026 (competencia 08/2026, 547 folhas, 6.412 dias com
 *   entrada e saida registradas):
 *
 *     1.363 dias com atraso na entrada (646h27) — invisiveis na folha
 *       622 dias, 141 pessoas, chegaram atrasadas E sairam depois do previsto
 *       489h09 lancadas como hora extra nesses dias, das quais 253h21 apenas REPOEM o atraso
 *
 *   Ou seja: 51% da hora extra da competencia nasce em dia que comecou com atraso, e metade dela
 *   e, pela Portaria 382/2019-GAB-MAB/SMS, caso de COMPENSACAO — nao de pagamento.
 *
 * ⚠️ O MODELO DE INSTANTE NAO ESTA ERRADO, E NAO DEVE SER TROCADO PELO DE DURACAO.
 *   Seria tentador comparar "quanto trabalhou" contra "quanto devia" (e o que o cartao antigo do
 *   Control iD faz). Mas isso COMPENSA SOZINHO, e o Art. 7 §1/§2 da Portaria exige autorizacao da
 *   chefia para o atraso virar compensacao. Este modulo mede as duas pontas e deixa a decisao
 *   explicita; ele nunca decide compensar.
 *
 * ⚠️ NADA AQUI ALTERA VALOR DE FOLHA SOZINHO. `compensavelMinutos` e uma PROPOSTA — o dia nasce
 *   `pendente` e so muda de estado por ato de coordenador/RH (ver compensacao_status no registro).
 *
 * BASE LEGAL (Portaria 382/2019-GAB-MAB/SMS)
 *   Art. 7 §1  atraso <= 20 min: compensavel no mesmo dia, com autorizacao da chefia
 *   Art. 7 §2  atraso  > 20 min: so entra em compensacao mediante autorizacao
 *   Art. 7 §3  compensacao limitada a 2h diarias           -> TETO_COMPENSACAO_DIARIA_MIN
 *   Art. 7 §5  sem todos os registros do dia, nao compensa -> diaCompletoParaCompensacao
 *
 * 🚨 A COMPENSACAO E DENTRO DO PROPRIO MES — NUNCA NOS MESES SEGUINTES (usuario, 04/09/2026).
 *   O Art. 7 caput ADMITE compensar ate o fim do mes subsequente, mas isso e teto, nao obrigacao,
 *   e a Secretaria optou por nao usa-lo. Este modulo e compativel por construcao: toda compensacao
 *   e do MESMO DIA (atraso da entrada reposto pela saida do mesmo dia), logo dentro do mes. O
 *   atraso nao compensado ate o fechamento morre ali, virando desconto ou justificativa.
 *
 *   ⚠️ NAO acrescente saldo que atravesse competencia — nem "sobra do mes passado", nem
 *   `compensavel` que olhe outro mes. Seria banco de horas por outro nome, que segue sem decisao
 *   juridica desde 14/08/2026 (docs/planos/2026-08-14-estudo-faltas-automaticas-e-banco-de-horas.md).
 *
 * ⚠️ Modulo PURO (sem React, sem Supabase) para ter portao: `node scratchpad/sim_calculo_dia.js`.
 */

import { sequenciarDia, timeToMin, type HorariosDia } from './sequenciaDia'

/**
 * Competencia a partir da qual a regra de atraso/compensacao vale (decisao do usuario,
 * 04/09/2026: "faca tudo valer a partir do mes 09/2026").
 *
 * 🚨 POR QUE UM CORTE, E POR QUE ELE TAMBEM ESCONDE OS INDICADORES NOVOS EM MES ANTERIOR:
 *   A folha e documento ASSINADO. Reimprimir uma competencia ja fechada mostrando campos que nao
 *   existiam quando o servidor assinou muda o documento depois da assinatura. Entao, antes do
 *   corte, o rodape continua sendo o de sempre (Normais, Extra, Faltas) — so que ja em HH:MM, que
 *   e o mesmo numero escrito de forma legivel, nao conteudo novo.
 *
 *   E medido em 08/2026: sem o corte, reabrir aquelas folhas jogaria **756 dias em 170 folhas**
 *   na fila de decisao — trabalho que o usuario decidiu explicitamente nao fazer (as 473h de hora
 *   extra sem autorizacao previa do Art. 8 daquele mes "ficam como estao").
 *
 * ⚠️ O default vive AQUI, no codigo, e nao depende da migration ter sido aplicada:
 *   `configuracoes_globais.compensacao_atraso_vigente_desde` apenas SOBRESCREVE. Falha ao ler cai
 *   neste valor — que e o comportamento decidido, nunca "liga para todo mundo".
 */
export const COMPETENCIA_COMPENSACAO_PADRAO = '2026-09'

/**
 * Competencia a partir da qual as HORAS NORMAIS deixam de contar o intervalo (decisao do usuario,
 * 04/09/2026, junto com a regra de atraso).
 *
 * ⚠️ Chave propria, e nao a mesma da compensacao, porque sao duas regras diferentes: uma mede
 * atraso, a outra conta carga. Foram decididas juntas e por isso tem o mesmo padrao — mas o RH
 * pode precisar mover uma sem a outra.
 */
export const COMPETENCIA_HORAS_LIQUIDAS_PADRAO = '2026-09'

/** `YYYY-MM` valido? Config malformada nunca abre a regra para tras. */
function competenciaAlcancada(mes: number, ano: number, alvoBruto: string, padrao: string): boolean {
  const bruto = typeof alvoBruto === 'string' ? alvoBruto.trim() : ''
  const alvo = /^\d{4}-\d{2}$/.test(bruto) ? bruto : padrao
  const [anoIni, mesIni] = alvo.split('-').map(Number)
  if (!Number.isFinite(ano) || !Number.isFinite(mes)) return false
  return ano > anoIni || (ano === anoIni && mes >= mesIni)
}

/**
 * A competencia da folha esta dentro da vigencia da regra de atraso/compensacao?
 *
 * @param vigenteDesde formato `YYYY-MM`. Valor invalido cai no padrao — nunca abre a regra para
 *   tras por causa de configuracao malformada.
 */
export function regraCompensacaoVigente(
  mes: number,
  ano: number,
  vigenteDesde?: string | null
): boolean {
  return competenciaAlcancada(mes, ano, vigenteDesde || '', COMPETENCIA_COMPENSACAO_PADRAO)
}

/**
 * A competencia da folha ja conta as horas normais SEM o intervalo?
 *
 * 🚨 Antes do corte a folha continua somando o vao da jornada — que e o numero com que o servidor
 * ASSINOU aquele mes. Reimprimir uma competencia fechada com 168h onde estava 210h muda o
 * documento depois da assinatura, e o usuario decidiu explicitamente que 08/2026 fica como esta.
 */
export function horasNormaisLiquidasVigente(
  mes: number,
  ano: number,
  vigenteDesde?: string | null
): boolean {
  return competenciaAlcancada(mes, ano, vigenteDesde || '', COMPETENCIA_HORAS_LIQUIDAS_PADRAO)
}

/** Art. 7 §3: a compensacao nao pode passar de 2h por dia. */
export const TETO_COMPENSACAO_DIARIA_MIN = 120

/**
 * Art. 7 §1 x §2: o limiar separa o RITO, nao a exigencia. Abaixo dele a Portaria fala em
 * compensacao no mesmo dia; acima, em inclusao mediante autorizacao. Nos dois casos ALGUEM
 * PRECISA AUTORIZAR — por isso este numero nao dispensa nada, so rotula.
 */
export const LIMIAR_COMPENSACAO_MESMO_DIA_MIN = 20

/** Janela noturna do Art. 73 da CLT: 22h as 5h. */
export const NOTURNO_INICIO_HORA = 22
export const NOTURNO_FIM_HORA = 5

/**
 * Piso para deixar de considerar ruido de marcacao. E o mesmo teto por marcacao do Art. 58 §1 da
 * CLT ja usado em toleranciaExtra.ts. Nao e franquia: serve so para nao acusar atraso de 1 min.
 */
export const PISO_ATRASO_MIN = 5

/**
 * Formata minutos como HH:MM, SEM voltar a zero em 24h.
 *
 * ⚠️ Nao troque por um `% 24`. O `formatMinutesToTimeStr` que existia nas telas tinha
 * `Math.floor(min / 60) % 24` — correto para a hora extra de UM dia, e errado para qualquer total
 * do mes: 210h sairiam como "18:00". Foi exatamente por isso que este helper virou fonte unica.
 */
export function formatarMinutosHHMM(minutos: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(minutos) || 0))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Formata em HH:MM um total que so existe como DECIMAL DE HORAS (`folha_ponto.total_horas_*`).
 *
 * ⚠️ Use apenas onde os `registros` nao estao carregados — hoje, so a LISTAGEM de folhas. As
 * colunas do banco guardam `parseFloat((minutos / 60).toFixed(2))`, entao a volta erra ate 1
 * minuto (`0.18h` -> `0:11`, quando o real podia ser 10 ou 11). Em documento oficial (a folha e a
 * impressao em lote) isso nao serve: la os totais saem de `totaisFolha`, sobre os minutos.
 */
export function formatarHorasDecimaisHHMM(horas: number | null | undefined): string {
  return formatarMinutosHHMM(Math.round((Number(horas) || 0) * 60))
}

/** Horario previsto do dia, em minutos absolutos a partir da meia-noite da linha da folha. */
export interface PrevistoDia {
  entradaMin: number
  /** Passa de 1440 quando a jornada termina no dia seguinte ("18H AS 06H" -> 1800). */
  saidaMin: number
}

/**
 * Le o previsto do NOME da jornada.
 *
 * ⚠️ DEVOLVE null QUANDO NAO SABE — e essa e a diferenca que mais importa aqui.
 *   `parseJornadaNome` das actions cai num default de 08:00-17:00 quando o nome nao parseia. Para
 *   hora extra isso e contido; para ATRASO seria desastre: todo mundo com jornada que comeca
 *   depois das 08:00 apareceria atrasado, todo dia, contra um horario que ninguem combinou.
 *   Sem previsto, nao ha atraso a medir — e ponto.
 *
 * ⚠️ ACEITA "AS", "ÀS" e "ÁS". Medido em 04/09/2026: as jornadas `08H ÁS 20H` e `09H ÁS 21H`
 *   (A agudo, nao crase) estao no catalogo e NAO casavam com o regex original. Nenhuma escala
 *   ativa as usava (0 dias em 06, 07 e 08/2026), mas elas sao selecionaveis no cadastro — e no
 *   dia em que alguem escolhesse, a folha passaria a comparar contra 08:00-17:00 em silencio.
 */
export function previstoDaJornada(jornadaNome?: string | null): PrevistoDia | null {
  if (!jornadaNome) return null
  // "ÀS", "ÁS" e "AS" viram todos "AS" antes de casar.
  const semAcento = jornadaNome.replace(/[ÀÁàá]/g, 'a')
  const m = semAcento.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
  if (!m) return null

  const ih = parseInt(m[1], 10)
  const fh = parseInt(m[3], 10)
  if (isNaN(ih) || isNaN(fh)) return null

  const entradaMin = ih * 60 + (m[2] ? parseInt(m[2], 10) : 0)
  let saidaMin = fh * 60 + (m[4] ? parseInt(m[4], 10) : 0)
  if (saidaMin <= entradaMin) saidaMin += 24 * 60 // jornada que termina no dia seguinte

  return { entradaMin, saidaMin }
}

/**
 * Minutos dentro da janela noturna (22h-05h) entre dois instantes absolutos.
 *
 * Trabalha em minutos absolutos (o mesmo eixo de sequenciarDia), entao turno que cruza a
 * meia-noite atravessa a fronteira sem tratamento especial.
 */
export function minutosNoturnos(inicioAbs: number, fimAbs: number): number {
  if (!(fimAbs > inicioAbs)) return 0
  let total = 0
  for (let t = Math.floor(inicioAbs); t < Math.ceil(fimAbs); t++) {
    const hora = Math.floor((((t % 1440) + 1440) % 1440) / 60)
    if (hora >= NOTURNO_INICIO_HORA || hora < NOTURNO_FIM_HORA) total++
  }
  return total
}

/** Um dia da folha, so os campos que este modulo le. */
export interface RegistroDia extends HorariosDia {
  dia?: number
  turno_codigo?: string | null
  feriado?: boolean | null
  afastamento?: string | null
  jornada_nome?: string | null
  hora_extra_minutos?: number | null
  hora_extra_tipo?: string | null
  observacao?: string | null
  compensacao_status?: CompensacaoStatus | null
  compensacao_minutos?: number | null
  abono_minutos?: number | null
  /**
   * Slots do turno cobertos por afastamento PARCIAL neste dia (`['M']` num turno `MT`).
   *
   * 🚨 Preenchido, o dia NAO tem atraso nem saida antecipada medidos. Nao e leniencia: o
   * `previsto` vem do NOME DA JORNADA e vale para o dia inteiro. Quem tem declaracao de
   * comparecimento pela manha e volta as 13:10 numa jornada `08H AS 18H` apareceria com 5h10 de
   * ATRASO contra um horario que ninguem esperava que ela cumprisse — e, com afastamento da
   * tarde, com 6h de saida antecipada. Recortar o previsto pelo slot tambem nao serve: onde cai o
   * intervalo e a que horas a declaracao terminou nao estao no dado. Vale o principio que ja rege
   * `previstoDaJornada`: sem previsto confiavel, nao ha atraso a medir.
   *
   * ⚠️ A HORA EXTRA CONTINUA sendo medida. Ela compara a SAIDA contra o fim previsto da jornada,
   * que o afastamento matinal nao move: quem foi liberada de manha e saiu as 18:30 fez 30 min
   * depois do horario, e isso e verdade com atestado ou sem.
   */
  afastamento_slots?: string[] | null
}

export type CompensacaoStatus =
  /** Nao ha atraso reposto por saida posterior neste dia. */
  | 'nenhum'
  /** Ha, e ninguem decidiu ainda. NAO altera valor nenhum enquanto estiver assim. */
  | 'pendente'
  /** Coordenador/RH autorizou a compensacao (Art. 7 §1/§2). */
  | 'autorizada'
  /** Coordenador/RH confirmou que aquilo e hora extra mesmo, nao reposicao de atraso. */
  | 'extra_confirmada'

export interface CalculoDia {
  /** null quando o nome da jornada nao resolve o previsto — entao nada de atraso e medido. */
  previsto: PrevistoDia | null
  /** Minutos de atraso na entrada (0 quando dentro do piso ou sem previsto). */
  atrasoEntradaMinutos: number
  /** Minutos em que a saida veio antes do previsto. */
  saidaAntecipadaMinutos: number
  /** Minutos em que a saida passou do previsto (a base da hora extra de hoje). */
  excedenteSaidaMinutos: number
  /** Minutos trabalhados dentro da janela 22h-05h. */
  noturnoMinutos: number
  /** Art. 7 §5: o dia tem todos os registros que a jornada dele exige? */
  diaCompleto: boolean
  /**
   * PROPOSTA de compensacao: quanto do excedente da saida apenas repoe o atraso da entrada.
   * `min(atraso, excedente, 2h)`. Zero quando o dia nao e elegivel.
   */
  compensavelMinutos: number
  /** Estado sugerido para um dia que ainda nao foi decidido por ninguem. */
  statusSugerido: CompensacaoStatus
}

/**
 * O dia tem os registros que a jornada dele exige? (Art. 7 §5)
 *
 * ⚠️ "Completo" NAO e "os quatro campos preenchidos". Jornada de ate 6h nao tem intervalo
 * intrajornada (CLT Art. 71 e `fn_jornada_tem_intervalo`, a fonte unica do projeto), entao ali o
 * dia completo tem DOIS registros. Medido em 08/2026: 2.688 dias tem so entrada e saida e sao
 * legitimos; exigir quatro deles reprovaria um terco do mes sem motivo.
 */
export function diaCompletoParaCompensacao(registro: RegistroDia): boolean {
  const temEntrada = !!registro.entrada
  const temSaida = !!registro.saida
  if (!temEntrada || !temSaida) return false

  const previsto = previstoDaJornada(registro.jornada_nome)
  const duracaoMin = previsto ? previsto.saidaMin - previsto.entradaMin : null
  // Sem previsto nao da para saber se aquela jornada exige intervalo: exige os quatro, que e o
  // criterio mais estrito — na duvida, nao compensa.
  const exigeIntervalo = duracaoMin === null ? true : duracaoMin > 360

  if (!exigeIntervalo) return true
  return !!registro.saida_intervalo && !!registro.retorno_intervalo
}

/**
 * Mede um dia. Nao decide nada: devolve numeros e uma sugestao de estado.
 *
 * @param jornadaNomeFallback nome da jornada da folha, usado quando o registro nao traz o seu.
 *   ⚠️ Isto NAO e zelo excessivo: medido em 04/09/2026, 878 dias de 09/2026 (13,7% do mes) tem
 *   `jornada_nome` vazio no snapshot, embora a escala tenha jornada vinculada e o calculo da
 *   geracao esteja correto. Sem o fallback, esses dias cairiam sem previsto.
 */
export function calcularDia(
  registro: RegistroDia,
  jornadaNomeFallback?: string | null
): CalculoDia {
  const jornadaNome = registro.jornada_nome || jornadaNomeFallback || null
  const previsto = previstoDaJornada(jornadaNome)
  const seq = sequenciarDia(registro, jornadaNome)

  const entradaAbs = seq.minutos.entrada
  const saidaAbs = seq.minutos.saida

  // Noturno: soma os trechos REALMENTE trabalhados. Com intervalo marcado sao dois trechos; sem
  // intervalo, um so. Trecho invertido (dado quebrado) nao entra — minutosNoturnos ja devolve 0.
  let noturnoMinutos = 0
  if (entradaAbs !== null && saidaAbs !== null && !seq.invertido) {
    const saiInt = seq.minutos.saida_intervalo
    const retInt = seq.minutos.retorno_intervalo
    if (saiInt !== null && retInt !== null) {
      noturnoMinutos = minutosNoturnos(entradaAbs, saiInt) + minutosNoturnos(retInt, saidaAbs)
    } else {
      noturnoMinutos = minutosNoturnos(entradaAbs, saidaAbs)
    }
  }

  let atrasoEntradaMinutos = 0
  let saidaAntecipadaMinutos = 0
  let excedenteSaidaMinutos = 0

  // Dia de afastamento PARCIAL: o previsto da jornada nao descreve o que se esperava dela hoje.
  // Ver `afastamento_slots` em RegistroDia — o excedente da SAIDA continua valendo.
  const diaParcial = !!registro.afastamento_slots?.length

  if (previsto) {
    if (entradaAbs !== null && !diaParcial) {
      const d = entradaAbs - previsto.entradaMin
      if (d > PISO_ATRASO_MIN) atrasoEntradaMinutos = d
    }
    if (saidaAbs !== null && !seq.invertido) {
      const d = saidaAbs - previsto.saidaMin
      if (d > 0) excedenteSaidaMinutos = d
      else if (-d > PISO_ATRASO_MIN && !diaParcial) saidaAntecipadaMinutos = -d
    }
  }

  const diaCompleto = diaCompletoParaCompensacao(registro)

  const elegivel = atrasoEntradaMinutos > 0 && excedenteSaidaMinutos > 0 && diaCompleto
  const compensavelMinutos = elegivel
    ? Math.min(atrasoEntradaMinutos, excedenteSaidaMinutos, TETO_COMPENSACAO_DIARIA_MIN)
    : 0

  return {
    previsto,
    atrasoEntradaMinutos,
    saidaAntecipadaMinutos,
    excedenteSaidaMinutos,
    noturnoMinutos,
    diaCompleto,
    compensavelMinutos,
    statusSugerido: compensavelMinutos > 0 ? 'pendente' : 'nenhum',
  }
}

/** O estado efetivo do dia: o que alguem decidiu, ou a sugestao quando ninguem decidiu ainda. */
export function statusCompensacaoDoDia(
  registro: RegistroDia,
  calculo: CalculoDia
): CompensacaoStatus {
  const gravado = registro.compensacao_status
  if (gravado === 'autorizada' || gravado === 'extra_confirmada') return gravado
  return calculo.statusSugerido
}

/**
 * Minutos de hora extra do dia DEPOIS da decisao de compensacao.
 *
 * ⚠️ `pendente` devolve o valor de hoje, inalterado. Foi a decisao de desenho mais importante
 * desta mudanca: o default nao pode mexer em verba. "Compensa por padrao" tiraria 253h de 141
 * pessoas de uma vez, numa folha que o servidor assina; "e extra por padrao" manteria o problema.
 * Entao o dia fica pendente, o total nao muda, e a decisao e cobrada no FECHAMENTO da folha.
 */
export function extraEfetivaDoDia(registro: RegistroDia, calculo: CalculoDia): number {
  const bruta = Math.max(0, Number(registro.hora_extra_minutos) || 0)
  if (statusCompensacaoDoDia(registro, calculo) !== 'autorizada') return bruta
  return Math.max(0, bruta - calculo.compensavelMinutos)
}

/** Atraso que sobra no dia depois da compensacao autorizada. */
export function atrasoEfetivoDoDia(registro: RegistroDia, calculo: CalculoDia): number {
  const bruto = calculo.atrasoEntradaMinutos + calculo.saidaAntecipadaMinutos
  if (statusCompensacaoDoDia(registro, calculo) !== 'autorizada') return bruto
  return Math.max(0, bruto - calculo.compensavelMinutos)
}

export interface TotaisFolha {
  /** Horas normais em minutos (jornada prevista por dia trabalhado — regra inalterada). */
  normaisMinutos: number
  noturnoMinutos: number
  /** Atraso + saida antecipada, ja liquido das compensacoes autorizadas. */
  atrasoMinutos: number
  extra50Minutos: number
  extra100Minutos: number
  faltas: number
  /**
   * Tempo abonado no mes (Declaracao de Comparecimento e afins, por horas, sem `a_compensar`).
   *
   * ⚠️ NAO e "dias de afastamento". Ver minutosAbonadosDoDia em afastamentosDia.ts: contar dia
   * com afastamento daria 1.173 "abonos" em 08/2026, quase todos Ferias e Licencas.
   *
   * ⚠️ Vale 0 em folha gerada ANTES de 04/09/2026 — `abono_minutos` so passa a existir no
   * registro a partir dali. Zero honesto e melhor que numero inventado: a folha mostra o abono
   * assim que for regerada/sincronizada.
   */
  abonoMinutos: number
  /** Dias com atraso reposto por saida posterior que ninguem decidiu ainda. */
  pendentesCompensacao: number[]
  /** Minutos que seriam abatidos da hora extra se todos os pendentes fossem autorizados. */
  compensavelPendenteMinutos: number
}

export interface OpcoesTotais {
  /** Horas da jornada por dia trabalhado — hoje `jornada.horas_totais` (default 8), como sempre. */
  horasNormaisPorDia: number
  jornadaNome?: string | null
  ano: number
  mes: number
  /** Um dia conta como falta definitiva? Injetado para o modulo continuar puro. */
  isFaltaDefinitiva: (observacao?: string | null) => boolean
  /**
   * Competencia a partir da qual a regra de atraso/compensacao vale (`YYYY-MM`).
   * Omitido = `COMPETENCIA_COMPENSACAO_PADRAO`. Ver regraCompensacaoVigente.
   */
  compensacaoVigenteDesde?: string | null
}

/**
 * Totais do mes, a partir dos `registros` da folha.
 *
 * ⚠️ ESTA E A FONTE UNICA DOS DOIS RENDERIZADORES — editor e impressao em lote.
 *   A impressao em lote lia `folha.total_horas_extras_*` do banco, que e gravado como
 *   `parseFloat((minutos / 60).toFixed(2))` em OITO lugares. De `0.18h` nao se recupera `11 min`:
 *   a folha impressa e a folha da tela mostrariam valores diferentes para o mesmo documento. Os
 *   `registros` ja estavam carregados nos dois lados; passaram a ser a fonte nos dois.
 */
export function totaisFolha(registros: RegistroDia[], opcoes: OpcoesTotais): TotaisFolha {
  /*
    ⚠️ Antes do corte a folha continua com o rodape de sempre: os indicadores novos ficam em zero
    e nenhum dia entra na fila de decisao. A competencia anterior e documento ja assinado — ver
    COMPETENCIA_COMPENSACAO_PADRAO.
  */
  const vigente = regraCompensacaoVigente(opcoes.mes, opcoes.ano, opcoes.compensacaoVigenteDesde)
  let normaisMinutos = 0
  let noturnoMinutos = 0
  let atrasoMinutos = 0
  let extra50Minutos = 0
  let extra100Minutos = 0
  let faltas = 0
  let abonoMinutos = 0
  let compensavelPendenteMinutos = 0
  const pendentesCompensacao: number[] = []

  for (const r of registros || []) {
    if (r.turno_codigo) normaisMinutos += Math.round((opcoes.horasNormaisPorDia || 8) * 60)
    if (opcoes.isFaltaDefinitiva(r.observacao)) faltas++

    // ⚠️ O abono vem do registro (minutosAbonadosDoDia), NUNCA deduzido de `r.afastamento`:
    // aquele campo cobre Ferias, Licenca Premio, Licenca saude... e contar aquilo como abono
    // daria 1.173 "abonos" em 08/2026. A soma acontece dentro do bloco de vigencia, abaixo.

    const calculo = calcularDia(r, opcoes.jornadaNome)
    if (vigente) {
      noturnoMinutos += calculo.noturnoMinutos
      atrasoMinutos += atrasoEfetivoDoDia(r, calculo)
      abonoMinutos += Math.max(0, Number(r.abono_minutos) || 0)

      if (statusCompensacaoDoDia(r, calculo) === 'pendente' && r.dia) {
        pendentesCompensacao.push(r.dia)
        compensavelPendenteMinutos += calculo.compensavelMinutos
      }
    }

    const extra = vigente ? extraEfetivaDoDia(r, calculo) : Math.max(0, Number(r.hora_extra_minutos) || 0)
    if (extra > 0) {
      const domingo = new Date(opcoes.ano, opcoes.mes - 1, r.dia || 1).getDay() === 0
      if (domingo || r.feriado || r.hora_extra_tipo === '100%') extra100Minutos += extra
      else extra50Minutos += extra
    }
  }

  return {
    normaisMinutos,
    noturnoMinutos,
    atrasoMinutos,
    extra50Minutos,
    extra100Minutos,
    faltas,
    abonoMinutos,
    pendentesCompensacao,
    compensavelPendenteMinutos,
  }
}

/**
 * Carrega para o registro NOVO a decisao de compensacao que ja existia no registro anterior.
 *
 * ⚠️ SEM ISTO, "Sincronizar" APAGA A AUTORIZACAO DO COORDENADOR. `folha_ponto.registros` e um
 * snapshot reconstruido do zero a cada geracao/sincronizacao — e a decisao de compensar e
 * exatamente o tipo de dado que a regra de `preservacao.ts` manda preservar: decisao humana, nao
 * valor derivado da escala.
 *
 * ⚠️ O VALOR EM MINUTOS NAO E PRESERVADO COMO VERDADE. `compensacao_minutos` fica no registro
 * como historico do que foi decidido, mas quem abate a hora extra e o `compensavelMinutos`
 * RECALCULADO sobre os horarios atuais (ver extraEfetivaDoDia). Se a batida do dia mudar, a
 * autorizacao continua valendo e o valor acompanha o fato novo — em vez de congelar um numero que
 * deixou de corresponder ao que aconteceu.
 */
export function carregarDecisaoCompensacao(
  registroNovo: Record<string, unknown>,
  registroExistente: Record<string, unknown> | null | undefined
): void {
  if (!registroNovo || !registroExistente) return
  const status = registroExistente.compensacao_status
  if (status !== 'autorizada' && status !== 'extra_confirmada') return

  registroNovo.compensacao_status = status
  registroNovo.compensacao_minutos = registroExistente.compensacao_minutos ?? null
  registroNovo.compensacao_autorizado_por_nome = registroExistente.compensacao_autorizado_por_nome ?? null
  registroNovo.compensacao_autorizado_em = registroExistente.compensacao_autorizado_em ?? null
  registroNovo.compensacao_justificativa = registroExistente.compensacao_justificativa ?? null
}

/**
 * Dias em que ha atraso reposto por saida posterior e ninguem decidiu ainda.
 *
 * E o que o FECHAMENTO da folha cobra. Mesmo desenho da falta pendente que ja existia
 * (`diasComFaltaPendente` + `requerConfirmacaoFaltas`): a folha nao trava, mas fechar sem decidir
 * passa a ser uma escolha explicita, e nao um esquecimento silencioso.
 */
export function diasPendentesDeCompensacao(
  registros: RegistroDia[],
  jornadaNomeFallback?: string | null,
  competencia?: { mes: number; ano: number; vigenteDesde?: string | null }
): number[] {
  // Sem competencia informada nao ha como saber se a regra vale — e o chamador que decide.
  if (competencia && !regraCompensacaoVigente(competencia.mes, competencia.ano, competencia.vigenteDesde)) {
    return []
  }
  const dias: number[] = []
  for (const r of registros || []) {
    const calculo = calcularDia(r, jornadaNomeFallback)
    if (statusCompensacaoDoDia(r, calculo) === 'pendente' && r.dia) dias.push(r.dia)
  }
  return dias
}

/** Rotulo curto do estado, para o selo na linha do dia. */
export function rotuloCompensacao(status: CompensacaoStatus): string {
  switch (status) {
    case 'pendente': return 'Atraso reposto — decidir'
    case 'autorizada': return 'Compensação autorizada'
    case 'extra_confirmada': return 'Hora extra confirmada'
    default: return ''
  }
}

export { timeToMin }
