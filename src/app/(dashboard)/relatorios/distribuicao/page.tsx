import { createClient } from '@/utils/supabase/server'
import { PieChart, ArrowLeft, Printer, AlertTriangle, CheckCircle2, Users } from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters, type UserProfile } from '@/utils/permissions'
import { ReportFiltersWrapper } from '@/app/(dashboard)/relatorios/_components/ReportFiltersWrapper'
import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'

interface Props {
  searchParams: Promise<{
    mes?: string
    ano?: string
    unidadeId?: string
    setorId?: string
  }>
}

export default async function DistribuicaoPage({ searchParams }: Props) {
  const params = await searchParams
  const mes = Number(params.mes) || new Date().getMonth() + 1
  const ano = Number(params.ano) || new Date().getFullYear()
  const unidadeId = params.unidadeId
  const setorId = params.setorId

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user?.id)
    .single()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: (profile as any).profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: (profile as any).profile_setores?.map((ps: any) => ps.setor_id) || []
  } as UserProfile : null

  // Fetch Master Data
  const { data: unidades } = await applyAccessFilters(supabase.from('unidades').select('id, nome').eq('ativo', true), userProfile, { bypassSuperAdmin: true })
  const { data: setores } = await applyAccessFilters(supabase.from('setores').select('id, nome, unidade_id').eq('ativo', true), userProfile, { bypassSuperAdmin: true })

  // Fetch all Plantão shifts for the period
  let query = supabase
    .from('escala_diaria')
    .select(`
      dia,
      categoria,
      dicionario_turnos(codigo, horas_computadas, tipo),
      escala_mensal!inner(
        unidade_id,
        setor_id,
        status,
        servidores(nome)
      )
    `)
    .eq('escala_mensal.mes', mes)
    .eq('escala_mensal.ano', ano)
    .eq('categoria', 'Plantão')
    .eq('escala_mensal.status', 'Fechada')

  if (unidadeId) query = query.eq('escala_mensal.unidade_id', unidadeId)
  if (setorId) query = query.eq('escala_mensal.setor_id', setorId)

  // Apply access filters manually to the joined table
  query = applyAccessFilters(query, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })
  
  interface DistributionItem {
    dia: number;
    dicionario_turnos: {
      codigo: string;
      horas_computadas: number | string;
      tipo: string;
    };
  }

  const { data: rawData } = await query

  // Process data for the grid
  const daysInMonth = new Date(ano, mes, 0).getDate()
  const coverageMap: Record<number, Record<string, number>> = {}
  const uniqueTurnos = new Set<string>()

  ;(rawData as unknown as DistributionItem[])?.forEach((item) => {
    const dia = item.dia
    const turno = item.dicionario_turnos.codigo
    uniqueTurnos.add(turno)

    if (!coverageMap[dia]) coverageMap[dia] = {}
    coverageMap[dia][turno] = (coverageMap[dia][turno] || 0) + 1
  })

  const sortedTurnos = Array.from(uniqueTurnos).sort()

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/relatorios" className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <ArrowLeft className="h-5 w-5 text-zinc-500" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 rounded-lg text-white shadow-lg shadow-indigo-600/20">
              <PieChart className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Distribuição de Plantões</h1>
              <p className="text-zinc-500 text-xs">Análise de cobertura e densidade de turnos.</p>
            </div>
          </div>
        </div>

        <ReportActions 
          showExport={false} 
          reportType="distribuicao"
          title="Distribuição de Plantões"
          filters={{
            'Mês/Ano': `${mes}/${ano}`,
            'Unidade': unidades?.find((u: any) => u.id === unidadeId)?.nome || 'Todas',
            'Setor': setores?.find((s: any) => s.id === setorId)?.nome || 'Todos'
          }}
          reportData={{
            daysInMonth,
            sortedTurnos,
            coverageMap
          }}
        />
      </div>

      {/* Filters */}
      <ReportFiltersWrapper 
        unidades={unidades || []} 
        setores={setores || []} 
        initialFilters={{ mes, ano, unidadeId, setorId }}
      />

      {/* KPI Section */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-2xl">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase text-zinc-400">Total de Plantonistas</div>
              <div className="text-2xl font-black text-zinc-900 dark:text-white">{rawData?.length || 0}</div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-600 rounded-2xl">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase text-zinc-400">Média de Cobertura</div>
              <div className="text-2xl font-black text-zinc-900 dark:text-white">
                {rawData ? (rawData.length / daysInMonth).toFixed(1) : 0} <span className="text-xs text-zinc-500 font-medium">por dia</span>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-600 rounded-2xl">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase text-zinc-400">Dias com Vagas</div>
              <div className="text-2xl font-black text-zinc-900 dark:text-white">
                {Array.from({ length: daysInMonth }).filter((_, i) => !coverageMap[i+1]).length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Coverage Grid */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden">
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="font-black text-zinc-900 dark:text-white uppercase text-sm tracking-widest">Mapa de Calor de Cobertura</h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-red-100 dark:bg-red-900/30 rounded-sm"></div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase">Vazio</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-blue-100 dark:bg-blue-900/30 rounded-sm"></div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase">Parcial</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-indigo-600 rounded-sm"></div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase">Completo</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-4 py-4 text-left font-black uppercase tracking-widest text-zinc-500 text-[10px] sticky left-0 bg-zinc-50 dark:bg-zinc-800/50 z-10">Turno</th>
                {Array.from({ length: daysInMonth }, (_, i) => (
                  <th key={i} className="px-2 py-4 font-black text-[10px] text-zinc-500 border-x border-zinc-200/50 dark:border-zinc-700/30">
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTurnos.map((turno) => (
                <tr key={turno} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-3 text-left font-bold text-zinc-900 dark:text-white text-xs sticky left-0 bg-white dark:bg-zinc-900 z-10 border-r border-zinc-200 dark:border-zinc-800">
                    {turno}
                  </td>
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const dia = i + 1
                    const count = coverageMap[dia]?.[turno] || 0
                    
                    let bgColor = 'bg-red-50/50 dark:bg-red-900/5'
                    let textColor = 'text-red-400'
                    
                    if (count === 1) {
                      bgColor = 'bg-blue-50 dark:bg-blue-900/20'
                      textColor = 'text-blue-600'
                    } else if (count >= 2) {
                      bgColor = 'bg-indigo-600'
                      textColor = 'text-white'
                    }

                    return (
                      <td key={dia} className="px-1 py-1 border-x border-zinc-200/30 dark:border-zinc-700/10">
                        <div className={`w-8 h-8 mx-auto flex items-center justify-center rounded-lg text-xs font-black ${bgColor} ${textColor} transition-all`}>
                          {count > 0 ? count : ''}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {sortedTurnos.length === 0 && (
                <tr>
                  <td colSpan={daysInMonth + 1} className="py-20 text-zinc-400 uppercase text-xs font-black tracking-widest opacity-40">
                    Nenhum plantão fechado encontrado para este período
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
