'use client'

import { useState, useEffect, useMemo } from 'react'
import { validatePin, getServidorEscalas, logoutPortal, findServidorByMatricula, getEscalaDetails, createSwapRequest, getSwapRequests, cancelSwapRequest, getFolhaPontoServidor, salvarFolhaPontoServidor, verificarDivergenciaEscalaServidor, sincronizarFolhaPontoServidor, gerarFolhaPontoServidor, checkFolhaPontoHabilitada } from './actions'
import { FolhaPontoEditor } from '@/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor'
import { createClient } from '@/utils/supabase/client'
import { Loader2, Calendar, FileText, LogOut, Search, Lock, User, ArrowRightLeft, X, Eye, EyeOff, Printer } from 'lucide-react'
import { ScalePrintView } from '@/components/ScalePrintView'
import { PortalScaleGrid } from '@/app/consultar-escala/PortalScaleGrid'

interface ConsultarEscalaClientProps {
  initialServidor: any | null
}

export default function ConsultarEscalaClient({ initialServidor }: ConsultarEscalaClientProps) {
  const [servidor, setServidor] = useState(initialServidor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [escalas, setEscalas] = useState<any[]>([])
  const [selectedEscala, setSelectedEscala] = useState<any | null>(null)
  const [fullEscalaData, setFullEscalaData] = useState<any | null>(null)
  const [loadingEscala, setLoadingEscala] = useState(false)

  // Timesheet module integration states
  const [folhaHabilitada, setFolhaHabilitada] = useState(false)
  const [viewMode, setViewMode] = useState<'escala' | 'folha'>('escala')
  const [folhaData, setFolhaData] = useState<any | null>(null)
  const [loadingFolha, setLoadingFolha] = useState(false)
  const [generatingPortalFolha, setGeneratingPortalFolha] = useState(false)
  const supabase = createClient()

  // Check database configuration
  useEffect(() => {
    async function checkConfig() {
      try {
        const enabled = await checkFolhaPontoHabilitada()
        setFolhaHabilitada(enabled)
      } catch (err) {
        console.error('Erro ao verificar config da folha:', err)
      }
    }
    checkConfig()
  }, [])

  // Load folha action
  async function handleViewFolha() {
    if (!selectedEscala || !servidor) return
    setViewMode('folha')
    setLoadingFolha(true)
    setError(null)
    try {
      const res = await getFolhaPontoServidor(servidor.id, selectedEscala.mes, selectedEscala.ano, selectedEscala.id)
      if (res.error) {
        setError(res.error)
      } else {
        setFolhaData(res.folha || null)
      }
    } catch (err: any) {
      setError('Erro ao carregar folha de ponto: ' + err.message)
    } finally {
      setLoadingFolha(false)
    }
  }

  async function handleGerarFolhaServidor() {
    if (!selectedEscala || !servidor) return
    setGeneratingPortalFolha(true)
    setError(null)
    try {
      const myEM = fullEscalaData?.escalaMensal.find((em: any) => em.servidor_id === servidor.id)
      const scaleStatus = myEM?.status || 'Em Andamento'
      const forcarRascunho = scaleStatus === 'Em Andamento'

      const res = await gerarFolhaPontoServidor(servidor.id, selectedEscala.mes, selectedEscala.ano, forcarRascunho, selectedEscala.id)
      if (res.error) {
        setError(res.error)
      } else {
        // Reload folha
        await handleViewFolha()
      }
    } catch (err: any) {
      setError('Erro ao gerar folha de ponto: ' + err.message)
    } finally {
      setGeneratingPortalFolha(false)
    }
  }

  const mesExtenso = useMemo(() => {
    if (!selectedEscala) return ''
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ]
    return meses[selectedEscala.mes - 1]
  }, [selectedEscala])

  // Helper: Format minutes since midnight back to "HH:MM"
  function formatMinutesToTimeStr(totalMinutes: number): string {
    const h = Math.floor(totalMinutes / 60) % 24
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // Swap request states
  const [swapModal, setSwapModal] = useState<{ isOpen: boolean; dia: number; turnoId: string; turnoCodigo: string; escalaMensalId: string; categoria: string } | null>(null)
  const [swapJustificativa, setSwapJustificativa] = useState('')
  const [swapLoading, setSwapLoading] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [swapSuccess, setSwapSuccess] = useState<string | null>(null)
  const [solicitacoes, setSolicitacoes] = useState<any[]>([])
  const [loadingSolicitacoes, setLoadingSolicitacoes] = useState(false)

  useEffect(() => {
    if (servidor) {
      loadEscalas()
    }
  }, [servidor])

  // Carregar solicitações automaticamente quando a escala é visualizada
  useEffect(() => {
    if (fullEscalaData && servidor) {
      loadSolicitacoes()
    }
  }, [fullEscalaData])

  // PIN Form states
  const [matricula, setMatricula] = useState('')
  const [isMatriculaValid, setIsMatriculaValid] = useState(false)
  const [tempServidorId, setTempServidorId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [isPinValid, setIsPinValid] = useState(false)
  const [servidorNome, setServidorNome] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyingPin, setVerifyingPin] = useState(false)

  async function handleFindServidor() {
    if (!matricula) return
    setVerifying(true)
    setError(null)
    const result = await findServidorByMatricula(matricula)
    if (result.error || !result.servidor) {
      setError(result.error || 'Servidor não encontrado')
      setIsMatriculaValid(false)
      setTempServidorId(null)
    } else {
      setIsMatriculaValid(true)
      setTempServidorId(result.servidor.id)
    }
    setVerifying(false)
  }

  async function handleVerifyPin() {
    if (!tempServidorId || !pin) return
    setVerifyingPin(true)
    setError(null)
    
    const result = await validatePin(tempServidorId, pin)
    if (result.error) {
      setError(result.error)
    } else {
      setIsPinValid(true)
      setServidorNome(result.nome || '')
    }
    setVerifyingPin(false)
  }

  async function handleEnterPortal() {
    window.location.reload()
  }

  async function loadEscalas() {
    if (!servidor) return
    setLoading(true)
    const result = await getServidorEscalas(servidor.id)
    if (result.error) {
      setError(result.error)
    } else {
      const escalasList = result.escalas || []
      setEscalas(escalasList)
      
      if (escalasList.length > 0) {
        // Tentar encontrar a escala mais recente do setor e unidade principal do servidor
        const mainScale = escalasList.find((esc: any) => 
          esc.setor_id === servidor.setor_id && esc.unidade_id === servidor.unidade_id
        ) || escalasList.find((esc: any) => 
          esc.setor_id === servidor.setor_id
        ) || escalasList[0]
        
        if (mainScale) {
          handleSelectEscala(mainScale)
        }
      }
    }
    setLoading(false)
  }

  async function handleSelectEscala(escala: any) {
    setSelectedEscala(escala)
    setLoadingEscala(true)
    setError(null)
    setFolhaData(null)
    setViewMode('escala')
    
    try {
      const result = await getEscalaDetails(escala)
      
      if (result.error) {
        throw new Error(result.error)
      }

      setFullEscalaData(result.data)
    } catch (err: any) {
      setError('Erro ao carregar detalhes da escala: ' + err.message)
    } finally {
      setLoadingEscala(false)
    }
  }

  async function handleLogout() {
    await logoutPortal()
    window.location.reload()
  }

  async function loadSolicitacoes() {
    setLoadingSolicitacoes(true)
    const result = await getSwapRequests()
    if (result.solicitacoes) {
      setSolicitacoes(result.solicitacoes)
    }
    setLoadingSolicitacoes(false)
  }

  async function handleCreateSwap() {
    if (!swapModal || !swapJustificativa.trim()) return
    setSwapLoading(true)
    setSwapError(null)
    
    const result = await createSwapRequest({
      escalaMensalId: swapModal.escalaMensalId,
      diaOrigem: swapModal.dia,
      categoriaOrigem: swapModal.categoria,
      turnoOrigemId: swapModal.turnoId,
      justificativa: swapJustificativa
    })

    if (result.error) {
      setSwapError(result.error)
    } else {
      setSwapSuccess('Solicitação enviada com sucesso! Aguarde aprovação da coordenação.')
      setSwapModal(null)
      setSwapJustificativa('')
      loadSolicitacoes()
    }
    setSwapLoading(false)
  }

  async function handleCancelSwap(solicitacaoId: string) {
    const result = await cancelSwapRequest(solicitacaoId)
    if (result.success) {
      loadSolicitacoes()
    }
  }

  if (!servidor) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-zinc-50 dark:bg-zinc-950">
        <div className="w-full max-w-md space-y-8 bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 mb-4">
              <Calendar className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Portal do Servidor</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Consulte sua escala de serviço de forma rápida
            </p>
          </div>

          <div className="mt-8 space-y-6">
            <div className="space-y-4">
              {/* Step 1: Matricula */}
              <div className="relative">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Matrícula do Servidor
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                      <User className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      placeholder="Digite sua matrícula..."
                      disabled={isPinValid}
                      value={matricula}
                      onFocus={() => {
                        setMatricula('')
                        setIsMatriculaValid(false)
                        setTempServidorId(null)
                        setPin('')
                        setIsPinValid(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleFindServidor()
                        }
                      }}
                      onChange={(e) => {
                        setMatricula(e.target.value)
                        if (isMatriculaValid) {
                          setIsMatriculaValid(false)
                          setTempServidorId(null)
                          setPin('')
                          setIsPinValid(false)
                        }
                      }}
                      className="block w-full pl-10 pr-3 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
                    />
                  </div>
                  {!isMatriculaValid && (
                    <button
                      type="button"
                      onClick={handleFindServidor}
                      disabled={verifying || !matricula}
                      className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all disabled:opacity-50"
                    >
                      {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verificar'}
                    </button>
                  )}
                </div>
              </div>
              
              {/* Step 2: PIN */}
              {isMatriculaValid && !isPinValid && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-4">
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-lg flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500"></div>
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-bold uppercase">Matrícula validada. Informe seu PIN.</p>
                  </div>

                  <div>
                    <label htmlFor="pin" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Seu PIN de Acesso
                    </label>
                    <div className="mt-1 flex gap-2">
                      <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                          <Lock className="h-4 w-4" />
                        </div>
                        <input
                          id="pin"
                          name="pin"
                          type={showPin ? 'text' : 'password'}
                          inputMode="numeric"
                          required
                          value={pin}
                          onFocus={() => setPin('')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleVerifyPin()
                            }
                          }}
                          onChange={(e) => setPin(e.target.value)}
                          className="block w-full pl-10 pr-10 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono tracking-[1em] text-center"
                          placeholder="••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPin(!showPin)}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                        >
                          {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleVerifyPin}
                        disabled={verifyingPin || !pin}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
                      >
                        {verifyingPin ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Validar PIN'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Success & Access */}
              {isPinValid && (
                <div className="animate-in zoom-in-95 duration-500 space-y-6 pt-4 text-center">
                  <div className="mx-auto h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 mb-2">
                    <User className="h-8 w-8" />
                  </div>
                  <div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Seja bem-vindo,</p>
                    <h3 className="text-xl font-bold text-zinc-900 dark:text-white">{servidorNome}</h3>
                  </div>

                  <button
                    onClick={handleEnterPortal}
                    className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-lg shadow-blue-500/20 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all active:scale-[0.98]"
                  >
                    Visualizar Minha Escala
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 animate-in fade-in slide-in-from-top-1">
                <div className="flex gap-2">
                  <span className="font-bold font-sans">!</span>
                  {error}
                </div>
              </div>
            )}
            
            {!isPinValid && (
              <p className="text-center text-[10px] text-zinc-500 leading-relaxed mt-8">
                O PIN de acesso é fornecido pela coordenação da sua unidade.<br/>
                Caso tenha esquecido, solicite um novo PIN.
              </p>
            )}
          </div>
        </div>
        
        <button 
          onClick={() => window.location.href = '/login'}
          className="mt-8 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          Voltar para login administrativo
        </button>
      </div>
    )
  }

  return (
    <>
    <div className={`max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 print:p-0 print:m-0 print:max-w-none ${viewMode === 'escala' ? 'print:hidden' : ''}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Olá, {servidor.nome}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Portal do Servidor - Consulta de Escalas</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair do Portal
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-650 dark:text-red-400 border border-red-100 dark:border-red-900/30 flex justify-between items-center gap-2 print:hidden">
          <div className="flex gap-2">
            <span className="font-bold">⚠️</span>
            <span>{error}</span>
          </div>
          <button 
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 font-bold px-2 py-1 rounded hover:bg-red-100/50 transition-all text-xs"
          >
            Fechar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 print:block print:w-full">
        {/* Scales List */}
        <div className="lg:col-span-1 space-y-4 print:hidden">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Minhas Escalas
          </h3>
          <div className="space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : escalas.length === 0 ? (
              <p className="text-sm text-zinc-500 italic">Nenhuma escala encontrada para você.</p>
            ) : (
              escalas.map((esc) => (
                <button
                  key={esc.id}
                  onClick={() => handleSelectEscala(esc)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    selectedEscala?.id === esc.id
                      ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20'
                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-blue-400 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <div className="font-bold text-lg">
                    {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(esc.ano, esc.mes - 1))}
                    <span className="text-xs ml-1 opacity-75">{esc.ano}</span>
                  </div>
                  <div className="text-xs uppercase opacity-75 truncate">{esc.setores?.nome}</div>
                  <div className="text-[10px] opacity-60 truncate">{esc.unidades?.nome}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Scale View */}
        <div className="lg:col-span-3 print:w-full print:block print:p-0">
          {loadingEscala ? (
<div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
              <p className="text-zinc-500">Carregando detalhes da escala...</p>
            </div>
          ) : fullEscalaData ? (
             <div className="space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 gap-4 print:hidden">
                     {folhaHabilitada ? (
                       <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl w-fit">
                         <button
                           onClick={() => setViewMode('escala')}
                           className={`px-4 py-2 text-xs font-black uppercase rounded-lg transition-all ${
                             viewMode === 'escala'
                               ? 'bg-white dark:bg-zinc-900 text-blue-600 shadow-sm'
                               : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-300'
                           }`}
                         >
                           📅 Escala
                         </button>
                         <button
                           onClick={handleViewFolha}
                           className={`px-4 py-2 text-xs font-black uppercase rounded-lg transition-all ${
                             viewMode === 'folha'
                               ? 'bg-white dark:bg-zinc-900 text-blue-600 shadow-sm'
                               : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-300'
                           }`}
                         >
                           📄 Folha de Ponto
                         </button>
                       </div>
                     ) : (
                       <div className="flex items-center gap-2">
                         <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></span>
                         <span className="text-sm font-bold uppercase text-zinc-900 dark:text-white">Escala Liberada para Consulta</span>
                       </div>
                     )}
                     
                     {viewMode === 'escala' && (
                       <button 
                         onClick={() => window.print()}
                         className="flex items-center justify-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-black px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider hover:opacity-90 transition-all shadow-md"
                       >
                         <Printer className="h-4 w-4" /> Imprimir Escala
                       </button>
                     )}
                  </div>
                
                {viewMode === 'escala' && (
                  <>
                    <PortalScaleGrid data={fullEscalaData} servidorId={servidor.id} />

               {/* Botão de Solicitar Troca */}
               <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                 <div className="mb-3">
                   <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                     <ArrowRightLeft className="h-4 w-4 text-purple-500" />
                     Solicitar Troca de Plantão
                   </h3>
                 </div>
                 <p className="text-xs text-zinc-500 mb-3">
                   Selecione um dia da sua escala com turno atribuído para solicitar uma troca.
                 </p>
                 <div className="space-y-3">
                   {(() => {
                     const myEM = fullEscalaData.escalaMensal.find((em: any) => em.servidor_id === servidor.id)
                     if (!myEM) return <p className="text-xs text-zinc-400">Sem escala encontrada.</p>
                     const daysInMonth = new Date(fullEscalaData.ano, fullEscalaData.mes, 0).getDate()
                     const gridData = generateGridData(fullEscalaData)
                     const myData = gridData[servidor.id]

                     const SWAP_CATEGORIES = [
                       { key: 'Regular', label: 'Regular', color: 'purple' },
                       { key: 'Plantão', label: 'Plantão', color: 'red' },
                       { key: 'Sobreaviso', label: 'Sobreaviso', color: 'blue' },
                     ] as const

                     const colorMap: Record<string, string> = {
                       purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/40',
                       red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40',
                       blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40',
                     }

                     const sections: any[] = []
                     let hasAny = false

                     // Só exibir dias futuros (a partir de amanhã)
                     const hoje = new Date()
                     const todayDay = hoje.getDate()
                     const isCurrentMonth = fullEscalaData.ano === hoje.getFullYear() && fullEscalaData.mes === (hoje.getMonth() + 1)
                     const isFutureMonth = new Date(fullEscalaData.ano, fullEscalaData.mes - 1) > new Date(hoje.getFullYear(), hoje.getMonth())
                     // Se for mês passado, nenhum dia é trocável
                     const minDay = isCurrentMonth ? todayDay + 1 : (isFutureMonth ? 1 : daysInMonth + 1)

                     for (const cat of SWAP_CATEGORIES) {
                       const buttons: any[] = []
                       for (let d = 1; d <= daysInMonth; d++) {
                         if (d < minDay) continue  // Pular dias passados
                         const turnoId = myData?.[cat.key]?.[d]
                         if (!turnoId) continue
                         const turno = fullEscalaData.turnos.find((t: any) => t.id === turnoId)
                         if (!turno) continue
                         buttons.push(
                           <button
                             key={`${cat.key}-${d}`}
                             onClick={() => setSwapModal({ isOpen: true, dia: d, turnoId: turno.id, turnoCodigo: turno.codigo, escalaMensalId: myEM.id, categoria: cat.key })}
                             className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${colorMap[cat.color]}`}
                           >
                             Dia {d} ({turno.codigo})
                           </button>
                         )
                       }
                       if (buttons.length > 0) {
                         hasAny = true
                         sections.push(
                           <div key={cat.key}>
                             <p className="text-[10px] font-bold uppercase text-zinc-500 mb-1.5">{cat.label}</p>
                             <div className="flex flex-wrap gap-2">{buttons}</div>
                           </div>
                         )
                       }
                     }

                     return hasAny ? sections : <p className="text-xs text-zinc-400 italic">Nenhum turno atribuído para troca.</p>
                   })()}
                 </div>

                 {/* Minhas Solicitações */}
                 {solicitacoes.length > 0 && (
                   <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                     <h4 className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase mb-2">Minhas Solicitações</h4>
                     <div className="space-y-2">
                       {solicitacoes.map(sol => (
                         <div key={sol.id} className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                           <div>
                             <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                               Dia {sol.dia_origem} — {sol.turno?.codigo}
                               {sol.categoria_origem && sol.categoria_origem !== 'Regular' && (
                                 <span className={`ml-1 text-[9px] font-bold ${
                                   sol.categoria_origem === 'Plantão' ? 'text-red-500' : 'text-blue-500'
                                 }`}>({sol.categoria_origem})</span>
                               )}
                             </span>
                             <span className={`ml-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                               sol.status === 'Pendente' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                               sol.status === 'Aprovada' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                               sol.status === 'Rejeitada' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                               'bg-zinc-100 text-zinc-500'
                             }`}>
                               {sol.status}
                             </span>
                             {sol.motivo_rejeicao && (
                               <p className="text-[10px] text-red-500 mt-0.5">Motivo: {sol.motivo_rejeicao}</p>
                             )}
                           </div>
                           {sol.status === 'Pendente' && (
                             <button
                               onClick={() => handleCancelSwap(sol.id)}
                               className="text-[10px] text-red-500 hover:text-red-700 font-bold"
                             >
                               Cancelar
                             </button>
                           )}
                         </div>
                       ))}
                     </div>
                   </div>
                 )}
               </div>
              </>
            )}

            {viewMode === 'folha' && (
              <div className="space-y-6">
                {loadingFolha ? (
                  <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
                    <p className="text-zinc-500 font-bold uppercase tracking-wider text-xs">Carregando folha de ponto...</p>
                  </div>
                ) : !folhaData ? (
                  <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700">
                    <FileText className="h-12 w-12 text-zinc-300 mb-4 font-normal" />
                    <p className="text-zinc-500 font-black uppercase tracking-tight text-sm">Folha não gerada</p>
                    <p className="text-xs text-zinc-400 mt-1 mb-6">Sua folha de ponto para este período ainda não foi gerada.</p>
                    
                    <div className="flex gap-3">
                      <button
                        onClick={() => setViewMode('escala')}
                        className="px-4 py-2 bg-zinc-150 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-bold uppercase"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={handleGerarFolhaServidor}
                        disabled={generatingPortalFolha}
                        className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-blue-500/20 disabled:opacity-50"
                      >
                        {generatingPortalFolha ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        {(() => {
                          const myEM = fullEscalaData?.escalaMensal.find((em: any) => em.servidor_id === servidor.id)
                          return myEM?.status === 'Em Andamento' ? 'Gerar Rascunho da Folha' : 'Gerar Folha de Ponto'
                        })()}
                      </button>
                    </div>
                  </div>
                ) : (
                  <FolhaPontoEditor 
                    folha={folhaData}
                    profile={null}
                    isPortal={true}
                    onBack={() => setViewMode('escala')}
                    saveAction={salvarFolhaPontoServidor}
                    verifyDivergenceAction={verificarDivergenciaEscalaServidor}
                    syncAction={sincronizarFolhaPontoServidor}
                    regenerateAction={gerarFolhaPontoServidor}
                  />
                )}
              </div>
            )}
             </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700">
              <Search className="h-12 w-12 text-zinc-300 mb-4" />
              <p className="text-zinc-500">Selecione uma escala ao lado para visualizar.</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {viewMode === 'escala' && fullEscalaData && (
      <ScalePrintView 
         unidade={fullEscalaData.unidade}
         setor={fullEscalaData.setor}
         mes={fullEscalaData.mes}
         ano={fullEscalaData.ano}
         escalaMensal={fullEscalaData.escalaMensal}
         gridData={generateGridData(fullEscalaData)}
         turnos={fullEscalaData.turnos}
         jornadas={fullEscalaData.jornadas}
         shiftTotals={calculateShiftTotals(fullEscalaData)}
         servidoresEventos={fullEscalaData.servidoresEventos}
         permitirPlantaoExtra={fullEscalaData.configsGlobais?.find((c: any) => c.chave === 'permitir_plantao_extra_durante_eventos')?.valor === true || fullEscalaData.configsGlobais?.find((c: any) => c.chave === 'permitir_plantao_extra_durante_eventos')?.valor?.toString() === 'true'}
         destaqueServidorId={servidor?.id}
      />
    )}

    {/* Modal de Solicitação de Troca */}
    {swapModal && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-sm overflow-hidden">
          <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2 text-zinc-900 dark:text-white">
              <ArrowRightLeft className="h-5 w-5 text-purple-500" />
              Solicitar Troca
            </h2>
            <button onClick={() => { setSwapModal(null); setSwapError(null) }} className="text-zinc-400 hover:text-zinc-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
              <p className="text-xs text-zinc-500">Dia / Categoria</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-white">
                {swapModal.dia} — Turno {swapModal.turnoCodigo}
                <span className={`ml-2 text-xs font-bold ${
                  swapModal.categoria === 'Plantão' ? 'text-red-500' : 
                  swapModal.categoria === 'Sobreaviso' ? 'text-blue-500' : 
                  'text-purple-500'
                }`}>({swapModal.categoria})</span>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 block mb-1">Justificativa *</label>
              <textarea
                value={swapJustificativa}
                onChange={(e) => setSwapJustificativa(e.target.value)}
                placeholder="Descreva o motivo da troca..."
                className="w-full h-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none text-zinc-900 dark:text-white"
              />
            </div>
            {swapError && (
              <div className="p-2 rounded bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-400">{swapError}</div>
            )}
          </div>
          <div className="p-5 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex gap-3">
            <button onClick={() => { setSwapModal(null); setSwapError(null) }} className="flex-1 px-4 py-2 text-sm font-medium text-zinc-600 rounded-lg hover:bg-zinc-100">
              Cancelar
            </button>
            <button
              onClick={handleCreateSwap}
              disabled={swapLoading || swapJustificativa.trim().length < 5}
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-lg transition-all disabled:opacity-50"
            >
              {swapLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Enviar Solicitação'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Toast de Sucesso */}
    {swapSuccess && (
      <div className="fixed bottom-6 right-6 z-[200] animate-in slide-in-from-bottom-4 fade-in">
        <div className="bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-bold flex items-center gap-3">
          {swapSuccess}
          <button onClick={() => setSwapSuccess(null)} className="text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )}
  </>
  )
}

// Helper to transform raw data into the grid format expected by components
function generateGridData(data: any) {
  const grid: any = {}
  data.escalaMensal.forEach((em: any) => {
    grid[em.servidor_id] = { Regular: {}, Extra: {}, Plantão: {}, Sobreaviso: {} }
    const dailies = data.escalaDiaria.filter((ed: any) => ed.escala_mensal_id === em.id)
    dailies.forEach((ed: any) => {
      const cat = ed.categoria || 'Regular'
      grid[em.servidor_id][cat][ed.dia] = ed.dicionario_turnos_id
    })
  })
  return grid
}

// Helper to calculate totals for the footer
function calculateShiftTotals(data: any) {
  const daysInMonth = new Date(data.ano, data.mes, 0).getDate()
  const grid = generateGridData(data)
  
  const totals = {
    M: {} as Record<number, number>,
    T: {} as Record<number, number>,
    N: {} as Record<number, number>,
    S: {} as Record<number, number>
  }

  for (let d = 1; d <= daysInMonth; d++) {
    let countM = 0, countT = 0, countN = 0, countS = 0
    data.escalaMensal.forEach((em: any) => {
      ['Regular', 'Extra', 'Plantão'].forEach(cat => {
        const tId = grid[em.servidor_id][cat][d]
        const t = data.turnos.find((x: any) => x.id === tId)
        if (t?.codigo) {
          if (t.codigo.includes('M')) countM++
          if (t.codigo.includes('T')) countT++
          if (t.codigo.includes('N')) countN++
        }
      })
      if (grid[em.servidor_id]['Sobreaviso'][d]) countS++
    })
    totals.M[d] = countM
    totals.T[d] = countT
    totals.N[d] = countN
    totals.S[d] = countS
  }
  return totals
}
