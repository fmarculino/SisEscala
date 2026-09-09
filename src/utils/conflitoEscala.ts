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
 * ⚠️ Desde 09/09/2026 o raciocínio é por **pessoa**, não por matrícula. `servidores` é
 * "1 linha = 1 vínculo" e a mesma pessoa pode ter duas matrículas (duplo vínculo) — são dois
 * `servidor_id`, então a checagem por id simplesmente não enxergava o caso. Foi assim que
 * EDILEUZA (mat 67454 e 15892) ficou com dois plantões `N` simultâneos no mesmo setor em
 * 01/09/2026. `idsDaPessoa` vem de `fn_cadastros_irmaos` e é o conjunto de cadastros Ativos
 * com o mesmo CPF; para quem não tem irmão (2.477 dos 2.498 Ativos) nada muda.
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
  /** Preenchido quando o conflito vem de OUTRA matrícula da mesma pessoa. */
  outraMatricula?: boolean
}

/**
 * Os cadastros que são a MESMA PESSOA que `servidorId` — ele próprio incluído.
 * Sem o mapa (ou sem entrada para o servidor), cai no comportamento antigo: só ele.
 */
export type IdsDaPessoa = Record<string, string[] | undefined>

function idsDoServidor(idsDaPessoa: IdsDaPessoa | null | undefined, servidorId: string): string[] {
  const irmaos = idsDaPessoa?.[servidorId]
  if (!irmaos || irmaos.length === 0) return [servidorId]
  return irmaos.includes(servidorId) ? irmaos : [servidorId, ...irmaos]
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
  slots: string[] | null | undefined,
  idsDaPessoa?: IdsDaPessoa | null
): ConflitoExterno | null {
  if (!ocupacao || ocupacao.length === 0) return null
  if (!slots || slots.length === 0) return null

  const daPessoa = idsDoServidor(idsDaPessoa, servidorId)

  const achado = ocupacao.find(o =>
    o &&
    daPessoa.includes(o.servidor_id) &&
    o.dia === dia &&
    // A linha da OUTRA matrícula tem escala_mensal_id diferente por construção, e é
    // justamente ela que precisa conflitar — a exclusão por escala só vale para o mesmo id.
    (o.servidor_id !== servidorId || o.escala_mensal_id !== escalaMensalId) &&
    Array.isArray(o.slots) &&
    o.slots.some(s => slots.includes(s))
  )

  if (!achado) return null

  const outraMatricula = achado.servidor_id !== servidorId
  return {
    dia,
    // Sem dizer que é a outra matrícula, o coordenador procura na grade dele um lançamento
    // que não está lá — está na escala da outra matrícula, que ele pode nem saber que existe.
    descricao: outraMatricula
      ? `outra matrícula desta pessoa já escalada (${achado.descricao_conflito || 'mesmo horário'})`
      : achado.descricao_conflito || 'turno em outro setor no mesmo horário',
    outraMatricula
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
  slots: string[] | null | undefined,
  idsDaPessoa?: IdsDaPessoa | null
): ConflitoExterno[] {
  const out: ConflitoExterno[] = []
  for (let dia = diaInicio; dia <= diaFim; dia++) {
    const c = encontrarConflitoExterno(ocupacao, servidorId, escalaMensalId, dia, slots, idsDaPessoa)
    if (c) out.push(c)
  }
  return out
}
