import { createClient } from '@/utils/supabase/server'
import { FileSpreadsheet, Download } from 'lucide-react'

import { applyAccessFilters } from '@/utils/permissions'
import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'

export default async function RelatorioRHPage() {
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

  // Fetch consolidated data for closed scales - Filtered
  let query = supabase
    .from('escala_mensal')
    .select(`
      id, mes, ano, status,
      servidores(nome, cargo),
      unidades(nome),
      escala_diaria(dia, dicionario_turnos(codigo, horas_computadas, tipo))
    `)
    .eq('status', 'Fechada')
  
  query = applyAccessFilters(query, userProfile)
  const { data: reportData } = await query

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Relatório Consolidado (RH)</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Resumo de horas e encargos das escalas fechadas.
          </p>
        </div>
        <ReportActions 
          reportType="rh"
          title="Relatório Consolidado (RH)"
          filters={{
            'Status': 'Escalas Fechadas'
          }}
          reportData={reportData?.map((item: any) => {
            let chTotal = 0
            let sobCount = 0
            item.escala_diaria.forEach((ed: any) => {
              chTotal += Number(ed.dicionario_turnos.horas_computadas)
              if (ed.dicionario_turnos.tipo === 'Sobreaviso') sobCount++
            })
            return {
              servidor: item.servidores?.nome,
              unidade: item.unidades?.nome,
              periodo: `${item.mes}/${item.ano}`,
              chTotal,
              sobCount
            }
          })}
        />
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
            <tr>
              <th className="px-6 py-4 font-semibold">Servidor</th>
              <th className="px-6 py-4 font-semibold">Unidade</th>
              <th className="px-6 py-4 font-semibold">Período</th>
              <th className="px-6 py-4 font-semibold text-right">Total CH</th>
              <th className="px-6 py-4 font-semibold text-right">HE 50%</th>
              <th className="px-6 py-4 font-semibold text-right">HE 100%</th>
              <th className="px-6 py-4 font-semibold text-right">Sobreavisos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {reportData?.map((item: any) => {
              let chTotal = 0
              let sobCount = 0
              // Basic calculation logic
              item.escala_diaria.forEach((ed: any) => {
                chTotal += Number(ed.dicionario_turnos.horas_computadas)
                if (ed.dicionario_turnos.tipo === 'Sobreaviso') sobCount++
              })

              return (
                <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-zinc-900 dark:text-white">{item.servidores?.nome}</div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">{item.servidores?.cargo}</div>
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">{item.unidades?.nome}</td>
                  <td className="px-6 py-4">{item.mes}/{item.ano}</td>
                  <td className="px-6 py-4 text-right font-bold text-blue-600">{chTotal}h</td>
                  <td className="px-6 py-4 text-right">{(chTotal > 160 ? chTotal - 160 : 0)}h</td>
                  <td className="px-6 py-4 text-right">0h</td>
                  <td className="px-6 py-4 text-right text-orange-600 font-bold">{sobCount}</td>
                </tr>
              )
            })}
            {(!reportData || reportData.length === 0) && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-zinc-500 dark:text-zinc-400">
                  Nenhuma escala fechada para gerar relatório.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
