/**
 * RECONCILIACAO PENDENTE — fonte unica da leitura no frontend.
 *
 * O QUE ISTO RESOLVE
 *   Quando o coordenador lanca a escala DEPOIS de a batida chegar, ninguem reprojeta:
 *   `fn_ingerir_afd` reconcilia o dia DA BATIDA e o gatilho de marcacao e inerte ate a
 *   Fase 5. A batida fica em `marcacoes_ponto`, a alocacao sabe a resposta, e a celula da
 *   grade continua vazia — hoje resolvida clique a clique no modal de validacao manual.
 *
 *   Medido em producao em 08/09/2026 (competencia 09/2026, dias ja passados): 619 pares
 *   (servidor, dia) com batida fisica e celula incompleta. Destes, **275 sao "so acrescimo"
 *   e rendem 720 horarios** — 720 cliques de selecao em um unico mes.
 *
 * A REGRA, E POR QUE ELA E DO DIA E NAO DO CAMPO
 *   ⚠️ **Nao e "preencher o que esta vazio".** Caso real de 07/09/2026: a batida das 21:49
 *   esta gravada como SAIDA e a projecao diz que ela e a ENTRADA (a saida e 10:03 do dia
 *   seguinte). Preencher so o campo vazio deixaria `entrada 21:49 -> saida 21:49`: jornada
 *   zero, pior que o estado atual, que ao menos e visivelmente incompleto. Foram 20 dias
 *   assim no mes medido.
 *
 *   Por isso a unidade de decisao e o PAR (servidor, dia): so entra na fila automatica o dia
 *   em que a reconciliacao **exclusivamente acrescenta**. Qualquer troca ou perda contamina o
 *   dia inteiro, e ele volta para a validacao manual — visivel e com o motivo escrito, nunca
 *   escondido (armadilha 31: botao cinza sem explicacao ensina a contornar a tela).
 *
 * ⚠️ **Quem decide e o banco.** `fn_reconciliacao_pendente_escala` ja devolve `dia_elegivel`,
 * e `fn_reconciliar_dia_pendente` RECALCULA a elegibilidade antes de escrever. O que este
 * modulo faz e agrupar e relatar — e so pode ser MAIS restritivo que o banco, nunca menos:
 * `elegivel` aqui exige a flag do banco E todos os campos serem ganho E nenhum impedimento.
 * Afrouxar isso reintroduz o caso das 21:49.
 *
 * ⚠️ **Nao derive alocacao aqui.** `fn_projecao_marcacoes_dia` e a fonte unica de qual batida
 * preenche qual passo; uma segunda conta no cliente divergiria da que o banco vai gravar.
 */

export type CampoPresenca = 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida'
export type TipoMudanca = 'ganho' | 'troca' | 'perda'
export type Impedimento = 'competencia_encerrada' | 'escala_fechada' | null

/** Uma linha crua de `fn_reconciliacao_pendente_escala`. */
export interface LinhaPrevia {
  escala_mensal_id: string
  servidor_id: string
  servidor_nome: string
  dia: number
  data: string
  escala_diaria_id: string
  categoria: string
  turno_codigo: string | null
  campo: CampoPresenca
  valor_atual: string | null
  valor_projetado: string | null
  origem_projetada: string | null
  tipo: TipoMudanca
  dia_elegivel: boolean
  impedimento: Impedimento
}

export interface MudancaCampo {
  campo: CampoPresenca
  rotulo: string
  categoria: string
  turnoCodigo: string | null
  tipo: TipoMudanca
  valorAtual: string | null
  valorProjetado: string | null
  origem: string | null
}

export interface DiaPendente {
  chave: string
  servidorId: string
  servidorNome: string
  dia: number
  data: string
  /** So acrescenta: seguro para o botao. */
  elegivel: boolean
  impedimento: Impedimento
  ganhos: MudancaCampo[]
  conflitos: MudancaCampo[]
}

const ROTULO: Record<CampoPresenca, string> = {
  entrada: 'Entrada',
  intervalo_saida: 'Saída p/ intervalo',
  intervalo_retorno: 'Retorno do intervalo',
  saida: 'Saída',
}

/** Ordem cronologica dos passos — a de chegada do banco e alfabetica e confunde a leitura. */
const ORDEM: CampoPresenca[] = ['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida']

export function rotuloCampo(campo: CampoPresenca): string {
  return ROTULO[campo] || campo
}

export function rotuloImpedimento(imp: Impedimento): string | null {
  if (imp === 'competencia_encerrada') return 'Competência encerrada — reabra em Configurações'
  if (imp === 'escala_fechada') return 'Escala Fechada — reabra a escala antes'
  return null
}

/**
 * Agrupa as linhas cruas em dias.
 *
 * ⚠️ `elegivel` e o E de tres condicoes, nunca so a flag do banco. Defesa em profundidade: se
 * uma versao futura da RPC classificar errado, o pior que acontece e o dia cair na fila manual.
 */
export function agruparPorDia(linhas: LinhaPrevia[] | null | undefined): DiaPendente[] {
  if (!Array.isArray(linhas) || linhas.length === 0) return []

  const mapa = new Map<string, DiaPendente>()

  for (const l of linhas) {
    if (!l || !l.servidor_id || !l.data) continue
    const chave = `${l.servidor_id}|${l.data}`
    let d = mapa.get(chave)
    if (!d) {
      d = {
        chave,
        servidorId: l.servidor_id,
        servidorNome: l.servidor_nome || 'Servidor',
        dia: l.dia,
        data: l.data,
        elegivel: true,
        impedimento: l.impedimento ?? null,
        ganhos: [],
        conflitos: [],
      }
      mapa.set(chave, d)
    }
    if (l.impedimento && !d.impedimento) d.impedimento = l.impedimento

    const m: MudancaCampo = {
      campo: l.campo,
      rotulo: rotuloCampo(l.campo),
      categoria: l.categoria,
      turnoCodigo: l.turno_codigo ?? null,
      tipo: l.tipo,
      valorAtual: l.valor_atual ?? null,
      valorProjetado: l.valor_projetado ?? null,
      origem: l.origem_projetada ?? null,
    }

    // Tudo que nao e ganho e conflito, inclusive tipo que ainda nao existe. A duvida fecha:
    // classificar como ganho um tipo desconhecido escreveria em cima de horario gravado.
    if (l.tipo === 'ganho') d.ganhos.push(m)
    else d.conflitos.push(m)

    // O banco ja decidiu; aqui so se pode restringir mais.
    if (!l.dia_elegivel) d.elegivel = false
  }

  for (const d of mapa.values()) {
    if (d.conflitos.length > 0) d.elegivel = false
    if (d.impedimento) d.elegivel = false
    if (d.ganhos.length === 0) d.elegivel = false
    d.ganhos.sort(ordenarCampo)
    d.conflitos.sort(ordenarCampo)
  }

  return [...mapa.values()].sort((a, b) =>
    a.servidorNome.localeCompare(b.servidorNome, 'pt-BR') || a.dia - b.dia)
}

function ordenarCampo(a: MudancaCampo, b: MudancaCampo): number {
  const i = ORDEM.indexOf(a.campo), j = ORDEM.indexOf(b.campo)
  return (i < 0 ? 99 : i) - (j < 0 ? 99 : j)
}

export interface ResumoPrevia {
  diasElegiveis: number
  horarios: number
  servidores: number
  diasComConflito: number
  diasBloqueados: number
}

export function resumirPrevia(dias: DiaPendente[]): ResumoPrevia {
  const elegiveis = dias.filter(d => d.elegivel)
  return {
    diasElegiveis: elegiveis.length,
    horarios: elegiveis.reduce((s, d) => s + d.ganhos.length, 0),
    servidores: new Set(elegiveis.map(d => d.servidorId)).size,
    diasComConflito: dias.filter(d => !d.elegivel && !d.impedimento && d.conflitos.length > 0).length,
    diasBloqueados: dias.filter(d => !!d.impedimento).length,
  }
}

/** O que vai para a action: nunca a lista de campos, so o par (servidor, dia). */
export function diasParaAplicar(dias: DiaPendente[]): { servidorId: string; data: string }[] {
  return dias.filter(d => d.elegivel).map(d => ({ servidorId: d.servidorId, data: d.data }))
}

export interface ResultadoDia {
  servidorId: string
  servidorNome: string
  data: string
  status: string
  campos: number
  motivo?: string
}

/**
 * Relata o que MUDOU e por que o resto nao — nunca o que foi calculado (armadilha 22/25).
 *
 * ⚠️ Dia que voltou `campos: 0` NAO entra na contagem de sucesso, mesmo com status `ok`:
 * anunciar dias preenchidos que nao preencheram nada foi exatamente o defeito do Gerador
 * Inteligente em 25/08/2026.
 */
export function descreverResultado(res: ResultadoDia[]): {
  horarios: number
  dias: number
  servidores: number
  recusados: { rotulo: string; motivo: string }[]
  frase: string
} {
  const aplicados = res.filter(r => r.status === 'ok' && r.campos > 0)
  const horarios = aplicados.reduce((s, r) => s + r.campos, 0)
  const servidores = new Set(aplicados.map(r => r.servidorId)).size

  const recusados = res
    .filter(r => !(r.status === 'ok' && r.campos > 0))
    .map(r => ({
      rotulo: `${r.servidorNome} — dia ${diaDaData(r.data)}`,
      motivo: r.motivo || motivoPadrao(r.status),
    }))

  let frase: string
  if (horarios === 0) {
    frase = 'Nenhum horário foi preenchido.'
  } else {
    frase = `${horarios} ${horarios === 1 ? 'horário preenchido' : 'horários preenchidos'}`
      + ` em ${aplicados.length} ${aplicados.length === 1 ? 'dia' : 'dias'}`
      + ` de ${servidores} ${servidores === 1 ? 'servidor' : 'servidores'}.`
  }
  if (recusados.length > 0) {
    frase += ` ${recusados.length} ${recusados.length === 1 ? 'dia ficou' : 'dias ficaram'} de fora.`
  }

  return { horarios, dias: aplicados.length, servidores, recusados, frase }
}

function motivoPadrao(status: string): string {
  switch (status) {
    case 'conflito': return 'O dia deixou de ser só acréscimo — resolva pela validação manual.'
    case 'sem_mudanca': return 'Nada a preencher: outra pessoa já resolveu este dia.'
    case 'escala_fechada': return 'A escala está Fechada.'
    case 'competencia_encerrada': return 'A competência está encerrada.'
    case 'acesso_negado': return 'Sem acesso a todas as escalas deste servidor no mês.'
    case 'sem_escala': return 'O servidor não tem escala nesta competência.'
    default: return 'Não foi possível aplicar.'
  }
}

/** `2026-09-07` -> 7. Data pura nunca vira `new Date` (armadilha 12). */
export function diaDaData(data: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data || '')
  return m ? Number(m[3]) : 0
}
