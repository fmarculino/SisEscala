'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'

export async function autoCloseExpiredScalesAndTimesheets() {
  try {
    // 1. Garantir que a requisição vem de um usuário autenticado
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'Não autorizado' }
    }

    const supabase = await createAdminClient()

    // 2. Buscar a configuração de dias de inativação automática (padrão 5 dias)
    const { data: config } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')
      .eq('chave', 'dias_inativacao_automatica')
      .single()

    const diasInativacao = parseInt(config?.valor || '5', 10)

    // 3. Buscar escalas abertas (status != 'Fechada')
    const { data: openScales, error: scalesError } = await supabase
      .from('escala_mensal')
      .select('id, mes, ano, status, unidade_id, setor_id, servidor_id, updated_at')
      .neq('status', 'Fechada')

    if (scalesError) {
      console.error('Erro ao buscar escalas abertas para auto-fechamento:', scalesError)
      return { success: false, error: scalesError.message }
    }

    const now = new Date()
    const expiredScales = (openScales || []).filter(scale => {
      const endOfMonth = new Date(scale.ano, scale.mes, 0, 23, 59, 59, 999)
      const thresholdDate = new Date(endOfMonth)
      thresholdDate.setDate(thresholdDate.getDate() + diasInativacao)
      
      const lastUpdated = scale.updated_at ? new Date(scale.updated_at) : new Date(0)
      return now > thresholdDate && lastUpdated <= thresholdDate
    })

    // 4. Buscar folhas de ponto abertas (status != 'Revisada')
    const { data: openTimesheets, error: timesheetsError } = await supabase
      .from('folha_ponto')
      .select('id, mes, ano, status, escala_mensal_id, servidor_id, ultima_edicao_em, created_at')
      .neq('status', 'Revisada')

    if (timesheetsError) {
      console.error('Erro ao buscar folhas de ponto abertas para auto-fechamento:', timesheetsError)
      return { success: false, error: timesheetsError.message }
    }

    const expiredTimesheets = (openTimesheets || []).filter(ts => {
      const endOfMonth = new Date(ts.ano, ts.mes, 0, 23, 59, 59, 999)
      const thresholdDate = new Date(endOfMonth)
      thresholdDate.setDate(thresholdDate.getDate() + diasInativacao)

      const lastUpdated = ts.ultima_edicao_em 
        ? new Date(ts.ultima_edicao_em) 
        : (ts.created_at ? new Date(ts.created_at) : new Date(0))
        
      return now > thresholdDate && lastUpdated <= thresholdDate
    })

    // 5. Fechar escalas expiradas
    if (expiredScales.length > 0) {
      const scaleIds = expiredScales.map(s => s.id)
      const { error: updateScalesError } = await supabase
        .from('escala_mensal')
        .update({ status: 'Fechada' })
        .in('id', scaleIds)

      if (updateScalesError) {
        console.error('Erro ao fechar escalas expiradas:', updateScalesError)
      } else {
        // Inserir logs do sistema para as escalas fechadas
        const logs = expiredScales.map(scale => ({
          acao: 'Escala Fechada Automaticamente (Prazo Expirado)',
          detalhes: {
            escala_mensal_id: scale.id,
            mes: scale.mes,
            ano: scale.ano,
            servidor_id: scale.servidor_id,
            dias_inativacao: diasInativacao
          },
          unidade_id: scale.unidade_id,
          setor_id: scale.setor_id
        }))
        
        await supabase.from('logs_sistema').insert(logs)
      }
    }

    // 6. Fechar folhas de ponto expiradas
    if (expiredTimesheets.length > 0) {
      const tsIds = expiredTimesheets.map(t => t.id)
      const { error: updateTsError } = await supabase
        .from('folha_ponto')
        .update({ status: 'Revisada' })
        .in('id', tsIds)

      if (updateTsError) {
        console.error('Erro ao fechar folhas de ponto expiradas:', updateTsError)
      } else {
        // Obter informações extras de escalas para logs
        const scaleMap = new Map<string, any>()
        const scaleIdsToFetch = expiredTimesheets
          .map(t => t.escala_mensal_id)
          .filter(id => !openScales.find(s => s.id === id))

        if (scaleIdsToFetch.length > 0) {
          const { data: fetchedScales } = await supabase
            .from('escala_mensal')
            .select('id, mes, ano, unidade_id, setor_id, servidor_id')
            .in('id', scaleIdsToFetch)
          
          fetchedScales?.forEach(s => scaleMap.set(s.id, s))
        }
        openScales.forEach(s => scaleMap.set(s.id, s))

        const logs = expiredTimesheets.map(ts => {
          const scale = scaleMap.get(ts.escala_mensal_id)
          return {
            acao: 'Folha de Ponto Fechada Automaticamente (Prazo Expirado)',
            detalhes: {
              folha_ponto_id: ts.id,
              escala_mensal_id: ts.escala_mensal_id,
              mes: ts.mes,
              ano: ts.ano,
              servidor_id: ts.servidor_id,
              dias_inativacao: diasInativacao
            },
            unidade_id: scale?.unidade_id || null,
            setor_id: scale?.setor_id || null
          }
        })

        await supabase.from('logs_sistema').insert(logs)
      }
    }

    return { 
      success: true, 
      closedScales: expiredScales.length, 
      closedTimesheets: expiredTimesheets.length 
    }
  } catch (error: any) {
    console.error('Exceção em autoCloseExpiredScalesAndTimesheets:', error)
    return { success: false, error: error.message }
  }
}

export async function toggleCompetencyClosure(mes: number, ano: number, lock: boolean) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Não autenticado')

    // Verificar se o usuário é super_admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'super_admin') {
      throw new Error('Apenas o Administrador Geral pode gerenciar o encerramento de competências.')
    }

    const adminSupabase = await createAdminClient()
    const { data: config } = await adminSupabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'competencias_encerradas')
      .single()

    let closed = Array.isArray(config?.valor) ? config.valor : []
    if (lock) {
      if (!closed.some((p: any) => p.mes === mes && p.ano === ano)) {
        closed.push({ 
          mes, 
          ano, 
          encerrado_por: user.id, 
          encerrado_em: new Date().toISOString() 
        })
      }
    } else {
      closed = closed.filter((p: any) => !(p.mes === mes && p.ano === ano))
    }

    const { error } = await adminSupabase
      .from('configuracoes_globais')
      .upsert({
        chave: 'competencias_encerradas',
        valor: closed,
        updated_at: new Date().toISOString()
      }, { onConflict: 'chave' })

    if (error) throw error
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao gerenciar encerramento de competência:', error)
    return { error: error.message }
  }
}

export async function isCompetencyClosed(mes: number, ano: number): Promise<boolean> {
  try {
    const supabase = await createAdminClient()
    const { data: config } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'competencias_encerradas')
      .single()

    const closed = Array.isArray(config?.valor) ? config.valor : []
    return closed.some((p: any) => p.mes === mes && p.ano === ano)
  } catch {
    return false;
  }
}
