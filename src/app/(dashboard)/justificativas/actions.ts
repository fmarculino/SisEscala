'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { UserProfile, applyAccessFilters } from '@/utils/permissions'

async function getUserProfile(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Perfil de usuário não encontrado')

  return {
    ...profile,
    userEmail: user.email || '',
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
  }
}

export async function getEventosPendentes(params: {
  unidadeId: string
  setorId?: string
  mes?: number
  ano?: number
  categoria?: string
  status?: string
  page?: number
  perPage?: number
}) {
  try {
    const supabase = await createClient()
    await getUserProfile(supabase)

    const { data, error } = await supabase.rpc('fn_listar_eventos_pendentes_justificativa', {
      p_unidade_id: params.unidadeId,
      p_setor_id: params.setorId || null,
      p_mes: params.mes || null,
      p_ano: params.ano || null,
      p_categoria: params.categoria || 'todos',
      p_status: params.status || 'todos',
      p_page: params.page || 1,
      p_per_page: params.perPage || 20
    })

    if (error) {
      console.error('Erro em fn_listar_eventos_pendentes_justificativa:', error)
      return { error: error.message }
    }

    return { data }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function salvarJustificativa(dados: {
  escalaDiariaId: string
  servidorId: string
  escalaMensalId: string
  dia: number
  mes: number
  ano: number
  categoria: string
  texto: string
  justificativaPadraoId?: string
}) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    const { data, error } = await supabase.rpc('fn_salvar_justificativa_evento', {
      p_escala_diaria_id: dados.escalaDiariaId,
      p_servidor_id: dados.servidorId,
      p_escala_mensal_id: dados.escalaMensalId,
      p_dia: dados.dia,
      p_mes: dados.mes,
      p_ano: dados.ano,
      p_categoria: dados.categoria,
      p_texto: dados.texto,
      p_justificativa_padrao_id: dados.justificativaPadraoId || null,
      p_user_id: profile.id,
      p_user_nome: profile.full_name || profile.userEmail || profile.id
    })

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/justificativas')
    return { success: true, data }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function salvarJustificativasBulk(eventos: Array<{
  escala_diaria_id: string
  servidor_id: string
  escala_mensal_id: string
  dia: number
  mes: number
  ano: number
  categoria: string
  texto: string
  justificativa_padrao_id?: string
}>) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    const { data, error } = await supabase.rpc('fn_salvar_justificativas_bulk', {
      p_eventos: eventos,
      p_user_id: profile.id,
      p_user_nome: profile.full_name || profile.userEmail || profile.id
    })

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/justificativas')
    return { success: true, data }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function validarSugestao(params: {
  justificativaId: string
  acao: 'aprovar' | 'rejeitar'
  textoEditado?: string
  motivoRejeicao?: string
}) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    const { data, error } = await supabase.rpc('fn_validar_sugestao_justificativa', {
      p_justificativa_id: params.justificativaId,
      p_acao: params.acao,
      p_texto_editado: params.textoEditado || null,
      p_motivo_rejeicao: params.motivoRejeicao || null,
      p_user_id: profile.id,
      p_user_nome: profile.full_name || profile.userEmail || profile.id
    })

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/justificativas')
    return { success: true, data }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function getTemplatesPadrao(unidadeId?: string, setorId?: string) {
  try {
    const supabase = await createClient()
    await getUserProfile(supabase)

    let query = supabase
      .from('justificativas_padrao')
      .select('*, unidades(nome), setores(dicionario_setores(nome))')
      .eq('ativo', true)
      .order('titulo')

    if (unidadeId) {
      query = query.or(`unidade_id.is.null,unidade_id.eq.${unidadeId}`)
    }

    const { data, error } = await query

    if (error) {
      return { error: error.message }
    }

    return { templates: data || [] }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function salvarTemplatePadrao(dados: {
  id?: string
  unidadeId?: string
  setorId?: string
  titulo: string
  texto: string
  categoria?: string
  ativo?: boolean
}) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    const payload = {
      unidade_id: dados.unidadeId || null,
      setor_id: dados.setorId || null,
      titulo: dados.titulo,
      texto: dados.texto,
      categoria: dados.categoria || null,
      ativo: dados.ativo ?? true,
      criado_por_id: profile.id,
      updated_at: new Date().toISOString()
    }

    let result
    if (dados.id) {
      result = await supabase
        .from('justificativas_padrao')
        .update(payload)
        .eq('id', dados.id)
    } else {
      result = await supabase
        .from('justificativas_padrao')
        .insert(payload)
    }

    if (result.error) {
      return { error: result.error.message }
    }

    revalidatePath('/justificativas')
    return { success: true }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function toggleTemplatePadrao(id: string, ativo: boolean) {
  try {
    const supabase = await createClient()
    await getUserProfile(supabase)

    const { error } = await supabase
      .from('justificativas_padrao')
      .update({ ativo, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/justificativas')
    return { success: true }
  } catch (err: any) {
    return { error: err.message }
  }
}
