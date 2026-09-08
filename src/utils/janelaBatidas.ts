/**
 * Fonte unica de "a qual celula da grade pertence esta batida, e em que dia ela caiu".
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE (03/09/2026)
 *   O modal de validacao manual filtrava as batidas por DIA CIVIL da celula:
 *
 *     const d = new Date(iso)
 *     return d.getDate() === dia && d.getMonth() + 1 === mes && d.getFullYear() === ano
 *
 *   Num plantao que atravessa a meia-noite isso erra dos dois lados ao mesmo tempo. Caso real
 *   (NEURIAN, SMS/REGULACAO, 01/09/2026, Plantao `N` 19:00 -> 07:00+1): ela entrou 18:58 e saiu
 *   07:02 do dia 02, e o modal do dia 1 oferecia
 *
 *     [ ] 07:00:00     [ ] 07:02:00
 *
 *   que sao as batidas de 07:00/07:02 do dia 01 — a saida do plantao da VESPERA. A saida real
 *   (07:02 do dia 02) nao aparecia, e as que apareciam nao diziam de que dia eram.
 *
 * 🚨 O EFEITO NAO ERA SO "FALTAR INFORMACAO": o modal oferecia, como SAIDA do plantao do dia 1,
 *   uma batida ocorrida 12 HORAS ANTES da entrada dele. Marcada, gravava saida anterior a entrada.
 *
 * A REGRA
 *   1. A lista e a UNIAO do dia civil da celula com a janela prevista do bloco (com folga). Uniao,
 *      nunca substituicao: trocar um criterio pelo outro ESCONDERIA batida que hoje aparece, e a
 *      regra da casa e "nunca descartar batida" — quem some da tela vira ponto perdido em silencio.
 *   2. Toda batida carrega o dia RELATIVO a celula (`-1D`, `+1D`), porque num turno de 24h o
 *      `07:02` sozinho e indecidivel.
 *   3. Batida fora da janela prevista do bloco continua VISIVEL e continua selecionavel — o
 *      coordenador e a autoridade —, mas rotulada, para a escolha deixar de ser as cegas.
 *
 * ⚠️ A DATA VEM DE `dataISOLocal`, NUNCA DE `new Date(iso).getDate()`.
 *   O segundo usa o fuso da MAQUINA (armadilha 12): o processo Node roda em UTC na VPS, e uma
 *   batida das 22:00 de 11/08 e "dia 12" para ele. Aqui a data de dominio sai sempre do fuso
 *   configurado em `configuracoes_globais.timezone`.
 *
 * ⚠️ ESTE MODULO NAO DECIDE ELEGIBILIDADE. Quem diz se uma batida pode virar horario de folha e
 *   `fn_tentativa_recusada_elegivel`/`fn_batidas_reais_recusadas`, no banco. Aqui so se decide o
 *   que a tela MOSTRA e como rotula.
 */

import { dataISOLocal } from '@/utils/horario'

/**
 * Folga aplicada as duas pontas da janela prevista do bloco, so para EXIBIR.
 *
 * Nao e a tolerancia de alocacao (`rep_tolerancia_alocacao_minutos`, 360 min): aquela decide o que
 * o banco CASA, esta decide o que a tela LISTA. Deliberadamente menor — 360 min de folga sobre um
 * bloco de 12h traria quase o dia inteiro e devolveria a lista ao ruido de onde ela saiu. Como o
 * criterio e uniao com o dia civil, folga curta nunca esconde nada.
 */
export const FOLGA_EXIBICAO_MIN = 240

const MS_POR_DIA = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` -> epoch UTC da meia-noite. Data pura, sem conversao de fuso (armadilha 12). */
function epochDeDataPura(dataISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** `YYYY-MM-DD` da celula (dia/mes/ano da grade). */
export function dataDaCelula(dia: number, mes: number, ano: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Dias inteiros entre a data local da batida e a data da celula. `0` mesmo dia, `1` dia seguinte,
 * `-1` vespera. `null` quando o instante nao e legivel.
 */
export function deltaDiaDaBatida(iso: string, dataCelulaISO: string, tz?: string): number | null {
  const dBatida = dataISOLocal(iso, tz)
  if (!dBatida) return null
  const a = epochDeDataPura(dBatida)
  const b = epochDeDataPura(dataCelulaISO)
  if (a === null || b === null) return null
  return Math.round((a - b) / MS_POR_DIA)
}

/**
 * `+1D` / `-1D` para a tela. `null` no mesmo dia — rotular o caso normal e ruido.
 *
 * O sinal usa o MENOS de verdade (U+2212), nao o hifen: em fonte tabular o hifen some ao lado do
 * numero e `-1D` vira `1D`.
 */
export function rotuloDiaRelativo(delta: number | null): string | null {
  if (delta === null || delta === 0) return null
  return delta > 0 ? `+${delta}D` : `−${Math.abs(delta)}D`
}

export type PosicaoDaBatida = 'no_turno' | 'no_dia' | 'fora'

export type ClassificacaoBatida = {
  /** `no_turno`: dentro da janela prevista do bloco (com folga). `no_dia`: so o dia civil bate. */
  posicao: PosicaoDaBatida
  /** Dias de diferenca para a data da celula. */
  delta: number | null
  /** `+1D` / `-1D`, ou null no mesmo dia. */
  rotulo: string | null
}

export type JanelaDoBloco = {
  inicio_previsto?: string | null
  fim_previsto?: string | null
} | null | undefined

/**
 * Classifica uma batida em relacao a uma celula da grade.
 *
 * @param iso            instante da batida
 * @param dataCelulaISO  `YYYY-MM-DD` da celula (use `dataDaCelula`)
 * @param bloco          previsto vindo de `fn_blocos_previstos_mes`; sem ele so o dia civil vale
 */
export function classificarBatida(
  iso: string,
  dataCelulaISO: string,
  bloco?: JanelaDoBloco,
  tz?: string,
): ClassificacaoBatida {
  const delta = deltaDiaDaBatida(iso, dataCelulaISO, tz)
  const rotulo = rotuloDiaRelativo(delta)

  const t = new Date(iso).getTime()
  const ini = bloco?.inicio_previsto ? new Date(bloco.inicio_previsto).getTime() : null
  const fim = bloco?.fim_previsto ? new Date(bloco.fim_previsto).getTime() : null

  if (
    Number.isFinite(t) && ini !== null && fim !== null
    && Number.isFinite(ini) && Number.isFinite(fim)
    && t >= ini - FOLGA_EXIBICAO_MIN * 60_000
    && t <= fim + FOLGA_EXIBICAO_MIN * 60_000
  ) {
    return { posicao: 'no_turno', delta, rotulo }
  }

  if (delta === 0) return { posicao: 'no_dia', delta, rotulo }
  return { posicao: 'fora', delta, rotulo }
}

/** A batida entra na lista do modal? Uniao do dia civil com a janela do bloco. */
export function batidaVisivelNaCelula(
  iso: string,
  dataCelulaISO: string,
  bloco?: JanelaDoBloco,
  tz?: string,
): boolean {
  return classificarBatida(iso, dataCelulaISO, bloco, tz).posicao !== 'fora'
}

/**
 * Ordem de exibicao: primeiro as do turno previsto, depois as que so compartilham o dia civil;
 * dentro de cada grupo, cronologica.
 *
 * ⚠️ Ordenar so por horario juntaria a saida do plantao da vespera (07:00 do dia 1) com a entrada
 * deste (19:00 do dia 1) numa lista sem hierarquia nenhuma — foi assim que o caso NEURIAN chegou
 * a tela. A separacao por grupo e o que faz o candidato natural aparecer primeiro.
 */
export function compararBatidasParaExibir(
  a: { instante: number; posicao: PosicaoDaBatida },
  b: { instante: number; posicao: PosicaoDaBatida },
): number {
  const peso = (p: PosicaoDaBatida) => (p === 'no_turno' ? 0 : 1)
  const d = peso(a.posicao) - peso(b.posicao)
  if (d !== 0) return d
  return a.instante - b.instante
}

/* ==========================================================================================
 * ONDE A BATIDA FOI FEITA (08/09/2026)
 * ==========================================================================================
 * Desde 20260908150000 a alocacao automatica nao atravessa unidade: a batida feita no relogio
 * de uma unidade nao preenche mais o passo da escala de outra. Ela nao some — vira pendencia e
 * continua selecionavel aqui, porque o coordenador e a autoridade e existe caso legitimo (o
 * relogio da unidade quebrado, a pessoa bate no da vizinha).
 *
 * 🚨 Mas "continua selecionavel" sem dizer de onde veio troca um erro silencioso por outro: a
 * batida aparece na lista igual as demais e o coordenador a devolve a folha sem saber que foi
 * feita a quilometros dali. As duas metades andam juntas — o sistema nao decide sozinho E o
 * coordenador nao decide as cegas.
 *
 * ⚠️ SO A BATIDA DE RELOGIO TEM LUGAR. Em origem `terminal`, marcacoes_ponto.unidade_id e a
 * LOTACAO do servidor (fn_registrar_ponto le servidores.unidade_id), nao onde ele bateu — por
 * isso fn_marcacoes_mes ja devolve unidade_id NULO fora de `rep`. Tratar aquilo como lugar
 * acusaria de "outra unidade" justamente o Servidor Externo, que e' lotado em A e escalado em B.
 *
 * ⚠️ NA DUVIDA, NAO ACUSA. So se afirma "outra unidade" quando os DOIS lados sao conhecidos e
 * diferem — a mesma assimetria que o banco aplica: lugar desconhecido de qualquer lado nao
 * restringe nada. Rotular por falta de informacao poria um aviso vermelho em batida legitima,
 * e aviso que grita a toa e o caminho mais curto para ninguem mais ler nenhum.
 */

export type BatidaComLugar = {
  unidade_id?: string | null
  unidade_nome?: string | null
  dispositivo_nome?: string | null
}

export type LugarDaBatida = {
  /** Batida de relogio de unidade DIFERENTE da escala. Falso sempre que houver duvida. */
  outraUnidade: boolean
  /** Texto curto para a tela (unidade e, quando houver, o relogio). `null` quando nada a dizer. */
  rotulo: string | null
}

export function classificarLugarDaBatida(
  batida: BatidaComLugar | null | undefined,
  unidadeDaEscalaId: string | null | undefined,
): LugarDaBatida {
  const uni = batida?.unidade_id
  if (!uni || !unidadeDaEscalaId || uni === unidadeDaEscalaId) {
    return { outraUnidade: false, rotulo: null }
  }
  const nome = batida?.unidade_nome || 'outra unidade'
  const relogio = batida?.dispositivo_nome
  return { outraUnidade: true, rotulo: relogio ? `${nome} · ${relogio}` : nome }
}
