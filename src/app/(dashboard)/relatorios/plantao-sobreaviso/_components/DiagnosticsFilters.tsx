'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Calendar, Building2, LayoutGrid, Users, Briefcase, FileText } from 'lucide-react'
import { formatSectorsHierarchy } from '@/utils/sectors'

interface FiltersProps {
  unidades: any[]
  setores: any[]
  servidores: any[]
  cargos: string[]
  initialFilters: {
    mesInicio: number
    anoInicio: number
    mesFim: number
    anoFim: number
    unidadeId: string
    setorId: string
    servidorId: string
    cargo: string
    regime: string
    previsao: boolean
  }
}

export function DiagnosticsFilters({ unidades, setores, servidores, cargos, initialFilters }: FiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [mesInicio, setMesInicio] = useState(initialFilters.mesInicio)
  const [anoInicio, setAnoInicio] = useState(initialFilters.anoInicio)
  const [mesFim, setMesFim] = useState(initialFilters.mesFim)
  const [anoFim, setAnoFim] = useState(initialFilters.anoFim)
  const [unidadeId, setUnidadeId] = useState(initialFilters.unidadeId)
  const [setorId, setSetorId] = useState(initialFilters.setorId)
  const [servidorId, setServidorId] = useState(initialFilters.servidorId)
  const [cargo, setCargo] = useState(initialFilters.cargo)
  const [regime, setRegime] = useState(initialFilters.regime)
  const [previsao, setPrevisao] = useState(initialFilters.previsao)

  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ]

  const anos = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

  // Trigger page update when filters change
  const applyFilters = () => {
    const params = new URLSearchParams(searchParams.toString())
    
    params.set('mesInicio', mesInicio.toString())
    params.set('anoInicio', anoInicio.toString())
    params.set('mesFim', mesFim.toString())
    params.set('anoFim', anoFim.toString())
    
    if (unidadeId) params.set('unidadeId', unidadeId)
    else params.delete('unidadeId')
    
    if (setorId) params.set('setorId', setorId)
    else params.delete('setorId')

    if (servidorId) params.set('servidorId', servidorId)
    else params.delete('servidorId')

    if (cargo) params.set('cargo', cargo)
    else params.delete('cargo')

    if (regime) params.set('regime', regime)
    else params.delete('regime')

    if (previsao) params.set('previsao', 'true')
    else params.delete('previsao')

    router.push(`${pathname}?${params.toString()}`)
  }

  // Auto-filter sectors by unidade
  const filteredSectors = formatSectorsHierarchy(
    setores.filter(s => !unidadeId || s.unidade_id === unidadeId)
  )

  // Auto-filter servers by unit and sector
  const filteredServidores = servidores.filter(s => {
    const matchUnit = !unidadeId || s.unidade_id === unidadeId
    const matchSector = !setorId || s.setor_id === setorId
    return matchUnit && matchSector
  })

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Periodo de */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Mês/Ano Inicial</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <select
                value={mesInicio}
                onChange={(e) => setMesInicio(Number(e.target.value))}
                className="w-full pl-9 pr-2 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
              >
                {meses.map((m, i) => (
                  <option key={i} value={i + 1}>{m.substring(0, 3)}</option>
                ))}
              </select>
            </div>
            <div className="relative w-20">
              <select
                value={anoInicio}
                onChange={(e) => setAnoInicio(Number(e.target.value))}
                className="w-full px-2 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
              >
                {anos.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Periodo até */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Mês/Ano Final</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <select
                value={mesFim}
                onChange={(e) => setMesFim(Number(e.target.value))}
                className="w-full pl-9 pr-2 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
              >
                {meses.map((m, i) => (
                  <option key={i} value={i + 1}>{m.substring(0, 3)}</option>
                ))}
              </select>
            </div>
            <div className="relative w-20">
              <select
                value={anoFim}
                onChange={(e) => setAnoFim(Number(e.target.value))}
                className="w-full px-2 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
              >
                {anos.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Unidade */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Unidade</label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <select
              value={unidadeId}
              onChange={(e) => {
                setUnidadeId(e.target.value)
                setSetorId('')
                setServidorId('')
              }}
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
            >
              <option value="">Todas as Unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Setor */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Setor</label>
          <div className="relative">
            <LayoutGrid className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <select
              value={setorId}
              onChange={(e) => {
                setSetorId(e.target.value)
                setServidorId('')
              }}
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
            >
              <option value="">Todos os Setores</option>
              {filteredSectors.map(s => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Cargo */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Cargo</label>
          <div className="relative">
            <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <select
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
            >
              <option value="">Todos os Cargos</option>
              {cargos.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end pt-2 border-t border-zinc-200 dark:border-zinc-800">
        {/* Servidor */}
        <div className="space-y-1.5 md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Servidor Específico</label>
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <select
                value={servidorId}
                onChange={(e) => setServidorId(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
              >
                <option value="">Todos os Servidores</option>
                {filteredServidores.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.nome} {s.matricula ? `(${s.matricula})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Regime */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Foco de Escala</label>
            <div className="relative">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <select
                value={regime}
                onChange={(e) => setRegime(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
              >
                <option value="todos">Plantões e Sobreavisos</option>
                <option value="plantoes">Apenas Plantões</option>
                <option value="sobreavisos">Apenas Sobreavisos</option>
              </select>
            </div>
          </div>

          {/* Toggle Previsao */}
          <div className="h-[42px] flex items-center">
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={previsao} 
                onChange={(e) => setPrevisao(e.target.checked)}
                className="sr-only peer" 
              />
              <div className="w-9 h-5 bg-zinc-200 dark:bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              <span className="ml-2 text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest leading-none">Incluir Previsões</span>
            </label>
          </div>
        </div>

        {/* Ação Aplicar */}
        <div>
          <button
            onClick={applyFilters}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20 cursor-pointer h-[42px]"
          >
            Aplicar Filtros e Diagnósticos
          </button>
        </div>
      </div>
    </div>
  )
}
