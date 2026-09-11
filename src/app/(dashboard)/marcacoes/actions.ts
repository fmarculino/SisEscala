'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { definirTimezone } from '@/utils/horario'
import { revalidatePath } from 'next/cache'
import { randomUUID, createHash } from 'crypto'
import { formatSectorsHierarchy } from '@/utils/sectors'
import { reconciliarSincronizacaoAfd } from '@/utils/reconciliacaoHelper'
import {
  montarEscopoGestao, podeGerirMarcacoes, unidadeNoEscopo, filtrarPorUnidade, gerenciaSemEscopo,
  ehEscopadoPorUnidade,
  ERRO_SEM_GESTAO_MARCACOES, ERRO_UNIDADE_FORA_DO_ESCOPO, type EscopoGestao,
} from '@/utils/escopoGestao'

/**
 * Perfil + escopo de gestao de quem esta chamando.
 *
 * ⚠️ `profile_setores(setores(unidade_id))` nao e' zelo: coordenador/RH cujo acesso vem
 * inteiramente de setor vinculado tem `profile_unidades` vazio e veria a tela em branco sem
 * nenhuma mensagem (e' o buraco que `fn_unidade_alcancavel_por_setor` existe para tapar).
 */
async function perfilComEscopo() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: perfil } = await supabase
    .from('profiles')
    .select('role, profile_unidades(unidade_id), profile_setores(setores(unidade_id))')
    .eq('id', user.id)
    .single()

  return { user, escopo: montarEscopoGestao(perfil) }
}

/**
 * Gere relogios e terminais? Substitui o antigo `exigirAdmin`, que era
 * `['admin','super_admin']` — decisao do usuario em 10/09/2026 (RH Geral total, RH da Unidade
 * nas unidades dele).
 *
 * ⚠️ Isto autoriza o PAPEL. Quem trabalha sobre um equipamento especifico precisa de
 * `exigirUnidadeNoEscopo` por cima: sem ele, um RH da Unidade chamaria a action com o id de um
 * relogio de outra unidade — server action e' um POST cujo id sai no bundle (armadilha 33).
 */
async function exigirGestaoMarcacoes() {
  const ctx = await perfilComEscopo()
  if (!podeGerirMarcacoes(ctx.escopo.role)) throw new Error(ERRO_SEM_GESTAO_MARCACOES)
  return ctx
}

function exigirUnidadeNoEscopo(escopo: EscopoGestao, unidadeId: string | null | undefined) {
  if (!unidadeNoEscopo(escopo, unidadeId)) throw new Error(ERRO_UNIDADE_FORA_DO_ESCOPO)
}

/**
 * Resolve a unidade de um equipamento/terminal JA GRAVADO e confere o escopo contra ela.
 *
 * ⚠️ Conferir so o que veio no formulario nao basta: sem esta checagem, um RH da Unidade
 * "puxaria" para dentro do escopo um relogio de outra unidade mandando a unidade certa no
 * payload. Mesma licao de `updateUser` (o alcance e conferido sobre o estado ATUAL do alvo,
 * antes do payload).
 */
async function exigirEscopoDoRegistro(
  escopo: EscopoGestao,
  tabela: 'dispositivos_rep' | 'terminais_locais',
  id: string,
) {
  const admin = await createAdminClient()
  const { data } = await admin.from(tabela).select('unidade_id').eq('id', id).single()
  if (!data) throw new Error('Registro não encontrado.')
  exigirUnidadeNoEscopo(escopo, data.unidade_id)
  return data.unidade_id as string
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
  const { escopo } = await exigirGestaoMarcacoes()
  const supabase = await createAdminClient()

  // ⚠️ Unidade e setor INATIVOS vem na lista, com a flag `ativo` — e quem escolhe e' a tela.
  // Filtrar no servidor parecia mais simples e escondia um vinculo ja gravado: o relogio que
  // atende um setor desativado continuaria atendendo, com a caixa invisivel no modal. A regra
  // e' "nao oferecer para escolha nova, mas mostrar o que ja esta escolhido" (SeletorSetoresArvore
  // e o <select> de unidade fazem isso), e ela so pode ser aplicada por quem conhece a selecao.
  const [{ data: unidades }, { data: setores }, { data: coordenadores }] = await Promise.all([
    supabase.from('unidades').select('id, nome, ativo').order('nome'),
    supabase.from('setores').select('id, unidade_id, parent_id, ativo, dicionario_setores(nome)'),
    supabase
      .from('profiles')
      .select('id, full_name, role, profile_unidades(unidade_id), profile_setores(setores(unidade_id))')
      .in('role', ['coordenador', 'admin', 'super_admin', 'ass_adm'])
      .order('full_name'),
  ])

  const setoresFlat = (setores || []).map((s: any) => ({
    id: s.id,
    unidade_id: s.unidade_id,
    parent_id: s.parent_id,
    ativo: s.ativo,
    nome: s.dicionario_setores?.nome || '(sem nome)',
  }))

  // Responsavel pelo terminal: so quem tem escopo DENTRO das unidades oferecidas. Oferecer a
  // rede inteira aqui nao vaza dado (e' nome de coordenador), mas produz o defeito da armadilha
  // 56: responsavel com escopo de outra unidade faz `fn_registrar_ponto_terminal_local` recusar
  // TODA batida daquele terminal, com a mensagem errada ("sem permissao") na cara do servidor.
  //
  // ⚠️ Quem ja e' responsavel de um terminal no escopo NUNCA some da lista, mesmo estando fora
  // dela hoje: sumir faria o <select> do modal abrir vazio e o proximo "Salvar" trocar o
  // responsavel sem ninguem pedir (armadilha 28).
  const escopoDeUmPerfil = (p: any) => {
    const diretas = (p.profile_unidades || []).map((pu: any) => pu.unidade_id)
    const porSetor = (p.profile_setores || [])
      .map((ps: any) => (Array.isArray(ps.setores) ? ps.setores[0] : ps.setores)?.unidade_id)
    return [...diretas, ...porSetor].filter(Boolean)
  }

  let listaCoordenadores = coordenadores || []
  if (!gerenciaSemEscopo(escopo.role)) {
    const { data: jaResponsaveis } = await supabase
      .from('terminais_locais')
      .select('responsavel_coordenador_id, unidade_id')
    const preservar = new Set(
      (jaResponsaveis || [])
        .filter((t: any) => unidadeNoEscopo(escopo, t.unidade_id))
        .map((t: any) => t.responsavel_coordenador_id)
        .filter(Boolean),
    )
    listaCoordenadores = listaCoordenadores.filter((p: any) =>
      preservar.has(p.id) || escopoDeUmPerfil(p).some((u: string) => unidadeNoEscopo(escopo, u)),
    )
  }

  return {
    // Unidade e setor fora do escopo nao sao oferecidos — e o guard da action recusa de
    // qualquer forma, entao oferecer seria armadilha (mesma regra de opcoesAtivas.ts).
    unidades: filtrarPorUnidade(escopo, unidades || [], (u: any) => u.id),
    // Cru, com `parent_id` e `ativo`: a arvore de setores do modal do relogio precisa da relacao
    // pai/filho de verdade (marcar um pai marca os descendentes), nao do recuo dentro do texto.
    // Quem usa <select> aplica formatSectorsHierarchy na hora.
    setores: filtrarPorUnidade(escopo, setoresFlat, (s: any) => s.unidade_id),
    coordenadores: listaCoordenadores.map((p: any) => ({ id: p.id, full_name: p.full_name, role: p.role })),
  }
}

// ============================================================================
// Terminais locais
// ============================================================================

export async function listarTerminaisLocais() {
  const { escopo } = await exigirGestaoMarcacoes()
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
  // ⚠️ O filtro tem que ser AQUI: a consulta usa `createAdminClient` (service_role, BYPASSRLS),
  // entao a policy "Leitura de dispositivos por escopo" nao roda. Sem esta linha o RH da Unidade
  // veria o parque inteiro.
  return filtrarPorUnidade(escopo, data || [], (t: any) => t.unidade_id)
}

function lerCamposTerminal(formData: FormData) {
  const nome = String(formData.get('nome') || '').trim()
  const unidade_id = String(formData.get('unidade_id') || '')
  const setor_id = String(formData.get('setor_id') || '') || null
  const responsavel_coordenador_id = String(formData.get('responsavel_coordenador_id') || '')
  return { nome, unidade_id, setor_id, responsavel_coordenador_id }
}

export async function criarTerminalLocal(formData: FormData) {
  const { escopo } = await exigirGestaoMarcacoes()
  const campos = lerCamposTerminal(formData)
  if (!campos.nome || !campos.unidade_id || !campos.responsavel_coordenador_id) {
    return { error: 'Nome, unidade e responsável são obrigatórios.' }
  }
  exigirUnidadeNoEscopo(escopo, campos.unidade_id)

  const supabase = await createAdminClient()
  const { data, error } = await supabase.from('terminais_locais').insert(campos).select('id').single()
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { id: data.id }
}

export async function atualizarTerminalLocal(id: string, formData: FormData) {
  const { escopo } = await exigirGestaoMarcacoes()
  const campos = lerCamposTerminal(formData)
  if (!campos.nome || !campos.unidade_id || !campos.responsavel_coordenador_id) {
    return { error: 'Nome, unidade e responsável são obrigatórios.' }
  }
  const ativo = formData.get('ativo') === 'true'
  // Os DOIS lados: a unidade em que o terminal esta hoje e a que veio no formulario. Conferir
  // so o payload deixaria um RH da Unidade adotar terminal de outra unidade; conferir so o
  // estado atual o deixaria empurrar o terminal dele para fora do proprio escopo.
  await exigirEscopoDoRegistro(escopo, 'terminais_locais', id)
  exigirUnidadeNoEscopo(escopo, campos.unidade_id)

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
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'terminais_locais', id)
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
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'terminais_locais', id)
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
  const { escopo } = await exigirGestaoMarcacoes()
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
      + 'coletor_versao, coletor_host, coletor_ip, coletor_versao_em, '
      // geracao_atual: qual equipamento fisico esta neste ponto agora (1 = o original).
      // usuarios_lidos_*: a ultima leitura BEM-SUCEDIDA do cadastro. Com total 0 significa
      // "lido e vazio" (relogio zerado ou trocado), que e' diferente de nunca ter sido lido.
      + 'geracao_atual, usuarios_lidos_em, usuarios_lidos_total, '
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

  // ⚠️ Filtro AQUI: a consulta usa `createAdminClient` (service_role, BYPASSRLS), entao a
  // policy "Leitura de dispositivos por escopo" nao roda. Sem isto o RH da Unidade veria os
  // 32 relogios do parque.
  return filtrarPorUnidade(escopo, data || [], (d: any) => d.unidade_id).map((d: any) => ({
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
  const { escopo } = await exigirGestaoMarcacoes()
  const { setor_ids, ...campos }: any = lerCamposDispositivo(formData)
  if (!campos.nome || !campos.unidade_id) {
    return { error: 'Nome e unidade são obrigatórios.' }
  }
  exigirUnidadeNoEscopo(escopo, campos.unidade_id)
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
  const { escopo } = await exigirGestaoMarcacoes()
  const { setor_ids, ...campos }: any = lerCamposDispositivo(formData)
  if (!campos.nome || !campos.unidade_id) {
    return { error: 'Nome e unidade são obrigatórios.' }
  }
  // Os DOIS lados — ver o comentario gemeo em atualizarTerminalLocal.
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', id)
  exigirUnidadeNoEscopo(escopo, campos.unidade_id)
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
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', id)
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
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', id)
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
  const { escopo } = await exigirGestaoMarcacoes()
  exigirUnidadeNoEscopo(escopo, unidadeId)
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
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', dispositivoId)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_higiene_usuarios_dispositivo', { p_dispositivo_id: dispositivoId })
  if (error) throw new Error(error.message)
  return data || []
}

export async function enfileirarRemocaoUsuariosDispositivo(dispositivoId: string, identificadoresAfd: string[]) {
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', dispositivoId)
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
  // Quantas pessoas a aba lista neste relógio: lotados na unidade/setores dele UNIÃO escalados no
  // mês. É o denominador da tela desde 20260905100000.
  total_pessoas: number
  // ⚠️ CONTINUA sendo só quem tem escala no mês — não é o total. Preservado de propósito quando o
  // universo foi ampliado: mudar o significado de um número que já está na tela é pior que somar
  // um número novo ao lado dele (mesma regra de `cobertos_em_outro`).
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
  // 0 = esta pessoa entrou na lista por LOTAÇÃO, não por escala. Não é ambíguo: a CTE de
  // escalados agrupa sobre `escala_diaria`, então quem tem escala tem sempre >= 1 dia.
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

/**
 * Registra que o equipamento físico daquele ponto foi TROCADO (06/09/2026).
 *
 * 🚨 Por que isto precisa existir, e por que precisa ser um botão: o relógio do CCE queimou e
 * foi substituído por um equipamento novo, mesmo IP e mesma senha. O AFD do novo recomeça no
 * NSR 1, e o cursor continuou apontando para o fim do trecho contíguo do antigo (111.509) — o
 * equipamento passou a devolver nada, e toda sincronização era gravada como "concluída".
 * **Nenhuma tela mostrava problema nenhum**, e a batida de quem trabalha ali não chegava.
 *
 * A troca é deliberadamente MANUAL: detectar substituição automaticamente é palpite (o relógio
 * pode só ter tido a memória lida errado num ciclo), e incrementar a geração por engano cria um
 * AFD paralelo que ninguém pediu. Quem decide é uma pessoa, e fica registrado com o nome dela.
 *
 * ⚠️ Nada é apagado. O AFD do equipamento anterior continua sendo a prova daquele período —
 * apenas passa a viver noutra geração, e a unicidade por NSR deixa de confundir os dois.
 *
 * ⚠️ ORDEM EM CAMPO: registre a substituição ANTES de pôr o equipamento novo em rede. Um lote
 * já em voo do relógio novo, coletado antes deste registro, entraria na geração anterior e
 * colidiria com os NSR do antigo — que é exatamente o descarte silencioso que isto resolve.
 */
export async function registrarSubstituicaoDispositivo(
  dispositivoId: string,
  motivo: string,
  numeroSerieNovo?: string | null,
) {
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', dispositivoId)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_registrar_substituicao_dispositivo', {
    p_dispositivo_id: dispositivoId,
    p_motivo: motivo,
    p_numero_serie_novo: numeroSerieNovo?.trim() || null,
  })
  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return data as {
    sucesso: boolean
    geracao_anterior: number
    geracao_nova: number
    nsr_max_anterior: number
    registros_anteriores: number
    cursor_novo: number
  }
}

/** Histórico de trocas de equipamento daquele ponto, mais recente primeiro. */
export async function listarSubstituicoesDispositivo(dispositivoId: string) {
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', dispositivoId)
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from('dispositivos_rep_substituicoes')
    .select('id, geracao_anterior, geracao_nova, nsr_max_anterior, registros_anteriores, '
      + 'motivo, numero_serie_anterior, numero_serie_novo, created_at')
    .eq('dispositivo_id', dispositivoId)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { substituicoes: data || [] }
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
  const { escopo } = await exigirGestaoMarcacoes()
  await exigirEscopoDoRegistro(escopo, 'dispositivos_rep', dispositivoId)
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

/**
 * Quem concede/revoga dispensa de registro de ponto.
 *
 * Ate 10/09/2026 era `[rh, super_admin]`, pela decisao de 27/08/2026 ("o oficio e enderecado a
 * RH central"). O usuario ampliou em 10/09/2026: o RH da Unidade tambem concede, DENTRO das
 * unidades dele — o recorte por servidor e aplicado dentro da RPC.
 *
 * ⚠️ O DIRETOR (`admin`) continua de fora, e por isso esta lista existe em vez de
 * `podeGerirMarcacoes`: aquele predicado trata `admin` como irrestrito (e assim que ele se
 * comporta no resto de /marcacoes), o que daria a um Diretor de uma unidade o poder de
 * dispensar de bater ponto qualquer servidor da rede. A decisao de 27/08/2026 o exclui
 * nominalmente. A mesma allowlist esta nas duas RPCs (20260911110000).
 */
const PAPEIS_AUTORIZACAO_PONTO = ['super_admin', 'rh', 'rh_unidade']

async function exigirRhAutorizador() {
  const ctx = await perfilComEscopo()
  if (!PAPEIS_AUTORIZACAO_PONTO.includes(String(ctx.escopo.role))) {
    throw new Error('Apenas o RH pode autorizar validação coletiva de ponto.')
  }
  return ctx
}

export async function listarAutorizacoesPontoColetivo() {
  await exigirGestor()
  const { escopo } = await perfilComEscopo()
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('autorizacoes_ponto_coletivo')
    .select(`
      id, passos, vigencia_inicio, vigencia_fim, documento, motivo,
      created_at, revogado_em, revogacao_motivo,
      servidores(id, nome, matricula, unidade_id, unidades(nome), setores(dicionario_setores(nome)))
    `)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, dados: [] as any[] }

  // Consulta por `createAdminClient` (BYPASSRLS), entao o recorte e AQUI. Escopado pela
  // unidade de lotacao do servidor — a mesma que a RPC usa para decidir quem pode conceder.
  //
  // ⚠️ So para quem o recorte novo descreve. Coordenador e Ass. Administrativo sempre viram
  // esta lista inteira (a aba existe para eles conferirem a vigencia antes de declarar em
  // massa); zera-los aqui seria regressao silenciosa fora do que foi pedido.
  const listaBruta = ehEscopadoPorUnidade(escopo.role)
    ? filtrarPorUnidade(escopo, data || [], (a: any) => a.servidores?.unidade_id)
    : (data || [])
  const dados = listaBruta
    .map((a: any) => ({
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
  const { escopo } = await perfilComEscopo()
  const supabase = await createAdminClient()

  const todos: any[] = []
  for (let from = 0; ; from += 1000) {
    let query = supabase
      .from('servidores')
      .select('id, nome, matricula, setor_id, unidade_id, unidades(nome), setores(dicionario_setores(nome))')
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

  // Servidor fora do escopo nem aparece para escolher: a RPC o recusaria um a um, e oferecer
  // quem sera recusado e o convite a erro da armadilha 31. So para quem o recorte descreve —
  // ver o comentario gemeo em listarAutorizacoesPontoColetivo.
  const elegiveis = ehEscopadoPorUnidade(escopo.role)
    ? filtrarPorUnidade(escopo, todos, (s: any) => s.unidade_id)
    : todos
  return {
    error: null,
    dados: elegiveis.map((s: any) => ({
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
  await exigirRhAutorizador()
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
  await exigirRhAutorizador()
  const supabase = await createClient()

  const { error } = await supabase.rpc('fn_revogar_autorizacao_ponto_coletivo', {
    p_autorizacao_id: id,
    p_motivo: motivo,
  })

  if (error) return { error: error.message }

  revalidatePath('/marcacoes')
  return { error: null }
}

// ---------------------------------------------------------------------------
// Painel de cobertura de ESCALA do parque (06/09/2026)
//
// Responde o que nenhuma tela respondia: "quem está escalado onde NÃO consegue bater ponto, e a
// partir de que dia". A aba Cobertura de Ponto responde isso relógio a relógio; aqui é o parque
// inteiro, ordenado por urgência.
//
// Nasceu do Servidor Externo (lotado numa unidade, escalado em outra) — mas medido em 06/09/2026
// só 2 dos 84 casos eram externos, então o escopo é toda a escala e o externo é só sinalizado.
// Restringir a externos esconderia 82 dos 84.
//
// ⚠️ LEITURA PURA. Não enfileira nada e não escreve em equipamento: quem faz isso é o cron diário
// e o botão "Sincronizar cadastros", que já existem e já funcionam. Um caminho de escrita novo
// aqui seria risco sem ganho.
// ---------------------------------------------------------------------------

export type SituacaoCoberturaEscala =
  | 'sem_biometria'         // está no relógio, sem digital — cadastro presencial
  | 'fora_do_relogio'       // nem cadastro; a fila/cron resolve sozinha
  | 'sem_relogio_no_setor'  // o setor da escala não tem equipamento nenhum
  | 'parcial'               // bate em um relógio da unidade, não em todos

export interface CoberturaEscalaLinha {
  servidor_id: string
  servidor_nome: string
  matricula: string
  escala_unidade_id: string
  unidade_nome: string
  setor_id: string | null
  setor_nome: string | null
  /** Lotado em outra unidade = "Servidor Externo". Sinalizado, nunca usado como filtro. */
  externo: boolean
  lotacao_nome: string | null
  dias_escalados: number
  /** Primeiro dia escalado no mês — é a urgência, e por isso a lista vem ordenada por ele. */
  primeiro_dia: number
  situacao: SituacaoCoberturaEscala
  relogios_alvo: string | null
  /** Onde a pessoa bate hoje, em qualquer unidade. null = nunca cadastrou digital. */
  bate_em: string | null
}

export interface CoberturaEscalaResumo {
  escala_unidade_id: string
  unidade_nome: string
  pessoas: number
  externos: number
  sem_biometria: number
  fora_do_relogio: number
  sem_relogio_no_setor: number
  parcial: number
  bate_em_outra: number
}

export async function listarCoberturaEscala(
  mes?: number, ano?: number,
): Promise<Resultado<CoberturaEscalaLinha[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_cobertura_escala_parque', {
    p_mes: mes ?? null,
    p_ano: ano ?? null,
  })
  if (error) return { dados: [], error: erroLegivel(error) }
  return { dados: (data || []) as CoberturaEscalaLinha[], error: null }
}

export async function listarCoberturaEscalaResumo(
  mes?: number, ano?: number,
): Promise<Resultado<CoberturaEscalaResumo[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_cobertura_escala_resumo', {
    p_mes: mes ?? null,
    p_ano: ano ?? null,
  })
  if (error) return { dados: [], error: erroLegivel(error) }
  return { dados: (data || []) as CoberturaEscalaResumo[], error: null }
}
