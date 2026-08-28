/**
 * Teto mensal de horas e sobreavisos — a conta é da PESSOA, não da grade.
 *
 * `configuracoes_globais.max_horas_escala_servidor` (300h) sempre foi um limite do servidor no
 * mês, com Autorização Extraordinária de administrador para ultrapassá-lo. Mas a única conta que
 * o defendia era `calculateTotals(servidorId)` em `ScaleGrid.tsx`, que soma o `gridData` **daquele
 * setor**. Servidor escalado em dois lugares tinha duas contas dentro do teto e uma soma fora dele.
 *
 * Caso real medido em produção em 28/08/2026: JEANE CONCEICAO SILVA, 09/2026, HMI —
 * `SHL \ ACOLHIMENTO` 289h + `SHL \ LAVANDERIA` 120h = **409h**, com as duas telas mostrando um
 * número dentro do teto. Mais dois iguais na mesma competência, e 49 servidores em 2+ escalas em
 * 09/2026 contra 2 ou 3 nos meses anteriores — o caso explodiu no planejamento de setembro.
 *
 * ⚠️ **O banco é quem tem a conta**: `fn_carga_mensal_servidor` (migration `20260828120000`) é a
 * fonte única, e este módulo só a combina com o que está sendo lançado na grade viva. Ao mexer na
 * fórmula de horas, mexa lá e em `calculateTotals` — nunca aqui.
 *
 * ⚠️ Este módulo é **puro** (sem React, sem Supabase) para ter portão: `scratchpad/sim_limite_carga.js`.
 */

/** Uma linha de `fn_carga_mensal_servidor` — a carga do servidor em UMA escala da competência. */
export interface CargaEscala {
  escala_mensal_id: string
  unidade_nome: string
  setor_caminho: string
  status: string
  horas: number
  sobreavisos: number
}

/** Saída de `fn_teto_carga_servidor` — o teto efetivo já com a Autorização Extraordinária somada. */
export interface TetoServidor {
  servidor_id?: string
  teto_horas: number
  teto_sobreavisos: number
  limite_global_horas: number
  limite_global_sobreavisos: number
  horas_autorizadas: number
  sobreavisos_autorizados: number
  motivo_justificativa?: string | null
}

export interface AvaliacaoCarga {
  /** Horas da grade viva (a escala desta tela). */
  horasLocais: number
  /** Horas somadas de todas as OUTRAS escalas do servidor na competência. */
  horasOutras: number
  /** `horasLocais + horasOutras`. É este número que o teto defende. */
  totalHoras: number
  sobreavisosLocais: number
  sobreavisosOutras: number
  totalSobreavisos: number
  tetoHoras: number
  tetoSobreavisos: number
  excedeHoras: boolean
  excedeSobreavisos: boolean
  excede: boolean
  /** As outras escalas, da maior carga para a menor. Vazio no caso comum. */
  outras: CargaEscala[]
}

export const TETO_HORAS_PADRAO = 300
export const TETO_SOBREAVISOS_PADRAO = 10

/**
 * Teto efetivo a partir da resposta de `fn_teto_carga_servidor`. Existe para a tela nunca voltar a
 * montar `global + excecao` por conta própria — foi assim que o teto passou um ano sendo o da
 * unidade em vez do da pessoa.
 */
export function tetoEfetivo(teto?: TetoServidor | null): { horas: number; sobreavisos: number } {
  return {
    horas: Number(teto?.teto_horas ?? TETO_HORAS_PADRAO),
    sobreavisos: Number(teto?.teto_sobreavisos ?? TETO_SOBREAVISOS_PADRAO),
  }
}

/**
 * Soma a grade viva com as outras escalas do servidor e diz se o teto foi ultrapassado.
 *
 * ⚠️ **A escala DESTA grade é excluída de `cargas` e substituída por `horasLocais`.** O banco tem o
 * que foi salvo; a grade tem o que está sendo lançado. Somar os dois conta o mesmo turno duas
 * vezes — é o mesmo motivo de `encontrarConflitoExterno` receber `escalaMensalId`.
 *
 * @param horasLocais          `calculateTotals().totalPlanejado` da grade
 * @param sobreavisosLocais    `calculateTotals().p_soQtd` da grade
 * @param cargas               saída de `fn_carga_mensal_servidor` para este servidor
 * @param escalaMensalIdAtual  a escala desta grade; `null` quando o servidor ainda não foi adicionado
 * @param teto                 saída de `fn_teto_carga_servidor`
 */
export function avaliarCarga(args: {
  horasLocais: number
  sobreavisosLocais: number
  cargas: CargaEscala[] | null | undefined
  escalaMensalIdAtual: string | null | undefined
  teto?: TetoServidor | null
}): AvaliacaoCarga {
  const { horas: tetoHoras, sobreavisos: tetoSobreavisos } = tetoEfetivo(args.teto)

  const outras = (args.cargas || [])
    .filter(c => c && c.escala_mensal_id !== args.escalaMensalIdAtual)
    .filter(c => Number(c.horas) > 0 || Number(c.sobreavisos) > 0)
    .map(c => ({ ...c, horas: Number(c.horas) || 0, sobreavisos: Number(c.sobreavisos) || 0 }))
    .sort((a, b) => b.horas - a.horas || a.unidade_nome.localeCompare(b.unidade_nome))

  const horasLocais = Number(args.horasLocais) || 0
  const sobreavisosLocais = Number(args.sobreavisosLocais) || 0
  const horasOutras = outras.reduce((acc, c) => acc + c.horas, 0)
  const sobreavisosOutras = outras.reduce((acc, c) => acc + c.sobreavisos, 0)

  const totalHoras = horasLocais + horasOutras
  const totalSobreavisos = sobreavisosLocais + sobreavisosOutras
  const excedeHoras = totalHoras > tetoHoras
  const excedeSobreavisos = totalSobreavisos > tetoSobreavisos

  return {
    horasLocais,
    horasOutras,
    totalHoras,
    sobreavisosLocais,
    sobreavisosOutras,
    totalSobreavisos,
    tetoHoras,
    tetoSobreavisos,
    excedeHoras,
    excedeSobreavisos,
    excede: excedeHoras || excedeSobreavisos,
    outras,
  }
}

/** `309` → `"309"`, `309.5` → `"309,5"`. A grade nunca imprimiu casa decimal desnecessária. */
export function formatarHoras(h: number): string {
  const n = Math.round((Number(h) || 0) * 100) / 100
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

/**
 * Uma linha por escala externa: `HMI - Hospital Materno Infantil / SHL \ ACOLHIMENTO — 289h`.
 *
 * O caminho completo do setor é obrigatório aqui: "BLOCO A" existe embaixo de mais de um pai, e
 * dizer só a folha faz o coordenador procurar no lugar errado.
 */
export function descreverEscalas(outras: CargaEscala[]): string[] {
  return outras.map(c => {
    const partes: string[] = []
    if (c.horas > 0) partes.push(`${formatarHoras(c.horas)}h`)
    if (c.sobreavisos > 0) partes.push(`${c.sobreavisos} un de sobreaviso`)
    return `• ${c.unidade_nome} / ${c.setor_caminho} — ${partes.join(' e ')}${c.status === 'Fechada' ? ' (escala Fechada)' : ''}`
  })
}

/**
 * O texto que explica o excesso e **onde ele está** — o coordenador da LAVANDERIA precisa saber
 * que as outras 289h estão no ACOLHIMENTO, senão não tem como decidir nada.
 *
 * Recebe a simulação (o total que o lançamento produziria), não o total atual.
 */
export function descreverExcesso(a: AvaliacaoCarga, servidorNome: string): string {
  const linhas: string[] = []

  if (a.excedeHoras) {
    linhas.push(
      `${servidorNome} chegaria a ${formatarHoras(a.totalHoras)}h no mês — o teto é ${formatarHoras(a.tetoHoras)}h.`
    )
  }
  if (a.excedeSobreavisos) {
    linhas.push(
      `${servidorNome} chegaria a ${a.totalSobreavisos} unidades de sobreaviso no mês — o teto é ${a.tetoSobreavisos}.`
    )
  }

  if (a.outras.length > 0) {
    linhas.push('')
    linhas.push(`Nesta escala: ${formatarHoras(a.horasLocais)}h${a.sobreavisosLocais > 0 ? ` e ${a.sobreavisosLocais} un de sobreaviso` : ''}.`)
    linhas.push(
      a.outras.length === 1
        ? 'O restante está em outra escala do mesmo mês:'
        : `O restante está em outras ${a.outras.length} escalas do mesmo mês:`
    )
    linhas.push(...descreverEscalas(a.outras))
  }

  return linhas.join('\n')
}

/**
 * Aviso de "esta pessoa já tem carga em outro lugar", para o momento de ADICIONAR o servidor à
 * grade. É onde o aviso custa menos: antes de lançar o mês inteiro dela.
 *
 * Devolve `null` quando não há nada a dizer — o caso comum.
 */
export function avisoAoAdicionar(
  servidorNome: string,
  cargas: CargaEscala[] | null | undefined,
  teto?: TetoServidor | null
): string | null {
  const a = avaliarCarga({
    horasLocais: 0,
    sobreavisosLocais: 0,
    cargas,
    escalaMensalIdAtual: null,
    teto,
  })
  if (a.outras.length === 0) return null

  const restante = a.tetoHoras - a.horasOutras
  const cabecalho = `${servidorNome} já está escalado(a) em ${a.outras.length === 1 ? 'outra escala' : `outras ${a.outras.length} escalas`} neste mês, somando ${formatarHoras(a.horasOutras)}h:`

  const rodape = restante > 0
    ? `Restam ${formatarHoras(restante)}h até o teto de ${formatarHoras(a.tetoHoras)}h.`
    : `O teto de ${formatarHoras(a.tetoHoras)}h já foi alcançado — qualquer turno aqui exige Autorização Extraordinária.`

  return [cabecalho, ...descreverEscalas(a.outras), '', rodape].join('\n')
}
