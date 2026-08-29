'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const AUTH_ERRORS_PT: Record<string, string> = {
  'User already registered': 'Este e-mail já está cadastrado no sistema.',
  'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
  'Invalid email': 'E-mail inválido.',
}

function translateError(error: string): string {
  return AUTH_ERRORS_PT[error] || error
}

// O nome do setor mora em dicionario_setores (setores guarda so' o dicionario_setor_id), entao
// renomear um setor e' resolver/criar a entrada do dicionario. A ESCRITA nessa tabela e' restrita
// a admin/super_admin pela policy "Permitir gerenciamento de setores para administradores"
// (20260523000000); a LEITURA e' liberada a todos ("Permitir leitura para todos").
//
// Por isso aqui e' SELECT primeiro, INSERT so' quando o nome e' realmente novo. O
// `upsert({ nome }, { onConflict: 'nome' })` que existia antes emitia INSERT ... ON CONFLICT em
// TODOS os casos, entao ate escolher um nome JA padronizado (o caso dominante — e' o que a lista
// de sugestoes do formulario induz) era recusado pela RLS para coordenador/RH. Com o SELECT na
// frente, renomear para um nome existente passa a funcionar para qualquer perfil que ja edite
// setor, e a exigencia de administrador fica onde ela realmente significa algo: criar um nome
// novo no dicionario municipal.
//
// ⚠️ Nao trocar por upsert de novo sem repor equivalente: o modo de falha era silencioso dos dois
// lados (a action devolvia { error } e o formulario descartava o retorno, ver EditSetorForm).
async function resolverDicionarioSetor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nomeBruto: string
): Promise<{ id: string } | { error: string }> {
  const nome = (nomeBruto || '').trim()
  if (!nome) {
    return { error: 'Informe o nome do setor.' }
  }

  const { data: existente, error: buscaError } = await supabase
    .from('dicionario_setores')
    .select('id')
    .eq('nome', nome)
    .maybeSingle()

  if (buscaError) {
    return { error: 'Erro ao consultar o dicionário de setores: ' + buscaError.message }
  }
  if (existente) {
    return { id: existente.id }
  }

  const { data: criado, error: criaError } = await supabase
    .from('dicionario_setores')
    .insert({ nome })
    .select('id')
    .single()

  if (criaError) {
    // Corrida: outro salvamento criou o mesmo nome entre o SELECT e o INSERT. Reler resolve sem
    // devolver erro para quem so' queria usar o nome.
    const { data: recuperado } = await supabase
      .from('dicionario_setores')
      .select('id')
      .eq('nome', nome)
      .maybeSingle()
    if (recuperado) {
      return { id: recuperado.id }
    }

    // 42501 = insufficient_privilege (RLS). Sem esta traducao o usuario recebe o texto cru do
    // Postgres e nao tem como saber que basta escolher um nome ja existente na lista.
    if (criaError.code === '42501') {
      return {
        error: `"${nome}" ainda não existe no dicionário municipal de setores, e apenas ` +
          `administradores podem cadastrar um nome novo. Escolha um nome já padronizado na ` +
          `lista de sugestões ou peça a um administrador para cadastrar este.`
      }
    }
    return { error: 'Erro ao processar dicionário de setores: ' + criaError.message }
  }

  return { id: criado.id }
}

export async function createSetor(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const unidade_id = formData.get('unidade_id') as string
  const parent_id = formData.get('parent_id') as string

  const parseStaffingField = (val: any) => {
    if (val === null || val === undefined || val === '') return null
    const p = parseInt(val, 10)
    return isNaN(p) ? null : p
  }

  const servidores_manha_min = parseStaffingField(formData.get('servidores_manha_min'))
  const servidores_manha_ideal = parseStaffingField(formData.get('servidores_manha_ideal'))
  const servidores_manha_max = parseStaffingField(formData.get('servidores_manha_max'))

  const servidores_tarde_min = parseStaffingField(formData.get('servidores_tarde_min'))
  const servidores_tarde_ideal = parseStaffingField(formData.get('servidores_tarde_ideal'))
  const servidores_tarde_max = parseStaffingField(formData.get('servidores_tarde_max'))

  const servidores_noite_min = parseStaffingField(formData.get('servidores_noite_min'))
  const servidores_noite_ideal = parseStaffingField(formData.get('servidores_noite_ideal'))
  const servidores_noite_max = parseStaffingField(formData.get('servidores_noite_max'))

  const dimensionamento_fds_feriados = formData.get('dimensionamento_fds_feriados') === 'true'
  const essencial = formData.get('essencial') === 'true'

  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = (latitude !== null && longitude !== null && formData.get('raio_geofence')) ? parseInt(formData.get('raio_geofence') as string) : null

  // 1. Garantir que o nome existe no dicionário
  const dict = await resolverDicionarioSetor(supabase, nome)
  if ('error' in dict) {
    return { error: dict.error }
  }

  const id = crypto.randomUUID()
  const logoFile = formData.get('logo') as File | null
  let logo_url = null

  if (logoFile && logoFile.size > 0) {
    const fileExt = logoFile.name.split('.').pop()
    const fileName = `setor_${id}.${fileExt}`
    const buffer = Buffer.from(await logoFile.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(fileName, buffer, {
        contentType: logoFile.type,
        upsert: true
      })

    if (uploadError) {
      return { error: 'Erro ao fazer upload do logo: ' + uploadError.message }
    }

    const { data: { publicUrl } } = supabase.storage
      .from('logos')
      .getPublicUrl(fileName)

    logo_url = publicUrl
  }

  // 2. Inserir o setor vinculado ao dicionário
  const { error } = await supabase.from('setores').insert({
    id,
    unidade_id,
    dicionario_setor_id: dict.id,
    parent_id: parent_id || null,
    logo_url,
    servidores_manha_min,
    servidores_manha_ideal,
    servidores_manha_max,
    servidores_tarde_min,
    servidores_tarde_ideal,
    servidores_tarde_max,
    servidores_noite_min,
    servidores_noite_ideal,
    servidores_noite_max,
    dimensionamento_fds_feriados,
    essencial,
    latitude,
    longitude,
    raio_geofence
  })

  if (error) {
    return { error: translateError(error.message) }
  }

  revalidatePath('/setores')
  redirect('/setores')
}

export async function updateSetor(id: string, formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const unidade_id = formData.get('unidade_id') as string
  const parent_id = formData.get('parent_id') as string

  const parseStaffingField = (val: any) => {
    if (val === null || val === undefined || val === '') return null
    const p = parseInt(val, 10)
    return isNaN(p) ? null : p
  }

  const servidores_manha_min = parseStaffingField(formData.get('servidores_manha_min'))
  const servidores_manha_ideal = parseStaffingField(formData.get('servidores_manha_ideal'))
  const servidores_manha_max = parseStaffingField(formData.get('servidores_manha_max'))

  const servidores_tarde_min = parseStaffingField(formData.get('servidores_tarde_min'))
  const servidores_tarde_ideal = parseStaffingField(formData.get('servidores_tarde_ideal'))
  const servidores_tarde_max = parseStaffingField(formData.get('servidores_tarde_max'))

  const servidores_noite_min = parseStaffingField(formData.get('servidores_noite_min'))
  const servidores_noite_ideal = parseStaffingField(formData.get('servidores_noite_ideal'))
  const servidores_noite_max = parseStaffingField(formData.get('servidores_noite_max'))

  const dimensionamento_fds_feriados = formData.get('dimensionamento_fds_feriados') === 'true'
  const essencial = formData.get('essencial') === 'true'

  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = (latitude !== null && longitude !== null && formData.get('raio_geofence')) ? parseInt(formData.get('raio_geofence') as string) : null

  // 1. Garantir que o nome existe no dicionário
  const dict = await resolverDicionarioSetor(supabase, nome)
  if ('error' in dict) {
    return { error: dict.error }
  }

  const updateData: any = {
    unidade_id,
    dicionario_setor_id: dict.id,
    parent_id: parent_id || null,
    servidores_manha_min,
    servidores_manha_ideal,
    servidores_manha_max,
    servidores_tarde_min,
    servidores_tarde_ideal,
    servidores_tarde_max,
    servidores_noite_min,
    servidores_noite_ideal,
    servidores_noite_max,
    dimensionamento_fds_feriados,
    essencial,
    latitude,
    longitude,
    raio_geofence
  }

  // Abrangência do sobreaviso — Fase 6b do plano
  // docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
  //
  // "geral" abre o acionamento deste sobreaviso para qualquer coordenador da secretaria. É a
  // chave que tira a proteção de escopo, então só super_admin/admin mexe. Quando o campo não
  // vem no formulário (coordenador editando), a coluna não entra no update e fica como está —
  // e não vira 'unidade' por omissão.
  // Três estados: 'herda' grava NULL (a precedência cai para a unidade), 'true'/'false' sobrepõem.
  // Campo ausente no formulário não entra no update — não pode virar NULL por omissão.
  const avisoPontoEnviado = formData.get('aviso_ponto_whatsapp') as string | null
  if (avisoPontoEnviado === 'herda') {
    updateData.aviso_ponto_whatsapp = null
  } else if (avisoPontoEnviado === 'true' || avisoPontoEnviado === 'false') {
    updateData.aviso_ponto_whatsapp = avisoPontoEnviado === 'true'
  }

  const abrangenciaEnviada = formData.get('sobreaviso_abrangencia') as string | null
  if (abrangenciaEnviada === 'geral' || abrangenciaEnviada === 'unidade') {
    const { data: { user: editor } } = await supabase.auth.getUser()
    const { data: perfilEditor } = await supabase
      .from('profiles').select('role').eq('id', editor?.id).single()

    if (perfilEditor && ['super_admin', 'admin'].includes(perfilEditor.role)) {
      updateData.sobreaviso_abrangencia = abrangenciaEnviada
    }
  }

  const removeLogo = formData.get('remove_logo') === 'true'
  if (removeLogo) {
    updateData.logo_url = null
  } else {
    const logoFile = formData.get('logo') as File | null
    if (logoFile && logoFile.size > 0) {
      const fileExt = logoFile.name.split('.').pop()
      const fileName = `setor_${id}.${fileExt}`
      const buffer = Buffer.from(await logoFile.arrayBuffer())

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, buffer, {
          contentType: logoFile.type,
          upsert: true
        })

      if (uploadError) {
        return { error: 'Erro ao fazer upload do logo: ' + uploadError.message }
      }

      const { data: { publicUrl } } = supabase.storage
        .from('logos')
        .getPublicUrl(fileName)

      updateData.logo_url = publicUrl
    }
  }

  const { error } = await supabase
    .from('setores')
    .update(updateData)
    .eq('id', id)

  if (error) {
    return { error: translateError(error.message) }
  }

  revalidatePath('/setores')
  redirect('/setores')
}

export async function toggleStatusSetor(id: string, currentStatus: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('setores')
    .update({ ativo: !currentStatus })
    .eq('id', id)

  if (error) {
    return { error: translateError(error.message) }
  }

  revalidatePath('/setores')
  redirect('/setores')
}



/**
 * Exclui um setor — Administrador Geral apenas, e so' quando nada o referencia.
 *
 * A validacao de verdade mora no banco (`fn_excluir_setor`, migration 20260827010000), que
 * varre pg_constraint e recusa se qualquer tabela ainda apontar para o setor. Aqui a checagem
 * de papel e' repetida de proposito: server action e' um POST cujo id sai no bundle, entao a
 * tela esconder o botao nunca foi a defesa (armadilha 12 do CLAUDE.md).
 *
 * Diferente das demais actions deste arquivo, NAO faz redirect no caminho de erro: a tela
 * precisa mostrar quais vinculos impedem a exclusao.
 */
export async function excluirSetor(id: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Sessão expirada. Entre novamente.' }
  }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (perfil?.role !== 'super_admin') {
    return { error: 'Apenas o Administrador Geral pode excluir setores.' }
  }

  const { error } = await supabase.rpc('fn_excluir_setor', { p_setor_id: id })

  if (error) {
    return { error: translateError(error.message) }
  }

  revalidatePath('/setores')
  return { success: true }
}

/**
 * O que ainda segura este setor, por (tabela, coluna) — a mesma lista que a recusa da exclusão
 * traz, só que ANTES de tentar, para a tela poder oferecer a saída (transferir para outro setor)
 * em vez de só informar o bloqueio.
 */
export async function listarDependenciasSetor(id: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sessão expirada. Entre novamente.' }

  const { data: perfil } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (perfil?.role !== 'super_admin') {
    return { error: 'Apenas o Administrador Geral pode excluir setores.' }
  }

  const { data, error } = await supabase.rpc('fn_dependencias_setor', { p_setor_id: id })
  if (error) return { error: translateError(error.message) }

  return { dependencias: (data || []) as { tabela: string; coluna: string; qtd: number; truncado: boolean }[] }
}

/**
 * O que impede fundir este setor no destino escolhido. Consultado a cada troca do <select> para
 * o Administrador ver o problema enquanto ainda pode trocar o destino — a mesma checagem roda de
 * novo dentro de fn_fundir_setor, que é quem de fato decide.
 */
export async function verificarFusaoSetor(id: string, destinoId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sessão expirada. Entre novamente.' }

  const { data, error } = await supabase.rpc('fn_impedimentos_fusao_setor', {
    p_origem: id,
    p_destino: destinoId,
  })
  if (error) return { error: translateError(error.message) }

  return { impedimentos: (data || []) as { motivo: string; detalhe: string }[] }
}

/**
 * Transfere TODO vínculo do setor para outro setor da mesma unidade e então exclui o setor.
 *
 * ⚠️ Não é exclusão em cascata, e a diferença é o ponto: as FKs que apontam para setores são
 * metade CASCADE e metade SET NULL, então apagar direto apagaria escala e marcação de ponto —
 * prova legal (Portaria 671/2021) — sem avisar. Aqui nada é apagado: o dono muda.
 *
 * A regra inteira mora em fn_fundir_setor (migration 20260829110000). A checagem de papel é
 * repetida aqui porque server action é um POST cujo id sai no bundle (armadilha 12).
 */
export async function fundirEExcluirSetor(id: string, destinoId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sessão expirada. Entre novamente.' }

  const { data: perfil } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (perfil?.role !== 'super_admin') {
    return { error: 'Apenas o Administrador Geral pode excluir setores.' }
  }

  if (!destinoId || destinoId === id) {
    return { error: 'Escolha um setor de destino diferente para receber os vínculos.' }
  }

  const { data, error } = await supabase.rpc('fn_fundir_setor', {
    p_origem: id,
    p_destino: destinoId,
  })

  if (error) return { error: translateError(error.message) }

  revalidatePath('/setores')
  return { success: true, resultado: data }
}
