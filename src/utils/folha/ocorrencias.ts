/**
 * Ocorrências do VERSO da folha de ponto — fonte única (27/08/2026).
 *
 * O verso é o "Relatório detalhado de justificativas e tratamentos de ocorrências". Ele estava
 * listando um dia por linha sempre que `registro.observacao` tinha qualquer conteúdo — e a
 * geração da folha PREENCHE essa observação sozinha com `SÁBADO`, `DOMINGO` e `FOLGA` para todo
 * dia sem escala (`folha-ponto/actions.ts`, ramo `!shift`).
 *
 * Resultado medido nas 482 folhas de 08/2026: **11.505 linhas, das quais 6.216 eram fim de
 * semana e folga** — 54% do documento. Pior que o volume: essas linhas saíam com origem
 * "Gestão / Coordenação", ou seja, o relatório afirmava que alguém justificou o que ninguém
 * justificou.
 *
 * ⚠️ A regra vale para as DUAS cópias do verso: o editor da folha (`FolhaPontoEditor.tsx`) e a
 * impressão em lote (`folha-ponto/page.tsx`), que tinham critérios diferentes entre si.
 */

/** Rótulos que a própria geração escreve para dia sem escala. Não são justificativa de ninguém. */
const OBSERVACOES_AUTOMATICAS = new Set(['SÁBADO', 'SABADO', 'DOMINGO', 'FOLGA'])

const ORIGENS_DE_AJUSTE = ['manual', 'ajuste_coordenador', 'ajuste_servidor']

export interface RegistroFolha {
  dia: number
  entrada?: string | null
  saida?: string | null
  saida_intervalo?: string | null
  retorno_intervalo?: string | null
  observacao?: string | null
  afastamento?: string | null
  feriado?: boolean
  ponto_facultativo?: boolean
  jornada_temporaria?: boolean
  jornada_nome?: string | null
  origem_entrada?: string | null
  origem_saida?: string | null
  origem_saida_intervalo?: string | null
  origem_retorno_intervalo?: string | null
}

export interface OcorrenciaFolha {
  dia: number
  dia_semana: string
  data_formatada: string
  tipo: string
  passo: string
  justificativa: string
  origem: string
}

/**
 * O que sobra de uma observação depois de tirar o rótulo automático, ou `null` se não sobrar
 * nada.
 *
 * A geração concatena o texto humano com o rótulo (`AFASTAMENTO PARCIAL: X | SÁBADO`), então
 * descartar a observação inteira perderia a parte que alguém escreveu.
 */
export function observacaoHumana(observacao?: string | null): string | null {
  if (!observacao) return null

  const partes = observacao
    .split('|')
    .map(p => p.trim())
    .filter(p => p.length > 0 && !OBSERVACOES_AUTOMATICAS.has(p.toUpperCase()))

  return partes.length > 0 ? partes.join(' | ') : null
}

const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

/**
 * As ocorrências que merecem uma linha no verso.
 *
 * Entra o que **alguém decidiu ou registrou**:
 *   - afastamento (RH/gestão lançou);
 *   - ajuste manual de qualquer passo (coordenador ou servidor);
 *   - observação escrita por pessoa;
 *   - jornada temporária (ordem de serviço).
 *
 * ⚠️ Feriado e ponto facultativo entram **apenas quando houve trabalho no dia** — aí a ocorrência
 * é relevante (trabalhou em dia não útil) e precisa constar. Feriado em que ninguém trabalhou é
 * calendário, não tratamento: a frente da folha já mostra o dia, e repetir no verso só empurra a
 * informação real para a página seguinte. Em 08/2026 isso eram 451 linhas.
 *
 * ⚠️ Fim de semana e folga nunca entram.
 */
export function ocorrenciasDoMes(
  registros: RegistroFolha[],
  mes: number,
  ano: number
): OcorrenciaFolha[] {
  const lista: OcorrenciaFolha[] = []

  for (const r of registros || []) {
    // ⚠️ `new Date(ano, mes - 1, dia)` é construção local, não conversão de ISO — imune ao
    // problema de fuso da armadilha 12 do CLAUDE.md.
    const data = new Date(ano, mes - 1, r.dia)
    const diaSemana = DIAS_SEMANA[data.getDay()]
    const dataFormatada = `${String(r.dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`
    const base = { dia: r.dia, dia_semana: diaSemana, data_formatada: dataFormatada }

    const humana = observacaoHumana(r.observacao)
    const trabalhou = !!(r.entrada || r.saida)

    if (r.afastamento) {
      lista.push({
        ...base,
        tipo: 'Afastamento / Atestado',
        passo: 'Dia Integral',
        justificativa: humana || r.afastamento,
        origem: 'Registro de RH / Gestão',
      })
    } else if ((r.feriado || r.ponto_facultativo) && trabalhou) {
      lista.push({
        ...base,
        tipo: r.feriado ? 'Trabalho em Feriado' : 'Trabalho em Ponto Facultativo',
        passo: `${r.entrada || '--:--'} às ${r.saida || '--:--'}`,
        justificativa: humana || (r.feriado ? 'Trabalho realizado em feriado' : 'Trabalho realizado em ponto facultativo'),
        origem: 'Calendário Oficial',
      })
    }

    const passosAjustados: string[] = []
    if (ORIGENS_DE_AJUSTE.includes(r.origem_entrada || '')) passosAjustados.push(`Entrada (${r.entrada || '--:--'})`)
    if (ORIGENS_DE_AJUSTE.includes(r.origem_saida_intervalo || '')) passosAjustados.push(`Saída Int. (${r.saida_intervalo || '--:--'})`)
    if (ORIGENS_DE_AJUSTE.includes(r.origem_retorno_intervalo || '')) passosAjustados.push(`Retorno Int. (${r.retorno_intervalo || '--:--'})`)
    if (ORIGENS_DE_AJUSTE.includes(r.origem_saida || '')) passosAjustados.push(`Saída (${r.saida || '--:--'})`)

    if (passosAjustados.length > 0) {
      lista.push({
        ...base,
        tipo: 'Inclusão / Ajuste Manual de Ponto',
        passo: passosAjustados.join(', '),
        justificativa: humana || 'Esquecimento de registro / Atividade externa autorizada',
        origem: 'Ajuste Manual Homologado',
      })
    } else if (humana && !r.afastamento && !r.feriado && !r.ponto_facultativo) {
      lista.push({
        ...base,
        tipo: 'Observação / Justificativa',
        passo: r.entrada && r.saida ? `${r.entrada} às ${r.saida}` : 'Jornada',
        justificativa: humana,
        origem: 'Gestão / Coordenação',
      })
    }

    if (r.jornada_temporaria) {
      lista.push({
        ...base,
        tipo: 'Jornada Temporária',
        passo: r.jornada_nome || 'Horário Especial',
        justificativa: `Cumprimento em escala/jornada autorizada: ${r.jornada_nome || ''}`,
        origem: 'Ordem de Serviço / Portaria',
      })
    }
  }

  return lista.sort((a, b) => a.dia - b.dia)
}
