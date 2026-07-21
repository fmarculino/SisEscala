import { createClient } from '@/utils/supabase/server'
import {
  Users, Building2, Calendar, ArrowRight, Clock, Phone,
  AlertTriangle, CheckCircle2, CalendarDays, BarChart3,
  ShieldCheck, FileText, Zap, UserCheck, Activity, TrendingUp
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

  // 1. Servidores count
  let serversQuery = supabase.from('servidores').select('*', { count: 'exact', head: true })
  serversQuery = applyAccessFilters(serversQuery, userProfile)

  // 2. Escalas do mês corrente
  let escalasQuery = supabase.from('escala_mensal').select(`
    id, servidor_id, unidade_id, setor_id, mes, ano, status,
    servidores(nome),
    unidades(nome),
    setores(dicionario_setores(nome))
  `).eq('mes', currentMonth).eq('ano', currentYear)
  escalasQuery = applyAccessFilters(escalasQuery, userProfile)

  // 3. Escala diária de hoje (para KPIs e sobreaviso)
  let diariaTodayQuery = supabase.from('escala_diaria').select(`
    id, dia, categoria, presenca_confirmada, presenca_entrada_em, presenca_saida_em,
    dicionario_turnos(id, codigo, horas_computadas, tipo),
    escala_mensal!inner(
      id, servidor_id, unidade_id, setor_id, mes, ano, status,
      servidores(id, nome, telefone),
      unidades(id, nome)
    )
  `).eq('dia', todayDay)
    .eq('escala_mensal.mes', currentMonth)
    .eq('escala_mensal.ano', currentYear)
  diariaTodayQuery = applyAccessFilters(diariaTodayQuery, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })

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

  // 5. Logs de sobreaviso de hoje (para status dos acionamentos)
  let sobreavisoLogsQuery = supabase.from('logs_sobreaviso').select(`
    id, servidor_id, unidade_id, escala_mensal_id, dia, status,
    data_hora_acionamento, data_hora_aceite, data_hora_chegada,
    token_magic_link, motivo_acionamento
  `).eq('dia', todayDay)
  sobreavisoLogsQuery = applyAccessFilters(sobreavisoLogsQuery, userProfile)

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
    let q = supabase.from('escala_diaria').select(`
      categoria,
      dicionario_turnos(horas_computadas),
      escala_mensal!inner(mes, ano, status, unidade_id, setor_id)
    `)
      .eq('escala_mensal.mes', m.mes)
      .eq('escala_mensal.ano', m.ano)
      .eq('escala_mensal.status', 'Fechada')
    q = applyAccessFilters(q, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })
    const { data } = await q
    return { ...m, data: data || [] }
  })

  // Execute all queries in parallel
  const [
    { count: servidoresCount },
    { data: escalasData },
    { data: diariaToday },
    { data: afastamentosData },
    { data: sobreavisoLogs },
    ...historicalResults
  ] = await Promise.all([
    serversQuery,
    escalasQuery,
    diariaTodayQuery,
    afastamentosQuery,
    sobreavisoLogsQuery,
    ...historicalPromises
  ])

  // ======================================================================
  // DATA PROCESSING
  // ======================================================================

  const escalas = (escalasData || []) as any[]
  const diaria = (diariaToday || []) as any[]
  const afastamentos = (afastamentosData || []) as any[]
  const logs = (sobreavisoLogs || []) as any[]

  // --- KPIs ---
  const totalServidores = servidoresCount || 0
  const escalasAbertas = escalas.filter((e: any) => e.status !== 'Fechada').length
  const escalasFechadas = escalas.filter((e: any) => e.status === 'Fechada').length
  const totalEscalas = new Set(escalas.map((e: any) => `${e.unidade_id}|${e.setor_id}`)).size

  // Em serviço hoje (todos escalados para turnos ativos/regulares/plantão/extra hoje, excluindo sobreaviso)
  const emServicoHoje = diaria.filter((d: any) => d.categoria !== 'Sobreaviso').length

  // Sobreaviso agendado hoje
  const sobreavisoHoje = diaria.filter((d: any) => d.categoria === 'Sobreaviso')

  // Afastamentos ativos count
  const afastamentosAtivos = afastamentos.length

  // --- SOBREAVISO PANEL DATA ---
  const sobreavisoPanel = sobreavisoHoje.map((d: any) => {
    const em = d.escala_mensal
    const servidor = em?.servidores
    const unidade = em?.unidades
    const turno = d.dicionario_turnos
    const log = logs.find((l: any) => l.servidor_id === em?.servidor_id && l.dia === todayDay)

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
      escalaMensalId: em?.id,
      servidorId: em?.servidor_id,
    }
  })

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
      {/* SECTION 1 — KPI CARDS */}
      {/* ============================================================ */}
      {!isCoord && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Servidores', value: totalServidores, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
            { label: 'Em Serviço Hoje', value: emServicoHoje, icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
            { label: 'Escalas Abertas', value: escalasAbertas, icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', sub: `de ${escalasAbertas + escalasFechadas}` },
            { label: 'Afastados Agora', value: afastamentosAtivos, icon: CalendarDays, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20' },
            { label: 'Sobreaviso Hoje', value: sobreavisoHoje.length, icon: Phone, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
            { label: 'Setores com Escala', value: totalEscalas, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
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
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{kpi.sub}</p>
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
                {sobreavisoPanel.length} servidor{sobreavisoPanel.length !== 1 ? 'es' : ''} escalado{sobreavisoPanel.length !== 1 ? 's' : ''}
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
                className="flex items-center justify-between bg-white dark:bg-zinc-900 rounded-xl p-4 border border-amber-100 dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                    <Users className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                      {item.servidorNome}
                    </p>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
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
                  {/* Status Badge */}
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    item.logStatus === 'Chegou'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : item.logStatus === 'Aceito'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : item.logStatus === 'Aguardando'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : item.logStatus === 'Recusado' || item.logStatus === 'Timeout'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    {item.logStatus === 'Chegou' && <CheckCircle2 className="h-3 w-3" />}
                    {item.logStatus === 'Aguardando' && <Clock className="h-3 w-3" />}
                    {(item.logStatus === 'Recusado' || item.logStatus === 'Timeout') && <AlertTriangle className="h-3 w-3" />}
                    {item.logStatus || 'Sem acionamento'}
                  </span>

                  {/* Action: Link to scale grid to trigger sobreaviso */}
                  <Link
                    href={`/escalas/unidade/${item.unidadeId}?setor=${item.setorId}&mes=${currentMonth}&ano=${currentYear}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm hover:shadow-md transition-all"
                    title="Ir para a escala deste servidor para acionar sobreaviso"
                  >
                    <Zap className="h-3 w-3" />
                    {item.logStatus ? 'Ver Escala' : 'Acionar'}
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
    </div>
  )
}
