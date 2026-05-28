'use client'

import React, { useMemo } from 'react'

interface PortalScaleGridProps {
  data: {
    escalaMensal: any[]
    escalaDiaria: any[]
    turnos: any[]
    feriados: any[]
    mes: number
    ano: number
    servidoresEventos?: any[]
    configsGlobais?: any[]
  }
  servidorId: string
}

export function PortalScaleGrid({ data, servidorId }: PortalScaleGridProps) {
  const { 
    escalaMensal, 
    escalaDiaria, 
    turnos, 
    feriados = [], 
    mes, 
    ano,
    servidoresEventos = [],
    configsGlobais = []
  } = data

  const daysInMonth = new Date(ano, mes, 0).getDate()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const gridData = useMemo(() => {
    const grid: any = {}
    escalaMensal.forEach((em: any) => {
      grid[em.servidor_id] = { Regular: {}, Extra: {}, Plantão: {}, Sobreaviso: {} }
      const dailies = escalaDiaria.filter((ed: any) => ed.escala_mensal_id === em.id)
      dailies.forEach((ed: any) => {
        const cat = ed.categoria || 'Regular'
        grid[em.servidor_id][cat][ed.dia] = ed.dicionario_turnos_id
      })
    })
    return grid
  }, [escalaMensal, escalaDiaria])

  const getActiveEventForDay = (sId: string, day: number) => {
    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    return servidoresEventos.find((se: any) => 
      se.servidor_id === sId && 
      dateStr >= se.data_inicio && 
      dateStr <= se.data_fim
    )
  }

  const configs = useMemo(() => {
    const obj: Record<string, string> = {}
    configsGlobais.forEach((c: any) => {
      obj[c.chave] = c.valor?.toString() || ''
    })
    return obj
  }, [configsGlobais])

  const permitirPlantaoExtra = configs['permitir_plantao_extra_durante_eventos'] === 'true'

  const getTurnoCode = (sId: string, cat: string, day: number) => {
    const tId = gridData[sId]?.[cat]?.[day]
    return turnos.find(t => t.id === tId)?.codigo || ''
  }

  const getDayOfWeek = (day: number) => new Date(ano, mes - 1, day).getDay()

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden no-print">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px] table-fixed">
          <thead className="bg-zinc-100 dark:bg-zinc-800">
            <tr>
              <th className="sticky left-0 z-20 bg-zinc-100 dark:bg-zinc-800 p-2 border border-zinc-200 dark:border-zinc-700 text-left w-[150px]">Servidor</th>
              <th className="p-2 border border-zinc-200 dark:border-zinc-700 w-[80px]">Tipo</th>
              {daysArray.map(day => {
                const d = getDayOfWeek(day)
                const isWE = d === 0 || d === 6
                const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                const feriado = feriados.find(f => f.data === dateStr)
                const isHoliday = !!feriado

                return (
                  <th
                    key={day}
                    className={`p-1 border border-zinc-200 dark:border-zinc-700 min-w-[32px] text-center ${
                      isHoliday ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : isWE ? 'bg-zinc-200 dark:bg-zinc-700' : ''
                    }`}
                    title={feriado?.descricao}
                  >
                    {day}
                    <div className="text-[7px] opacity-50">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d]}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {escalaMensal.map((em) => {
              const isMe = em.servidor_id === servidorId
              const categories = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']
              
              return (
                <React.Fragment key={em.id}>
                  {categories.map((cat, catIdx) => (
                    <tr 
                      key={`${em.id}-${cat}`} 
                      className={`${isMe ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'opacity-60 grayscale-[0.5]'}`}
                    >
                      {catIdx === 0 && (
                        <td 
                          rowSpan={4} 
                          className={`sticky left-0 z-10 p-2 border border-zinc-200 dark:border-zinc-700 font-bold align-top truncate ${
                            isMe ? 'bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100' : 'bg-white dark:bg-zinc-900'
                          }`}
                        >
                          {em.servidores?.nome}
                          <div className="text-[8px] font-normal opacity-70">{em.servidores?.cargo}</div>
                        </td>
                      )}
                      <td className="p-1 border border-zinc-200 dark:border-zinc-700 uppercase font-medium text-zinc-500">
                        {cat}
                      </td>
                      {daysArray.map(day => {
                        const d = getDayOfWeek(day)
                        const isWE = d === 0 || d === 6
                        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                        const feriado = feriados.find(f => f.data === dateStr)
                        const isHoliday = !!feriado

                        const activeEvent = getActiveEventForDay(em.servidor_id, day)
                        const isCellBlockedByEvent = activeEvent && (cat === 'Regular' || !permitirPlantaoExtra)

                        if (isCellBlockedByEvent) {
                          const eventAbbr = activeEvent.tipos_eventos?.nome.substring(0, 3).toUpperCase() || ''
                          return (
                            <td 
                              key={day} 
                              className="p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black text-white"
                              style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                            >
                              {eventAbbr}
                            </td>
                          )
                        }

                        return (
                          <td 
                            key={day} 
                            title={isHoliday ? `🎉 Feriado: ${feriado?.descricao}` : ''}
                            className={`p-1 border border-zinc-200 dark:border-zinc-700 text-center font-bold relative
                              ${isHoliday ? 'bg-red-50 dark:bg-red-900/10' : isWE ? 'bg-zinc-50 dark:bg-zinc-800/50' : isMe ? 'bg-blue-50/30 dark:bg-blue-900/5' : ''}
                              ${isMe ? 'text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20' : ''}`}
                          >
                            {activeEvent && (
                              <div 
                                className="absolute inset-0 pointer-events-none opacity-20"
                                style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                              />
                            )}
                            {getTurnoCode(em.servidor_id, cat, day)}
                            {activeEvent && (
                              <div 
                                className="absolute top-0.5 left-0.5 w-1 h-1 rounded-full"
                                style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                              />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
