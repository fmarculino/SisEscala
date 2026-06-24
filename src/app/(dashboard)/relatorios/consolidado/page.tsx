import { createClient } from '@/utils/supabase/server'
import { BarChart3, Download, ArrowLeft, Printer, FileSpreadsheet } from 'lucide-react'
import Link from 'next/link'
import { AcessoNegado } from '@/components/AcessoNegado'
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

interface ProcessedConsolidatedData {
  id: string;
  servidor: string;
  matricula: string;
  cargo: string;
  vinculo: string;
  unidade: string;
  setor: string;
  regular: number;
  extra: number;
  plantao: number;
  sobreaviso: number;
  totalGeral: number;
}

export default async function ConsolidadoPage({ searchParams }: Props) {
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

  if (profile?.role === 'coordenador') {
    return <AcessoNegado />
  }

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: (profile as any).profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: (profile as any).profile_setores?.map((ps: any) => ps.setor_id) || []
  } as UserProfile : null

  // Fetch Master Data for filters
  const { data: unidades } = await applyAccessFilters(supabase.from('unidades').select('id, nome').eq('ativo', true), userProfile, { bypassSuperAdmin: true })
  const { data: setoresRaw } = await applyAccessFilters(supabase.from('setores').select('id, unidade_id, parent_id, dicionario_setores(nome)').eq('ativo', true), userProfile, { bypassSuperAdmin: true })
  const setores = (setoresRaw as any[])?.map(s => {
    const dictData = Array.isArray(s.dicionario_setores) 
      ? s.dicionario_setores[0] 
      : s.dicionario_setores
      
    return {
      ...s,
      nome: dictData?.nome || 'SETOR SEM NOME'
    }
  }) || []
  const { data: jornadas } = await supabase.from('jornadas').select('*')
  const { data: feriados } = await supabase.from('feriados').select('*')

  const today = new Date()
  const currentDay = today.getDate()
  const currentMonth = today.getMonth() + 1
  const currentYear = today.getFullYear()

  // Main Query
  let query = supabase
    .from('escala_mensal')
    .select(`
      id, mes, ano, status, jornada_id,
      servidores(nome, matricula, cargo, vinculo),
      unidades(nome),
      setores(dicionario_setores(nome)),
      escala_diaria(
        dia,
        categoria,
        dicionario_turnos(codigo, horas_computadas)
      )
    `)
    .eq('mes', mes)
    .eq('ano', ano)
    .eq('status', 'Fechada') // Usually only closed scales go to consolidation
  
  if (unidadeId) query = query.eq('unidade_id', unidadeId)
  if (setorId) query = query.eq('setor_id', setorId)

  query = applyAccessFilters(query, userProfile)
  const { data: reportData } = await query

  // Processing Data
  const processedData: ProcessedConsolidatedData[] = (reportData as any[])?.map((item: any) => {
    const totals = {
      regular: 0,
      extra: 0,
      plantao: 0,
      sobreaviso: 0
    }

    const jornada = jornadas?.find(j => j.id === item.jornada_id)
    const intervaloHoras = (jornada?.intervalo_minutos || 0) / 60

    item.escala_diaria?.forEach((ed: any) => {
      const t = ed.dicionario_turnos
      if (!t) return

      const horas = Number(t.horas_computadas || 0)
      const dia = Number(ed.dia)
      const cat = ed.categoria

      const isPast = item.ano < currentYear || (item.ano === currentYear && item.mes < currentMonth) || (item.ano === currentYear && item.mes === currentMonth && dia < currentDay)
      // For reports, we consider it validated if it's past (since scales are closed) 
      // or if it was confirmed (though presence check in reports needs more data).
      // For now, matching ScaleGrid's base logic for closed/validated:
      if (!isPast && (item.mes === currentMonth && item.ano === currentYear)) return

      if (cat === 'Regular') {
        let liquidHours = horas
        if (jornada && Number(jornada.horas_totais) > 0) {
          const journeyMaxLiquid = Math.max(0, Number(jornada.horas_totais) - intervaloHoras)
          liquidHours = Math.min(horas, journeyMaxLiquid)
        }
        totals.regular += liquidHours
      } else if (cat === 'Extra') {
        // Extras in this report are usually simplified, but let's sum them
        totals.extra += horas
      } else if (cat === 'Plantão') {
        totals.plantao += horas
      } else if (cat === 'Sobreaviso') {
        let val = Number(t.horas_computadas) || 0
        if (val === 0) {
          val = (t.codigo === 'MTN') ? 24 : (t.codigo === 'MT' || t.codigo === 'N' ? 12 : 0)
        }
        totals.sobreaviso += val
      }
    })

    return {
      id: item.id,
      servidor: item.servidores?.nome,
      matricula: item.servidores?.matricula,
      cargo: item.servidores?.cargo,
      vinculo: item.servidores?.vinculo,
      unidade: item.unidades?.nome,
      setor: item.setores?.dicionario_setores?.nome || 'SETOR SEM NOME',
      ...totals,
      totalGeral: totals.regular + totals.extra + totals.plantao + totals.sobreaviso
    }
  }) || []

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
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Consolidado de Horas</h1>
              <p className="text-zinc-500 text-xs">Resumo total de CH, HE e Sobreaviso.</p>
            </div>
          </div>
        </div>

        <ReportActions 
          reportData={processedData}
          reportType="consolidado"
          title="Consolidado de Horas"
          filters={{
            'Mês/Ano': `${mes}/${ano}`,
            'Unidade': unidades?.find((u: any) => u.id === unidadeId)?.nome || 'Todas',
            'Setor': setores?.find((s: any) => s.id === setorId)?.nome || 'Todos'
          }}
        />
      </div>

      {/* Filters */}
      <ReportFiltersWrapper 
        unidades={unidades || []} 
        setores={setores || []} 
        initialFilters={{ mes, ano, unidadeId, setorId }}
      />

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500">Servidor</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500">Unidade/Setor</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Regular</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Extra</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Plantão</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest text-zinc-500 text-center">Sobreaviso</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest text-indigo-600 text-center bg-indigo-50/30 dark:bg-indigo-900/10">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {processedData.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-zinc-900 dark:text-white uppercase text-[11px]">{item.servidor}</div>
                    <div className="text-[10px] text-zinc-500 font-medium">Mat: {item.matricula || '---'} • {item.cargo}</div>
                    <div className="mt-1 text-[9px] inline-block px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-600 uppercase font-bold">{item.vinculo}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-zinc-700 dark:text-zinc-300 font-medium">{item.unidade}</div>
                    <div className="text-[10px] text-zinc-500">{item.setor}</div>
                  </td>
                  <td className="px-6 py-4 text-center font-semibold text-zinc-700 dark:text-zinc-300">{item.regular}h</td>
                  <td className="px-6 py-4 text-center font-semibold text-zinc-700 dark:text-zinc-300">{item.extra}h</td>
                  <td className="px-6 py-4 text-center font-semibold text-zinc-700 dark:text-zinc-300">{item.plantao}h</td>
                  <td className="px-6 py-4 text-center font-semibold text-zinc-700 dark:text-zinc-300">{item.sobreaviso}h</td>
                  <td className="px-6 py-4 text-center font-black text-indigo-600 bg-indigo-50/20 dark:bg-indigo-900/5 text-sm">{item.totalGeral}h</td>
                </tr>
              ))}
              {processedData.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-2 opacity-40">
                      <BarChart3 className="h-8 w-8 text-zinc-400" />
                      <p className="text-sm font-medium text-zinc-500 uppercase tracking-widest">Nenhum dado encontrado para este período</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {processedData.length > 0 && (
              <tfoot>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-t-2 border-zinc-200 dark:border-zinc-700">
                  <td colSpan={2} className="px-6 py-4 font-black uppercase tracking-widest text-zinc-900 dark:text-white">Totais do Período</td>
                  <td className="px-6 py-4 text-center font-black text-zinc-900 dark:text-white">{processedData.reduce((acc, curr) => acc + curr.regular, 0)}h</td>
                  <td className="px-6 py-4 text-center font-black text-zinc-900 dark:text-white">{processedData.reduce((acc, curr) => acc + curr.extra, 0)}h</td>
                  <td className="px-6 py-4 text-center font-black text-zinc-900 dark:text-white">{processedData.reduce((acc, curr) => acc + curr.plantao, 0)}h</td>
                  <td className="px-6 py-4 text-center font-black text-zinc-900 dark:text-white">{processedData.reduce((acc, curr) => acc + curr.sobreaviso, 0)}h</td>
                  <td className="px-6 py-4 text-center font-black text-white bg-indigo-600">{processedData.reduce((acc, curr) => acc + curr.totalGeral, 0)}h</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
