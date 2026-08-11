'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { sendWhatsAppMessageAction } from './communication'
import { revalidatePath } from 'next/cache'

/**
 * Acionamento de sobreaviso — Fases 4 a 6 do plano
 * docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
 *
 * Toda regra (papel, abrangência, janela ativa, chamado em aberto, coerência do destino) vive
 * em `fn_acionar_sobreaviso`. Estas actions não revalidam nada disso — se revalidassem, haveria
 * duas regras e uma delas ficaria errada em silêncio.
 */

export type PainelSobreavisoItem = {
  escala_diaria_id: string
  escala_mensal_id: string
  servidor_id: string
  servidor_nome: string
  dia: number
  mes: number
  ano: number
  unidade_id: string
  unidade_nome: string
  setor_id: string | null
  setor_nome: string | null
  turno_codigo: string
  turno_horas: number
  abrangencia: 'geral' | 'unidade'
  janela_inicio: string
  janela_fim: string
  janela_inicio_local: string
  janela_fim_local: string
  ativo_agora: boolean
  log_id: string | null
  log_status: string | null
  log_token: string | null
  log_motivo: string | null
  log_acionado_em: string | null
  log_acionado_por: string | null
  log_destino_unidade: string | null
  log_destino_setor: string | null
  log_destino_referencia: string | null
  chamados_no_dia: number
  pode_acionar: boolean
  motivo_bloqueio: string | null
}

export type DestinoUnidade = {
  id: string
  nome: string
  setores: { id: string; nome: string }[]
}

/**
 * O painel do dashboard. Global por construção: a RPC decide o que aparece e o que pode ser
 * acionado, e é `SECURITY DEFINER` com guard de papel lá dentro.
 */
export async function getPainelSobreaviso(): Promise<PainelSobreavisoItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_painel_sobreaviso_dia')

  if (error) {
    console.error('Erro ao carregar painel de sobreaviso:', error)
    return []
  }
  return (data || []) as PainelSobreavisoItem[]
}

/**
 * Unidades e setores para o seletor de destino.
 *
 * Vai pelo admin client de propósito: o destino é livre — quem aciona pode mandar a pessoa para
 * qualquer lugar da secretaria, inclusive uma unidade a que ele próprio não tem acesso. Filtrar
 * pelo escopo do acionador reintroduziria exatamente o problema que este trabalho resolve.
 * O guard é o papel, conferido abaixo.
 */
export async function getDestinosSobreaviso(): Promise<DestinoUnidade[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (!profile || !['super_admin', 'admin', 'coordenador', 'ass_adm'].includes(profile.role)) return []

  const admin = await createAdminClient()
  const [{ data: unidades }, { data: setores }] = await Promise.all([
    admin.from('unidades').select('id, nome').eq('ativo', true).order('nome'),
    admin.from('setores').select('id, unidade_id, dicionario_setores(nome)').eq('ativo', true)
  ])

  const porUnidade = new Map<string, { id: string; nome: string }[]>()
  for (const s of (setores || []) as any[]) {
    const dict = s.dicionario_setores
    const nome = (Array.isArray(dict) ? dict[0]?.nome : dict?.nome) || 'Setor sem nome'
    if (!porUnidade.has(s.unidade_id)) porUnidade.set(s.unidade_id, [])
    porUnidade.get(s.unidade_id)!.push({ id: s.id, nome })
  }

  return ((unidades || []) as any[]).map(u => ({
    id: u.id,
    nome: u.nome,
    setores: (porUnidade.get(u.id) || []).sort((a, b) => a.nome.localeCompare(b.nome))
  }))
}

/** A unidade/setor de lotação de quem está acionando — o destino pré-selecionado no modal. */
export async function getLotacaoDoAcionador(): Promise<{ unidadeId: string | null; setorId: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { unidadeId: null, setorId: null }

  const { data: profile } = await supabase
    .from('profiles')
    .select('unidade_id, setor_id, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user.id)
    .single()

  if (!profile) return { unidadeId: null, setorId: null }

  // profiles.unidade_id é a lotação principal; se estiver vazia, cai na primeira unidade
  // vinculada. É só um valor inicial de formulário — o usuário pode trocar para qualquer lugar.
  const unidadeId = profile.unidade_id
    || (profile as any).profile_unidades?.[0]?.unidade_id
    || null
  const setorId = profile.setor_id
    || (profile as any).profile_setores?.[0]?.setor_id
    || null

  return { unidadeId, setorId }
}

export async function acionarSobreavisoAction(params: {
  escalaMensalId: string
  dia: number
  motivo: string
  destinoUnidadeId: string
  destinoSetorId?: string | null
  destinoReferencia?: string | null
}): Promise<{ success: boolean; logId?: string; token?: string; link?: string; error?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('fn_acionar_sobreaviso', {
    p_escala_mensal_id: params.escalaMensalId,
    p_dia: params.dia,
    p_motivo: params.motivo,
    p_destino_unidade_id: params.destinoUnidadeId,
    p_destino_setor_id: params.destinoSetorId || null,
    p_destino_referencia: params.destinoReferencia || null
  })

  if (error) {
    console.error('Erro ao acionar sobreaviso:', error)
    return { success: false, error: error.message }
  }
  if (!data?.success) {
    return { success: false, error: data?.error || 'Falha ao acionar sobreaviso.' }
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || ''
  revalidatePath('/home')

  return {
    success: true,
    logId: data.log_id,
    token: data.token,
    link: base ? `${base}/sobreaviso/${data.token}` : ''
  }
}

/**
 * Monta e dispara a mensagem do chamado.
 *
 * O telefone é resolvido AQUI, no servidor, via `fn_contato_acionamento_sobreaviso` — que só
 * responde a quem poderia ter acionado aquele sobreaviso. O painel é global; mandar o telefone
 * de todo servidor de sobreaviso da secretaria para o navegador de todo coordenador seria
 * exposição desnecessária.
 */
export async function enviarAcionamentoWhatsAppAction(params: {
  logId: string
  origin?: string
}): Promise<{ success: boolean; error?: string; fallbackUrl?: string; mensagem?: string }> {
  const supabase = await createClient()

  const { data: contato, error } = await supabase
    .rpc('fn_contato_acionamento_sobreaviso', { p_log_id: params.logId })

  if (error || !contato?.success) {
    return { success: false, error: error?.message || contato?.error || 'Chamado não encontrado.' }
  }

  const { data: cfgRows } = await supabase
    .from('configuracoes_globais').select('chave, valor')
    .eq('chave', 'sobreaviso_tempo_aceite_minutos').maybeSingle()
  const tempoAceite = String((cfgRows as any)?.valor ?? '30').replace(/"/g, '')

  const base = params.origin || process.env.NEXT_PUBLIC_SITE_URL || ''
  const link = `${base}/sobreaviso/${contato.token}`

  const destino = [contato.destino_unidade, contato.destino_setor, contato.destino_referencia]
    .filter(Boolean).join(' — ')

  const mensagem =
    `Olá *${contato.servidor_nome}*, você foi acionado(a) para um chamado de Sobreaviso.\n\n` +
    `*Local:*\n${destino || 'não informado'}\n\n` +
    `*Motivo:*\n${contato.motivo || ''}\n\n` +
    `*Você tem ${tempoAceite} minutos para aceitar esse chamado.*\n\n` +
    `*Para confirmar seu aceite, acesse o link abaixo:*\n${link}`

  const phone: string = contato.telefone || ''
  const cleanPhone = phone.replace(/\D/g, '')
  const fallbackUrl = cleanPhone
    ? `https://api.whatsapp.com/send?phone=${cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone}&text=${encodeURIComponent(mensagem)}`
    : ''

  if (!phone) {
    return { success: false, error: 'O servidor não tem telefone cadastrado.', mensagem }
  }

  // O provedor de comunicação segue o da unidade de ORIGEM do plantão: é a que já tem canal
  // configurado para aquela equipe. O destino pode ser qualquer lugar da rede.
  const res = await sendWhatsAppMessageAction({
    phone,
    message: mensagem,
    unidadeId: contato.unidade_origem_id
  })

  if (res.success) return { success: true, mensagem, fallbackUrl }
  return {
    success: false,
    error: res.error || 'O envio automático via API falhou.',
    fallbackUrl: res.fallbackUrl || fallbackUrl,
    mensagem
  }
}
