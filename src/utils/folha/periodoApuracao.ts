/**
 * Regime de apuracao da folha: o periodo de fechamento quando ele NAO e o mes civil.
 *
 * Espelho de fn_periodo_apuracao / fn_regime_apuracao_servidor (migration 20260916110000).
 * Plano: docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md
 *
 * O Mais Medicos fecha a frequencia no dia 20: o periodo vai de 21 de um mes a 20 do seguinte.
 * Nao e norma federal (procurada e nao localizada) — e convencao de anos, e a folha do municipio
 * ja operou assim. Por isso o corte e cadastro, nunca constante no codigo, e pode voltar a valer
 * para a rede inteira.
 *
 * 🚨 O INVARIANTE QUE NAO PODE SER QUEBRADO: o regime muda a JANELA DO DOCUMENTO, nunca o
 * calculo do dia. Atraso, hora extra, compensacao (Art. 7), autorizacao de extra (Art. 8),
 * abono, falta, pre-assinalacao e intervalo continuam sendo decididos por dia, pelas mesmas
 * funcoes, com as mesmas vigencias. O regime so decide QUAIS DIAS entram em QUAL documento.
 * Se um dia o regime comecar a mudar quanto vale um dia, o desenho saiu dos trilhos: o mesmo dia
 * passaria a valer coisas diferentes na folha mensal e na apuracao, e o servidor assinaria dois
 * numeros.
 */

/** A competencia (mes/ano) em que o periodo FECHA. Decisao do usuario, 16/09/2026. */
export interface Competencia {
  mes: number
  ano: number
}

export interface RegimeApuracao {
  id: string
  nome: string
  /** null = ultimo dia do mes. Mes civil NAO e "corte 31": e a ausencia de corte. */
  dia_corte: number | null
  padrao?: boolean
  ativo?: boolean
}

export interface JanelaPeriodo {
  /** Data pura `YYYY-MM-DD`. Nunca um timestamp: ver armadilha 12. */
  inicio: string
  fim: string
  diaCorte: number | null
  /** true quando o periodo pega duas competencias de folha. */
  atravessaMes: boolean
  rotulo: string
}

/** Uma das competencias que o periodo abrange, com o recorte de dias dentro dela. */
export interface MetadePeriodo {
  mes: number
  ano: number
  /** primeiro dia (do mes) que entra no periodo */
  diaInicio: number
  /** ultimo dia (do mes) que entra no periodo */
  diaFim: number
}

export const ROTULO_MES_CIVIL = 'Mes civil (dia 1 ao ultimo dia)'

const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
]

/**
 * Dias do mes. `new Date(ano, mes, 0).getDate()` e imune a fuso — ver armadilha 12, que separa
 * este caso (aritmetica de calendario) da derivacao de data a partir de um instante.
 */
export function diasNoMes(mes: number, ano: number): number {
  return new Date(ano, mes, 0).getDate()
}

function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function ehCompetenciaValida(mes: number, ano: number): boolean {
  return Number.isInteger(mes) && mes >= 1 && mes <= 12 && Number.isInteger(ano) && ano >= 2000
}

/** A competencia imediatamente anterior. */
export function competenciaAnterior(mes: number, ano: number): Competencia {
  return mes === 1 ? { mes: 12, ano: ano - 1 } : { mes: mes - 1, ano }
}

/** A competencia imediatamente seguinte. */
export function competenciaSeguinte(mes: number, ano: number): Competencia {
  return mes === 12 ? { mes: 1, ano: ano + 1 } : { mes: mes + 1, ano }
}

/**
 * A janela de apuracao de uma competencia, para um regime.
 *
 * 🚨 O INICIO e "fim do periodo anterior + 1 dia", nunca "dia_corte + 1 do mes anterior".
 * Com corte 28 em marco o mes anterior e fevereiro e o dia 29 nao existe: a formula ingenua
 * produziria data invalida. Assim a propriedade que importa sai de graca — os periodos
 * consecutivos sao CONTIGUOS e nao se sobrepoem, entao nenhum dia de trabalho cai em dois
 * documentos nem em nenhum.
 *
 * Mes civil (dia_corte null) e um CASO desta funcao, nao um caminho separado: e o que impede as
 * duas metades do codigo de divergirem.
 */
export function janelaDoPeriodo(
  regime: Pick<RegimeApuracao, 'dia_corte'> | null | undefined,
  mes: number,
  ano: number
): JanelaPeriodo {
  if (!ehCompetenciaValida(mes, ano)) {
    throw new Error(`Competencia invalida: mes ${mes}, ano ${ano}.`)
  }

  const corte = regime?.dia_corte ?? null

  if (corte === null) {
    const ultimo = diasNoMes(mes, ano)
    const inicio = iso(ano, mes, 1)
    const fim = iso(ano, mes, ultimo)
    return {
      inicio,
      fim,
      diaCorte: null,
      atravessaMes: false,
      rotulo: `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`
    }
  }

  if (!Number.isInteger(corte) || corte < 1 || corte > 28) {
    // O teto de 28 protege o FIM: corte 29, 30 ou 31 nao existe em fevereiro.
    throw new Error(`Dia de corte invalido: ${corte}. O cadastro aceita de 1 a 28.`)
  }

  const ant = competenciaAnterior(mes, ano)
  const fimAnterior = iso(ant.ano, ant.mes, corte)
  const inicio = somarUmDia(fimAnterior)
  const fim = iso(ano, mes, corte)

  return {
    inicio,
    fim,
    diaCorte: corte,
    atravessaMes: inicio.slice(0, 7) !== fim.slice(0, 7),
    rotulo: `Apuracao ${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`
  }
}

/**
 * Soma um dia a uma data pura, sem passar por fuso.
 * `setDate(getDate() + 1)` sobre componentes locais e imune (armadilha 12).
 */
export function somarUmDia(data: string): string {
  const [a, m, d] = data.split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  dt.setDate(dt.getDate() + 1)
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

export function formatarDataBR(data: string): string {
  const [a, m, d] = data.split('-')
  return `${d}/${m}/${a}`
}

/**
 * A janela escrita para gente ler, com o mes por extenso.
 * O rotulo NUNCA e so "09/2026": um periodo que atravessa a virada precisa das duas datas, senao
 * ninguem sabe se "setembro" comeca no dia 1 ou no dia 21.
 */
export function descreverJanela(janela: JanelaPeriodo): string {
  if (janela.diaCorte === null) return ROTULO_MES_CIVIL
  const [aI, mI, dI] = janela.inicio.split('-').map(Number)
  const [aF, mF, dF] = janela.fim.split('-').map(Number)
  const mesmoAno = aI === aF
  const esq = `${dI} de ${MESES[mI - 1]}${mesmoAno ? '' : ` de ${aI}`}`
  const dir = `${dF} de ${MESES[mF - 1]} de ${aF}`
  return `${esq} a ${dir}`
}

/**
 * As competencias que o periodo abrange, com o recorte de dias de cada uma.
 *
 * 🚨 E ISTO que a montagem da apuracao (Fase 2) tem de usar, e o motivo e medido: o periodo
 * 21/08 -> 20/09 atravessa o corte de vigencia das regras de folha. Em 16/09/2026, nos 4
 * medicos, os dias de agosto valem 10,00 h (vao bruto da jornada, regra antiga) e os de setembro
 * 7,58 h (liquido — `horas_normais_liquidas_desde` = 2026-09).
 *
 * `totaisFolha(registros, opcoes)` recebe UMA competencia e UMA carga por dia. Chama-la uma vez
 * sobre os 31 dias aplicaria a regua de setembro aos dias de agosto: -40h somando as 4
 * apuracoes, num documento que o servidor assina e divergindo da folha de agosto, que esta
 * Revisada. Some POR METADE e junte os resultados — a apuracao DERIVA da folha, nunca recalcula.
 */
export function metadesDoPeriodo(janela: JanelaPeriodo): MetadePeriodo[] {
  const [aI, mI, dI] = janela.inicio.split('-').map(Number)
  const [aF, mF, dF] = janela.fim.split('-').map(Number)

  if (aI === aF && mI === mF) {
    return [{ mes: mI, ano: aI, diaInicio: dI, diaFim: dF }]
  }

  return [
    { mes: mI, ano: aI, diaInicio: dI, diaFim: diasNoMes(mI, aI) },
    { mes: mF, ano: aF, diaInicio: 1, diaFim: dF }
  ]
}

/** O dia pertence ao periodo? `dia` e o numero do dia DENTRO da competencia informada. */
export function diaNoPeriodo(
  janela: JanelaPeriodo,
  dia: number,
  mes: number,
  ano: number
): boolean {
  const alvo = iso(ano, mes, dia)
  return alvo >= janela.inicio && alvo <= janela.fim
}

export interface VigenciaRegime {
  id: string
  /** null = vale para a rede inteira. */
  servidor_id: string | null
  regime_id: string
  vigencia_inicio: string
  vigencia_fim: string | null
}

/**
 * O regime vigente para o servidor na data. Tres niveis, do mais especifico ao mais geral —
 * espelho exato de fn_regime_apuracao_servidor:
 *
 *   1. vigencia do servidor
 *   2. vigencia global (servidor_id null) — e assim que o corte volta a valer para a rede
 *      inteira sem criar 2.647 linhas, uma por servidor ativo
 *   3. o regime marcado padrao no catalogo (Mes civil)
 *
 * ⚠️ Servidor sem atribuicao NAO devolve null: cai no padrao. Senao todo servidor novo nasceria
 * sem regime e a apuracao dele falharia em silencio.
 */
export function regimeDoServidor(
  vigencias: VigenciaRegime[],
  regimes: RegimeApuracao[],
  servidorId: string,
  data: string
): RegimeApuracao | null {
  const vigenteEm = (v: VigenciaRegime) =>
    v.vigencia_inicio <= data && (v.vigencia_fim === null || v.vigencia_fim >= data)

  const maisRecente = (lista: VigenciaRegime[]) =>
    lista.sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0]

  const doServidor = maisRecente(
    (vigencias || []).filter(v => v.servidor_id === servidorId && vigenteEm(v))
  )
  if (doServidor) {
    return regimes.find(r => r.id === doServidor.regime_id) || null
  }

  const daRede = maisRecente(
    (vigencias || []).filter(v => v.servidor_id === null && vigenteEm(v))
  )
  if (daRede) {
    return regimes.find(r => r.id === daRede.regime_id) || null
  }

  return regimes.find(r => r.padrao) || null
}

/**
 * A data de referencia para resolver o regime de uma competencia: o ULTIMO dia do mes dela.
 * E nele que o periodo fecha, e e o regime daquele momento que decide a janela inteira — senao
 * uma atribuicao feita no dia 25 mudaria a janela que ja estava correndo desde o dia 21.
 */
export function dataDeReferencia(mes: number, ano: number): string {
  return iso(ano, mes, diasNoMes(mes, ano))
}
