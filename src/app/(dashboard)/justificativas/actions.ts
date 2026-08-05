'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
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
    const supabase = await createAdminClient()

    // 1. Fetch monthly scales matching unit, sector (if provided), month, year
    let queryMensal = supabase
      .from('escala_mensal')
      .select(`
        id, unidade_id, setor_id, mes, ano, servidor_id,
        servidores(id, nome, matricula),
        unidades(nome),
        setores(dicionario_setores(nome))
      `)
      .eq('unidade_id', params.unidadeId)

    if (params.setorId && params.setorId !== 'todos') {
      queryMensal = queryMensal.eq('setor_id', params.setorId)
    }
    if (params.mes) {
      queryMensal = queryMensal.eq('mes', params.mes)
    }
    if (params.ano) {
      queryMensal = queryMensal.eq('ano', params.ano)
    }

    const { data: escalasMensais, error: errMensal } = await queryMensal

    if (errMensal) {
      console.error('Erro ao buscar escalas mensais:', errMensal)
      return { error: errMensal.message }
    }

    if (!escalasMensais || escalasMensais.length === 0) {
      return {
        data: {
          total: 0,
          justificados: 0,
          pendentes: 0,
          sugestoes: 0,
          page: params.page || 1,
          per_page: params.perPage || 20,
          items: []
        }
      }
    }

    const escalaMensalIds = escalasMensais.map(em => em.id)
    const emMap = new Map(escalasMensais.map(em => [em.id, em]))

    // 2. Fetch daily scale entries for these monthly scale IDs
    const { data: diarias, error: errDiarias } = await supabase
      .from('escala_diaria')
      .select(`
        id, dia, categoria, escala_mensal_id, dicionario_turnos_id,
        dicionario_turnos(codigo)
      `)
      .in('escala_mensal_id', escalaMensalIds)
      .order('dia', { ascending: true })

    if (errDiarias) {
      console.error('Erro ao buscar escala diaria:', errDiarias)
      return { error: errDiarias.message }
    }

    // Filter categories: Extra, Plantão, Sobreaviso (case and accent insensitive)
    const eventosDiarios = diarias?.filter(ed => {
      const cat = String(ed.categoria || '').toLowerCase()
      return cat.includes('extra') || cat.includes('plant') || cat.includes('sobreaviso')
    }) || []

    // Filter by specific category dropdown if selected
    const filteredByCategory = eventosDiarios.filter(ed => {
      if (!params.categoria || params.categoria === 'todos') return true
      const cat = String(ed.categoria || '').toLowerCase()
      const reqCat = String(params.categoria).toLowerCase()
      return cat.includes(reqCat) || reqCat.includes(cat)
    })

    // 3. Fetch existing justificativas_eventos for unit, month, year
    let queryJust = supabase
      .from('justificativas_eventos')
      .select('*')
      .eq('unidade_id', params.unidadeId)

    if (params.mes) queryJust = queryJust.eq('mes', params.mes)
    if (params.ano) queryJust = queryJust.eq('ano', params.ano)

    const { data: justificativas } = await queryJust

    const justMap = new Map()
    justificativas?.forEach(j => {
      const catStr = String(j.categoria || '').toLowerCase()
      justMap.set(`${j.servidor_id}-${j.dia}-${j.mes}-${j.ano}-${catStr}`, j)
    })

    // 4. Combine events with justification records
    const allCombinedItems = filteredByCategory.map(ed => {
      const em = emMap.get(ed.escala_mensal_id)
      const catStr = String(ed.categoria || '')
      const catLower = catStr.toLowerCase()
      const key = `${em?.servidor_id}-${ed.dia}-${em?.mes}-${em?.ano}-${catLower}`
      const just = justMap.get(key)

      const status = just ? just.status : 'pendente'

      const dictSetor = (em?.setores as any)?.dicionario_setores
      const setorNome = Array.isArray(dictSetor)
        ? dictSetor[0]?.nome
        : dictSetor?.nome

      return {
        escala_diaria_id: ed.id,
        escala_mensal_id: ed.escala_mensal_id,
        servidor_id: em?.servidor_id,
        servidor_nome: (em?.servidores as any)?.nome || '—',
        servidor_matricula: (em?.servidores as any)?.matricula || '—',
        dia: ed.dia,
        mes: em?.mes,
        ano: em?.ano,
        categoria: catStr,
        dicionario_turnos_id: ed.dicionario_turnos_id,
        turno_codigo: (ed.dicionario_turnos as any)?.codigo || '—',
        unidade_id: em?.unidade_id,
        setor_id: em?.setor_id,
        unidade_nome: (em?.unidades as any)?.nome || '—',
        setor_nome: setorNome || 'SETOR SEM NOME',
        justificativa_id: just?.id || null,
        texto_justificativa: just?.texto_justificativa || null,
        justificativa_origem: just?.origem || null,
        justificativa_status: status,
        registrado_por_nome: just?.registrado_por_nome || null,
        justificativa_created_at: just?.created_at || null
      }
    })

    // Aggregated KPI counts
    const total = allCombinedItems.length
    const justificados = allCombinedItems.filter(i => i.justificativa_status === 'aprovada').length
    const pendentes = allCombinedItems.filter(i => i.justificativa_status === 'pendente').length
    const sugestoes = allCombinedItems.filter(i => i.justificativa_status === 'sugestao_pendente').length

    // Filter by tab status if selected
    let finalItems = allCombinedItems
    if (params.status === 'pendentes') {
      finalItems = allCombinedItems.filter(i => i.justificativa_status === 'pendente')
    } else if (params.status === 'preenchidas') {
      finalItems = allCombinedItems.filter(i => i.justificativa_status === 'aprovada')
    } else if (params.status === 'sugestoes') {
      finalItems = allCombinedItems.filter(i => i.justificativa_status === 'sugestao_pendente')
    }

    // Sort by day ASC, then server name
    finalItems.sort((a, b) => a.dia - b.dia || a.servidor_nome.localeCompare(b.servidor_nome))

    // Pagination
    const page = params.page || 1
    const perPage = params.perPage || 20
    const startIndex = (page - 1) * perPage
    const paginatedItems = finalItems.slice(startIndex, startIndex + perPage)

    return {
      data: {
        total,
        justificados,
        pendentes,
        sugestoes,
        page,
        per_page: perPage,
        items: paginatedItems
      }
    }
  } catch (err: any) {
    console.error('Erro em getEventosPendentes:', err)
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
