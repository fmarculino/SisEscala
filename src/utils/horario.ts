/**
 * Fonte unica de exibicao de data e hora do SisEscala.
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *   `new Date(iso).toLocaleTimeString('pt-BR')` usa o fuso da MAQUINA de quem abriu a tela.
 *   Num sistema de ponto isso significa que a mesma batida aparece com horarios diferentes
 *   conforme o computador — e o servidor publico nao tem como saber qual esta certo.
 *
 *   Caso real (23/08/2026): AGNA (mat. 205), 10/08/2026. A batida gravada e
 *   `2026-08-10T11:03:40+00:00`, ou seja, 08:03:40 em Maraba. A folha de ponto mostrava 08:03
 *   (formata com timeZone) e o tooltip da grade mostrava 11:03 (nao formatava). Duas telas do
 *   mesmo sistema, a mesma batida, tres horas de diferenca.
 *
 *   Medido na mesma data: 96 formatacoes em src/ sem timeZone contra 56 com. Das 96, 45 exibiam
 *   HORA de timestamp e 22 exibiam DATA de timestamp (essas podem errar o DIA inteiro — a
 *   armadilha 12 do CLAUDE.md: as ultimas 3 horas de todo dia ja sao "amanha" em UTC).
 *
 * O FUSO VEM DA CONFIGURACAO GLOBAL, NAO DE UM LITERAL
 *   `configuracoes_globais.timezone` sempre existiu e as funcoes PL/pgSQL sempre a respeitaram;
 *   o frontend e que nunca a leu. O layout raiz publica o valor em `window.__SISESCALA_TZ__`
 *   (server -> HTML, sem fetch e sem piscar) e `definirTimezone` alimenta o cache do lado do
 *   servidor. Sem nada disso, cai em TIMEZONE_PADRAO.
 *
 * ⚠️ DATA PURA (`'2026-08-10'`) NAO E TIMESTAMP E NAO PODE SER CONVERTIDA.
 *   `new Date('2026-08-10')` e meia-noite UTC; convertido para America/Sao_Paulo vira 09/08.
 *   Data de calendario (nascimento, inicio de afastamento, feriado) e um dia do calendario, nao
 *   um instante — por isso `formatarData` detecta a forma `YYYY-MM-DD` e a formata sem
 *   conversao nenhuma. Trocar isso por conversao volta a errar o dia por um, em massa.
 */

/** Usado quando a configuracao global ainda nao chegou. E o valor real de producao. */
export const TIMEZONE_PADRAO = 'America/Sao_Paulo'

declare global {
  interface Window { __SISESCALA_TZ__?: string }
}

/** Cache do lado do servidor. No cliente quem manda e window.__SISESCALA_TZ__. */
let timezoneServidor: string | null = null

/** Alimenta o cache do servidor. Chamado pelo layout raiz a cada render (barato). */
export function definirTimezone(tz: string | null | undefined): void {
  if (tz && typeof tz === 'string') timezoneServidor = tz
}

export function obterTimezone(): string {
  if (typeof window !== 'undefined' && window.__SISESCALA_TZ__) return window.__SISESCALA_TZ__
  return timezoneServidor || TIMEZONE_PADRAO
}

/** `'2026-08-10'` e data de calendario; `'2026-08-10T11:03:40+00:00'` e instante. */
const EH_DATA_PURA = /^\d{4}-\d{2}-\d{2}$/

export type EntradaData = string | number | Date | null | undefined

function paraDate(v: EntradaData): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Devolve STRING, vazia quando nao ha valor — nunca null.
 *
 * Os ~120 sitios substituidos por estas funcoes ja tratavam a ausencia ANTES de formatar
 * (`x ? new Date(x).toLocale... : '—'`), entao string vazia preserva o comportamento e o tipo.
 * Devolver null obrigaria a mexer em cada JSX e mudaria a UI sem necessidade.
 */
function fmt(v: EntradaData, opts: Intl.DateTimeFormatOptions, tz?: string): string {
  const d = paraDate(v)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', { ...opts, timeZone: tz || obterTimezone() }).format(d)
  } catch {
    return ''
  }
}

/** `HH:MM` no fuso do sistema. */
export const formatarHora = (v: EntradaData, tz?: string) =>
  fmt(v, { hour: '2-digit', minute: '2-digit' }, tz)

/**
 * `HH:MM:SS` no fuso do sistema.
 * Os segundos sao de proposito onde distinguem batida real de horario sintetico (armadilha 5).
 */
export const formatarHoraComSegundos = (v: EntradaData, tz?: string) =>
  fmt(v, { hour: '2-digit', minute: '2-digit', second: '2-digit' }, tz)

/**
 * `DD/MM/AAAA`. Data pura (`YYYY-MM-DD`) sai sem conversao de fuso — ver o aviso no topo.
 */
export function formatarData(v: EntradaData, tz?: string): string {
  if (typeof v === 'string' && EH_DATA_PURA.test(v)) {
    const [a, m, d] = v.split('-')
    return `${d}/${m}/${a}`
  }
  return fmt(v, { day: '2-digit', month: '2-digit', year: 'numeric' }, tz)
}

/** `DD/MM`. Data pura sai sem conversao. */
export function formatarDataCurta(v: EntradaData, tz?: string): string {
  if (typeof v === 'string' && EH_DATA_PURA.test(v)) {
    const [, m, d] = v.split('-')
    return `${d}/${m}`
  }
  return fmt(v, { day: '2-digit', month: '2-digit' }, tz)
}

/** `DD/MM/AAAA HH:MM`. */
export const formatarDataHora = (v: EntradaData, tz?: string) =>
  fmt(v, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, tz)

/** `DD/MM/AAAA HH:MM:SS`. */
export const formatarDataHoraComSegundos = (v: EntradaData, tz?: string) =>
  fmt(v, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }, tz)

/** `DD/MM HH:MM` — para listas apertadas. */
export const formatarDataHoraCurta = (v: EntradaData, tz?: string) =>
  fmt(v, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }, tz)

/** `segunda-feira, 10 de agosto`. Data pura vira meio-dia local para nao escorregar de dia. */
export function formatarDataExtenso(v: EntradaData, tz?: string): string {
  const alvo = typeof v === 'string' && EH_DATA_PURA.test(v) ? `${v}T12:00:00` : v
  return fmt(alvo, { weekday: 'long', day: '2-digit', month: 'long' }, tz)
}

/**
 * Partes da data JA no fuso do sistema. Use no lugar de `getDate()/getHours()`, que leem o fuso
 * do processo — e o container do Coolify roda em UTC (armadilha 12).
 */
export function partesLocais(v: EntradaData, tz?: string) {
  const d = paraDate(v)
  if (!d) return null
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || obterTimezone(),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => Number(p.find(x => x.type === t)?.value)
  const hora = g('hour')
  return {
    ano: g('year'), mes: g('month'), dia: g('day'),
    // Intl pode devolver 24 para meia-noite em algumas engines; normaliza.
    hora: hora === 24 ? 0 : hora,
    minuto: g('minute'), segundo: g('second'),
  }
}

/** `YYYY-MM-DD` no fuso do sistema — a data de dominio de um instante. */
export function dataISOLocal(v: EntradaData, tz?: string): string | null {
  const p = partesLocais(v, tz)
  if (!p) return null
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`
}

/** Minutos desde a meia-noite, no fuso do sistema. */
export function minutosLocais(v: EntradaData, tz?: string): number | null {
  const p = partesLocais(v, tz)
  return p ? p.hora * 60 + p.minuto : null
}
