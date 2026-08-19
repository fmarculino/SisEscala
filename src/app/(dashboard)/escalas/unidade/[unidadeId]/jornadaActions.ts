'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Mudanca de jornada de um servidor numa escala em curso.
 *
 * OS DOIS CASOS SAO DIFERENTES E NAO PODEM VIRAR UM SO
 *   `escala_mensal.jornada_id` nao tem vigencia: e UMA jornada por (servidor, mes). Trocar essa
 *   coluna no dia 12 nao muda "dali pra frente" — reescreve a premissa dos dias 1 a 11 tambem,
 *   porque fn_blocos_previstos_dia, fn_confirmar_presenca e a geracao da folha a leem para TODO
 *   dia do mes. Logo:
 *
 *     - "passou a cumprir outro horario a partir do dia X" (reducao judicial, acordo, troca de
 *       setor) -> VIGENCIA. Nao toca no mes; obter_jornada_servidor_data resolve por data e o
 *       banco inteiro ja respeita isso.
 *     - "a jornada estava errada desde o dia 1" (engano) -> CORRECAO. Reescreve o mes mesmo, que
 *       e o certo nesse caso, mas exige justificativa e fica registrada em
 *       escala_mensal_jornada_historico.
 *
 *   Mandar os dois pelo mesmo caminho e o que produz o problema: ou o engano fica sem rastro,
 *   ou a mudanca legitima reavalia dias ja trabalhados contra um horario que nao valia neles.
 */

/** Cria a vigencia a partir de uma data, sem tocar na jornada do mes. */
export async function criarVigenciaJornada(
  servidorId: string,
  jornadaId: string,
  dataInicio: string,
  dataFim: string,
  motivo: string,
  unidadeId: string
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!motivo || !motivo.trim()) {
    return { error: 'Informe o motivo da alteração de jornada.' }
  }

  const { error } = await supabase
    .from('servidores_jornadas_temporarias')
    .insert({
      servidor_id: servidorId,
      jornada_id: jornadaId,
      data_inicio: dataInicio,
      data_fim: dataFim,
      motivo: motivo.trim(),
      criado_por: user.id,
    })

  if (error) {
    // A trigger trg_vigencia_jornada_sem_sobreposicao devolve uma mensagem ja legivel.
    return { error: error.message }
  }

  revalidatePath(`/escalas/unidade/${unidadeId}`)
  revalidatePath(`/servidores/${servidorId}`)
  return { success: true }
}

/**
 * Troca a jornada do mes inteiro. So para o caso do engano.
 *
 * Delega a fn_alterar_jornada_escala_mensal (SECURITY INVOKER: a RLS de escala_mensal decide
 * quem pode) porque e la que a justificativa e publicada para a trigger de historico. Fazer o
 * UPDATE direto daqui gravaria a troca sem justificativa nenhuma.
 */
export async function corrigirJornadaDoMes(
  escalaMensalId: string,
  jornadaId: string,
  justificativa: string,
  unidadeId: string
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!justificativa || !justificativa.trim()) {
    return { error: 'Justificativa obrigatória para corrigir a jornada de uma escala em curso.' }
  }

  const { data, error } = await supabase.rpc('fn_alterar_jornada_escala_mensal', {
    p_escala_mensal_id: escalaMensalId,
    p_jornada_id: jornadaId,
    p_justificativa: justificativa.trim(),
  })

  if (error) return { error: error.message }

  revalidatePath(`/escalas/unidade/${unidadeId}`)
  return { success: true, resultado: data }
}

/** Vigências que tocam a competência, para a grade mostrar o que já existe. */
export async function getVigenciasJornadaCompetencia(
  servidorIds: string[],
  mes: number,
  ano: number
) {
  if (!servidorIds.length) return { vigencias: [] }
  const supabase = await createClient()

  const ultimoDia = new Date(ano, mes, 0).getDate()
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('servidores_jornadas_temporarias')
    .select('id, servidor_id, jornada_id, data_inicio, data_fim, motivo, jornadas(nome, horas_totais)')
    .in('servidor_id', servidorIds)
    .lte('data_inicio', fim)
    .gte('data_fim', inicio)

  if (error) return { error: error.message, vigencias: [] }
  return { vigencias: data || [] }
}
