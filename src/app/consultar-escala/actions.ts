'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { lerLimitesTolerancia, minutosEntre, toleranciaAbsorve } from '@/utils/folha/toleranciaExtra'
import { definirTimezone, formatarHora } from '@/utils/horario'
import { cookies, headers } from 'next/headers'
import { PORTAL_COOKIE, PORTAL_COOKIE_LEGADO, criarSessaoPortal, validarSessaoPortal, opcoesCookiePortal } from '@/utils/portalSession'
import { unstable_cache, revalidatePath } from 'next/cache'
import { autoCloseExpiredScalesAndTimesheets, isCompetencyClosed } from '@/utils/autoClose'
import { resolverMarcacaoDoDia, turnosDaFolha, COLUNAS_PRESENCA_FOLHA } from '@/utils/folha/origemMarcacao'
import { podePreAssinalarIntervalo } from '@/utils/folha/preAssinalacao'
import { resolverFaltaAutomatica, isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'
import { resolverPendenciaRevisao, resolverBatidaNaoAproveitada, carregarDiasComBatidaFisica } from '@/utils/folha/diaIncompleto'
import { TERMO_ATIVACAO, TERMO_DESATIVACAO, TERMO_VERSAO } from '@/utils/avisoPonto'
import { preservarCampo } from '@/utils/folha/preservacao'
import { montarCargaPorJornada, horasNormaisDoDia } from '@/utils/folha/cargaDiaria'
import { autorizacaoDoDia, aplicarObservacaoAutorizacao } from '@/utils/folha/autorizacaoPonto'
import { afastamentosDoDia, descreverAfastamentos, isShiftOverlappingAfastamento } from '@/utils/folha/afastamentosDia'
import { conferirPinNovo, mensagemRecusaPin } from '@/utils/pin'


/**
 * Identidade do servidor logado no Portal — FONTE UNICA.
 *
 * ⚠️ Toda Server Action do portal DERIVA a identidade daqui. Nenhuma pode receber
 * `servidorId` do cliente: ate 30/08/2026, 12 delas recebiam, com `createAdminClient()`
 * (que ignora RLS) e sem consultar o cookie — bastava passar o UUID de outra pessoa.
 * Quatro dessas 12 ESCREVIAM (ferias, contraproposta), ou seja, agiam em nome de outro
 * servidor sem nunca ter tido a credencial dele.
 *
 * Devolve `null` quando nao ha sessao valida; quem chama responde "Sessao expirada".
 * Portao: scratchpad/sim_portal_sessao.js.
 */
async function servidorDaSessao(): Promise<string | null> {
  const cookieStore = await cookies()
  return validarSessaoPortal(cookieStore.get(PORTAL_COOKIE)?.value)
}

/**
 * Confirma que a matricula existe e devolve APENAS o nome, para a tela perguntar "e voce?".
 *
 * ⚠️ NAO devolve o `id`. Ate 30/08/2026 devolvia — e como esta action nao tem autenticacao
 * nenhuma (a rota /consultar-escala e isenta de login no middleware) e a sessao do portal era o
 * UUID cru num cookie, ela entregava de graca exatamente a chave necessaria para forjar a sessao
 * de qualquer servidor da rede municipal. Matricula e numerica e curta: enumerar era trivial.
 *
 * Devolver o nome continua sendo necessario (a tela confirma a pessoa antes de pedir o PIN) e e
 * inofensivo: nome de servidor publico e dado publico, e nao abre sessao nenhuma.
 */
export async function findServidorByMatricula(matricula: string) {
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('servidores')
    .select('nome')
    .eq('matricula', matricula)
    .eq('status', 'Ativo')
    .single()

  if (error || !data) {
    return { error: 'Servidor não encontrado com esta matrícula.' }
  }

  return { servidor: { nome: data.nome } }
}

/**
 * Valida o PIN e abre a sessao do portal.
 *
 * ⚠️ Recebe a MATRICULA, nao o `servidorId`. O identificador interno nunca transita pelo cliente:
 * quem prova quem e' o par (matricula, PIN), e o `id` e resolvido aqui dentro.
 */
/**
 * Login do Portal: valida (matricula, PIN) e abre a sessao assinada.
 *
 * ⚠️ A decisao inteira — resolver a matricula, aplicar o bloqueio de 5 tentativas / 15 minutos e
 * conferir o PIN — mora em `fn_validar_pin_portal`, no BANCO, numa transacao so.
 *
 * Antes de 30/08/2026 essa logica vivia aqui, e tinha dois furos:
 *   1. era CONTORNAVEL: `verify_pin` estava aberta ao papel `anon` (medido em producao: HTTP
 *      200 com a chave do bundle), entao qualquer um chamava a verificacao direto pelo
 *      PostgREST sem passar por este contador. Com PIN de 4 digitos sao 9.000 tentativas.
 *   2. tinha CORRIDA: ler `pin_failed_attempts`, decidir e so entao gravar deixa N requisicoes
 *      simultaneas lerem 0 e passarem juntas — e forca bruta e, por definicao, concorrente.
 *
 * As mensagens em portugues continuam AQUI de proposito: a funcao devolve codigo e numeros, para
 * nao existirem dois lugares escrevendo o texto que o servidor le.
 */
export async function validatePin(matricula: string, pin: string) {
  const supabase = await createAdminClient()

  const { data, error } = await supabase.rpc('fn_validar_pin_portal', {
    p_matricula: matricula,
    p_pin: pin,
  })

  if (error) {
    console.error('Erro ao validar PIN do portal:', error.message)
    return { error: 'Não foi possível validar o PIN agora. Tente novamente.' }
  }

  const r = data as {
    resultado: 'ok' | 'bloqueado' | 'sem_pin' | 'nao_encontrado' | 'pin_invalido'
    servidor_id?: string
    nome?: string
    minutos_restantes?: number
    tentativas_restantes?: number
  }

  switch (r?.resultado) {
    case 'nao_encontrado':
      return { error: 'Servidor não encontrado.' }

    case 'bloqueado':
      return {
        error: `Muitas tentativas incorretas. Sua conta está bloqueada por mais ${r.minutos_restantes} minutos.`
      }

    case 'sem_pin':
      return { error: 'Você ainda não possui um PIN cadastrado. Solicite ao seu coordenador.' }

    case 'pin_invalido': {
      const restantes = r.tentativas_restantes ?? 0
      if (restantes > 0) {
        return { error: `PIN incorreto. Você tem mais ${restantes} tentativa(s) antes do bloqueio.` }
      }
      return { error: `Muitas tentativas incorretas. Sua conta está bloqueada por 15 minutos.` }
    }

    case 'ok':
      break

    default:
      return { error: 'Não foi possível validar o PIN agora. Tente novamente.' }
  }

  if (!r.servidor_id) {
    return { error: 'Não foi possível validar o PIN agora. Tente novamente.' }
  }

  // Sessao ASSINADA (HMAC) — nunca mais o UUID cru. Ver src/utils/portalSession.ts.
  const cookieStore = await cookies()
  const sessao = criarSessaoPortal(r.servidor_id)
  cookieStore.set(PORTAL_COOKIE, sessao.value, opcoesCookiePortal(sessao.maxAge))

  // Apaga o cookie antigo, se o navegador ainda tiver um. Enquanto ele existir em circulacao,
  // existe um cookie FORJAVEL no ambiente — e nada mais o le', entao mante-lo so cria confusao.
  cookieStore.delete(PORTAL_COOKIE_LEGADO)

  return { success: true, nome: r.nome }
}

export async function getServidorEscalas() {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  try {
    await autoCloseExpiredScalesAndTimesheets()
  } catch (err) {
    console.error('Erro ao executar fechamento automático:', err)
  }

  const supabase = await createAdminClient()

  const { data: escalas, error } = await supabase
    .from('escala_mensal')
    .select(`
      id,
      mes,
      ano,
      unidades (nome),
      setores (dicionario_setores(nome)),
      unidade_id,
      setor_id
    `)
    .eq('servidor_id', servidorId)
    .eq('ativo', true)
    .order('ano', { ascending: false })
    .order('mes', { ascending: false })

  if (error) {
    return { error: error.message }
  }

  const escalasMapped = escalas?.map(e => {
    const sectorData = Array.isArray(e.setores) ? e.setores[0] : e.setores
    const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores)
      ? sectorData.dicionario_setores[0]
      : sectorData.dicionario_setores) : null

    return {
      ...e,
      setores: sectorData ? {
        nome: dictData?.nome || 'SETOR SEM NOME'
      } : null
    }
  })

  return { escalas: escalasMapped }
}

export async function getEscalaDetails(escala: any) {
  const supabase = await createAdminClient()
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  try {
    // Validação de Segurança: Verificar se o servidor logado tem vínculo com essa escala
    // ou se é uma consulta permitida.
    const { data: vinculo } = await supabase
      .from('escala_mensal')
      .select('id')
      .eq('servidor_id', portalServidorId)
      .eq('unidade_id', escala.unidade_id)
      .limit(1)

    // Se o servidor não tiver nenhuma escala nessa unidade, bloqueamos por segurança (IDOR prevention)
    if (!vinculo || vinculo.length === 0) {
      return { error: 'Acesso negado. Você não possui escalas ativas vinculadas a esta unidade.' }
    }

    const { data: escalaMensalRecords } = await supabase
      .from('escala_mensal')
      .select('*, servidores(*)')
      .eq('unidade_id', escala.unidade_id)
      .eq('setor_id', escala.setor_id)
      .eq('mes', escala.mes)
      .eq('ano', escala.ano)
      .eq('ativo', true)

    if (!escalaMensalRecords) throw new Error('Escala não encontrada')

    const emIds = escalaMensalRecords.map(em => em.id)

    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('*')
      .in('escala_mensal_id', emIds)

    // Otimização: Cache de dados estáticos que não mudam frequentemente
    const getCachedStaticData = unstable_cache(
      async () => {
        const [t, j, f, c] = await Promise.all([
          supabase.from('dicionario_turnos').select('*').eq('ativo', true),
          supabase.from('jornadas').select('*').eq('ativo', true),
          supabase.from('feriados').select('*'),
          supabase.from('configuracoes_globais').select('*')
        ])
        return { turnos: t.data, jornadas: j.data, feriados: f.data, configsGlobais: c.data }
      },
      ['static-escala-data'],
      { revalidate: 3600 } // Cache por 1 hora
    )

    const { turnos, jornadas, feriados, configsGlobais } = await getCachedStaticData()
    const { data: unidade } = await supabase.from('unidades').select('*').eq('id', escala.unidade_id).single()
    const { data: setorRaw } = await supabase.from('setores').select('*, dicionario_setores(nome)').eq('id', escala.setor_id).single()

    // Fetch event details for the servers in the monthly scale
    const serverIds = escalaMensalRecords.map(em => em.servidor_id)
    const startStr = `${escala.ano}-${escala.mes.toString().padStart(2, '0')}-01`
    const daysInMonth = new Date(escala.ano, escala.mes, 0).getDate()
    const endStr = `${escala.ano}-${escala.mes.toString().padStart(2, '0')}-${daysInMonth}`

    const { data: servidoresEventos } = await supabase
      .from('servidores_eventos')
      .select('*, tipos_eventos(*)')
      .in('servidor_id', serverIds)
      .or(`data_inicio.lte.${endStr},data_fim.gte.${startStr}`)

    const { data: pontosFacultativos } = await supabase
      .from('pontos_facultativos')
      .select('id, data, descricao, inicio_liberacao_em, fim_liberacao_em')
      .gte('data', startStr)
      .lte('data', endStr)

    const pfMapped = (pontosFacultativos || []).map((pf: any) => ({
      id: pf.id,
      data: pf.data,
      descricao: `Ponto Facultativo: ${pf.descricao}` + (
        pf.inicio_liberacao_em ? ` (a partir das ${pf.inicio_liberacao_em.substring(0, 5)})` :
        pf.fim_liberacao_em ? ` (até as ${pf.fim_liberacao_em.substring(0, 5)})` : ''
      ),
      isPontoFacultativo: true
    }))

    const combinedFeriados = [...(feriados || []), ...pfMapped]

    const sectorData = setorRaw ? {
      ...setorRaw,
      nome: (Array.isArray(setorRaw.dicionario_setores)
        ? setorRaw.dicionario_setores[0]?.nome
        : (setorRaw as any).dicionario_setores?.nome) || 'SETOR SEM NOME'
    } : null

    return {
      data: {
        escalaMensal: escalaMensalRecords,
        escalaDiaria: escalaDiaria || [],
        turnos: turnos || [],
        jornadas: jornadas || [],
        feriados: combinedFeriados,
        unidade,
        setor: sectorData,
        mes: escala.mes,
        ano: escala.ano,
        servidoresEventos: servidoresEventos || [],
        configsGlobais: configsGlobais || []
      }
    }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function logoutPortal() {
  const cookieStore = await cookies()
  cookieStore.delete(PORTAL_COOKIE)
  // O legado tambem sai: sair do portal tem que limpar TUDO que um dia serviu de sessao.
  cookieStore.delete(PORTAL_COOKIE_LEGADO)
}

function getExtraHoursFromShift(extraShift: any): number {
  if (!extraShift || !extraShift.dicionario_turnos) return 0
  const dt = extraShift.dicionario_turnos
  const dtObj = Array.isArray(dt) ? dt[0] : dt
  if (dtObj?.horas_computadas && Number(dtObj.horas_computadas) > 0) {
    return Number(dtObj.horas_computadas)
  }
  if (dtObj?.codigo) {
    const val = parseFloat(String(dtObj.codigo).replace(',', '.'))
    if (!isNaN(val) && val > 0) return val
  }
  return 0
}

// ============================================================
// Portal de Solicitação de Trocas — SisEscala v0.6.0
// ============================================================

export async function createSwapRequest(params: {
  escalaMensalId: string
  diaOrigem: number
  categoriaOrigem: string
  turnoOrigemId: string
  justificativa: string
  destinatarioId?: string
}) {
  const supabase = await createAdminClient()
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  // Validar que a justificativa não está vazia
  if (!params.justificativa || params.justificativa.trim().length < 5) {
    return { error: 'A justificativa deve ter pelo menos 5 caracteres.' }
  }

  // Verificar limite de solicitações pendentes (anti-spam: max 3)
  const { data: pendentes } = await supabase
    .from('solicitacoes_troca')
    .select('id')
    .eq('solicitante_id', portalServidorId)
    .eq('status', 'Pendente')

  if (pendentes && pendentes.length >= 3) {
    return { error: 'Você já possui 3 solicitações pendentes. Aguarde a análise antes de criar novas.' }
  }

  // Verificar que a escala pertence ao servidor logado
  const { data: escala } = await supabase
    .from('escala_mensal')
    .select('id, status, servidor_id, mes, ano')
    .eq('id', params.escalaMensalId)
    .eq('servidor_id', portalServidorId)
    .single()

  if (!escala) {
    return { error: 'Escala não encontrada ou não pertence a você.' }
  }

  if (escala.status === 'Fechada') {
    return { error: 'Não é possível solicitar troca em uma escala já fechada.' }
  }

  // Validar que o dia solicitado não é passado
  const hoje = new Date()
  const diaEscala = new Date(escala.ano, escala.mes - 1, params.diaOrigem)
  if (diaEscala <= hoje) {
    return { error: 'Não é possível solicitar troca para um dia que já passou.' }
  }

  // Verificar que o dia tem turno atribuído
  const { data: diaria } = await supabase
    .from('escala_diaria')
    .select('id, dicionario_turnos_id')
    .eq('escala_mensal_id', params.escalaMensalId)
    .eq('dia', params.diaOrigem)
    .eq('categoria', params.categoriaOrigem)
    .single()

  if (!diaria || !diaria.dicionario_turnos_id) {
    return { error: 'Não há turno atribuído neste dia para solicitar troca.' }
  }

  // Criar a solicitação
  const { data: solicitacao, error } = await supabase
    .from('solicitacoes_troca')
    .insert({
      solicitante_id: portalServidorId,
      escala_mensal_solicitante_id: params.escalaMensalId,
      dia_origem: params.diaOrigem,
      categoria_origem: params.categoriaOrigem,
      turno_origem_id: diaria.dicionario_turnos_id,
      destinatario_id: params.destinatarioId || null,
      justificativa: params.justificativa.trim()
    })
    .select()
    .single()

  if (error) {
    return { error: 'Erro ao criar solicitação: ' + error.message }
  }

  return { success: true, solicitacao }
}

export async function getSwapRequests() {
  const supabase = await createAdminClient()
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada.' }
  }

  const { data, error } = await supabase
    .from('solicitacoes_troca')
    .select(`
      *,
      solicitante:servidores!solicitacoes_troca_solicitante_id_fkey(nome, matricula),
      destinatario:servidores!solicitacoes_troca_destinatario_id_fkey(nome),
      turno:dicionario_turnos!solicitacoes_troca_turno_origem_id_fkey(codigo, descricao),
      escala:escala_mensal!solicitacoes_troca_escala_mensal_solicitante_id_fkey(mes, ano, unidade_id, setor_id)
    `)
    .eq('solicitante_id', portalServidorId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return { error: error.message }
  }

  return { solicitacoes: data || [] }
}

export async function cancelSwapRequest(solicitacaoId: string) {
  const supabase = await createAdminClient()
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada.' }
  }

  // Verificar que a solicitação pertence ao servidor e está pendente
  const { data: sol } = await supabase
    .from('solicitacoes_troca')
    .select('id, solicitante_id, status')
    .eq('id', solicitacaoId)
    .eq('solicitante_id', portalServidorId)
    .eq('status', 'Pendente')
    .single()

  if (!sol) {
    return { error: 'Solicitação não encontrada ou não pode ser cancelada.' }
  }

  const { error } = await supabase
    .from('solicitacoes_troca')
    .update({ status: 'Cancelada', updated_at: new Date().toISOString() })
    .eq('id', solicitacaoId)

  if (error) {
    return { error: 'Erro ao cancelar: ' + error.message }
  }

  return { success: true }
}

export async function getFolhaPontoServidor(mes: number, ano: number, escalaMensalId?: string) {
  const supabase = await createAdminClient()
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  // A identidade VEM da sessao. Antes vinha do cliente e era conferida com `!==` aqui — o que
  // funcionava, mas dependia de cada acao nova lembrar de conferir, e 12 nao lembraram.
  const servidorId = portalServidorId

  let query = supabase
    .from('folha_ponto')
    .select('*, servidores(*)')
    .eq('servidor_id', servidorId)

  if (escalaMensalId) {
    query = query.eq('escala_mensal_id', escalaMensalId)
  } else {
    query = query.eq('mes', mes).eq('ano', ano)
  }

  let { data: folha, error } = await query.maybeSingle()

  if (error) {
    return { error: error.message }
  }

  if (!folha) {
    return { folha: null }
  }

  const { data: escala } = await supabase
    .from('escala_mensal')
    .select('*, unidades(*), setores(*, dicionario_setores(nome)), jornadas(*)')
    .eq('id', folha.escala_mensal_id)
    .single()

  if (escala && await checkIfFolhaHasPendingPastTimes(folha, escala)) {
    await sincronizarFolhaPontoServidor(folha.id)
    const { data: updatedFolha } = await query.maybeSingle()
    if (updatedFolha) {
      folha = updatedFolha
    }
  }

  const sectorData = escala ? (Array.isArray(escala.setores) ? escala.setores[0] : escala.setores) : null
  const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores)
    ? sectorData.dicionario_setores[0]
    : sectorData.dicionario_setores) : null

  const resolvedSetor = sectorData ? {
    ...sectorData,
    nome: dictData?.nome || 'SETOR SEM NOME'
  } : null

  return {
    folha: {
      ...folha,
      escala: escala ? {
        ...escala,
        setores: resolvedSetor
      } : null
    }
  }
}

// ============================================================
// Portal do Servidor - Folha de Ponto (Phase 8 Additions)
// ============================================================

// Helpers for calculations
function parseJornadaNome(nome: string): { startHour: number; startMin: number; endHour: number; endMin: number } {
  const defaultVal = { startHour: 8, startMin: 0, endHour: 17, endMin: 0 }
  if (!nome) return defaultVal

  const match = nome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
  if (!match) return defaultVal

  const startHour = parseInt(match[1], 10)
  const startMin = match[2] ? parseInt(match[2], 10) : 0
  const endHour = parseInt(match[3], 10)
  const endMin = match[4] ? parseInt(match[4], 10) : 0

  return { startHour, startMin, endHour, endMin }
}

function getDeterministicOffset(seedStr: string, maxOffset: number = 15): number {
  let hash = 0
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash)
  }
  const absOffset = (Math.abs(hash) % (maxOffset - 1)) + 1
  const sign = hash % 2 === 0 ? 1 : -1
  return sign * absOffset
}

function formatMinutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function generateFingerprint(records: any[]): string {
  const simplified = records.map(r => ({
    dia: r.dia,
    turno: r.dicionario_turnos_id
  }))
  simplified.sort((a, b) => a.dia - b.dia)
  const str = JSON.stringify(simplified)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash).toString(16)
}

function getTurnoCodigo(dicionarioTurnos: any): string | null {
  if (!dicionarioTurnos) return null
  if (Array.isArray(dicionarioTurnos)) {
    return dicionarioTurnos[0]?.codigo || null
  }
  return dicionarioTurnos.codigo || null
}


export async function checkIfFolhaHasPendingPastTimes(folha: any, escala: any, timezone: string = 'America/Sao_Paulo'): Promise<boolean> {
  if (!folha || !folha.registros || folha.status === 'Revisada') return false

  const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
  const currentYear = nowLocal.getFullYear()
  const currentMonth = nowLocal.getMonth() + 1
  const currentDay = nowLocal.getDate()

  const hasInterval = (escala?.jornadas?.intervalo_minutos ?? 60) > 0

  for (const r of folha.registros) {
    if (r.turno_codigo && !r.feriado && !r.afastamento) {
      const isFullDayPF = r.ponto_facultativo && 
        !(r.observacao || '').includes('PARTIR') && 
        !(r.observacao || '').includes('ATÉ')
      
      if (isFullDayPF) continue

      let isPastDay = false
      if (folha.ano < currentYear) {
        isPastDay = true
      } else if (folha.ano === currentYear) {
        if (folha.mes < currentMonth) {
          isPastDay = true
        } else if (folha.mes === currentMonth) {
          if (r.dia < currentDay) {
            isPastDay = true
          }
        }
      }

      if (isPastDay) {
        const hasEmptyFicticioTimes = 
          (r.entrada === '' && r.origem_entrada !== 'manual') ||
          (r.saida === '' && r.origem_saida !== 'manual') ||
          (hasInterval && r.saida_intervalo === '' && r.origem_saida_intervalo !== 'manual') ||
          (hasInterval && r.retorno_intervalo === '' && r.origem_retorno_intervalo !== 'manual')

        if (hasEmptyFicticioTimes) {
          return true
        }
      }
    }
  }

  return false
}

// Server Action: Save employee's timesheet from the portal
/**
 * Solicitação de ajuste de ponto pelo servidor.
 *
 * Substitui a edição direta da folha pelo portal. O servidor informa o horário que cumpriu; isso
 * vira marcação de origem `ajuste_servidor` (precedência 4, a mais baixa) pendente de revisão do
 * coordenador — não entra na folha por conta própria.
 *
 * A validação de posse acontece no banco (`fn_solicitar_ajuste_ponto` confere se o dia pertence
 * ao servidor), porque o portal autentica apenas por PIN e o cookie é o único vínculo aqui.
 */
export async function solicitarAjustePonto(
  folhaId: string,
  dia: number,
  horarios: Record<string, string>,
  justificativa: string
) {
  try {
    const supabase = await createAdminClient()
    const portalServidorId = await servidorDaSessao()

    if (!portalServidorId) {
      return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
    }

    const { data: folha } = await supabase
      .from('folha_ponto')
      .select('id, servidor_id, escala_mensal_id')
      .eq('id', folhaId)
      .single()

    if (!folha) return { error: 'Folha de ponto não encontrada.' }
    if (folha.servidor_id !== portalServidorId) return { error: 'Acesso negado.' }

    // Resolve a linha do dia. Regular é a categoria natural de uma solicitação do servidor;
    // Sobreaviso é excluído porque tem ciclo próprio e não registra presença.
    const { data: linhas } = await supabase
      .from('escala_diaria')
      .select('id, categoria')
      .eq('escala_mensal_id', folha.escala_mensal_id)
      .eq('dia', dia)

    const alvo = (linhas || []).find(l => l.categoria === 'Regular')
      || (linhas || []).find(l => l.categoria !== 'Sobreaviso')

    if (!alvo) return { error: 'Não há turno registrado para você neste dia.' }

    const { data, error } = await supabase.rpc('fn_solicitar_ajuste_ponto', {
      p_servidor_id: portalServidorId,
      p_escala_diaria_id: alvo.id,
      p_horarios: horarios,
      p_justificativa: justificativa,
    })

    if (error) throw error
    if (data && !data.success) return { error: data.message }

    return { success: true, message: data?.message }
  } catch (error: any) {
    console.error('Erro ao solicitar ajuste de ponto:', error)
    return { error: error.message || 'Não foi possível enviar a solicitação.' }
  }
}

export async function salvarFolhaPontoServidor(folhaId: string, registros: any[]) {
  try {
    const supabase = await createAdminClient()
    const portalServidorId = await servidorDaSessao()

    if (!portalServidorId) {
      return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
    }

    // Fetch existing sheet
    const { data: folha, error: fetchError } = await supabase
      .from('folha_ponto')
      .select('id, escala_mensal_id, mes, ano, status, servidor_id, registros')
      .eq('id', folhaId)
      .single()

    if (fetchError || !folha) throw new Error('Folha de ponto não encontrada')

    if (folha.servidor_id !== portalServidorId) {
      return { error: 'Acesso negado.' }
    }

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // O portal NÃO altera horário de ponto. Desde 20260808130000 o servidor solicita ajuste
    // (fn_solicitar_ajuste_ponto) e o coordenador decide; a folha aqui é somente leitura.
    //
    // Isto é defesa de servidor, não só de interface: os inputs já vêm desabilitados quando
    // isPortal, mas a action é chamável direto e o portal autentica apenas por PIN. Antes da
    // v1.22.0 o risco era menor porque entrada e saída sempre traziam horário gerado; agora
    // essas células nascem vazias, e uma célula vazia editável é autodeclaração de ponto sem
    // nenhuma conferência.
    const oldRegistros = folha.registros as any[]
    for (const r of registros) {
      const oldR = oldRegistros?.find((o: any) => o.dia === r.dia)
      if (oldR) {
        const alterouHorario =
          r.entrada !== oldR.entrada ||
          r.saida_intervalo !== oldR.saida_intervalo ||
          r.retorno_intervalo !== oldR.retorno_intervalo ||
          r.saida !== oldR.saida
        if (alterouHorario) {
          return {
            error: 'A folha não é editável por aqui. Use "informar horário" no dia desejado — '
              + 'sua solicitação vai para o coordenador com o horário que você informar.'
          }
        }
      }
      if (oldR) {
        if (oldR.origem_entrada === 'real' && r.entrada !== oldR.entrada) {
          return { error: 'Não é permitido alterar marcações reais de entrada.' }
        }
        if (oldR.origem_saida_intervalo === 'real' && r.saida_intervalo !== oldR.saida_intervalo) {
          return { error: 'Não é permitido alterar marcações reais de saída intervalo.' }
        }
        if (oldR.origem_retorno_intervalo === 'real' && r.retorno_intervalo !== oldR.retorno_intervalo) {
          return { error: 'Não é permitido alterar marcações reais de retorno intervalo.' }
        }
        if (oldR.origem_saida === 'real' && r.saida !== oldR.saida) {
          return { error: 'Não é permitido alterar marcações reais de saída.' }
        }
      }
    }

    if (folha.status === 'Revisada') {
      return { error: 'Esta folha de ponto já foi revisada e fechada pela coordenação e não pode ser editada.' }
    }

    // Fetch scale
    const { data: escala } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id, status, jornada_id, jornadas(horas_totais, nome, intervalo_minutos)')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (!escala) throw new Error('Escala vinculada não encontrada')

    const jornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8

    // Carga de cada dia: a jornada do mes e so o PADRAO; dias cobertos por vigencia valem a
    // carga gravada em registro.jornada_nome. Ver src/utils/folha/cargaDiaria.ts.
    const { data: todasJornadas } = await supabase
      .from('jornadas')
      .select('nome, horas_totais')
    const cargaPorJornada = montarCargaPorJornada(todasJornadas)

    // Fetch holidays
    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data')
      .gte('data', startDate)
      .lte('data', endDate)
    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    registros.forEach(r => {
      if (r.turno_codigo) {
        totalHorasNormais += horasNormaisDoDia(r, cargaPorJornada, horasNormaisDiarias)
      }

      if (isFaltaDefinitiva(r.observacao)) {
        totalFaltas++
      }

      if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
        const dateObj = new Date(folha.ano, folha.mes - 1, r.dia)
        const dateStr = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`
        const isSunday = dateObj.getDay() === 0
        const isHoliday = feriadosSet.has(dateStr)

        if (isSunday || isHoliday) {
          totalExtra100 += r.hora_extra_minutos
        } else {
          if (r.hora_extra_tipo === '100%') {
            totalExtra100 += r.hora_extra_minutos
          } else {
            totalExtra50 += r.hora_extra_minutos
          }
        }
      }
    })

    const updatePayload: any = {
      registros,
      total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
      total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
      total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
      total_faltas: totalFaltas,
      ultima_edicao_em: new Date().toISOString()
    }

    const { error: updateError } = await supabase
      .from('folha_ponto')
      .update(updatePayload)
      .eq('id', folhaId)

    if (updateError) throw updateError

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar folha pelo servidor:', error)
    return { error: error.message }
  }
}

// Server Action: Check scale divergence from the portal
export async function verificarDivergenciaEscalaServidor(folhaId: string) {
  try {
    const supabase = await createAdminClient()
    const portalServidorId = await servidorDaSessao()

    if (!portalServidorId) {
      return { divergent: false }
    }

    const { data: folha } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, escala_fingerprint, registros, servidor_id')
      .eq('id', folhaId)
      .single()

    if (!folha || folha.servidor_id !== portalServidorId) return { divergent: false }

    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('dia, dicionario_turnos_id, categoria, dicionario_turnos(codigo)')
      .eq('escala_mensal_id', folha.escala_mensal_id)
      .eq('categoria', 'Regular')

    const currentFingerprint = generateFingerprint(escalaDiaria || [])
    let divergent = currentFingerprint !== folha.escala_fingerprint

    const affectedDays: number[] = []
    if (divergent) {
      const records = folha.registros as any[]
      const currentShifts = escalaDiaria || []

      for (let day = 1; day <= 31; day++) {
        const record = records.find(r => r.dia === day)
        const currentShift = currentShifts.find(s => s.dia === day)

        const hadShift = record && record.turno_codigo !== null
        const hasShift = !!currentShift

        const changed = (hadShift !== hasShift) || (hadShift && record.turno_codigo !== getTurnoCodigo(currentShift?.dicionario_turnos))
        if (changed) {
          affectedDays.push(day)
        }
      }

      if (affectedDays.length === 0) {
        divergent = false
        await supabase
          .from('folha_ponto')
          .update({ escala_fingerprint: currentFingerprint })
          .eq('id', folhaId)
      }
    }

    return {
      divergent,
      currentFingerprint,
      savedFingerprint: folha.escala_fingerprint,
      affectedDays
    }
  } catch (error) {
    console.error('Erro ao verificar divergência pelo servidor:', error)
    return { divergent: false }
  }
}

// Server Action: Sync sheet with escala from the portal
export async function sincronizarFolhaPontoServidor(folhaId: string) {
  try {
    const supabase = await createAdminClient()
    const portalServidorId = await servidorDaSessao()

    if (!portalServidorId) {
      return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
    }

    const { data: folha, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('*')
      .eq('id', folhaId)
      .single()

    if (folhaError || !folha) throw new Error('Folha de ponto não encontrada')

    if (folha.servidor_id !== portalServidorId) {
      return { error: 'Acesso negado.' }
    }

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    if (folha.status === 'Revisada') {
      return { error: 'Esta folha de ponto já foi revisada e fechada pela coordenação e não pode ser sincronizada.' }
    }

    const { data: escala, error: escError } = await supabase
      .from('escala_mensal')
      .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (escError || !escala) throw new Error('Escala vinculada não encontrada')

    // Fetch all shifts from escala_diaria (Regular, Extra, Plantão) for the specific scale of this folha
    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select(`id, dia, categoria, dicionario_turnos_id, ${COLUNAS_PRESENCA_FOLHA}, presenca_confirmada, dicionario_turnos(codigo, slots, horas_computadas)`)
      .eq('escala_mensal_id', escala.id)

    // Origem das marcacoes vem das flags presenca_*_manual — ver origemMarcacao.ts.

    const currentShifts = escalaDiaria || []
    const fingerprint = generateFingerprint(currentShifts.filter(d => d.categoria === 'Regular'))

    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    // Fetch pontos facultativos
    const { data: pontosFacultativos } = await supabase
      .from('pontos_facultativos')
      .select('id, data, descricao, inicio_liberacao_em, fim_liberacao_em, gera_he_para_essenciais')
      .gte('data', startDate)
      .lte('data', endDate)

    const { data: pfSetores } = await supabase
      .from('ponto_facultativo_setores')
      .select('*')

    const { data: sectorInfo } = await supabase
      .from('setores')
      .select('essencial')
      .eq('id', escala.setor_id)
      .maybeSingle()
    const isSectorEssencial = !!sectorInfo?.essencial

    const { data: afastamentos } = await supabase
      .from('servidores_eventos')
      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)

    // Autorizacoes do RH para validacao coletiva (27/08/2026). A folha precisa IMPRIMIR o
    // oficio: sem ele o dia aparece como horario manual qualquer, e o documento e' justamente
    // o que responde a fiscalizacao. Nao preenche horario nenhum.
    const { data: autorizacoesPonto } = await supabase
      .from('autorizacoes_ponto_coletivo')
      .select('passos, documento, vigencia_inicio, vigencia_fim')
      .eq('servidor_id', folha.servidor_id)
      .is('revogado_em', null)
      .lte('vigencia_inicio', endDate)
      .gte('vigencia_fim', startDate)

    // Fetch temporary journeys overlapping this month
    const { data: tempJourneys } = await supabase
      .from('servidores_jornadas_temporarias')
      .select('*, jornadas(nome, horas_totais, intervalo_minutos)')
      .eq('servidor_id', folha.servidor_id)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)

    // Parse Jornada
    const globalJornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const globalJornada = parseJornadaNome(globalJornadaDetails?.nome || '')
    const globalIntervaloMinutos = globalJornadaDetails?.intervalo_minutos ?? 60
    const globalHorasNormaisDiarias = globalJornadaDetails?.horas_totais ?? 8

    // Prazo (dias uteis apos o FIM DO MES) para justificar um dia sem nenhuma marcacao antes
    // dele virar falta definitiva. Ver src/utils/folha/faltaAutomatica.ts.
    const { data: configPrazoJustificativa } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'justificativa_prazo_dias_uteis')
      .maybeSingle()
    const prazoJustificativaDiasUteis = configPrazoJustificativa?.valor
      ? parseInt(configPrazoJustificativa.valor as string, 10)
      : 3

    // Pre-assinalacao do intervalo so vale onde a unidade NAO exige que o servidor marque o
    // intervalo no ponto. Onde exige, o horario tem de vir de batida. Ver preAssinalacao.ts.
    const { data: unidadeIntervalo } = await supabase
      .from('unidades')
      .select('permite_marca_intervalo')
      .eq('id', escala.unidade_id)
      .maybeSingle()
    const podePreAssinalar = podePreAssinalarIntervalo(unidadeIntervalo?.permite_marca_intervalo)

    // Fetch timezone and setup current local time limit
    const { data: configTimezone } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'timezone')
      .maybeSingle()
    const timezone = (configTimezone?.valor as string) || 'America/Sao_Paulo'
    definirTimezone(timezone)

    // Tolerancia de variacao de horario (CLT Art. 58 §1º). Configuravel porque regra local pode
    // divergir; ausente, cai no default da CLT. Ver src/utils/folha/toleranciaExtra.ts.
    const { data: cfgTolerancia } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')
      .in('chave', ['tolerancia_extra_minutos_por_marcacao', 'tolerancia_extra_minutos_diaria'])
    const limitesTolerancia = lerLimitesTolerancia(cfgTolerancia)
    const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
    const currentYear = nowLocal.getFullYear()
    const currentMonth = nowLocal.getMonth() + 1
    const currentDay = nowLocal.getDate()
    const currentHour = nowLocal.getHours()
    const currentMinute = nowLocal.getMinutes()
    const currentTotalMin = currentHour * 60 + currentMinute

    const registrosExistentes = folha.registros as any[]
    const registrosAtualizados: any[] = []

    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    const weekDaysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    // Um dia sem passo nenhum pode ser FALTA ou pode ser batida que a alocacao nao aproveitou.
    // escala_diaria sozinha nao distingue os dois — ela nao sabe que a marcacao existe. Sem
    // isto, quem tem batida com NSR de AFD assinado recebe falta (3 casos medidos em 21/08/2026).
    const diasComBatidaFisica = await carregarDiasComBatidaFisica(supabase, folha.servidor_id, folha.mes, folha.ano)

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(folha.ano, folha.mes - 1, day)
      const dayOfWeekStr = weekDaysShort[dateObj.getDay()]
      const dateStr = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // Resolve dynamic journey for this day
      const tempJourney = tempJourneys?.find(tj => dateStr >= tj.data_inicio && dateStr <= tj.data_fim)
      const activeJornada = tempJourney ? tempJourney.jornadas : globalJornadaDetails
      const { startHour, startMin, endHour, endMin } = activeJornada === globalJornadaDetails ? globalJornada : parseJornadaNome(activeJornada?.nome || '')
      const intervaloMinutos = activeJornada === globalJornadaDetails ? globalIntervaloMinutos : (activeJornada?.intervalo_minutos ?? 60)
      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : (activeJornada?.horas_totais ?? 8)

      const currentShift = currentShifts.find(s => s.dia === day && s.categoria === 'Regular')
      const extraShift = currentShifts.find(s => s.dia === day && s.categoria === 'Extra')
      const extraHoursScheduled = getExtraHoursFromShift(extraShift)
      const extraMinutesScheduled = Math.round(extraHoursScheduled * 60)
      const registroExistente = registrosExistentes.find(r => r.dia === day)

      const hadShift = registroExistente && registroExistente.turno_codigo !== null
      const hasShift = !!currentShift

      const scaleChangedForDay = (hadShift !== hasShift) || (hadShift && registroExistente.turno_codigo !== getTurnoCodigo(currentShift?.dicionario_turnos))

      const afastamentosDia = afastamentosDoDia(afastamentos, dateStr)
      const afastamentosAnulantes = afastamentosDia.filter(af => isShiftOverlappingAfastamento(af, currentShift))
      const feriadoInfo = feriados?.find(f => f.data === dateStr)

      const shouldPreserve = !scaleChangedForDay

      // Otherwise, REGENERATE the day
      const shouldGenerate = (scheduledMin: number) => {
        if (folha.ano > currentYear) return false
        if (folha.ano < currentYear) return true
        if (folha.mes > currentMonth) return false
        if (folha.mes < currentMonth) return true
        if (day > currentDay) return false
        if (day < currentDay) return true
        return currentTotalMin >= (scheduledMin % 1440)
      }

      // Check if point facultativo applies
      const pf = pontosFacultativos?.find(p => p.data === dateStr)
      let pfInfo = null
      if (pf) {
        const rule = pfSetores?.find(r => r.ponto_facultativo_id === pf.id && r.setor_id === escala.setor_id)
        if (rule) {
          if (rule.tipo_regra === 'incluido') pfInfo = pf
        } else if (!isSectorEssencial) {
          pfInfo = pf
        }
      }

      let registro: any = {
        dia: day,
        dia_semana: dayOfWeekStr,
        turno_codigo: getTurnoCodigo(currentShift?.dicionario_turnos),
        entrada: '',
        saida_intervalo: '',
        retorno_intervalo: '',
        saida: '',
        hora_extra_minutos: 0,
        hora_extra_tipo: null,
        observacao: '',
        origem_entrada: null,
        origem_saida_intervalo: null,
        origem_retorno_intervalo: null,
        origem_saida: null,
        feriado: !!feriadoInfo,
        ponto_facultativo: !!pfInfo,
        afastamento: afastamentosAnulantes.length > 0 ? descreverAfastamentos(afastamentosAnulantes) : null
      }

      if (registro.afastamento) {
        registro.observacao = registro.afastamento.toUpperCase()
      } else if (registro.feriado) {
        registro.observacao = `FERIADO: ${feriadoInfo?.descricao}`.toUpperCase()
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (registro.ponto_facultativo && pfInfo && !pfInfo.inicio_liberacao_em && !pfInfo.fim_liberacao_em) {
        // Full day Ponto Facultativo
        registro.observacao = `PONTO FACULTATIVO: ${pfInfo.descricao}`.toUpperCase()
        if (currentShift) {
          totalHorasNormais += horasNormaisDiarias
        }
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (!currentShift) {
        if (dateObj.getDay() === 0) {
          registro.observacao = 'DOMINGO'
        } else if (dateObj.getDay() === 6) {
          registro.observacao = 'SÁBADO'
        } else {
          registro.observacao = 'FOLGA'
        }
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)} | ${registro.observacao}`.toUpperCase()
        }
      } else {
        totalHorasNormais += horasNormaisDiarias
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO A PARTIR DAS ${pfInfo.inicio_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          } else if (pfInfo.fim_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO ATÉ AS ${pfInfo.fim_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          }
        }
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)}${registro.observacao ? ' | ' + registro.observacao : ''}`.toUpperCase()
        }

        // Consolida os turnos do dia e resolve, para cada passo, o horário vencedor junto da
        // origem daquele horário específico.
        const dayShifts = turnosDaFolha(currentShifts.filter(d => d.dia === day))

        const marcEntrada = resolverMarcacaoDoDia(dayShifts, 'entrada')
        const marcIntervaloSaida = resolverMarcacaoDoDia(dayShifts, 'intervalo_saida')
        const marcIntervaloRetorno = resolverMarcacaoDoDia(dayShifts, 'intervalo_retorno')
        const marcSaida = resolverMarcacaoDoDia(dayShifts, 'saida')

        const isManualEntrada = marcEntrada.manual
        const isManualIntervaloSaida = marcIntervaloSaida.manual
        const isManualIntervaloRetorno = marcIntervaloRetorno.manual
        const isManualSaida = marcSaida.manual

        const realEntradaTime = marcEntrada.horario
        const realIntervaloSaidaTime = marcIntervaloSaida.horario
        const realIntervaloRetornoTime = marcIntervaloRetorno.horario
        const realSaidaTime = marcSaida.horario

        const hasRealEntrada = realEntradaTime !== null && !isManualEntrada
        const hasRealIntervaloSaida = realIntervaloSaidaTime !== null && !isManualIntervaloSaida
        const hasRealIntervaloRetorno = realIntervaloRetornoTime !== null && !isManualIntervaloRetorno
        const hasRealSaida = realSaidaTime !== null && !isManualSaida

        const officialEntradaMin = startHour * 60 + startMin
        const baseOfficialSaidaMin = endHour * 60 + endMin
        let officialSaidaMin = baseOfficialSaidaMin + extraMinutesScheduled
        let totalBrutoMin = officialSaidaMin - officialEntradaMin
        if (totalBrutoMin < 0) totalBrutoMin += 24 * 60

        const halfJornadaMin = Math.floor(totalBrutoMin / 2)
        const officialSaidaIntervaloMin = (officialEntradaMin + halfJornadaMin) % (24 * 60)
        const officialRetornoIntervaloMin = (officialSaidaIntervaloMin + intervaloMinutos) % (24 * 60)

        const seedBase = `${folha.servidor_id}-${folha.mes}-${folha.ano}-${day}`

        // Parse ponto facultativo release/limit minutes
        let pfInicioMin: number | null = null
        let pfFimMin: number | null = null
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            const parts = pfInfo.inicio_liberacao_em.split(':')
            pfInicioMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
          if (pfInfo.fim_liberacao_em) {
            const parts = pfInfo.fim_liberacao_em.split(':')
            pfFimMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
        }

        // 1. Entrance Time
        // 1. Entrance Time
        if (shouldPreserve && preservarCampo(registroExistente, 'entrada')) {
          registro.entrada = registroExistente.entrada
          registro.origem_entrada = registroExistente.origem_entrada || 'manual'
        } else if (hasRealEntrada && realEntradaTime) {
          registro.entrada = formatarHora(realEntradaTime)
          registro.origem_entrada = 'real'
        } else if (isManualEntrada && realEntradaTime) {
          registro.entrada = formatarHora(realEntradaTime)
          registro.origem_entrada = 'manual'
        }

        // 2. Exit Time
        if (shouldPreserve && preservarCampo(registroExistente, 'saida')) {
          registro.saida = registroExistente.saida
          registro.origem_saida = registroExistente.origem_saida || 'manual'
        } else if (hasRealSaida && realSaidaTime) {
          registro.saida = formatarHora(realSaidaTime)
          registro.origem_saida = 'real'
        } else if (isManualSaida && realSaidaTime) {
          registro.saida = formatarHora(realSaidaTime)
          registro.origem_saida = 'manual'
        }

        // 3. Lunch Interval
        if (intervaloMinutos > 0) {
          let targetSaidaMin = officialSaidaMin
          if (pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            targetSaidaMin = pfInicioMin
          }
          
          if (targetSaidaMin > officialSaidaIntervaloMin) {
            if (shouldPreserve && preservarCampo(registroExistente, 'saida_intervalo')) {
              registro.saida_intervalo = registroExistente.saida_intervalo
              registro.origem_saida_intervalo = registroExistente.origem_saida_intervalo || 'manual'
            } else if (hasRealIntervaloSaida && realIntervaloSaidaTime) {
              registro.saida_intervalo = formatarHora(realIntervaloSaidaTime)
              registro.origem_saida_intervalo = 'real'
            } else if (isManualIntervaloSaida && realIntervaloSaidaTime) {
              registro.saida_intervalo = formatarHora(realIntervaloSaidaTime)
              registro.origem_saida_intervalo = 'manual'
            } else if (podePreAssinalar && shouldGenerate(officialSaidaIntervaloMin)) {
              registro.saida_intervalo = formatMinutesToTimeStr(officialSaidaIntervaloMin)
              registro.origem_saida_intervalo = 'pre_assinalado'
            }

            if (shouldPreserve && preservarCampo(registroExistente, 'retorno_intervalo')) {
              registro.retorno_intervalo = registroExistente.retorno_intervalo
              registro.origem_retorno_intervalo = registroExistente.origem_retorno_intervalo || 'manual'
            } else if (hasRealIntervaloRetorno && realIntervaloRetornoTime) {
              registro.retorno_intervalo = formatarHora(realIntervaloRetornoTime)
              registro.origem_retorno_intervalo = 'real'
            } else if (isManualIntervaloRetorno && realIntervaloRetornoTime) {
              registro.retorno_intervalo = formatarHora(realIntervaloRetornoTime)
              registro.origem_retorno_intervalo = 'manual'
            } else if (podePreAssinalar && shouldGenerate(officialRetornoIntervaloMin)) {
              registro.retorno_intervalo = formatMinutesToTimeStr(officialRetornoIntervaloMin)
              registro.origem_retorno_intervalo = 'pre_assinalado'
            }
          }
        }

        const temMarcacao = hasRealEntrada || isManualEntrada || hasRealSaida || isManualSaida || hasRealIntervaloSaida || isManualIntervaloSaida || hasRealIntervaloRetorno || isManualIntervaloRetorno || !!registro.entrada || !!registro.saida || !!registro.saida_intervalo || !!registro.retorno_intervalo

        // Preserve manual observation if needed (nunca preserva 'FALTA' se o dia agora tem marcação)
        if (shouldPreserve && registroExistente) {
          if (registroExistente.observacao.includes('MANUAL')) {
            registro.observacao = registroExistente.observacao
          } else if (registroExistente.observacao.includes('FALTA') && !temMarcacao) {
            registro.observacao = registroExistente.observacao
          }
        }

        // diaJaPassou serve a DUAS regras: falta automatica (dia vazio) e pendencia de revisao
        // (dia incompleto). Nenhuma das duas pode marcar o dia corrente — ver diaIncompleto.ts.
        const diaJaPassou = (folha.ano < currentYear) ||
          (folha.ano === currentYear && folha.mes < currentMonth) ||
          (folha.ano === currentYear && folha.mes === currentMonth && day < currentDay)

        // Dia vazio COM batida fisica registrada NAO e falta — e batida que nao virou passo.
        // Vem ANTES da falta automatica de proposito: as duas disputam o mesmo dia vazio, e
        // chamar de falta quem tem batida assinada e o pior erro que a folha pode cometer.
        // Nao force a batida num passo: a projecao ja recusou, e forcar seria fabricar horario.
        if (!registro.observacao && !temMarcacao) {
          const batidaNaoAproveitada = resolverBatidaNaoAproveitada({
            diaJaPassou,
            temMarcacao,
            temBatidaFisicaNoDia: diasComBatidaFisica.has(day)
          })
          if (batidaNaoAproveitada) {
            registro.observacao = batidaNaoAproveitada
          }
        }

        // Falta automatica: dia sem nenhuma observacao ainda e sem NENHUMA marcacao (real ou manual)
        if (!registro.observacao && !temMarcacao) {
          const faltaObservacao = resolverFaltaAutomatica({
            diaJaPassou,
            temMarcacao,
            fimDoMes: new Date(folha.ano, folha.mes, 0),
            hoje: new Date(currentYear, currentMonth - 1, currentDay),
            feriados: feriadosSet,
            prazoDiasUteis: prazoJustificativaDiasUteis
          })
          if (faltaObservacao) {
            registro.observacao = faltaObservacao
          }
        }

        // Pendencia de revisao: o dia TEM batida mas falta entrada ou saida — sem esses dois
        // nao da para saber quanto a pessoa trabalhou. Intervalo ausente NAO entra aqui
        // (recorte de 21/08/2026: eram 1.010 dias so de intervalo contra 151 destes, na SMS).
        // Nao conta falta, nao desconta hora: sinaliza. Ver src/utils/folha/diaIncompleto.ts.
        if (!registro.observacao) {
          const pendenciaRevisao = resolverPendenciaRevisao({
            diaJaPassou,
            temMarcacao,
            temEntrada: !!registro.entrada,
            temSaida: !!registro.saida
          })
          if (pendenciaRevisao) {
            registro.observacao = pendenciaRevisao
          }
        }

        if (isFaltaDefinitiva(registro.observacao)) {
          totalFaltas++
        }

        // 4. Overtime Calculation
        const scheduledEntrance = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
        const scheduledExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
        if (scheduledExit <= scheduledEntrance) {
          scheduledExit.setDate(scheduledExit.getDate() + 1)
        }

        let effectiveScheduledExit = scheduledExit
        if (pfInfo && pfInfo.inicio_liberacao_em && pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
          const releaseHour = Math.floor(pfInicioMin / 60)
          const releaseMin = pfInicioMin % 60
          effectiveScheduledExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(releaseHour).padStart(2, '0')}:${String(releaseMin).padStart(2, '0')}:00-03:00`)
        }

        let evalExit: Date | null = null

        if (hasRealSaida && realSaidaTime) {
          evalExit = realSaidaTime
        } else if (registro.saida) {
          const [sH, sM] = registro.saida.split(':').map(Number)
          evalExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:00-03:00`)
          if (sH < startHour || (sH === startHour && sM < startMin)) {
            evalExit.setDate(evalExit.getDate() + 1)
          }
        }

        // Sem ENTRADA registrada nao da para afirmar que houve sobrejornada: o que se sabe e a
        // hora em que a pessoa saiu, nao quanto ela trabalhou. Creditar extra a partir de uma
        // saida solitaria e o sistema afirmar o que nao sabe — e vira verba na folha.
        // recalculateOvertimeForDay (FolhaPontoEditor) e normalizarRegistrosFolha JA exigiam
        // entrada; a geracao era a unica que nao exigia, e por isso a mesma folha mudava de
        // valor so por alguem tocar na celula na tela. Medido em producao em 21/08/2026:
        // 31 dias, 12h16 de extra, em 27 folhas de agosto (junho e julho: zero).
        // TOLERANCIA DO ART. 58 §1º DA CLT — limiar, nao franquia (Sumula 366 do TST): dentro do
        // limite nao ha hora extra nenhuma; fora dele, computa-se a TOTALIDADE do excedente.
        // A antecipacao da entrada entra so na decisao, nunca no valor pago.
        const excedenteSaidaMin = minutosEntre(evalExit, effectiveScheduledExit)
        const antecipacaoEntradaMin = minutosEntre(scheduledEntrance, realEntradaTime)
        const absorvidoPelaTolerancia = toleranciaAbsorve({
          excedenteSaidaMin,
          antecipacaoEntradaMin,
          limites: limitesTolerancia,
        })

        if (evalExit && registro.entrada && evalExit > effectiveScheduledExit && !absorvidoPelaTolerancia) {
          let extra50Min = 0
          let extra100Min = 0

          const current = new Date(effectiveScheduledExit.getTime())
          const end = new Date(evalExit.getTime())

          while (current < end) {
            const localCurrent = new Date(current.getTime() - 3 * 60 * 60 * 1000)
            const curHour = localCurrent.getUTCHours()
            const curDayOfWeek = localCurrent.getUTCDay()
            const curDateStr = `${localCurrent.getUTCFullYear()}-${String(localCurrent.getUTCMonth() + 1).padStart(2, '0')}-${String(localCurrent.getUTCDate()).padStart(2, '0')}`
            const isSunday = curDayOfWeek === 0
            const isHoliday = feriadosSet.has(curDateStr)
            const isNight = curHour >= 22 || curHour < 5

            const isPFLiberado = pfInfo && (
              (pfInfo.inicio_liberacao_em && pfInicioMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) >= pfInicioMin) ||
              (pfInfo.fim_liberacao_em && pfFimMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) < pfFimMin)
            )

            if (isSunday || isHoliday || isNight || (isPFLiberado && pfInfo && pfInfo.gera_he_para_essenciais)) {
              extra100Min++
            } else {
              extra50Min++
            }

            current.setMinutes(current.getMinutes() + 1)
          }

          registro.hora_extra_minutos = extra50Min + extra100Min
          registro.hora_extra_tipo = extra100Min > 0 ? '100%' : '50%'
          totalExtra50 += extra50Min
          totalExtra100 += extra100Min
        } else {
          registro.hora_extra_minutos = 0
          registro.hora_extra_tipo = null
        }
      }

      // A dispensa autorizada e' acrescentada por ULTIMO, depois de feriado/afastamento/ponto
      // facultativo terem montado a observacao — ela convive com eles, nao os substitui.
      aplicarObservacaoAutorizacao(registro, autorizacaoDoDia(autorizacoesPonto, dateStr))

      registrosAtualizados.push(registro)
    }

    // Save updated folha
    const { error: saveError } = await supabase
      .from('folha_ponto')
      .update({
        registros: registrosAtualizados,
        escala_fingerprint: fingerprint,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        ultima_edicao_em: new Date().toISOString()
      })
      .eq('id', folhaId)

    if (saveError) throw saveError

    return { success: true }
  } catch (error: any) {
    console.error('Erro na sincronização de folha pelo servidor:', error)
    return { error: error.message }
  }
}

// Server Action: Generate or regenerate employee's timesheet from the portal
export async function gerarFolhaPontoServidor(mes: number, ano: number, forcarRascunho: boolean = false, escalaMensalId?: string) {
  try {
    const supabase = await createAdminClient()
    const portalServidorId = await servidorDaSessao()

    if (!portalServidorId) {
      return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
    }

    // A identidade VEM da sessao — ver o comentario em getFolhaPontoServidor.
    const servidorId = portalServidorId

    // Check if the sheet already exists and is closed (Revisada)
    let existingQuery = supabase
      .from('folha_ponto')
      .select('status, registros')

    if (escalaMensalId) {
      existingQuery = existingQuery.eq('escala_mensal_id', escalaMensalId)
    } else {
      existingQuery = existingQuery.eq('servidor_id', servidorId).eq('mes', mes).eq('ano', ano)
    }

    const { data: existingFolha } = await existingQuery.maybeSingle()

    const registrosExistentes = existingFolha?.registros as any[] || []

    if (await isCompetencyClosed(mes, ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    if (existingFolha && existingFolha.status === 'Revisada') {
      return { error: 'Esta folha de ponto já foi revisada e fechada pela coordenação e não pode ser regenerada.' }
    }

    // Fetch server lotação details
    const { data: servidor, error: servError } = await supabase
      .from('servidores')
      .select('id, unidade_id, setor_id, nome, matricula')
      .eq('id', servidorId)
      .single()

    if (servError || !servidor) throw new Error('Servidor não encontrado')

    // Fetch the active lotação escala_mensal
    let escala;
    if (escalaMensalId) {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
        .eq('id', escalaMensalId)
        .eq('servidor_id', servidorId)
        .eq('ativo', true)
        .single()
      
      if (escError) throw escError
      escala = esc
    } else {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
        .eq('servidor_id', servidorId)
        .eq('unidade_id', servidor.unidade_id)
        .eq('setor_id', servidor.setor_id)
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)
        .maybeSingle()
      
      if (escError) throw escError
      escala = esc
    }

    if (!escala) {
      return { error: 'Servidor não possui escala regular criada neste setor para o mês selecionado.' }
    }

    // Check status requirement
    if (escala.status === 'Em Andamento' && !forcarRascunho) {
      return { error: 'A escala está Em Andamento. A folha deve ser gerada como Rascunho.' }
    }

    // Prazo (dias uteis apos o FIM DO MES) para justificar um dia sem nenhuma marcacao antes
    // dele virar falta definitiva. Ver src/utils/folha/faltaAutomatica.ts.
    const { data: configPrazoJustificativa } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'justificativa_prazo_dias_uteis')
      .maybeSingle()
    const prazoJustificativaDiasUteis = configPrazoJustificativa?.valor
      ? parseInt(configPrazoJustificativa.valor as string, 10)
      : 3

    // Pre-assinalacao do intervalo so vale onde a unidade NAO exige que o servidor marque o
    // intervalo no ponto. Onde exige, o horario tem de vir de batida. Ver preAssinalacao.ts.
    const { data: unidadeIntervalo } = await supabase
      .from('unidades')
      .select('permite_marca_intervalo')
      .eq('id', escala.unidade_id)
      .maybeSingle()
    const podePreAssinalar = podePreAssinalarIntervalo(unidadeIntervalo?.permite_marca_intervalo)

    // Fetch timezone and setup current local time limit
    const { data: configTimezone } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'timezone')
      .maybeSingle()
    const timezone = (configTimezone?.valor as string) || 'America/Sao_Paulo'
    definirTimezone(timezone)

    // Tolerancia de variacao de horario (CLT Art. 58 §1º). Configuravel porque regra local pode
    // divergir; ausente, cai no default da CLT. Ver src/utils/folha/toleranciaExtra.ts.
    const { data: cfgTolerancia } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')
      .in('chave', ['tolerancia_extra_minutos_por_marcacao', 'tolerancia_extra_minutos_diaria'])
    const limitesTolerancia = lerLimitesTolerancia(cfgTolerancia)
    const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
    const currentYear = nowLocal.getFullYear()
    const currentMonth = nowLocal.getMonth() + 1
    const currentDay = nowLocal.getDate()
    const currentHour = nowLocal.getHours()
    const currentMinute = nowLocal.getMinutes()
    const currentTotalMin = currentHour * 60 + currentMinute

    // Fetch shifts from escala_diaria
    const { data: escalaDiaria, error: diError } = await supabase
      .from('escala_diaria')
      .select(`id, dia, categoria, dicionario_turnos_id, ${COLUNAS_PRESENCA_FOLHA}, presenca_confirmada, dicionario_turnos(codigo, slots, horas_computadas)`)
      .eq('escala_mensal_id', escala.id)

    if (diError) throw diError

    // Origem das marcacoes vem das flags presenca_*_manual — ver origemMarcacao.ts.

    const currentShifts = escalaDiaria || []
    const fingerprint = generateFingerprint(currentShifts.filter(d => d.categoria === 'Regular'))

    // Fetch holidays
    const startDate = `${ano}-${String(mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(ano, mes, 0).getDate()
    const endDate = `${ano}-${String(mes).padStart(2, '0')}-${daysInMonth}`
    
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    // Fetch pontos facultativos
    const { data: pontosFacultativos } = await supabase
      .from('pontos_facultativos')
      .select('id, data, descricao, inicio_liberacao_em, fim_liberacao_em, gera_he_para_essenciais')
      .gte('data', startDate)
      .lte('data', endDate)

    const { data: pfSetores } = await supabase
      .from('ponto_facultativo_setores')
      .select('*')

    const { data: sectorInfo } = await supabase
      .from('setores')
      .select('essencial')
      .eq('id', escala.setor_id)
      .maybeSingle()
    const isSectorEssencial = !!sectorInfo?.essencial

    // Fetch absences (afastamentos)
    const { data: afastamentos } = await supabase
      .from('servidores_eventos')
      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)

    // Autorizacoes do RH para validacao coletiva (27/08/2026). A folha precisa IMPRIMIR o
    // oficio: sem ele o dia aparece como horario manual qualquer, e o documento e' justamente
    // o que responde a fiscalizacao. Nao preenche horario nenhum.
    const { data: autorizacoesPonto } = await supabase
      .from('autorizacoes_ponto_coletivo')
      .select('passos, documento, vigencia_inicio, vigencia_fim')
      .eq('servidor_id', servidorId)
      .is('revogado_em', null)
      .lte('vigencia_inicio', endDate)
      .gte('vigencia_fim', startDate)

    // Fetch temporary journeys overlapping this month
    const { data: tempJourneys } = await supabase
      .from('servidores_jornadas_temporarias')
      .select('*, jornadas(nome, horas_totais, intervalo_minutos)')
      .eq('servidor_id', servidorId)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)

    // Parse Jornada
    const globalJornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const globalJornada = parseJornadaNome(globalJornadaDetails?.nome || '')
    const globalIntervaloMinutos = globalJornadaDetails?.intervalo_minutos ?? 60
    const globalHorasNormaisDiarias = globalJornadaDetails?.horas_totais ?? 8

    const registros: any[] = []
    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    const weekDaysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    // Um dia sem passo nenhum pode ser FALTA ou pode ser batida que a alocacao nao aproveitou.
    // escala_diaria sozinha nao distingue os dois — ela nao sabe que a marcacao existe. Sem
    // isto, quem tem batida com NSR de AFD assinado recebe falta (3 casos medidos em 21/08/2026).
    const diasComBatidaFisica = await carregarDiasComBatidaFisica(supabase, servidorId, mes, ano)

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(ano, mes - 1, day)
      const dayOfWeekStr = weekDaysShort[dateObj.getDay()]
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // Resolve dynamic journey for this day
      const tempJourney = tempJourneys?.find(tj => dateStr >= tj.data_inicio && dateStr <= tj.data_fim)
      const activeJornada = tempJourney ? tempJourney.jornadas : globalJornadaDetails
      const { startHour, startMin, endHour, endMin } = activeJornada === globalJornadaDetails ? globalJornada : parseJornadaNome(activeJornada?.nome || '')
      const intervaloMinutos = activeJornada === globalJornadaDetails ? globalIntervaloMinutos : (activeJornada?.intervalo_minutos ?? 60)
      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : (activeJornada?.horas_totais ?? 8)

      const afastamentosDia = afastamentosDoDia(afastamentos, dateStr)
      const feriadoInfo = feriados?.find(f => f.data === dateStr)
      const shift = escalaDiaria?.find(ed => ed.dia === day && ed.categoria === 'Regular')
      const extraShift = escalaDiaria?.find(ed => ed.dia === day && ed.categoria === 'Extra')
      const extraHoursScheduled = getExtraHoursFromShift(extraShift)
      const extraMinutesScheduled = Math.round(extraHoursScheduled * 60)
      const afastamentosAnulantes = afastamentosDia.filter(af => isShiftOverlappingAfastamento(af, shift))

      // Check manual edits in existing record to preserve them
      const registroExistente = registrosExistentes.find((r: any) => r.dia === day)
      const shouldPreserve = true

      // Helper function to check if we should generate time for a scheduled marker
      const shouldGenerate = (scheduledMin: number) => {
        if (ano > currentYear) return false
        if (ano < currentYear) return true
        if (mes > currentMonth) return false
        if (mes < currentMonth) return true
        if (day > currentDay) return false
        if (day < currentDay) return true
        return currentTotalMin >= (scheduledMin % 1440)
      }

      // Check if point facultativo applies
      const pf = pontosFacultativos?.find(p => p.data === dateStr)
      let pfInfo = null
      if (pf) {
        const rule = pfSetores?.find(r => r.ponto_facultativo_id === pf.id && r.setor_id === escala.setor_id)
        if (rule) {
          if (rule.tipo_regra === 'incluido') pfInfo = pf
        } else if (!isSectorEssencial) {
          pfInfo = pf
        }
      }

      let registro: any = {
        dia: day,
        dia_semana: dayOfWeekStr,
        turno_codigo: getTurnoCodigo(shift?.dicionario_turnos),
        entrada: '',
        saida_intervalo: '',
        retorno_intervalo: '',
        saida: '',
        hora_extra_minutos: 0,
        hora_extra_tipo: null,
        observacao: '',
        origem_entrada: null,
        origem_saida_intervalo: null,
        origem_retorno_intervalo: null,
        origem_saida: null,
        feriado: !!feriadoInfo,
        ponto_facultativo: !!pfInfo,
        afastamento: afastamentosAnulantes.length > 0 ? descreverAfastamentos(afastamentosAnulantes) : null
      }

      if (registro.afastamento) {
        registro.observacao = registro.afastamento.toUpperCase()
      } else if (registro.feriado) {
        registro.observacao = `FERIADO: ${feriadoInfo?.descricao}`.toUpperCase()
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (registro.ponto_facultativo && pfInfo && !pfInfo.inicio_liberacao_em && !pfInfo.fim_liberacao_em) {
        // Full day Ponto Facultativo
        registro.observacao = `PONTO FACULTATIVO: ${pfInfo.descricao}`.toUpperCase()
        if (shift) {
          totalHorasNormais += horasNormaisDiarias
        }
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)} | ${registro.observacao}`.toUpperCase()
        }
      } else if (!shift) {
        if (dateObj.getDay() === 0) {
          registro.observacao = 'DOMINGO'
        } else if (dateObj.getDay() === 6) {
          registro.observacao = 'SÁBADO'
        } else {
          registro.observacao = 'FOLGA'
        }
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)} | ${registro.observacao}`.toUpperCase()
        }
      } else {
        totalHorasNormais += horasNormaisDiarias
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO A PARTIR DAS ${pfInfo.inicio_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          } else if (pfInfo.fim_liberacao_em) {
            registro.observacao = `PONTO FACULTATIVO ATÉ AS ${pfInfo.fim_liberacao_em.substring(0, 5)}: ${pfInfo.descricao}`.toUpperCase()
          }
        }
        if (afastamentosDia.length > 0) {
          registro.observacao = `AFASTAMENTO PARCIAL: ${descreverAfastamentos(afastamentosDia)}${registro.observacao ? ' | ' + registro.observacao : ''}`.toUpperCase()
        }

        // Consolida os turnos do dia e resolve, para cada passo, o horário vencedor junto da
        // origem daquele horário específico.
        const dayShifts = turnosDaFolha<any>(escalaDiaria?.filter((d: any) => d.dia === day) || [])

        const marcEntrada = resolverMarcacaoDoDia(dayShifts, 'entrada')
        const marcIntervaloSaida = resolverMarcacaoDoDia(dayShifts, 'intervalo_saida')
        const marcIntervaloRetorno = resolverMarcacaoDoDia(dayShifts, 'intervalo_retorno')
        const marcSaida = resolverMarcacaoDoDia(dayShifts, 'saida')

        const isManualEntrada = marcEntrada.manual
        const isManualIntervaloSaida = marcIntervaloSaida.manual
        const isManualIntervaloRetorno = marcIntervaloRetorno.manual
        const isManualSaida = marcSaida.manual

        const realEntradaTime = marcEntrada.horario
        const realIntervaloSaidaTime = marcIntervaloSaida.horario
        const realIntervaloRetornoTime = marcIntervaloRetorno.horario
        const realSaidaTime = marcSaida.horario

        const hasRealEntrada = realEntradaTime !== null && !isManualEntrada
        const hasRealIntervaloSaida = realIntervaloSaidaTime !== null && !isManualIntervaloSaida
        const hasRealIntervaloRetorno = realIntervaloRetornoTime !== null && !isManualIntervaloRetorno
        const hasRealSaida = realSaidaTime !== null && !isManualSaida

        const officialEntradaMin = startHour * 60 + startMin
        const baseOfficialSaidaMin = endHour * 60 + endMin
        let officialSaidaMin = baseOfficialSaidaMin + extraMinutesScheduled
        let totalBrutoMin = officialSaidaMin - officialEntradaMin
        if (totalBrutoMin < 0) totalBrutoMin += 24 * 60

        const halfJornadaMin = Math.floor(totalBrutoMin / 2)
        const officialSaidaIntervaloMin = (officialEntradaMin + halfJornadaMin) % (24 * 60)
        const officialRetornoIntervaloMin = (officialSaidaIntervaloMin + intervaloMinutos) % (24 * 60)

        const seedBase = `${servidorId}-${mes}-${ano}-${day}`

        // Parse ponto facultativo release/limit minutes
        let pfInicioMin: number | null = null
        let pfFimMin: number | null = null
        if (pfInfo) {
          if (pfInfo.inicio_liberacao_em) {
            const parts = pfInfo.inicio_liberacao_em.split(':')
            pfInicioMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
          if (pfInfo.fim_liberacao_em) {
            const parts = pfInfo.fim_liberacao_em.split(':')
            pfFimMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
          }
        }

        // 1. Entrance Time
        if (shouldPreserve && preservarCampo(registroExistente, 'entrada')) {
          registro.entrada = registroExistente.entrada
          registro.origem_entrada = registroExistente.origem_entrada || 'manual'
        } else if (hasRealEntrada && realEntradaTime) {
          registro.entrada = formatarHora(realEntradaTime)
          registro.origem_entrada = 'real'
        } else if (isManualEntrada && realEntradaTime) {
          registro.entrada = formatarHora(realEntradaTime)
          registro.origem_entrada = 'manual'
        }

        // 2. Exit Time
        if (shouldPreserve && preservarCampo(registroExistente, 'saida')) {
          registro.saida = registroExistente.saida
          registro.origem_saida = registroExistente.origem_saida || 'manual'
        } else if (hasRealSaida && realSaidaTime) {
          registro.saida = formatarHora(realSaidaTime)
          registro.origem_saida = 'real'
        } else if (isManualSaida && realSaidaTime) {
          registro.saida = formatarHora(realSaidaTime)
          registro.origem_saida = 'manual'
        }

        // 3. Lunch Interval
        if (intervaloMinutos > 0) {
          let targetSaidaMin = officialSaidaMin
          if (pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
            targetSaidaMin = pfInicioMin
          }
          
          if (targetSaidaMin > officialSaidaIntervaloMin) {
            if (shouldPreserve && preservarCampo(registroExistente, 'saida_intervalo')) {
              registro.saida_intervalo = registroExistente.saida_intervalo
              registro.origem_saida_intervalo = registroExistente.origem_saida_intervalo || 'manual'
            } else if (hasRealIntervaloSaida && realIntervaloSaidaTime) {
              registro.saida_intervalo = formatarHora(realIntervaloSaidaTime)
              registro.origem_saida_intervalo = 'real'
            } else if (isManualIntervaloSaida && realIntervaloSaidaTime) {
              registro.saida_intervalo = formatarHora(realIntervaloSaidaTime)
              registro.origem_saida_intervalo = 'manual'
            } else if (podePreAssinalar && shouldGenerate(officialSaidaIntervaloMin)) {
              registro.saida_intervalo = formatMinutesToTimeStr(officialSaidaIntervaloMin)
              registro.origem_saida_intervalo = 'pre_assinalado'
            }

            if (shouldPreserve && preservarCampo(registroExistente, 'retorno_intervalo')) {
              registro.retorno_intervalo = registroExistente.retorno_intervalo
              registro.origem_retorno_intervalo = registroExistente.origem_retorno_intervalo || 'manual'
            } else if (hasRealIntervaloRetorno && realIntervaloRetornoTime) {
              registro.retorno_intervalo = formatarHora(realIntervaloRetornoTime)
              registro.origem_retorno_intervalo = 'real'
            } else if (isManualIntervaloRetorno && realIntervaloRetornoTime) {
              registro.retorno_intervalo = formatarHora(realIntervaloRetornoTime)
              registro.origem_retorno_intervalo = 'manual'
            } else if (podePreAssinalar && shouldGenerate(officialRetornoIntervaloMin)) {
              registro.retorno_intervalo = formatMinutesToTimeStr(officialRetornoIntervaloMin)
              registro.origem_retorno_intervalo = 'pre_assinalado'
            }
          }
        }

        const temMarcacao = hasRealEntrada || isManualEntrada || hasRealSaida || isManualSaida || hasRealIntervaloSaida || isManualIntervaloSaida || hasRealIntervaloRetorno || isManualIntervaloRetorno || !!registro.entrada || !!registro.saida || !!registro.saida_intervalo || !!registro.retorno_intervalo

        // Preserve manual observation if needed (nunca preserva 'FALTA' se o dia agora tem marcação)
        if (shouldPreserve && registroExistente) {
          if (registroExistente.observacao.includes('MANUAL')) {
            registro.observacao = registroExistente.observacao
          } else if (registroExistente.observacao.includes('FALTA') && !temMarcacao) {
            registro.observacao = registroExistente.observacao
          }
        }

        // diaJaPassou serve a DUAS regras: falta automatica (dia vazio) e pendencia de revisao
        // (dia incompleto). Nenhuma das duas pode marcar o dia corrente — ver diaIncompleto.ts.
        const diaJaPassou = (ano < currentYear) ||
          (ano === currentYear && mes < currentMonth) ||
          (ano === currentYear && mes === currentMonth && day < currentDay)

        // Dia vazio COM batida fisica registrada NAO e falta — e batida que nao virou passo.
        // Vem ANTES da falta automatica de proposito: as duas disputam o mesmo dia vazio, e
        // chamar de falta quem tem batida assinada e o pior erro que a folha pode cometer.
        // Nao force a batida num passo: a projecao ja recusou, e forcar seria fabricar horario.
        if (!registro.observacao && !temMarcacao) {
          const batidaNaoAproveitada = resolverBatidaNaoAproveitada({
            diaJaPassou,
            temMarcacao,
            temBatidaFisicaNoDia: diasComBatidaFisica.has(day)
          })
          if (batidaNaoAproveitada) {
            registro.observacao = batidaNaoAproveitada
          }
        }

        // Falta automatica: dia sem nenhuma observacao ainda e sem NENHUMA marcacao (real ou manual)
        if (!registro.observacao && !temMarcacao) {
          const faltaObservacao = resolverFaltaAutomatica({
            diaJaPassou,
            temMarcacao,
            fimDoMes: new Date(ano, mes, 0),
            hoje: new Date(currentYear, currentMonth - 1, currentDay),
            feriados: feriadosSet,
            prazoDiasUteis: prazoJustificativaDiasUteis
          })
          if (faltaObservacao) {
            registro.observacao = faltaObservacao
          }
        }

        // Pendencia de revisao: o dia TEM batida mas falta entrada ou saida — sem esses dois
        // nao da para saber quanto a pessoa trabalhou. Intervalo ausente NAO entra aqui
        // (recorte de 21/08/2026: eram 1.010 dias so de intervalo contra 151 destes, na SMS).
        // Nao conta falta, nao desconta hora: sinaliza. Ver src/utils/folha/diaIncompleto.ts.
        if (!registro.observacao) {
          const pendenciaRevisao = resolverPendenciaRevisao({
            diaJaPassou,
            temMarcacao,
            temEntrada: !!registro.entrada,
            temSaida: !!registro.saida
          })
          if (pendenciaRevisao) {
            registro.observacao = pendenciaRevisao
          }
        }

        if (isFaltaDefinitiva(registro.observacao)) {
          totalFaltas++
        }

        // 4. Overtime Calculation
        const scheduledEntrance = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
        const scheduledExit = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
        if (scheduledExit <= scheduledEntrance) {
          scheduledExit.setDate(scheduledExit.getDate() + 1)
        }

        let effectiveScheduledExit = scheduledExit
        if (pfInfo && pfInfo.inicio_liberacao_em && pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
          const releaseHour = Math.floor(pfInicioMin / 60)
          const releaseMin = pfInicioMin % 60
          effectiveScheduledExit = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(releaseHour).padStart(2, '0')}:${String(releaseMin).padStart(2, '0')}:00-03:00`)
        }

        let evalExit: Date | null = null

        if (hasRealSaida && realSaidaTime) {
          evalExit = realSaidaTime
        } else if (registro.saida) {
          const [sH, sM] = registro.saida.split(':').map(Number)
          evalExit = new Date(`${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:00-03:00`)
          if (sH < startHour || (sH === startHour && sM < startMin)) {
            evalExit.setDate(evalExit.getDate() + 1)
          }
        }

        // Sem ENTRADA registrada nao da para afirmar que houve sobrejornada: o que se sabe e a
        // hora em que a pessoa saiu, nao quanto ela trabalhou. Creditar extra a partir de uma
        // saida solitaria e o sistema afirmar o que nao sabe — e vira verba na folha.
        // recalculateOvertimeForDay (FolhaPontoEditor) e normalizarRegistrosFolha JA exigiam
        // entrada; a geracao era a unica que nao exigia, e por isso a mesma folha mudava de
        // valor so por alguem tocar na celula na tela. Medido em producao em 21/08/2026:
        // 31 dias, 12h16 de extra, em 27 folhas de agosto (junho e julho: zero).
        // TOLERANCIA DO ART. 58 §1º DA CLT — limiar, nao franquia (Sumula 366 do TST): dentro do
        // limite nao ha hora extra nenhuma; fora dele, computa-se a TOTALIDADE do excedente.
        // A antecipacao da entrada entra so na decisao, nunca no valor pago.
        const excedenteSaidaMin = minutosEntre(evalExit, effectiveScheduledExit)
        const antecipacaoEntradaMin = minutosEntre(scheduledEntrance, realEntradaTime)
        const absorvidoPelaTolerancia = toleranciaAbsorve({
          excedenteSaidaMin,
          antecipacaoEntradaMin,
          limites: limitesTolerancia,
        })

        if (evalExit && registro.entrada && evalExit > effectiveScheduledExit && !absorvidoPelaTolerancia) {
          let extra50Min = 0
          let extra100Min = 0

          const current = new Date(effectiveScheduledExit.getTime())
          const end = new Date(evalExit.getTime())

          while (current < end) {
            const localCurrent = new Date(current.getTime() - 3 * 60 * 60 * 1000)
            const curHour = localCurrent.getUTCHours()
            const curDayOfWeek = localCurrent.getUTCDay()
            const curDateStr = `${localCurrent.getUTCFullYear()}-${String(localCurrent.getUTCMonth() + 1).padStart(2, '0')}-${String(localCurrent.getUTCDate()).padStart(2, '0')}`
            const isSunday = curDayOfWeek === 0
            const isHoliday = feriadosSet.has(curDateStr)
            const isNight = curHour >= 22 || curHour < 5

            const isPFLiberado = pfInfo && (
              (pfInfo.inicio_liberacao_em && pfInicioMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) >= pfInicioMin) ||
              (pfInfo.fim_liberacao_em && pfFimMin !== null && (localCurrent.getUTCHours() * 60 + localCurrent.getUTCMinutes()) < pfFimMin)
            )

            if (isSunday || isHoliday || isNight || (isPFLiberado && pfInfo && pfInfo.gera_he_para_essenciais)) {
              extra100Min++
            } else {
              extra50Min++
            }

            current.setMinutes(current.getMinutes() + 1)
          }

          registro.hora_extra_minutos = extra50Min + extra100Min
          registro.hora_extra_tipo = extra100Min > 0 ? '100%' : '50%'
          totalExtra50 += extra50Min
          totalExtra100 += extra100Min
        } else {
          registro.hora_extra_minutos = 0
          registro.hora_extra_tipo = null
        }
      }

      // A dispensa autorizada e' acrescentada por ULTIMO, depois de feriado/afastamento/ponto
      // facultativo terem montado a observacao — ela convive com eles, nao os substitui.
      aplicarObservacaoAutorizacao(registro, autorizacaoDoDia(autorizacoesPonto, dateStr))

      registros.push(registro)
    }

    const { error: upsertError } = await supabase
      .from('folha_ponto')
      .upsert({
        escala_mensal_id: escala.id,
        servidor_id: servidorId,
        mes,
        ano,
        status: forcarRascunho ? 'Rascunho' : 'Gerada',
        registros,
        escala_fingerprint: fingerprint,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        ultima_edicao_em: new Date().toISOString()
      }, {
        onConflict: 'escala_mensal_id'
      })

    if (upsertError) throw upsertError

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao gerar folha pelo servidor:', error)
    return { error: error.message }
  }
}

export async function checkFolhaPontoHabilitada() {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'folha_ponto_habilitada')
    .single()
  return data?.valor === true || data?.valor?.toString() === 'true'
}

// =========================================================================
// FÉRIAS E LICENÇA PRÊMIO — Portal do Servidor
// =========================================================================

interface OpcaoDatas {
  p1_inicio: string
  p1_fim: string
  p2_inicio?: string
  p2_fim?: string
}

interface SugestaoFracionamento {
  p1_inicio: string
  p1_fim: string
  p2_inicio: string
  p2_fim: string
}

const MODALIDADE_DIAS: Record<string, { p1: number; p2?: number }> = {
  integral_30: { p1: 30 },
  fracionado_15_15: { p1: 15, p2: 15 },
  abono_10_20: { p1: 20 },  // gozo is 20 days, 10 days are pecuniary
  integral_90: { p1: 90 },
  fracionado_45_45: { p1: 45, p2: 45 },
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days - 1) // -1 because start date counts as day 1
  return d.toISOString().split('T')[0]
}

function diffDays(d1: string, d2: string): number {
  const a = new Date(d1 + 'T00:00:00')
  const b = new Date(d2 + 'T00:00:00')
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

export async function getSolicitacoesServidor() {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('*')
    .eq('servidor_id', servidorId)
    .order('created_at', { ascending: false })

  if (error) {
    return { error: 'Erro ao buscar solicitações: ' + error.message }
  }

  return { solicitacoes: data || [] }
}

export async function getSolicitacaoHistorico(solicitacaoId: string) {
  const supabase = await createAdminClient()

  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  // ⚠️ Esta e' a UNICA acao de ferias cuja consulta nao filtrava por servidor — as outras ja'
  // faziam `.eq('servidor_id', ...)` e ganharam a verificacao de posse de graca ao passar a
  // derivar a identidade da sessao. Aqui a posse precisa ser conferida explicitamente: o
  // historico traz despacho, parecer e datas do pedido de outra pessoa.
  const { data: dono } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('id')
    .eq('id', solicitacaoId)
    .eq('servidor_id', servidorId)
    .maybeSingle()

  if (!dono) {
    return { error: 'Solicitação não encontrada.' }
  }

  const { data, error } = await supabase
    .from('solicitacoes_ferias_licencas_historico')
    .select('*')
    .eq('solicitacao_id', solicitacaoId)
    .order('created_at', { ascending: true })

  if (error) {
    return { error: 'Erro ao buscar histórico: ' + error.message }
  }

  return { historico: data || [] }
}

export async function verificarElegibilidadeServidorFerias() {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  const supabase = await createAdminClient()

  const { data: servidor, error: srvErr } = await supabase
    .from('servidores')
    .select('id, nome, cpf, rg_numero, cargo, matricula')
    .eq('id', servidorId)
    .single()

  if (srvErr || !servidor) {
    return { error: 'Servidor não encontrado.' }
  }

  const camposFaltantes: string[] = []
  if (!servidor.cpf || !servidor.cpf.trim()) camposFaltantes.push('CPF')
  if (!servidor.rg_numero || !servidor.rg_numero.trim()) camposFaltantes.push('RG')
  if (!servidor.cargo || !servidor.cargo.trim()) camposFaltantes.push('Cargo')
  if (!servidor.matricula || !servidor.matricula.trim()) camposFaltantes.push('Matrícula')

  if (camposFaltantes.length > 0) {
    return {
      apto: false,
      camposFaltantes,
      mensagem: `Dados cadastrais incompletos. Para solicitar férias/licença prêmio, é necessário ter preenchido: ${camposFaltantes.join(', ')}. Procure o setor de RH para atualizar seu cadastro.`
    }
  }

  return { apto: true }
}

export async function criarSolicitacaoPrevisao(params: {
  tipoBeneficio: 'ferias' | 'licenca_premio'
  exercicio: string
  modalidade: string
  opcoesDatas: OpcaoDatas[]
  sugestaoFracionamento?: SugestaoFracionamento | null
  observacao?: string
  adicionalTerco?: boolean
}) {
  const supabase = await createAdminClient()

  // ⚠️ `servidorId` saiu de `params`: esta acao ESCREVE (abre pedido de ferias/licenca) e ate
  // 30/08/2026 aceitava o servidor do cliente sem consultar o cookie — dava para abrir pedido em
  // nome de qualquer pessoa da rede municipal.
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  const {
    tipoBeneficio, exercicio, modalidade,
    opcoesDatas, sugestaoFracionamento, observacao, adicionalTerco
  } = params

  // 1. Validate eligibility
  const elegivel = await verificarElegibilidadeServidorFerias()
  if (elegivel.error) return { error: elegivel.error }
  if (!elegivel.apto) {
    return { error: elegivel.mensagem || 'Dados cadastrais incompletos. Procure o setor de RH.' }
  }

  // 2. Fetch servidor details for request creation
  const { data: servidor, error: srvErr } = await supabase
    .from('servidores')
    .select('id, nome, unidade_id, setor_id')
    .eq('id', servidorId)
    .single()

  if (srvErr || !servidor) {
    return { error: 'Servidor não encontrado.' }
  }

  // 3. Validate modalidade matches tipo_beneficio
  const feriasModes = ['integral_30', 'fracionado_15_15', 'abono_10_20']
  const lpModes = ['integral_90', 'fracionado_45_45']
  if (tipoBeneficio === 'ferias' && !feriasModes.includes(modalidade)) {
    return { error: 'Modalidade inválida para férias.' }
  }
  if (tipoBeneficio === 'licenca_premio' && !lpModes.includes(modalidade)) {
    return { error: 'Modalidade inválida para licença prêmio.' }
  }

  // 4. Validate options count (1 to 3)
  if (!opcoesDatas || opcoesDatas.length < 1 || opcoesDatas.length > 3) {
    return { error: 'É necessário informar entre 1 e 3 opções de datas.' }
  }

  // 5. If integral_30, must have sugestao_fracionamento
  if (modalidade === 'integral_30' && !sugestaoFracionamento) {
    return { error: 'Ao optar por férias integrais (30 dias), é obrigatório informar uma sugestão de fracionamento 15/15 como alternativa.' }
  }

  // 6. Get minimum advance days from config
  const { data: configData } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'antecedencia_minima_ferias_dias')
    .single()
  const minDias = configData?.valor ? Number(configData.valor) : 60

  // 7. Validate minimum advance for all options
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  for (let i = 0; i < opcoesDatas.length; i++) {
    const opcao = opcoesDatas[i]
    const inicio = new Date(opcao.p1_inicio + 'T00:00:00')
    const diffFromToday = diffDays(hoje.toISOString().split('T')[0], opcao.p1_inicio)

    if (diffFromToday < minDias) {
      return {
        error: `A Opção ${i + 1} não respeita a antecedência mínima de ${minDias} dias. A data de início deve ser a partir de ${addDays(hoje.toISOString().split('T')[0], minDias + 1)}.`
      }
    }

    // Validate second period if applicable
    if (opcao.p2_inicio) {
      const diffP2 = diffDays(hoje.toISOString().split('T')[0], opcao.p2_inicio)
      if (diffP2 < minDias) {
        return {
          error: `O 2º período da Opção ${i + 1} não respeita a antecedência mínima de ${minDias} dias.`
        }
      }
    }
  }

  // 8. Check for duplicate active request for same exercicio & tipo_beneficio
  const { data: existente, error: dupErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('id, status')
    .eq('servidor_id', servidorId)
    .eq('tipo_beneficio', tipoBeneficio)
    .eq('exercicio', exercicio.trim())
    .in('status', ['aguardando_validacao', 'deferido', 'contraproposta'])
    .limit(1)

  if (dupErr) {
    console.error('Erro ao verificar solicitação duplicada:', dupErr)
    return { error: 'Erro ao verificar solicitações prévias do servidor.' }
  }

  if (existente && existente.length > 0) {
    const statusAtual = existente[0].status
    const statusLabel = statusAtual === 'deferido' ? 'deferida' : statusAtual === 'contraproposta' ? 'em contraproposta' : 'em análise'
    const tipoLabel = tipoBeneficio === 'ferias' ? 'Férias' : 'Licença Prêmio'
    return {
      error: `Já existe uma solicitação de ${tipoLabel} (${statusLabel}) para o exercício ${exercicio.trim()}. Não é permitido registrar nova solicitação para o mesmo exercício.`
    }
  }

  // 9. Check for overlapping events in servidores_eventos
  for (let i = 0; i < opcoesDatas.length; i++) {
    const opcao = opcoesDatas[i]
    const { data: conflitos } = await supabase
      .from('servidores_eventos')
      .select('id, data_inicio, data_fim, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .lte('data_inicio', opcao.p1_fim)
      .gte('data_fim', opcao.p1_inicio)
      .limit(1)

    if (conflitos && conflitos.length > 0) {
      const ev = conflitos[0] as any
      const tipoNome = ev.tipos_eventos?.nome || 'Afastamento'
      return {
        error: `A Opção ${i + 1} (${opcao.p1_inicio} a ${opcao.p1_fim}) conflita com ${tipoNome} já registrado (${ev.data_inicio} a ${ev.data_fim}).`
      }
    }
  }

  // 10. Insert the request
  const { data: inserted, error: insertErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .insert({
      servidor_id: servidorId,
      unidade_id: servidor.unidade_id,
      setor_id: servidor.setor_id,
      tipo_beneficio: tipoBeneficio,
      exercicio,
      modalidade,
      sugestao_fracionamento: sugestaoFracionamento || null,
      opcoes_datas: opcoesDatas,
      observacao_servidor: observacao || null,
      adicional_terco: adicionalTerco !== false, // default true
      abono_pecuniario: modalidade === 'abono_10_20',
      status: 'aguardando_validacao',
    })
    .select('id')
    .single()

  if (insertErr) {
    console.error('Erro ao criar solicitação:', insertErr)
    return { error: 'Erro ao criar solicitação. Tente novamente.' }
  }

  // 11. Insert audit log
  if (inserted) {
    await supabase
      .from('solicitacoes_ferias_licencas_historico')
      .insert({
        solicitacao_id: inserted.id,
        acao: 'criada',
        status_anterior: null,
        status_novo: 'aguardando_validacao',
        executado_por: null, // Portal doesn't have auth user
        detalhes: { servidor_nome: servidor.nome, tipo_beneficio: tipoBeneficio, exercicio, modalidade },
      })
  }

  return { success: true, id: inserted?.id }
}

export async function cancelarSolicitacaoServidor(solicitacaoId: string) {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  const supabase = await createAdminClient()

  // Only allow cancellation of pending or contraproposta requests
  const { data: sol, error: fetchErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('id, status, servidor_id')
    .eq('id', solicitacaoId)
    .eq('servidor_id', servidorId)
    .single()

  if (fetchErr || !sol) {
    return { error: 'Solicitação não encontrada.' }
  }

  if (!['aguardando_validacao', 'contraproposta'].includes(sol.status)) {
    return { error: 'Somente solicitações em aguardando validação ou contraproposta podem ser canceladas.' }
  }

  const { error: updateErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .update({
      status: 'cancelado',
      cancelado_em: new Date().toISOString(),
      motivo_cancelamento: 'Cancelado pelo servidor.',
    })
    .eq('id', solicitacaoId)

  if (updateErr) {
    return { error: 'Erro ao cancelar: ' + updateErr.message }
  }

  await supabase
    .from('solicitacoes_ferias_licencas_historico')
    .insert({
      solicitacao_id: solicitacaoId,
      acao: 'cancelada',
      status_anterior: sol.status,
      status_novo: 'cancelado',
      executado_por: null,
      detalhes: { motivo: 'Cancelado pelo servidor via portal' },
    })

  return { success: true }
}

export async function aceitarContraproposta(solicitacaoId: string) {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  const supabase = await createAdminClient()

  const { data: sol, error: fetchErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('*')
    .eq('id', solicitacaoId)
    .eq('servidor_id', servidorId)
    .single()

  if (fetchErr || !sol) {
    return { error: 'Solicitação não encontrada.' }
  }

  if (sol.status !== 'contraproposta') {
    return { error: 'Esta solicitação não possui contraproposta pendente.' }
  }

  // Move the contraproposta dates into the opcoes_datas as the selected option
  const contrapropostaDatas = sol.contraproposta_datas as OpcaoDatas
  const opcoes = (sol.opcoes_datas as OpcaoDatas[]) || []
  opcoes.push(contrapropostaDatas)

  const { error: updateErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .update({
      status: 'aguardando_validacao',
      opcoes_datas: opcoes,
      observacao_servidor: (sol.observacao_servidor || '') + '\n[Contraproposta aceita pelo servidor]',
    })
    .eq('id', solicitacaoId)

  if (updateErr) {
    return { error: 'Erro ao aceitar contraproposta: ' + updateErr.message }
  }

  await supabase
    .from('solicitacoes_ferias_licencas_historico')
    .insert({
      solicitacao_id: solicitacaoId,
      acao: 'aceita_contraproposta',
      status_anterior: 'contraproposta',
      status_novo: 'aguardando_validacao',
      executado_por: null,
      detalhes: { contraproposta_aceita: contrapropostaDatas },
    })

  return { success: true }
}

export async function rejeitarContraproposta(solicitacaoId: string) {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  const supabase = await createAdminClient()

  const { data: sol, error: fetchErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('id, status, servidor_id')
    .eq('id', solicitacaoId)
    .eq('servidor_id', servidorId)
    .single()

  if (fetchErr || !sol) {
    return { error: 'Solicitação não encontrada.' }
  }

  if (sol.status !== 'contraproposta') {
    return { error: 'Esta solicitação não possui contraproposta pendente.' }
  }

  const { error: updateErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .update({
      status: 'cancelado',
      cancelado_em: new Date().toISOString(),
      motivo_cancelamento: 'Servidor rejeitou a contraproposta do coordenador.',
    })
    .eq('id', solicitacaoId)

  if (updateErr) {
    return { error: 'Erro ao rejeitar contraproposta: ' + updateErr.message }
  }

  await supabase
    .from('solicitacoes_ferias_licencas_historico')
    .insert({
      solicitacao_id: solicitacaoId,
      acao: 'rejeitada_contraproposta',
      status_anterior: 'contraproposta',
      status_novo: 'cancelado',
      executado_por: null,
      detalhes: { motivo: 'Servidor rejeitou a contraproposta' },
    })

  return { success: true }
}

export async function getDadosRequerimento(solicitacaoId: string) {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  const supabase = await createAdminClient()

  const { data: sol, error: solErr } = await supabase
    .from('solicitacoes_ferias_licencas')
    .select('*')
    .eq('id', solicitacaoId)
    .eq('servidor_id', servidorId)
    .eq('status', 'deferido')
    .single()

  if (solErr || !sol) {
    return { error: 'Solicitação deferida não encontrada.' }
  }

  const { data: servidor, error: srvErr } = await supabase
    .from('servidores')
    .select(`
      id, nome, matricula, cpf, rg_numero, rg_orgao_emissor,
      cargo, vinculo, email, telefone,
      endereco_logradouro, endereco_numero, bairro, cep, municipio_residencia,
      unidade_id, setor_id,
      unidades(nome),
      setores(dicionario_setores(nome))
    `)
    .eq('id', servidorId)
    .single()

  if (srvErr || !servidor) {
    return { error: 'Dados do servidor não encontrados.' }
  }

  // Get institutional header config
  const { data: configCab } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'instituicao_cabecalho_url')
    .single()

  return {
    solicitacao: sol,
    servidor,
    logoUrl: configCab?.valor || null,
  }
}

export async function checkJustificativasHabilitada() {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'justificativa_servidor_visualizar')
      .single()
    if (!data || data.valor === null || data.valor === undefined) return true
    const valStr = String(data.valor).replace(/"/g, '').trim().toLowerCase()
    return valStr === 'true'
  } catch (err) {
    return true
  }
}

export async function getJustificativasServidor(mes: number, ano: number) {
  const servidorId = await servidorDaSessao()
  if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

  try {
    const supabase = await createAdminClient()

    // 1. Fetch escala_mensal records for this server and month/year
    const { data: escalasMensais } = await supabase
      .from('escala_mensal')
      .select('id, unidade_id, setor_id')
      .eq('servidor_id', servidorId)
      .eq('mes', mes)
      .eq('ano', ano)

    if (!escalasMensais || escalasMensais.length === 0) {
      return { items: [] }
    }

    const escalaMensalIds = escalasMensais.map(em => em.id)

    // 2. Fetch escala_diaria records linked to these monthly scales
    const { data: eventos, error } = await supabase
      .from('escala_diaria')
      .select(`
        id, dia, categoria, escala_mensal_id, dicionario_turnos_id,
        dicionario_turnos(codigo)
      `)
      .in('escala_mensal_id', escalaMensalIds)
      .order('dia', { ascending: true })

    if (error) return { error: error.message }

    const extraEvents = eventos?.filter(e => {
      const cat = String(e.categoria || '').toLowerCase()
      return cat.includes('extra') || cat.includes('plant') || cat.includes('sobreaviso')
    }) || []

    const { data: justificativas } = await supabase
      .from('justificativas_eventos')
      .select('*')
      .eq('servidor_id', servidorId)
      .eq('mes', mes)
      .eq('ano', ano)

    const justMap = new Map()
    justificativas?.forEach(j => {
      justMap.set(`${j.dia}-${String(j.categoria).toLowerCase()}`, j)
    })

    const items = extraEvents.map(e => {
      const catStr = String(e.categoria)
      const just = justMap.get(`${e.dia}-${catStr.toLowerCase()}`)
      return {
        escala_diaria_id: e.id,
        escala_mensal_id: e.escala_mensal_id,
        dia: e.dia,
        mes: mes,
        ano: ano,
        categoria: catStr,
        turno_codigo: (e.dicionario_turnos as any)?.codigo || '—',
        justificativa_id: just?.id || null,
        texto_justificativa: just?.texto_justificativa || null,
        status: just?.status || 'pendente',
        origem: just?.origem || null,
        motivo_rejeicao: just?.motivo_rejeicao || null
      }
    })

    return { items }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function sugerirJustificativaServidor(dados: {
  escalaDiariaId: string
  escalaMensalId: string
  dia: number
  mes: number
  ano: number
  categoria: string
  texto: string
}) {
  try {
    const supabase = await createAdminClient()

    // ⚠️ Identidade da SESSAO. `servidorId` e `servidorNome` vinham do cliente: o primeiro
    // deixava sugerir justificativa em nome de outro servidor; o segundo era gravado direto em
    // `registrado_por_nome`, ou seja, o autor do registro era texto livre do navegador.
    const servidorId = await servidorDaSessao()
    if (!servidorId) return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }

    const { data: servidorSessao } = await supabase
      .from('servidores')
      .select('nome')
      .eq('id', servidorId)
      .single()

    // A escala tem que ser DO servidor da sessao. Sem isto, `escalaMensalId`/`escalaDiariaId`
    // continuariam sendo ids arbitrarios vindos do cliente.
    const { data: mensal } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id')
      .eq('id', dados.escalaMensalId)
      .eq('servidor_id', servidorId)
      .single()

    if (!mensal) {
      return { error: 'Escala não encontrada para este servidor.' }
    }

    const payload = {
      escala_diaria_id: dados.escalaDiariaId,
      servidor_id: servidorId,
      escala_mensal_id: dados.escalaMensalId,
      unidade_id: mensal?.unidade_id || null,
      setor_id: mensal?.setor_id || null,
      dia: dados.dia,
      mes: dados.mes,
      ano: dados.ano,
      categoria: dados.categoria,
      texto_justificativa: dados.texto,
      origem: 'servidor',
      status: 'sugestao_pendente',
      registrado_por_nome: servidorSessao?.nome || null,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('justificativas_eventos')
      .upsert(payload, { onConflict: 'servidor_id,dia,mes,ano,categoria' })
      .select()

    if (error) return { error: error.message }
    return { success: true, data }
  } catch (err: any) {
    return { error: err.message }
  }
}


// =========================================================================
// AVISO DE PONTO POR WHATSAPP — preferência do próprio servidor
// =========================================================================
// O aviso é OPT-IN: o default no banco é não enviar, e quem quiser receber ativa aqui.
//
// Não é preciosismo. O sinal dominante para banimento de número no WhatsApp é taxa de bloqueio
// e denúncia — quem recebe mensagem que não pediu bloqueia. E o número em uso é o MESMO que
// serve o acionamento de sobreaviso, então um banimento derrubaria o fluxo de urgência da rede.
// Sob a LGPD, consentimento livre e documentado do titular também é a posição mais forte.

/**
 * Estado atual da preferência, para montar a tela.
 */
export async function getPreferenciaAvisoPonto() {
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from('servidores')
    .select('id, telefone, email, aviso_ponto_status, aviso_ponto_modo, aviso_ponto_canal, aviso_ponto_definido_em, aviso_ponto_confirmado_em, aviso_ponto_expira_em, unidade_id, setor_id')
    .eq('id', portalServidorId)
    .single()

  if (error || !data) {
    return { error: 'Não foi possível carregar sua preferência.' }
  }

  // Sem telefone utilizável e exclusivo, ativar geraria opt-in que nunca entrega nada.
  const { data: telefoneOk } = await supabase.rpc('fn_telefone_aviso_ponto', {
    p_servidor_id: portalServidorId,
  })

  // O envio precisa estar habilitado para a lotação do servidor, senão ele ativa, não recebe e
  // conclui que o sistema está quebrado.
  //
  // Vai pela RPC, e não por leitura de coluna: a habilitação é resolvida pelo SETOR com herança
  // da unidade, e reimplementar essa precedência aqui a colocaria em dois lugares — foi assim que
  // o módulo de marcações acabou com três regras de intervalo divergentes.
  const { data: habilitado } = await supabase.rpc('fn_aviso_ponto_habilitado', {
    p_unidade_id: data.unidade_id,
    p_setor_id: data.setor_id,
  })
  const unidadeHabilitada = habilitado === true

  return {
    status: data.aviso_ponto_status || 'inativo',
    // ⚠️ O padrão caiu para `resumo_semanal` em 30/08/2026 (migration 20260830140000). Este
    // fallback só é usado quando a coluna vem nula, mas deixá-lo em `resumo_diario` faria a tela
    // marcar o rádio errado — dizendo que a pessoa escolheu algo que ela não escolheu.
    modo: data.aviso_ponto_modo || 'resumo_semanal',
    // ⚠️ `email` e `canal` PRECISAM sair daqui. O `.select()` já os buscava, mas eles não eram
    // devolvidos — e a tela, sem `estado.email`, exibia "Você ainda não tem e-mail cadastrado"
    // para quem tem, deixando a opção recomendada desabilitada. Ao acrescentar campo à consulta,
    // confira que ele chega ao componente: buscar não é entregar.
    email: data.email,
    canal: data.aviso_ponto_canal || 'email',
    definidoEm: data.aviso_ponto_definido_em,
    confirmadoEm: data.aviso_ponto_confirmado_em,
    expiraEm: data.aviso_ponto_expira_em,
    telefone: data.telefone,
    telefoneUtilizavel: !!telefoneOk,
    unidadeHabilitada,
    // Consentimento e efetividade são coisas diferentes e podem divergir — depois de uma
    // transferência para lotação não habilitada, `status` continua 'ativo' (a pessoa não retirou
    // nada) mas nada é entregue. A tela mostra os dois, em vez de um "Ativado" que não se cumpre.
    efetivo: (data.aviso_ponto_status === 'ativo') && unidadeHabilitada,
  }
}

/**
 * Liga ou desliga o aviso, registrando o termo que o servidor leu.
 *
 * ATIVAR não ativa: é o **passo 1** do double opt-in. Grava o aceite do Portal e dispara uma
 * mensagem no WhatsApp pedindo confirmação. O aviso só passa a valer quando a resposta chega em
 * `/api/avisos-ponto/webhook`. Enquanto isso o status fica `pendente_confirmacao` e nenhuma
 * mensagem de registro é enviada.
 *
 * O `servidor_id` vem SEMPRE do cookie de sessão do portal, nunca de parâmetro — a action é
 * chamável direto e o portal autentica apenas por PIN. É a mesma defesa de
 * `salvarFolhaPontoServidor`.
 *
 * O texto do termo também não vem do cliente: vem de `@/utils/avisoPonto`, o mesmo módulo que a
 * tela usa para exibir. Aceitar o texto do cliente permitiria gravar "ciência" de qualquer coisa.
 */
export async function definirPreferenciaAvisoPonto(ativar: boolean) {
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  const supabase = await createAdminClient()

  const { data, error } = ativar
    ? await supabase.rpc('fn_solicitar_aviso_ponto', {
        p_servidor_id: portalServidorId,
        p_termo_texto: TERMO_ATIVACAO,
        p_termo_versao: TERMO_VERSAO,
        p_prazo_horas: 48,
      })
    : await supabase.rpc('fn_desativar_aviso_ponto', {
        p_servidor_id: portalServidorId,
        p_termo_texto: TERMO_DESATIVACAO,
        p_termo_versao: TERMO_VERSAO,
      })

  if (error) {
    return { error: error.message }
  }

  const res = Array.isArray(data) ? data[0] : data
  if (!res?.success) {
    return { error: res?.message || 'Não foi possível salvar sua preferência.' }
  }

  revalidatePath('/consultar-escala')
  return { success: true, status: res.status as string, message: res.message as string }
}

/**
 * Frequência do aviso, escolhida pelo próprio servidor.
 *
 * Separada de `definirPreferenciaAvisoPonto` de propósito: mudar de "todas as batidas" para
 * "resumo diário" é ajuste de preferência, não novo consentimento — não faz sentido pedir o termo
 * e uma nova confirmação por WhatsApp a cada troca. O consentimento já foi dado e continua valendo.
 */
/**
 * Troca o canal do aviso de ponto (e-mail ou WhatsApp).
 *
 * ⚠️ **E-mail é o padrão desde 30/08/2026**, e a razão não é preferência estética: o número de
 * WhatsApp foi restringido pela Meta **duas vezes** — e a segunda com apenas 25 servidores ativos
 * e ~440 mensagens no total, o que descarta volume como causa e aponta a API não oficial.
 *
 * O aviso de ponto é 99% do tráfego e é **informativo** (o próprio termo diz que não é
 * comprovante). O acionamento de sobreaviso é 1% e é **emergência**. Como os dois saem pelo mesmo
 * número, cada bloqueio derruba os dois — tirar o informativo do WhatsApp é o que protege o
 * urgente. Ver docs/planos/2026-08-30-estrategia-de-canais-e-bloqueios-do-whatsapp.md.
 *
 * A recusa por falta de endereço vive na RPC, não aqui: aceitar em silêncio faria o servidor
 * achar que trocou enquanto o fallback manda pelo outro canal, sem nada na tela explicando.
 */
export async function definirCanalAvisoPonto(canal: string) {
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  const supabase = await createAdminClient()

  const { data, error } = await supabase.rpc('fn_definir_canal_aviso_ponto', {
    p_servidor_id: portalServidorId,
    p_canal: canal,
  })

  if (error) return { error: error.message }

  const res = Array.isArray(data) ? data[0] : data
  if (!res?.success) return { error: res?.message || 'Não foi possível salvar o canal.' }

  revalidatePath('/consultar-escala')
  return { success: true, canal: res.canal as string, message: res.message as string }
}

export async function definirModoAvisoPonto(modo: string) {
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  const supabase = await createAdminClient()

  const { data, error } = await supabase.rpc('fn_definir_modo_aviso_ponto', {
    p_servidor_id: portalServidorId,
    p_modo: modo,
  })

  if (error) return { error: error.message }

  const res = Array.isArray(data) ? data[0] : data
  if (!res?.success) return { error: res?.message || 'Não foi possível salvar a frequência.' }

  revalidatePath('/consultar-escala')
  return { success: true, modo: res.modo as string, message: res.message as string }
}

/**
 * Troca do PIN pelo PRÓPRIO servidor.
 *
 * ⚠️ **`servidorId` NÃO entra por parâmetro** — vem da sessão assinada (armadilha 32). Foi
 * exatamente essa a correção de 30/08/2026: derivar em vez de comparar, para que uma ação nova
 * não possa esquecer de conferir.
 *
 * ⚠️ **Exigir o PIN atual não é redundância com a sessão.** O cookie do Portal dura horas e a
 * tela é aberta em computador compartilhado de unidade: sessão aberta prova que alguém entrou,
 * não que quem está na frente agora seja a mesma pessoa.
 *
 * A decisão inteira (bloqueio de tentativas, conferência do atual, regra do novo, gravação e log)
 * acontece dentro de `fn_trocar_pin_portal`, numa transação só. Aqui só se traduz o resultado.
 */
export async function trocarPinPortal(pinAtual: string, pinNovo: string) {
  const portalServidorId = await servidorDaSessao()

  if (!portalServidorId) {
    return { error: 'Sessão expirada. Por favor, valide seu PIN novamente.' }
  }

  // Espelho local da regra, só para não gastar uma ida ao banco no caso óbvio. Quem decide
  // continua sendo `fn_validar_pin_novo`, chamada de dentro da RPC e do trigger de hash.
  const local = conferirPinNovo(pinNovo)
  if (local) return { error: local }

  const h = await headers()
  const supabase = await createAdminClient()

  const { data, error } = await supabase.rpc('fn_trocar_pin_portal', {
    p_servidor_id: portalServidorId,
    p_pin_atual: pinAtual,
    p_pin_novo: pinNovo,
    p_ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    p_user_agent: h.get('user-agent') || null,
  })

  if (error) {
    console.error('Erro ao trocar PIN do portal:', error.message)
    return { error: 'Não foi possível trocar o PIN agora. Tente novamente.' }
  }

  const r = data as {
    resultado: string
    tentativas_restantes?: number
    minutos_restantes?: number
    motivo?: string
    minimo?: number
    maximo?: number
  }

  switch (r?.resultado) {
    case 'ok':
      return { success: true }

    case 'nao_encontrado':
      return { error: 'Cadastro não encontrado. Fale com a coordenação da sua unidade.' }

    case 'sem_pin':
      return { error: 'Você ainda não possui um PIN cadastrado. Solicite ao seu coordenador.' }

    case 'bloqueado':
      return { error: `Muitas tentativas incorretas. Tente novamente em ${r.minutos_restantes} minutos.` }

    case 'pin_atual_invalido': {
      const restantes = r.tentativas_restantes ?? 0
      if (restantes > 0) {
        return { error: `PIN atual incorreto. Você tem mais ${restantes} tentativa(s) antes do bloqueio.` }
      }
      return { error: 'Muitas tentativas incorretas. Sua conta está bloqueada por 15 minutos.' }
    }

    case 'pin_novo_recusado':
      return { error: mensagemRecusaPin(r.motivo, { minimo: r.minimo, maximo: r.maximo }) }

    case 'pin_novo_igual_ao_atual':
      return { error: 'O novo PIN é igual ao atual. Escolha um diferente.' }

    default:
      return { error: 'Não foi possível trocar o PIN agora. Tente novamente.' }
  }
}
