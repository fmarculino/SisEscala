'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { randomUUID, createHash } from 'crypto'

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
// Higiene de cadastros do dispositivo REP (Fase 7b) - usuarios de outro sistema
// ============================================================================
// O rele chega usado por outro sistema antes do SisEscala, com cadastros de gente que pode nao
// fazer mais parte do quadro. A listagem (fn_higiene_usuarios_dispositivo) so' le' o snapshot que
// o coletor ja reportou (`coletor-rep higiene`/"Atualizar lista de cadastros do relogio" na
// bandeja) - nao aciona o rele direto (o servidor do SisEscala nao tem caminho ate a rede da
// unidade). Enfileirar remocao so' marca a intencao; quem aplica no equipamento e' o coletor,
// via `coletor-rep higiene-remover`.

export async function listarHigieneUsuariosDispositivo(dispositivoId: string) {
  await exigirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_higiene_usuarios_dispositivo', { p_dispositivo_id: dispositivoId })
  if (error) throw new Error(error.message)
  return data || []
}

export async function enfileirarRemocaoUsuariosDispositivo(dispositivoId: string, identificadoresAfd: string[]) {
  await exigirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_enfileirar_remocao_usuarios_dispositivo', {
    p_dispositivo_id: dispositivoId,
    p_identificadores_afd: identificadoresAfd,
  })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return data as { enfileirados: number; bloqueados_por_vinculo_ativo: number }
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

// ============================================================================
// Import de AFD por pendrive (unidade sem rede até o relógio) — Fase 6
// ============================================================================
// Arquivo `.sisrep` gerado por `coletor-rep afd-exportar` numa máquina sem rede até o SisEscala:
// cabeçalho ASCII curto (dispositivo_id/faixa de NSR/quando foi gerado), delimitador `---\n`, e o
// AFD CRU em seguida (latin1, sem decodificar) — mesmo motivo de `linha_bruta` ser o artefato
// legal em `rep_afd_registros`. A ingestão chama a MESMA `fn_ingerir_afd` que o sync online usa
// (`src/app/api/rep/v1/marcacoes/route.ts`), só trocando `p_canal` para `'pendrive'` e
// preenchendo `p_importado_por` com quem está logado — idempotência por (dispositivo_id, nsr) já
// cobre reenviar o mesmo arquivo sem duplicar nada.

const DELIMITADOR_SISREP = '---\n'

function parseArquivoSisrep(buffer: Buffer): { cabecalho: Record<string, string>; corpo: Buffer } {
  // O cabeçalho é sempre curto e ASCII (poucas linhas "chave: valor") — procurar o delimitador só
  // nos primeiros bytes evita casar por acaso com uma sequência igual dentro do corpo binário.
  const inicioBusca = buffer.subarray(0, 2000).toString('latin1')
  const posDelimitador = inicioBusca.indexOf(DELIMITADOR_SISREP)
  if (posDelimitador === -1) {
    throw new Error('Arquivo não parece um .sisrep válido (delimitador de cabeçalho não encontrado).')
  }

  const cabecalho: Record<string, string> = {}
  for (const linha of inicioBusca.slice(0, posDelimitador).split('\n')) {
    const idx = linha.indexOf(':')
    if (idx === -1) continue
    cabecalho[linha.slice(0, idx).trim()] = linha.slice(idx + 1).trim()
  }

  return { cabecalho, corpo: buffer.subarray(posDelimitador + DELIMITADOR_SISREP.length) }
}

export async function importarPendriveAfd(dispositivoId: string, formData: FormData) {
  await exigirAdmin()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!dispositivoId) return { error: 'Escolha o dispositivo de origem do arquivo.' }

  const arquivo = formData.get('arquivo')
  if (!(arquivo instanceof File)) return { error: 'Selecione um arquivo .sisrep.' }

  let cabecalho: Record<string, string>
  let corpo: Buffer
  try {
    const bytes = Buffer.from(await arquivo.arrayBuffer())
    ;({ cabecalho, corpo } = parseArquivoSisrep(bytes))
  } catch (e: any) {
    return { error: e.message || 'Falha ao ler o arquivo.' }
  }

  let aviso: string | null = null
  if (cabecalho.dispositivo_id && cabecalho.dispositivo_id !== dispositivoId) {
    aviso = `O cabeçalho do arquivo indica o dispositivo ${cabecalho.dispositivo_id}, diferente do `
      + 'selecionado — importado mesmo assim para o dispositivo escolhido no formulário.'
  }

  const linhas = corpo
    .toString('latin1')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')

  if (linhas.length === 0) {
    return { error: 'O arquivo não contém nenhuma linha de AFD.' }
  }

  const arquivoSha256 = createHash('sha256').update(corpo).digest('hex')

  // fn_ingerir_afd é REVOKE FROM authenticated / GRANT TO service_role apenas — precisa do
  // client admin (mesmo padrão de /api/rep/v1/marcacoes, que autentica o dispositivo por HMAC e
  // só então usa o client de service role para a escrita). O admin logado já foi confirmado
  // acima via sessão normal, só a chamada à RPC em si precisa do client elevado.
  const admin = await createAdminClient()

  let recebidas = 0, novas = 0, duplicadas = 0, marcacoes = 0, orfas = 0
  const TAMANHO_LOTE = 500
  for (let inicio = 0; inicio < linhas.length; inicio += TAMANHO_LOTE) {
    const trecho = linhas.slice(inicio, inicio + TAMANHO_LOTE)
    const { data, error } = await admin.rpc('fn_ingerir_afd', {
      p_dispositivo_id: dispositivoId,
      p_lote_id: randomUUID(),
      p_linhas: trecho,
      p_canal: 'pendrive',
      p_arquivo_sha256: arquivoSha256,
      p_coletor_versao: null,
      p_coletor_host: null,
      p_ip: null,
      p_importado_por: user.id,
      p_assinatura_ok: null,
    })
    if (error) return { error: `Falha ao importar (a partir da linha ${inicio + 1}): ${error.message}` }

    recebidas += data?.recebidas || 0
    novas += data?.novas || 0
    duplicadas += data?.duplicadas || 0
    marcacoes += data?.marcacoes || 0
    orfas += data?.orfas || 0
  }

  revalidatePath('/marcacoes')
  return { recebidas, novas, duplicadas, marcacoes, orfas, aviso }
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
