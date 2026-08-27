'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { lerLimitesTolerancia, minutosEntre, toleranciaAbsorve } from '@/utils/folha/toleranciaExtra'
import { definirTimezone, formatarHora } from '@/utils/horario'
import { revalidatePath } from 'next/cache'
import { registrarLog, calcularAlteracoes, calcularAlteracoesFolha } from '@/utils/auditoria'
import { hasSectorAccess, UserProfile, applyAccessFilters, isAccessUnrestricted } from '@/utils/permissions'
import { autoCloseExpiredScalesAndTimesheets, isCompetencyClosed } from '@/utils/autoClose'
import { resolverMarcacaoDoDia, turnosDaFolha, COLUNAS_PRESENCA_FOLHA, type PassoPresenca } from '@/utils/folha/origemMarcacao'
import { podePreAssinalarIntervalo } from '@/utils/folha/preAssinalacao'
import { resolverFaltaAutomatica, isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'
import { resolverPendenciaRevisao, resolverBatidaNaoAproveitada, carregarDiasComBatidaFisica } from '@/utils/folha/diaIncompleto'
import { normalizarRegistrosFolha } from '@/utils/folha/normalizarHorarios'
import { sequenciarDia, PASSOS_FOLHA } from '@/utils/folha/sequenciaDia'
import { preservarCampo } from '@/utils/folha/preservacao'
import { montarCargaPorJornada, horasNormaisDoDia } from '@/utils/folha/cargaDiaria'
import { autorizacaoDoDia, aplicarObservacaoAutorizacao } from '@/utils/folha/autorizacaoPonto'
import { afastamentosDoDia, descreverAfastamentos, isShiftOverlappingAfastamento } from '@/utils/folha/afastamentosDia'

// Helper: Get user profile with unit/sector permissions
async function getUserProfile(supabase: any): Promise<UserProfile> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), setores_no_escopo')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Perfil de usuário não encontrado')

  return {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.setores_no_escopo || []
  }
}

// Helper: Parse Jornada name string (e.g. "08H ÀS 18H", "07H30 AS 16H30", "19:00 - 07:00")
function parseJornadaNome(nome: string): { startHour: number; startMin: number; endHour: number; endMin: number } {
  const defaultVal = { startHour: 8, startMin: 0, endHour: 17, endMin: 0 }
  if (!nome) return defaultVal

  // Matches pattern: (hours)[h:](minutes)? (às|as|to|-|a) (hours)[h:](minutes)?
  const match = nome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
  if (!match) return defaultVal

  const startHour = parseInt(match[1], 10)
  const startMin = match[2] ? parseInt(match[2], 10) : 0
  const endHour = parseInt(match[3], 10)
  const endMin = match[4] ? parseInt(match[4], 10) : 0

  return { startHour, startMin, endHour, endMin }
}

// Helper: Simple deterministic random offset generator (-14 to +14 minutes, never 0)
function getDeterministicOffset(seedStr: string, maxOffset: number = 15): number {
  let hash = 0
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash)
  }
  const absOffset = (Math.abs(hash) % (maxOffset - 1)) + 1 // 1 to maxOffset-1 (e.g. 1 to 14)
  const sign = hash % 2 === 0 ? 1 : -1
  return sign * absOffset
}

// Helper: Format minutes since midnight back to "HH:MM"
function formatMinutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Helper: Generate fingerprint of current scale
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

// Helper: Safely extract code from turn dictionary (which could be an array or object in typings)
function getTurnoCodigo(dicionarioTurnos: any): string | null {
  if (!dicionarioTurnos) return null
  if (Array.isArray(dicionarioTurnos)) {
    return dicionarioTurnos[0]?.codigo || null
  }
  return dicionarioTurnos.codigo || null
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

// List servers for a sector/month with their scale and folha status (unit and sector are optional)
// ONLY includes servers with active scales for the selected competency
export async function getServidoresFolhaPonto(mes: number, ano: number, unidadeId?: string, setorId?: string) {
  try {
    await autoCloseExpiredScalesAndTimesheets()
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // If unit and sector are specifically provided, we check permission for it
    if (unidadeId && setorId) {
      if (!hasSectorAccess(userProfile, setorId, unidadeId)) {
        return { error: 'Acesso negado a este setor/unidade.' }
      }
    }

    // Perfis irrestritos (super_admin/rh, ou acesso_todas_unidades + acesso_todos_setores)
    // sao os unicos capazes de buscar TODAS as escalas da cidade de uma vez sem nenhum filtro
    // — ja causou estouro de URI em producao com 206 escalas so em um mes. A tela exige
    // Unidade antes de chamar esta action para esses perfis; esta e a defesa em profundidade
    // caso a action seja chamada direto sem passar pela tela (armadilha 12 do CLAUDE.md).
    if (isAccessUnrestricted(userProfile) && !unidadeId) {
      return { error: 'Selecione uma unidade para carregar as folhas de ponto.' }
    }

    // 1. Fetch active scales in this sector/unit/month/year to find all servers who have scales for this period
    let queryEscalas = supabase
      .from('escala_mensal')
      .select('id, status, servidor_id, unidade_id, setor_id, status, jornada_id, jornadas(nome), servidores(id, nome, matricula, cargo)')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (unidadeId) {
      queryEscalas = queryEscalas.eq('unidade_id', unidadeId)
    }
    if (setorId) {
      queryEscalas = queryEscalas.eq('setor_id', setorId)
    }

    queryEscalas = applyAccessFilters(queryEscalas, userProfile)

    const { data: escalasMes, error: escError } = await queryEscalas
    if (escError) throw escError

    if (!escalasMes || escalasMes.length === 0) {
      return { servidores: [] }
    }

    // 2. Fetch existing sheets for this month/year. Filtra por mes/ano (colunas proprias de
    // folha_ponto) em vez de .in('escala_mensal_id', scaleIds): sem unidade/setor selecionado,
    // escalasMes pode ter centenas de linhas (206 so em agosto/2026), e uma URI com centenas de
    // UUIDs no .in() estoura o limite do gateway Supabase (erro "URI too long request_id: ...").
    const { data: folhas, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('id, status, servidor_id, escala_mensal_id, total_horas_normais, total_horas_extras_50, total_horas_extras_100, total_faltas, cargo')
      .eq('mes', mes)
      .eq('ano', ano)

    if (folhaError) throw folhaError

    // 3. Map together
    const result = escalasMes
      .map(escala => {
        const servidor = escala.servidores as any
        if (!servidor) return null

        const folha = folhas?.find(f => f.escala_mensal_id === escala.id)

        return {
          servidor_id: servidor.id,
          nome: servidor.nome,
          matricula: servidor.matricula,
          cargo: folha?.cargo || servidor.cargo,
          escala_mensal_id: escala.id,
          escala_status: escala.status,
          folha_id: folha?.id || null,
          folha_status: folha?.status || 'Não Gerada',
          jornada_nome: (escala.jornadas as any)?.nome || 'Não Vinculada',
          total_horas_normais: folha?.total_horas_normais || 0,
          total_horas_extras_50: folha?.total_horas_extras_50 || 0,
          total_horas_extras_100: folha?.total_horas_extras_100 || 0,
          total_faltas: folha?.total_faltas || 0,
        }
      })
      .filter(Boolean) as any[]

    // Sort alphabetically by server name
    result.sort((a, b) => a.nome.localeCompare(b.nome))

    return { servidores: result }
  } catch (error: any) {
    console.error('Erro em getServidoresFolhaPonto:', error)
    return { error: error.message }
  }
}

// Limite de candidatos da busca global. Nao e cosmetico: o resultado vira um `.in()` de UUIDs
// na consulta de escalas, e foi exatamente uma URI com centenas de UUIDs que estourou o gateway
// do Supabase em getServidoresFolhaPonto (ver comentario dela acima).
const LIMITE_BUSCA_SERVIDORES = 60

/**
 * Busca global de servidor na competencia — por nome, CPF ou matricula.
 *
 * Existe porque a listagem normal (getServidoresFolhaPonto) so carrega depois de escolher uma
 * Unidade, e quem procura uma pessoa nem sempre sabe onde ela esta escalada.
 *
 * O escopo NAO e afrouxado: o que sai daqui e sempre `escala_mensal` filtrada por
 * applyAccessFilters + RLS. Coordenador acha so as escalas que ja gerencia, RH da Unidade so as
 * unidades dele, e apenas super_admin/rh (isAccessUnrestricted) alcancam a rede inteira.
 */
export async function buscarServidoresFolhaPonto(termo: string, mes: number, ano: number) {
  try {
    // Sanitiza o termo antes de montar o `.or()`: virgula e parenteses sao separadores da
    // sintaxe de filtro do PostgREST, e um termo com esses caracteres nao daria "sem
    // resultado", daria uma query com outro significado.
    const termoLimpo = (termo || '').replace(/[,()*%\\"']/g, ' ').trim()
    if (termoLimpo.length < 3) {
      return { servidores: [], semEscala: [], termoCurto: true }
    }

    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // 1. Candidatos do cadastro, por nome/matricula/CPF.
    //
    // Cliente ADMIN de proposito: a policy de `servidores` escopa por LOTACAO, e "Servidor
    // Externo" (v1.2.4) e justamente quem esta escalado numa unidade e lotado em outra — ele
    // sumiria da busca de quem gerencia a escala dele. Nada daqui vai para a tela por si so:
    // so entra no resultado quem sobreviver ao filtro de escopo do passo 2, que e por ESCALA
    // (o mesmo criterio do guard de fn_blocos_previstos_dia).
    const admin = await createAdminClient()
    const cpfLimpo = termoLimpo.replace(/\D/g, '')

    let queryServidores = admin
      .from('servidores')
      .select('id, nome, matricula, cargo, cpf')

    if (cpfLimpo.length >= 3) {
      queryServidores = queryServidores.or(
        `nome.ilike.%${termoLimpo}%,matricula.ilike.%${termoLimpo}%,cpf.ilike.%${cpfLimpo}%`
      )
    } else {
      queryServidores = queryServidores.or(
        `nome.ilike.%${termoLimpo}%,matricula.ilike.%${termoLimpo}%`
      )
    }

    const { data: candidatos, error: candError } = await queryServidores
      .order('nome')
      .limit(LIMITE_BUSCA_SERVIDORES + 1)

    if (candError) throw candError
    if (!candidatos || candidatos.length === 0) {
      return { servidores: [], semEscala: [], nenhumCadastro: true }
    }

    const truncado = candidatos.length > LIMITE_BUSCA_SERVIDORES
    const listaCandidatos = candidatos.slice(0, LIMITE_BUSCA_SERVIDORES)
    const idsCandidatos = listaCandidatos.map((s: any) => s.id)

    // 2. Escalas da competencia — aqui mora o escopo real (applyAccessFilters + RLS).
    let queryEscalas = supabase
      .from('escala_mensal')
      .select('id, status, servidor_id, unidade_id, setor_id, jornada_id, jornadas(nome), servidores(id, nome, matricula, cargo)')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)
      .in('servidor_id', idsCandidatos)

    queryEscalas = applyAccessFilters(queryEscalas, userProfile)

    const { data: escalasMes, error: escError } = await queryEscalas
    if (escError) throw escError

    // 3. Quem o usuario enxerga por lotacao, para poder dizer "existe no cadastro, mas nao tem
    //    escala nesta competencia" sem revelar a existencia de servidor fora do escopo dele.
    let queryVisiveis = supabase
      .from('servidores')
      .select('id, nome, matricula, cargo')
      .in('id', idsCandidatos)
    queryVisiveis = applyAccessFilters(queryVisiveis, userProfile)

    const { data: visiveis } = await queryVisiveis

    const idsComEscala = new Set((escalasMes || []).map((e: any) => e.servidor_id))
    const semEscala = (visiveis || [])
      .filter((s: any) => !idsComEscala.has(s.id))
      .map((s: any) => ({ id: s.id, nome: s.nome, matricula: s.matricula, cargo: s.cargo }))

    if (!escalasMes || escalasMes.length === 0) {
      return { servidores: [], semEscala, truncado }
    }

    // 4. Folhas das escalas encontradas. Aqui o `.in()` por escala_mensal_id e seguro (no
    //    maximo LIMITE_BUSCA_SERVIDORES ids) e evita varrer a competencia inteira.
    const idsEscalas = escalasMes.map((e: any) => e.id)
    const { data: folhas, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('id, status, servidor_id, escala_mensal_id, total_horas_normais, total_horas_extras_50, total_horas_extras_100, total_faltas, cargo')
      .in('escala_mensal_id', idsEscalas)

    if (folhaError) throw folhaError

    // 5. Rotulos de unidade/setor: o resultado atravessa unidades, entao a linha precisa dizer
    //    onde a pessoa esta escalada. Vem do cliente admin porque quem tem acesso so por setor
    //    nao le `unidades` pela RLS — e sao apenas nomes de linhas ja aprovadas pelo passo 2.
    const idsUnidades = Array.from(new Set(escalasMes.map((e: any) => e.unidade_id).filter(Boolean)))
    const idsSetores = Array.from(new Set(escalasMes.map((e: any) => e.setor_id).filter(Boolean)))

    const [resUnidades, resSetores] = await Promise.all([
      idsUnidades.length
        ? admin.from('unidades').select('id, nome').in('id', idsUnidades)
        : Promise.resolve({ data: [] as any[] }),
      idsSetores.length
        ? admin.from('setores').select('id, dicionario_setores(nome)').in('id', idsSetores)
        : Promise.resolve({ data: [] as any[] })
    ])

    const nomeUnidade = new Map<string, string>()
    for (const u of (resUnidades.data || []) as any[]) nomeUnidade.set(u.id, u.nome)

    // `setores` nao tem coluna `nome` — o rotulo mora em `dicionario_setores`.
    const nomeSetor = new Map<string, string>()
    for (const s of (resSetores.data || []) as any[]) {
      const dict = Array.isArray(s.dicionario_setores) ? s.dicionario_setores[0] : s.dicionario_setores
      nomeSetor.set(s.id, dict?.nome || 'SETOR SEM NOME')
    }

    const cpfPorServidor = new Map<string, string | null>()
    for (const s of listaCandidatos as any[]) cpfPorServidor.set(s.id, s.cpf || null)

    // Mesma forma de linha de getServidoresFolhaPonto — a tabela da tela e a mesma.
    const result = escalasMes
      .map((escala: any) => {
        const servidor = escala.servidores as any
        if (!servidor) return null

        const folha = folhas?.find((f: any) => f.escala_mensal_id === escala.id)

        return {
          servidor_id: servidor.id,
          nome: servidor.nome,
          matricula: servidor.matricula,
          cpf: cpfPorServidor.get(servidor.id) || null,
          cargo: folha?.cargo || servidor.cargo,
          escala_mensal_id: escala.id,
          escala_status: escala.status,
          folha_id: folha?.id || null,
          folha_status: folha?.status || 'Não Gerada',
          jornada_nome: (escala.jornadas as any)?.nome || 'Não Vinculada',
          total_horas_normais: folha?.total_horas_normais || 0,
          total_horas_extras_50: folha?.total_horas_extras_50 || 0,
          total_horas_extras_100: folha?.total_horas_extras_100 || 0,
          total_faltas: folha?.total_faltas || 0,
          unidade_nome: nomeUnidade.get(escala.unidade_id) || null,
          setor_nome: nomeSetor.get(escala.setor_id) || null,
        }
      })
      .filter(Boolean) as any[]

    result.sort((a, b) => a.nome.localeCompare(b.nome))

    return { servidores: result, semEscala, truncado }
  } catch (error: any) {
    console.error('Erro em buscarServidoresFolhaPonto:', error)
    return { error: error.message }
  }
}

// Generate (or regenerate) a timesheet for a server
// Core logic to generate or regenerate a timesheet for a server (bypasses permission checks for admin/cron use)
/**
 * Limites da tolerancia do Art. 58 §1º da CLT, lidos da configuracao global.
 * Ausentes, caem no default da propria lei (ver src/utils/folha/toleranciaExtra.ts).
 */
async function obterLimitesTolerancia(supabase: any) {
  const { data } = await supabase
    .from('configuracoes_globais')
    .select('chave, valor')
    .in('chave', ['tolerancia_extra_minutos_por_marcacao', 'tolerancia_extra_minutos_diaria'])
  return lerLimitesTolerancia(data)
}

export async function executeGerarFolhaPonto(
  supabase: any,
  servidorId: string,
  mes: number,
  ano: number,
  targetStatus: 'Rascunho' | 'Gerada' | 'Revisada',
  escalaMensalId?: string,
  geradoPorId?: string | null
) {
  try {
    let escala: any = null

    if (escalaMensalId) {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('id', escalaMensalId)
        .single()
      if (escError) throw escError
      escala = esc
    } else {
      // Find matching scale for this server, month, year
      const { data: serverInfo } = await supabase
        .from('servidores')
        .select('unidade_id, setor_id')
        .eq('id', servidorId)
        .single()

      const query = supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('servidor_id', servidorId)
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)

      if (serverInfo?.unidade_id && serverInfo?.setor_id) {
        const { data: match } = await query
          .eq('unidade_id', serverInfo.unidade_id)
          .eq('setor_id', serverInfo.setor_id)
          .maybeSingle()
        if (match) {
          escala = match
        }
      }

      if (!escala) {
        const { data: list } = await supabase
          .from('escala_mensal')
          .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
          .eq('servidor_id', servidorId)
          .eq('mes', mes)
          .eq('ano', ano)
          .eq('ativo', true)
          .limit(1)
        if (list && list.length > 0) {
          escala = list[0]
        }
      }
    }

    if (!escala) {
      return { error: 'Servidor não possui escala regular criada neste setor para o mês selecionado.' }
    }

    const resolvedMes = escala.mes
    const resolvedAno = escala.ano

    if (await isCompetencyClosed(resolvedMes, resolvedAno)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Fetch server details
    const { data: servidor, error: servError } = await supabase
      .from('servidores')
      .select('id, nome, matricula, cargo')
      .eq('id', servidorId)
      .single()

    if (servError || !servidor) throw new Error('Servidor não encontrado')

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

    // Fetch all shifts from escala_diaria (including Extra and Plantão) for the specific scale of this folha
    const { data: escalaDiaria, error: diError } = await supabase
      .from('escala_diaria')
      .select(`id, dia, categoria, dicionario_turnos_id, ${COLUNAS_PRESENCA_FOLHA}, intervalo_nao_usufruido, presenca_confirmada, dicionario_turnos(codigo, slots)`)
      .eq('escala_mensal_id', escala.id)

    if (diError) throw diError

    // A origem de cada marcacao vem das flags presenca_*_manual da propria linha de
    // escala_diaria (ver src/utils/folha/origemMarcacao.ts). A consulta a logs_sobreaviso que
    // existia aqui foi removida: ela nunca mais recebe validacao manual de Regular/Plantao/
    // Extra desde 20260807020000, e por isso reportava validacao manual como batida real.

    // Fetch holidays
    const startDate = `${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-01`
    const daysInMonth = new Date(resolvedAno, resolvedMes, 0).getDate()
    const endDate = `${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${daysInMonth}`
    
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet: Set<string> = new Set(feriados?.map((f: any) => f.data) || [])

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

    // Fetch existing folha if exists to preserve manual edits and cargo
    const { data: existingFolha } = await supabase
      .from('folha_ponto')
      .select('registros, cargo')
      .eq('escala_mensal_id', escala.id)
      .maybeSingle()

    const registrosExistentes = existingFolha?.registros as any[] || []

    // Fetch timezone and setup current local time limit
    const { data: configTimezone } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'timezone')
      .maybeSingle()
    const timezone = (configTimezone?.valor as string) || 'America/Sao_Paulo'
    definirTimezone(timezone)

    const limitesTolerancia = await obterLimitesTolerancia(supabase)
    const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
    const currentYear = nowLocal.getFullYear()
    const currentMonth = nowLocal.getMonth() + 1
    const currentDay = nowLocal.getDate()
    const currentHour = nowLocal.getHours()
    const currentMinute = nowLocal.getMinutes()
    const currentTotalMin = currentHour * 60 + currentMinute

    const registros: any[] = []
    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    const weekDaysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    // Um dia sem passo nenhum pode ser FALTA ou pode ser batida que a alocacao nao aproveitou.
    // escala_diaria sozinha nao distingue os dois — ela nao sabe que a marcacao existe. Sem
    // isto, quem tem batida com NSR de AFD assinado recebe falta (3 casos medidos em 21/08/2026).
    const diasComBatidaFisica = await carregarDiasComBatidaFisica(supabase, servidorId, resolvedMes, resolvedAno)

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(resolvedAno, resolvedMes - 1, day)
      const dayOfWeekStr = weekDaysShort[dateObj.getDay()]
      const dateStr = `${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      // Resolve dynamic journey for this day
      const tempJourney = tempJourneys?.find((tj: any) => dateStr >= tj.data_inicio && dateStr <= tj.data_fim)
      const activeJornada = tempJourney ? tempJourney.jornadas : globalJornadaDetails
      const { startHour, startMin, endHour, endMin } = activeJornada === globalJornadaDetails ? globalJornada : parseJornadaNome(activeJornada?.nome || '')
      const intervaloMinutos = activeJornada === globalJornadaDetails ? globalIntervaloMinutos : (activeJornada?.intervalo_minutos ?? 60)
      const horasNormaisDiarias = activeJornada === globalJornadaDetails ? globalHorasNormaisDiarias : (activeJornada?.horas_totais ?? 8)

      // Check afastamento
      const afastamentosDia = afastamentosDoDia(afastamentos, dateStr)
      const shift = escalaDiaria?.find((ed: any) => ed.dia === day && ed.categoria === 'Regular')
      const extraShift = escalaDiaria?.find((ed: any) => ed.dia === day && ed.categoria === 'Extra')
      const extraHoursScheduled = getExtraHoursFromShift(extraShift)
      const extraMinutesScheduled = Math.round(extraHoursScheduled * 60)
      const afastamentosAnulantes = afastamentosDia.filter(af => isShiftOverlappingAfastamento(af, shift))

      // Check holiday
      const feriadoInfo = feriados?.find((f: any) => f.data === dateStr)

      // Check manual edits in existing record to preserve them
      const registroExistente = registrosExistentes.find((r: any) => r.dia === day)
      const shouldPreserve = true

      // Helper function to check if we should generate time for a scheduled marker
      const shouldGenerate = (scheduledMin: number) => {
        if (resolvedAno > currentYear) return false
        if (resolvedAno < currentYear) return true
        if (resolvedMes > currentMonth) return false
        if (resolvedMes < currentMonth) return true
        if (day > currentDay) return false
        if (day < currentDay) return true
        return currentTotalMin >= (scheduledMin % 1440)
      }

      // Check if point facultativo applies
      const pf = pontosFacultativos?.find((p: any) => p.data === dateStr)
      let pfInfo = null
      if (pf) {
        const rule = pfSetores?.find((r: any) => r.ponto_facultativo_id === pf.id && r.setor_id === escala.setor_id)
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
        afastamento: afastamentosAnulantes.length > 0 ? descreverAfastamentos(afastamentosAnulantes) : null,
        jornada_nome: activeJornada?.nome || null,
        jornada_temporaria: !!tempJourney,
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
        // Rest day (folga)
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
        // Work day!
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

        // Consolida os turnos do dia (Regular, Extra, Plantão) e resolve, para cada passo,
        // o horário vencedor junto da origem daquele horário específico.
        const dayShifts = turnosDaFolha<any>(escalaDiaria?.filter((d: any) => d.dia === day) || [])

        const marcEntrada = resolverMarcacaoDoDia(dayShifts, 'entrada')
        const marcIntervaloSaida = resolverMarcacaoDoDia(dayShifts, 'intervalo_saida')
        const marcIntervaloRetorno = resolverMarcacaoDoDia(dayShifts, 'intervalo_retorno')
        const marcSaida = resolverMarcacaoDoDia(dayShifts, 'saida')

        const realEntradaTime = marcEntrada.horario
        const realIntervaloSaidaTime = marcIntervaloSaida.horario
        const realIntervaloRetornoTime = marcIntervaloRetorno.horario
        const realSaidaTime = marcSaida.horario

        const isManualEntrada = marcEntrada.manual
        const isManualIntervaloSaida = marcIntervaloSaida.manual
        const isManualIntervaloRetorno = marcIntervaloRetorno.manual
        const isManualSaida = marcSaida.manual

        const hasRealEntrada = realEntradaTime !== null && !isManualEntrada
        const hasRealIntervaloSaida = realIntervaloSaidaTime !== null && !isManualIntervaloSaida
        const hasRealIntervaloRetorno = realIntervaloRetornoTime !== null && !isManualIntervaloRetorno
        const hasRealSaida = realSaidaTime !== null && !isManualSaida

        // Calculate official time markers (in minutes from midnight)
        const officialEntradaMin = startHour * 60 + startMin
        const baseOfficialSaidaMin = endHour * 60 + endMin
        let officialSaidaMin = baseOfficialSaidaMin + extraMinutesScheduled
        let totalBrutoMin = officialSaidaMin - officialEntradaMin
        if (totalBrutoMin < 0) {
          totalBrutoMin += 24 * 60
        }
        
        // Midpoint of shift for lunch out
        const halfJornadaMin = Math.floor(totalBrutoMin / 2)
        const officialSaidaIntervaloMin = (officialEntradaMin + halfJornadaMin) % (24 * 60)
        const officialRetornoIntervaloMin = (officialSaidaIntervaloMin + intervaloMinutos) % (24 * 60)

        // Generate seeds for deterministic fictitious times
        const seedBase = `${servidorId}-${resolvedMes}-${resolvedAno}-${day}`

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
            // Lunch out
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

            // Lunch return
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

        const temMarcacao = hasRealEntrada || isManualEntrada || hasRealSaida || isManualSaida || hasRealIntervaloSaida || isManualIntervaloSaida || hasRealIntervaloRetorno || isManualIntervaloRetorno || !!registro.entrada || !!registro.saida

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
        const diaJaPassou = (resolvedAno < currentYear) ||
          (resolvedAno === currentYear && resolvedMes < currentMonth) ||
          (resolvedAno === currentYear && resolvedMes === currentMonth && day < currentDay)

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
            fimDoMes: new Date(resolvedAno, resolvedMes, 0),
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
        const scheduledEntrance = new Date(`${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
        const scheduledExit = new Date(`${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
        if (scheduledExit <= scheduledEntrance) {
          scheduledExit.setDate(scheduledExit.getDate() + 1) // crosses midnight
        }

        let effectiveScheduledExit = scheduledExit
        if (pfInfo && pfInfo.inicio_liberacao_em && pfInicioMin !== null && officialEntradaMin < pfInicioMin) {
          const releaseHour = Math.floor(pfInicioMin / 60)
          const releaseMin = pfInicioMin % 60
          effectiveScheduledExit = new Date(`${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(releaseHour).padStart(2, '0')}:${String(releaseMin).padStart(2, '0')}:00-03:00`)
        }

        let evalExit: Date | null = null

        if (hasRealSaida && realSaidaTime) {
          evalExit = realSaidaTime
        } else if (registro.saida) {
          const [sH, sM] = registro.saida.split(':').map(Number)
          evalExit = new Date(`${resolvedAno}-${String(resolvedMes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(sH).padStart(2, '0')}:${String(sM).padStart(2, '0')}:00-03:00`)
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

    // Scale fingerprint for change detection
    const fingerprint = generateFingerprint(escalaDiaria)

    // Save to public.folha_ponto
    const { data: savedFolha, error: saveError } = await supabase
      .from('folha_ponto')
      .upsert({
        escala_mensal_id: escala.id,
        servidor_id: servidorId,
        mes: resolvedMes,
        ano: resolvedAno,
        status: targetStatus,
        registros,
        escala_fingerprint: fingerprint,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        gerado_por_id: geradoPorId,
        gerado_em: new Date().toISOString(),
        cargo: existingFolha?.cargo || servidor.cargo
      }, { onConflict: 'escala_mensal_id' })
      .select('id')
      .single()

    if (saveError) throw saveError

    return { success: true, folha_id: savedFolha.id }
  } catch (error: any) {
    console.error('Erro ao gerar folha de ponto:', error)
    return { error: error.message }
  }
}

// Generate (or regenerate) a timesheet for a server
export async function gerarFolhaPonto(
  servidorId: string,
  mes: number,
  ano: number,
  forcarRascunho: boolean = false,
  escalaMensalId?: string
) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    let escala: any = null

    if (escalaMensalId) {
      const { data: esc, error: escError } = await supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('id', escalaMensalId)
        .single()
      if (escError) throw escError
      escala = esc
    } else {
      // Find matching scale for this server, month, year
      const { data: serverInfo } = await supabase
        .from('servidores')
        .select('unidade_id, setor_id')
        .eq('id', servidorId)
        .single()

      const query = supabase
        .from('escala_mensal')
        .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
        .eq('servidor_id', servidorId)
        .eq('mes', mes)
        .eq('ano', ano)
        .eq('ativo', true)

      if (serverInfo?.unidade_id && serverInfo?.setor_id) {
        const { data: match } = await query
          .eq('unidade_id', serverInfo.unidade_id)
          .eq('setor_id', serverInfo.setor_id)
          .maybeSingle()
        if (match) {
          escala = match
        }
      }

      if (!escala) {
        const { data: list } = await supabase
          .from('escala_mensal')
          .select('id, status, unidade_id, setor_id, mes, ano, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais)')
          .eq('servidor_id', servidorId)
          .eq('mes', mes)
          .eq('ano', ano)
          .eq('ativo', true)
          .limit(1)
        if (list && list.length > 0) {
          escala = list[0]
        }
      }
    }

    if (!escala) {
      return { error: 'Servidor não possui escala regular criada neste setor para o mês selecionado.' }
    }

    const resolvedMes = escala.mes
    const resolvedAno = escala.ano
    const resolvedUnidadeId = escala.unidade_id
    const resolvedSetorId = escala.setor_id

    if (await isCompetencyClosed(resolvedMes, resolvedAno)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Security check using scale's unit and sector
    if (!resolvedUnidadeId || !resolvedSetorId || !hasSectorAccess(userProfile, resolvedSetorId, resolvedUnidadeId)) {
      return { error: 'Acesso negado às escalas deste servidor.' }
    }

    // Check status requirement
    if (escala.status === 'Em Andamento' && !forcarRascunho) {
      return { error: 'A escala do servidor está Em Andamento. Você deve gerar como Rascunho.' }
    }

    const res = await executeGerarFolhaPonto(
      supabase,
      servidorId,
      mes,
      ano,
      forcarRascunho ? 'Rascunho' : 'Gerada',
      escala.id,
      userProfile.id
    )

    if (res.success) {
      revalidatePath('/folha-ponto')
    }

    return res
  } catch (error: any) {
    console.error('Erro ao gerar folha de ponto:', error)
    return { error: error.message }
  }
}

// Generate in bulk for all servers in a sector (unit and sector are optional)
export async function gerarFolhasEmLote(
  mes: number,
  ano: number,
  unidadeId?: string,
  setorId?: string,
  forcarRascunho: boolean = false
) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch scales for this month/year, optionally filtered by unit and sector
    let queryEscalas = supabase
      .from('escala_mensal')
      .select('id, servidor_id, unidade_id, setor_id')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (unidadeId) {
      queryEscalas = queryEscalas.eq('unidade_id', unidadeId)
    }
    if (setorId) {
      queryEscalas = queryEscalas.eq('setor_id', setorId)
    }

    // Apply security filters at DB level
    queryEscalas = applyAccessFilters(queryEscalas, userProfile)

    const { data: escalas, error: escError } = await queryEscalas

    if (escError) throw escError
    if (!escalas || escalas.length === 0) {
      return { error: 'Nenhuma escala ativa encontrada para a competência selecionada.' }
    }

    let geradas = 0
    let erros = 0

    for (const esc of escalas) {
      const res = await executeGerarFolhaPonto(
        supabase,
        esc.servidor_id,
        mes,
        ano,
        forcarRascunho ? 'Rascunho' : 'Gerada',
        esc.id,
        userProfile.id
      )
      if (res.success) {
        geradas++
      } else {
        erros++
      }
    }

    revalidatePath('/folha-ponto')
    return { success: true, message: `${geradas} folhas geradas com sucesso. ${erros} falhas.` }
  } catch (error: any) {
    console.error('Erro na geração em lote:', error)
    return { error: error.message }
  }
}

// Sincronizar Folha Ponto (after scale changes)
export async function sincronizarFolhaPonto(folhaId: string) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch the existing folha
    const { data: folha, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('*')
      .eq('id', folhaId)
      .single()

    if (folhaError || !folha) throw new Error('Folha de ponto não encontrada')

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Fetch scale
    const { data: escala, error: escError } = await supabase
      .from('escala_mensal')
      .select('id, status, jornada_id, jornadas(nome, intervalo_minutos, horas_totais), unidade_id, setor_id')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (escError || !escala) throw new Error('Escala vinculada não encontrada')

    // Security check
    if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
      return { error: 'Acesso negado para gerenciar esta folha.' }
    }

    // Fetch all shifts from escala_diaria (Regular, Extra, Plantão) for the specific scale of this folha
    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select(`id, dia, categoria, dicionario_turnos_id, ${COLUNAS_PRESENCA_FOLHA}, intervalo_nao_usufruido, presenca_confirmada, dicionario_turnos(codigo, slots)`)
      .eq('escala_mensal_id', escala.id)

    // Origem das marcacoes vem das flags presenca_*_manual — ver origemMarcacao.ts.

    const currentShifts = escalaDiaria || []
    const fingerprint = generateFingerprint(currentShifts.filter(d => d.categoria === 'Regular'))

    // Fetch holidays
    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data, descricao')
      .gte('data', startDate)
      .lte('data', endDate)

    const feriadosSet: Set<string> = new Set(feriados?.map(f => f.data) || [])

    // Fetch absences
    const { data: afastamentos } = await supabase
      .from('servidores_eventos')
      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

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
      .or(`data_inicio.lte.${endDate},data_fim.gte.${startDate}`)

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

    const limitesTolerancia = await obterLimitesTolerancia(supabase)
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

      // Check if this day's scale actually changed (shift presence vs existing record)
      const hadShift = registroExistente && registroExistente.turno_codigo !== null
      const hasShift = !!currentShift

      const scaleChangedForDay = (hadShift !== hasShift) || (hadShift && registroExistente.turno_codigo !== getTurnoCodigo(currentShift?.dicionario_turnos))

      // Check afastamento and holidays
      const afastamentosDia = afastamentosDoDia(afastamentos, dateStr)
      const afastamentosAnulantes = afastamentosDia.filter(af => isShiftOverlappingAfastamento(af, currentShift))
      const feriadoInfo = feriados?.find(f => f.data === dateStr)

      // Core logic: If day changed, or if it had no manual edits, we regenerate it.
      // If it had manual edits AND scale DID NOT change, we preserve it.
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
        afastamento: afastamentosAnulantes.length > 0 ? descreverAfastamentos(afastamentosAnulantes) : null,
        jornada_nome: activeJornada?.nome || null,
        jornada_temporaria: !!tempJourney,
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

        // Consolida os turnos do dia (Regular, Extra, Plantão) e resolve, para cada passo,
        // o horário vencedor junto da origem daquele horário específico.
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

        const temMarcacao = hasRealEntrada || isManualEntrada || hasRealSaida || isManualSaida || hasRealIntervaloSaida || isManualIntervaloSaida || hasRealIntervaloRetorno || isManualIntervaloRetorno || !!registro.entrada || !!registro.saida

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
        ultima_edicao_por_id: userProfile.id,
        ultima_edicao_em: new Date().toISOString()
      })
      .eq('id', folhaId)

    if (saveError) throw saveError

    revalidatePath(`/folha-ponto/${folhaId}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro na sincronização de folha:', error)
    return { error: error.message }
  }
}

/**
 * Move uma batida REAL de um passo vazio pro outro no mesmo dia (ex.: uma saida que caiu em
 * "saida intervalo" porque o servidor trabalhou direto, sem marcar o intervalo, e o terminal
 * so preenche o proximo passo vazio em sequencia). Nunca fabrica horario: so corrige em qual
 * campo de escala_diaria o horario real ja gravado esta classificado - marcacoes_ponto nunca e
 * tocada. Ver fn_reclassificar_passo_presenca (20260812150000) e o caso real que motivou isto
 * (dia 12/08/2026, Fernando/TI) em docs/evolucao.
 */
export async function reclassificarPassoPresenca(
  folhaId: string,
  dia: number,
  passoOrigem: PassoPresenca,
  passoDestino: PassoPresenca,
  justificativa: string
) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    const { data: folha, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('id, escala_mensal_id, mes, ano, servidor_id')
      .eq('id', folhaId)
      .single()

    if (folhaError || !folha) throw new Error('Folha de ponto não encontrada')

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    const { data: escala, error: escError } = await supabase
      .from('escala_mensal')
      .select('id, unidade_id, setor_id')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (escError || !escala) throw new Error('Escala vinculada não encontrada')

    if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
      return { error: 'Acesso negado para corrigir a presença desta folha.' }
    }

    if (!justificativa || justificativa.trim().length < 5) {
      return { error: 'Justificativa obrigatória (mínimo 5 caracteres).' }
    }

    // Resolve qual escala_diaria.id forneceu o horario vencedor do passo de origem neste dia -
    // a MESMA logica que a folha usa pra decidir o que mostrar (fonte unica, origemMarcacao.ts).
    // Sem isso, um dia com mais de um turno (Regular + Extra/Plantao) poderia corrigir a linha
    // errada.
    const { data: turnosDoDia } = await supabase
      .from('escala_diaria')
      .select(`id, ${COLUNAS_PRESENCA_FOLHA}`)
      .eq('escala_mensal_id', folha.escala_mensal_id)
      .eq('dia', dia)

    const marcacaoOrigem = resolverMarcacaoDoDia(turnosDoDia || [], passoOrigem)
    if (!marcacaoOrigem.escalaDiariaId) {
      return { error: 'Não há marcação real neste passo para mover.' }
    }

    const { data: antes } = await supabase
      .from('escala_diaria')
      .select(COLUNAS_PRESENCA_FOLHA)
      .eq('id', marcacaoOrigem.escalaDiariaId)
      .single()

    const { error: rpcError } = await supabase.rpc('fn_reclassificar_passo_presenca', {
      p_escala_diaria_id: marcacaoOrigem.escalaDiariaId,
      p_passo_origem: passoOrigem,
      p_passo_destino: passoDestino,
      p_justificativa: justificativa.trim(),
    })

    if (rpcError) {
      return { error: rpcError.message }
    }

    const { data: depois } = await supabase
      .from('escala_diaria')
      .select(COLUNAS_PRESENCA_FOLHA)
      .eq('id', marcacaoOrigem.escalaDiariaId)
      .single()

    await registrarLog({
      acao: 'PRESENCA_RECLASSIFICADA',
      entidade: 'escala',
      entidadeId: marcacaoOrigem.escalaDiariaId,
      userId: userProfile.id,
      alteracoes: calcularAlteracoes(antes, depois),
      detalhes: {
        dia,
        passoOrigem,
        passoDestino,
        justificativa: justificativa.trim(),
        servidorId: folha.servidor_id,
      },
      unidadeId: escala.unidade_id,
      setorId: escala.setor_id,
    })

    // Fecha o loop pedido: a folha ja visivel na tela reflete a correcao sem precisar de um
    // clique separado em "Sincronizar" - reusa a mesma funcao de sincronizacao (que ja re-deriva
    // registros a partir de escala_diaria, preservando edicoes manuais de outros dias), sem
    // duplicar logica de geracao.
    const syncResult = await sincronizarFolhaPonto(folhaId)

    // Revalida a folha de ponto e a grade da escala para refletir imediatamente a movimentação
    revalidatePath(`/folha-ponto/${folhaId}`)
    revalidatePath('/folha-ponto')
    revalidatePath('/escalas')
    if (escala.unidade_id) {
      revalidatePath(`/escalas/unidade/${escala.unidade_id}`)
    }

    if (syncResult?.error) {
      return {
        success: true,
        warning: `A marcação foi corrigida, mas a folha não pôde ser sincronizada automaticamente: ${syncResult.error}`,
      }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao reclassificar presença:', error)
    return { error: error.message }
  }
}

// Persist edited timesheet records from the UI editor
export async function salvarFolhaPonto(folhaId: string, registros: any[], status?: string, cargo?: string) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch existing sheet to check values and lotação permission
    const { data: folha, error: fetchError } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, mes, ano, servidor_id, registros, status')
      .eq('id', folhaId)
      .single()

    if (fetchError || !folha) throw new Error('Folha de ponto não encontrada')

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    // Bloquear alteração de marcações reais (origem = 'real') para quem não for super_admin
    if (userProfile.role !== 'super_admin') {
      const oldRegistros = folha.registros as any[]
      for (const r of registros) {
        const oldR = oldRegistros?.find((o: any) => o.dia === r.dia)
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
    }

    const { data: escala } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id, status, jornada_id, jornadas(horas_totais, nome, intervalo_minutos)')
      .eq('id', folha.escala_mensal_id)
      .single()

    if (!escala) throw new Error('Escala vinculada não encontrada')

    // Security check
    if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
      return { error: 'Acesso negado para gerenciar esta folha.' }
    }

    // GATE DE DESFECHO — fase 5 do plano de 23/08/2026.
    //
    // Fechar a folha é o que congela a competência para pagamento. Se um plantão continua "em
    // avaliação" nesse momento, o anexo sai com horas que ninguém confirmou nem negou — e
    // depois de fechada, corrigir exige reabrir.
    //
    // ⚠️ Vale apenas para o FECHAMENTO (`Revisada`). Salvar rascunho, sincronizar e reabrir
    // continuam livres: o gate existe para impedir o congelamento, não para atrapalhar o
    // trabalho que leva até ele.
    //
    // Controlado por `desfecho_obrigatorio_fechar`, que nasce false (20260824160000).
    if (status === 'Revisada' && folha.status !== 'Revisada') {
      const { data: cfgDesfecho } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'desfecho_obrigatorio_fechar')
        .maybeSingle()

      if (String(cfgDesfecho?.valor).replace(/"/g, '') === 'true') {
        const { data: hojeLocal } = await supabase.rpc('fn_data_local')
        const { data: desfechos } = await supabase.rpc('fn_desfecho_eventos_escalas', {
          p_escala_mensal_ids: [folha.escala_mensal_id],
          p_hoje: String(hojeLocal)
        })
        const pendentes = (desfechos || []).filter((d: any) => d.estado === 'em_avaliacao')
        if (pendentes.length > 0) {
          const dias = pendentes.map((d: any) => d.dia).sort((a: number, b: number) => a - b).join(', ')
          return {
            error: `Não é possível fechar: ${pendentes.length} plantão(ões)/sobreaviso(s) sem registro completo de ponto e sem decisão do coordenador — dia(s) ${dias}. Resolva em OPERAÇÃO > Justificativas (filtro "Em avaliação").`
          }
        }
      }
    }

    // Se a folha estiver Revisada, apenas super_admin e admin podem reabri-la (passando status !== 'Revisada')
    if (folha.status === 'Revisada') {
      if (status !== 'Gerada' && status !== 'Rascunho') {
        return { error: 'Esta folha de ponto está fechada (Revisada). Reabra-a antes de fazer edições.' }
      }
      if (userProfile.role !== 'super_admin' && userProfile.role !== 'admin') {
        return { error: 'Apenas administradores podem reabrir uma folha de ponto fechada.' }
      }
    }

    const jornadaDetails = escala.jornadas ? (escala.jornadas as any) : null
    const horasNormaisDiarias = jornadaDetails?.horas_totais ?? 8

    // Carga de cada dia: a jornada do mes e so o PADRAO. Dias cobertos por vigencia
    // (servidores_jornadas_temporarias) valem a carga da jornada que a geracao gravou em
    // registro.jornada_nome. Ver src/utils/folha/cargaDiaria.ts.
    const { data: todasJornadas } = await supabase
      .from('jornadas')
      .select('nome, horas_totais')
    const cargaPorJornada = montarCargaPorJornada(todasJornadas)

    // Fetch holidays of the month for overtime classification
    const startDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-01`
    const daysInMonth = new Date(folha.ano, folha.mes, 0).getDate()
    const endDate = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${daysInMonth}`
    const { data: feriados } = await supabase
      .from('feriados')
      .select('data')
      .gte('data', startDate)
      .lte('data', endDate)
    const feriadosSet = new Set(feriados?.map(f => f.data) || [])

    // Validação de consistência cronológica e limpeza de falta em dias preenchidos
    for (const r of registros) {
      if (!r.turno_codigo || r.afastamento || r.feriado) continue

      // Leitura cronologica do dia (fonte unica, compartilhada com o editor e o Auto-Corrigir).
      // A deteccao anterior de virada de dia era /18|19|20|21|22/ sobre o nome da jornada, que
      // casa com "08H ÀS 18H" — a jornada diurna mais comum do sistema. Toda ela era tratada
      // como noturna, e estes tres guards, que existem para pegar erro de digitacao antes de
      // virar folha oficial, ficavam inertes justamente nela.
      const seq = sequenciarDia(r, r.jornada_nome)

      // 1. Saída de intervalo vs Retorno de intervalo
      if (seq.intervaloInvertido) {
        return {
          error: `Inconsistência no Dia ${String(r.dia).padStart(2, '0')}: o horário de Saída para o Intervalo (${r.saida_intervalo}) não pode ser maior ou igual ao Retorno do Intervalo (${r.retorno_intervalo}). Corrija a sequência dos horários.`
        }
      }

      // 2. Entrada vs Saída de intervalo
      if (seq.entradaInvertida) {
        return {
          error: `Inconsistência no Dia ${String(r.dia).padStart(2, '0')}: o horário de Entrada (${r.entrada}) não pode ser maior ou igual à Saída para o Intervalo (${r.saida_intervalo}).`
        }
      }

      // 3. Retorno de intervalo vs Saída final
      if (seq.saidaInvertida) {
        return {
          error: `Inconsistência no Dia ${String(r.dia).padStart(2, '0')}: o horário de Retorno do Intervalo (${r.retorno_intervalo || r.saida_intervalo || r.entrada}) não pode ser maior ou igual à Saída Final (${r.saida}).`
        }
      }

      // 4. Limpeza automática de FALTA caso o dia agora possua horários de marcação
      const temHorarios = PASSOS_FOLHA.some(passo => seq.minutos[passo] !== null)
      if (temHorarios && r.observacao && (r.observacao.includes('FALTA') || r.observacao.includes('AGUARDANDO JUSTIFICATIVA'))) {
        r.observacao = ''
      }
    }

    // Recalculate totals
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

      // Check extra hours
      if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
        const dateObj = new Date(folha.ano, folha.mes - 1, r.dia)
        const dateStr = `${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`
        const isSunday = dateObj.getDay() === 0
        const isHoliday = feriadosSet.has(dateStr)

        if (isSunday || isHoliday) {
          totalExtra100 += r.hora_extra_minutos
        } else {
          // If night shift or coordinator split, otherwise default to 50% on normal edits unless flag is present
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
      ultima_edicao_por_id: userProfile.id,
      ultima_edicao_em: new Date().toISOString()
    }

    if (status) {
      updatePayload.status = status
    }

    if (cargo !== undefined) {
      updatePayload.cargo = cargo
    }

    const { error: updateError } = await supabase
      .from('folha_ponto')
      .update(updatePayload)
      .eq('id', folhaId)

    if (updateError) throw updateError

    // A folha é o documento legal do ponto. Até aqui o sistema guardava apenas
    // `ultima_edicao_por_id` — só a ÚLTIMA edição — e os horários vivem num jsonb sobrescrito
    // inteiro. Não havia como mostrar que a entrada do dia 12 era 08:03 e virou 08:00, nem quem
    // fez. O diff por dia e campo é justamente essa resposta.
    const alteracoes = calcularAlteracoesFolha(folha.registros as any[], registros)
    const mudouStatus = status && status !== folha.status

    if (Object.keys(alteracoes).length > 0 || mudouStatus) {
      await registrarLog({
        acao: mudouStatus && Object.keys(alteracoes).length === 0 ? 'FOLHA_STATUS_ALTERADO' : 'FOLHA_EDITADA',
        entidade: 'folha_ponto',
        entidadeId: folhaId,
        userId: userProfile.id,
        alteracoes: mudouStatus
          ? { ...alteracoes, status: { de: folha.status, para: status } }
          : alteracoes,
        detalhes: {
          servidor_id: folha.servidor_id,
          competencia: `${folha.mes}/${folha.ano}`,
          dias_alterados: new Set(Object.keys(alteracoes).map(k => k.split(' ')[1])).size,
        },
        unidadeId: escala.unidade_id,
        setorId: escala.setor_id,
      })
    }

    revalidatePath(`/folha-ponto/${folhaId}`)
    return { success: true }
  } catch (error: any) {
    console.error('Erro ao salvar folha de ponto:', error)
    return { error: error.message }
  }
}

// Get the fingerprint comparison to check if sync is needed
export async function verificarDivergenciaEscala(folhaId: string) {
  try {
    const supabase = await createClient()

    const { data: folha } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, escala_fingerprint, registros')
      .eq('id', folhaId)
      .single()

    if (!folha) return { divergent: false }

    const { data: escalaDiaria } = await supabase
      .from('escala_diaria')
      .select('dia, dicionario_turnos_id, categoria, dicionario_turnos(codigo)')
      .eq('escala_mensal_id', folha.escala_mensal_id)
      .eq('categoria', 'Regular')

    const currentFingerprint = generateFingerprint(escalaDiaria || [])
    let divergent = currentFingerprint !== folha.escala_fingerprint

    // Find affected days
    const affectedDays: number[] = []
    if (divergent) {
      const records = folha.registros as any[]
      const currentShifts = escalaDiaria || []

      // Check each day of month (assume 1 to 31)
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
        // Atualiza o fingerprint silenciosamente para evitar falso positivo nas próximas verificações
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
    console.error('Erro ao verificar divergência:', error)
    return { divergent: false }
  }
}

// Fetch complete print data for multiple timesheets (folhas de ponto) in batch
export async function getFolhasPontoPrintData(folhaIds: string[]) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    // Fetch global logo config
    const { data: logoData } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'instituicao_cabecalho_url')
      .single()
    const logoUrl = logoData?.valor || ''

    // Fetch the folhas with server details
    const { data: folhas, error: folhaError } = await supabase
      .from('folha_ponto')
      .select('*, servidores(*)')
      .in('id', folhaIds)

    if (folhaError) throw folhaError
    if (!folhas || folhas.length === 0) return { error: 'Nenhuma folha encontrada.' }

    // Fetch scales
    const escalaIds = folhas.map(f => f.escala_mensal_id)
    const { data: escalas, error: escError } = await supabase
      .from('escala_mensal')
      .select('*, unidades(*), setores(*, dicionario_setores(nome)), jornadas(*)')
      .in('id', escalaIds)

    if (escError) throw escError

    const mappedFolhas = []
    for (const folha of folhas) {
      const escala = escalas?.find(e => e.id === folha.escala_mensal_id)
      if (!escala) continue

      if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
        continue
      }

      let finalFolha = folha
      if (await checkIfFolhaHasPendingPastTimes(folha, escala)) {
        await sincronizarFolhaPonto(folha.id)
        const { data: updated } = await supabase
          .from('folha_ponto')
          .select('*, servidores(*)')
          .eq('id', folha.id)
          .maybeSingle()
        if (updated) {
          finalFolha = updated
        }
      }

      const sectorData = Array.isArray(escala.setores) ? escala.setores[0] : escala.setores
      const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
        ? sectorData.dicionario_setores[0] 
        : sectorData.dicionario_setores) : null

      const resolvedSetor = sectorData ? {
        ...sectorData,
        nome: dictData?.nome || 'SETOR SEM NOME'
      } : null

      mappedFolhas.push({
        ...finalFolha,
        escala: {
          ...escala,
          setores: resolvedSetor
        }
      })
    }

    return { folhas: mappedFolhas, logoUrl }
  } catch (error: any) {
    console.error('Erro em getFolhasPontoPrintData:', error)
    return { error: error.message }
  }
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

/**
 * Janela prevista de UM turno de plantao/extra, para o anexo — "13:00 as 19:00".
 *
 * O anexo mostrava so o codigo e a carga ("T (6h)"), que nao diz quando o plantao comeca. Quem
 * responde isso e a cadeia de precedencia da armadilha 4 do CLAUDE.md; aqui usam-se os DOIS
 * primeiros niveis, que sao os que valem para plantao:
 *
 *   nivel 1  escala_diaria.hora_inicio_prevista  (o coordenador informou ao escalar — e o que a
 *            modal "Horario do turno T" grava, e vence todas as demais regras)
 *   nivel 2  dicionario_turnos.horario_inicio    (os 27 codigos ancorados; T = 13:00)
 *
 * Nao usa fn_blocos_previstos_dia DE PROPOSITO: ela FUNDE turnos contiguos (armadilha 6), entao
 * para um Regular 07:00-13:00 seguido de Plantao 13:00-19:00 ela devolve um bloco unico
 * 07:00->19:00 — exatamente o horario do expediente que nao deve aparecer aqui.
 *
 * Sem nenhum dos dois niveis (codigo Classe B sem hora informada), cai no rotulo antigo: melhor
 * mostrar "T (6h)" do que inventar um inicio.
 */
function formatarJanelaPrevista(horaInicioPrevista: string | null | undefined, turno: any): string {
  const rotuloAntigo = turno?.codigo
    ? `${turno.codigo} (${turno.horas_computadas || 12}h)`
    : `${turno?.horas_computadas || 12}h`

  const inicio = horaInicioPrevista || turno?.horario_inicio
  const horas = Number(turno?.horas_computadas)
  if (!inicio || !Number.isFinite(horas) || horas <= 0) return rotuloAntigo

  const [h, m] = String(inicio).split(':')
  const iniMin = parseInt(h, 10) * 60 + parseInt(m || '0', 10)
  if (!Number.isFinite(iniMin)) return rotuloAntigo

  // O fim pode passar da meia-noite (plantao noturno): o modulo mantem a hora do relogio.
  const fimMin = (iniMin + Math.round(horas * 60)) % 1440
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  return `${hhmm(iniMin)} às ${hhmm(fimMin)}`
}

export async function getDadosPlantoesSobreavisosServidor(servidorId: string, mes: number, ano: number) {
  try {
    const supabase = await createAdminClient()

    // 1. Fetch server info
    const { data: servidor, error: sErr } = await supabase
      .from('servidores')
      .select('id, nome, matricula, cargo, vinculo, unidade_id, setor_id')
      .eq('id', servidorId)
      .single()

    if (sErr) throw sErr

    // 2. Resolve Unit and Sector names
    let unidadeNome = 'SECRETARIA MUNICIPAL DE SAÚDE'
    if (servidor?.unidade_id) {
      const { data: u } = await supabase.from('unidades').select('nome').eq('id', servidor.unidade_id).maybeSingle()
      if (u?.nome) unidadeNome = u.nome
    }
    let setorNome = 'SETOR GERAL'
    if (servidor?.setor_id) {
      const { data: s } = await supabase.from('setores').select('dicionario_setores(nome)').eq('id', servidor.setor_id).maybeSingle()
      const dict = Array.isArray(s?.dicionario_setores) ? s?.dicionario_setores[0] : s?.dicionario_setores
      if (dict?.nome) setorNome = dict.nome
    }

    const servidorFormatado = {
      ...servidor,
      unidades: { nome: unidadeNome },
      setores: { dicionario_setores: { nome: setorNome } }
    }

    // 3. Fetch active scales of this server for that month/year
    const { data: escalasMensais, error: eErr } = await supabase
      .from('escala_mensal')
      .select(`
        id, mes, ano, status, unidade_id, setor_id,
        unidades(nome),
        setores(dicionario_setores(nome))
      `)
      .eq('servidor_id', servidorId)
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)

    if (eErr) throw eErr

    const escalaMensalIds = escalasMensais?.map(em => em.id) || []
    const emMap = new Map((escalasMensais || []).map(em => [em.id, em]))

    // 4. Fetch daily scale entries
    let diarias: any[] = []
    if (escalaMensalIds.length > 0) {
      const { data: dData, error: dErr } = await supabase
        .from('escala_diaria')
        .select(`
          id, dia, categoria, escala_mensal_id, dicionario_turnos_id, hora_inicio_prevista,
          presenca_entrada_em, presenca_saida_em,
          presenca_confirmada, presenca_entrada_origem, presenca_saida_origem,
          presenca_entrada_manual, presenca_saida_manual,
          dicionario_turnos(id, codigo, descricao, horas_computadas, tipo, slots, horario_inicio)
        `)
        .in('escala_mensal_id', escalaMensalIds)
        .order('dia', { ascending: true })

      if (dErr) throw dErr
      diarias = dData || []
    }

    // 4-B. O DESFECHO DE CADA EVENTO — fn_desfecho_evento_dia (20260824120000).
    //
    // Ate 24/08/2026 este anexo somava `horas_computadas` de TODA linha de plantao, tivesse ou
    // nao registro de ponto, e a observacao dizia apenas "Em validacao" — texto, sem
    // consequencia. Medido em 08/2026: de 2.107h impressas, 1.377h (65%) nao tinham registro
    // completo. O anexo e comprobatorio: e o que o servidor assina e o que o RH usa para pagar
    // a unidade de plantao.
    //
    // A classificacao NAO e refeita aqui. Se a tela derivasse por conta propria, o que o
    // coordenador decidiu na fila deixaria de ser o que este documento imprime.
    const desfechoPorLinha = new Map<string, { estado: string; motivo: string | null }>()
    if (escalaMensalIds.length > 0) {
      try {
        const { data: hojeLocal } = await supabase.rpc('fn_data_local')
        const { data: desfechos } = await supabase.rpc('fn_desfecho_eventos_escalas', {
          p_escala_mensal_ids: escalaMensalIds,
          p_hoje: String(hojeLocal)
        })
        ;(desfechos || []).forEach((d: any) => {
          desfechoPorLinha.set(d.escala_diaria_id, { estado: d.estado, motivo: d.motivo })
        })
      } catch (err) {
        // Sem o desfecho o anexo volta a ser o de antes (soma tudo) em vez de nao abrir. Um
        // documento que nao imprime na hora da conferencia e pior do que um que imprime demais
        // — e o rotulo diz qual dos dois o leitor tem na mao.
        console.warn('Desfecho dos eventos indisponivel; o anexo sai sem a reparticao:', err)
      }
    }

    // 5. Fetch justificativas_eventos for this server in that month/year
    const { data: justificativas } = await supabase
      .from('justificativas_eventos')
      .select('escala_diaria_id, dia, categoria, texto_justificativa, status, origem, motivo_recusa, resultado, resultado_origem')
      .eq('servidor_id', servidorId)
      .eq('mes', mes)
      .eq('ano', ano)

    const justMap = new Map<string, any>()
    justificativas?.forEach((j: any) => {
      if (j.escala_diaria_id) justMap.set(j.escala_diaria_id, j)
      justMap.set(`${j.dia}_${j.categoria}`, j)
    })

    // 6. Fetch on-call logs (logs_sobreaviso) for this server in that month/year
    let logsSobreaviso: any[] = []
    if (escalaMensalIds.length > 0) {
      const { data: lsData, error: lsErr } = await supabase
        .from('logs_sobreaviso')
        .select(`
          id, escala_mensal_id, dia, status, motivo_acionamento, acionado_por, categoria,
          data_hora_acionamento, data_hora_chegada, data_hora_validacao,
          destino_referencia,
          destino_unidade:unidades!destino_unidade_id(nome),
          destino_setor:setores!fk_logs_sobreaviso_destino_setor(dicionario_setores(nome)),
          acionador:profiles!acionado_por(full_name)
        `)
        .in('escala_mensal_id', escalaMensalIds)
        .order('dia', { ascending: true })

      if (lsErr) {
        console.warn('Busca de logs_sobreaviso com joins falhou, tentando consulta simples:', lsErr.message)
        const { data: fallbackData } = await supabase
          .from('logs_sobreaviso')
          .select('id, escala_mensal_id, dia, status, motivo_acionamento, acionado_por, categoria, data_hora_acionamento, data_hora_chegada, data_hora_validacao, destino_referencia')
          .in('escala_mensal_id', escalaMensalIds)
          .order('dia', { ascending: true })
        logsSobreaviso = fallbackData || []
      } else {
        logsSobreaviso = lsData || []
      }
    }

    // 7. Organize Plantões and Sobreavisos
    const plantoes: any[] = []
    const sobreavisos: any[] = []
    const weekDays = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

    for (const ed of diarias) {
      const em = emMap.get(ed.escala_mensal_id)
      const uNome = (em?.unidades as any)?.nome || unidadeNome
      const sDict = (em?.setores as any)?.dicionario_setores
      const sNome = (Array.isArray(sDict) ? sDict[0]?.nome : sDict?.nome) || setorNome

      const rawTurno = ed.dicionario_turnos
      const turno = (Array.isArray(rawTurno) ? rawTurno[0] : rawTurno) as any
      const cat = String(ed.categoria || '').toLowerCase()

      const just = justMap.get(ed.id) || justMap.get(`${ed.dia}_${ed.categoria}`)
      const justTexto = just?.texto_justificativa || ''

      if (cat.includes('plant') || cat.includes('extra')) {
        const dateObj = new Date(ano, mes - 1, ed.dia)
        const turnoDesc = turno?.descricao || turno?.codigo || ed.categoria || 'Plantão'
        const horarioPrevisto = formatarJanelaPrevista(ed.hora_inicio_prevista, turno)

        plantoes.push({
          dia: ed.dia,
          dia_semana: weekDays[dateObj.getDay()],
          data_formatada: `${String(ed.dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`,
          turno_nome: turnoDesc,
          horario_previsto: horarioPrevisto,
          horas_computadas: Number(turno?.horas_computadas || 12),
          entrada_real: ed.presenca_entrada_em ? formatarHora(ed.presenca_entrada_em) : '-',
          saida_real: ed.presenca_saida_em ? formatarHora(ed.presenca_saida_em) : '-',
          confirmado: !!ed.presenca_confirmada,
          unidade: uNome,
          setor: sNome,
          ajuste_manual: ed.presenca_entrada_manual || ed.presenca_saida_manual,
          observacao: justTexto || (ed.presenca_entrada_origem ? `Origem: ${ed.presenca_entrada_origem}` : ''),
          estado: desfechoPorLinha.get(ed.id)?.estado || null,
          estado_motivo: desfechoPorLinha.get(ed.id)?.motivo || null,
          resultado_origem: just?.resultado_origem || null
        })
      } else if (cat.includes('sobreaviso')) {
        const dateObj = new Date(ano, mes - 1, ed.dia)
        // Filtra acionamentos pelo dia e pela escala mensal do servidor.
        //
        // ⚠️ E PRECISO FILTRAR ARTEFATO E CATEGORIA (corrigido em 24/08/2026).
        // logs_sobreaviso NAO e uma tabela de acionamentos: fn_confirmar_presenca e
        // fn_confirmar_presenca_manual tambem escrevem ali ao validar presenca, e os artefatos
        // entram com status 'Chegou' e a categoria do turno validado. Sem estes dois filtros,
        // um artefato de PLANTAO aparecia neste documento assinado como "acionamento presencial
        // de sobreaviso" — 1 caso medido em 08/2026, e cresce com o uso.
        //
        // O relatorio de /relatorios/plantao-sobreaviso ja fazia isso (`ehAcionamentoReal`);
        // este anexo, nao. Agora os dois usam o mesmo criterio, e a fonte dele e SQL
        // (fn_acionamento_sobreaviso_real, 20260824110000) — este predicado e o espelho.
        const ehAcionamentoReal = (l: any) => {
          if (l.acionado_por) return true
          const m: string = l.motivo_acionamento || ''
          return !(/^O próprio usuário confirmou/i.test(m)
                || /^Validação Manual/i.test(m)
                || /^REVERSÃO/i.test(m))
        }
        const acionamentos = logsSobreaviso.filter((l: any) =>
          Number(l.dia) === Number(ed.dia)
          && l.escala_mensal_id === ed.escala_mensal_id
          && (l.categoria === 'Sobreaviso' || l.categoria === null || l.categoria === undefined)
          && ehAcionamentoReal(l)
        )
        const turnoDesc = turno?.descricao || turno?.codigo || 'Sobreaviso'
        const horarioPrevisto = turno?.codigo ? `${turno.codigo} (${turno.horas_computadas || 12}h)` : `${turno?.horas_computadas || 12}h`

        sobreavisos.push({
          dia: ed.dia,
          dia_semana: weekDays[dateObj.getDay()],
          data_formatada: `${String(ed.dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`,
          turno_nome: turnoDesc,
          horario_previsto: horarioPrevisto,
          horas_prontidao: Number(turno?.horas_computadas || 12),
          unidade: uNome,
          setor: sNome,
          justificativa: justTexto,
          // Mesmo desfecho do plantao: sobreaviso sem acionamento (ou acionado e atendido) e
          // `validado` e conta; falha de acionamento e `falta` e nao conta; dia futuro e
          // `previsto`. Sem isto, o resumo do anexo somaria prontidao de dia que nem chegou.
          estado: desfechoPorLinha.get(ed.id)?.estado || null,
          estado_motivo: desfechoPorLinha.get(ed.id)?.motivo || null,
          resultado_origem: just?.resultado_origem || null,
          acionamentos: acionamentos.map((a: any) => {
            const horaAcionamento = a.data_hora_acionamento 
              ? formatarHora(a.data_hora_acionamento) 
              : '-'
            const horaChegada = a.data_hora_chegada 
              ? formatarHora(a.data_hora_chegada) 
              : '-'
            const horaSaida = a.data_hora_validacao
              ? formatarHora(a.data_hora_validacao)
              : '-'
            
            const destUnidade = a.destino_unidade?.nome
            const destDict = a.destino_setor?.dicionario_setores
            const destSetor = Array.isArray(destDict) ? destDict[0]?.nome : destDict?.nome

            const destino = [destUnidade, destSetor, a.destino_referencia].filter(Boolean).join(' • ')

            return {
              id: a.id,
              hora_acionamento: horaAcionamento,
              hora_chegada: horaChegada,
              hora_saida: horaSaida,
              motivo: a.motivo_acionamento || justTexto || 'Atendimento presencial de sobreaviso',
              status: a.status || 'Atendido',
              destino: destino || ''
            }
          })
        })
      }
    }

    plantoes.sort((a, b) => a.dia - b.dia)
    sobreavisos.sort((a, b) => a.dia - b.dia)

    // A CARGA DO ANEXO PASSA A SER O QUE FOI CUMPRIDO, NAO O QUE FOI ESCALADO.
    //
    // `registrado` = o ponto provou (entrada E saida). `validado` = o coordenador decidiu, com
    // justificativa e autor. Os dois somam. `em_avaliacao` aparece na tabela — a linha NUNCA
    // some, senao o servidor perde a chance de contestar antes do fechamento — mas nao soma.
    // `falta` vai para o subtotal proprio.
    //
    // `totalHorasPlantao` continua existindo com o mesmo nome e o mesmo significado de antes
    // (tudo que foi escalado) porque a conferencia do documento depende de fechar a conta:
    // cumpridas + em avaliacao + faltas + previstas = total.
    const somaPor = (filtro: (p: any) => boolean) =>
      plantoes.filter(filtro).reduce((acc, p) => acc + (p.horas_computadas || 0), 0)

    // Estado ausente = a RPC nao respondeu. Cai no comportamento antigo (conta como cumprido)
    // de proposito: um anexo que subitamente zera a carga por indisponibilidade de RPC seria
    // pior do que um que soma demais, e o rotulo do rodape denuncia qual dos dois esta na mao.
    const ehCumprido = (p: any) => !p.estado || p.estado === 'registrado' || p.estado === 'validado'

    const totalHorasPlantao = somaPor(() => true)
    const totalHorasPlantaoCumpridas = somaPor(ehCumprido)
    const totalHorasPlantaoEmAvaliacao = somaPor(p => p.estado === 'em_avaliacao')
    const totalHorasPlantaoFaltas = somaPor(p => p.estado === 'falta')
    const totalPlantoesFaltas = plantoes.filter(p => p.estado === 'falta').length
    const totalPlantoesEmAvaliacao = plantoes.filter(p => p.estado === 'em_avaliacao').length
    const desfechoIndisponivel = plantoes.length > 0 && plantoes.every(p => !p.estado)

    // Prontidao cumprida usa o mesmo criterio do plantao. `totalHorasSobreavisoEscalado` fica
    // ao lado para a conta continuar conferivel.
    const sobreavisoCumprido = (s: any) => !s.estado || s.estado === 'validado'
    const totalHorasSobreaviso = sobreavisos
      .filter(sobreavisoCumprido)
      .reduce((acc, s) => acc + (s.horas_prontidao || 0), 0)
    const totalHorasSobreavisoEscalado = sobreavisos.reduce((acc, s) => acc + (s.horas_prontidao || 0), 0)
    const totalSobreavisosCumpridos = sobreavisos.filter(sobreavisoCumprido).length
    const totalSobreavisosFaltas = sobreavisos.filter(s => s.estado === 'falta').length
    const totalAcionamentos = sobreavisos.reduce((acc, s) => acc + (s.acionamentos?.length || 0), 0)

    return {
      servidor: servidorFormatado,
      mes,
      ano,
      plantoes,
      sobreavisos,
      totalHorasPlantao,
      totalHorasPlantaoCumpridas,
      totalHorasPlantaoEmAvaliacao,
      totalHorasPlantaoFaltas,
      totalPlantoesFaltas,
      totalPlantoesEmAvaliacao,
      desfechoIndisponivel,
      totalHorasSobreaviso,
      totalHorasSobreavisoEscalado,
      totalSobreavisosCumpridos,
      totalSobreavisosFaltas,
      totalAcionamentos
    }
  } catch (error: any) {
    console.error('Erro em getDadosPlantoesSobreavisosServidor:', error)
    return { error: error.message }
  }
}

/**
 * Executa a auto-correção e realinhamento inteligente de uma folha de ponto.
 * Reordena horários invertidos, desacopla batidas de dias vizinhos e recalcula horas extras e faltas.
 */
export async function autoCorrigirFolhaPonto(folhaId: string) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    const { data: folha, error: fError } = await supabase
      .from('folha_ponto')
      .select('*, escala_mensal(id, unidade_id, setor_id, mes, ano, jornada_id, jornadas(horas_totais, nome, intervalo_minutos))')
      .eq('id', folhaId)
      .single()

    if (fError || !folha) throw new Error('Folha de ponto não encontrada.')

    if (await isCompetencyClosed(folha.mes, folha.ano)) {
      return { error: 'Esta competência está encerrada e todos os dados estão congelados para auditoria.' }
    }

    const escala = folha.escala_mensal as any
    if (escala && !hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
      return { error: 'Acesso negado para modificar esta folha de ponto.' }
    }

    const jornadaInfo = escala?.jornadas || null
    const limitesTolerancia = await obterLimitesTolerancia(supabase)
    const normalizacao = normalizarRegistrosFolha(folha.registros, folha.mes, folha.ano, jornadaInfo, limitesTolerancia)

    // Recalcular totais consolidados da folha
    const horasNormaisDiarias = jornadaInfo?.horas_totais ?? 8

    // Mesma regra de carga por dia de salvarFolhaPonto: a jornada do mes e so o padrao.
    const { data: todasJornadasAuto } = await supabase
      .from('jornadas')
      .select('nome, horas_totais')
    const cargaPorJornada = montarCargaPorJornada(todasJornadasAuto)

    let totalHorasNormais = 0
    let totalExtra50 = 0
    let totalExtra100 = 0
    let totalFaltas = 0

    normalizacao.registros.forEach((r: any) => {
      if (r.turno_codigo) {
        totalHorasNormais += horasNormaisDoDia(r, cargaPorJornada, horasNormaisDiarias)
      }
      if (isFaltaDefinitiva(r.observacao)) {
        totalFaltas++
      }
      if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
        if (r.hora_extra_tipo === '100%') {
          totalExtra100 += r.hora_extra_minutos
        } else {
          totalExtra50 += r.hora_extra_minutos
        }
      }
    })

    const { error: updError } = await supabase
      .from('folha_ponto')
      .update({
        registros: normalizacao.registros,
        total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
        total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
        total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
        total_faltas: totalFaltas,
        ultima_edicao_por_id: userProfile.id,
        ultima_edicao_em: new Date().toISOString()
      })
      .eq('id', folhaId)

    if (updError) throw updError

    revalidatePath(`/folha-ponto/${folhaId}`)
    revalidatePath('/folha-ponto')

    return {
      success: true,
      diasCorrigidos: normalizacao.diasCorrigidos,
      detalhes: normalizacao.detalhes,
      registros: normalizacao.registros
    }
  } catch (error: any) {
    console.error('Erro em autoCorrigirFolhaPonto:', error)
    return { error: error.message }
  }
}

/**
 * Executa a auto-correção em lote de todas as folhas de ponto de uma competência (ou geral).
 */
export async function autoCorrigirTodasFolhasPonto(mes?: number, ano?: number) {
  try {
    const supabase = await createClient()
    const userProfile = await getUserProfile(supabase)

    if (userProfile.role !== 'admin' && userProfile.role !== 'super_admin') {
      return { error: 'Apenas administradores podem executar a correção em lote.' }
    }

    let query = supabase
      .from('folha_ponto')
      .select('id, mes, ano, registros, escala_mensal(id, unidade_id, setor_id, mes, ano, jornada_id, jornadas(horas_totais, nome, intervalo_minutos))')

    if (mes && ano) {
      query = query.eq('mes', mes).eq('ano', ano)
    }

    const { data: folhas, error } = await query
    if (error) throw error

    // Fora do laco: a carga por jornada e a mesma para todas as folhas.
    const { data: todasJornadasLote } = await supabase
      .from('jornadas')
      .select('nome, horas_totais')
    const cargaPorJornada = montarCargaPorJornada(todasJornadasLote)
    // Fora do laço pelo mesmo motivo: a tolerância é global, não muda por folha.
    const limitesTolerancia = await obterLimitesTolerancia(supabase)

    let totalFolhasCorrigidas = 0
    let totalDiasCorrigidos = 0
    const resumoPorServidor: any[] = []

    for (const folha of (folhas || [])) {
      if (await isCompetencyClosed(folha.mes, folha.ano)) continue

      const escala = folha.escala_mensal as any
      const jornadaInfo = escala?.jornadas || null
      const normalizacao = normalizarRegistrosFolha(folha.registros, folha.mes, folha.ano, jornadaInfo, limitesTolerancia)

      if (normalizacao.diasCorrigidos > 0) {
        const horasNormaisDiarias = jornadaInfo?.horas_totais ?? 8
        let totalHorasNormais = 0
        let totalExtra50 = 0
        let totalExtra100 = 0
        let totalFaltas = 0

        normalizacao.registros.forEach((r: any) => {
          if (r.turno_codigo) totalHorasNormais += horasNormaisDoDia(r, cargaPorJornada, horasNormaisDiarias)
          if (isFaltaDefinitiva(r.observacao)) totalFaltas++
          if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
            if (r.hora_extra_tipo === '100%') totalExtra100 += r.hora_extra_minutos
            else totalExtra50 += r.hora_extra_minutos
          }
        })

        await supabase
          .from('folha_ponto')
          .update({
            registros: normalizacao.registros,
            total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
            total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
            total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
            total_faltas: totalFaltas,
            ultima_edicao_por_id: userProfile.id,
            ultima_edicao_em: new Date().toISOString()
          })
          .eq('id', folha.id)

        totalFolhasCorrigidas++
        totalDiasCorrigidos += normalizacao.diasCorrigidos
        resumoPorServidor.push({
          folhaId: folha.id,
          diasCorrigidos: normalizacao.diasCorrigidos,
          detalhes: normalizacao.detalhes
        })
      }
    }

    revalidatePath('/folha-ponto')

    return {
      success: true,
      totalFolhasCorrigidas,
      totalDiasCorrigidos,
      resumo: resumoPorServidor
    }
  } catch (error: any) {
    console.error('Erro em autoCorrigirTodasFolhasPonto:', error)
    return { error: error.message }
  }
}



