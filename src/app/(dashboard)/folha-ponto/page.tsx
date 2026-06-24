'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { FileText, Loader2, Search, Building2, Layers, Calendar, ChevronRight, Play, RefreshCw, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'
import { getServidoresFolhaPonto, gerarFolhaPonto, gerarFolhasEmLote } from './actions'
import { Modal } from '@/components/ui/Modal'
import { formatSectorsHierarchy } from '@/utils/sectors'

export default function FolhaPontoPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [loadingServidores, setLoadingServidores] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Filters
  const [mes, setMes] = useState<number>(new Date().getMonth() + 1)
  const [ano, setAno] = useState<number>(new Date().getFullYear())
  const [selectedUnidade, setSelectedUnidade] = useState('')
  const [selectedSetor, setSelectedSetor] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  // Static Data
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)

  // Server timesheet data
  const [servidoresData, setServidoresData] = useState<any[]>([])

  // Modal
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean, title: string, message: string, type: 'default' | 'danger' | 'success' | 'warning' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'default'
  })

  // Load user profile & initial filters
  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
            .eq('id', user.id)
            .single()
          
          if (prof) {
            const userProfile = {
              ...prof,
              permitted_unidades: prof.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
              permitted_setores: prof.profile_setores?.map((ps: any) => ps.setor_id) || []
            }
            setProfile(userProfile)

            // Fetch units & sectors
            let unitsQuery = supabase.from('unidades').select('id, nome').order('nome')
            unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
            const { data: uData } = await unitsQuery
            setUnidades(uData || [])

            let sectorsQuery = supabase.from('setores').select('id, unidade_id, parent_id, dicionario_setores(nome)')
            sectorsQuery = applyAccessFilters(sectorsQuery, userProfile, { setorField: 'id' })
            const { data: sRaw } = await sectorsQuery
            
            const sData = sRaw?.map(s => {
              const dictData = Array.isArray(s.dicionario_setores) 
                ? s.dicionario_setores[0] 
                : s.dicionario_setores
              return {
                id: s.id,
                unidade_id: s.unidade_id,
                parent_id: s.parent_id,
                nome: dictData?.nome || 'SETOR SEM NOME'
              }
            }) || []
            setSetores(formatSectorsHierarchy(sData))

            // Pre-select first unit & sector if available
            if (uData && uData.length > 0) {
              setSelectedUnidade(uData[0].id)
              const firstSector = sData.find(s => s.unidade_id === uData[0].id)
              if (firstSector) {
                setSelectedSetor(firstSector.id)
              }
            }
          }
        }
      } catch (err) {
        console.error('Erro ao inicializar página:', err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  // Auto filter sectors based on unit choice
  const filteredSetores = setores.filter(s => s.unidade_id === selectedUnidade)

  // Fetch timesheet servers when unit/sector/date is selected
  const fetchServidores = useCallback(async () => {
    if (!selectedUnidade || !selectedSetor) {
      setServidoresData([])
      return
    }
    setLoadingServidores(true)
    const res = await getServidoresFolhaPonto(mes, ano, selectedUnidade, selectedSetor)
    setLoadingServidores(false)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: res.error,
        type: 'danger'
      })
    } else if (res.servidores) {
      setServidoresData(res.servidores)
    }
  }, [mes, ano, selectedUnidade, selectedSetor])

  useEffect(() => {
    fetchServidores()
  }, [fetchServidores])

  // Reset selected sector if it does not belong to the newly selected unit
  const handleUnidadeChange = (unidadeId: string) => {
    setSelectedUnidade(unidadeId)
    const validSectors = setores.filter(s => s.unidade_id === unidadeId)
    if (validSectors.length > 0) {
      setSelectedSetor(validSectors[0].id)
    } else {
      setSelectedSetor('')
    }
  }

  // Generate individual timesheet
  const handleGerarIndividual = async (servidorId: string, forcarRascunho: boolean) => {
    setActionLoading(`gerar-${servidorId}`)
    const res = await gerarFolhaPonto(servidorId, mes, ano, forcarRascunho)
    setActionLoading(null)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro na Geração',
        message: res.error,
        type: 'warning'
      })
    } else {
      setAlertModal({
        isOpen: true,
        title: 'Sucesso',
        message: 'Folha de ponto gerada com sucesso!',
        type: 'success'
      })
      fetchServidores()
    }
  }

  // Bulk generation
  const handleGerarEmLote = async (forcarRascunho: boolean) => {
    setActionLoading(forcarRascunho ? 'lote-rascunho' : 'lote-definitiva')
    const res = await gerarFolhasEmLote(mes, ano, selectedUnidade, selectedSetor, forcarRascunho)
    setActionLoading(null)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: res.error,
        type: 'danger'
      })
    } else {
      setAlertModal({
        isOpen: true,
        title: 'Lote Concluído',
        message: res.message || 'Geração finalizada.',
        type: 'success'
      })
      fetchServidores()
    }
  }

  // Filter servers in memory
  const filteredServidores = servidoresData.filter(s => 
    s.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.matricula?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.cargo?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const meses = [
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' }
  ]

  const anos = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20 text-white">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Folha de Ponto</h1>
            <p className="mt-1 text-zinc-500 text-sm font-medium">Geração e fechamento de relatórios de horas mensais de servidores.</p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Mês/Ano */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" /> Referência
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={mes}
                onChange={(e) => setMes(parseInt(e.target.value))}
              >
                {meses.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <select 
                className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                value={ano}
                onChange={(e) => setAno(parseInt(e.target.value))}
              >
                {anos.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Unidade */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> Unidade
            </label>
            <select 
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              value={selectedUnidade}
              onChange={(e) => handleUnidadeChange(e.target.value)}
            >
              <option value="">Selecione a Unidade...</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          {/* Setor */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Layers className="h-3.5 w-3.5" /> Setor
            </label>
            <select 
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              disabled={!selectedUnidade}
              value={selectedSetor}
              onChange={(e) => setSelectedSetor(e.target.value)}
            >
              <option value="">Selecione o Setor...</option>
              {filteredSetores.map(s => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>

          {/* Busca de Servidores */}
          <div className="space-y-2">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Search className="h-3.5 w-3.5" /> Filtrar Servidor
            </label>
            <input 
              type="text" 
              placeholder="Nome ou matrícula..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={!selectedSetor}
            />
          </div>
        </div>

        {/* Global Batch Actions */}
        {selectedSetor && servidoresData.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-6 gap-4">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-500">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              <span>Geração em lote afeta apenas os servidores com escalas configuradas no período.</span>
            </div>
            
            <div className="flex flex-wrap gap-3">
              <button 
                onClick={() => handleGerarEmLote(true)}
                disabled={actionLoading !== null}
                className="inline-flex items-center bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
              >
                {actionLoading === 'lote-rascunho' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                Gerar Rascunhos
              </button>
              <button 
                onClick={() => handleGerarEmLote(false)}
                disabled={actionLoading !== null}
                className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
              >
                {actionLoading === 'lote-definitiva' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                Gerar Todas (Definitivas)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main List Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
        {loadingServidores ? (
          <div className="p-20 text-center">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50 mb-4" />
            <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest">Carregando servidores...</p>
          </div>
        ) : !selectedSetor ? (
          <div className="p-20 text-center text-zinc-500">
            <FileText className="mx-auto h-16 w-16 opacity-10 mb-6" />
            <p className="text-xl font-black uppercase tracking-tight text-zinc-400">Selecione os Filtros</p>
            <p className="text-sm mt-2 max-w-sm mx-auto">Escolha a Unidade e o Setor acima para poder carregar a folha de ponto dos servidores correspondentes.</p>
          </div>
        ) : filteredServidores.length === 0 ? (
          <div className="p-20 text-center text-zinc-500">
            <Search className="mx-auto h-16 w-16 opacity-10 mb-6" />
            <p className="text-xl font-black uppercase tracking-tight">Nenhum servidor encontrado</p>
            <p className="text-sm mt-2">Nenhum servidor lotado ativo ou compatível com a busca foi retornado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Servidor</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Jornada Lotação</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Escala Mensal</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Status Folha</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center">Horas Normais</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center">Extras (50% / 100%)</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center">Faltas</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 text-center w-36">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredServidores.map(s => {
                  const hasScale = s.escala_mensal_id !== null
                  const hasFolha = s.folha_id !== null

                  return (
                    <tr key={s.servidor_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-black text-zinc-900 dark:text-white uppercase tracking-tighter text-sm">
                          {s.nome}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight mt-0.5">
                          Matrícula: {s.matricula} • {s.cargo || 'CARGO NÃO INFORMADO'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-zinc-600 dark:text-zinc-400 text-sm">
                          {s.jornada_nome}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                          s.escala_status === 'Fechada' 
                            ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-850 dark:text-zinc-400' 
                            : s.escala_status === 'Em Andamento'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                        }`}>
                          {s.escala_status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                          s.folha_status === 'Gerada' 
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' 
                            : s.folha_status === 'Rascunho'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                            : s.folha_status === 'Revisada'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
                        }`}>
                          {s.folha_status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          {hasFolha ? `${s.total_horas_normais}h` : '---'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          {hasFolha ? `${s.total_horas_extras_50}h / ${s.total_horas_extras_100}h` : '---'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`font-bold ${hasFolha && s.total_faltas > 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                          {hasFolha ? s.total_faltas : '---'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {hasFolha ? (
                            <Link 
                              href={`/folha-ponto/${s.folha_id}`}
                              className="inline-flex items-center text-xs font-black uppercase bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-white px-4 py-2 rounded-xl transition-all"
                            >
                              Editar <ChevronRight className="ml-1 h-3.5 w-3.5" />
                            </Link>
                          ) : !hasScale ? (
                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wide">Sem Escala</span>
                          ) : (
                            <div className="flex gap-1.5">
                              {s.escala_status === 'Em Andamento' ? (
                                <button 
                                  onClick={() => handleGerarIndividual(s.servidor_id, true)}
                                  disabled={actionLoading === `gerar-${s.servidor_id}`}
                                  className="inline-flex items-center text-[10px] font-black uppercase bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
                                >
                                  {actionLoading === `gerar-${s.servidor_id}` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Rascunho'
                                  )}
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleGerarIndividual(s.servidor_id, false)}
                                  disabled={actionLoading === `gerar-${s.servidor_id}`}
                                  className="inline-flex items-center text-[10px] font-black uppercase bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
                                >
                                  {actionLoading === `gerar-${s.servidor_id}` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Gerar'
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal alert */}
      <Modal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
        title={alertModal.title}
        type={alertModal.type as any}
        footer={
          <button
            onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
            className="w-full px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-black uppercase tracking-widest text-[10px]"
          >
            Entendido
          </button>
        }
      >
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{alertModal.message}</p>
      </Modal>
    </div>
  )
}
