import { createClient } from '@/utils/supabase/server'
import { FileText, ArrowLeft, Printer, Search, User, MapPin, Calendar as CalendarIcon } from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'
import { ReportFiltersWrapper } from '@/app/(dashboard)/relatorios/_components/ReportFiltersWrapper'
import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'
import { ServidorSelector } from '@/app/(dashboard)/relatorios/_components/ServidorSelector'

interface Props {
  searchParams: Promise<{
    mes?: string
    ano?: string
    unidadeId?: string
    setorId?: string
    servidorId?: string
  }>
}

export default async function FrequenciaPage({ searchParams }: Props) {
  const params = await searchParams
  const mes = Number(params.mes) || new Date().getMonth() + 1
  const ano = Number(params.ano) || new Date().getFullYear()
  const unidadeId = params.unidadeId
  const setorId = params.setorId
  const servidorId = params.servidorId

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
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

  // Fetch Master Data
  const { data: unidades } = await applyAccessFilters(supabase.from('unidades').select('id, nome'), userProfile, { bypassSuperAdmin: true })
  const { data: setores } = await applyAccessFilters(supabase.from('setores').select('id, nome, unidade_id'), userProfile, { bypassSuperAdmin: true })
  
  // Fetch Servidores for selection
  let servQuery = supabase.from('servidores').select('id, nome, matricula, cargo').order('nome')
  if (unidadeId) servQuery = servQuery.eq('unidade_id', unidadeId)
  if (setorId) servQuery = servQuery.eq('setor_id', setorId)
  const { data: servidores } = await applyAccessFilters(servQuery, userProfile, { bypassSuperAdmin: true })

  // If a server is selected, fetch their data
  let scaleData: any = null
  let daysInMonth = new Date(ano, mes, 0).getDate()
  
  if (servidorId) {
    const { data } = await supabase
      .from('escala_mensal')
      .select(`
        id, status,
        servidores(nome, matricula, cargo, vinculo),
        unidades(nome, endereco),
        setores(nome),
        jornadas(nome, horas_totais),
        escala_diaria(
          dia,
          categoria,
          dicionario_turnos(codigo, descricao, horas_computadas)
        )
      `)
      .eq('servidor_id', servidorId)
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('status', 'Fechada')
      .single()
    
    scaleData = data
  }

  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ]

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 print:p-0 print:max-w-none">
      {/* Header - Hidden on Print */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-4">
          <Link href="/relatorios" className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <ArrowLeft className="h-5 w-5 text-zinc-500" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 rounded-lg text-white shadow-lg shadow-indigo-600/20">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Frequência Mensal</h1>
              <p className="text-zinc-500 text-xs">Espelho de ponto individual.</p>
            </div>
          </div>
        </div>

        {servidorId && <ReportActions showExport={false} />}
      </div>

      {/* Filters - Hidden on Print */}
      <div className="print:hidden space-y-4">
        <ReportFiltersWrapper 
          unidades={unidades || []} 
          setores={setores || []} 
          initialFilters={{ mes, ano, unidadeId, setorId }}
        />
        
        <ServidorSelector 
          servidores={servidores || []} 
          initialServidorId={servidorId} 
        />
      </div>

      {/* Report Content */}
      {scaleData ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden print:shadow-none print:border-zinc-300 print:rounded-none">
          {/* Official Header */}
          <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 print:bg-white print:border-zinc-300">
            <div className="flex justify-between items-start mb-6">
              <div className="space-y-1">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-indigo-600 print:text-black">Prefeitura Municipal</h2>
                <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase print:text-black">Espelho de Frequência Individual</h3>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black uppercase text-zinc-400">Referência</div>
                <div className="text-lg font-bold text-zinc-900 dark:text-white uppercase print:text-black">{meses[mes-1]} / {ano}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Servidor</div>
                <div className="text-xs font-bold text-zinc-900 dark:text-white uppercase">{scaleData.servidores.nome}</div>
                <div className="text-[10px] text-zinc-500">Matrícula: {scaleData.servidores.matricula || '---'}</div>
              </div>
              <div>
                <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Cargo / Vínculo</div>
                <div className="text-xs font-bold text-zinc-900 dark:text-white uppercase">{scaleData.servidores.cargo}</div>
                <div className="text-[10px] text-zinc-500">{scaleData.servidores.vinculo}</div>
              </div>
              <div>
                <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Unidade</div>
                <div className="text-xs font-bold text-zinc-900 dark:text-white uppercase">{scaleData.unidades.nome}</div>
                <div className="text-[10px] text-zinc-500 truncate">{scaleData.unidades.endereco || '---'}</div>
              </div>
              <div>
                <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Setor / Jornada</div>
                <div className="text-xs font-bold text-zinc-900 dark:text-white uppercase">{scaleData.setores.nome}</div>
                <div className="text-[10px] text-zinc-500">{scaleData.jornadas?.nome || 'Escala Especial'}</div>
              </div>
            </div>
          </div>

          {/* Mirror Table */}
          <table className="w-full text-[10px] border-collapse print:text-[9px]">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-black uppercase tracking-widest border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-700 w-12 text-center">Dia</th>
                <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-700">Entrada/Saída Programada</th>
                <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-700 text-center">Horas</th>
                <th className="px-4 py-3 border-r border-zinc-200 dark:border-zinc-700">Ocorrência / Observação</th>
                <th className="px-4 py-3 text-center w-32">Visto Servidor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1
                const shifts = scaleData.escala_diaria.filter((ed: any) => ed.dia === day)
                const date = new Date(ano, mes - 1, day)
                const isWeekend = date.getDay() === 0 || date.getDay() === 6

                return (
                  <tr key={day} className={`${isWeekend ? 'bg-zinc-50/50 dark:bg-zinc-800/20' : ''} h-8`}>
                    <td className="px-4 py-2 border-r border-zinc-200 dark:border-zinc-700 text-center font-bold text-zinc-500">
                      {day < 10 ? `0${day}` : day}
                    </td>
                    <td className="px-4 py-2 border-r border-zinc-200 dark:border-zinc-700">
                      {shifts.map((s: any, idx: number) => (
                        <div key={idx} className="flex gap-2">
                          <span className="font-bold">{s.dicionario_turnos.codigo}</span>
                          <span className="text-zinc-500">({s.categoria})</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-2 border-r border-zinc-200 dark:border-zinc-700 text-center font-bold">
                      {shifts.reduce((acc: number, curr: any) => acc + Number(curr.dicionario_turnos.horas_computadas), 0)}h
                    </td>
                    <td className="px-4 py-2 border-r border-zinc-200 dark:border-zinc-700 italic text-zinc-400 uppercase">
                      {/* Espaço para anotações manuais */}
                    </td>
                    <td className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700"></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Signatures */}
          <div className="p-12 grid grid-cols-2 gap-20 print:p-8">
            <div className="text-center space-y-2">
              <div className="border-t border-zinc-400 pt-2">
                <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white">{scaleData.servidores.nome}</div>
                <div className="text-[8px] text-zinc-500 uppercase tracking-widest">Assinatura do Servidor</div>
              </div>
            </div>
            <div className="text-center space-y-2">
              <div className="border-t border-zinc-400 pt-2">
                <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white">Coordenação / Chefia Imediata</div>
                <div className="text-[8px] text-zinc-500 uppercase tracking-widest">Carimbo e Assinatura</div>
              </div>
            </div>
          </div>
        </div>
      ) : servidorId ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-20 rounded-3xl text-center">
          <div className="flex flex-col items-center gap-4 opacity-40">
            <Search className="h-12 w-12 text-zinc-400" />
            <div className="space-y-1">
              <p className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Escala não encontrada</p>
              <p className="text-sm text-zinc-500">Não existe uma escala FECHADA para este servidor no período selecionado.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 p-20 rounded-3xl text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-indigo-100 dark:bg-indigo-900/40 rounded-full text-indigo-600">
              <Search className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Aguardando Seleção</p>
              <p className="text-sm text-zinc-500">Selecione um servidor acima para visualizar seu espelho de frequência.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
