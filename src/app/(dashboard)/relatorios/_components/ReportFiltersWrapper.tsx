'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ReportFilters } from './ReportFilters'

interface Props {
  unidades: any[]
  setores: any[]
  initialFilters: any
}

export function ReportFiltersWrapper({ unidades, setores, initialFilters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleFilterChange = (filters: any) => {
    const params = new URLSearchParams(searchParams.toString())
    
    if (filters.mes) params.set('mes', filters.mes.toString())
    if (filters.ano) params.set('ano', filters.ano.toString())
    
    if (filters.unidadeId) params.set('unidadeId', filters.unidadeId)
    else params.delete('unidadeId')
    
    if (filters.setorId) params.set('setorId', filters.setorId)
    else params.delete('setorId')

    if (filters.previsao) params.set('previsao', 'true')
    else params.delete('previsao')

    // Only push if params actually changed to avoid infinite loops or unnecessary reloads
    const currentQuery = searchParams.toString()
    const newQuery = params.toString()
    
    if (currentQuery !== newQuery) {
      router.push(`${pathname}?${newQuery}`)
    }
  }

  return (
    <ReportFilters 
      unidades={unidades} 
      setores={setores} 
      onFilterChange={handleFilterChange}
      initialFilters={initialFilters}
    />
  )
}
