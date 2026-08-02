import { createClient } from '@/utils/supabase/server'
import {
  Users, Building2, Calendar, ArrowRight, Clock, Phone,
  AlertTriangle, CheckCircle2, CalendarDays, BarChart3,
  ShieldCheck, FileText, Zap, UserCheck, Activity, TrendingUp, Navigation2
} from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'
import { HistoricoChart } from './_components/HistoricoChart'

export default async function DashboardHome() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user?.id)
    .single()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
  } : null

  const userRole = profile?.role || ''
  const isCoord = userRole === 'coordenador'

  // Obter data/hora atual no fuso horário de Brasília (America/Sao_Paulo)
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const todayDay = today.getDate()
  const currentMonth = today.getMonth() + 1
  const currentYear = today.getFullYear()

  // ======================================================================
  // PARALLEL DATA FETCHING
  // ======================================================================

  // 1. Servidores status list
  let serversQuery = supabase.from('servidores').select('status')
  serversQuery = applyAccessFilters(serversQuery, userProfile)

  // 2. Setores count (total possible scales)
  let sectorsQuery = supabase.from('setores').select('id', { count: 'exact', head: true }).eq('ativo', true)
  sectorsQuery = applyAccessFilters(sectorsQuery, userProfile)

  // 2b. Unidades count
  let unitsQuery = supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('ativo', true)
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })

  // 3. Escalas do mês corrente
  let escalasQuery = supabase.from('escala_mensal').select(`
    id, servidor_id, unidade_id, setor_id, mes, ano, status,
    servidores(nome),
    unidades(nome),
    setores(dicionario_setores(nome))
  `).eq('mes', currentMonth).eq('ano', currentYear)
  escalasQuery = applyAccessFilters(escalasQuery, userProfile)

  // 3. Escala diária de hoje e ontem (para capturar turnos noturnos em andamento)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayDay = yesterday.getDate()
  const yesterdayMonth = yesterday.getMonth() + 1
  const yesterdayYear = yesterday.getFullYear()

  let diariaTodayQuery = supabase.from('escala_diaria').select(`
    id, dia, categoria, presenca_confirmada, presenca_entrada_em, presenca_saida_em,
    dicionario_turnos(id, codigo, horas_computadas, tipo, slots),
    escala_mensal!inner(
      id, servidor_id, unidade_id, setor_id, mes, ano, status,
      servidores(id, nome, telefone),
      unidades(id, nome)
    )
  `).eq('dia', todayDay)
    .eq('escala_mensal.mes', currentMonth)
    .eq('escala_mensal.ano', currentYear)
  diariaTodayQuery = applyAccessFilters(diariaTodayQuery, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })

  // Query sobreaviso de ontem para verificar turnos que cruzam a meia-noite (N12, D24)
  let diariaYesterdaySobreavisoQuery = supabase.from('escala_diaria').select(`
    id, dia, categoria, presenca_confirmada, presenca_entrada_em, presenca_saida_em,
    dicionario_turnos(id, codigo, horas_computadas, tipo, slots),
    escala_mensal!inner(
      id, servidor_id, unidade_id, setor_id, mes, ano, status,
      servidores(id, nome, telefone),
      unidades(id, nome)
    )
  `).eq('dia', yesterdayDay)
    .eq('categoria', 'Sobreaviso')
    .eq('escala_mensal.mes', yesterdayMonth)
    .eq('escala_mensal.ano', yesterdayYear)
  diariaYesterdaySobreavisoQuery = applyAccessFilters(diariaYesterdaySobreavisoQuery, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })

  // 4. Afastamentos ativos
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const todayStr = `${yyyy}-${mm}-${dd}`
  let afastamentosQuery = supabase.from('servidores_eventos').select(`
    id, data_inicio, data_fim, observacao,
    servidores(id, nome, unidade_id),
    tipos_eventos(nome, cor)
  `).lte('data_inicio', todayStr).gte('data_fim', todayStr)

  // 5. Logs de sobreaviso de hoje e ontem (para status dos acionamentos)
  let sobreavisoLogsQuery = supabase.from('logs_sobreaviso').select(`
    id, servidor_id, unidade_id, escala_mensal_id, dia, status,
    data_hora_acionamento, data_hora_aceite, data_hora_chegada,
    token_magic_link, motivo_acionamento, categoria,
    escala_mensal!inner(mes, ano)
  `).eq('dia', todayDay)
    .eq('categoria', 'Sobreaviso')
    .eq('escala_mensal.mes', currentMonth)
    .eq('escala_mensal.ano', currentYear)
  sobreavisoLogsQuery = applyAccessFilters(sobreavisoLogsQuery, userProfile)

  let sobreavisoLogsYesterdayQuery = supabase.from('logs_sobreaviso').select(`
    id, servidor_id, unidade_id, escala_mensal_id, dia, status,
    data_hora_acionamento, data_hora_aceite, data_hora_chegada,
    token_magic_link, motivo_acionamento, categoria,
    escala_mensal!inner(mes, ano)
  `).eq('dia', yesterdayDay)
    .eq('categoria', 'Sobreaviso')
    .eq('escala_mensal.mes', yesterdayMonth)
    .eq('escala_mensal.ano', yesterdayYear)
  sobreavisoLogsYesterdayQuery = applyAccessFilters(sobreavisoLogsYesterdayQuery, userProfile)

  // 6. Historical data: last 3 months of escala_diaria for chart
  const months: { mes: number; ano: number; label: string }[] = []
  for (let i = 2; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1)
    months.push({
      mes: d.getMonth() + 1,
      ano: d.getFullYear(),
      label: d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')
    })
  }

  // For the chart, fetch escala_diaria for past 3 months
  const historicalPromises = months.map(async (m) => {
    const isCurrentMonth = m.mes === currentMonth && m.ano === currentYear
    let q = supabase.from('escala_diaria').select(`
      categoria,
      dicionario_turnos(horas_computadas),
      escala_mensal!inner(mes, ano, status, unidade_id, setor_id)
    `)
      .eq('escala_mensal.mes', m.mes)
      .eq('escala_mensal.ano', m.ano)
    
    // For past months, require 'Fechada' status. For current month, include real-time ongoing scales!
    if (!isCurrentMonth) {
      q = q.eq('escala_mensal.status', 'Fechada')
    }

    q = applyAccessFilters(q, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })
    const { data } = await q
    return { ...m, data: data || [] }
  })

  // Execute all queries in parallel
  const [
    { data: serversData },
    { count: setoresCount },
    { count: unidadesCount },
    { data: escalasData },
    { data: diariaToday },
    { data: diariaYesterdaySobreaviso },
    { data: afastamentosData },
    { data: sobreavisoLogsToday },
    { data: sobreavisoLogsYesterday },
    ...historicalResults
  ] = await Promise.all([
    serversQuery,
    sectorsQuery,
    unitsQuery,
    escalasQuery,
    diariaTodayQuery,
    diariaYesterdaySobreavisoQuery,
    afastamentosQuery,
    sobreavisoLogsQuery,
    sobreavisoLogsYesterdayQuery,
    ...historicalPromises
  ])

  // ======================================================================
  // DATA PROCESSING
  // ======================================================================

  const escalas = (escalasData || []) as any[]
  const diaria = (diariaToday || []) as any[]
  const diariaYesterday = (diariaYesterdaySobreaviso || []) as any[]
  const afastamentos = (afastamentosData || []) as any[]
  const logsToday = (sobreavisoLogsToday || []) as any[]
  const logsYesterday = (sobreavisoLogsYesterday || []) as any[]

  // --- KPIs ---
  const serversList = (serversData || []) as any[]
  const servidoresAtivos = serversList.filter((s: any) => s.status === 'Ativo').length
  const servidoresInativos = serversList.filter((s: any) => s.status === 'Inativo').length

  const escalasAbertas = escalas.filter((e: any) => e.status !== 'Fechada').length
  const escalasFechadas = escalas.filter((e: any) => e.status === 'Fechada').length
  const totalEscalasCriadas = new Set(escalas.map((e: any) => `${e.unidade_id}|${e.setor_id}`)).size

  // Em serviço hoje (todos escalados para turnos ativos/regulares/plantão/extra hoje, excluindo sobreaviso)
  const emServicoHoje = diaria.filter((d: any) => d.categoria !== 'Sobreaviso').length

  // Afastamentos ativos count
  const afastamentosAtivos = afastamentos.length

  // Helper para calcular a janela exata de horário de um turno de sobreaviso
  function getShiftWindow(dia: number, mes: number, ano: number, turno: any) {
    const codigo = (turno?.codigo || '').toUpperCase()
    const slots = Array.isArray(turno?.slots) ? turno.slots : []

    let startHour = 7
    let endHour = 19
    let isCrossMidnight = false

    if (codigo === 'N12' || codigo === 'SN' || (slots.length > 0 && slots[0] === 'N')) {
      startHour = 19
      endHour = 7
      isCrossMidnight = true
    } else if (codigo === 'MTNS' || codigo === 'D24' || (slots.includes('M') && slots.includes('T') && slots.includes('N'))) {
      startHour = 7
      endHour = 7
      isCrossMidnight = true
    } else if (codigo === 'M6' || codigo === 'M' || (slots.length === 1 && slots[0] === 'M')) {
      startHour = 7
      endHour = 13
    } else if (codigo === 'T6' || codigo === 'T' || (slots.length === 1 && slots[0] === 'T')) {
      startHour = 13
      endHour = 19
    } else if (codigo === 'T4') {
      startHour = 14
      endHour = 18
    } else if (codigo === 'D12' || codigo === 'SD' || (slots.includes('M') && slots.includes('T'))) {
      startHour = 7
      endHour = 19
    }

    const startTime = new Date(ano, mes - 1, dia, startHour, 0, 0)
    const endTime = new Date(ano, mes - 1, isCrossMidnight ? dia + 1 : dia, endHour, 0, 0)

    return { startTime, endTime, startHour, endHour, isCrossMidnight }
  }

  // Processar itens de sobreaviso combinando ontem e hoje
  const rawSobreavisoToday = diaria.filter((d: any) => d.categoria === 'Sobreaviso').map(d => ({ ...d, isYesterday: false }))
  const rawSobreavisoYesterday = diariaYesterday.map(d => ({ ...d, isYesterday: true }))

  const rawSobreavisoItems = [...rawSobreavisoYesterday, ...rawSobreavisoToday]

  const sobreavisoPanelAll = rawSobreavisoItems.map((d: any) => {
    const em = d.escala_mensal
    const servidor = em?.servidores
    const unidade = em?.unidades
    const turno = d.dicionario_turnos
    const serverLogs = d.isYesterday
      ? logsYesterday.filter((l: any) => l.servidor_id === em?.servidor_id && l.dia === d.dia)
      : logsToday.filter((l: any) => l.servidor_id === em?.servidor_id && l.dia === d.dia)

    const log = serverLogs[serverLogs.length - 1] || null

    const { startTime, endTime, startHour } = getShiftWindow(d.dia, em?.mes, em?.ano, turno)

    const isAtivoAgora = today >= startTime && today < endTime
    const isFuturo = today < startTime
    const isEncerrado = today >= endTime

    const startStr = `${String(startHour).padStart(2, '0')}:00`
    const timeStatusText = isAtivoAgora
      ? 'Ativo Agora'
      : isFuturo
      ? `Inicia às ${startStr}`
      : 'Encerrado'

    return {
      servidorNome: servidor?.nome || 'Desconhecido',
      servidorTelefone: servidor?.telefone || null,
      unidadeNome: unidade?.nome || 'Sem unidade',
      unidadeId: em?.unidade_id,
      setorId: em?.setor_id,
      turnoCodigo: turno?.codigo || '—',
      turnoHoras: Number(turno?.horas_computadas || 0),
      logStatus: log?.status || null,
      logId: log?.id || null,
      logToken: log?.token_magic_link || null,
      allLogs: serverLogs,
      escalaMensalId: em?.id,
      servidorId: em?.servidor_id,
      dia: d.dia,
      mes: em?.mes,
      ano: em?.ano,
      startTime,
      endTime,
      isAtivoAgora,
      isFuturo,
      isEncerrado,
      timeStatusText,
    }
  })

  // Filtrar fora os plantões de ontem que já se encerraram (ex: encerraram às 07:00 da manhã)
  const sobreavisoPanel = sobreavisoPanelAll.filter(item => !item.isEncerrado)

  // Ordenar: primeiro os ativos agora, depois os futuros organizados pelo horário de início
  sobreavisoPanel.sort((a, b) => {
    if (a.isAtivoAgora && !b.isAtivoAgora) return -1
    if (!a.isAtivoAgora && b.isAtivoAgora) return 1
    return a.startTime.getTime() - b.startTime.getTime()
  })

  const sobreavisoAtivosCount = sobreavisoPanel.filter(item => item.isAtivoAgora).length

  // --- ESCALAS STATUS GRID ---
  type EscalaStatusItem = { unidadeNome: string; setorNome: string; status: string; unidadeId: string; setorId: string }
  const escalasStatusMap = new Map<string, EscalaStatusItem[]>()
  escalas.forEach((e: any) => {
    const unidadeNome = e.unidades?.nome || 'Sem unidade'
    const setorDict = e.setores?.dicionario_setores
    const setorNome = Array.isArray(setorDict) ? setorDict[0]?.nome : setorDict?.nome || 'Sem setor'
    const key = e.unidade_id
    if (!escalasStatusMap.has(key)) {
      escalasStatusMap.set(key, [])
    }
    // Avoid duplicates (same setor)
    const existing = escalasStatusMap.get(key)!
    if (!existing.find(x => x.setorId === e.setor_id)) {
      existing.push({
        unidadeNome,
        setorNome,
        status: e.status || 'Rascunho',
        unidadeId: e.unidade_id,
        setorId: e.setor_id,
      })
    }
  })
  const escalasStatus = Array.from(escalasStatusMap.entries()).map(([unidadeId, setores]) => ({
    unidadeId,
    unidadeNome: setores[0]?.unidadeNome || 'Sem unidade',
    setores: setores.sort((a, b) => a.setorNome.localeCompare(b.setorNome))
  })).sort((a, b) => a.unidadeNome.localeCompare(b.unidadeNome))

  // --- AFASTAMENTOS ATIVOS LIST ---
  const afastamentosList = afastamentos.map((a: any) => {
    const diasRestantes = Math.ceil((new Date(a.data_fim).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return {
      servidorNome: a.servidores?.nome || 'Desconhecido',
      tipo: a.tipos_eventos?.nome || 'Outro',
      cor: a.tipos_eventos?.cor || '#71717A',
      inicio: a.data_inicio,
      fim: a.data_fim,
      diasRestantes: Math.max(diasRestantes, 0),
    }
  }).sort((a, b) => a.diasRestantes - b.diasRestantes)

  // --- HISTORICAL CHART DATA ---
  const chartData = (historicalResults as any[]).map((result: any) => {
    let regular = 0, plantao = 0, sobreaviso = 0, extra = 0
    ;(result.data || []).forEach((d: any) => {
      const horas = Number(d.dicionario_turnos?.horas_computadas || 0)
      const cat = d.categoria
      if (cat === 'Regular') regular += horas
      else if (cat === 'Plantão') plantao += horas
      else if (cat === 'Sobreaviso') sobreaviso += horas
      else if (cat === 'Extra') extra += horas
    })
    return { label: result.label, regular: Math.round(regular), plantao: Math.round(plantao), sobreaviso: Math.round(sobreaviso), extra: Math.round(extra) }
  })

  // --- QUICK ACTIONS ---
  const quickActions = [
    { name: 'Escalas', description: 'Gerencie escalas mensais', href: '/escalas', icon: Calendar, color: 'bg-green-500' },
    { name: 'Auditoria', description: 'Geolocalização e presença', href: '/auditoria', icon: ShieldCheck, color: 'bg-orange-500' },
    { name: 'Folha de Ponto', description: 'Espelho de frequência', href: '/folha-ponto', icon: FileText, color: 'bg-indigo-500' },
    { name: 'Relatórios', description: 'Análises e exportações', href: '/relatorios', icon: BarChart3, color: 'bg-cyan-500' },
    { name: 'Afastamentos', description: 'Férias e licenças', href: '/afastamentos', icon: CalendarDays, color: 'bg-rose-500', hidden: isCoord },
    { name: 'Servidores', description: 'Quadro de pessoal', href: '/servidores', icon: Users, color: 'bg-purple-500', hidden: isCoord },
  ].filter(a => !a.hidden)

  // ======================================================================
  // RENDER
  // ======================================================================

  const monthName = today.toLocaleString('pt-BR', { month: 'long' })
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white">
          Painel de Controle
        </h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400 text-sm">
          Visão operacional do SisEscala — {capitalizedMonth}/{currentYear}
        </p>
      </div>

      {/* ============================================================ */}
      {/* SECTION 6 — QUICK ACTIONS */}
      {/* ============================================================ */}
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-4 flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-blue-500" />
          Ações Rápidas
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.name}
              href={action.href}
              className="flex flex-col items-center p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-400/50 hover:shadow-md transition-all group text-center"
            >
              <div className={`h-10 w-10 rounded-lg ${action.color} flex items-center justify-center text-white mb-3 shadow-sm group-hover:scale-110 transition-transform`}>
                <action.icon className="h-5 w-5" />
              </div>
              <h3 className="text-xs font-bold text-zinc-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {action.name}
              </h3>
              <p className="text-[10px] text-zinc-400 mt-1 leading-tight">
                {action.description}
              </p>
            </Link>
          ))}
        </div>
      </div>


      {/* ============================================================ */}
      {/* SECTION 1 — KPI CARDS */}
      {/* ============================================================ */}
      {!isCoord && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Servidores', value: servidoresAtivos, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', sub: `Hoje: ${emServicoHoje} em serviço | Inativos: ${servidoresInativos}` },
            { label: 'Escalas Ativas', value: totalEscalasCriadas, icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', sub: `De ${setoresCount} setores | ${escalasFechadas} fechadas` },
            { label: 'Afastados Agora', value: afastamentosAtivos, icon: CalendarDays, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', sub: 'Ausências registradas' },
            { label: 'Sobreaviso Hoje', value: sobreavisoAtivosCount, icon: Phone, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', sub: `${sobreavisoAtivosCount} ativo(s) agora | ${sobreavisoPanel.length} total` },
            { label: 'Unidades', value: unidadesCount || 0, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', sub: 'Unidades cadastradas' },
          ].map((kpi, i) => (
            <div
              key={i}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm hover:shadow-md transition-shadow"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className={`inline-flex p-2 rounded-lg ${kpi.bg} mb-3`}>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{kpi.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mt-1">
                {kpi.label}
              </p>
              {kpi.sub && (
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-tight">{kpi.sub}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ============================================================ */}
      {/* SECTION 2 — SOBREAVISO PANEL */}
      {/* ============================================================ */}
      <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500 rounded-xl text-white shadow-lg shadow-amber-500/30">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">
                Sobreaviso Ativo Hoje
              </h2>
              <p className="text-xs text-amber-600/70 dark:text-amber-400/60">
                <span className="font-bold text-amber-800 dark:text-amber-200">{sobreavisoAtivosCount} ativo{sobreavisoAtivosCount !== 1 ? 's' : ''} agora</span> • {sobreavisoPanel.length} escalado{sobreavisoPanel.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Link
            href="/relatorios/plantao-sobreaviso"
            className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 transition-colors flex items-center gap-1"
          >
            Histórico <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {sobreavisoPanel.length === 0 ? (
          <div className="text-center py-8">
            <Phone className="h-10 w-10 text-amber-300 dark:text-amber-700 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-semibold text-amber-700/60 dark:text-amber-400/40">
              Nenhum servidor escalado para sobreaviso hoje.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sobreavisoPanel.map((item, i) => (
              <div
                key={i}
                className={`flex items-center justify-between bg-white dark:bg-zinc-900 rounded-xl p-4 border transition-all ${
                  item.isAtivoAgora
                    ? 'border-emerald-400/80 dark:border-emerald-700/80 shadow-md ring-1 ring-emerald-500/20'
                    : 'border-amber-100 dark:border-zinc-800 shadow-sm hover:shadow-md'
                }`}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    item.isAtivoAgora
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  }`}>
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                        {item.servidorNome}
                      </p>
                      {/* Real-time Time Window Badge */}
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                        item.isAtivoAgora
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                          : 'bg-amber-100/80 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      }`}>
                        {item.isAtivoAgora ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Ativo Agora
                          </>
                        ) : (
                          <>
                            <Clock className="h-2.5 w-2.5" />
                            {item.timeStatusText}
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> {item.unidadeNome}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {item.turnoCodigo} ({item.turnoHoras}h)
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Badge de Múltiplos Acionamentos (se houver mais de 1 no dia) */}
                  {item.allLogs && item.allLogs.length > 1 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800" title={`${item.allLogs.length} chamados registrados para este servidor no mesmo dia`}>
                      ⚡ {item.allLogs.length} Chamados
                    </span>
                  )}

                  {/* Log Status Badge (se acionado) */}
                  {item.logStatus && (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      item.logStatus === 'Aceito'
                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30 animate-pulse'
                        : item.logStatus === 'Chegou'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                        : item.logStatus === 'Aguardando'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                        : item.logStatus === 'Recusado' || item.logStatus === 'Timeout'
                        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800'
                        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}>
                      {item.logStatus === 'Aceito' && <Navigation2 className="h-3 w-3 fill-current" />}
                      {item.logStatus === 'Chegou' && <CheckCircle2 className="h-3 w-3" />}
                      {item.logStatus === 'Aguardando' && <Clock className="h-3 w-3" />}
                      {(item.logStatus === 'Recusado' || item.logStatus === 'Timeout') && <AlertTriangle className="h-3 w-3" />}
                      {item.logStatus === 'Aceito' ? 'Em Deslocamento' : item.logStatus === 'Chegou' ? 'No Local' : item.logStatus}
                    </span>
                  )}

                  {/* Action: Link to scale grid to trigger sobreaviso */}
                  <Link
                    href={`/escalas/unidade/${item.unidadeId}?setor=${item.setorId}&mes=${item.mes}&ano=${item.ano}`}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm hover:shadow-md transition-all ${
                      item.isAtivoAgora
                        ? 'bg-amber-500 hover:bg-amber-600 text-white'
                        : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300'
                    }`}
                    title="Ir para a escala deste servidor para acionar sobreaviso"
                  >
                    <Zap className="h-3 w-3" />
                    {item.logStatus ? 'Ver Escala' : item.isAtivoAgora ? 'Acionar' : 'Ver Escala'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* SECTION 3 & 4 — ESCALAS STATUS + AFASTAMENTOS (Side by Side) */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Escalas Status Grid */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg text-white">
                <Calendar className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Escalas de {capitalizedMonth}
              </h3>
            </div>
            <Link href="/escalas" className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 dark:text-blue-400 flex items-center gap-1">
              Ver todas <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {escalasStatus.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-10 w-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-3 opacity-50" />
              <p className="text-sm text-zinc-400">Nenhuma escala encontrada este mês.</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
              {escalasStatus.map((unidade) => (
                <div key={unidade.unidadeId}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-2">
                    {unidade.unidadeNome}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unidade.setores.map((setor) => (
                      <Link
                        key={setor.setorId}
                        href={`/escalas/unidade/${unidade.unidadeId}?setor=${setor.setorId}&mes=${currentMonth}&ano=${currentYear}`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all hover:shadow-sm ${
                          setor.status === 'Fechada'
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        {setor.status === 'Fechada' ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {setor.setorNome}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Afastamentos Ativos */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-500 rounded-lg text-white">
                <CalendarDays className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Afastamentos Ativos
              </h3>
            </div>
            <Link href="/afastamentos" className="text-[10px] font-bold uppercase tracking-widest text-rose-600 hover:text-rose-800 dark:text-rose-400 flex items-center gap-1">
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {afastamentosList.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-emerald-300 dark:text-emerald-700 mx-auto mb-3 opacity-50" />
              <p className="text-sm text-zinc-400">Nenhum servidor afastado no momento.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {afastamentosList.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-2 h-8 rounded-full flex-shrink-0"
                      style={{ backgroundColor: a.cor }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{a.servidorNome}</p>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {a.tipo} • {new Date(a.inicio + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - {new Date(a.fim + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-md ${
                    a.diasRestantes <= 2
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    {a.diasRestantes === 0 ? 'Último dia' : `${a.diasRestantes}d restantes`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* SECTION 5 — HISTORICAL CHART */}
      {/* ============================================================ */}
      {chartData.length > 0 && (
        <HistoricoChart data={chartData} />
      )}

    </div>
  )
}
