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

export async function excluirTerminalLocal(id: string) {
  await exigirAdmin()
  // Terminal local nao e referenciado por marcacoes_ponto nem por nenhuma outra tabela — a
  // marcacao gravada por ele carrega origem 'terminal', igual ao terminal classico, sem FK para
  // terminais_locais.id. Exclusao e sempre segura, ao contrario de dispositivos_rep.
  const supabase = await createAdminClient()
  const { error } = await supabase.from('terminais_locais').delete().eq('id', id)
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
      // senha_rep NAO entra aqui de proposito - a lista alimenta o estado do componente client,
      // e nao ha motivo para o valor em texto claro trafegar ate o navegador so para preencher
      // uma lista. O modal de edicao nunca preenche o campo de senha de volta (ver DispositivoRepModal).
      'id, nome, unidade_id, setor_id, numero_serie, endereco_ip, modo_operacao, ativo, '
      + 'usuario_rep, porta, usa_https, '
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
  const usuario_rep = String(formData.get('usuario_rep') || 'admin').trim() || 'admin'
  const senha_rep = String(formData.get('senha_rep') || '').trim() || null
  const porta = Number(formData.get('porta') || 443) || 443
  const usa_https = formData.get('usa_https') !== 'false'
  return { nome, unidade_id, setor_id, numero_serie, endereco_ip, modo_operacao, usuario_rep, senha_rep, porta, usa_https }
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
  const campos: any = lerCamposDispositivo(formData)
  if (!campos.nome || !campos.unidade_id) {
    return { error: 'Nome e unidade são obrigatórios.' }
  }
  const ativo = formData.get('ativo') === 'true'
  // Campo de senha vem em branco quando o admin nao digitou uma nova (o valor salvo nunca e
  // reenviado ao formulario) - omitir do update preserva a senha ja gravada em vez de apagar.
  if (campos.senha_rep === null) delete campos.senha_rep

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('dispositivos_rep')
    .update({ ...campos, ativo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { success: true }
}

export async function excluirDispositivoRep(id: string) {
  await exigirAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from('dispositivos_rep').delete().eq('id', id)
  if (error) {
    // rep_afd_registros/rep_sincronizacoes/marcacoes_ponto referenciam dispositivo_id sem
    // ON DELETE CASCADE de proposito (registro legal de ponto, retido por 5 anos — CLAUDE.md).
    // O Postgres recusa com violacao de FK (23503); a mensagem crua nao diz isso a um admin.
    if (error.code === '23503') {
      return {
        error: 'Este dispositivo já tem marcações de ponto ou histórico de sincronização registrados — '
          + 'não pode ser excluído (o registro é legalmente retido). Desative-o em vez de excluir.',
      }
    }
    return { error: error.message }
  }

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
// Push de cadastro (identidade) para o rele - Fase 7, parte de identidade
// ============================================================================
// A biometria em si nunca passa por aqui - sempre exige alguem presencial no equipamento.
// Isto so prepara matricula/nome/CPF no rele antes disso.

export async function enfileirarCadastrosRep(dispositivoId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data, error } = await supabase.rpc('fn_enfileirar_cadastros_rep', { p_dispositivo_id: dispositivoId })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return data as { enfileirados: number; sem_cpf: number; ja_vinculados: number }
}

export async function listarPendenciasBiometria() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_pendencias_biometria', { p_dispositivo_id: null })
  if (error) throw new Error(error.message)
  return data || []
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
