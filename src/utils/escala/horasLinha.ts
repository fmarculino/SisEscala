/**
 * Fonte unica de "quantas horas vale UMA linha de escala_diaria".
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *   A mesma pergunta era respondida por tres codigos diferentes, com DUAS respostas:
 *
 *     calculateTotals (ScaleGrid.tsx)      -> Regular liquido (desconta o intervalo)
 *     /relatorios/consolidado              -> Regular liquido
 *     /home (Comparativo Historico)        -> Regular BRUTO
 *
 *   Medido em producao em 05/09/2026, competencia 09/2026: o painel exibia **163.392h** de
 *   Regular onde a grade, o consolidado e a folha diziam **126.169h**. **37.223h de diferenca
 *   (22,8%)** na mesma competencia, entre duas telas do mesmo sistema — e o numero maior era o
 *   do painel, que e justamente a tela de decisao administrativa.
 *
 * 🚨 `jornadas.horas_totais` E O VAO DO RELOGIO, NAO O TEMPO DE TRABALHO (armadilha 46).
 *   "08H AS 18H" tem `horas_totais = 10` e `intervalo_minutos = 120`. Somar o bruto conta o
 *   almoco como jornada. Base legal em src/utils/folha/cargaDiaria.ts — Portaria
 *   382/2019-GAB-MAB/SMS Art. 3 I, Lei 17.331/2008 Art. 17 e CLT Art. 71 §2.
 *
 * ⚠️ O TETO E `LEAST`, NUNCA SUBSTITUICAO. Turno reduzido (M4 = 4h) vale as 4h dele; turno longo
 *   (MT = 12h) e limitado ao liquido da jornada. Trocar por "usa sempre o liquido da jornada"
 *   inflaria todo meio periodo.
 *
 * ⚠️ SO `Regular` TEM TETO DE JORNADA. Plantao e Extra valem `horas_computadas` cheio — sao
 *   trabalho ALEM do expediente, e limita-los pela jornada regular apagaria exatamente as horas
 *   que precisam ser pagas.
 *
 * ⚠️ NAO REPLIQUE `decomporPlantao` (armadilha 16) AQUI. As unidades PL12/PL6/PL4 existem para as
 *   COLUNAS de pagamento; o TOTAL de horas e `horas_computadas` somado, que e o que
 *   `fn_carga_mensal_servidor` faz no banco. Somar por faixa de duracao reintroduziria o bug de
 *   21/08/2026, em que 44 dos 53 codigos de plantao contavam errado.
 */

/** So os campos de jornada que este modulo le. */
export interface JornadaHoras {
  horas_totais?: number | string | null
  intervalo_minutos?: number | string | null
}

/** Categorias de escala_diaria. `Sobreaviso` entra aqui so para poder ser tratado explicitamente. */
export type CategoriaEscala = 'Regular' | 'Plantão' | 'Extra' | 'Sobreaviso' | string

/**
 * Teto liquido diario da jornada: o vao menos o intervalo.
 * Devolve `null` quando a jornada nao da para resolver — e ai NAO ha teto a aplicar, que e o
 * unico fallback honesto (inventar 8h mudaria a conta de quem tem jornada de 6h ou 12h).
 */
export function tetoLiquidoJornada(jornada: JornadaHoras | null | undefined): number | null {
  const bruto = Number(jornada?.horas_totais)
  if (!Number.isFinite(bruto) || bruto <= 0) return null
  const intervalo = (Number(jornada?.intervalo_minutos) || 0) / 60
  // Nunca negativo: cadastro com intervalo maior que a jornada existe como zero, nao como
  // desconto sobre outra linha.
  return Math.max(0, bruto - intervalo)
}

/**
 * Horas de uma linha de escala_diaria, ja aplicada a regra da categoria.
 *
 * `Sobreaviso` devolve 0 de proposito: prontidao nao e trabalho presencial, nao entra na carga
 * (`fn_carga_mensal_servidor` e `calculateTotals` tambem a excluem) e tem ciclo proprio em
 * `logs_sobreaviso`. Quem quiser exibir sobreaviso soma `horas_computadas` a parte, com rotulo
 * proprio — nunca no mesmo total das horas trabalhadas.
 */
export function horasDaLinhaEscala(
  categoria: CategoriaEscala,
  horasComputadas: number | string | null | undefined,
  jornada: JornadaHoras | null | undefined
): number {
  const horas = Number(horasComputadas)
  if (!Number.isFinite(horas) || horas <= 0) return 0
  if (categoria === 'Sobreaviso') return 0
  if (categoria !== 'Regular') return horas
  const teto = tetoLiquidoJornada(jornada)
  return teto === null ? horas : Math.min(horas, teto)
}

/**
 * Horas de PRONTIDAO de uma linha de Sobreaviso — contadas a parte, nunca somadas as de cima.
 *
 * ⚠️ O fallback por codigo (`MTN` = 24h, `MT`/`N` = 12h) vem do /relatorios/consolidado e existe
 * porque ha codigo de sobreaviso cadastrado com `horas_computadas = 0`. Mantido para o painel e
 * o relatorio darem o mesmo numero; se o cadastro for corrigido, este ramo simplesmente para de
 * ser alcancado.
 */
export function horasProntidaoSobreaviso(
  horasComputadas: number | string | null | undefined,
  codigo?: string | null
): number {
  const horas = Number(horasComputadas)
  if (Number.isFinite(horas) && horas > 0) return horas
  if (codigo === 'MTN') return 24
  if (codigo === 'MT' || codigo === 'N') return 12
  return 0
}
