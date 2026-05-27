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
  jornadas: any[]
  shiftTotals: {
    M: Record<number, number>
    T: Record<number, number>
    N: Record<number, number>
    S: Record<number, number>
  }
}

export function ScalePrintView({ 
  unidade, 
  setor, 
  mes, 
  ano, 
  escalaMensal, 
  gridData, 
  turnos,
  jornadas,
  shiftTotals
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

  return (
    <div className="hidden print:block fixed inset-0 bg-white z-[99999] p-0 m-0">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: landscape; margin: 0.5cm; }
          body * { visibility: hidden; }
          .print-container, .print-container * { visibility: visible; color: #000 !important; }
          .print-container { position: absolute; left: 0; top: 0; width: 100%; }
          table { width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 8.5pt; table-layout: fixed; }
          th, td { border: 0.5pt solid #000; padding: 3.5px 1px; text-align: center; line-height: 1.15; overflow: hidden; white-space: nowrap; }
          .bg-green { background-color: #f3f4f6 !important; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; font-weight: bold; }
          .bg-gray-header { background-color: #e5e7eb !important; font-weight: bold; }
          .bg-gray-cell { background-color: #f3f4f6 !important; }
          .bg-yellow { background-color: #facc15 !important; font-weight: bold; }
          .text-left { text-align: left; padding-left: 2px; }
          .font-bold { font-weight: bold; }
          .logo-area { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1pt solid #000; margin-bottom: 5px; }
        }
      `}} />

      <div className="print-container p-2">
        <div className="logo-area" style={{ padding: '8px 0', marginBottom: '8px', borderBottom: '1.5pt solid #000' }}>
          <div className="flex items-center gap-4">
             <div className="flex flex-col">
               <span className="text-base font-black text-green-800 tracking-tighter">{unidade?.nome || 'Unidade'}</span>
               <span className="text-[7.5pt] font-black uppercase tracking-wider">Prefeitura Municipal</span>
             </div>
             <div className="border-l-2 border-black pl-3 text-[7.5pt] font-bold leading-tight">
               Secretaria<br/>Municipal de<br/>Saúde
             </div>
          </div>
          <div className="text-center">
            <span className="text-sm font-black tracking-widest block uppercase" style={{ fontSize: '12pt' }}>{setor?.nome || 'SETOR'}</span>
            <span className="text-[7.5pt] font-bold uppercase">{unidade?.nome || 'Unidade de Saúde'}</span>
          </div>
          <div className="text-[7.5pt] font-black italic uppercase">Escala de Serviço</div>
        </div>

        <div className="bg-green flex justify-between px-3 py-1.5 text-[9pt] mb-2" style={{ fontSize: '9pt', padding: '5px 10px', marginBottom: '8px' }}>
          <div className="font-bold">{setor?.nome || 'SETOR'} — {unidade?.nome || 'UNIDADE'}</div>
          <div className="uppercase font-black tracking-wider">01 A {daysInMonth} DE {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(ano, mes - 1))} DE {ano}</div>
          <div className="bg-white text-black px-5 font-black rounded-sm" style={{ letterSpacing: '0.05em', border: '0.5pt solid #000' }}>OFICIAL</div>
        </div>

        <table>
          <thead>
            <tr className="bg-gray-header">
              <th rowSpan={2} style={{ width: '15px' }}>Nº</th>
              <th rowSpan={2} style={{ width: '150px' }}>SERVIDOR / CARGO</th>
              <th rowSpan={2} style={{ width: '65px' }}>HORÁRIO</th>
              {daysArray.map(day => <th key={day} style={{ width: '26px' }}>{day}</th>)}
            </tr>
            <tr className="bg-gray-header">
              {daysArray.map(day => <th key={day} style={{ fontSize: '7pt' }}>{getDayLetter(day)}</th>)}
            </tr>
          </thead>
          <tbody>
            {escalaMensal.map((em, idx) => {
              const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']
              
              return (
                <React.Fragment key={em.id}>
                  {categories.map((cat, catIdx) => (
                    <tr key={`${em.id}-${cat}`}>
                      {catIdx === 0 && (
                        <>
                          <td rowSpan={4}>{idx + 1}</td>
                          <td rowSpan={4} className="text-left font-bold" style={{ fontSize: '9.5pt' }}>
                            {em.servidores?.nome}
                            <div style={{ fontSize: '6.5pt', fontWeight: 'normal' }}>{em.servidores?.cargo}</div>
                          </td>
                        </>
                      )}
                      <td className="text-left uppercase" style={{ fontSize: '6.5pt', fontWeight: 'bold' }}>
                        {cat === 'Regular' ? (em.jornadas?.nome || 'Regular') : cat === 'Extra' ? 'Extras' : cat === 'Plantão' ? 'Plantões' : 'Sobreaviso'}
                      </td>
                      {daysArray.map(day => {
                        const code = getTurnoCode(em.servidor_id, cat, day)
                        const isWE = getDayOfWeek(day) === 0 || getDayOfWeek(day) === 6
                        
                        let displayCode: React.ReactNode = code
                        if (code.length >= 3 && code.startsWith('MT')) {
                          displayCode = (
                            <>
                              <span style={{ display: 'block', lineHeight: '1' }}>MT</span>
                              <span style={{ display: 'block', lineHeight: '1' }}>{code.substring(2)}</span>
                            </>
                          )
                        } else if (code.length > 2) {
                          const mid = Math.floor(code.length / 2)
                          displayCode = (
                            <>
                              <span style={{ display: 'block', lineHeight: '1' }}>{code.substring(0, mid)}</span>
                              <span style={{ display: 'block', lineHeight: '1' }}>{code.substring(mid)}</span>
                            </>
                          )
                        }

                        const fontSize = code.length > 2 ? '7.5pt' : '9pt'
                        return (
                          <td key={day} className={isWE ? 'bg-gray-cell' : ''} style={{ fontSize, fontWeight: 'bold', verticalAlign: 'middle' }}>{displayCode}</td>
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
