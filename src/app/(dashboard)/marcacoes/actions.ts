'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { definirTimezone } from '@/utils/horario'
import { revalidatePath } from 'next/cache'
import { randomUUID, createHash } from 'crypto'
import { formatSectorsHierarchy } from '@/utils/sectors'
import { reconciliarSincronizacaoAfd } from '@/utils/reconciliacaoHelper'

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

async function exigirGestor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'super_admin', 'coordenador', 'ass_adm', 'rh', 'rh_unidade'].includes(profile.role)) {
    throw new Error('Apenas gestores ou administradores podem executar esta ação.')
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
    supabase.from('setores').select('id, unidade_id, parent_id, dicionario_setores(nome)').eq('ativo', true),
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['coordenador', 'admin', 'super_admin', 'ass_adm'])
      .order('full_name'),
  ])

  return {
    unidades: unidades || [],
    // Nomes ja saem com recuo/marcador de hierarquia (mesmo criterio de formatSectorsHierarchy
    // usado em servidores/novo) — quem consome so filtra por unidade_id e mapeia `nome` direto
    // pro <option>, sem precisar saber que existe arvore por baixo.
    setores: formatSectorsHierarchy((setores || []).map((s: any) => ({
      id: s.id,
      unidade_id: s.unidade_id,
      parent_id: s.parent_id,
      nome: s.dicionario_setores?.nome || '(sem nome)',
    }))),
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
      'id, nome, unidade_id, numero_serie, endereco_ip, modo_operacao, ativo, ponto_valido_desde, '
      + 'usuario_rep, porta, usa_https, '
      + 'ultimo_nsr, ultimo_contato_em, deriva_segundos, created_at, unidades(nome), '
      + 'coletor_versao, coletor_host, coletor_versao_em, '
      // Lista de setores atendidos (0 linhas = "toda a unidade" - mesma semantica do antigo
      // setor_id IS NULL, ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md).
      + 'dispositivos_rep_setores(setor_id, setores(dicionario_setores(nome)))'
    )
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  // Dispositivo "somente pendrive" nao tem heartbeat - fn_ingerir_afd (chamada por
  // importarPendriveAfd) nunca atualiza ultimo_contato_em, so' fn_autenticar_dispositivo_rep
  // (usada pelas rotas do coletor via token) atualiza. O sinal de "esta sendo coletado" pra ele
  // e' a ultima sincronizacao concluida por canal pendrive, nao o contato do coletor.
  const { data: syncsPendrive } = await supabase
    .from('rep_sincronizacoes')
    .select('dispositivo_id, concluida_em')
    .eq('canal', 'pendrive')
    .eq('status', 'concluida')
    .order('concluida_em', { ascending: false })

  const ultimaColetaPendrive = new Map<string, string>()
  for (const s of syncsPendrive || []) {
    if (!ultimaColetaPendrive.has(s.dispositivo_id)) ultimaColetaPendrive.set(s.dispositivo_id, s.concluida_em)
  }

  return (data || []).map((d: any) => ({
    ...d,
    ultima_coleta_pendrive: ultimaColetaPendrive.get(d.id) || null,
  }))
}

function lerCamposDispositivo(formData: FormData) {
  const nome = String(formData.get('nome') || '').trim()
  const unidade_id = String(formData.get('unidade_id') || '')
  // Lista de setores atendidos, nao mais um so - ver
  // docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md. [] = "toda a
  // unidade" (mesma semantica do antigo setor_id NULL). Gravada a parte, via
  // fn_definir_setores_dispositivo_rep - nao e coluna de dispositivos_rep.
  let setor_ids: string[] = []
  try {
    const raw = JSON.parse(String(formData.get('setor_ids') || '[]'))
    if (Array.isArray(raw)) setor_ids = raw.filter((x) => typeof x === 'string' && x)
  } catch { /* formato invalido vira lista vazia - RPC nao recebe lixo */ }
  const numero_serie = String(formData.get('numero_serie') || '').trim() || null
  const endereco_ip = String(formData.get('endereco_ip') || '').trim() || null
  const modo_operacao = String(formData.get('modo_operacao') || 'pull')
  const usuario_rep = String(formData.get('usuario_rep') || 'admin').trim() || 'admin'
  const senha_rep = String(formData.get('senha_rep') || '').trim() || null
  const porta = Number(formData.get('porta') || 443) || 443
  const usa_https = formData.get('usa_https') !== 'false'
  // Dia em que o SisEscala assume o ponto deste relógio: batida anterior a ele continua gravada,
  // mas não ganha dono (é o que impede o histórico de um equipamento reaproveitado de virar ponto
  // daqui). Em branco = deixar o banco decidir — o DEFAULT é hoje no fuso configurado, que é o
  // certo para relógio novo; ao editar, em branco significa "manter o que já está lá", mesma
  // convenção de senha_rep.
  const ponto_valido_desde = String(formData.get('ponto_valido_desde') || '').trim() || null
  return { nome, unidade_id, setor_ids, numero_serie, endereco_ip, modo_operacao, usuario_rep, senha_rep, porta, usa_https, ponto_valido_desde }
}

export async function criarDispositivoRep(formData: FormData) {
  await exigirAdmin()
  const { setor_ids, ...campos }: any = lerCamposDispositivo(formData)
  if (!campos.nome || !campos.unidade_id) {
    return { error: 'Nome e unidade são obrigatórios.' }
  }
  // ponto_valido_desde é NOT NULL: mandar null apagaria o DEFAULT em vez de aceitá-lo.
  if (campos.ponto_valido_desde === null) delete campos.ponto_valido_desde

  const supabase = await createAdminClient()
  const { data, error } = await supabase.from('dispositivos_rep').insert(campos).select('id').single()
  if (error) return { error: error.message }

  // Sessao do usuario (nao admin client): fn_definir_setores_dispositivo_rep confere o papel
  // por auth.uid() e grava criado_por_id de quem realmente fez a alteracao.
  const sessao = await createClient()
  const { error: erroSetores } = await sessao.rpc('fn_definir_setores_dispositivo_rep', {
    p_dispositivo_id: data.id,
    p_setor_ids: setor_ids,
  })
  if (erroSetores) return { error: erroSetores.message }

  revalidatePath('/marcacoes')
  return { id: data.id }
}

export async function atualizarDispositivoRep(id: string, formData: FormData) {
  await exigirAdmin()
  const { setor_ids, ...campos }: any = lerCamposDispositivo(formData)
  if (!campos.nome || !campos.unidade_id) {
    return { error: 'Nome e unidade são obrigatórios.' }
  }
  const ativo = formData.get('ativo') === 'true'
  // Campo de senha vem em branco quando o admin nao digitou uma nova (o valor salvo nunca e
  // reenviado ao formulario) - omitir do update preserva a senha ja gravada em vez de apagar.
  if (campos.senha_rep === null) delete campos.senha_rep
  // Mesma convenção para o corte de ponto: em branco preserva o que já está gravado.
  if (campos.ponto_valido_desde === null) delete campos.ponto_valido_desde

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('dispositivos_rep')
    .update({ ...campos, ativo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  const sessao = await createClient()
  const { error: erroSetores } = await sessao.rpc('fn_definir_setores_dispositivo_rep', {
    p_dispositivo_id: id,
    p_setor_ids: setor_ids,
  })
  if (erroSetores) return { error: erroSetores.message }

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

/**
 * Gera token novo para TODOS os relógios ativos de uma unidade, para o pacote de instalação de
 * um computador que atende a unidade inteira (há unidades com 4 equipamentos).
 *
 * ⚠️ Isto INVALIDA o token anterior de cada um desses relógios — é o que
 * `fn_gerar_token_dispositivo_rep` faz, e vale para quem já estivesse coletando um deles: aquela
 * instalação para de sincronizar (HTTP 401) até receber este pacote. É deliberado, e a tela
 * avisa: o caso de uso é justamente consolidar num coletor só o que estava espalhado.
 *
 * Cada relógio continua com id e token PRÓPRIOS — não existe "token da unidade". É o token que
 * diz ao SisEscala de qual equipamento veio cada linha do AFD.
 */
/**
 * Gera token novo para os relógios que vão entrar num pacote de instalação.
 *
 * ⚠️ `dispositivoIds` NÃO é um filtro cosmético: gerar token substitui o anterior, e todo relógio
 * que entra aqui para de sincronizar até alguém instalar o pacote naquela máquina. Antes esta
 * action pegava TODOS os ativos da unidade, e numa unidade cujos equipamentos são coletados por
 * máquinas diferentes isso derrubava os que não iam receber o arquivo — medido na SMS em
 * 26/08/2026, com 4 relógios: dois pararam por 2h49 sem ninguém relacionar a causa.
 *
 * Omitir a lista mantém o comportamento antigo (todos os ativos), porque é o certo para o caso
 * dominante: UMA máquina que enxerga a unidade inteira.
 */
export async function gerarTokensUnidadeRep(unidadeId: string, dispositivoIds?: string[]) {
  await exigirAdmin()
  const supabase = await createClient()

  const admin = await createAdminClient()
  const { data: dispositivos, error: erroLista } = await admin
    .from('dispositivos_rep')
    .select('id, nome, endereco_ip')
    .eq('unidade_id', unidadeId)
    .eq('ativo', true)
    .order('nome')

  if (erroLista) return { error: erroLista.message }
  if (!dispositivos || dispositivos.length === 0) {
    return { error: 'Nenhum relógio ativo nesta unidade.' }
  }

  // A seleção é conferida contra a unidade, não aceita como veio: a tela filtra, mas a action é
  // um POST chamável direto (mesma régua da armadilha 12 — tela filtrada não protege o servidor).
  let alvos = dispositivos
  if (dispositivoIds && dispositivoIds.length > 0) {
    const pedidos = new Set(dispositivoIds)
    alvos = dispositivos.filter((d) => pedidos.has(d.id))
    const desconhecidos = dispositivoIds.filter((id) => !dispositivos.some((d) => d.id === id))
    if (desconhecidos.length > 0) {
      return { error: `Relógio que não é desta unidade (ou está inativo): ${desconhecidos.join(", ")}` }
    }
    if (alvos.length === 0) {
      return { error: 'Selecione ao menos um relógio para o pacote.' }
    }
  }

  const comToken: { id: string; nome: string; endereco_ip: string | null; token: string }[] = []
  for (const d of alvos) {
    const { data, error } = await supabase.rpc('fn_gerar_token_dispositivo_rep', { p_dispositivo_id: d.id })
    if (error) {
      // Parar no primeiro erro, e nao seguir gerando: um pacote com metade dos relogios teria
      // token novo (os gerados) e token velho (os que faltaram) no mesmo config.yaml, e a
      // instalacao ficaria coletando parte da unidade sem ninguem perceber qual parte.
      return { error: `Falha ao gerar token de ${d.nome}: ${error.message}` }
    }
    comToken.push({ id: d.id, nome: d.nome, endereco_ip: d.endereco_ip, token: data as string })
  }

  revalidatePath('/marcacoes')
  return { dispositivos: comToken }
}

// ============================================================================
// Push de cadastro (identidade) para o rele - Fase 7, parte de identidade
// ============================================================================
// A biometria em si nunca passa por aqui - sempre exige alguem presencial no equipamento.
// Isto so prepara matricula/nome/CPF no rele antes disso.

export async function enfileirarCadastrosRep(dispositivoId: string) {
  await exigirGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data, error } = await supabase.rpc('fn_enfileirar_cadastros_rep', { p_dispositivo_id: dispositivoId })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return data as { enfileirados: number; sem_cpf: number; ja_vinculados: number; ja_no_relogio: number }
}

export async function listarPendenciasBiometria(dispositivoId?: string | null) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_pendencias_biometria', { p_dispositivo_id: dispositivoId || null })
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
// Cobertura de ponto - quem está escalado e não consegue bater no relógio
// ============================================================================
// Medido em produção em 13/08/2026 (LACEM, agosto): dos 40 servidores escalados, 39 não tinham
// como ter ponto registrado - e 27 deles estavam cadastrados no equipamento COM biometria,
// batendo o dedo normalmente, com a batida morrendo como órfã por falta de vínculo. Nada na tela
// avisava. Sem escopo de admin de propósito: coordenador precisa ver a própria unidade (as RPCs
// barram só os papéis do Portal e filtram por escopo).

export interface CoberturaResumo {
  dispositivo_id: string
  dispositivo_nome: string
  unidade_nome: string
  setores_nomes: string | null
  ativo: boolean
  ultimo_contato_em: string | null
  snapshot_em: string | null
  escalados: number
  ok: number
  sem_vinculo: number
  sem_biometria: number
  fora_do_relogio: number
  sem_cpf: number
  sem_snapshot: number
  nao_conseguem_bater: number
  batidas_perdidas: number
  // Quantos dos `nao_conseguem_bater` já batem em OUTRO relógio ativo da mesma unidade. Não é
  // descontado de `nao_conseguem_bater`: naquele equipamento a pessoa continua sem conseguir
  // bater — o número novo fica ao lado, nunca no lugar. Ver 20260825110000.
  cobertos_em_outro: number
}

export type SituacaoCobertura = 'sem_cpf' | 'sem_snapshot' | 'fora_do_relogio' | 'sem_biometria' | 'sem_vinculo' | 'ok'

export interface CoberturaServidor {
  servidor_id: string
  servidor_nome: string
  matricula: string | null
  dias_com_escala: number
  identificador_afd: string | null
  nome_no_device: string | null
  tem_biometria: boolean
  tem_vinculo: boolean
  batidas_perdidas: number
  situacao: SituacaoCobertura
  snapshot_em: string | null
  fila_status: 'pendente' | 'enviado' | 'falhou' | null
  fila_erro: string | null
  lotacao_compativel: boolean
  // Outros relógios da MESMA unidade onde esta pessoa consegue bater ponto hoje (cadastrada lá,
  // com biometria). null = não bate em mais nenhum — a distinção entre "não registra ponto em
  // lugar nenhum" e "usa outra entrada da unidade".
  coberto_em: string | null
}

// Estas duas DEVOLVEM o erro em vez de lançar. Server Action que lança tem a mensagem apagada em
// produção ("An error occurred in the Server Components render... omitted in production builds"),
// e foi exatamente o que aconteceu na primeira subida desta tela: a causa real ficou invisível e
// só o digest sobrou. Valor devolvido não é redigido.
// Forma explícita em vez de união discriminada: o consumidor sempre tem `dados` para usar, e o
// `error` é só o motivo de ele vir vazio. Union com `error?: never` obriga estreitamento em todo
// ponto de uso e não paga o custo aqui.
export interface Resultado<T> { dados: T; error: string | null }

function erroLegivel(error: { message: string; code?: string }): string {
  // PGRST202 = função não está no schema cache do PostgREST. Na prática significa uma de duas
  // coisas, e as duas se resolvem fora do app - por isso vale nomear em vez de repassar o texto.
  if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message)) {
    return 'As funções de cobertura ainda não existem neste banco. Aplique a migration '
      + '20260813000000_add_cobertura_ponto_rep.sql (e, se ela já foi aplicada, recarregue o '
      + `schema cache do PostgREST). Detalhe: ${error.message}`
  }
  return error.message
}

export async function listarCoberturaResumo(mes?: number, ano?: number): Promise<Resultado<CoberturaResumo[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_cobertura_ponto_resumo', {
    p_mes: mes ?? null,
    p_ano: ano ?? null,
  })
  if (error) return { dados: [], error: erroLegivel(error) }
  return { dados: (data || []) as CoberturaResumo[], error: null }
}

export async function listarCoberturaDispositivo(
  dispositivoId: string, mes?: number, ano?: number,
): Promise<Resultado<CoberturaServidor[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_cobertura_ponto_dispositivo', {
    p_dispositivo_id: dispositivoId,
    p_mes: mes ?? null,
    p_ano: ano ?? null,
  })
  if (error) return { dados: [], error: erroLegivel(error) }
  return { dados: (data || []) as CoberturaServidor[], error: null }
}

// Conserta o caso 'sem_vinculo' sem tocar no equipamento: a pessoa já está lá com biometria, o
// que falta é a ponte no SisEscala. vigente_de fica a cargo da RPC (default = cadastro do
// dispositivo) - é ele que decide quais batidas passam a ter dono num reprocessamento, e um valor
// antigo demais faria o histórico do sistema anterior virar marcação nossa.
export async function vincularCadastrosPorCpf(dispositivoId: string) {
  await exigirGestor()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_vincular_cadastros_por_cpf', {
    p_dispositivo_id: dispositivoId,
    p_vigente_de: null,
  })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  revalidatePath('/escalas')
  return data as { criados: number; vigente_de: string }
}

export async function reprocessarBatidasOrfas(dispositivoId?: string | null, desde?: string | null) {
  await exigirGestor()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_reparse_afd_dispositivo', {
    p_dispositivo_id: dispositivoId || null,
    p_desde: desde || null,
  })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  revalidatePath('/escalas')
  return data as { sucesso: boolean; marcacoes_atualizadas: number; marcacoes_criadas: number }
}

// Enfileira para o relógio quem está ESCALADO ali e não está cadastrado - inclusive quem está
// lotado em outra unidade/setor, caso que o botão "Sincronizar cadastros" (escolha por lotação)
// nunca alcança. Foi o que deixou Gabriela e Izabella batendo só no terminal do computador.
export async function enfileirarCadastrosPorEscala(dispositivoId: string, mes?: number, ano?: number) {
  await exigirGestor()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_enfileirar_cadastros_por_escala', {
    p_dispositivo_id: dispositivoId,
    p_mes: mes ?? null,
    p_ano: ano ?? null,
  })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return data as { enfileirados: number; ja_na_fila: number }
}

// Enfileira em lote os cadastros (por escala e por lotação) para múltiplos dispositivos do escopo
export async function enfileirarCadastrosEmLote(dispositivoIds: string[], mes?: number, ano?: number) {
  await exigirGestor()
  const supabase = await createClient()

  let totalEnfileirados = 0
  let totalJaNaFila = 0
  const erros: string[] = []

  for (const id of dispositivoIds) {
    const { data: dataEscala, error: errEscala } = await supabase.rpc('fn_enfileirar_cadastros_por_escala', {
      p_dispositivo_id: id,
      p_mes: mes ?? null,
      p_ano: ano ?? null,
    })
    if (errEscala) {
      erros.push(errEscala.message)
    } else if (dataEscala) {
      totalEnfileirados += Number((dataEscala as any).enfileirados || 0)
      totalJaNaFila += Number((dataEscala as any).ja_na_fila || 0)
    }

    const { data: dataLotacao, error: errLotacao } = await supabase.rpc('fn_enfileirar_cadastros_rep', {
      p_dispositivo_id: id,
    })
    if (errLotacao) {
      if (!errEscala) erros.push(errLotacao.message)
    } else if (dataLotacao) {
      totalEnfileirados += Number((dataLotacao as any).enfileirados || 0)
    }
  }

  revalidatePath('/marcacoes')
  return {
    enfileirados: totalEnfileirados,
    ja_na_fila: totalJaNaFila,
    erros: erros.length > 0 ? erros : null,
  }
}

// ============================================================================
// Pendências (marcações do terminal fora da janela prevista)
// ============================================================================

export async function listarPendencias(unidadeId?: string | null, setorId?: string | null) {
  // fn_marcacoes_pendentes_revisao já filtra por fn_unidade_no_escopo internamente - coordenador
  // e admin veem só o que está no escopo deles, sem checagem adicional aqui. unidadeId/setorId são
  // um filtro A MAIS em cima disso - útil pra quem tem escopo amplo (RH Geral, admin) e a lista
  // fica grande demais pra rolar inteira.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_marcacoes_pendentes_revisao', {
    p_unidade_id: unidadeId || null,
    p_setor_id: setorId || null,
    p_desde: null,
  })
  if (error) throw new Error(error.message)
  return data || []
}

export interface PrevistoDoBloco {
  bloco_ordem: number
  entrada: string | null
  intervalo_saida: string | null
  intervalo_retorno: string | null
  saida: string | null
  permite_intervalo: boolean
}

export interface EscalaCandidata {
  id: string
  categoria: string
  turno_codigo: string | null
  presenca_confirmada: boolean | null
  previsto: PrevistoDoBloco | null
}

/**
 * Escalas do servidor naquele dia que ainda podem receber a marcação pendente, cada uma já com o
 * HORÁRIO PREVISTO do bloco a que pertence.
 *
 * O previsto vem de fn_blocos_previstos_dia — a MESMA função que o terminal usa para decidir a
 * janela (e que a grade lê via fn_blocos_previstos_mes). Não re-derivar aqui: qualquer regra
 * própria voltaria a mostrar ao coordenador um horário diferente do que o sistema cobrou do
 * servidor, que foi exatamente o problema que a Fase 3 fechou.
 *
 * Chamada com o client admin (service_role): o guard de escopo de fn_blocos_previstos_dia
 * (20260812130000) libera quando auth.uid() IS NULL. O escopo de quem vê a pendência já foi
 * aplicado em listarPendencias, por fn_unidade_no_escopo dentro de fn_marcacoes_pendentes_revisao.
 */
export async function buscarEscalasCandidatas(
  servidorId: string,
  ocorridoEmIso: string,
): Promise<{ timezone: string; escalas: EscalaCandidata[] }> {
  const sessao = await createClient()
  const { data: { user } } = await sessao.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const supabase = await createAdminClient()

  const { data: cfg } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'timezone')
    .maybeSingle()
  const timezone = (cfg?.valor as string) || 'America/Sao_Paulo'
  definirTimezone(timezone)

  // O dia tem que ser o do fuso do município, não o do processo Node (a VPS roda em UTC): uma
  // batida às 22:00 de 11/08 vira 12/08 em UTC e traria as escalas do dia errado. É a mesma
  // conversão que fn_marcacoes_pendentes_revisao faz com AT TIME ZONE para devolver `dia`.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ocorridoEmIso))
  const [ano, mes, dia] = partes.split('-').map(Number)

  const [{ data, error }, { data: blocos, error: erroBlocos }] = await Promise.all([
    supabase
      .from('escala_diaria')
      .select('id, categoria, presenca_confirmada, dicionario_turnos(codigo), escala_mensal!inner(servidor_id, mes, ano)')
      .eq('dia', dia)
      .eq('escala_mensal.servidor_id', servidorId)
      .eq('escala_mensal.mes', mes)
      .eq('escala_mensal.ano', ano)
      .in('categoria', ['Regular', 'Plantão', 'Extra']),
    supabase.rpc('fn_blocos_previstos_dia', { p_servidor_id: servidorId, p_data: partes }),
  ])

  if (error) throw new Error(error.message)

  // Sem previsão a tela continua funcionando — o coordenador só perde o apoio para decidir, não
  // a capacidade de tratar a marcação.
  if (erroBlocos) console.warn('fn_blocos_previstos_dia indisponível:', erroBlocos.message)

  // Um bloco pode conter mais de uma escala_diaria (Regular + Plantão contíguos fundem num bloco
  // só, com uma janela de entrada e uma de saída). O mapa é escala_diaria_id -> bloco.
  const previstoPorEscala = new Map<string, PrevistoDoBloco>()
  for (const b of (Array.isArray(blocos) ? blocos : [])) {
    const previsto: PrevistoDoBloco = {
      bloco_ordem: b.bloco_ordem,
      entrada: b.inicio_previsto,
      intervalo_saida: b.intervalo_inicio_previsto,
      intervalo_retorno: b.intervalo_fim_previsto,
      saida: b.fim_previsto,
      permite_intervalo: !!b.permite_intervalo,
    }
    for (const edId of (b.escala_diaria_ids || [])) previstoPorEscala.set(edId, previsto)
  }

  return {
    timezone,
    escalas: (data || []).map((e: any) => ({
      id: e.id,
      categoria: e.categoria,
      turno_codigo: e.dicionario_turnos?.codigo || null,
      presenca_confirmada: e.presenca_confirmada,
      previsto: previstoPorEscala.get(e.id) || null,
    })),
  }
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

// Uma linha de AFD começa com NSR (9 dígitos) seguido do tipo de registro (1 dígito, 1..9) — é o
// único traço estrutural que distingue um AFD cru de um arquivo qualquer, e o mesmo campo que
// fn_parse_linha_afd lê nas posições 1..10. Serve de guarda para aceitar arquivo SEM cabeçalho
// sem transformar o campo de upload em "aceita qualquer coisa".
const PRIMEIRA_LINHA_AFD = /^\d{9}[1-9]/

// `coletor-rep afd-exportar` sempre começa o arquivo por esta marca (ver rodarAfdExportar em
// tools/coletor-rep/cmd/cli/main.go). Decidir o formato pelo INÍCIO do arquivo, e não por
// "achei/não achei o delimitador em algum lugar dos 2000 primeiros bytes", é o que impede um AFD
// cru que por acaso contenha `---\n` de ser truncado como se tivesse cabeçalho.
const MARCA_SISREP = 'SISREP-'

function parseArquivoSisrep(buffer: Buffer): { cabecalho: Record<string, string>; corpo: Buffer } {
  // O cabeçalho é sempre curto e ASCII (poucas linhas "chave: valor") — ler só os primeiros bytes
  // basta e evita decodificar o corpo inteiro duas vezes.
  const inicioBusca = buffer.subarray(0, 2000).toString('latin1')

  if (!inicioBusca.startsWith(MARCA_SISREP)) {
    // Relógio sem NENHUMA rede: nem o coletor alcança o equipamento, então o AFD sai pela porta
    // USB do próprio relógio (exportação fiscal obrigatória do REP-C) e chega aqui CRU, sem o
    // cabeçalho que só `coletor-rep afd-exportar` escreve. É byte a byte o mesmo conteúdo que
    // get_afd.fcgi devolveria — recusar seria perder a única coleta possível nessas unidades.
    // Sem cabeçalho não há `dispositivo_id` para conferir: a escolha do dispositivo no formulário
    // passa a ser a única fonte, e por isso a tela avisa explicitamente.
    // Alguns exportadores gravam BOM. Ele não é parte do AFD e faria a guarda recusar um arquivo
    // legítimo. Aqui o buffer foi decodificado como latin1, então um BOM UTF-8 aparece como os
    // três bytes crus (\xEF\xBB\xBF), não como ﻿ — os dois são descartados só para o teste;
    // o buffer em si não é tocado (a linha tipo 1 que o carrega vira um registro com parse_erro
    // no banco, nunca uma marcação perdida).
    const primeiraLinha = (inicioBusca.split(/\r?\n/).find((l) => l.trim() !== '') || '')
      .replace(/^(﻿|\xEF\xBB\xBF)/, '')
    if (!PRIMEIRA_LINHA_AFD.test(primeiraLinha)) {
      throw new Error(
        'Arquivo não reconhecido: não tem cabeçalho .sisrep nem começa com uma linha de AFD '
        + '(9 dígitos de NSR + tipo de registro). Confira se é mesmo o arquivo exportado do relógio.'
      )
    }
    return { cabecalho: {}, corpo: buffer }
  }

  // A partir daqui o arquivo se declarou .sisrep: a ausência do delimitador é corrupção
  // (truncado no pendrive, por exemplo), não "outro formato" — recusar é o certo.
  const posDelimitador = inicioBusca.indexOf(DELIMITADOR_SISREP)
  if (posDelimitador === -1) {
    throw new Error('Arquivo .sisrep incompleto: delimitador de cabeçalho não encontrado.')
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
  if (!(arquivo instanceof File)) return { error: 'Selecione o arquivo .sisrep ou o AFD exportado pelo relógio.' }

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

    if (data?.sincronizacao_id && (data?.marcacoes || 0) > 0) {
      await reconciliarSincronizacaoAfd(data.sincronizacao_id)
    }
  }

  revalidatePath('/marcacoes')
  revalidatePath('/escalas')
  revalidatePath('/folha-ponto')
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

// ============================================================================
// Autorizações de validação coletiva de ponto (27/08/2026)
// ============================================================================
// Plano: docs/planos/2026-08-27-dispensa-de-registro-de-ponto.md
//
// Quem concede é o RH Geral — nunca o coordenador, que é justamente quem vai USAR a autorização
// na grade. Conferido aqui E dentro da função do banco: a RPC é chamável direto (armadilha 12).

async function exigirRhGeral() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['rh', 'super_admin'].includes(profile.role)) {
    throw new Error('Apenas o RH Geral pode autorizar validação coletiva de ponto.')
  }
  return user
}

export async function listarAutorizacoesPontoColetivo() {
  await exigirGestor()
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('autorizacoes_ponto_coletivo')
    .select(`
      id, passos, vigencia_inicio, vigencia_fim, documento, motivo,
      created_at, revogado_em, revogacao_motivo,
      servidores(id, nome, matricula, unidades(nome), setores(dicionario_setores(nome)))
    `)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, dados: [] as any[] }

  const dados = (data || []).map((a: any) => ({
    ...a,
    servidor_nome: a.servidores?.nome || '—',
    servidor_matricula: a.servidores?.matricula || null,
    unidade_nome: a.servidores?.unidades?.nome || null,
    setor_nome: a.servidores?.setores?.dicionario_setores?.nome || null,
  }))

  return { error: null, dados }
}

/**
 * Servidores para o RH escolher. Busca por nome ou matrícula, dentro de um setor quando
 * informado — o caso real é "todos os técnicos do Porta a Porta", então filtrar por setor é o
 * caminho curto. Paginado: são 1.318 ativos e o PostgREST corta em 1000 sem avisar (armadilha 8).
 */
export async function listarServidoresParaAutorizacao(setorId?: string | null, termo?: string | null) {
  await exigirGestor()
  const supabase = await createAdminClient()

  const todos: any[] = []
  for (let from = 0; ; from += 1000) {
    let query = supabase
      .from('servidores')
      .select('id, nome, matricula, setor_id, unidades(nome), setores(dicionario_setores(nome))')
      .eq('status', 'Ativo')
      .order('nome')
      .range(from, from + 999)

    if (setorId) query = query.eq('setor_id', setorId)
    if (termo && termo.trim()) query = query.or(`nome.ilike.%${termo.trim()}%,matricula.ilike.%${termo.trim()}%`)

    const { data, error } = await query
    if (error) return { error: error.message, dados: [] as any[] }
    todos.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  return {
    error: null,
    dados: todos.map((s: any) => ({
      id: s.id,
      nome: s.nome,
      matricula: s.matricula,
      unidade_nome: s.unidades?.nome || null,
      setor_nome: s.setores?.dicionario_setores?.nome || null,
    })),
  }
}

export async function concederAutorizacaoPontoColetivo(input: {
  servidorIds: string[]
  passos: string[]
  vigenciaInicio: string
  vigenciaFim: string
  documento: string
  motivo: string
}) {
  await exigirRhGeral()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('fn_conceder_autorizacao_ponto_coletivo', {
    p_servidor_ids: input.servidorIds,
    p_passos: input.passos,
    p_vigencia_inicio: input.vigenciaInicio,
    p_vigencia_fim: input.vigenciaFim,
    p_documento: input.documento,
    p_motivo: input.motivo,
  })

  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { error: null, resultado: data }
}

export async function revogarAutorizacaoPontoColetivo(id: string, motivo: string) {
  await exigirRhGeral()
  const supabase = await createClient()

  const { error } = await supabase.rpc('fn_revogar_autorizacao_ponto_coletivo', {
    p_autorizacao_id: id,
    p_motivo: motivo,
  })

  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { error: null }
}
