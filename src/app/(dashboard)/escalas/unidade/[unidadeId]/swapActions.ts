'use server'

import { createClient } from '@/utils/supabase/server'

/**
 * Server actions para gestão de solicitações de troca pelo coordenador/admin.
 * Todas as operações exigem autenticação Supabase (role admin/coordenador).
 */

export async function getSwapRequestsByUnit(unidadeId: string, setorId: string, mes: number, ano: number) {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user?.user) {
    return { error: 'Não autenticado.' }
  }

  // Buscar escala_mensal IDs para o filtro
  const { data: escalas } = await supabase
    .from('escala_mensal')
    .select('id')
    .eq('unidade_id', unidadeId)
    .eq('setor_id', setorId)
    .eq('mes', mes)
    .eq('ano', ano)

  if (!escalas || escalas.length === 0) {
    return { solicitacoes: [] }
  }

  const emIds = escalas.map(e => e.id)

  const { data, error } = await supabase
    .from('solicitacoes_troca')
    .select(`
      *,
      solicitante:servidores!solicitacoes_troca_solicitante_id_fkey(nome, matricula, cargo),
      destinatario:servidores!solicitacoes_troca_destinatario_id_fkey(nome),
      turno:dicionario_turnos!solicitacoes_troca_turno_origem_id_fkey(codigo, descricao)
    `)
    .in('escala_mensal_solicitante_id', emIds)
    .order('created_at', { ascending: false })

  if (error) {
    return { error: error.message }
  }

  return { solicitacoes: data || [] }
}

export async function approveSwapRequest(solicitacaoId: string) {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user?.user) {
    return { error: 'Não autenticado.' }
  }

  // Verificar que a solicitação está pendente
  const { data: sol } = await supabase
    .from('solicitacoes_troca')
    .select('id, status')
    .eq('id', solicitacaoId)
    .eq('status', 'Pendente')
    .single()

  if (!sol) {
    return { error: 'Solicitação não encontrada ou já processada.' }
  }

  const { error } = await supabase
    .from('solicitacoes_troca')
    .update({ 
      status: 'Aprovada', 
      aprovado_por: user.user.id,
      updated_at: new Date().toISOString() 
    })
    .eq('id', solicitacaoId)

  if (error) {
    return { error: 'Erro ao aprovar: ' + error.message }
  }

  return { success: true }
}

export async function rejectSwapRequest(solicitacaoId: string, motivoRejeicao: string) {
  const supabase = await createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user?.user) {
    return { error: 'Não autenticado.' }
  }

  if (!motivoRejeicao || motivoRejeicao.trim().length < 3) {
    return { error: 'Motivo da rejeição é obrigatório.' }
  }

  const { data: sol } = await supabase
    .from('solicitacoes_troca')
    .select('id, status')
    .eq('id', solicitacaoId)
    .eq('status', 'Pendente')
    .single()

  if (!sol) {
    return { error: 'Solicitação não encontrada ou já processada.' }
  }

  const { error } = await supabase
    .from('solicitacoes_troca')
    .update({ 
      status: 'Rejeitada', 
      motivo_rejeicao: motivoRejeicao.trim(),
      aprovado_por: user.user.id,
      updated_at: new Date().toISOString() 
    })
    .eq('id', solicitacaoId)

  if (error) {
    return { error: 'Erro ao rejeitar: ' + error.message }
  }

  return { success: true }
}
