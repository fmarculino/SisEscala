import { createClient } from '@/utils/supabase/server'
import { Activity, ArrowLeft, BarChart3, AlertTriangle, ShieldCheck, HeartPulse } from 'lucide-react'
import Link from 'next/link'
import { AcessoNegado } from '@/components/AcessoNegado'
import { applyAccessFilters, type UserProfile } from '@/utils/permissions'
import { DiagnosticsFilters } from './_components/DiagnosticsFilters'
import { DiagnosticsCharts, type MonthData, type CargoData } from './_components/DiagnosticsCharts'
import { DiagnosticsTable } from './_components/DiagnosticsTable'

interface Props {
  searchParams: Promise<{
    mesInicio?: string
    anoInicio?: string
    mesFim?: string
    anoFim?: string
    unidadeId?: string
    setorId?: string
    servidorId?: string
    cargo?: string
    regime?: string
    previsao?: string
  }>
}

export default async function PlantaoSobreavisoPage({ searchParams }: Props) {
  const params = await searchParams
  const previsao = params.previsao === 'true'
  
  const today = new Date()
  const currentMonth = today.getMonth() + 1
  const currentYear = today.getFullYear()

  const mesInicio = Number(params.mesInicio) || currentMonth
  const anoInicio = Number(params.anoInicio) || currentYear
  const mesFim = Number(params.mesFim) || currentMonth
  const anoFim = Number(params.anoFim) || currentYear

  const unidadeId = params.unidadeId || ''
  const setorId = params.setorId || ''
  const servidorId = params.servidorId || ''
  const cargo = params.cargo || ''
  const regime = params.regime || 'todos'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user?.id)
    .single()

  if (profile?.role === 'coordenador') {
    return <AcessoNegado />
  }

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: (profile as any).profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: (profile as any).profile_setores?.map((ps: any) => ps.setor_id) || []
  } as UserProfile : null

  // 1. Fetch Master Data for filters
  const { data: fetchUnidades } = await applyAccessFilters(supabase.from('unidades').select('id, nome').eq('ativo', true), userProfile, { bypassSuperAdmin: true })
  const { data: fetchSetoresRaw } = await applyAccessFilters(supabase.from('setores').select('id, unidade_id, parent_id, dicionario_setores(nome)').eq('ativo', true), userProfile, { bypassSuperAdmin: true })
  
  const unidades = fetchUnidades || []
  const setores = (fetchSetoresRaw as any[])?.map(s => {
    const dictData = Array.isArray(s.dicionario_setores) 
      ? s.dicionario_setores[0] 
      : s.dicionario_setores
    return {
      ...s,
      nome: dictData?.nome || 'SETOR SEM NOME'
    }
  }) || []

  // Fetch servidores and distinct cargos
  const { data: fetchServidores } = await supabase
    .from('servidores')
    .select('id, nome, matricula, cargo, unidade_id, setor_id')
    .eq('status', 'Ativo')
    .order('nome')

  const servidores = fetchServidores || []
  const cargos = Array.from(new Set(servidores.map(s => s.cargo).filter(Boolean) as string[])).sort()

  // 2. Fetch scales data for selected year(s)
  const yearsToFetch = Array.from(new Set([anoInicio, anoFim]))
  
  let scaleQuery = supabase
    .from('escala_mensal')
    .select(`
      id, mes, ano, status, unidade_id, setor_id, servidor_id,
      servidores(nome, matricula, cargo, vinculo),
      unidades(nome),
      setores(dicionario_setores(nome)),
      escala_diaria(
        dia,
        categoria,
        presenca_entrada_em,
        presenca_saida_em,
        presenca_confirmada,
        confirmado_por_id,
        dicionario_turnos(codigo, horas_computadas, slots)
      )
    `)
    .in('ano', yearsToFetch)
  
  if (!previsao) {
    scaleQuery = scaleQuery.eq('status', 'Fechada')
  }

  if (unidadeId) scaleQuery = scaleQuery.eq('unidade_id', unidadeId)
  if (setorId) scaleQuery = scaleQuery.eq('setor_id', setorId)
  if (servidorId) scaleQuery = scaleQuery.eq('servidor_id', servidorId)

  // Apply access filters for coordinator or admin restriction
  scaleQuery = applyAccessFilters(scaleQuery, userProfile)
  const { data: rawScales } = await scaleQuery

  // Filter range of months in JavaScript
  const startVal = anoInicio * 12 + (mesInicio - 1)
  const endVal = anoFim * 12 + (mesFim - 1)

  const filteredScales = (rawScales as any[])?.filter((em: any) => {
    const scaleVal = em.ano * 12 + (em.mes - 1)
    const matchPeriod = scaleVal >= startVal && scaleVal <= endVal
    const matchCargo = !cargo || em.servidores?.cargo === cargo
    return matchPeriod && matchCargo
  }) || []

  // 3. Fetch on-call acionamentos logs
  const scaleIds = filteredScales.map((e: any) => e.id)
  
  const { data: rawLogs } = await supabase
    .from('logs_sobreaviso')
    .select('id, escala_mensal_id, dia, status, motivo_acionamento, data_hora_chamado, data_hora_chegada')
    .in('escala_mensal_id', scaleIds.length > 0 ? scaleIds : ['00000000-0000-0000-0000-000000000000'])

  const logs = rawLogs || []

  // 4. Process Diagnostics Data per Server
  const serverMap: Record<string, any> = {}

  filteredScales.forEach((item: any) => {
    const sId = item.servidor_id
    if (!sId) return

    if (!serverMap[sId]) {
      serverMap[sId] = {
        servidorId: sId,
        nome: item.servidores?.nome || 'Servidor Desconhecido',
        matricula: item.servidores?.matricula || '',
        cargo: item.servidores?.cargo || '---',
        vinculo: item.servidores?.vinculo || '---',
        unidade: item.unidades?.nome || '---',
        setor: item.setores?.dicionario_setores?.nome || 'SETOR SEM NOME',
        plantaoHours: 0,
        sobreavisoScheduledHours: 0,
        sobreavisoActivatedHours: 0,
        fatigueAlertsCount: 0,
        alertMessages: [] as string[]
      }
    }

    const currentServer = serverMap[sId]

    // Check duplicate scales (regular shift + plantão/sobreaviso in same day)
    const regularDays = item.escala_diaria?.filter((ed: any) => ed.categoria === 'Regular').map((ed: any) => ed.dia) || []
    const plantaoDays = item.escala_diaria?.filter((ed: any) => ed.categoria === 'Plantão').map((ed: any) => ed.dia) || []
    const sobreavisoDays = item.escala_diaria?.filter((ed: any) => ed.categoria === 'Sobreaviso').map((ed: any) => ed.dia) || []

    // 1. Fatigue check: Consecutive shifts (plantões on consecutive days)
    const hasConsecutiveShifts = plantaoDays.some((d: number) => plantaoDays.includes(d + 1))
    if (hasConsecutiveShifts) {
      currentServer.fatigueAlertsCount += 1
      currentServer.alertMessages.push(`[${item.mes}/${item.ano}] Plantões em dias consecutivos`)
    }

    // 2. Fatigue check: Double shift (Regular work + Shift/On-call on same day)
    const doubleDays = regularDays.filter((d: number) => plantaoDays.includes(d) || sobreavisoDays.includes(d))
    if (doubleDays.length > 0) {
      currentServer.fatigueAlertsCount += doubleDays.length
      currentServer.alertMessages.push(`[${item.mes}/${item.ano}] ${doubleDays.length} dupla(s) jornada(s) (regular + especial) no mesmo dia`)
    }

    // Process daily entries hours
    item.escala_diaria?.forEach((ed: any) => {
      const t = ed.dicionario_turnos
      if (!t) return

      let horas = Number(t.horas_computadas || 0)
      const cat = ed.categoria

      if (cat === 'Plantão') {
        currentServer.plantaoHours += horas
      } else if (cat === 'Sobreaviso') {
        if (horas === 0) {
          horas = (t.codigo === 'MTN') ? 24 : (t.codigo === 'MT' || t.codigo === 'N' ? 12 : 0)
        }
        currentServer.sobreavisoScheduledHours += horas

        // Check if this on-call was activated in logs
        const isActivated = logs.some(l => 
          l.escala_mensal_id === item.id && 
          l.dia === ed.dia && 
          (l.status === 'Chegou' || l.status === 'Aceito')
        )
        if (isActivated) {
          currentServer.sobreavisoActivatedHours += horas
        }
      }
    })
  })

  const serverDiagnostics = Object.values(serverMap).map((s: any) => {
    const rate = s.sobreavisoScheduledHours > 0 
      ? (s.sobreavisoActivatedHours / s.sobreavisoScheduledHours) * 100 
      : 0
    
    // Total effective hours = hours worked in shift + hours worked when called in on-call
    const totalEffective = s.plantaoHours + s.sobreavisoActivatedHours

    return {
      ...s,
      activationRate: rate,
      totalEffectiveHours: totalEffective
    }
  }).sort((a, b) => b.totalEffectiveHours - a.totalEffectiveHours)

  // 5. Aggregate Monthly Trend Data for Chart
  const trendMap: Record<string, MonthData> = {}
  
  // Initialize range months
  let currentVal = startVal
  const monthsList = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ]

  while (currentVal <= endVal) {
    const y = Math.floor(currentVal / 12)
    const m = (currentVal % 12) + 1
    const key = `${y}-${m}`
    trendMap[key] = {
      monthYearLabel: `${monthsList[m - 1]}/${y.toString().substring(2)}`,
      monthVal: m,
      anoVal: y,
      plantaoHours: 0,
      sobreavisoScheduledHours: 0,
      sobreavisoActivatedHours: 0,
      overloadCount: 0
    }
    currentVal++
  }

  // Populate Monthly Trend
  filteredScales.forEach((item: any) => {
    const key = `${item.ano}-${item.mes}`
    if (!trendMap[key]) return

    const currentTrend = trendMap[key]

    item.escala_diaria?.forEach((ed: any) => {
      const t = ed.dicionario_turnos
      if (!t) return

      let horas = Number(t.horas_computadas || 0)
      const cat = ed.categoria

      if (cat === 'Plantão') {
        currentTrend.plantaoHours += horas
      } else if (cat === 'Sobreaviso') {
        if (horas === 0) {
          horas = (t.codigo === 'MTN') ? 24 : (t.codigo === 'MT' || t.codigo === 'N' ? 12 : 0)
        }
        currentTrend.sobreavisoScheduledHours += horas

        const isActivated = logs.some(l => 
          l.escala_mensal_id === item.id && 
          l.dia === ed.dia && 
          (l.status === 'Chegou' || l.status === 'Aceito')
        )
        if (isActivated) {
          currentTrend.sobreavisoActivatedHours += horas
        }
      }
    })
  })

  const monthlyTrend = Object.values(trendMap)

  // 6. Aggregate Cargo Distribution
  const cargoMap: Record<string, { cargo: string; plantaoHours: number; sobreavisoHours: number }> = {}
  
  filteredScales.forEach((item: any) => {
    const sCargo = item.servidores?.cargo || 'Outros'
    if (!cargoMap[sCargo]) {
      cargoMap[sCargo] = { cargo: sCargo, plantaoHours: 0, sobreavisoHours: 0 }
    }
    
    item.escala_diaria?.forEach((ed: any) => {
      const t = ed.dicionario_turnos
      if (!t) return

      let horas = Number(t.horas_computadas || 0)
      const cat = ed.categoria

      if (cat === 'Plantão') {
        cargoMap[sCargo].plantaoHours += horas
      } else if (cat === 'Sobreaviso') {
        if (horas === 0) {
          horas = (t.codigo === 'MTN') ? 24 : (t.codigo === 'MT' || t.codigo === 'N' ? 12 : 0)
        }
        cargoMap[sCargo].sobreavisoHours += horas
      }
    })
  })

  const cargoDistribution = Object.values(cargoMap).sort((a, b) => (b.plantaoHours + b.sobreavisoHours) - (a.plantaoHours + a.sobreavisoHours))

  // 7. Global KPIs
  const totalPlantaoHours = serverDiagnostics.reduce((acc, curr) => acc + curr.plantaoHours, 0)
  const totalSobreavisoScheduled = serverDiagnostics.reduce((acc, curr) => acc + curr.sobreavisoScheduledHours, 0)
  const totalSobreavisoActivated = serverDiagnostics.reduce((acc, curr) => acc + curr.sobreavisoActivatedHours, 0)
  const totalFatigueAlerts = serverDiagnostics.reduce((acc, curr) => acc + curr.fatigueAlertsCount, 0)
  
  // Estimated direct cost index (visual value of load)
  const estimatedCostValue = totalPlantaoHours + (totalSobreavisoScheduled - totalSobreavisoActivated) * 0.33 + totalSobreavisoActivated

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="flex items-center gap-4">
          <Link href="/relatorios" className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <ArrowLeft className="h-5 w-5 text-zinc-500" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-600/20">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Diagnóstico de Plantões & Sobreavisos</h1>
                {previsao && (
                  <span className="px-2 py-0.5 text-[9px] font-black uppercase bg-amber-500 text-white rounded-md animate-pulse">
                    Previsão
                  </span>
                )}
              </div>
              <p className="text-zinc-500 text-xs">Análise de carga horária, fadiga de pessoal e acionamentos especiais.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Panel */}
      <DiagnosticsFilters 
        unidades={unidades}
        setores={setores}
        servidores={servidores}
        cargos={cargos}
        initialFilters={{
          mesInicio,
          anoInicio,
          mesFim,
          anoFim,
          unidadeId,
          setorId,
          servidorId,
          cargo,
          regime,
          previsao
        }}
      />

      {previsao && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 p-4 rounded-2xl flex items-center gap-3 text-amber-800 dark:text-amber-400 text-xs font-bold leading-normal">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 animate-bounce" />
          <div>
            <span className="uppercase font-black block">Aviso: Relatório de Diagnóstico Prévio</span>
            Os dados mostrados incluem escalas atualmente abertas e em planejamento. Os alertas de fadiga e totalizadores são preliminares e mudam conforme as escalas são alteradas.
          </div>
        </div>
      )}

      {/* KPI Overload Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-450 rounded-2xl">
            <HeartPulse className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[9px] font-black uppercase text-zinc-400">Total de Horas Plantão</div>
            <div className="text-xl font-black text-zinc-900 dark:text-white">{totalPlantaoHours}h</div>
            <div className="text-[9.5px] text-zinc-500 mt-0.5">Executado no período</div>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-450 rounded-2xl">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[9px] font-black uppercase text-zinc-400">Sobreaviso (Escalado/Acionado)</div>
            <div className="text-xl font-black text-zinc-900 dark:text-white">
              {totalSobreavisoScheduled}h <span className="text-xs font-normal text-zinc-400">/ {totalSobreavisoActivated}h</span>
            </div>
            <div className="text-[9.5px] text-zinc-500 mt-0.5">Acionamentos efetivados</div>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm flex items-center gap-4">
          <div className={`p-3 rounded-2xl ${
            totalFatigueAlerts > 0 
              ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-450' 
              : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-450'
          }`}>
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[9px] font-black uppercase text-zinc-400">Alertas de Fadiga</div>
            <div className="text-xl font-black text-zinc-900 dark:text-white">{totalFatigueAlerts}</div>
            <div className="text-[9.5px] text-zinc-500 mt-0.5">Desvios de conformidade</div>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-450 rounded-2xl">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[9px] font-black uppercase text-zinc-400">Índice Custo/Carga</div>
            <div className="text-xl font-black text-zinc-900 dark:text-white">{Math.round(estimatedCostValue)}h</div>
            <div className="text-[9.5px] text-zinc-500 mt-0.5">Estimativa equivalente CLT</div>
          </div>
        </div>
      </div>

      {/* Visual Analytics Charts */}
      <DiagnosticsCharts 
        monthlyTrend={monthlyTrend}
        cargoDistribution={cargoDistribution}
        totalSobreavisoScheduled={totalSobreavisoScheduled}
        totalSobreavisoActivated={totalSobreavisoActivated}
        focusRegime={regime}
      />

      {/* Diagnostics Table details */}
      <DiagnosticsTable data={serverDiagnostics} />
    </div>
  )
}
