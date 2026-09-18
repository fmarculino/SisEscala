'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import type { LinhaPrevia, ResultadoDia } from '@/utils/reconciliacaoPendente'

/**
 * Preencher na grade os horarios que a batida real ja resolve.
 *
 * POR QUE ISTO EXISTE (08/09/2026)
 *   Escala lancada DEPOIS da batida nao dispara reconciliacao nenhuma: `fn_ingerir_afd`
 *   reconcilia o dia DA BATIDA e `trg_reconciliar_apos_marcacao` e inerte ate a Fase 5.
 *   O coordenador entao abre o modal de validacao manual celula a celula e escolhe a batida
 *   que o banco JA SABE qual e. Medido em 09/2026: 720 horarios assim, em 275 dias.
 *
 * ⚠️ **Esta action nao decide nada.** Quem confere papel, escopo, competencia encerrada,
 * escala Fechada e — o principal — se o dia e "so acrescimo" e o BANCO, em
 * `fn_reconciliacao_pendente_escala` e `fn_reconciliar_dia_pendente`. Repetir qualquer dessas
 * regras aqui criaria uma segunda copia para divergir, e Server Action e um POST chamavel
 * direto (armadilha 33): a defesa nao pode morar so aqui.
 *
 * ⚠️ **O cliente manda o par (servidor, dia), nunca o horario.** Mandar horario faria uma batida
 * real virar declaracao do coordenador — a mesma razao pela qual o modal de validacao manual
 * manda o `id` da marcacao e nao o `HH:MM` (v1.26.0).
 */

/** Teto por clique. Acima disso o relato fica ilegivel e o laço, longo demais para uma tela. */
const MAX_DIAS_POR_APLICACAO = 400

export async function previewReconciliacaoPendente(
  escalaMensalIds: string[]
): Promise<{ error?: string; linhas?: LinhaPrevia[] }> {
  if (!Array.isArray(escalaMensalIds) || escalaMensalIds.length === 0) {
    return { linhas: [] }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data, error } = await supabase.rpc('fn_reconciliacao_pendente_escala', {
    p_escala_mensal_ids: escalaMensalIds,
  })

  if (error) {
    // Timeout aqui e informacao util, nao ruido: a previa roda a projecao por dia candidato e
    // e o primeiro lugar onde uma grade muito grande apareceria (armadilha 54).
    if ((error.message || '').includes('statement timeout')) {
      return { error: 'A verificação demorou demais nesta grade. Tente por um setor menor.' }
    }
    return { error: error.message }
  }

  return { linhas: (data || []) as LinhaPrevia[] }
}

export async function aplicarReconciliacaoPendente(params: {
  dias: { servidorId: string; data: string }[]
  /** Só para o `revalidatePath` da grade de onde a ação partiu. */
  unidadeId: string
}): Promise<{ error?: string; resultados?: ResultadoDia[] }> {
  const { dias, unidadeId } = params

  if (!Array.isArray(dias) || dias.length === 0) {
    return { error: 'Nenhum dia selecionado.' }
  }
  if (dias.length > MAX_DIAS_POR_APLICACAO) {
    return { error: `São ${dias.length} dias de uma vez. Aplique por partes (limite de ${MAX_DIAS_POR_APLICACAO}).` }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // Nome vem do banco, nunca do cliente: o relato do que mudou nao pode ser rotulado por uma
  // string que o chamador escolheu.
  const ids = [...new Set(dias.map(d => d.servidorId))]
  const nomePorServidor = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data: servs } = await supabase
      .from('servidores')
      .select('id, nome')
      .in('id', ids.slice(i, i + 100))
    for (const s of servs || []) nomePorServidor.set(s.id as string, (s.nome as string) || 'Servidor')
  }

  const resultados: ResultadoDia[] = []

  // O laço nao e atomico, e isso e deliberado: cada dia e uma decisao independente, e um dia
  // que passou a conflitar nao pode desfazer os que ja foram preenchidos corretamente.
  for (const d of dias) {
    const { data, error } = await supabase.rpc('fn_reconciliar_dia_pendente', {
      p_servidor_id: d.servidorId,
      p_data: d.data,
    })

    if (error) {
      resultados.push({
        servidorId: d.servidorId,
        servidorNome: nomePorServidor.get(d.servidorId) || 'Servidor',
        data: d.data,
        status: 'erro',
        campos: 0,
        motivo: error.message,
      })
      continue
    }

    const r = (data || {}) as { status?: string; campos?: number; motivo?: string }
    resultados.push({
      servidorId: d.servidorId,
      servidorNome: nomePorServidor.get(d.servidorId) || 'Servidor',
      data: d.data,
      status: r.status || 'erro',
      campos: Number(r.campos || 0),
      motivo: r.motivo,
    })
  }

  revalidatePath(`/escalas/unidade/${unidadeId}`)
  return { resultados }
}

/**
 * Devolver a circulacao as batidas que uma REVERSAO tirou.
 *
 * POR QUE ISTO EXISTE (17/09/2026)
 *   O trigger de sincronizacao grava `desconsiderar` sempre que um UPDATE zera um passo de
 *   presenca, e nao sabe POR QUE. Quem reverteu para corrigir a ESCALA perdia a batida real
 *   junto, e `fn_alocar_marcacoes_dia` passa a filtra-la: o "Preencher pelas Batidas" respondia
 *   "Nada a preencher neste dia" com a batida gravada no banco.
 *
 *   Medido em producao: 173 batidas fisicas fora de circulacao, 16 dias com a tela muda, e 47
 *   batidas `rep` retiradas so em 17/09. A 20260917150000 faz a reversao PERGUNTAR a intencao e
 *   resolve daqui para a frente; esta action e o que desfaz o que ja existe.
 *
 * ⚠️ **Nao decide nada.** Papel, escopo, competencia encerrada, escala Fechada e — o principal —
 * QUAIS batidas podem voltar sao decisao de `fn_restaurar_batidas_dia`. So volta a batida
 * FISICA cujo ultimo `desconsiderar` veio da reversao automatica: batida tirada por DECISAO
 * (teste, pessoa errada) continua fora, e so a correcao de batida real a traz de volta.
 *
 * ⚠️ **Restaurar nao preenche nada.** A batida volta a ser candidata; quem a poe no passo
 * continua sendo o "Preencher pelas Batidas", com a previa na frente. Juntar as duas coisas num
 * clique faria a correcao entrar sem ninguem ver o que entrou.
 */
export async function restaurarBatidasDias(params: {
  dias: { servidorId: string; data: string }[]
  justificativa: string
  unidadeId: string
}): Promise<{ error?: string; restauradas?: number; dias?: number; recusados?: { rotulo: string; motivo: string }[] }> {
  const { dias, justificativa, unidadeId } = params

  if (!Array.isArray(dias) || dias.length === 0) return { error: 'Nenhum dia selecionado.' }
  if (dias.length > MAX_DIAS_POR_APLICACAO) {
    return { error: `São ${dias.length} dias de uma vez. Aplique por partes (limite de ${MAX_DIAS_POR_APLICACAO}).` }
  }
  // A regra dura e do banco (>= 5 caracteres). Aqui e so para nao gastar uma ida ao servidor
  // por dia com um texto que sera recusado em todos.
  if (!justificativa || justificativa.trim().length < 5) {
    return { error: 'Escreva o motivo da restauração (ao menos 5 caracteres).' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const ids = [...new Set(dias.map(d => d.servidorId))]
  const nomePorServidor = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data: servs } = await supabase
      .from('servidores')
      .select('id, nome')
      .in('id', ids.slice(i, i + 100))
    for (const s of servs || []) nomePorServidor.set(s.id as string, (s.nome as string) || 'Servidor')
  }

  let restauradas = 0
  let diasComEfeito = 0
  const recusados: { rotulo: string; motivo: string }[] = []

  for (const d of dias) {
    const rotulo = `${nomePorServidor.get(d.servidorId) || 'Servidor'} — ${d.data}`
    const { data, error } = await supabase.rpc('fn_restaurar_batidas_dia', {
      p_servidor_id: d.servidorId,
      p_data: d.data,
      p_justificativa: justificativa.trim(),
    })

    if (error) { recusados.push({ rotulo, motivo: error.message }); continue }

    const r = (data || {}) as { status?: string; restauradas?: number; motivo?: string }
    const n = Number(r.restauradas || 0)
    // Conta o que MUDOU, nunca o que foi encontrado (armadilha 22). Dia que voltou zero entra
    // na lista de recusados com o motivo, em vez de sumir na diferenca.
    if (n > 0) { restauradas += n; diasComEfeito += 1 }
    else recusados.push({ rotulo, motivo: r.motivo || 'Nada a restaurar neste dia.' })
  }

  revalidatePath(`/escalas/unidade/${unidadeId}`)
  return { restauradas, dias: diasComEfeito, recusados }
}
