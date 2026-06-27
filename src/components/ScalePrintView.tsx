'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/utils/supabase/client'

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
  servidoresEventos?: any[]
  permitirPlantaoExtra?: boolean
  destaqueServidorId?: string
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
  shiftTotals,
  servidoresEventos = [],
  permitirPlantaoExtra = false,
  destaqueServidorId
}: ScalePrintViewProps) {
  const [mounted, setMounted] = useState(false)
  const [headerLogoUrl, setHeaderLogoUrl] = useState<string>('')
  const supabase = createClient()

  useEffect(() => {
    setMounted(true)
    async function fetchHeaderLogo() {
      const { data } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'instituicao_cabecalho_url')
        .single()
      if (data?.valor) {
        setHeaderLogoUrl(data.valor)
      }
    }
    fetchHeaderLogo()
  }, [])
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

  const getActiveEventForDay = (servidorId: string, day: number) => {
    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    return servidoresEventos.find(se => 
      se.servidor_id === servidorId && 
      dateStr >= se.data_inicio && 
      dateStr <= se.data_fim
    )
  }

  // Chunk servers (escalaMensal) into pages of size 7
  const serversPerPage = 7
  const pages: any[][] = []
  for (let i = 0; i < escalaMensal.length; i += serversPerPage) {
    pages.push(escalaMensal.slice(i, i + serversPerPage))
  }
  const totalPages = pages.length

  if (!mounted) return null

  return createPortal(
    <div className="hidden print:block bg-white p-0 m-0 print-view-portal">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: landscape; margin: 0.4cm 0.4cm; }
          
          /* Hide the entire Next.js application tree during print */
          body > *:not(.print-view-portal) {
            display: none !important;
          }

          /* Reset page-level styles */
          html, body {
            height: auto !important;
            min-height: auto !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          /* Ensure the print container root is block and visible */
          .print-view-portal {
            display: block !important;
            width: 100% !important;
            position: relative !important;
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
          }

          .print-page { 
            visibility: visible !important; 
            page-break-after: always !important; 
            break-after: page !important; 
            position: relative !important; 
            width: 100% !important; 
            box-sizing: border-box !important; 
            padding: 2px !important;
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          .print-page:last-child { 
            page-break-after: avoid !important; 
            break-after: avoid !important; 
          }
          .print-page * { visibility: visible !important; }
          .print-page { color: #000; }
          table { width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 8pt; table-layout: fixed; }
          tr { page-break-inside: avoid; break-inside: avoid; }
          th, td { border: 0.5pt solid #000; padding: 2.2px 0.5px; text-align: center; line-height: 1.1; overflow: hidden; white-space: nowrap; }
          .bg-green { background-color: #f3f4f6 !important; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; font-weight: bold; }
          .bg-gray-header { background-color: #e5e7eb !important; font-weight: bold; }
          .bg-gray-cell { background-color: #f3f4f6 !important; }
          .bg-yellow { background-color: #facc15 !important; font-weight: bold; }
          .text-left { text-align: left; padding-left: 2px; }
          .font-bold { font-weight: bold; }
          .logo-area { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1.2pt solid #000; margin-bottom: 4px; }
          .event-cell { color: #fff !important; font-weight: 900 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .print-container { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .highlight-row {
            background-color: #dbeafe !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}} />

      {pages.map((pageServers, pageIdx) => (
        <div key={pageIdx} className="print-page print-container">
          {/* Logo Area */}
          <div className="logo-area">
            <div className="flex items-center gap-6">
              {/* Logo Instituição ou Fallback */}
              {headerLogoUrl ? (
                <div style={{ height: '52px', width: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img 
                    src={headerLogoUrl} 
                    alt="Logo Instituição" 
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-green-800 tracking-tighter">{unidade?.nome || 'Unidade'}</span>
                    <span className="text-[7pt] font-black uppercase tracking-wider">Prefeitura Municipal</span>
                  </div>
                  <div className="border-l-2 border-black pl-3 text-[7pt] font-bold leading-tight">
                    Secretaria<br/>Municipal de<br/>Saúde
                  </div>
                </div>
              )}

              {/* Logo da Unidade (se houver) */}
              {unidade?.logo_url && (
                <div style={{ height: '52px', width: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid #000', paddingLeft: '12px' }}>
                  <img 
                    src={unidade.logo_url} 
                    alt={`Logo ${unidade.nome}`} 
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
            </div>
            <div className="text-center">
              <span className="text-sm font-black tracking-widest block uppercase" style={{ fontSize: '11pt' }}>{setor?.nome || 'SETOR'}</span>
              <span className="text-[7pt] font-bold uppercase">{unidade?.nome || 'Unidade de Saúde'}</span>
            </div>
            <div className="text-[7pt] font-black italic uppercase">Escala de Serviço</div>
          </div>

          {/* Green/Gray Meta Bar */}
          <div className="bg-green flex justify-between px-3 py-1 text-[8.5pt]" style={{ fontSize: '8.5pt', padding: '4px 8px', marginBottom: '6px' }}>
            <div className="font-bold">{setor?.nome || 'SETOR'} — {unidade?.nome || 'UNIDADE'}</div>
            <div className="uppercase font-black tracking-wider">01 A {daysInMonth} DE {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(ano, mes - 1))} DE {ano}</div>
            <div className="flex gap-2">
              <div className="bg-white text-black px-3 font-black rounded-sm" style={{ letterSpacing: '0.05em', border: '0.5pt solid #000' }}>OFICIAL</div>
              <div className="bg-white text-black px-3 font-black rounded-sm" style={{ letterSpacing: '0.05em', border: '0.5pt solid #000' }}>PÁGINA {pageIdx + 1} DE {totalPages}</div>
            </div>
          </div>

          {/* Table */}
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
              {pageServers.map((em, idx) => {
                const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']
                const globalIdx = pageIdx * serversPerPage + idx
                const isHighlighted = em.servidor_id === destaqueServidorId
                
                return (
                  <React.Fragment key={em.id}>
                    {categories.map((cat, catIdx) => (
                      <tr key={`${em.id}-${cat}`} className={isHighlighted ? 'highlight-row' : ''}>
                        {catIdx === 0 && (
                          <>
                            <td rowSpan={4} className={isHighlighted ? 'highlight-row' : ''}>{globalIdx + 1}</td>
                            <td rowSpan={4} className={`text-left font-bold ${isHighlighted ? 'highlight-row' : ''}`} style={{ fontSize: '9.5pt' }}>
                              {em.servidores?.nome}
                              <div style={{ fontSize: '6.5pt', fontWeight: 'normal', lineHeight: '1.0' }}>{em.servidores?.cargo}</div>
                            </td>
                          </>
                        )}
                        <td className={`text-left uppercase ${isHighlighted ? 'highlight-row' : ''}`} style={{ fontSize: '6.5pt', fontWeight: 'bold' }}>
                          {cat === 'Regular' ? (em.jornadas?.nome || 'Regular') : cat === 'Extra' ? 'Extras' : cat === 'Plantão' ? 'Plantões' : 'Sobreaviso'}
                        </td>
                        {daysArray.map(day => {
                          const code = getTurnoCode(em.servidor_id, cat, day)
                          const isWE = getDayOfWeek(day) === 0 || getDayOfWeek(day) === 6
                          
                          // Check if cell is blocked by event
                          const activeEvent = getActiveEventForDay(em.servidor_id, day)
                          const currentTurnoId = gridData[em.servidor_id]?.[cat]?.[day]
                          const currentTurno = turnos.find((t: any) => t.id === currentTurnoId)
                          const currentSlots = currentTurno?.slots || []

                          const isCellBlockedByEvent = activeEvent && (cat === 'Regular' || !permitirPlantaoExtra) && (
                            !activeEvent.slots || 
                            activeEvent.slots.length === 0 || 
                            activeEvent.slots.some((s: string) => currentSlots.includes(s))
                          )

                          if (isCellBlockedByEvent) {
                            const eventAbbr = activeEvent.tipos_eventos?.nome.substring(0, 3).toUpperCase() || ''
                            return (
                              <td 
                                key={day} 
                                className="event-cell"
                                style={{ 
                                  backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444',
                                  verticalAlign: 'middle',
                                }}
                              >
                                {eventAbbr}
                              </td>
                            )
                          }

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
                            <td key={day} className={`${isWE ? 'bg-gray-cell' : ''} ${isHighlighted ? 'highlight-row' : ''}`} style={{ fontSize, fontWeight: 'bold', verticalAlign: 'middle' }}>{displayCode}</td>
                          )
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}

              {/* Table Footer: only show on the last page at the end of the scale */}
              {pageIdx === totalPages - 1 && (
                <>
                  <tr className="bg-gray-header">
                    <td rowSpan={4} colSpan={2} style={{ fontSize: '8.5pt', fontWeight: 'bold', verticalAlign: 'middle' }}>
                      SERVIDORES POR TURNO
                    </td>
                    <td style={{ fontSize: '6.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                      MANHÃ
                    </td>
                    {daysArray.map(day => (
                      <td key={day} style={{ fontSize: '8.5pt', fontWeight: 'bold' }}>
                        {shiftTotals.M[day] || ''}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-gray-header">
                    <td style={{ fontSize: '6.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                      TARDE
                    </td>
                    {daysArray.map(day => (
                      <td key={day} style={{ fontSize: '8.5pt', fontWeight: 'bold' }}>
                        {shiftTotals.T[day] || ''}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-gray-header">
                    <td style={{ fontSize: '6.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                      NOITE
                    </td>
                    {daysArray.map(day => (
                      <td key={day} style={{ fontSize: '8.5pt', fontWeight: 'bold' }}>
                        {shiftTotals.N[day] || ''}
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-gray-header">
                    <td style={{ fontSize: '6.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                      SOBREAVISO
                    </td>
                    {daysArray.map(day => (
                      <td key={day} style={{ fontSize: '8.5pt', fontWeight: 'bold' }}>
                        {shiftTotals.S[day] || ''}
                      </td>
                    ))}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>,
    document.body
  )
}
