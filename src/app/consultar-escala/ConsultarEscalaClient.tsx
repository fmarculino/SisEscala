'use client'

import { useState, useEffect } from 'react'
import { validatePin, getServidorEscalas, logoutPortal, findServidorByMatricula, getEscalaDetails } from './actions'
import { createClient } from '@/utils/supabase/client'
import { Loader2, Calendar, FileText, LogOut, Search, Lock, User } from 'lucide-react'
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

  useEffect(() => {
    if (servidor) {
      loadEscalas()
    }
  }, [servidor])

  // PIN Form states
  const [matricula, setMatricula] = useState('')
  const [isMatriculaValid, setIsMatriculaValid] = useState(false)
  const [tempServidorId, setTempServidorId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
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
      setEscalas(result.escalas || [])
      if (result.escalas?.length === 1) {
        handleSelectEscala(result.escalas[0])
      }
    }
    setLoading(false)
  }

  async function handleSelectEscala(escala: any) {
    setSelectedEscala(escala)
    setLoadingEscala(true)
    setError(null)
    
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
                          type="password"
                          inputMode="numeric"
                          required
                          value={pin}
                          onChange={(e) => setPin(e.target.value)}
                          className="block w-full pl-10 pr-3 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono tracking-[1em] text-center"
                          placeholder="••••"
                        />
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
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800">
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Scales List */}
        <div className="lg:col-span-1 space-y-4">
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
        <div className="lg:col-span-3">
          {loadingEscala ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
              <p className="text-zinc-500">Carregando detalhes da escala...</p>
            </div>
          ) : fullEscalaData ? (
            <div className="space-y-4">
               <div className="flex justify-between items-center bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-sm font-bold uppercase text-zinc-900 dark:text-white">Escala Liberada para Consulta</span>
                  </div>
                  <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-all"
                  >
                    <FileText className="h-4 w-4" /> Gerar PDF
                  </button>
               </div>
               
               <PortalScaleGrid data={fullEscalaData} servidorId={servidor.id} />
               
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
               />
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
