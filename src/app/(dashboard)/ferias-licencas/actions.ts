'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

// =========================================================================
// FÉRIAS E LICENÇA PRÊMIO — Painel do Coordenador/Administrador
// =========================================================================

interface OpcaoDatas {
  p1_inicio: string
  p1_fim: string
  p2_inicio?: string
  p2_fim?: string
}

async function getAuthProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  return {
    ...profile,
    userId: user.id,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || [],
  }
}

export async function getSolicitacoesPendentes(filters: {
  unidadeId?: string
  setorId?: string
  status?: string
  exercicio?: string
}) {
  const supabase = await createClient()
  const profile = await getAuthProfile()
  if (!profile) return { error: 'Não autenticado.' }

  let query = supabase
    .from('solicitacoes_ferias_licencas')
    .select(`
      *,
      servidores(id, nome, matricula, cargo, vinculo,
        unidades(nome),
        setores(dicionario_setores(nome))
      )
    `)
    .order('created_at', { ascending: false })

  // Apply status filter
  if (filters.status && filters.status !== 'todos') {
    query = query.eq('status', filters.status)
  }

  // Apply unit filter
  if (filters.unidadeId && filters.unidadeId !== 'todas') {
    query = query.eq('unidade_id', filters.unidadeId)
  }

  // Apply sector filter
  if (filters.setorId && filters.setorId !== 'todos') {
    query = query.eq('setor_id', filters.setorId)
  }

  // Apply exercise filter
  if (filters.exercicio) {
    query = query.eq('exercicio', filters.exercicio)
  }

  const { data, error } = await query

  if (error) {
    return { error: 'Erro ao buscar solicitações: ' + error.message }
  }

  return { solicitacoes: data || [] }
}

export async function avaliarSolicitacao(params: {
  solicitacaoId: string
  acao: 'deferir' | 'indeferir' | 'contraproposta'
  opcaoSelecionada?: number  // 1, 2, or 3
  parecer: string
  contrapropostaDatas?: OpcaoDatas
}) {
  const supabase = await createClient()
  const profile = await getAuthProfile()
  if (!profile) return { error: 'Não autenticado.' }

  const { solicitacaoId, acao, opcaoSelecionada, parecer, contrapropostaDatas } = params

  // Fetch the request
  const { data: sol, error: fetchErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('*')
    .eq('id', solicitacaoId)
    .single()

  if (fetchErr || !sol) {
    return { error: 'Solicitação não encontrada.' }
  }

  if (sol.status !== 'aguardando_validacao') {
    return { error: 'Esta solicitação não está aguardando validação.' }
  }

  // -----------------------------------------------------------------------
  // CONTRAPROPOSTA
  // -----------------------------------------------------------------------
  if (acao === 'contraproposta') {
    if (!contrapropostaDatas || !contrapropostaDatas.p1_inicio || !contrapropostaDatas.p1_fim) {
      return { error: 'Informe as datas da contraproposta.' }
    }

    const { error: updateErr } = await supabase
      .from('solicitacoes_ferias_licencas')
      .update({
        status: 'contraproposta',
        contraproposta_datas: contrapropostaDatas,
        parecer_coordenador: parecer || 'Contraproposta de datas pela chefia.',
        validado_por: profile.userId,
        validado_em: new Date().toISOString(),
      })
      .eq('id', solicitacaoId)

    if (updateErr) {
      return { error: 'Erro ao registrar contraproposta: ' + updateErr.message }
    }

    await supabase
      .from('solicitacoes_ferias_licencas_historico')
      .insert({
        solicitacao_id: solicitacaoId,
        acao: 'contraproposta',
        status_anterior: 'aguardando_validacao',
        status_novo: 'contraproposta',
        executado_por: profile.userId,
        detalhes: { parecer, contraproposta_datas: contrapropostaDatas },
      })

    revalidatePath('/ferias-licencas')
    return { success: true }
  }

  // -----------------------------------------------------------------------
  // INDEFERIR
  // -----------------------------------------------------------------------
  if (acao === 'indeferir') {
    if (!parecer || parecer.trim().length < 5) {
      return { error: 'É obrigatório informar a justificativa do indeferimento.' }
    }

    const { error: updateErr } = await supabase
      .from('solicitacoes_ferias_licencas')
      .update({
        status: 'indeferido',
        parecer_coordenador: parecer,
        validado_por: profile.userId,
        validado_em: new Date().toISOString(),
      })
      .eq('id', solicitacaoId)

    if (updateErr) {
      return { error: 'Erro ao indeferir: ' + updateErr.message }
    }

    await supabase
      .from('solicitacoes_ferias_licencas_historico')
      .insert({
        solicitacao_id: solicitacaoId,
        acao: 'indeferida',
        status_anterior: 'aguardando_validacao',
        status_novo: 'indeferido',
        executado_por: profile.userId,
        detalhes: { parecer },
      })

    revalidatePath('/ferias-licencas')
    return { success: true }
  }

  // -----------------------------------------------------------------------
  // DEFERIR
  // -----------------------------------------------------------------------
  if (!opcaoSelecionada || opcaoSelecionada < 1 || opcaoSelecionada > (sol.opcoes_datas as any[]).length) {
    return { error: 'Selecione uma opção válida de datas.' }
  }

  const opcoes = sol.opcoes_datas as OpcaoDatas[]
  const opcaoEscolhida = opcoes[opcaoSelecionada - 1]

  // Check staffing impact — block if minimum would be violated
  if (sol.setor_id) {
    const { data: setor } = await supabase
      .from('setores')
      .select('servidores_manha_min, servidores_tarde_min, servidores_noite_min')
      .eq('id', sol.setor_id)
      .single()

    if (setor) {
      const minValues = [
        setor.servidores_manha_min,
        setor.servidores_tarde_min,
        setor.servidores_noite_min
      ].filter(v => v !== null && v > 0)

      if (minValues.length > 0) {
        // Count how many servers from the same sector already have leave in the period
        const { data: conflitantes } = await supabase
          .from('servidores_eventos')
          .select('id, servidor_id')
          .eq('servidor_id', sol.servidor_id)
          .neq('servidor_id', sol.servidor_id) // exclude current server — we want OTHER servers
          
        // Query overlapping leave events from other servers in the same sector
        const { data: servidoresSetor } = await supabase
          .from('servidores')
          .select('id')
          .eq('setor_id', sol.setor_id)
          .eq('status', 'Ativo')

        const totalServidoresSetor = servidoresSetor?.length || 0

        if (totalServidoresSetor > 0) {
          // Count servers already on leave during the proposed period
          const { data: emAfastamento } = await supabase
            .from('servidores_eventos')
            .select('servidor_id')
            .in('servidor_id', (servidoresSetor || []).map(s => s.id))
            .lte('data_inicio', opcaoEscolhida.p1_fim)
            .gte('data_fim', opcaoEscolhida.p1_inicio)

          const servidoresEmAfastamento = new Set(emAfastamento?.map(e => e.servidor_id) || [])
          // Add the current server to the count (they would be on leave too)
          servidoresEmAfastamento.add(sol.servidor_id)
          
          const disponiveisRestantes = totalServidoresSetor - servidoresEmAfastamento.size
          const minimoNecessario = Math.max(...minValues)

          if (disponiveisRestantes < minimoNecessario) {
            return {
              error: `BLOQUEIO: O deferimento deixaria o setor abaixo do efetivo mínimo. Servidores disponíveis no período: ${disponiveisRestantes}, mínimo necessário: ${minimoNecessario}. Total em afastamento (incluindo este): ${servidoresEmAfastamento.size} de ${totalServidoresSetor}.`
            }
          }
        }
      }
    }
  }

  // Get tipo_evento for "Férias" or "Licença Prêmio" 
  const tipoEventoNome = sol.tipo_beneficio === 'ferias' ? 'Férias' : 'Licença Prêmio'
  const { data: tipoEvento } = await supabase
    .from('tipos_eventos')
    .select('id')
    .eq('nome', tipoEventoNome)
    .single()

  if (!tipoEvento) {
    return { error: `Tipo de evento "${tipoEventoNome}" não encontrado na tabela tipos_eventos. Cadastre-o primeiro.` }
  }

  // Generate servidores_eventos records
  const eventosIds: string[] = []

  // Period 1
  const { data: ev1, error: ev1Err } = await supabase
    .from('servidores_eventos')
    .insert({
      servidor_id: sol.servidor_id,
      tipo_evento_id: tipoEvento.id,
      data_inicio: opcaoEscolhida.p1_inicio,
      data_fim: opcaoEscolhida.p1_fim,
      observacao: `Deferido via módulo Férias/LP — Exercício ${sol.exercicio}`,
      criado_por: profile.userId,
    })
    .select('id')
    .single()

  if (ev1Err) {
    return { error: 'Erro ao lançar período 1 na escala: ' + ev1Err.message }
  }
  eventosIds.push(ev1.id)

  // Period 2 (if fractionated)
  if (opcaoEscolhida.p2_inicio && opcaoEscolhida.p2_fim) {
    const { data: ev2, error: ev2Err } = await supabase
      .from('servidores_eventos')
      .insert({
        servidor_id: sol.servidor_id,
        tipo_evento_id: tipoEvento.id,
        data_inicio: opcaoEscolhida.p2_inicio,
        data_fim: opcaoEscolhida.p2_fim,
        observacao: `Deferido via módulo Férias/LP (2º período) — Exercício ${sol.exercicio}`,
        criado_por: profile.userId,
      })
      .select('id')
      .single()

    if (ev2Err) {
      return { error: 'Erro ao lançar período 2 na escala: ' + ev2Err.message }
    }
    eventosIds.push(ev2.id)
  }

  // Update the request as deferred
  const { error: updateErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .update({
      status: 'deferido',
      opcao_selecionada: opcaoSelecionada,
      periodo_deferido_p1_inicio: opcaoEscolhida.p1_inicio,
      periodo_deferido_p1_fim: opcaoEscolhida.p1_fim,
      periodo_deferido_p2_inicio: opcaoEscolhida.p2_inicio || null,
      periodo_deferido_p2_fim: opcaoEscolhida.p2_fim || null,
      parecer_coordenador: parecer || 'Deferido.',
      validado_por: profile.userId,
      validado_em: new Date().toISOString(),
      eventos_gerados_ids: eventosIds,
    })
    .eq('id', solicitacaoId)

  if (updateErr) {
    return { error: 'Erro ao atualizar solicitação: ' + updateErr.message }
  }

  await supabase
    .from('solicitacoes_ferias_licencas_historico')
    .insert({
      solicitacao_id: solicitacaoId,
      acao: 'deferida',
      status_anterior: 'aguardando_validacao',
      status_novo: 'deferido',
      executado_por: profile.userId,
      detalhes: {
        parecer,
        opcao_selecionada: opcaoSelecionada,
        periodo_p1: { inicio: opcaoEscolhida.p1_inicio, fim: opcaoEscolhida.p1_fim },
        periodo_p2: opcaoEscolhida.p2_inicio ? { inicio: opcaoEscolhida.p2_inicio, fim: opcaoEscolhida.p2_fim } : null,
        eventos_gerados_ids: eventosIds,
      },
    })

  revalidatePath('/ferias-licencas')
  revalidatePath('/afastamentos')
  return { success: true }
}

export async function cancelarSolicitacaoDeferida(solicitacaoId: string, motivo: string) {
  const supabase = await createClient()
  const profile = await getAuthProfile()
  if (!profile) return { error: 'Não autenticado.' }

  if (!['super_admin', 'admin'].includes(profile.role)) {
    return { error: 'Somente Administradores podem cancelar solicitações deferidas.' }
  }

  if (!motivo || motivo.trim().length < 5) {
    return { error: 'É obrigatório informar o motivo do cancelamento.' }
  }

  const { data: sol, error: fetchErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('*')
    .eq('id', solicitacaoId)
    .single()

  if (fetchErr || !sol) {
    return { error: 'Solicitação não encontrada.' }
  }

  if (sol.status !== 'deferido') {
    return { error: 'Somente solicitações deferidas podem ser canceladas por esta ação.' }
  }

  // Remove generated events from servidores_eventos
  if (sol.eventos_gerados_ids && (sol.eventos_gerados_ids as string[]).length > 0) {
    const { error: delErr } = await supabase
      .from('servidores_eventos')
      .delete()
      .in('id', sol.eventos_gerados_ids as string[])

    if (delErr) {
      return { error: 'Erro ao remover eventos da escala: ' + delErr.message }
    }
  }

  const { error: updateErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .update({
      status: 'cancelado',
      cancelado_por: profile.userId,
      cancelado_em: new Date().toISOString(),
      motivo_cancelamento: motivo,
    })
    .eq('id', solicitacaoId)

  if (updateErr) {
    return { error: 'Erro ao cancelar: ' + updateErr.message }
  }

  await supabase
    .from('solicitacoes_ferias_licencas_historico')
    .insert({
      solicitacao_id: solicitacaoId,
      acao: 'cancelada_admin',
      status_anterior: 'deferido',
      status_novo: 'cancelado',
      executado_por: profile.userId,
      detalhes: { motivo, eventos_removidos: sol.eventos_gerados_ids },
    })

  revalidatePath('/ferias-licencas')
  revalidatePath('/afastamentos')
  return { success: true }
}

export async function getProgramacaoAnualSetor(filters: {
  unidadeId?: string
  setorId?: string
  ano: number
}) {
  const supabase = await createClient()

  let query = supabase
    .from('solicitacoes_ferias_licencas')
    .select(`
      *,
      servidores(id, nome, matricula, cargo, vinculo)
    `)
    .in('status', ['deferido', 'aguardando_validacao', 'contraproposta', 'indeferido', 'cancelado'])
    .order('created_at', { ascending: true })

  if (filters.unidadeId && filters.unidadeId !== 'todas') {
    query = query.eq('unidade_id', filters.unidadeId)
  }
  if (filters.setorId && filters.setorId !== 'todos') {
    query = query.eq('setor_id', filters.setorId)
  }

  // Filter by year: any request where the deferred/proposed periods fall in the selected year
  const anoInicio = `${filters.ano}-01-01`
  const anoFim = `${filters.ano}-12-31`

  const { data, error } = await query

  if (error) {
    return { error: 'Erro ao buscar programação: ' + error.message }
  }

  // Filter client-side by year (checking both deferred and proposed dates)
  const filtered = (data || []).filter((s: any) => {
    // Check deferred periods
    if (s.periodo_deferido_p1_inicio) {
      if (s.periodo_deferido_p1_inicio <= anoFim && s.periodo_deferido_p1_fim >= anoInicio) return true
      if (s.periodo_deferido_p2_inicio && s.periodo_deferido_p2_inicio <= anoFim && s.periodo_deferido_p2_fim >= anoInicio) return true
    }
    // Check proposed dates
    const opcoes = s.opcoes_datas as any[]
    if (opcoes) {
      for (const op of opcoes) {
        if (op.p1_inicio <= anoFim && op.p1_fim >= anoInicio) return true
        if (op.p2_inicio && op.p2_inicio <= anoFim && op.p2_fim >= anoInicio) return true
      }
    }
    return false
  })

  return { programacao: filtered }
}
