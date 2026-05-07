'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, Loader2, Info, Zap, Lock, FileText, Plus, UserPlus, Users } from 'lucide-react'
import { ScalePrintView } from '@/components/ScalePrintView'
import React from 'react'

interface ScaleGridProps {
  unidadeId: string
  setorId: string
  mes: number
  ano: number
  todosServidoresSetor: any[]
  turnos: any[]
  escalaMensalInicial: any[]
  escalaDiariaInicial: any[]
  feriados: any[]
  diasInativacao: number
}

type RowCategory = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'

export function ScaleGrid({
  unidadeId,
  setorId,
  mes,
  ano,
  todosServidoresSetor,
  turnos,
  escalaMensalInicial,
  escalaDiariaInicial,
  feriados,
  diasInativacao
}: ScaleGridProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [escalaMensal, setEscalaMensal] = useState(escalaMensalInicial)
  const [triggerModal, setTriggerModal] = useState<{
    isOpen: boolean;
    servidorId: string;
    servidorNome: string;
    turnoId: string;
    escalaMensalId: string;
  } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  
  // State structured by Servidor -> Categoria -> Dia -> TurnoId
  const [gridData, setGridData] = useState<Record<string, Record<RowCategory, Record<number, string>>>>(() => {
    const initial: Record<string, Record<RowCategory, Record<number, string>>> = {}
    escalaMensalInicial.forEach(em => {
      initial[em.servidor_id] = {
        'Regular': {},
        'Extra': {},
        'Plantão': {},
        'Sobreaviso': {}
      }
      const dailies = escalaDiariaInicial.filter(ed => ed.escala_mensal_id === em.id)
      dailies.forEach(ed => {
        const cat = (ed.categoria || 'Regular') as RowCategory
        initial[em.servidor_id][cat][ed.dia] = ed.dicionario_turnos_id
      })
    })
    return initial
  })

  const daysInMonth = useMemo(() => new Date(ano, mes, 0).getDate(), [mes, ano])
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  const getDayOfWeek = (day: number) => {
    return new Date(ano, mes - 1, day).getDay()
  }

  const handleCellChange = (servidorId: string, categoria: RowCategory, day: number, turnoId: string) => {
    setGridData(prev => ({
      ...prev,
      [servidorId]: {
        ...prev[servidorId],
        [categoria]: {
          ...prev[servidorId][categoria],
          [day]: turnoId
        }
      }
    }))
  }

  const calculateTotals = (servidorId: string) => {
    const serverData = gridData[servidorId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
    
    let chTotal = 0
    let he100 = 0
    let he50 = 0
    let pl12 = 0
    let pl6 = 0
    let pl4 = 0
    let so12 = 0

    // Sum Regular CH
    Object.values(serverData['Regular']).forEach(turnoId => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) chTotal += Number(t.horas_computadas)
    })

    // Sum Extras
    Object.entries(serverData['Extra']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = new Date(ano, mes - 1, parseInt(day))
        const isWE = d.getDay() === 0 || d.getDay() === 6
        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.padStart(2, '0')}`
        const isHoliday = feriados.some(f => f.data === dateStr)

        if (isWE || isHoliday) he100 += Number(t.horas_computadas)
        else he50 += Number(t.horas_computadas)
      }
    })

    // Sum Plantões
    Object.values(serverData['Plantão']).forEach(turnoId => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        if (Number(t.horas_computadas) >= 12) pl12++
        else if (Number(t.horas_computadas) >= 6) pl6++
        else pl4++
      }
    })

    // Sum Sobreavisos
    Object.values(serverData['Sobreaviso']).forEach(turnoId => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        if (t.codigo === 'MTN') so12 += 2
        else if (t.codigo === 'MT' || t.codigo === 'N') so12++
      }
    })

    const totalGeral = chTotal + he100 + he50 + (pl12 * 12) + (pl6 * 8) + (pl4 * 4) + (so12 * 12)

    return { chTotal, he100, he50, pl12, pl6, pl4, so12, totalGeral }
  }

  const confirmTriggerSobreaviso = async () => {
    if (!triggerModal || !motivo) return

    setLoading(true)
    try {
      const { data, error } = await supabase.from('logs_sobreaviso').insert({
        servidor_id: triggerModal.servidorId,
        unidade_id: unidadeId,
        escala_mensal_id: triggerModal.escalaMensalId,
        motivo_acionamento: motivo,
        status: 'Aguardando'
      }).select('token_magic_link').single()

      if (error) throw error
      
      const link = `${window.location.origin}/sobreaviso/${data.token_magic_link}`
      setGeneratedLink(link)
    } catch (error: any) {
      console.error('Erro ao acionar sobreaviso:', error)
      alert('Erro ao acionar sobreaviso: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCloseModal = () => {
    setTriggerModal(null)
    setGeneratedLink(null)
    setMotivo('')
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      const allInserts: any[] = []
      
      escalaMensal.forEach(em => {
        const serverData = gridData[em.servidor_id]
        if (!serverData) return

        Object.entries(serverData).forEach(([categoria, days]) => {
          Object.entries(days).forEach(([day, turnoId]) => {
            if (turnoId) {
              allInserts.push({
                escala_mensal_id: em.id,
                dia: parseInt(day),
                dicionario_turnos_id: turnoId,
                categoria: categoria
              })
            }
          })
        })
      })

      const emIds = escalaMensal.map(em => em.id)
      await supabase.from('escala_diaria').delete().in('escala_mensal_id', emIds)
      
      if (allInserts.length > 0) {
        const { error } = await supabase.from('escala_diaria').insert(allInserts)
        if (error) throw error
      }
      
      alert('Escala salva com sucesso!')
    } catch (error: any) {
      alert('Erro ao salvar: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAddServer = async (servidorId: string) => {
    if (!servidorId) return
    setLoading(true)
    try {
      const servidor = todosServidoresSetor.find(s => s.id === servidorId)
      if (!servidor) return

      const { data, error } = await supabase
        .from('escala_mensal')
        .insert({
          servidor_id: servidorId,
          unidade_id: unidadeId,
          setor_id: setorId,
          mes,
          ano,
          status: 'Rascunho'
        })
        .select('*, servidores(*)')
        .single()

      if (error) throw error

      setEscalaMensal(prev => [...prev, data])
      setGridData(prev => ({
        ...prev,
        [servidorId]: {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      }))
    } catch (error: any) {
      alert('Erro ao adicionar servidor: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAddAll = async () => {
    const serversToAdd = todosServidoresSetor.filter(s => !escalaMensal.some(em => em.servidor_id === s.id))
    if (serversToAdd.length === 0) return
    
    setLoading(true)
    try {
      const newRecords = serversToAdd.map(s => ({
        servidor_id: s.id,
        unidade_id: unidadeId,
        setor_id: setorId,
        mes,
        ano,
        status: 'Rascunho'
      }))

      const { data, error } = await supabase
        .from('escala_mensal')
        .insert(newRecords)
        .select('*, servidores(*)')

      if (error) throw error

      setEscalaMensal(prev => [...prev, ...data])
      
      const newGridData = { ...gridData }
      data.forEach(em => {
        newGridData[em.servidor_id] = {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      })
      setGridData(newGridData)
    } catch (error: any) {
      alert('Erro ao adicionar todos os servidores: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCloseScale = async () => {
    const confirmClose = confirm('Deseja FECHAR esta escala?')
    if (!confirmClose) return
    setLoading(true)
    try {
      const ids = escalaMensal.map(em => em.id)
      await supabase.from('escala_mensal').update({ status: 'Fechada' }).in('id', ids)
      setEscalaMensal(prev => prev.map(em => ({ ...em, status: 'Fechada' })))
      alert('Escala fechada!')
    } catch (error: any) {
      alert('Erro: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const endOfMonth = new Date(ano, mes, 0)
  const thresholdDate = new Date(endOfMonth)
  thresholdDate.setDate(thresholdDate.getDate() + (diasInativacao || 5))
  const isAutoInactivated = new Date() > thresholdDate

  const isInactive = escalaMensal[0]?.ativo === false || isAutoInactivated
  const isClosed = escalaMensal[0]?.status === 'Fechada' || isInactive

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
      {isInactive && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-amber-700 dark:text-amber-500 text-xs font-bold uppercase tracking-tight">
          <Lock className="h-4 w-4" />
          Escala Inativa {isAutoInactivated ? '(Inativação Automática por Prazo)' : '(Inativada Manualmente)'} - Modo de Visualização Ativado
        </div>
      )}
      {/* Toolbar */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center space-x-4">
          <select 
            onChange={(e) => handleAddServer(e.target.value)}
            value=""
            disabled={loading || isClosed}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">+ Adicionar Servidor...</option>
            {todosServidoresSetor
              .filter(s => !escalaMensal.some(em => em.servidor_id === s.id))
              .map(s => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))
            }
          </select>
          <button 
            onClick={handleAddAll}
            disabled={loading || isClosed || (todosServidoresSetor.length === escalaMensal.length)}
            className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 px-3 py-2 text-sm font-medium border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
            Adicionar Todos
          </button>
        </div>
        
        <div className="flex items-center space-x-3">
          <button onClick={() => window.print()} className="inline-flex items-center rounded-md bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50">
            <FileText className="mr-2 h-4 w-4" /> Gerar PDF
          </button>
          <button onClick={handleSave} disabled={loading || isClosed} className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-all disabled:opacity-50">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar Previsão
          </button>
          {!isClosed && (
            <button onClick={handleCloseScale} disabled={loading} className="inline-flex items-center rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 shadow-sm hover:bg-black dark:hover:bg-white transition-all">
              <Lock className="mr-2 h-4 w-4" /> Fechar Escala
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto no-print">
        <table className="w-full border-collapse text-[10px] table-fixed">
          <thead className="sticky top-0 z-20 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
            <tr>
              <th className="sticky left-0 z-30 bg-zinc-100 dark:bg-zinc-800 p-2 border border-zinc-200 dark:border-zinc-700 text-left w-[180px]">Servidor</th>
              <th className="sticky left-[180px] z-30 bg-zinc-100 dark:bg-zinc-800 p-2 border border-zinc-200 dark:border-zinc-700 w-[100px]">Tipo</th>
              {daysArray.map(day => {
                const d = new Date(ano, mes - 1, day)
                const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                const isWE = d.getDay() === 0 || d.getDay() === 6
                const feriado = feriados.find(f => f.data === dateStr)
                const isHoliday = !!feriado

                return (
                  <th
                    key={day}
                    className={`p-1 border border-zinc-200 dark:border-zinc-700 min-w-[44px] w-[44px] text-center ${isHoliday ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : isWE ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`}
                    title={feriado?.descricao}
                  >
                    {day}
                    <div className="text-[8px] opacity-75">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()]}</div>
                  </th>
                )
              })}
              <th className="sticky right-[296px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">CH</th>
              <th className="sticky right-[258px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE100</th>
              <th className="sticky right-[220px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE50</th>
              <th className="sticky right-[182px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL12</th>
              <th className="sticky right-[144px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL6</th>
              <th className="sticky right-[106px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL4</th>
              <th className="sticky right-[68px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-blue-100">SO12</th>
              <th className="sticky right-0 z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[68px] bg-amber-400 text-black font-black uppercase leading-tight text-[8px] whitespace-nowrap">TOTAL<br/>H/MÊS</th>
            </tr>
          </thead>
          <tbody>
            {escalaMensal.map(em => {
              const totals = calculateTotals(em.servidor_id)
              const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']
              
              return (
                <React.Fragment key={em.id}>
                  {categories.map((cat, catIdx) => (
                    <tr key={`${em.id}-${cat}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 group">
                      {catIdx === 0 && (
                        <td rowSpan={4} className="sticky left-0 z-10 bg-white dark:bg-zinc-900 p-2 border border-zinc-200 dark:border-zinc-700 font-bold whitespace-nowrap align-top text-zinc-900 dark:text-zinc-100">
                          {em.servidores.nome}
                          <div className="text-[8px] font-normal text-zinc-600 dark:text-zinc-400 uppercase">{em.servidores.cargo}</div>
                        </td>
                      )}
                      <td className={`sticky left-[180px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 font-bold uppercase text-zinc-800 dark:text-zinc-200 ${cat === 'Extra' ? 'bg-zinc-50 dark:bg-zinc-800/50' : 'bg-white dark:bg-zinc-900'}`}>
                        {cat === 'Regular' ? '07h às 19h' : cat === 'Extra' ? 'EXTRAS' : cat === 'Plantão' ? 'PLANTÕES' : 'SOBREAVISO'}
                      </td>
                      {daysArray.map(day => {
                        const turnoId = gridData[em.servidor_id]?.[cat]?.[day] || ''
                        const turno = turnos.find(t => t.id === turnoId)
                        const d = new Date(ano, mes - 1, day)
                        const isWE = d.getDay() === 0 || d.getDay() === 6
                        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                        const isHoliday = feriados.some(f => f.data === dateStr)
                        
                        let isTriggerAllowed = false
                        if (cat === 'Sobreaviso' && turno) {
                          const now = new Date()
                          let startHour = 7
                          let endHour = 19
                          let endDayOffset = 0
                      
                          if (turno.codigo === 'N') {
                            startHour = 19
                            endHour = 7
                            endDayOffset = 1
                          } else if (turno.codigo === 'MTN') {
                            startHour = 7
                            endHour = 7
                            endDayOffset = 1
                          }
                      
                          const start = new Date(ano, mes - 1, day, startHour, 0, 0)
                          const end = new Date(ano, mes - 1, day + endDayOffset, endHour, 0, 0)
                      
                          isTriggerAllowed = now >= start && now < end
                        }

                        return (
                          <td key={day} className={`p-0 border border-zinc-200 dark:border-zinc-700 text-center relative ${isHoliday ? 'bg-red-50 dark:bg-red-900/10' : isWE ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''}`}>
                            <input
                              list={cat === 'Sobreaviso' ? "turnos-sobreaviso-list" : "turnos-list"}
                              value={turno?.codigo || ''}
                              disabled={isClosed}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase()
                                // Se for Sobreaviso, só permite MT, N ou MTN
                                if (cat === 'Sobreaviso' && val !== '' && val !== 'MT' && val !== 'N' && val !== 'MTN') {
                                  return
                                }
                                const t = turnos.find(x => x.codigo === val)
                                handleCellChange(em.servidor_id, cat, day, t?.id || '')
                              }}
                              className="w-full h-full bg-transparent border-none text-center focus:outline-none focus:ring-1 focus:ring-blue-500 font-black p-0 text-[11px] text-zinc-900 dark:text-zinc-100 uppercase"
                              placeholder="-"
                            />
                            {isTriggerAllowed && (
                              <button 
                                onClick={() => setTriggerModal({
                                  isOpen: true,
                                  servidorId: em.servidor_id,
                                  servidorNome: em.servidores?.nome || 'Servidor',
                                  turnoId: turno.id,
                                  escalaMensalId: em.id
                                })}
                                disabled={loading}
                                className="absolute -top-1 -right-1 hidden group-hover:flex h-3 w-3 items-center justify-center rounded-full bg-orange-500 text-white z-30 hover:bg-orange-600 transition-colors shadow-sm"
                                title="Acionar Sobreaviso"
                              >
                                <Zap className="h-2 w-2 fill-current" />
                              </button>
                            )}
                          </td>
                        )
                      })}
                      {catIdx === 0 && (
                        <>
                          <td rowSpan={4} className="sticky right-[296px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">{totals.chTotal}</td>
                          <td rowSpan={4} className="sticky right-[258px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">{totals.he100}</td>
                          <td rowSpan={4} className="sticky right-[220px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">{totals.he50}</td>
                          <td rowSpan={4} className="sticky right-[182px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">{totals.pl12}</td>
                          <td rowSpan={4} className="sticky right-[144px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">{totals.pl6}</td>
                          <td rowSpan={4} className="sticky right-[106px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">{totals.pl4}</td>
                          <td rowSpan={4} className="sticky right-[68px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100">{totals.so12}</td>
                          <td rowSpan={4} className="sticky right-0 z-10 p-1 border border-zinc-200 dark:border-zinc-700 text-center font-black bg-amber-400 text-black text-xs">{totals.totalGeral}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>

        <datalist id="turnos-list">
          {turnos.filter(t => t.ativo !== false).map(t => <option key={t.id} value={t.codigo}>{t.descricao}</option>)}
        </datalist>

        <datalist id="turnos-sobreaviso-list">
          {turnos.filter(t => t.ativo !== false && (t.codigo === 'MT' || t.codigo === 'N' || t.codigo === 'MTN')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>
      </div>

      {/* Actual Print View Hidden component */}
      <ScalePrintView 
        unidade={escalaMensal[0]?.unidades}
        setor={escalaMensal[0]?.setores}
        mes={mes}
        ano={ano}
        escalaMensal={escalaMensal}
        gridData={gridData} 
        turnos={turnos}
      />
      {/* Modal de Acionamento de Sobreaviso */}
      {triggerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md p-6 border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3 mb-4 text-orange-600">
              <Zap className="h-6 w-6 fill-current" />
              <h2 className="text-xl font-bold">Acionar Sobreaviso</h2>
            </div>
            
            <div className="space-y-4">
              {!generatedLink ? (
                <>
                  <div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Informações do Acionamento:</p>
                    <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg space-y-1">
                      <p className="font-bold text-zinc-900 dark:text-white">{triggerModal.servidorNome}</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 uppercase">{unidadeId} - {setorId}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-zinc-600 dark:text-zinc-400 block mb-1">Motivo do Acionamento:</label>
                    <textarea 
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      className="w-full h-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                      placeholder="Descreva o motivo do acionamento..."
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={handleCloseModal}
                      className="flex-1 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={confirmTriggerSobreaviso}
                      disabled={loading || !motivo}
                      className="flex-1 px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4 rounded-lg text-center">
                    <p className="text-emerald-700 dark:text-emerald-400 text-sm font-medium mb-1">
                      Acionamento Registrado!
                    </p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500">
                      Envie o link abaixo para o servidor confirmar o chamado.
                    </p>
                  </div>

                  <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg break-all text-[10px] font-mono text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                    {generatedLink}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(generatedLink)
                        alert('Link copiado para a área de transferência!')
                      }}
                      className="w-full px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      Copiar Link
                    </button>
                    
                    <button 
                      onClick={() => {
                        // Formatação usando Markdown do WhatsApp (* para negrito)
                        const text = encodeURIComponent(`Olá *${triggerModal.servidorNome}*, você foi acionado(a) para um chamado de Sobreaviso.\n\n*Motivo:*\n${motivo}\n\n*Para confirmar seu aceite, acesse o link abaixo:*\n${generatedLink}`)
                        window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank')
                      }}
                      className="w-full px-4 py-2 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                    >
                      Enviar via WhatsApp
                    </button>

                    <button 
                      onClick={handleCloseModal}
                      className="w-full px-4 py-2 rounded-lg text-zinc-600 dark:text-zinc-400 text-xs hover:underline"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
