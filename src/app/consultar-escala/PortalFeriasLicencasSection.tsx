'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { 
  getSolicitacoesServidor, criarSolicitacaoPrevisao, 
  cancelarSolicitacaoServidor, aceitarContraproposta, 
  rejeitarContraproposta, getDadosRequerimento,
  verificarElegibilidadeServidorFerias
} from './actions'
import { RequerimentoPrintView } from '@/components/RequerimentoPrintView'
import { Modal } from '@/components/ui/Modal'
import { 
  Palmtree, Plus, Loader2, Calendar, CheckCircle, XCircle, 
  Clock, MessageSquare, Printer, AlertTriangle, Info, FileText, ChevronRight, X, ShieldAlert
} from 'lucide-react'

interface PortalFeriasLicencasSectionProps {
  servidor: any
}

interface OpcaoDatas {
  p1_inicio: string
  p1_fim: string
  p2_inicio?: string
  p2_fim?: string
}

const MODALIDADE_LABELS: Record<string, string> = {
  integral_30: 'Integral (30 dias corridos)',
  fracionado_15_15: 'Fracionado em 2 períodos (15 + 15 dias)',
  abono_10_20: 'Abono Pecuniário (10 dias) + Gozo (20 dias)',
  integral_90: 'Integral (90 dias corridos)',
  fracionado_45_45: 'Fracionado em 2 períodos (45 + 45 dias)',
}

const MODALIDADE_DIAS: Record<string, { p1: number; p2?: number }> = {
  integral_30: { p1: 30 },
  fracionado_15_15: { p1: 15, p2: 15 },
  abono_10_20: { p1: 20 },
  integral_90: { p1: 90 },
  fracionado_45_45: { p1: 45, p2: 45 },
}

function addDays(dateStr: string, days: number): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days - 1)
  return d.toISOString().split('T')[0]
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export function PortalFeriasLicencasSection({ servidor }: PortalFeriasLicencasSectionProps) {
  const [solicitacoes, setSolicitacoes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Ineligibility Modal State
  const [showIneligibleModal, setShowIneligibleModal] = useState(false)
  const [ineligibleData, setIneligibleData] = useState<{ camposFaltantes: string[]; mensagem?: string } | null>(null)
  const [checkingAptidao, setCheckingAptidao] = useState(false)

  // Modal Submission Error State
  const [modalError, setModalError] = useState<string | null>(null)
  const [showSubmissionErrorModal, setShowSubmissionErrorModal] = useState(false)

  // New Request Form State
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)

  // Form Fields
  const [tipoBeneficio, setTipoBeneficio] = useState<'ferias' | 'licenca_premio'>('ferias')
  const [exercicio, setExercicio] = useState('')
  const [modalidade, setModalidade] = useState<string>('integral_30')
  const [observacao, setObservacao] = useState('')
  const [adicionalTerco, setAdicionalTerco] = useState(true)

  // Up to 3 options
  const [numOpcoes, setNumOpcoes] = useState(1)
  const [p1Inicio1, setP1Inicio1] = useState('')
  const [p2Inicio1, setP2Inicio1] = useState('')
  const [p1Inicio2, setP1Inicio2] = useState('')
  const [p2Inicio2, setP2Inicio2] = useState('')
  const [p1Inicio3, setP1Inicio3] = useState('')
  const [p2Inicio3, setP2Inicio3] = useState('')

  // 15/15 suggestion for integral_30
  const [sugP1Inicio, setSugP1Inicio] = useState('')
  const [sugP2Inicio, setSugP2Inicio] = useState('')

  // Requerimento Print State
  const [printData, setPrintData] = useState<{ solicitacao: any; servidor: any; logoUrl: string | null } | null>(null)
  const [loadingPrint, setLoadingPrint] = useState(false)

  // Min date limit (60 days in advance)
  const minDateLimit = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 60)
    return d.toISOString().split('T')[0]
  }, [])

  // Check if active request already exists for the entered exercise and benefit type
  const solicExistente = useMemo(() => {
    if (!exercicio.trim()) return null
    const exTrimmed = exercicio.trim().toLowerCase()
    return solicitacoes.find(s => 
      s.tipo_beneficio === tipoBeneficio &&
      s.exercicio?.trim().toLowerCase() === exTrimmed &&
      ['aguardando_validacao', 'deferido', 'contraproposta'].includes(s.status)
    )
  }, [solicitacoes, tipoBeneficio, exercicio])

  // Check eligibility and start request
  async function handleStartNovaSolicitacao() {
    if (!servidor) return
    setCheckingAptidao(true)
    setError(null)
    const res = await verificarElegibilidadeServidorFerias(servidor.id)
    setCheckingAptidao(false)

    if (res.error) {
      setError(res.error)
      return
    }

    if (!res.apto) {
      setIneligibleData({
        camposFaltantes: res.camposFaltantes || [],
        mensagem: res.mensagem,
      })
      setShowIneligibleModal(true)
      return
    }

    resetForm()
    setShowModal(true)
  }

  // Load requests
  const loadData = useCallback(async () => {
    if (!servidor) return
    setLoading(true)
    const res = await getSolicitacoesServidor(servidor.id)
    if (res.error) {
      setError(res.error)
    } else {
      setSolicitacoes(res.solicitacoes || [])
    }
    setLoading(false)
  }, [servidor])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Reset Form
  function resetForm() {
    setStep(1)
    setTipoBeneficio('ferias')
    setExercicio('')
    setModalidade('integral_30')
    setObservacao('')
    setAdicionalTerco(true)
    setNumOpcoes(1)
    setP1Inicio1(''); setP2Inicio1('')
    setP1Inicio2(''); setP2Inicio2('')
    setP1Inicio3(''); setP2Inicio3('')
    setSugP1Inicio(''); setSugP2Inicio('')
    setError(null)
    setModalError(null)
    setShowSubmissionErrorModal(false)
  }

  // Handle Submit
  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    setModalError(null)

    // Build options
    const dur = MODALIDADE_DIAS[modalidade]
    const opcoes: OpcaoDatas[] = []

    if (p1Inicio1) {
      opcoes.push({
        p1_inicio: p1Inicio1,
        p1_fim: addDays(p1Inicio1, dur.p1),
        p2_inicio: dur.p2 && p2Inicio1 ? p2Inicio1 : undefined,
        p2_fim: dur.p2 && p2Inicio1 ? addDays(p2Inicio1, dur.p2) : undefined,
      })
    }

    if (numOpcoes >= 2 && p1Inicio2) {
      opcoes.push({
        p1_inicio: p1Inicio2,
        p1_fim: addDays(p1Inicio2, dur.p1),
        p2_inicio: dur.p2 && p2Inicio2 ? p2Inicio2 : undefined,
        p2_fim: dur.p2 && p2Inicio2 ? addDays(p2Inicio2, dur.p2) : undefined,
      })
    }

    if (numOpcoes >= 3 && p1Inicio3) {
      opcoes.push({
        p1_inicio: p1Inicio3,
        p1_fim: addDays(p1Inicio3, dur.p1),
        p2_inicio: dur.p2 && p2Inicio3 ? p2Inicio3 : undefined,
        p2_fim: dur.p2 && p2Inicio3 ? addDays(p2Inicio3, dur.p2) : undefined,
      })
    }

    // Sugestão 15/15 if integral_30
    const sugestao = (modalidade === 'integral_30' && sugP1Inicio && sugP2Inicio) ? {
      p1_inicio: sugP1Inicio,
      p1_fim: addDays(sugP1Inicio, 15),
      p2_inicio: sugP2Inicio,
      p2_fim: addDays(sugP2Inicio, 15),
    } : null

    const res = await criarSolicitacaoPrevisao({
      servidorId: servidor.id,
      tipoBeneficio,
      exercicio,
      modalidade,
      opcoesDatas: opcoes,
      sugestaoFracionamento: sugestao,
      observacao,
      adicionalTerco,
    })

    setSubmitting(false)

    if (res.error) {
      setModalError(res.error)
      setShowSubmissionErrorModal(true)
    } else {
      setSuccess('Solicitação criada com sucesso! Aguarde validação da coordenação.')
      setShowModal(false)
      resetForm()
      await loadData()
    }
  }

  // Handle Requerimento Print
  async function handlePrint(solId: string) {
    setLoadingPrint(true)
    const res = await getDadosRequerimento(solId, servidor.id)
    if (res.error) {
      setError(res.error)
    } else {
      setPrintData(res as any)
      setTimeout(() => window.print(), 300)
    }
    setLoadingPrint(false)
  }

  // Handle Cancel
  async function handleCancel(solId: string) {
    if (!confirm('Deseja realmente cancelar esta solicitação?')) return
    const res = await cancelarSolicitacaoServidor(solId, servidor.id)
    if (res.error) {
      setError(res.error)
    } else {
      setSuccess('Solicitação cancelada com sucesso.')
      await loadData()
    }
  }

  // Handle Aceitar Contraproposta
  async function handleAceitarContra(solId: string) {
    const res = await aceitarContraproposta(solId, servidor.id)
    if (res.error) {
      setError(res.error)
    } else {
      setSuccess('Contraproposta aceita com sucesso! Aguarde a formalização.')
      await loadData()
    }
  }

  // Handle Rejeitar Contraproposta
  async function handleRejeitarContra(solId: string) {
    if (!confirm('Deseja rejeitar esta contraproposta? A solicitação será cancelada.')) return
    const res = await rejeitarContraproposta(solId, servidor.id)
    if (res.error) {
      setError(res.error)
    } else {
      setSuccess('Contraproposta rejeitada. A solicitação foi cancelada.')
      await loadData()
    }
  }

  const dur = MODALIDADE_DIAS[modalidade] || { p1: 30 }

  return (
    <div className="space-y-6">
      {/* Print View Component (rendered when printData is set) */}
      {printData && (
        <RequerimentoPrintView
          solicitacao={printData.solicitacao}
          servidor={printData.servidor}
          logoUrl={printData.logoUrl}
        />
      )}

      {/* Header card */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm print:hidden">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Palmtree className="h-6 w-6 text-emerald-600" />
            Previsão de Férias e Licença Prêmio
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            Manifeste suas opções de férias ou licença prêmio para validação pela chefia.
          </p>
        </div>
        <button
          onClick={handleStartNovaSolicitacao}
          disabled={checkingAptidao}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-75"
        >
          {checkingAptidao ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Nova Solicitação
        </button>
      </div>

      {/* Alert Messages */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 text-xs text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
          <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 font-bold">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Requests List */}
      <div className="space-y-4 print:hidden">
        {loading ? (
          <div className="flex justify-center items-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          </div>
        ) : solicitacoes.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <Palmtree className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
            <p className="text-sm text-zinc-500 font-medium">Você ainda não possui solicitações de férias ou licença prêmio.</p>
            <p className="text-xs text-zinc-400 mt-1">Clique em "Nova Solicitação" para cadastrar sua previsão.</p>
          </div>
        ) : (
          solicitacoes.map((sol: any) => {
            const isDeferido = sol.status === 'deferido'
            const isIndeferido = sol.status === 'indeferido'
            const isContra = sol.status === 'contraproposta'
            const isPendente = sol.status === 'aguardando_validacao'
            const opcoes = (sol.opcoes_datas as OpcaoDatas[]) || []

            return (
              <div key={sol.id} className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      {sol.tipo_beneficio === 'ferias' ? '🏖️ Férias' : '🏆 Licença Prêmio'}
                    </span>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-white mt-0.5">
                      Exercício {sol.exercicio} — <span className="text-sm font-normal text-zinc-500">{MODALIDADE_LABELS[sol.modalidade]}</span>
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${
                      isDeferido ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                      : isIndeferido ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
                      : isContra ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                      : isPendente ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800'
                      : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                    }`}>
                      {isDeferido ? '✅ Deferido' : isIndeferido ? '❌ Indeferido' : isContra ? '💬 Contraproposta' : isPendente ? '⏳ Aguardando Validação' : '⚫ Cancelado'}
                    </span>
                  </div>
                </div>

                {/* Submitted Options */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {opcoes.map((op: OpcaoDatas, idx: number) => (
                    <div key={idx} className={`p-3 rounded-xl border text-xs ${
                      isDeferido && sol.opcao_selecionada === idx + 1
                        ? 'border-green-500 bg-green-50/50 dark:bg-green-900/10'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30'
                    }`}>
                      <span className="font-bold text-zinc-700 dark:text-zinc-300 block mb-1">
                        Opção {idx + 1} {isDeferido && sol.opcao_selecionada === idx + 1 && '✓ Aprovada'}
                      </span>
                      <p className="text-zinc-600 dark:text-zinc-400">1º: {formatDate(op.p1_inicio)} a {formatDate(op.p1_fim)}</p>
                      {op.p2_inicio && (
                        <p className="text-zinc-600 dark:text-zinc-400">2º: {formatDate(op.p2_inicio)} a {formatDate(op.p2_fim)}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Contraproposta Details */}
                {isContra && sol.contraproposta_datas && (
                  <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/20 space-y-2">
                    <p className="font-bold text-blue-900 dark:text-blue-300 text-xs uppercase flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" /> Contraproposta da Chefia:
                    </p>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      1º Período: {formatDate((sol.contraproposta_datas as any).p1_inicio)} a {formatDate((sol.contraproposta_datas as any).p1_fim)}
                      {(sol.contraproposta_datas as any).p2_inicio && ` | 2º Período: ${formatDate((sol.contraproposta_datas as any).p2_inicio)} a ${formatDate((sol.contraproposta_datas as any).p2_fim)}`}
                    </p>
                    {sol.parecer_coordenador && (
                      <p className="text-xs text-blue-700 dark:text-blue-400 italic">" {sol.parecer_coordenador} "</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleAceitarContra(sol.id)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                      >Aceitar Contraproposta</button>
                      <button
                        onClick={() => handleRejeitarContra(sol.id)}
                        className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-bold"
                      >Rejeitar</button>
                    </div>
                  </div>
                )}

                {/* Deferido approved periods */}
                {isDeferido && (
                  <div className="p-3 rounded-xl border border-green-200 bg-green-50 dark:bg-green-900/20 text-xs space-y-1">
                    <p className="font-bold text-green-900 dark:text-green-300 uppercase">📅 Períodos Deferidos:</p>
                    <p className="text-green-800 dark:text-green-200">
                      1º Período: <strong>{formatDate(sol.periodo_deferido_p1_inicio)} a {formatDate(sol.periodo_deferido_p1_fim)}</strong>
                      {sol.periodo_deferido_p2_inicio && ` | 2º Período: ${formatDate(sol.periodo_deferido_p2_inicio)} a ${formatDate(sol.periodo_deferido_p2_fim)}`}
                    </p>
                    {sol.parecer_coordenador && (
                      <p className="text-green-700 dark:text-green-400 italic">Parecer: {sol.parecer_coordenador}</p>
                    )}
                  </div>
                )}

                {/* Indeferido reason */}
                {isIndeferido && sol.parecer_coordenador && (
                  <div className="p-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 text-xs">
                    <p className="font-bold text-red-900 dark:text-red-300 uppercase">Motivo do Indeferimento:</p>
                    <p className="text-red-800 dark:text-red-200 mt-0.5">{sol.parecer_coordenador}</p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  {isPendente && (
                    <button
                      onClick={() => handleCancel(sol.id)}
                      className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg font-bold transition-colors"
                    >Cancelar Solicitação</button>
                  )}
                  {isDeferido && (
                    <button
                      onClick={() => handlePrint(sol.id)}
                      disabled={loadingPrint}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all shadow-sm"
                    >
                      {loadingPrint ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                      Imprimir Requerimento
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* MODAL: Nova Solicitação Wizard */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Nova Solicitação de Previsão de Férias / Licença Prêmio"
      >
        <div className="space-y-5">
          {/* Step indicator */}
          <div className="flex items-center justify-between text-xs font-bold text-zinc-400 border-b pb-3">
            <span className={step === 1 ? 'text-emerald-600 dark:text-emerald-400 font-black' : ''}>1. Tipo & Exercício</span>
            <ChevronRight className="h-4 w-4" />
            <span className={step === 2 ? 'text-emerald-600 dark:text-emerald-400 font-black' : ''}>2. Modalidade</span>
            <ChevronRight className="h-4 w-4" />
            <span className={step === 3 ? 'text-emerald-600 dark:text-emerald-400 font-black' : ''}>3. Sugestão de Datas</span>
          </div>

          {/* Inline Error Alert inside active modal */}
          {modalError && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex justify-between items-start gap-2 animate-in fade-in duration-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
                <div>
                  <p className="font-bold">Pendência na solicitação:</p>
                  <p className="mt-0.5 leading-relaxed">{modalError}</p>
                </div>
              </div>
              <button onClick={() => setModalError(null)} className="text-red-400 hover:text-red-600 font-bold p-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* STEP 1: Tipo & Exercício */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-2">Tipo de Benefício</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { setTipoBeneficio('ferias'); setModalidade('integral_30') }}
                    className={`p-4 rounded-xl border text-left font-bold transition-all ${
                      tipoBeneficio === 'ferias'
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-2 ring-emerald-500/20'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600'
                    }`}
                  >
                    🏖️ Férias Regulamentares
                    <span className="block text-xs font-normal text-zinc-500 mt-1">30 dias por exercício aquisitivo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setTipoBeneficio('licenca_premio'); setModalidade('integral_90') }}
                    className={`p-4 rounded-xl border text-left font-bold transition-all ${
                      tipoBeneficio === 'licenca_premio'
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-2 ring-emerald-500/20'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600'
                    }`}
                  >
                    🏆 Licença Prêmio
                    <span className="block text-xs font-normal text-zinc-500 mt-1">90 dias por quinquênio de assiduidade</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  {tipoBeneficio === 'ferias' ? 'Exercício Aquisitivo *' : 'Quinquênio *'}
                </label>
                <input
                  type="text"
                  placeholder={tipoBeneficio === 'ferias' ? 'ex: 2024/2025' : 'ex: 2015/2020'}
                  value={exercicio}
                  onChange={e => setExercicio(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm font-medium"
                />
                <p className="text-[10px] text-zinc-400 mt-1">Informe o período aquisitivo de referência do benefício.</p>
              </div>

              {solicExistente && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-300 space-y-1 animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-200">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>Exercício com solicitação ativa ou deferida</span>
                  </div>
                  <p className="leading-relaxed">
                    Você já possui uma solicitação de <strong>{tipoBeneficio === 'ferias' ? 'Férias' : 'Licença Prêmio'}</strong>{' '}
                    <span className="underline decoration-amber-500 font-semibold">
                      {solicExistente.status === 'deferido' ? 'deferida' : solicExistente.status === 'contraproposta' ? 'em contraproposta' : 'em análise'}
                    </span> para o {tipoBeneficio === 'ferias' ? 'exercício' : 'quinquênio'} <strong>{exercicio.trim()}</strong>. Não é permitido cadastrar uma nova solicitação para o mesmo período aquisitivo.
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={!exercicio.trim() || !!solicExistente}
                  onClick={() => setStep(2)}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >Próximo Passo →</button>
              </div>
            </div>
          )}

          {/* STEP 2: Modalidade */}
          {step === 2 && (
            <div className="space-y-4">
              <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-2">Formato / Modalidade de Gozo</label>
              
              {tipoBeneficio === 'ferias' ? (
                <div className="space-y-2">
                  {[
                    { id: 'integral_30', title: 'Integral (30 dias corridos)', desc: 'Gozo contínuo de 30 dias. Exige sugestão alternativa de fracionamento 15/15.' },
                    { id: 'fracionado_15_15', title: 'Fracionado (15 + 15 dias)', desc: 'Dividido em 2 períodos de 15 dias de gozo.' },
                    { id: 'abono_10_20', title: 'Abono Pecuniário (10 dias abono + 20 dias gozo)', desc: 'Venda de 10 dias com 20 dias corridos de descanso.' },
                  ].map(item => (
                    <label key={item.id} className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      modalidade === item.id ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200' : 'border-zinc-200 dark:border-zinc-700'
                    }`}>
                      <input type="radio" name="mod" checked={modalidade === item.id} onChange={() => setModalidade(item.id)} className="mt-1 text-emerald-600" />
                      <div>
                        <p className="font-bold text-sm">{item.title}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{item.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {[
                    { id: 'integral_90', title: 'Integral (90 dias corridos)', desc: 'Gozo contínuo de 90 dias.' },
                    { id: 'fracionado_45_45', title: 'Fracionado (45 + 45 dias)', desc: 'Dividido em 2 períodos de 45 dias de gozo.' },
                  ].map(item => (
                    <label key={item.id} className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      modalidade === item.id ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200' : 'border-zinc-200 dark:border-zinc-700'
                    }`}>
                      <input type="radio" name="mod" checked={modalidade === item.id} onChange={() => setModalidade(item.id)} className="mt-1 text-emerald-600" />
                      <div>
                        <p className="font-bold text-sm">{item.title}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{item.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Checkbox Adicional 1/3 */}
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={adicionalTerco}
                    onChange={e => setAdicionalTerco(e.target.checked)}
                    className="rounded text-emerald-600"
                  />
                  Solicitar pagamento do Adicional Constitucional de 1/3 de Férias
                </label>
              </div>

              <div className="flex justify-between pt-2">
                <button type="button" onClick={() => setStep(1)} className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-800">← Voltar</button>
                <button type="button" onClick={() => setStep(3)} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-700">Próximo Passo →</button>
              </div>
            </div>
          )}

          {/* STEP 3: Sugestão de Datas */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                <p className="font-bold">⚠️ Regra de Antecedência Mínima (60 dias):</p>
                <p className="mt-0.5">As solicitações devem ser enviadas com pelo menos 60 dias de antecedência. Data mínima recomendada: <strong>{formatDate(minDateLimit)}</strong>.</p>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Quantas opções de datas você quer sugerir?</label>
                <select
                  value={numOpcoes}
                  onChange={e => setNumOpcoes(Number(e.target.value))}
                  className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold"
                >
                  <option value={1}>1 Opção</option>
                  <option value={2}>2 Opções</option>
                  <option value={3}>3 Opções</option>
                </select>
              </div>

              {/* OPÇÃO 1 */}
              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 space-y-3 bg-zinc-50/50 dark:bg-zinc-800/40">
                <p className="font-bold text-xs uppercase tracking-wider text-emerald-600">Opção 1 (Preferencial)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-500 font-bold mb-1">1º Período - Data Início *</label>
                    <input type="date" min={minDateLimit} value={p1Inicio1} onChange={e => setP1Inicio1(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                    {p1Inicio1 && <p className="text-[10px] text-zinc-400 mt-1">Fim calculado: {formatDate(addDays(p1Inicio1, dur.p1))}</p>}
                  </div>
                  {dur.p2 && (
                    <div>
                      <label className="block text-[11px] text-zinc-500 font-bold mb-1">2º Período - Data Início *</label>
                      <input type="date" min={minDateLimit} value={p2Inicio1} onChange={e => setP2Inicio1(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                      {p2Inicio1 && <p className="text-[10px] text-zinc-400 mt-1">Fim calculado: {formatDate(addDays(p2Inicio1, dur.p2))}</p>}
                    </div>
                  )}
                </div>
              </div>

              {/* OPÇÃO 2 */}
              {numOpcoes >= 2 && (
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 space-y-3 bg-zinc-50/50 dark:bg-zinc-800/40">
                  <p className="font-bold text-xs uppercase tracking-wider text-blue-600">Opção 2 (Segunda Escolha)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500 font-bold mb-1">1º Período - Data Início *</label>
                      <input type="date" min={minDateLimit} value={p1Inicio2} onChange={e => setP1Inicio2(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                      {p1Inicio2 && <p className="text-[10px] text-zinc-400 mt-1">Fim calculado: {formatDate(addDays(p1Inicio2, dur.p1))}</p>}
                    </div>
                    {dur.p2 && (
                      <div>
                        <label className="block text-[11px] text-zinc-500 font-bold mb-1">2º Período - Data Início *</label>
                        <input type="date" min={minDateLimit} value={p2Inicio2} onChange={e => setP2Inicio2(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                        {p2Inicio2 && <p className="text-[10px] text-zinc-400 mt-1">Fim calculado: {formatDate(addDays(p2Inicio2, dur.p2))}</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* OPÇÃO 3 */}
              {numOpcoes >= 3 && (
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 space-y-3 bg-zinc-50/50 dark:bg-zinc-800/40">
                  <p className="font-bold text-xs uppercase tracking-wider text-purple-600">Opção 3 (Terceira Escolha)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500 font-bold mb-1">1º Período - Data Início *</label>
                      <input type="date" min={minDateLimit} value={p1Inicio3} onChange={e => setP1Inicio3(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                      {p1Inicio3 && <p className="text-[10px] text-zinc-400 mt-1">Fim calculado: {formatDate(addDays(p1Inicio3, dur.p1))}</p>}
                    </div>
                    {dur.p2 && (
                      <div>
                        <label className="block text-[11px] text-zinc-500 font-bold mb-1">2º Período - Data Início *</label>
                        <input type="date" min={minDateLimit} value={p2Inicio3} onChange={e => setP2Inicio3(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                        {p2Inicio3 && <p className="text-[10px] text-zinc-400 mt-1">Fim calculado: {formatDate(addDays(p2Inicio3, dur.p2))}</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sugestão de fracionamento para integral_30 */}
              {modalidade === 'integral_30' && (
                <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 space-y-3">
                  <p className="font-bold text-xs text-amber-900 dark:text-amber-300">
                    💡 Sugestão Obrigatória de Fracionamento 15/15 (caso a chefia opte por não conceder 30 dias corridos):
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-amber-800 font-bold mb-1">Sugestão 1º Período (15d) *</label>
                      <input type="date" min={minDateLimit} value={sugP1Inicio} onChange={e => setSugP1Inicio(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-amber-800 font-bold mb-1">Sugestão 2º Período (15d) *</label>
                      <input type="date" min={minDateLimit} value={sugP2Inicio} onChange={e => setSugP2Inicio(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-xs bg-white dark:bg-zinc-800 font-medium" />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Observações adicionais (opcional)</label>
                <textarea
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)}
                  rows={2}
                  placeholder="Alguma observação importante para a coordenação..."
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs resize-none"
                />
              </div>

              <div className="flex justify-between pt-2">
                <button type="button" onClick={() => setStep(2)} className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-800">← Voltar</button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || !p1Inicio1}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enviar Solicitação
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL: Inelegibilidade / Dados Cadastrais Incompletos */}
      <Modal
        isOpen={showIneligibleModal}
        onClose={() => setShowIneligibleModal(false)}
        title="Dados Cadastrais Incompletos"
        type="warning"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <p className="font-bold">Atenção: Não é possível solicitar férias ou licença no momento.</p>
              <p>Para gerar o requerimento oficial com validade jurídica, seus dados cadastrais essenciais precisam estar atualizados no sistema.</p>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              Campos ausentes no seu cadastro:
            </h4>
            <div className="space-y-1.5">
              {ineligibleData?.camposFaltantes.map((campo, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-lg text-xs font-semibold text-red-700 dark:text-red-300">
                  <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                  <span>{campo}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/60 text-xs space-y-2">
            <p className="font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
              <Info className="h-4 w-4 text-blue-500" />
              Orientações para Regularização:
            </p>
            <ol className="list-decimal list-inside text-zinc-600 dark:text-zinc-400 space-y-1.5 pl-1">
              <li>Procure o <strong>Setor de RH / Gestão de Pessoas</strong> da sua unidade ou Secretaria de Saúde.</li>
              <li>Apresente seus documentos pessoais (RG, CPF, Comprovante de Matrícula/Portaria).</li>
              <li>Solicite a atualização da sua ficha de cadastro no <strong>SisEscala</strong>.</li>
            </ol>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 italic pt-1 border-t border-zinc-200/60 dark:border-zinc-700/60">
              Assim que os dados forem gravados pelo RH, a opção de Nova Solicitação será liberada imediatamente para você.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={() => setShowIneligibleModal(false)}
              className="px-5 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all shadow-sm"
            >
              Entendido
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Erro na Validação da Solicitação (Sobreposto z-110) */}
      <Modal
        isOpen={showSubmissionErrorModal}
        onClose={() => setShowSubmissionErrorModal(false)}
        title="Não foi possível enviar a solicitação"
        type="danger"
        zIndexClass="z-[110]"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-900 dark:text-red-200 space-y-1.5">
              <p className="font-bold text-sm">Pendência identificada:</p>
              <p className="leading-relaxed font-medium">{modalError}</p>
            </div>
          </div>

          <div className="p-3.5 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/60 text-xs text-zinc-600 dark:text-zinc-300">
            <p className="font-bold text-zinc-800 dark:text-zinc-200 mb-1 flex items-center gap-1.5">
              <Info className="h-4 w-4 text-blue-500" />
              O que fazer agora?
            </p>
            <p>Sua solicitação continua aberta com todas as informações preenchidas. Clique em <strong>Corrigir Solicitação</strong> para ajustar as datas/campos e tentar novamente.</p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={() => setShowSubmissionErrorModal(false)}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95"
            >
              Corrigir Solicitação
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
