'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

async function exigirAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
    throw new Error('Apenas administradores podem gerenciar dispositivos e terminais.')
  }
  return user
}

// ============================================================================
// Opções compartilhadas pelos formulários (unidades, setores, coordenadores)
// ============================================================================

export async function listarOpcoesFormulario() {
  await exigirAdmin()
  const supabase = await createAdminClient()

  const [{ data: unidades }, { data: setores }, { data: coordenadores }] = await Promise.all([
    supabase.from('unidades').select('id, nome').order('nome'),
    supabase.from('setores').select('id, unidade_id, dicionario_setores(nome)').eq('ativo', true),
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['coordenador', 'admin', 'super_admin', 'ass_adm'])
      .order('full_name'),
  ])

  return {
    unidades: unidades || [],
    setores: (setores || []).map((s: any) => ({
      id: s.id,
      unidade_id: s.unidade_id,
      nome: s.dicionario_setores?.nome || '(sem nome)',
    })),
    coordenadores: coordenadores || [],
  }
}

// ============================================================================
// Terminais locais
// ============================================================================

export async function listarTerminaisLocais() {
  await exigirAdmin()
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('terminais_locais')
    .select(
      'id, nome, unidade_id, setor_id, responsavel_coordenador_id, ativo, ultimo_contato_em, created_at, '
      + 'unidades(nome), setores(dicionario_setores(nome)), '
      + 'profiles!terminais_locais_responsavel_coordenador_id_fkey(full_name)'
    )
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data || []
}

function lerCamposTerminal(formData: FormData) {
  const nome = String(formData.get('nome') || '').trim()
  const unidade_id = String(formData.get('unidade_id') || '')
  const setor_id = String(formData.get('setor_id') || '') || null
  const responsavel_coordenador_id = String(formData.get('responsavel_coordenador_id') || '')
  return { nome, unidade_id, setor_id, responsavel_coordenador_id }
}

export async function criarTerminalLocal(formData: FormData) {
  await exigirAdmin()
  const campos = lerCamposTerminal(formData)
  if (!campos.nome || !campos.unidade_id || !campos.responsavel_coordenador_id) {
    return { error: 'Nome, unidade e responsável são obrigatórios.' }
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase.from('terminais_locais').insert(campos).select('id').single()
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { id: data.id }
}

export async function atualizarTerminalLocal(id: string, formData: FormData) {
  await exigirAdmin()
  const campos = lerCamposTerminal(formData)
  if (!campos.nome || !campos.unidade_id || !campos.responsavel_coordenador_id) {
    return { error: 'Nome, unidade e responsável são obrigatórios.' }
  }
  const ativo = formData.get('ativo') === 'true'

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('terminais_locais')
    .update({ ...campos, ativo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { success: true }
}

export async function gerarTokenTerminalLocal(id: string) {
  await exigirAdmin()
  // Precisa da sessão do usuário (não createAdminClient): fn_gerar_token_terminal_local lê
  // auth.uid() para registrar quem gerou o token.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_gerar_token_terminal_local', { p_terminal_id: id })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { token: data as string }
}

// ============================================================================
// Dispositivos REP
// ============================================================================

export async function listarDispositivosRep() {
  await exigirAdmin()
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('dispositivos_rep')
    .select(
      'id, nome, unidade_id, setor_id, numero_serie, endereco_ip, modo_operacao, ativo, '
      + 'ultimo_nsr, ultimo_contato_em, deriva_segundos, created_at, unidades(nome), setores(dicionario_setores(nome))'
    )
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data || []
}

function lerCamposDispositivo(formData: FormData) {
  const nome = String(formData.get('nome') || '').trim()
  const unidade_id = String(formData.get('unidade_id') || '')
  const setor_id = String(formData.get('setor_id') || '') || null
  const numero_serie = String(formData.get('numero_serie') || '').trim() || null
  const endereco_ip = String(formData.get('endereco_ip') || '').trim() || null
  const modo_operacao = String(formData.get('modo_operacao') || 'pull')
  return { nome, unidade_id, setor_id, numero_serie, endereco_ip, modo_operacao }
}

export async function criarDispositivoRep(formData: FormData) {
  await exigirAdmin()
  const campos = lerCamposDispositivo(formData)
  if (!campos.nome || !campos.unidade_id) {
    return { error: 'Nome e unidade são obrigatórios.' }
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase.from('dispositivos_rep').insert(campos).select('id').single()
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { id: data.id }
}

export async function atualizarDispositivoRep(id: string, formData: FormData) {
  await exigirAdmin()
  const campos = lerCamposDispositivo(formData)
  if (!campos.nome || !campos.unidade_id) {
    return { error: 'Nome e unidade são obrigatórios.' }
  }
  const ativo = formData.get('ativo') === 'true'

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('dispositivos_rep')
    .update({ ...campos, ativo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { success: true }
}

export async function gerarTokenDispositivoRep(id: string) {
  await exigirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_gerar_token_dispositivo_rep', { p_dispositivo_id: id })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { token: data as string }
}

// ============================================================================
// Pendências (marcações do terminal fora da janela prevista)
// ============================================================================

export async function listarPendencias() {
  // fn_marcacoes_pendentes_revisao já filtra por fn_unidade_no_escopo internamente - coordenador
  // e admin veem só o que está no escopo deles, sem checagem adicional aqui.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_marcacoes_pendentes_revisao', {
    p_unidade_id: null,
    p_setor_id: null,
    p_desde: null,
  })
  if (error) throw new Error(error.message)
  return data || []
}

/** Escalas do servidor naquele dia que ainda podem receber a marcação pendente. */
export async function buscarEscalasCandidatas(servidorId: string, ocorridoEmIso: string) {
  const supabase = await createAdminClient()
  const dataOcorrido = new Date(ocorridoEmIso)
  const dia = dataOcorrido.getDate()
  const mes = dataOcorrido.getMonth() + 1
  const ano = dataOcorrido.getFullYear()

  const { data, error } = await supabase
    .from('escala_diaria')
    .select('id, categoria, presenca_confirmada, dicionario_turnos(codigo), escala_mensal!inner(servidor_id, mes, ano)')
    .eq('dia', dia)
    .eq('escala_mensal.servidor_id', servidorId)
    .eq('escala_mensal.mes', mes)
    .eq('escala_mensal.ano', ano)
    .in('categoria', ['Regular', 'Plantão', 'Extra'])

  if (error) throw new Error(error.message)
  return (data || []).map((e: any) => ({
    id: e.id,
    categoria: e.categoria,
    turno_codigo: e.dicionario_turnos?.codigo || null,
    presenca_confirmada: e.presenca_confirmada,
  }))
}

export async function aceitarMarcacaoPendente(input: {
  marcacaoId: string
  escalaDiariaId: string
  passo: string
  justificativa: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data, error } = await supabase.rpc('fn_aceitar_marcacao_pendente', {
    p_marcacao_id: input.marcacaoId,
    p_escala_diaria_id: input.escalaDiariaId,
    p_passo: input.passo,
    p_validador_id: user.id,
    p_justificativa: input.justificativa,
  })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return Array.isArray(data) ? data[0] : data
}
