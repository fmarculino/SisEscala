'use client'

import { useState, useMemo } from 'react'
import { EditServidorForm } from './EditServidorForm'
import { StatusToggle } from '@/components/servidores/StatusToggle'
import { Info, History, User, Calendar, FileText, ArrowRight, Clock, MapPin, CheckCircle, ExternalLink, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { createJornadaTemporaria, deleteJornadaTemporaria } from '../actions'

interface ServidorDetalhesClientProps {
  id: string
  servidor: any
  unidades: any[]
  setores: any[]
  cargos: any[]
  isSuperAdmin: boolean
  historico: any[]
  escalas: any[]
  folhas: any[]
  jornadas: any[]
  jornadasTemporarias: any[]
}

export function ServidorDetalhesClient({
  id,
  servidor,
  unidades,
  setores,
  cargos,
  isSuperAdmin,
  historico,
  escalas,
  folhas,
  jornadas,
  jornadasTemporarias
}: ServidorDetalhesClientProps) {
  const [activeTab, setActiveTab] = useState<'cadastro' | 'historico' | 'jornadas_temporarias'>('cadastro')
  
  // State for temporary journey form
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedJornada, setSelectedJornada] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [motivo, setMotivo] = useState('')

  // Helper: Format Portuguese month and year
  const getMesAnoFormatado = (mes: number, ano: number) => {
    const data = new Date(ano, mes - 1, 1)
    return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  }

  // Helper: Calculate duration between two dates in months/days
  const calculateDuration = (startDateStr: string, endDateStr: string) => {
    const start = new Date(startDateStr)
    const end = new Date(endDateStr)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return ''

    // Difference in days
    const diffTime = Math.abs(end.getTime() - start.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 30) {
      return `${diffDays} ${diffDays === 1 ? 'dia' : 'dias'}`
    }

    const months = Math.floor(diffDays / 30)
    const remainingDays = diffDays % 30

    if (remainingDays === 0) {
      return `${months} ${months === 1 ? 'mês' : 'meses'}`
    }

    return `${months} ${months === 1 ? 'mês' : 'meses'} e ${remainingDays} ${remainingDays === 1 ? 'dia' : 'dias'}`
  }

  // Construct periods of allocations
  const periods = useMemo(() => {
    const list: any[] = []

    // Sort transfer history by date ascending
    const sortedHist = [...historico].sort((a, b) => 
      new Date(a.data_transferencia).getTime() - new Date(b.data_transferencia).getTime()
    )

    // Current date for current period calculations
    const todayStr = new Date().toISOString().split('T')[0]

    // 1. Current allocation
    const currentUnidade = unidades.find(u => u.id === servidor.unidade_id)?.nome || 'Sem Unidade'
    const currentSetor = setores.find(s => s.id === servidor.setor_id)?.nome || 'Sem Setor'
    
    const lastTransfer = sortedHist[sortedHist.length - 1]
    const currentStartDate = lastTransfer ? lastTransfer.data_transferencia : null

    list.push({
      isCurrent: true,
      unidade_id: servidor.unidade_id,
      setor_id: servidor.setor_id,
      unidade_nome: currentUnidade,
      setor_nome: currentSetor,
      startDate: currentStartDate,
      endDate: todayStr,
      durationText: currentStartDate ? calculateDuration(currentStartDate, todayStr) : 'Todo o período',
      motivo: lastTransfer ? lastTransfer.motivo : 'Lotação inicial'
    })

    // 2. Build historical periods backwards
    for (let i = sortedHist.length - 1; i >= 0; i--) {
      const currentH = sortedHist[i]
      const prevH = sortedHist[i - 1]

      const startDate = prevH ? prevH.data_transferencia : null
      const endDate = currentH.data_transferencia

      list.push({
        isCurrent: false,
        unidade_id: currentH.unidade_origem_id,
        setor_id: currentH.setor_origem_id,
        unidade_nome: currentH.unidade_origem_nome || 'Sem Unidade',
        setor_nome: currentH.setor_origem_nome || 'Sem Setor',
        startDate,
        endDate,
        durationText: startDate ? calculateDuration(startDate, endDate) : '',
        motivo: prevH ? prevH.motivo : 'Lotação inicial'
      })
    }

    return list
  }, [historico, servidor, unidades, setores])

  // Group scales under periods
  const periodsWithData = useMemo(() => {
    return periods.map(p => {
      const periodScales = escalas.filter(esc => {
        // Must match location
        const locMatch = esc.unidade_id === p.unidade_id && esc.setor_id === p.setor_id
        if (!locMatch) return false

        // If no start date, it means it is the oldest period, so match all scales up to end date
        const scaleComparable = esc.ano * 12 + esc.mes

        let startMatch = true
        if (p.startDate) {
          const startDateParts = p.startDate.split('-')
          const startComp = parseInt(startDateParts[0]) * 12 + parseInt(startDateParts[1])
          startMatch = scaleComparable >= startComp
        }

        let endMatch = true
        if (p.endDate && !p.isCurrent) {
          const endDateParts = p.endDate.split('-')
          const endComp = parseInt(endDateParts[0]) * 12 + parseInt(endDateParts[1])
          endMatch = scaleComparable <= endComp
        }

        return startMatch && endMatch
      })

      // Link timesheets to scales
      const scalesWithFolhas = periodScales.map(esc => {
        const folha = folhas.find(f => f.escala_mensal_id === esc.id)
        return {
          ...esc,
          folha_id: folha?.id || null,
          folha_status: folha?.status || null
        }
      })

      return {
        ...p,
        escalas: scalesWithFolhas
      }
    })
  }, [periods, escalas, folhas])

  // Count active months and unique sectors
  const totalSectores = useMemo(() => {
    const set = new Set<string>()
    periods.forEach(p => {
      if (p.setor_id) set.add(p.setor_id)
    })
    return set.size
  }, [periods])

  const handleAddJornadaTemporaria = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setLoading(true)

    if (!selectedJornada || !dataInicio || !dataFim) {
      setFormError('Preencha todos os campos obrigatórios.')
      setLoading(false)
      return
    }

    if (new Date(dataInicio) > new Date(dataFim)) {
      setFormError('A data de início não pode ser posterior à data de término.')
      setLoading(false)
      return
    }

    const res = await createJornadaTemporaria(id, selectedJornada, dataInicio, dataFim, motivo)
    if (res.error) {
      setFormError(res.error)
    } else {
      // Clear form
      setSelectedJornada('')
      setDataInicio('')
      setDataFim('')
      setMotivo('')
    }
    setLoading(false)
  }

  const handleDeleteJornada = async (journeyId: string) => {
    if (!confirm('Deseja realmente remover esta alteração temporária? Isso restaurará o horário padrão para este período.')) {
      return
    }
    const res = await deleteJornadaTemporaria(journeyId, id)
    if (res.error) {
      alert(`Erro ao remover: ${res.error}`)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header and Status Toggle */}
      <div className="flex items-center justify-between print:hidden">
        <Link
          href="/servidores"
          className="flex items-center text-sm font-bold text-zinc-500 dark:text-zinc-400 hover:text-blue-600 transition-colors"
        >
          <ArrowRight className="mr-2 h-4 w-4 rotate-180" />
          Voltar para Servidores
        </Link>
        <StatusToggle 
          servidorId={id} 
          currentStatus={servidor.status} 
          nome={servidor.nome} 
        />
      </div>

      {/* Tabs list */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800 print:hidden">
        <button
          onClick={() => setActiveTab('cadastro')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-sm transition-all ${
            activeTab === 'cadastro'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:hover:text-zinc-300'
          }`}
        >
          <User className="h-4 w-4" />
          Cadastro do Servidor
        </button>
        <button
          onClick={() => setActiveTab('jornadas_temporarias')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-sm transition-all ${
            activeTab === 'jornadas_temporarias'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:hover:text-zinc-300'
          }`}
        >
          <Clock className="h-4 w-4" />
          Jornadas Temporárias
        </button>
        <button
          onClick={() => setActiveTab('historico')}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-sm transition-all ${
            activeTab === 'historico'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:hover:text-zinc-300'
          }`}
        >
          <History className="h-4 w-4" />
          Histórico & Relatórios
        </button>
      </div>

      {/* Tab Contents */}
      <div className="space-y-6">
        {activeTab === 'cadastro' && (
          <div className="space-y-6">
            {servidor.status === 'Inativo' && (
              <div className="bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900/40 p-4 rounded-xl flex gap-3 animate-in fade-in">
                <Info className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-800 dark:text-red-300">Servidor Inativo</p>
                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                    <strong>Motivo da Inativação:</strong> {servidor.motivo_inativacao || 'Não informado'}
                  </p>
                </div>
              </div>
            )}

            <EditServidorForm 
              id={id}
              servidor={servidor}
              unidades={unidades}
              setores={setores}
              cargos={cargos}
              isSuperAdmin={isSuperAdmin}
            />
          </div>
        )}

        {activeTab === 'jornadas_temporarias' && (
          <div className="space-y-8 animate-in fade-in">
            {/* Create temporary journey form */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-2xl shadow-sm space-y-6">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <Plus className="h-5 w-5 text-blue-500" />
                Cadastrar Jornada Temporária (Alteração por Período)
              </h2>

              <form onSubmit={handleAddJornadaTemporaria} className="space-y-4">
                {formError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900/40 text-red-800 dark:text-red-300 text-xs rounded-xl font-semibold">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Jornada Temporária *</label>
                    <select
                      value={selectedJornada}
                      onChange={(e) => setSelectedJornada(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      required
                    >
                      <option value="">Selecione a Jornada...</option>
                      {jornadas.map(j => (
                        <option key={j.id} value={j.id}>{j.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Data Inicial *</label>
                    <input
                      type="date"
                      value={dataInicio}
                      onChange={(e) => setDataInicio(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Data Final *</label>
                    <input
                      type="date"
                      value={dataFim}
                      onChange={(e) => setDataFim(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Motivo / Observação</label>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    rows={2}
                    placeholder="Ex: Acordo operacional de troca de turno temporário..."
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold rounded-xl transition-all shadow-md text-sm cursor-pointer"
                  >
                    {loading ? 'Salvando...' : 'Salvar Alteração'}
                  </button>
                </div>
              </form>
            </div>

            {/* List of active temporary journeys */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-2xl shadow-sm space-y-6">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-500" />
                Histórico de Alterações de Horário por Período
              </h2>

              {jornadasTemporarias.length === 0 ? (
                <p className="text-sm text-zinc-400 italic">Nenhuma jornada temporária cadastrada para este servidor.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-left text-sm text-zinc-500 dark:text-zinc-400">
                    <thead className="text-xs text-zinc-700 uppercase bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 font-bold border-b border-zinc-200 dark:border-zinc-800">
                      <tr>
                        <th scope="col" className="px-6 py-3">Jornada</th>
                        <th scope="col" className="px-6 py-3">Período</th>
                        <th scope="col" className="px-6 py-3">Duração</th>
                        <th scope="col" className="px-6 py-3">Motivo</th>
                        <th scope="col" className="px-6 py-3 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {jornadasTemporarias.map((jt) => (
                        <tr key={jt.id} className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-950/40">
                          <td className="px-6 py-4 font-bold text-zinc-900 dark:text-white">
                            {jt.jornadas?.nome || 'Jornada Excluída'}
                          </td>
                          <td className="px-6 py-4 text-xs font-semibold">
                            De {new Date(jt.data_inicio).toLocaleDateString('pt-BR')} até {new Date(jt.data_fim).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="px-6 py-4 text-xs">
                            {calculateDuration(jt.data_inicio, jt.data_fim)}
                          </td>
                          <td className="px-6 py-4 text-xs italic">
                            {jt.motivo || '-'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleDeleteJornada(jt.id)}
                              className="p-2 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-100 rounded-lg transition-colors border border-red-100/30"
                              title="Remover jornada temporária"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'historico' && (
          <div className="space-y-8 animate-in fade-in">
            {/* KPI Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm flex items-center gap-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 rounded-xl">
                  <MapPin className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Locais de Trabalho</p>
                  <p className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{totalSectores} {totalSectores === 1 ? 'setor' : 'setores'}</p>
                </div>
              </div>

              <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm flex items-center gap-4">
                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 rounded-xl">
                  <Calendar className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Escalas Realizadas</p>
                  <p className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{escalas.length} {escalas.length === 1 ? 'mês' : 'meses'}</p>
                </div>
              </div>

              <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm flex items-center gap-4">
                <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 rounded-xl">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Folhas Geradas</p>
                  <p className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{folhas.length} {folhas.length === 1 ? 'folha' : 'folhas'}</p>
                </div>
              </div>
            </div>

            {/* Timeline of Allocations */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-2xl shadow-sm space-y-6">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <History className="h-5 w-5 text-blue-500" />
                Linha do Tempo de Lotações
              </h2>

              <div className="relative pl-6 border-l-2 border-zinc-200 dark:border-zinc-800 ml-4 space-y-10">
                {periodsWithData.map((p, idx) => (
                  <div key={idx} className="relative">
                    {/* Node marker */}
                    <span className={`absolute -left-[31px] top-1.5 flex items-center justify-center w-4 h-4 rounded-full border-2 ${
                      p.isCurrent 
                        ? 'bg-green-500 border-green-500 dark:bg-green-400 dark:border-green-400 ring-4 ring-green-100 dark:ring-green-950/50' 
                        : 'bg-zinc-200 border-zinc-300 dark:bg-zinc-800 dark:border-zinc-700'
                    }`} />

                    <div className="space-y-3">
                      {/* Period Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-extrabold text-zinc-950 dark:text-white">{p.setor_nome}</h3>
                            {p.isCurrent && (
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400 text-[10px] font-bold uppercase rounded-md">
                                Atual
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" />
                            {p.unidade_nome}
                          </p>
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <p className="text-xs font-bold text-zinc-800 dark:text-zinc-300">
                            {p.startDate ? (
                              <>De {new Date(p.startDate).toLocaleDateString('pt-BR')} até {p.isCurrent ? 'o momento' : new Date(p.endDate).toLocaleDateString('pt-BR')}</>
                            ) : (
                              <>Até {new Date(p.endDate).toLocaleDateString('pt-BR')}</>
                            )}
                          </p>
                          {p.durationText && (
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center sm:justify-end gap-1 mt-0.5">
                              <Clock className="h-3 w-3" />
                              Duração: {p.durationText}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Motivo description */}
                      {p.motivo && !p.isCurrent && (
                        <p className="text-xs bg-zinc-50 dark:bg-zinc-950/30 p-2.5 rounded-lg text-zinc-600 dark:text-zinc-400 italic border-l-2 border-zinc-300 dark:border-zinc-700">
                          <strong>Motivo da transferência:</strong> {p.motivo}
                        </p>
                      )}

                      {/* Scales and Timesheets during this period */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-400">Escalas e Folhas de Ponto do Período:</h4>
                        {p.escalas.length === 0 ? (
                          <p className="text-xs text-zinc-400 italic">Nenhuma escala cadastrada neste local durante este período.</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                            {p.escalas.map((esc: any) => (
                              <div key={esc.id} className="p-3 bg-zinc-50 dark:bg-zinc-950/40 rounded-xl border border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between text-xs transition-colors hover:bg-zinc-100/55 dark:hover:bg-zinc-950/70">
                                <div className="space-y-0.5">
                                  <p className="font-bold text-zinc-850 dark:text-zinc-300 capitalize">{getMesAnoFormatado(esc.mes, esc.ano)}</p>
                                  <p className="text-[10px] text-zinc-500">Status: {esc.status}</p>
                                </div>
                                <div className="flex gap-2">
                                  <Link
                                    href={`/escalas/unidade/${esc.unidade_id}?mes=${esc.mes}&ano=${esc.ano}&setor=${esc.setor_id}`}
                                    className="px-2 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:hover:bg-blue-950/40 font-bold rounded-lg transition-colors flex items-center gap-1 shadow-sm border border-blue-100/30"
                                    title="Visualizar Grade de Escala"
                                  >
                                    Escala <ExternalLink className="h-3 w-3" />
                                  </Link>
                                  {esc.folha_id ? (
                                    <Link
                                      href={`/folha-ponto/${esc.folha_id}`}
                                      className="px-2 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/20 dark:text-green-400 dark:hover:bg-green-950/40 font-bold rounded-lg transition-colors flex items-center gap-1 shadow-sm border border-green-100/30"
                                      title="Visualizar Espelho de Ponto"
                                    >
                                      Folha <CheckCircle className="h-3 w-3 text-green-500" />
                                    </Link>
                                  ) : (
                                    <span className="px-2 py-1.5 bg-zinc-100 text-zinc-400 dark:bg-zinc-900/50 dark:text-zinc-500 font-bold rounded-lg flex items-center cursor-not-allowed">
                                      Sem Folha
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
