import { createClient } from '@/utils/supabase/server'
import { FileSpreadsheet, Download, AlertTriangle } from 'lucide-react'
import { AcessoNegado } from '@/components/AcessoNegado'
import Link from 'next/link'

import { applyAccessFilters, type UserProfile } from '@/utils/permissions'
import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'

interface Props {
  searchParams: Promise<{
    previsao?: string
  }>
}

interface RHReportItem {
  id: string;
  servidores: { nome: string; cargo: string };
  unidades: { nome: string };
  mes: number;
  ano: number;
  escala_diaria: Array<{
    dia: number;
    categoria: string;
    dicionario_turnos: {
      codigo: string;
      horas_computadas: number | string;
      tipo: string;
    };
  }>;
  jornada_id: string;
}

export default async function RelatorioRHPage({ searchParams }: Props) {
  const params = await searchParams
  const previsao = params.previsao === 'true'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user?.id)
    .single()

  if (profile?.role === 'coordenador') {
    return <AcessoNegado />
  }

  // Fetch closed scales data for RH
  let query = supabase
    .from('escala_mensal')
    .select(`
      *,
      servidores!inner(nome, cargo),
      unidades!inner(nome),
      escala_diaria(
        dia,
        categoria,
        dicionario_turnos(codigo, horas_computadas, tipo)
      )
    `)

  if (!previsao) {
    query = query.eq('status', 'Fechada')
  }

  const { data: jornadas } = await supabase.from('jornadas').select('*')
  const { data: feriados } = await supabase.from('feriados').select('*')

  const today = new Date()
  const currentDay = today.getDate()
  const currentMonth = today.getMonth() + 1
  const currentYear = today.getFullYear()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: (profile as any).profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: (profile as any).profile_setores?.map((ps: any) => ps.setor_id) || []
  } as UserProfile : null

  query = applyAccessFilters(query, userProfile)

  const { data } = await query
  const reportData = (data || []) as RHReportItem[]

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Relatório Consolidado (RH)</h1>
            {previsao && (
              <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-amber-500 text-white rounded-md animate-pulse">
                Previsão
              </span>
            )}
          </div>
          <p className="mt-2 text-zinc-650 dark:text-zinc-400 text-sm">
            {previsao 
              ? 'Resumo de horas e encargos incluindo previsões de escalas abertas.' 
              : 'Resumo de horas e encargos das escalas fechadas.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/relatorios/rh${previsao ? '' : '?previsao=true'}`}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-500 rounded-xl text-xs font-black uppercase text-zinc-655 dark:text-zinc-400 transition-all select-none shadow-sm cursor-pointer"
          >
            <div className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${previsao ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-800'}`}>
              <div className={`bg-white w-3.5 h-3.5 rounded-full transition-transform ${previsao ? 'translate-x-3.5' : ''}`}></div>
            </div>
            <span>Incluir Previsões</span>
          </Link>
          <ReportActions 
            reportType="rh"
            title="Relatório Consolidado (RH)"
            filters={{
              'Status': previsao ? 'Previsão (Abertas + Fechadas)' : 'Escalas Fechadas'
            }}
          reportData={reportData.map((item: RHReportItem) => {
            let chTotal = 0
            let plTotal = 0
            let he50 = 0
            let he100 = 0
            let sobCount = 0

            const jornada = jornadas?.find(j => j.id === item.jornada_id)
            const intervaloHoras = (jornada?.intervalo_minutos || 0) / 60

            item.escala_diaria.forEach((ed: any) => {
              const t = ed.dicionario_turnos
              if (!t) return
              const horas = Number(t.horas_computadas || 0)
              const dia = Number(ed.dia)
              const cat = ed.categoria

              const isPast = item.ano < currentYear || (item.ano === currentYear && item.mes < currentMonth) || (item.ano === currentYear && item.mes === currentMonth && dia < currentDay)
              if (!isPast && (item.mes === currentMonth && item.ano === currentYear)) return

              if (cat === 'Regular') {
                let liquidHours = horas
                if (jornada && Number(jornada.horas_totais) > 0) {
                  const journeyMaxLiquid = Math.max(0, Number(jornada.horas_totais) - intervaloHoras)
                  liquidHours = Math.min(horas, journeyMaxLiquid)
                }
                chTotal += liquidHours
              } else if (cat === 'Extra') {
                const dateObj = new Date(item.ano, item.mes - 1, dia)
                const code = t.codigo?.toUpperCase() || ''
                const isNightShift = code.includes('N')
                const isWE = dateObj.getDay() === 0 || dateObj.getDay() === 6
                const dateStr = `${item.ano}-${item.mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`
                const isHoliday = feriados?.some(f => f.data === dateStr)

                if (isNightShift || isWE || isHoliday) he100 += horas
                else he50 += horas
              } else if (cat === 'Plantão') {
                plTotal += horas
              } else if (cat === 'Sobreaviso') {
                const code = t.codigo?.toUpperCase() || ''
                let val = Math.round(Number(t.horas_computadas || 0) / 12)
                if (val === 0) {
                  val = (code === 'MTN') ? 2 : (code === 'MT' || code === 'N' ? 1 : 0)
                }
                sobCount += val
              }
            })

            const totalGeral = chTotal + plTotal + he50 + he100 + (sobCount * 12)

            return {
              servidor: item.servidores?.nome,
              unidade: item.unidades?.nome,
              periodo: `${item.mes}/${item.ano}`,
              chTotal: `${chTotal}h`,
              he50: `${he50}h`,
              he100: `${he100}h`,
              plantao: `${plTotal}h`,
              sobreaviso: sobCount,
              total: `${totalGeral}h`
            }
          })}
        />
        </div>
      </div>

      {previsao && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 p-4 rounded-2xl flex items-center gap-3 text-amber-800 dark:text-amber-400 text-xs font-bold leading-normal">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 animate-bounce" />
          <div>
            <span className="uppercase font-black block">Aviso: Relatório de RH Preliminar</span>
            Os dados consolidados incluem escalas atualmente em aberto (planejadas). Estes valores não são definitivos e podem ser alterados antes do fechamento oficial das escalas do mês.
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
              <tr>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">Servidor</th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">Unidade</th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">Período</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">Total CH</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">Plantões</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">HE 50%</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">HE 100%</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap">Sobreavisos</th>
                <th className="px-6 py-4 font-semibold text-right whitespace-nowrap bg-zinc-100/50 dark:bg-zinc-800/50">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {reportData.map((item: RHReportItem) => {
                let chTotal = 0
                let plTotal = 0
                let he50 = 0
                let he100 = 0
                let sobCount = 0

                const jornada = jornadas?.find(j => j.id === item.jornada_id)
                const intervaloHoras = (jornada?.intervalo_minutos || 0) / 60

                item.escala_diaria.forEach((ed) => {
                  const t = ed.dicionario_turnos
                  if (!t) return
                  const horas = Number(t.horas_computadas || 0)
                  const dia = Number(ed.dia)
                  const cat = ed.categoria

                  const isPast = item.ano < currentYear || (item.ano === currentYear && item.mes < currentMonth) || (item.ano === currentYear && item.mes === currentMonth && dia < currentDay)
                  if (!isPast && (item.mes === currentMonth && item.ano === currentYear)) return

                  if (cat === 'Regular') {
                    let liquidHours = horas
                    if (jornada && Number(jornada.horas_totais) > 0) {
                      const journeyMaxLiquid = Math.max(0, Number(jornada.horas_totais) - intervaloHoras)
                      liquidHours = Math.min(horas, journeyMaxLiquid)
                    }
                    chTotal += liquidHours
                  } else if (cat === 'Extra') {
                    const dateObj = new Date(item.ano, item.mes - 1, dia)
                    const code = t.codigo?.toUpperCase() || ''
                    const isNightShift = code.includes('N')
                    const isWE = dateObj.getDay() === 0 || dateObj.getDay() === 6
                    const dateStr = `${item.ano}-${item.mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`
                    const isHoliday = feriados?.some(f => f.data === dateStr)

                    if (isNightShift || isWE || isHoliday) he100 += horas
                    else he50 += horas
                  } else if (cat === 'Plantão') {
                    plTotal += horas
                  } else if (cat === 'Sobreaviso') {
                    const code = t.codigo?.toUpperCase() || ''
                    let val = Math.round(Number(t.horas_computadas || 0) / 12)
                    if (val === 0) {
                      val = (code === 'MTN') ? 2 : (code === 'MT' || code === 'N' ? 1 : 0)
                    }
                    sobCount += val
                  }
                })

                const totalGeral = chTotal + plTotal + he50 + he100 + (sobCount * 12)

                return (
                  <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-zinc-900 dark:text-white">{item.servidores?.nome}</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">{item.servidores?.cargo}</div>
                    </td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{item.unidades?.nome}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{item.mes}/{item.ano}</td>
                    <td className="px-6 py-4 text-right font-medium text-zinc-700 dark:text-zinc-300">{chTotal}h</td>
                    <td className="px-6 py-4 text-right font-medium text-amber-600">{plTotal}h</td>
                    <td className="px-6 py-4 text-right text-indigo-600 font-medium">{he50}h</td>
                    <td className="px-6 py-4 text-right text-indigo-600 font-medium">{he100}h</td>
                    <td className="px-6 py-4 text-right text-orange-600 font-bold">{sobCount}</td>
                    <td className="px-6 py-4 text-right font-bold text-blue-600 bg-zinc-50/50 dark:bg-zinc-800/30 text-base">{totalGeral}h</td>
                  </tr>
                )
              })}
              {(!reportData || reportData.length === 0) && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-zinc-500 dark:text-zinc-400">
                    Nenhuma escala fechada para gerar relatório.
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
