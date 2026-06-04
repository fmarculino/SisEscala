'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, Printer, Save, RefreshCw, AlertTriangle, 
  Check, Loader2, Building2, Users, Calendar, Briefcase, 
  Clock, FileText, CheckSquare, X
} from 'lucide-react'
import { salvarFolhaPonto, verificarDivergenciaEscala, sincronizarFolhaPonto, gerarFolhaPonto } from '../actions'
import { Modal } from '@/components/ui/Modal'

function formatMinutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface FolhaPontoEditorProps {
  folha: any
  profile: any
  isPortal?: boolean
  onBack?: () => void
  saveAction?: (folhaId: string, registros: any[], status?: string) => Promise<{ success?: boolean; error?: string }>
  verifyDivergenceAction?: (folhaId: string) => Promise<{ divergent: boolean; affectedDays?: number[]; error?: string }>
  syncAction?: (folhaId: string) => Promise<{ success?: boolean; error?: string }>
  regenerateAction?: (servidorId: string, mes: number, ano: number, isRascunho: boolean) => Promise<{ success?: boolean; error?: string }>
}

export function FolhaPontoEditor({ 
  folha, 
  profile,
  isPortal = false,
  onBack,
  saveAction,
  verifyDivergenceAction,
  syncAction,
  regenerateAction
}: FolhaPontoEditorProps) {
  const router = useRouter()

  const executeSave = saveAction || salvarFolhaPonto
  const executeVerify = verifyDivergenceAction || verificarDivergenciaEscala
  const executeSync = syncAction || sincronizarFolhaPonto
  const executeRegenerate = (servId: string, m: number, a: number, rasc: boolean) => {
    if (regenerateAction) return regenerateAction(servId, m, a, rasc)
    return gerarFolhaPonto(servId, m, a, rasc)
  }
  
  // Local state for table records
  const [registros, setRegistros] = useState<any[]>(folha.registros || [])
  const [status, setStatus] = useState<string>(folha.status)
  
  // States for loaders and actions
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [loadingDivergenca, setLoadingDivergencia] = useState(true)

  // Divergence check results
  const [divergenceInfo, setDivergenceInfo] = useState<{
    divergent: boolean
    affectedDays: number[]
  }>({ divergent: false, affectedDays: [] })
  
  const [showDivergenceBanner, setShowDivergenceBanner] = useState(true)

  // Modal alert
  const [alertModal, setAlertModal] = useState<{ 
    isOpen: boolean, 
    title: string, 
    message: string, 
    type: 'default' | 'danger' | 'success' | 'warning' 
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'default'
  })

  // Modal confirmation
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean,
    title: string,
    message: string,
    onConfirm: () => void,
    type: 'default' | 'danger' | 'warning'
  } | null>(null)

  // Unpack scale meta
  const escala = folha.escala
  const servidor = folha.servidores
  const unidade = escala.unidades
  const setor = escala.setores
  const jornada = escala.jornadas

  // Extract scheduled hours for client-side calculations
  const { startHour, startMin, endHour, endMin } = useMemo(() => {
    const defaultVal = { startHour: 8, startMin: 0, endHour: 17, endMin: 0 }
    if (!jornada?.nome) return defaultVal
    const match = jornada.nome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
    if (!match) return defaultVal
    return {
      startHour: parseInt(match[1], 10),
      startMin: match[2] ? parseInt(match[2], 10) : 0,
      endHour: parseInt(match[3], 10),
      endMin: match[4] ? parseInt(match[4], 10) : 0
    }
  }, [jornada])

  const mesExtenso = useMemo(() => {
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ]
    return meses[folha.mes - 1]
  }, [folha.mes])

  // Check scale divergence on mount
  useEffect(() => {
    async function checkDivergenca() {
      setLoadingDivergencia(true)
      const res = await executeVerify(folha.id)
      setLoadingDivergencia(false)
      if (res && res.divergent) {
        setDivergenceInfo({
          divergent: true,
          affectedDays: res.affectedDays || []
        })
      }
    }
    checkDivergenca()
  }, [folha.id])

  // Helper: Client-side overtime calculation
  const recalculateOvertimeForDay = (
    day: number,
    entrada: string,
    saida: string
  ): { minutes: number; type: '50%' | '100%' | null } => {
    if (!entrada || !saida) return { minutes: 0, type: null }
    
    try {
      const [entH, entM] = entrada.split(':').map(Number)
      const [saiH, saiM] = saida.split(':').map(Number)
      
      const scheduledEntrance = new Date(folha.ano, folha.mes - 1, day, startHour, startMin, 0, 0)
      const scheduledExit = new Date(folha.ano, folha.mes - 1, day, endHour, endMin, 0, 0)
      if (scheduledExit <= scheduledEntrance) {
        scheduledExit.setDate(scheduledExit.getDate() + 1)
      }

      let realExit = new Date(folha.ano, folha.mes - 1, day, saiH, saiM, 0, 0)
      if (saiH < entH || (saiH === entH && saiM < entM)) {
        realExit.setDate(realExit.getDate() + 1)
      }
      
      if (realExit <= scheduledExit) {
        return { minutes: 0, type: null }
      }

      let extra50Min = 0
      let extra100Min = 0
      
      const current = new Date(scheduledExit.getTime())
      const end = new Date(realExit.getTime())
      
      // Sunday is 0
      const isSunday = new Date(folha.ano, folha.mes - 1, day).getDay() === 0

      while (current < end) {
        const curHour = current.getHours()
        const curDayOfWeek = current.getDay()
        const isSun = curDayOfWeek === 0
        const isNight = curHour >= 22 || curHour < 5

        if (isSun || isSunday || isNight) {
          extra100Min++
        } else {
          extra50Min++
        }
        
        current.setMinutes(current.getMinutes() + 1)
      }

      const minutes = extra50Min + extra100Min
      const type = extra100Min > 0 ? '100%' : '50%'
      return { minutes, type }
    } catch {
      return { minutes: 0, type: null }
    }
  }

  // Handle cell edit in the local records table
  const handleCellChange = (day: number, field: string, value: any) => {
    setRegistros(prev => prev.map(r => {
      if (r.dia !== day) return r

      const updated = { ...r }
      updated[field] = value

      // Mark the edited cell's source origin to 'manual'
      if (field === 'entrada') updated.origem_entrada = 'manual'
      if (field === 'saida_intervalo') updated.origem_saida_intervalo = 'manual'
      if (field === 'retorno_intervalo') updated.origem_retorno_intervalo = 'manual'
      if (field === 'saida') updated.origem_saida = 'manual'

      // If entrance/exit changed, dynamically compute overtime
      if (field === 'entrada' || field === 'saida') {
        const ent = field === 'entrada' ? value : r.entrada
        const sai = field === 'saida' ? value : r.saida
        const ot = recalculateOvertimeForDay(day, ent, sai)
        updated.hora_extra_minutos = ot.minutes
        updated.hora_extra_tipo = ot.type
      }

      return updated
    }))
  }

  // Save edits
  const handleSave = async (newStatus?: string) => {
    setSaving(true)
    const targetStatus = newStatus || status
    const res = await executeSave(folha.id, registros, targetStatus)
    setSaving(false)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Salvar',
        message: res.error,
        type: 'danger'
      })
    } else {
      setAlertModal({
        isOpen: true,
        title: 'Sucesso',
        message: 'Alterações salvas com sucesso!',
        type: 'success'
      })
      if (newStatus) setStatus(newStatus)
      router.refresh()
    }
  }

  // Sync scale after a scale modification
  const handleSync = async () => {
    setSyncing(true)
    const res = await executeSync(folha.id)
    setSyncing(false)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro na Sincronização',
        message: res.error,
        type: 'danger'
      })
    } else {
      setAlertModal({
        isOpen: true,
        title: 'Sincronizado',
        message: 'A folha de ponto foi sincronizada com a escala atual. Edições manuais em dias não afetados foram preservadas.',
        type: 'success'
      })
      setDivergenceInfo({ divergent: false, affectedDays: [] })
      router.refresh()
      // Reload records from backend
      setTimeout(() => window.location.reload(), 1000)
    }
  }

  // Regenerate sheet completely (overwrites manual edits)
  const handleRegenerar = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Confirmar Regeneração',
      message: 'Esta ação irá apagar TODOS os horários manuais e observações digitadas para esta folha de ponto e regerá o documento do zero. Deseja continuar?',
      type: 'warning',
      onConfirm: async () => {
        setConfirmModal(null)
        setRegenerating(true)
        const isRascunho = status === 'Rascunho'
        const res = await executeRegenerate(servidor.id, folha.mes, folha.ano, isRascunho)
        setRegenerating(false)
        if (res.error) {
          setAlertModal({
            isOpen: true,
            title: 'Erro ao Regenerar',
            message: res.error,
            type: 'danger'
          })
        } else {
          setAlertModal({
            isOpen: true,
            title: 'Regenerada',
            message: 'Folha de ponto regenerada do zero com sucesso.',
            type: 'success'
          })
          router.refresh()
          setTimeout(() => window.location.reload(), 1000)
        }
      }
    })
  }

  // UI calculations of dynamic totals
  const totalizers = useMemo(() => {
    let normais = 0
    let extra50 = 0
    let extra100 = 0
    let faltas = 0

    registros.forEach(r => {
      if (r.turno_codigo) {
        normais += (jornada?.horas_totais || 8)
      }
      if (r.observacao && r.observacao.toUpperCase().includes('FALTA')) {
        faltas++
      }
      if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
        const isSun = new Date(folha.ano, folha.mes - 1, r.dia).getDay() === 0
        const isHol = r.feriado
        if (isSun || isHol || r.hora_extra_tipo === '100%') {
          extra100 += r.hora_extra_minutos
        } else {
          extra50 += r.hora_extra_minutos
        }
      }
    })

    return {
      horasNormais: normais.toFixed(1),
      horas50: (extra50 / 60).toFixed(1),
      horas100: (extra100 / 60).toFixed(1),
      faltas
    }
  }, [registros, jornada, folha.ano, folha.mes])

  // Custom function to open browser print dialog
  const handlePrint = () => {
    window.print()
  }

  const borderClass = (origin: string) => {
    if (origin === 'real') return 'border-l-4 border-l-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10'
    if (origin === 'ficticio') return 'border-l-4 border-l-blue-400 border-dashed bg-blue-50/10 dark:bg-blue-950/5'
    if (origin === 'manual') return 'border-l-4 border-l-amber-500 bg-amber-50/20 dark:bg-amber-950/10'
    return 'border-l-4 border-l-zinc-200 dark:border-l-zinc-800'
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 pb-32 print:p-0 print:max-w-none print:pb-0">
      
      {/* Print styles overrides */}
      <style jsx global>{`
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          .dashboard-layout-nav, .sidebar-container, .print-hidden, header, footer, button, nav, input[type="checkbox"] {
            display: none !important;
          }
          .print-full-width {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }
          input, select, textarea {
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            font-size: 8px !important;
            font-weight: bold !important;
            width: auto !important;
            pointer-events: none !important;
            appearance: none !important;
            color: black !important;
          }
          /* Hide time clock picker indicator in webkit */
          input[type="time"]::-webkit-calendar-picker-indicator {
            display: none !important;
          }
          .print-cell-border {
            border: 1px solid #71717a !important;
          }
          .border-l-4 {
            border-left-width: 1px !important;
            border-left-color: #e4e4e7 !important;
          }
          tr {
            page-break-inside: avoid !important;
          }
          table {
            border-collapse: collapse !important;
            width: 100% !important;
          }
          th, td {
            border: 1px solid #a1a1aa !important;
            padding: 4px 6px !important;
          }
        }
      `}</style>

      {/* Header - Hidden on Print */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-4">
          {isPortal ? (
            <button 
              onClick={onBack}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors print:hidden"
            >
              <ArrowLeft className="h-5 w-5 text-zinc-500" />
            </button>
          ) : (
            <Link href="/folha-ponto" className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
              <ArrowLeft className="h-5 w-5 text-zinc-500" />
            </Link>
          )}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 rounded-lg text-white shadow-lg shadow-blue-600/20">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-zinc-900 dark:text-white uppercase flex items-center gap-2">
                Folha de Ponto 
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                  status === 'Revisada' ? 'bg-green-150 text-green-700 dark:bg-green-950 dark:text-green-400' :
                  status === 'Gerada' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/45 dark:text-blue-400' :
                  'bg-amber-100 text-amber-700 dark:bg-amber-900/45 dark:text-amber-400'
                }`}>
                  {status}
                </span>
              </h1>
              <p className="text-zinc-500 text-xs">Visualização e edição do espelho de ponto individual.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Regenerar */}
          <button 
            onClick={handleRegenerar}
            disabled={regenerating || saving || syncing}
            className="inline-flex items-center bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all disabled:opacity-50"
            title="Regera a folha limpando todas as edições manuais."
          >
            {regenerating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            Regenerar
          </button>
          
          {/* Print */}
          <button 
            onClick={handlePrint}
            className="inline-flex items-center bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Imprimir
          </button>

          {/* Salvar */}
          <button 
            onClick={() => handleSave()}
            disabled={saving || regenerating || syncing}
            className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
            Salvar
          </button>

          {/* Fechar/Revisar */}
          {!isPortal && status === 'Rascunho' && (
            <button 
              onClick={() => handleSave('Gerada')}
              disabled={saving}
              className="inline-flex items-center bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-green-500/20 active:scale-95"
            >
              <CheckSquare className="h-4 w-4 mr-1.5" />
              Finalizar
            </button>
          )}
          {!isPortal && status === 'Gerada' && (
            <button 
              onClick={() => handleSave('Revisada')}
              disabled={saving}
              className="inline-flex items-center bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-500/20 active:scale-95"
            >
              <Check className="h-4 w-4 mr-1.5" />
              Revisar/Fechar
            </button>
          )}
        </div>
      </div>

      {/* Divergence warning banner - Hidden on Print */}
      {divergenceInfo.divergent && showDivergenceBanner && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-3xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-300 print:hidden">
          <div className="flex gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-500 shrink-0" />
            <div>
              <h4 className="font-black text-amber-900 dark:text-amber-300 uppercase text-sm tracking-tight">Alterações na escala detectadas!</h4>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                A escala regular deste servidor sofreu alterações após a geração deste documento. 
                Os dias afetados foram: <strong className="font-bold">{divergenceInfo.affectedDays.join(', ')}</strong>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-end md:self-auto">
            <button 
              onClick={handleSync}
              disabled={syncing}
              className="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2 rounded-xl transition-all shadow-md"
            >
              {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Sincronizar
            </button>
            <button 
              onClick={() => setShowDivergenceBanner(false)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1.5 rounded-lg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Timesheet Document Wrapper */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden print-full-width">
        
        {/* Document Header */}
        <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 print:bg-white print:border-zinc-300 print:p-4">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
            <div className="flex items-center gap-4">
              {/* Unit/Sector logo */}
              {(setor?.logo_url || unidade?.logo_url) && (
                <div className="h-14 w-28 border border-zinc-200 dark:border-zinc-800 rounded-lg p-1 bg-white flex items-center justify-center">
                  <img 
                    src={setor?.logo_url || unidade?.logo_url} 
                    alt="Logo municipal" 
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
              <div className="space-y-0.5">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-blue-600 print:text-black">Prefeitura Municipal</h2>
                <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase print:text-black tracking-tight">Folha de Ponto Mensal</h3>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider print:text-zinc-500">Espelho Oficial de Frequência Individual</p>
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-[9px] font-black uppercase text-zinc-400">Competência</div>
              <div className="text-lg font-bold text-zinc-900 dark:text-white uppercase print:text-black">
                {mesExtenso} / {folha.ano}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-xs print:grid-cols-4 print:gap-4 print:text-[8px]">
            <div>
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Servidor</div>
              <div className="font-bold text-zinc-900 dark:text-white uppercase">{servidor.nome}</div>
              <div className="text-[10px] text-zinc-500 font-bold">Matrícula: {servidor.matricula || '---'}</div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Cargo / Vínculo</div>
              <div className="font-bold text-zinc-900 dark:text-white uppercase">{servidor.cargo || '---'}</div>
              <div className="text-[10px] text-zinc-500">{servidor.vinculo || '---'}</div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Unidade</div>
              <div className="font-bold text-zinc-900 dark:text-white uppercase">{unidade.nome}</div>
              <div className="text-[10px] text-zinc-500 truncate">{unidade.endereco || '---'}</div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-0.5">Setor / Jornada</div>
              <div className="font-bold text-zinc-900 dark:text-white uppercase">{setor?.nome}</div>
              <div className="text-[10px] text-zinc-500">{jornada?.nome || 'Não Vinculada'}</div>
            </div>
          </div>
        </div>

        {/* Legend for origins - Hidden on Print */}
        <div className="px-8 py-3 bg-zinc-100/50 dark:bg-zinc-800/20 border-b border-zinc-200/50 dark:border-zinc-800 flex gap-6 text-[10px] font-bold text-zinc-500 print:hidden select-none">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block"></span> Real (Confirmação)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-blue-400 inline-block"></span> Fictício (Variação Determinística)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block"></span> Ajustado Manualmente
          </div>
        </div>

        {/* Timesheet Entries Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse print:text-[8px]">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-black uppercase tracking-widest border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-3 py-2 text-center w-12 border-r border-zinc-200 dark:border-zinc-700">Dia</th>
                <th className="px-2 py-2 text-center w-12 border-r border-zinc-200 dark:border-zinc-700">Sem</th>
                <th className="px-3 py-2 text-center w-24 border-r border-zinc-200 dark:border-zinc-700">Entrada</th>
                <th className="px-3 py-2 text-center w-24 border-r border-zinc-200 dark:border-zinc-700">Saída Int.</th>
                <th className="px-3 py-2 text-center w-24 border-r border-zinc-200 dark:border-zinc-700">Retorno Int.</th>
                <th className="px-3 py-2 text-center w-24 border-r border-zinc-200 dark:border-zinc-700">Saída</th>
                <th className="px-3 py-2 text-center w-20 border-r border-zinc-200 dark:border-zinc-700">Extra</th>
                <th className="px-4 py-2 border-r border-zinc-200 dark:border-zinc-700">Observações / Justificativas</th>
                <th className="px-3 py-2 text-center w-24">Visto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {registros.map(r => {
                const isWorkDay = !!r.turno_codigo
                const isWeekend = r.dia_semana === 'Sáb' || r.dia_semana === 'Dom'
                const isOffDay = r.feriado || r.afastamento || !isWorkDay

                return (
                  <tr 
                    key={r.dia} 
                    className={`
                      ${isOffDay ? 'bg-zinc-50/50 dark:bg-zinc-800/10' : ''}
                      ${isWeekend && !isOffDay ? 'bg-zinc-50/30 dark:bg-zinc-850/5' : ''}
                    `}
                  >
                    {/* Dia */}
                    <td className="px-3 py-2 border-r border-zinc-200 dark:border-zinc-700 text-center font-black text-zinc-950 dark:text-zinc-200">
                      {String(r.dia).padStart(2, '0')}
                    </td>
                    
                    {/* Dia da semana */}
                    <td className="px-2 py-2 border-r border-zinc-200 dark:border-zinc-700 text-center font-bold text-zinc-500">
                      {r.dia_semana}
                    </td>

                    {/* Entrada */}
                    <td className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center ${isWorkDay ? borderClass(r.origem_entrada) : ''}`}>
                      {isWorkDay && !r.afastamento && !r.feriado ? (
                        <input 
                          type="time" 
                          value={r.entrada || ''} 
                          onChange={(e) => handleCellChange(r.dia, 'entrada', e.target.value)}
                          className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono"
                        />
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Saída Intervalo */}
                    <td className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center ${isWorkDay && r.saida_intervalo ? borderClass(r.origem_saida_intervalo) : ''}`}>
                      {isWorkDay && r.saida_intervalo && !r.afastamento && !r.feriado ? (
                        <input 
                          type="time" 
                          value={r.saida_intervalo || ''} 
                          onChange={(e) => handleCellChange(r.dia, 'saida_intervalo', e.target.value)}
                          className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono"
                        />
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Retorno Intervalo */}
                    <td className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center ${isWorkDay && r.retorno_intervalo ? borderClass(r.origem_retorno_intervalo) : ''}`}>
                      {isWorkDay && r.retorno_intervalo && !r.afastamento && !r.feriado ? (
                        <input 
                          type="time" 
                          value={r.retorno_intervalo || ''} 
                          onChange={(e) => handleCellChange(r.dia, 'retorno_intervalo', e.target.value)}
                          className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono"
                        />
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Saída */}
                    <td className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center ${isWorkDay ? borderClass(r.origem_saida) : ''}`}>
                      {isWorkDay && !r.afastamento && !r.feriado ? (
                        <input 
                          type="time" 
                          value={r.saida || ''} 
                          onChange={(e) => handleCellChange(r.dia, 'saida', e.target.value)}
                          className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono"
                        />
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Hora Extra */}
                    <td className="px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center font-mono">
                      {isWorkDay && r.hora_extra_minutos && r.hora_extra_minutos > 0 ? (
                        <div className="flex flex-col items-center justify-center print:block">
                          <span className="font-bold text-blue-600 dark:text-blue-400">
                            {formatMinutesToTimeStr(r.hora_extra_minutos)}
                          </span>
                          <span className="text-[8px] font-black text-zinc-400 mt-0.5 print:hidden">
                            ({r.hora_extra_tipo || '50%'})
                          </span>
                        </div>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Observações */}
                    <td className="px-3 py-1.5 border-r border-zinc-200 dark:border-zinc-700 font-medium">
                      <input 
                        type="text" 
                        value={r.observacao || ''} 
                        onChange={(e) => handleCellChange(r.dia, 'observacao', e.target.value)}
                        className="w-full bg-transparent border-none text-left outline-none text-zinc-700 dark:text-zinc-300 font-semibold"
                        placeholder={isOffDay ? '' : 'Digitar observação...'}
                      />
                    </td>

                    {/* Visto (Assinatura Rubrica) */}
                    <td className="px-2 py-1.5 text-center text-zinc-300 print-cell-border">
                      {/* Espaço em branco para rubrica na folha impressa */}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Document Footer (Totalizers) */}
        <div className="p-8 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 print:bg-white print:border-zinc-300 print:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-10 text-center print:mb-6">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl print:border-zinc-300 print:p-2">
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Horas Normais</div>
              <div className="text-2xl font-black text-zinc-900 dark:text-white print:text-lg">
                {totalizers.horasNormais}h
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl print:border-zinc-300 print:p-2">
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Horas Extra (50%)</div>
              <div className="text-2xl font-black text-blue-600 dark:text-blue-400 print:text-lg">
                {totalizers.horas50}h
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl print:border-zinc-300 print:p-2">
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Horas Extra (100%)</div>
              <div className="text-2xl font-black text-violet-600 dark:text-violet-400 print:text-lg">
                {totalizers.horas100}h
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl print:border-zinc-300 print:p-2">
              <div className="text-[9px] font-black uppercase text-zinc-400 mb-1">Total Faltas</div>
              <div className="text-2xl font-black text-red-500 print:text-lg">
                {totalizers.faltas}
              </div>
            </div>
          </div>

          {/* Hand Signatures lines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 mt-12 px-6 print:grid-cols-2 print:gap-10 print:mt-10 print:px-0">
            <div className="text-center space-y-2">
              <div className="w-full border-t border-zinc-400 dark:border-zinc-700 pt-3">
                <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white print:text-[8px]">{servidor.nome}</div>
                <div className="text-[8px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Assinatura do Servidor</div>
              </div>
            </div>
            <div className="text-center space-y-2">
              <div className="w-full border-t border-zinc-400 dark:border-zinc-700 pt-3">
                <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white print:text-[8px]">Chefia Imediata / Coordenação</div>
                <div className="text-[8px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Carimbo e Assinatura</div>
              </div>
            </div>
          </div>
          
          {/* Print Metadata */}
          <div className="hidden print:block text-right text-[6px] text-zinc-400 mt-12">
            Documento emitido digitalmente via SisEscala. Data da emissão: {new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR')}.
          </div>
        </div>
      </div>

      {/* Alert Modal */}
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

      {/* Confirm Modal */}
      {confirmModal && (
        <Modal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(null)}
          title={confirmModal.title}
          type={confirmModal.type as any}
          footer={
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-black uppercase tracking-widest text-[10px]"
              >
                Cancelar
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`flex-1 px-4 py-2 rounded-xl text-white font-bold text-[10px] uppercase tracking-widest ${
                  confirmModal.type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 
                  confirmModal.type === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                Confirmar
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{confirmModal.message}</p>
        </Modal>
      )}
    </div>
  )
}
