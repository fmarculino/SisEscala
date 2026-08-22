/**
 * Decomposição de um código de plantão nas UNIDADES DE PAGAMENTO — fonte única.
 *
 * As colunas da grade são PL12, PL6 e PL4, e só. Não existe PL24 nem PL18 porque nenhum
 * plantão é pago assim: todo plantão é convertido nessas três unidades. Um `MTN` (24h) é um
 * plantão de 24 horas corridas que o RH paga como DOIS de 12h; um `TN` (18h) é uma tarde de 6h
 * emendada na noite de 12h. (Regra confirmada pelo usuário em 21/08/2026.)
 *
 * O QUE ESTAVA ERRADO ATÉ AQUI
 *   `calculateTotals` classificava o código inteiro por faixa (`>=12 -> PL12`, `>=6 -> PL6`,
 *   senão `PL4`) e depois multiplicava pela FAIXA, não pelas horas. Consequências medidas
 *   contra o dicionário: 44 dos 53 códigos de plantão contavam errado — `MTN` valia 12h em vez
 *   de 24, `TN` valia 12h em vez de 18 — e nove códigos curtos contavam PARA CIMA (`N1`, de 1h,
 *   valia 4h). Todos os relatórios (RH, consolidado, plantão/sobreaviso) já somavam
 *   `horas_computadas` direto, então a grade discordava deles na mesma competência.
 *
 * COMO FUNCIONA
 *   1. `pedacosDoPlantao` quebra o código na sua estrutura real de períodos, seguindo as mesmas
 *      âncoras de `dicionario_turnos.horario_inicio` (M = 07-13, T = 13-19, N = 19-07, I = 11-15):
 *      `TN` -> [6, 12]; `MTN` -> [12, 12]; `M4N` -> [4, 12]; `MT4` -> [6, 4].
 *   2. Cada pedaço vira unidades, do maior para o menor. O que sobrar não vira unidade nenhuma:
 *      **nunca arredondar para cima uma unidade que não foi trabalhada.** As horas soltas entram
 *      no TOTAL (que passa a ser exato), só não são contadas como plantão pago.
 *
 * ⚠️ Medido em produção em 21/08/2026 (636 lançamentos de Plantão, competências 06 a 08/2026):
 *    só 10 códigos em uso — MT(355) T(90) T4(81) M(66) N6(15) N(11) N4(11) MTN(3) TN(3) M7(1).
 *    Nove fecham em unidades inteiras; apenas `M7` (7h) deixa 1h solta. Se algum dia entrarem
 *    `N8`/`N9` em uso, a quebra deles merece decisão do RH — 9h dá "PL6 + 3h soltas" por esta
 *    regra, mas "2×PL4 + 1h" desperdiçaria menos. Com um único caso real, não vale inventar.
 */

export interface UnidadesPlantao {
  pl12: number
  pl6: number
  pl4: number
  /** Horas que não formam unidade de pagamento. Entram no total, em nenhuma coluna. */
  horasAvulsas: number
  /** Sempre igual a `horas_computadas` do código: nenhuma hora se perde nem se inventa. */
  horasTotal: number
}

/**
 * Quebra o código nos períodos que ele realmente cobre, em horas.
 * Devolve `null` para código sem estrutura conhecida — o chamador cai no total bruto.
 */
export function pedacosDoPlantao(codigo: string, horas: number): number[] | null {
  const c = (codigo || '').toUpperCase().trim()
  if (!c) return null

  // Unidades canônicas
  if (c === 'N' || c === 'MT') return [12]
  if (c === 'M' || c === 'T') return [6]
  if (c === 'I') return [4]

  // Combinados canônicos. MTN é MT + N (dois de 12h), não M + T + N.
  if (c === 'MTN') return [12, 12]
  if (c === 'TN' || c === 'MN') return [6, 12]
  if (c === 'IT4' || c === 'M4I') return [4, 4]

  // Famílias numéricas. A noite completa vale 12h; o número é a duração do outro período.
  // Precisa vir ANTES dos testes de período isolado, senão M4N cairia em "M seguido de dígitos".
  let m = c.match(/^([MT])([0-9]+)N$/)
  if (m) return [Number(m[2]), 12]

  // MT<n> = manhã inteira (6h) + <n> horas de tarde. MT4 = 07-17 = 6 + 4.
  m = c.match(/^MT([0-9]+)$/)
  if (m) return [6, Number(m[1])]

  // Período isolado com duração explícita: M7, T4, N9...
  m = c.match(/^([MTN])([0-9]+)$/)
  if (m) return [Number(m[2])]

  return null
}

/**
 * Converte um pedaço de jornada nas unidades de pagamento, da maior para a menor.
 * O resto NÃO vira unidade — ver o comentário do topo.
 */
function unidadesDoPedaco(horas: number): { pl12: number; pl6: number; pl4: number; resto: number } {
  let resto = Math.max(0, horas)
  const pl12 = Math.floor(resto / 12); resto -= pl12 * 12
  const pl6 = Math.floor(resto / 6); resto -= pl6 * 6
  const pl4 = Math.floor(resto / 4); resto -= pl4 * 4
  return { pl12, pl6, pl4, resto }
}

/**
 * Decompõe um plantão nas unidades de pagamento.
 *
 * @param codigo código do dicionário (`TN`, `MTN`, `M7`...)
 * @param horas  `dicionario_turnos.horas_computadas` — é ele quem manda no total, sempre.
 */
export function decomporPlantao(codigo: string, horas: number): UnidadesPlantao {
  const horasTotal = Number(horas) || 0
  const pedacos = pedacosDoPlantao(codigo, horasTotal)

  // Sem estrutura conhecida (hoje só MT4N, 22h, que o CLAUDE.md já registra como o único código
  // sem definição): quebra pelo total bruto. Continua exato em horas, mesmo sem saber os períodos.
  const partes = pedacos && pedacos.reduce((a, b) => a + b, 0) === horasTotal ? pedacos : [horasTotal]

  const acc: UnidadesPlantao = { pl12: 0, pl6: 0, pl4: 0, horasAvulsas: 0, horasTotal }
  for (const p of partes) {
    const u = unidadesDoPedaco(p)
    acc.pl12 += u.pl12
    acc.pl6 += u.pl6
    acc.pl4 += u.pl4
    acc.horasAvulsas += u.resto
  }
  return acc
}
