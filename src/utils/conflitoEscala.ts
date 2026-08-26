/**
 * Sobreposição de escala entre setores — fonte única do frontend.
 *
 * Espelha `fn_prevent_cross_sector_shift_overlap` (migration `20260826220000`) e
 * `fn_check_shift_conflicts`. **O banco é quem decide**: este módulo existe para a recusa chegar
 * como "dia 3 do FAGNER já está no PATRIMÔNIO" em vez de uma exceção crua do Postgres que
 * derruba o upsert em lote inteiro do "Salvar Previsão" — a mesma razão de existir de
 * `src/utils/afastamentos.ts`.
 *
 * ⚠️ Medido em 26/08/2026: `fn_check_shift_conflicts` tinha UM ÚNICO chamador em todo o
 * repositório (`handleCellChange`), então só a digitação célula a célula era validada. Aplicar
 * Template e Gerador Inteligente escrevem direto no `gridData` e passaram anos sem consultar
 * nada — 24 pares (servidor, dia) em dois setores no mesmo horário, com a mesma batida
 * projetada nas duas linhas e duas folhas contando o mesmo tempo. Ao acrescentar um caminho
 * novo de escrita na grade, chame daqui.
 *
 * O critério é **slot sobreposto**, nunca "mesmo dia": dobra em outro setor é caso real e
 * legítimo (Regular `MT` num setor + Plantão `N` noutro não se cruzam). Ver armadilha 15.
 */

/** Uma linha de `fn_get_monthly_occupancy` — a ocupação do servidor em OUTRAS escalas do mês. */
export interface OcupacaoExterna {
  servidor_id: string
  dia: number
  escala_mensal_id: string
  categoria?: string | null
  slots?: string[] | null
  descricao_conflito?: string | null
}

export interface ConflitoExterno {
  dia: number
  descricao: string
}

/**
 * Devolve o conflito de sobreposição para uma célula, ou `null`.
 *
 * @param ocupacao        saída de `fn_get_monthly_occupancy` (a grade já a carrega no mount)
 * @param servidorId      servidor da linha
 * @param escalaMensalId  a escala DESTA grade — as linhas dela são excluídas da busca, senão a
 *                        célula conflitaria com ela mesma (foi o bug de `20260821100000`)
 * @param dia             dia do mês
 * @param slots           slots do turno que se quer lançar
 */
export function encontrarConflitoExterno(
  ocupacao: OcupacaoExterna[] | null | undefined,
  servidorId: string,
  escalaMensalId: string | null | undefined,
  dia: number,
  slots: string[] | null | undefined
): ConflitoExterno | null {
  if (!ocupacao || ocupacao.length === 0) return null
  if (!slots || slots.length === 0) return null

  const achado = ocupacao.find(o =>
    o &&
    o.servidor_id === servidorId &&
    o.dia === dia &&
    o.escala_mensal_id !== escalaMensalId &&
    Array.isArray(o.slots) &&
    o.slots.some(s => slots.includes(s))
  )

  if (!achado) return null

  return {
    dia,
    descricao: achado.descricao_conflito || 'turno em outro setor no mesmo horário'
  }
}

/**
 * Varre um intervalo de dias e devolve os que estão bloqueados por sobreposição.
 * Usado por Aplicar Template e Gerador Inteligente, que escrevem vários dias de uma vez.
 */
export function diasComConflitoExterno(
  ocupacao: OcupacaoExterna[] | null | undefined,
  servidorId: string,
  escalaMensalId: string | null | undefined,
  diaInicio: number,
  diaFim: number,
  slots: string[] | null | undefined
): ConflitoExterno[] {
  const out: ConflitoExterno[] = []
  for (let dia = diaInicio; dia <= diaFim; dia++) {
    const c = encontrarConflitoExterno(ocupacao, servidorId, escalaMensalId, dia, slots)
    if (c) out.push(c)
  }
  return out
}
