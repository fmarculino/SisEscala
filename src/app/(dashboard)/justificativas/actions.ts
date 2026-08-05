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
  servidorId?: string
  mes?: number
  ano?: number
  categoria?: string
  status?: string
  page?: number
  perPage?: number
}) {
  try {
    const supabaseUser = await createClient()
    const userProfile = await getUserProfile(supabaseUser)

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

    // Apply strict access permissions (Super Admin = tudo, Coordenador/Admin = apenas suas unidades/setores)
    queryMensal = applyAccessFilters(queryMensal, userProfile)

    if (params.unidadeId) {
      queryMensal = queryMensal.eq('unidade_id', params.unidadeId)
    }

    if (params.setorId && params.setorId !== 'todos') {
      queryMensal = queryMensal.eq('setor_id', params.setorId)
    }

    if (params.servidorId && params.servidorId !== 'todos') {
      queryMensal = queryMensal.eq('servidor_id', params.servidorId)
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
    const supabaseUser = await createClient()
    const profile = await getUserProfile(supabaseUser)
    const supabase = await createAdminClient()

    const userName = profile.full_name || profile.userEmail || profile.id

    // Fetch unit and sector from monthly scale
    const { data: mensal } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id')
      .eq('id', dados.escalaMensalId)
      .single()

    const payload = {
      escala_diaria_id: dados.escalaDiariaId,
      servidor_id: dados.servidorId,
      escala_mensal_id: dados.escalaMensalId,
      unidade_id: mensal?.unidade_id || null,
      setor_id: mensal?.setor_id || null,
      dia: dados.dia,
      mes: dados.mes,
      ano: dados.ano,
      categoria: dados.categoria,
      texto_justificativa: dados.texto,
      justificativa_padrao_id: dados.justificativaPadraoId || null,
      origem: 'coordenador',
      status: 'aprovada',
      registrado_por_id: profile.id,
      registrado_por_nome: userName,
      validado_por_id: profile.id,
      validado_por_nome: userName,
      data_validacao: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('justificativas_eventos')
      .upsert(payload, { onConflict: 'servidor_id,dia,mes,ano,categoria' })
      .select()

    if (error) {
      return { error: error.message }
    }

    // Try logging silently
    try {
      await supabase.from('logs_sistema').insert({
        user_id: profile.id,
        acao: 'JUSTIFICATIVA_REGISTRADA',
        unidade_id: mensal?.unidade_id || null,
        setor_id: mensal?.setor_id || null,
        detalhes: {
          servidor_id: dados.servidorId,
          dia: dados.dia,
          mes: dados.mes,
          ano: dados.ano,
          categoria: dados.categoria,
          registrado_por: userName
        }
      })
    } catch (logErr) {
      console.warn('Erro ao gravar log de auditoria:', logErr)
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
    const supabaseUser = await createClient()
    const profile = await getUserProfile(supabaseUser)
    const supabase = await createAdminClient()

    const userName = profile.full_name || profile.userEmail || profile.id
    const nowIso = new Date().toISOString()

    // Map monthly scale IDs to get unit_id and setor_id
    const mensalIds = Array.from(new Set(eventos.map(e => e.escala_mensal_id)))
    const { data: mensais } = await supabase
      .from('escala_mensal')
      .select('id, unidade_id, setor_id')
      .in('id', mensalIds)

    const mensalMap = new Map((mensais || []).map(m => [m.id, m]))

    const payloads = eventos.map(e => {
      const m = mensalMap.get(e.escala_mensal_id)
      return {
        escala_diaria_id: e.escala_diaria_id,
        servidor_id: e.servidor_id,
        escala_mensal_id: e.escala_mensal_id,
        unidade_id: m?.unidade_id || null,
        setor_id: m?.setor_id || null,
        dia: e.dia,
        mes: e.mes,
        ano: e.ano,
        categoria: e.categoria,
        texto_justificativa: e.texto,
        justificativa_padrao_id: e.justificativa_padrao_id || null,
        origem: 'coordenador',
        status: 'aprovada',
        registrado_por_id: profile.id,
        registrado_por_nome: userName,
        validado_por_id: profile.id,
        validado_por_nome: userName,
        data_validacao: nowIso,
        updated_at: nowIso
      }
    })

    const { data, error } = await supabase
      .from('justificativas_eventos')
      .upsert(payloads, { onConflict: 'servidor_id,dia,mes,ano,categoria' })
      .select()

    if (error) {
      return { error: error.message }
    }

    // Try logging audit
    try {
      await supabase.from('logs_sistema').insert({
        user_id: profile.id,
        acao: 'JUSTIFICATIVAS_BULK_REGISTRADAS',
        detalhes: {
          total: eventos.length,
          registrado_por: userName
        }
      })
    } catch (logErr) {
      console.warn('Erro log bulk:', logErr)
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
    const supabaseUser = await createClient()
    const profile = await getUserProfile(supabaseUser)
    const supabase = await createAdminClient()

    const userName = profile.full_name || profile.userEmail || profile.id
    const nowIso = new Date().toISOString()

    const updatePayload: any = {
      status: params.acao === 'aprovar' ? 'aprovada' : 'rejeitada',
      validado_por_id: profile.id,
      validado_por_nome: userName,
      data_validacao: nowIso,
      updated_at: nowIso
    }

    if (params.acao === 'aprovar' && params.textoEditado) {
      updatePayload.texto_justificativa = params.textoEditado
    }

    if (params.acao === 'rejeitar' && params.motivoRejeicao) {
      updatePayload.motivo_rejeicao = params.motivoRejeicao
    }

    const { data, error } = await supabase
      .from('justificativas_eventos')
      .update(updatePayload)
      .eq('id', params.justificativaId)
      .select()

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

    let { data, error } = await query

    if (error) {
      return { error: error.message }
    }

    // Auto-seed 3 default templates for each category (Hora Extra, Plantão, Sobreaviso) if none exist
    if (!data || data.length === 0) {
      const adminClient = await createAdminClient()
      const defaultTemplates = [
        // HORA EXTRA
        {
          titulo: 'Demanda Emergencial / Pico de Atendimento',
          texto: 'Convocação extraordinária para cobertura de alta demanda e atendimento emergencial durante período de pico assistencial.',
          categoria: 'Extra',
          ativo: true
        },
        {
          titulo: 'Substituição por Afastamento Médico',
          texto: 'Realização de jornada extraordinária para substituição de servidor afastado por motivo de atestado médico ou licença de saúde.',
          categoria: 'Extra',
          ativo: true
        },
        {
          titulo: 'Mutirão de Exames / Procedimentos',
          texto: 'Execução de horas extraordinárias para mutirão assistencial visando redução da fila de espera e cumprimento de metas.',
          categoria: 'Extra',
          ativo: true
        },
        // PLANTÃO
        {
          titulo: 'Plantão de Reforço em Finais de Semana / Feriados',
          texto: 'Cumprimento de escala de plantão presencial complementar para reforço da equipe assistencial em finais de semana ou feriados.',
          categoria: 'Plantão',
          ativo: true
        },
        {
          titulo: 'Substituição de Plantonista Faltoso',
          texto: 'Plantão extraordinário realizado para cobertura de ausência imprevisível de profissional plantonista, assegurando a escala mínima.',
          categoria: 'Plantão',
          ativo: true
        },
        {
          titulo: 'Ações Integradas de Saúde Pública',
          texto: 'Escala de plantão presencial direcionada ao atendimento em campanhas especiais de vacinação e ações integradas do município.',
          categoria: 'Plantão',
          ativo: true
        },
        // SOBREAVISO
        {
          titulo: 'Suporte de Prontidão à Distância',
          texto: 'Permanência do servidor em regime de sobreaviso à distância para pronto atendimento a chamados de urgência do setor.',
          categoria: 'Sobreaviso',
          ativo: true
        },
        {
          titulo: 'Sobreaviso Noturno e Finais de Semana',
          texto: 'Disponibilidade em regime de sobreaviso durante o período noturno e finais de semana para chamados emergenciais.',
          categoria: 'Sobreaviso',
          ativo: true
        },
        {
          titulo: 'Sobreaviso de Infraestrutura e TI',
          texto: 'Permanência de prontidão técnica em sobreaviso para atendimento a falhas críticas de infraestrutura, logística ou sistemas.',
          categoria: 'Sobreaviso',
          ativo: true
        }
      ]

      await adminClient.from('justificativas_padrao').insert(defaultTemplates)

      // Re-fetch after seeding
      const refetched = await query
      data = refetched.data || []
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
