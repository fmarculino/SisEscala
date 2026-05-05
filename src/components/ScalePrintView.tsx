'use client'

import React from 'react'

type RowCategory = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'

interface ScalePrintViewProps {
  unidade: any
  setor: any
  mes: number
  ano: number
  escalaMensal: any[]
  gridData: Record<string, Record<RowCategory, Record<number, string>>>
  turnos: any[]
}

export function ScalePrintView({ 
  unidade, 
  setor, 
  mes, 
  ano, 
  escalaMensal, 
  gridData, 
  turnos 
}: ScalePrintViewProps) {
  const daysInMonth = new Date(ano, mes, 0).getDate()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  
  const getDayOfWeek = (day: number) => {
    return new Date(ano, mes - 1, day).getDay()
  }

  const getDayLetter = (day: number) => {
    const d = getDayOfWeek(day)
    return ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d]
  }

  const getTurnoCode = (servidorId: string, categoria: RowCategory, day: number) => {
    const turnoId = gridData[servidorId]?.[categoria]?.[day]
    return turnos.find(t => t.id === turnoId)?.codigo || ''
  }

  const calculateServerTotals = (servidorId: string) => {
    const serverData = gridData[servidorId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
    
    let chTotal = 0
    let he100 = 0
    let he50 = 0
    let pl12 = 0
    let pl6 = 0
    let pl4 = 0
    let so12 = 0

    Object.values(serverData['Regular']).forEach(id => {
      const t = turnos.find(x => x.id === id)
      if (t) chTotal += Number(t.horas_computadas)
    })

    Object.values(serverData['Extra']).forEach(id => {
      const t = turnos.find(x => x.id === id)
      if (t) {
        if (Number(t.horas_computadas) >= 12) he100 += Number(t.horas_computadas)
        else he50 += Number(t.horas_computadas)
      }
    })

    Object.values(serverData['Plantão']).forEach(id => {
      const t = turnos.find(x => x.id === id)
      if (t) {
        if (Number(t.horas_computadas) >= 12) pl12++
        else if (Number(t.horas_computadas) >= 6) pl6++
        else pl4++
      }
    })

    Object.values(serverData['Sobreaviso']).forEach(id => {
      const t = turnos.find(x => x.id === id)
      if (t) {
        const horas = Number(t.horas_computadas)
        if (horas >= 24) so12 += 2
        else if (horas >= 12) so12 += 1
        else so12 += 1
      }
    })

    const totalGeral = chTotal + he100 + he50 + (pl12 * 12) + (pl6 * 8) + (pl4 * 4) + (so12 * 12)

    return { chTotal, he100, he50, pl12, pl6, pl4, so12, totalGeral }
  }

  return (
    <div className="hidden print:block fixed inset-0 bg-white z-[99999] p-0 m-0">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: landscape; margin: 0.5cm; }
          body * { visibility: hidden; }
          .print-container, .print-container * { visibility: visible; }
          .print-container { position: absolute; left: 0; top: 0; width: 100%; }
          table { width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 5.5pt; table-layout: fixed; }
          th, td { border: 0.5pt solid #000; padding: 1px; text-align: center; line-height: 1.1; overflow: hidden; white-space: nowrap; }
          .bg-green { background-color: #166534 !important; color: white !important; font-weight: bold; }
          .bg-gray-header { background-color: #e5e7eb !important; font-weight: bold; }
          .bg-gray-cell { background-color: #f3f4f6 !important; }
          .bg-yellow { background-color: #facc15 !important; font-weight: bold; }
          .text-left { text-align: left; padding-left: 2px; }
          .font-bold { font-weight: bold; }
          .logo-area { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1pt solid #000; margin-bottom: 5px; }
        }
      `}} />

      <div className="print-container p-2">
        <div className="logo-area">
          <div className="flex items-center gap-4">
             <div className="flex flex-col">
               <span className="text-sm font-black text-green-800 tracking-tighter">Marabá</span>
               <span className="text-[5pt] font-bold uppercase">Prefeitura</span>
             </div>
             <div className="border-l border-black pl-2 text-[5pt] font-medium leading-tight">
               Secretaria<br/>Municipal de<br/>Saúde
             </div>
          </div>
          <div className="text-center">
            <span className="text-xs font-black tracking-widest block">HMM</span>
            <span className="text-[5pt] font-medium uppercase">Hospital Municipal de Marabá</span>
          </div>
          <div className="text-[5pt] italic text-zinc-400">Escala de Serviço</div>
        </div>

        <div className="bg-green flex justify-between px-2 py-1 text-[7pt] mb-1">
          <div>{setor?.nome || 'SETOR'} - {unidade?.nome || 'UNIDADE'}</div>
          <div className="uppercase">01 A {daysInMonth} DE {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(ano, mes - 1))} DE {ano}</div>
          <div className="bg-white text-black px-4 font-black">OFICIAL</div>
        </div>

        <table>
          <thead>
            <tr className="bg-gray-header">
              <th rowSpan={2} style={{ width: '15px' }}>Nº</th>
              <th rowSpan={2} style={{ width: '150px' }}>SERVIDOR / CARGO</th>
              <th rowSpan={2} style={{ width: '70px' }}>HORÁRIO</th>
              {daysArray.map(day => <th key={day} style={{ width: '18px' }}>{day}</th>)}
              <th rowSpan={2} style={{ width: '22px' }}>CH</th>
              <th rowSpan={2} style={{ width: '22px' }}>H100</th>
              <th rowSpan={2} style={{ width: '22px' }}>H50</th>
              <th rowSpan={2} style={{ width: '22px' }}>P12</th>
              <th rowSpan={2} style={{ width: '22px' }}>P6</th>
              <th rowSpan={2} style={{ width: '22px' }}>P4</th>
              <th rowSpan={2} style={{ width: '22px' }}>S12</th>
              <th rowSpan={2} style={{ width: '35px' }} className="bg-yellow">TOTAL</th>
            </tr>
            <tr className="bg-gray-header">
              {daysArray.map(day => <th key={day} style={{ fontSize: '4pt' }}>{getDayLetter(day)}</th>)}
            </tr>
          </thead>
          <tbody>
            {escalaMensal.map((em, idx) => {
              const totals = calculateServerTotals(em.servidor_id)
              const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']
              
              return (
                <React.Fragment key={em.id}>
                  {categories.map((cat, catIdx) => (
                    <tr key={`${em.id}-${cat}`}>
                      {catIdx === 0 && (
                        <>
                          <td rowSpan={4}>{idx + 1}</td>
                          <td rowSpan={4} className="text-left font-bold" style={{ fontSize: '6pt' }}>
                            {em.servidores?.nome}
                            <div style={{ fontSize: '4pt', fontWeight: 'normal' }}>{em.servidores?.cargo}</div>
                          </td>
                        </>
                      )}
                      <td className="text-left uppercase" style={{ fontSize: '4pt' }}>
                        {cat === 'Regular' ? '07h às 19h' : cat === 'Extra' ? 'Extras' : cat === 'Plantão' ? 'Plantões' : 'Sobreaviso'}
                      </td>
                      {daysArray.map(day => {
                        const code = getTurnoCode(em.servidor_id, cat, day)
                        const isWE = getDayOfWeek(day) === 0 || getDayOfWeek(day) === 6
                        return (
                          <td key={day} className={isWE ? 'bg-gray-cell' : ''} style={{ fontSize: '5pt', fontWeight: 'bold' }}>{code}</td>
                        )
                      })}
                      {catIdx === 0 && (
                        <>
                          <td rowSpan={4} className="font-bold">{totals.chTotal}</td>
                          <td rowSpan={4} className="font-bold">{totals.he100}</td>
                          <td rowSpan={4} className="font-bold">{totals.he50}</td>
                          <td rowSpan={4} className="font-bold">{totals.pl12}</td>
                          <td rowSpan={4} className="font-bold">{totals.pl6}</td>
                          <td rowSpan={4} className="font-bold">{totals.pl4}</td>
                          <td rowSpan={4} className="font-bold">{totals.so12}</td>
                          <td rowSpan={4} className="bg-yellow font-black" style={{ fontSize: '6pt' }}>{totals.totalGeral}</td>
                        </>
                      )}
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
