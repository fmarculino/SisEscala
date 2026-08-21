/**
 * Pendencia de revisao na folha de ponto — o dia INCOMPLETO.
 *
 * O QUE ISTO RESOLVE
 *   A falta automatica (`faltaAutomatica.ts`, 14/08/2026) e tudo-ou-nada: so dispara quando o dia
 *   nao tem NENHUMA marcacao. Basta um passo preenchido para o dia sair da regra — e ai ele fica
 *   sem cor, sem observacao, sem contagem, indistinguivel de um dia normal com celulas vazias.
 *
 *   O plano de 14/08 excluiu a batida parcial dizendo que ela "ja tem tratamento proprio".
 *   Medido em producao em 21/08/2026 (SMS, agosto, 2.307 pares servidor/dia com turno ja
 *   passados): **1.196 dias parciais — 51,8%** — e nao ha tratamento nenhum. A premissa estava
 *   errada.
 *
 * O RECORTE, E POR QUE ELE NAO E "TODO DIA INCOMPLETO"
 *   Dos 1.196, **1.010 sao entrada+saida sem nenhum intervalo**. Marcar todos como pendencia
 *   afogaria o coordenador em aviso e ele ignoraria o conjunto — inclusive os que importam.
 *   O recorte decidido pelo usuario em 21/08/2026 e mais estreito e tem um criterio objetivo:
 *
 *     pendencia so quando falta ENTRADA ou SAIDA — os passos sem os quais NAO DA PARA SABER
 *     QUANTO A PESSOA TRABALHOU.
 *
 *   Eram 151 dias na SMS, contra 1.010 de intervalo faltando. Intervalo ausente continua como
 *   esta: nao impede o calculo da jornada.
 *
 * O QUE ELA NAO FAZ
 *   Nao conta em `total_faltas` (o texto nao contem "FALTA", entao `isFaltaDefinitiva` a ignora
 *   de proposito), nao desconta hora, nao bloqueia nada. Ela SINALIZA. Quem decide continua
 *   sendo o coordenador — Portaria 671/2021, art. 82.
 *
 * COMO SAI DA TELA
 *   Preenchendo o horario que falta (validacao manual ou batida que chegue depois). A pendencia
 *   e recalculada a cada geracao/sincronizacao e nao e preservada, entao ela se cura sozinha —
 *   ao contrario de FALTA, que e preservada explicitamente.
 */

/** Prefixo do texto. Nao pode conter FALTA nem MANUAL — os dois sao lidos por outras regras. */
export const MARCADOR_REVISAR = 'REVISAR:'

export function resolverPendenciaRevisao(opts: {
  /** O dia (calendario local) ja aconteceu. Dia corrente nunca vira pendencia: pode faltar a saida so porque a pessoa ainda esta trabalhando. */
  diaJaPassou: boolean
  /** Ha alguma marcacao no dia. Dia sem nenhuma e FALTA, nao pendencia — as duas regras sao exclusivas. */
  temMarcacao: boolean
  temEntrada: boolean
  temSaida: boolean
}): string | null {
  if (!opts.diaJaPassou) return null
  if (!opts.temMarcacao) return null
  if (opts.temEntrada && opts.temSaida) return null

  if (!opts.temEntrada && !opts.temSaida) return `${MARCADOR_REVISAR} SEM REGISTRO DE ENTRADA E DE SAÍDA`
  if (!opts.temEntrada) return `${MARCADOR_REVISAR} SEM REGISTRO DE ENTRADA`
  return `${MARCADOR_REVISAR} SEM REGISTRO DE SAÍDA`
}

export function isPendenciaRevisao(observacao?: string | null): boolean {
  if (!observacao) return false
  return observacao.toUpperCase().includes(MARCADOR_REVISAR)
}

/* ------------------------------------------------------------------------------------------
 * O DIA VAZIO QUE TEM BATIDA — e que a folha chamava de FALTA
 *
 * A falta automatica olha so `escala_diaria.presenca_*`. Ela nao sabe que existe marcacao
 * naquele dia se a alocacao nao aproveitou nenhuma. Resultado medido em producao em
 * 21/08/2026: TRES servidores iam receber FALTA tendo batida com NSR de AFD assinado —
 * MESSIAS DA SILVA LEITE (54007) dia 17, IVANA MARIA HERENIO (65717) dia 19 e JANIA REGIA
 * MILHOMEM (1281) dia 20.
 *
 * A projecao read-only (`fn_projecao_marcacoes_dia`) mostrou que os tres NAO sao o mesmo caso:
 *
 *   MESSIAS  batida 08:20, turno MT  -> a projecao ALOCA como entrada (confirmada=true).
 *                                       So faltou reconciliar o dia. E recuperacao de dado.
 *   IVANA    batida 19:06, turno M 07-13 -> a projecao devolve ZERO linha: recusa a batida.
 *   JANIA    batida 18:07, turno M 08-12 -> idem.
 *
 * Nos dois ultimos a recusa esta CERTA: a batida esta ~6h fora do turno e forcar um passo
 * seria fabricar horario (a vedacao 2 da Portaria 671/2021 e a regra "nunca fabricar horario"
 * do modulo de marcacoes). O que nao pode e o sistema chamar isso de falta — o servidor tem
 * prova assinada de que esteve la, e quem decide o que aquilo significa e o coordenador.
 *
 * Por isso: dia vazio COM batida fisica registrada vira pendencia de revisao, nao falta.
 * A batida continua registrada e continua nao alocada — nada e fabricado, nada e descartado.
 * ------------------------------------------------------------------------------------------ */

export function resolverBatidaNaoAproveitada(opts: {
  diaJaPassou: boolean
  /** Ha passo preenchido no dia. Se houver, o dia cai em resolverPendenciaRevisao, nao aqui. */
  temMarcacao: boolean
  /** Ha marcacao de origem `rep` ou `terminal` no dia — batida fisica de gente. */
  temBatidaFisicaNoDia: boolean
}): string | null {
  if (!opts.diaJaPassou) return null
  if (opts.temMarcacao) return null
  if (!opts.temBatidaFisicaNoDia) return null
  return `${MARCADOR_REVISAR} HÁ BATIDA REGISTRADA E NENHUM PASSO PREENCHIDO`
}

/**
 * Dias do mes em que o servidor tem batida FISICA (`rep` ou `terminal`).
 *
 * ⚠️ So `rep` e `terminal` contam. `ajuste_coordenador`/`ajuste_servidor` sao declaracao, nao
 * batida — e boa parte delas e espelho gravado A PARTIR de um passo ja preenchido
 * ("Sincronizada de escala_diaria ... passo entrada"), o que produziria pendencia circular.
 *
 * ⚠️ O dia do calendario NAO pode sair de `new Date(iso).getDate()`: o processo Node roda em UTC
 * (armadilha 12) e uma batida das 22:00 viraria o dia seguinte. Usa Intl com timezone, igual ao
 * resto da folha.
 *
 * `fn_marcacoes_mes` e SECURITY DEFINER e **nao tem guard de escopo** — funciona tanto com a
 * sessao do coordenador (`createClient`) quanto com o admin client do portal
 * (`createAdminClient`), que e o que as duas copias de `consultar-escala` usam.
 */
export async function carregarDiasComBatidaFisica(
  // PromiseLike, nao Promise: `supabase.rpc()` devolve um PostgrestFilterBuilder que e thenable
  // mas nao tem catch/finally. Exigir Promise aqui rejeita o cliente real (TS2345).
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> },
  servidorId: string,
  mes: number,
  ano: number,
  timezone: string = 'America/Sao_Paulo'
): Promise<Set<number>> {
  const dias = new Set<number>()
  if (!servidorId) return dias

  try {
    const { data, error } = await supabase.rpc('fn_marcacoes_mes', {
      p_servidor_ids: [servidorId],
      p_mes: mes,
      p_ano: ano
    })
    if (error || !Array.isArray(data)) return dias

    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    })
    for (const m of data) {
      if (m?.origem !== 'rep' && m?.origem !== 'terminal') continue
      if (!m?.ocorrido_em) continue
      const [a, mm, dd] = fmt.format(new Date(m.ocorrido_em)).split('-').map(Number)
      // fn_marcacoes_mes devolve com folga de 1 dia dos dois lados; so o mes alvo interessa.
      if (a === ano && mm === mes) dias.add(dd)
    }
  } catch {
    // Falhar aqui nao pode impedir a folha de ser gerada. Sem o conjunto, o comportamento volta
    // a ser o de antes (dia vazio = falta) — degradacao para o lado conhecido, nunca silenciosa
    // para um estado novo.
    return dias
  }
  return dias
}
