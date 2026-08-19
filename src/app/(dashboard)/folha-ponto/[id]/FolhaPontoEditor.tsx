'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, Printer, Save, RefreshCw, AlertTriangle, 
  Check, Loader2, Building2, Users, Calendar, Briefcase, 
  Clock, FileText, CheckSquare, X, Unlock, PhoneCall, ShieldCheck, Wand2
} from 'lucide-react'
import { salvarFolhaPonto, verificarDivergenciaEscala, sincronizarFolhaPonto, gerarFolhaPonto, reclassificarPassoPresenca, getDadosPlantoesSobreavisosServidor, autoCorrigirFolhaPonto } from '../actions'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/utils/supabase/client'
import { isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'
import { sequenciarDia, temViradaDeDia } from '@/utils/folha/sequenciaDia'
import { RelatorioPlantaoSobreavisoAnexo } from '@/components/reports/RelatorioPlantaoSobreavisoAnexo'

function formatMinutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Marcador de que aquela batida ocorreu no dia seguinte ao da linha da folha.
 *
 * A linha da folha é o dia em que a JORNADA COMEÇOU — é assim que a Portaria 671/2021 espera o
 * espelho, com o par entrada→saída inteiro, e é o oposto de partir o plantão em duas linhas
 * (uma até 00:00, outra a partir de 00:01), que produziria dois registros incompletos.
 */
function MarcadorDiaSeguinte({ passo }: { passo: string }) {
  return (
    <span
      className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-1 py-0.2 rounded border border-indigo-200 dark:border-indigo-800 ml-0.5 print:text-[8px] print:text-zinc-600 print:border-none print:ml-0.5"
      title={`Marcação de ${passo} realizada no dia seguinte (jornada que cruza a meia-noite)`}
    >
      +1d
    </span>
  )
}

interface FolhaPontoEditorProps {
  folha: any
  profile: any
  isPortal?: boolean
  /**
   * Portal: abre a solicitação de ajuste para o dia. O servidor não edita a folha oficial —
   * ele informa o horário e o coordenador decide. Ver fn_solicitar_ajuste_ponto
   * (20260808130000) e a precedência 4 de `ajuste_servidor`.
   */
  onSolicitarAjuste?: (dia: number) => void
  onBack?: () => void
  saveAction?: (folhaId: string, registros: any[], status?: string, cargo?: string) => Promise<{ success?: boolean; error?: string }>
  verifyDivergenceAction?: (folhaId: string) => Promise<{ divergent: boolean; affectedDays?: number[]; error?: string }>
  syncAction?: (folhaId: string) => Promise<{ success?: boolean; error?: string }>
  regenerateAction?: (servidorId: string, mes: number, ano: number, isRascunho: boolean) => Promise<{ success?: boolean; error?: string }>
}

export function FolhaPontoEditor({ 
  folha, 
  profile,
  isPortal = false,
  onSolicitarAjuste,
  onBack,
  saveAction,
  verifyDivergenceAction,
  syncAction,
  regenerateAction
}: FolhaPontoEditorProps) {
  const router = useRouter()
  const [instituicaoCabecalhoUrl, setInstituicaoCabecalhoUrl] = useState<string>('')
  const [closedPeriods, setClosedPeriods] = useState<any[]>([])
  const supabase = createClient()

  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    async function fetchConfigs() {
      const { data: logoData } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'instituicao_cabecalho_url')
        .single()
      if (logoData?.valor) {
        setInstituicaoCabecalhoUrl(logoData.valor)
      }

      const { data: closedData } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'competencias_encerradas')
        .single()
      if (closedData?.valor && Array.isArray(closedData.valor)) {
        setClosedPeriods(closedData.valor)
      }
    }
    fetchConfigs()
  }, [])

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
  const [cargo, setCargo] = useState<string>(folha.cargo || folha.servidores?.cargo || '')

  const isCompetenciaEncerrada = useMemo(() => {
    return closedPeriods.some((p: any) => p.mes === folha.mes && p.ano === folha.ano)
  }, [closedPeriods, folha.mes, folha.ano])

  // Último dia já ocorrido no mês/ano da folha. Não faz sentido "informar horário" de um dia
  // que ainda não aconteceu — a solicitação existe para justificar algo que já ocorreu fora do
  // esperado, não para pré-registrar o futuro. Mesmo critério de maxValidDay em ScaleGrid.tsx.
  const ultimoDiaOcorrido = useMemo(() => {
    const hoje = new Date()
    const anoAtual = hoje.getFullYear()
    const mesAtual = hoje.getMonth() + 1
    if (folha.ano < anoAtual || (folha.ano === anoAtual && folha.mes < mesAtual)) {
      return 31 // mes inteiramente no passado: todo dia ja ocorreu
    }
    if (folha.ano === anoAtual && folha.mes === mesAtual) {
      return hoje.getDate()
    }
    return 0 // mes futuro: nenhum dia ocorreu ainda
  }, [folha.mes, folha.ano])

  const isEditable = status !== 'Revisada' && !isCompetenciaEncerrada
  
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

  // Reclassificação de passo (arrastar uma batida real pro campo certo, ex.: uma "saída" que
  // caiu em "saída intervalo" porque o servidor trabalhou direto). Ferramenta de coordenação —
  // nunca aparece no Portal do Servidor. Mesma régua de quem já mexe em escala_diaria por
  // validação manual (hasSectorAccess), não a regra mais estrita (só super_admin) que já existe
  // pra digitar por cima de uma célula real — esta é mais segura que aquela: só move um horário
  // real já existente, nunca fabrica um novo.
  const PASSO_LABEL: Record<string, string> = {
    entrada: 'Entrada',
    saida_intervalo: 'Saída Intervalo',
    retorno_intervalo: 'Retorno Intervalo',
    saida: 'Saída',
  }
  // Nome do campo na folha (`saida_intervalo`) não é o mesmo texto do passo canônico que a
  // Server Action espera (`intervalo_saida`, definido em origemMarcacao.ts) — ponto fácil de
  // escorregar um bug de digitação.
  const PASSO_CANONICO: Record<string, 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida'> = {
    entrada: 'entrada',
    saida_intervalo: 'intervalo_saida',
    retorno_intervalo: 'intervalo_retorno',
    saida: 'saida',
  }
  const podeReclassificar =
    !isPortal && isEditable &&
    ['coordenador', 'ass_adm', 'admin', 'super_admin', 'rh', 'rh_unidade'].includes(profile?.role)

  const [draggingFrom, setDraggingFrom] = useState<{ dia: number; passo: string } | null>(null)
  const [reclassifyModal, setReclassifyModal] = useState<{
    dia: number
    passoOrigem: string
    passoDestino: string
    horario: string
    justificativa: string
    submitting: boolean
  } | null>(null)

  const handleDrop = (dia: number, passoDestino: string) => {
    if (!draggingFrom || draggingFrom.dia !== dia || draggingFrom.passo === passoDestino) return
    const registro = registros.find(r => r.dia === dia)
    setReclassifyModal({
      dia,
      passoOrigem: draggingFrom.passo,
      passoDestino,
      horario: registro?.[draggingFrom.passo] || '',
      justificativa: '',
      submitting: false,
    })
    setDraggingFrom(null)
  }

  const confirmarReclassificacao = async () => {
    if (!reclassifyModal || reclassifyModal.justificativa.trim().length < 5) return
    setReclassifyModal({ ...reclassifyModal, submitting: true })
    const res = await reclassificarPassoPresenca(
      folha.id,
      reclassifyModal.dia,
      PASSO_CANONICO[reclassifyModal.passoOrigem],
      PASSO_CANONICO[reclassifyModal.passoDestino],
      reclassifyModal.justificativa.trim()
    )
    if (res.error) {
      setReclassifyModal(null)
      setAlertModal({ isOpen: true, title: 'Erro ao Corrigir', message: res.error, type: 'danger' })
      return
    }
    setReclassifyModal(null)
    setAlertModal({
      isOpen: true,
      title: 'Marcação Corrigida',
      message: (res as any).warning || 'A batida foi movida para o passo correto — a escala e a folha já refletem a correção.',
      type: (res as any).warning ? 'warning' : 'success',
    })
    router.refresh()
    setTimeout(() => window.location.reload(), 1000)
  }

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
      
      const scheduledEntrance = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00-03:00`)
      const scheduledExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00-03:00`)
      if (scheduledExit <= scheduledEntrance) {
        scheduledExit.setDate(scheduledExit.getDate() + 1)
      }

      let realExit = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(saiH).padStart(2, '0')}:${String(saiM).padStart(2, '0')}:00-03:00`)
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
      const isSunday = new Date(`${folha.ano}-${String(folha.mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00-03:00`).getUTCDay() === 0

      while (current < end) {
        const localCurrent = new Date(current.getTime() - 3 * 60 * 60 * 1000)
        const curHour = localCurrent.getUTCHours()
        const curDayOfWeek = localCurrent.getUTCDay()
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

      // Se o usuário preencheu ou alterou horários no dia, limpa a falta automática pendente
      const hasAnyTime = !!updated.entrada || !!updated.saida || !!updated.saida_intervalo || !!updated.retorno_intervalo
      if (hasAnyTime && updated.observacao && (updated.observacao.includes('FALTA') || updated.observacao.includes('AGUARDANDO JUSTIFICATIVA'))) {
        updated.observacao = ''
      }

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
    // 1. Validação de consistência cronológica
    for (const r of registros) {
      if (!r.turno_codigo || r.afastamento || r.feriado) continue

      // Mesma leitura cronológica da tela e do servidor. Sem ela, plantão que cruza a
      // meia-noite (18:11 -> 06:00) era barrado aqui como "invertido" e a folha não salvava.
      const seq = sequenciarDia(r, r.jornada_nome || jornada?.nome)

      // Saída do intervalo >= Retorno do intervalo
      if (seq.intervaloInvertido) {
        setAlertModal({
          isOpen: true,
          title: 'Horários Invertidos no Intervalo',
          message: `No Dia ${String(r.dia).padStart(2, '0')}: o horário de Saída para o Intervalo (${r.saida_intervalo}) não pode ser maior ou igual ao Retorno do Intervalo (${r.retorno_intervalo}). Corrija a sequência dos horários antes de salvar.`,
          type: 'danger'
        })
        return
      }

      // Entrada >= Saída do intervalo
      if (seq.entradaInvertida) {
        setAlertModal({
          isOpen: true,
          title: 'Horários Invertidos na Entrada',
          message: `No Dia ${String(r.dia).padStart(2, '0')}: o horário de Entrada (${r.entrada}) não pode ser maior ou igual à Saída para o Intervalo (${r.saida_intervalo}). Corrija a sequência dos horários antes de salvar.`,
          type: 'danger'
        })
        return
      }

      // Retorno do intervalo >= Saída final
      if (seq.saidaInvertida) {
        setAlertModal({
          isOpen: true,
          title: 'Horários Invertidos na Saída',
          message: `No Dia ${String(r.dia).padStart(2, '0')}: o horário de Retorno do Intervalo (${r.retorno_intervalo}) não pode ser maior ou igual à Saída Final (${r.saida}). Corrija a sequência dos horários antes de salvar.`,
          type: 'danger'
        })
        return
      }
    }

    setSaving(true)
    const targetStatus = newStatus || status
    const res = await executeSave(folha.id, registros, targetStatus, cargo)
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

  const [autoCorrecting, setAutoCorrecting] = useState(false)

  // Auto-corrigir horários invertidos e desacoplar marcações deslocadas
  const handleAutoCorrigir = async () => {
    setAutoCorrecting(true)
    const res = await autoCorrigirFolhaPonto(folha.id)
    setAutoCorrecting(false)
    if (res.error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro na Auto-Correção',
        message: res.error,
        type: 'danger'
      })
    } else {
      if (res.registros) {
        setRegistros(res.registros)
      }
      setAlertModal({
        isOpen: true,
        title: 'Auto-Correção Concluída',
        message: res.diasCorrigidos && res.diasCorrigidos > 0 
          ? `Foram identificados e corrigidos automaticamente ${res.diasCorrigidos} dia(s) com horários invertidos ou deslocados. As horas extras e faltas foram recalculadas com sucesso!`
          : 'Nenhuma inconsistência de horários invertidos foi detectada nesta folha de ponto. O documento já está consistente.',
        type: 'success'
      })
      router.refresh()
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
      if (isFaltaDefinitiva(r.observacao)) {
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

  // Extrai todas as ocorrências e justificativas do mês para o Verso (Página 2)
  const ocorrenciasMes = useMemo(() => {
    const lista: Array<{
      dia: number
      dia_semana: string
      data_formatada: string
      tipo: string
      passo: string
      justificativa: string
      origem: string
    }> = []

    const weekDaysShort = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

    registros.forEach((r) => {
      const dateObj = new Date(folha.ano, folha.mes - 1, r.dia)
      const dataFormatada = `${String(r.dia).padStart(2, '0')}/${String(folha.mes).padStart(2, '0')}/${folha.ano}`
      const diaSem = weekDaysShort[dateObj.getDay()]

      // 1. Afastamento / Férias / Atestado / Licença
      if (r.afastamento) {
        lista.push({
          dia: r.dia,
          dia_semana: diaSem,
          data_formatada: dataFormatada,
          tipo: 'Afastamento / Atestado',
          passo: 'Dia Integral',
          justificativa: r.observacao || r.afastamento,
          origem: 'Registro de RH / Gestão'
        })
      }
      // 2. Feriado
      else if (r.feriado) {
        lista.push({
          dia: r.dia,
          dia_semana: diaSem,
          data_formatada: dataFormatada,
          tipo: 'Feriado Oficial',
          passo: 'Dia Integral',
          justificativa: r.observacao || 'Feriado Nacional / Municipal',
          origem: 'Calendário Oficial'
        })
      }
      // 3. Ponto Facultativo
      else if (r.ponto_facultativo) {
        lista.push({
          dia: r.dia,
          dia_semana: diaSem,
          data_formatada: dataFormatada,
          tipo: 'Ponto Facultativo',
          passo: r.entrada && r.saida ? 'Parcial' : 'Dia Integral',
          justificativa: r.observacao || 'Decreto de Ponto Facultativo',
          origem: 'Decreto Municipal'
        })
      }

      // 4. Ajustes manuais de batidas
      const temAjusteEntrada = r.origem_entrada === 'manual' || r.origem_entrada === 'ajuste_coordenador' || r.origem_entrada === 'ajuste_servidor'
      const temAjusteSaida = r.origem_saida === 'manual' || r.origem_saida === 'ajuste_coordenador' || r.origem_saida === 'ajuste_servidor'
      const temAjusteIntSaida = r.origem_saida_intervalo === 'manual' || r.origem_saida_intervalo === 'ajuste_coordenador'
      const temAjusteIntRetorno = r.origem_retorno_intervalo === 'manual' || r.origem_retorno_intervalo === 'ajuste_coordenador'

      if (temAjusteEntrada || temAjusteSaida || temAjusteIntSaida || temAjusteIntRetorno) {
        const passosAjustados: string[] = []
        if (temAjusteEntrada) passosAjustados.push(`Entrada (${r.entrada || '--:--'})`)
        if (temAjusteIntSaida) passosAjustados.push(`Saída Int. (${r.saida_intervalo || '--:--'})`)
        if (temAjusteIntRetorno) passosAjustados.push(`Retorno Int. (${r.retorno_intervalo || '--:--'})`)
        if (temAjusteSaida) passosAjustados.push(`Saída (${r.saida || '--:--'})`)

        lista.push({
          dia: r.dia,
          dia_semana: diaSem,
          data_formatada: dataFormatada,
          tipo: 'Inclusão / Ajuste Manual de Ponto',
          passo: passosAjustados.join(', '),
          justificativa: r.observacao || 'Esquecimento de registro / Atividade externa autorizada',
          origem: 'Ajuste Manual Homologado'
        })
      }
      // 5. Observação manual avulsa digitada (sem ser afastamento/feriado já incluído)
      else if (r.observacao && !r.afastamento && !r.feriado && !r.ponto_facultativo) {
        lista.push({
          dia: r.dia,
          dia_semana: diaSem,
          data_formatada: dataFormatada,
          tipo: 'Observação / Justificativa',
          passo: r.entrada && r.saida ? `${r.entrada} às ${r.saida}` : 'Jornada',
          justificativa: r.observacao,
          origem: 'Gestão / Coordenação'
        })
      }

      // 6. Jornada Temporária
      if (r.jornada_temporaria) {
        lista.push({
          dia: r.dia,
          dia_semana: diaSem,
          data_formatada: dataFormatada,
          tipo: 'Jornada Temporária',
          passo: r.jornada_nome || 'Horário Especial',
          justificativa: `Cumprimento em escala/jornada autorizada: ${r.jornada_nome || ''}`,
          origem: 'Ordem de Serviço / Portaria'
        })
      }
    })

    return lista.sort((a, b) => a.dia - b.dia)
  }, [registros, folha.ano, folha.mes])

  // Estatísticas de Frequência do Mês para o Verso
  const estatisticasVerso = useMemo(() => {
    let diasTrabalhados = 0
    let diasAfastamento = 0
    let diasFolgaFeriado = 0

    registros.forEach((r) => {
      if (r.afastamento) {
        diasAfastamento++
      } else if (r.feriado || r.ponto_facultativo) {
        if (r.entrada || r.saida) diasTrabalhados++
        else diasFolgaFeriado++
      } else if (r.entrada || r.saida) {
        diasTrabalhados++
      } else if (r.dia_semana === 'SÁB' || r.dia_semana === 'DOM' || r.observacao?.includes('FOLGA')) {
        diasFolgaFeriado++
      }
    })

    return {
      diasTrabalhados,
      diasAfastamento,
      diasFolgaFeriado
    }
  }, [registros])

  // State para modal de anexo de plantões e sobreavisos
  const [anexoModalOpen, setAnexoModalOpen] = useState(false)
  const [anexoData, setAnexoData] = useState<any>(null)
  const [loadingAnexo, setLoadingAnexo] = useState(false)

  const handleOpenAnexo = async () => {
    setLoadingAnexo(true)
    const res = await getDadosPlantoesSobreavisosServidor(servidor.id, folha.mes, folha.ano)
    setLoadingAnexo(false)
    if (res && !('error' in res)) {
      setAnexoData(res)
      setAnexoModalOpen(true)
    } else {
      setAlertModal({
        isOpen: true,
        title: 'Anexo Indisponível',
        message: (res && (res as any).error) ? `Erro ao carregar dados: ${(res as any).error}` : 'Não foi possível carregar os dados de plantões e sobreavisos deste servidor.',
        type: 'warning'
      })
    }
  }

  // Custom function to open browser print dialog
  const handlePrint = () => {
    window.print()
  }

  const borderClass = (origin: string) => {
    if (origin === 'real') return 'border-l-4 border-l-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10'
    // Pre-assinalacao do periodo de repouso (CLT Art. 74 par. 2). Nao e batida nem ajuste:
    // e horario declarado, e so existe no intervalo de unidade que nao marca intervalo.
    // 'ficticio' permanece no mapa para as folhas anteriores a 08/08/2026.
    if (origin === 'pre_assinalado' || origin === 'ficticio') return 'border-l-4 border-l-blue-400 border-dashed bg-blue-50/10 dark:bg-blue-950/5'
    if (origin === 'manual') return 'border-l-4 border-l-amber-500 bg-amber-50/20 dark:bg-amber-950/10'
    return 'border-l-4 border-l-zinc-200 dark:border-l-zinc-800'
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 pb-32 print:p-0 print:max-w-none print:pb-0 print:space-y-0 print:m-0 print:block">
      
      {/* Print styles overrides */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 6mm 8mm;
          }
          html, body {
            height: auto !important;
            min-height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            background-color: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          /* Reset parent layout containers (Next.js layout, main, dashboard) */
          main, div, section, article {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
          }
          .dashboard-layout-nav, .sidebar-container, .print-hidden, header, footer, button, nav, input[type="checkbox"], aside {
            display: none !important;
          }
          .print-full-width {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            overflow: visible !important;
            height: auto !important;
            background: white !important;
          }
          .print-page-1 {
            page-break-after: always !important;
            break-after: page !important;
            margin-bottom: 0 !important;
            padding-bottom: 0 !important;
            display: block !important;
          }
          .print-page-break {
            page-break-before: always !important;
            break-before: page !important;
            margin-top: 0 !important;
            padding-top: 0 !important;
            display: block !important;
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
            break-inside: avoid !important;
          }
          table {
            border-collapse: collapse !important;
            width: 100% !important;
          }
          th, td {
            border: 1px solid #a1a1aa !important;
            padding: 3px 5px !important;
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
          {/* Auto-Corrigir */}
          {!isPortal && isEditable && (
            <button 
              onClick={handleAutoCorrigir}
              disabled={autoCorrecting || saving || regenerating || syncing}
              className="inline-flex items-center bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all border border-violet-200 dark:border-violet-800/50 shadow-sm"
              title="Realinha automaticamente horários invertidos, remove batidas vazadas de outros dias e recalcula horas extras."
            >
              {autoCorrecting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Wand2 className="h-4 w-4 mr-1.5 text-violet-600 dark:text-violet-400" />}
              Auto-Corrigir
            </button>
          )}

          {/* Regenerar */}
          <button 
            onClick={handleRegenerar}
            disabled={regenerating || saving || syncing || !isEditable || autoCorrecting}
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
            title="Imprimir a folha de ponto (Frente) e o relatório de justificativas (Verso)."
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Imprimir
          </button>

          {/* Anexo de Plantões e Sobreavisos */}
          <button 
            onClick={handleOpenAnexo}
            disabled={loadingAnexo}
            className="inline-flex items-center bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all border border-blue-200 dark:border-blue-800/50"
            title="Visualizar e imprimir o demonstrativo anexo de plantões e sobreavisos do servidor."
          >
            {loadingAnexo ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ShieldCheck className="h-4 w-4 mr-1.5 text-blue-600 dark:text-blue-400" />}
            Anexo Plantões / Sobreavisos
          </button>

          {/* Salvar */}
          <button 
            onClick={() => handleSave()}
            disabled={saving || regenerating || syncing || !isEditable}
            className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
            Salvar
          </button>

          {/* Fechar/Revisar */}
          {!isPortal && status === 'Rascunho' && (
            <button 
              onClick={() => handleSave('Gerada')}
              disabled={saving || !isEditable}
              className="inline-flex items-center bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-green-500/20 active:scale-95 disabled:opacity-50"
            >
              <CheckSquare className="h-4 w-4 mr-1.5" />
              Finalizar
            </button>
          )}
          {!isPortal && status === 'Gerada' && (
            <button 
              onClick={() => handleSave('Revisada')}
              disabled={saving || !isEditable}
              className="inline-flex items-center bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
            >
              <Check className="h-4 w-4 mr-1.5" />
              Revisar/Fechar
            </button>
          )}
          {!isPortal && status === 'Revisada' && !isCompetenciaEncerrada && (profile?.role === 'admin' || profile?.role === 'super_admin') && (
            <button 
              onClick={() => handleSave('Gerada')}
              disabled={saving}
              className="inline-flex items-center bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-amber-500/20 active:scale-95"
            >
              <Unlock className="h-4 w-4 mr-1.5" />
              Reabrir Folha
            </button>
          )}
        </div>
      </div>

      {/* Competência Encerrada warning banner - Hidden on Print */}
      {isCompetenciaEncerrada && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-3xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-300 print:hidden mb-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-500 shrink-0" />
            <div>
              <h4 className="font-black text-red-900 dark:text-red-300 uppercase text-sm tracking-tight">Competência Encerrada</h4>
              <p className="text-xs text-red-700 dark:text-red-400 mt-0.5 leading-relaxed">
                Este período ({mesExtenso} de {folha.ano}) foi encerrado pelo Administrador Geral. Todos os dados estão congelados para histórico e auditoria, impedindo qualquer modificação.
              </p>
            </div>
          </div>
        </div>
      )}

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
              disabled={syncing || !isEditable}
              className="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2 rounded-xl transition-all shadow-md disabled:opacity-50"
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
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden print-full-width print-page-1 print:rounded-none print:border-none print:shadow-none">
        
        {/* Document Header */}
        <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 print:bg-white print:border-zinc-300 print:p-4">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
            <div className="flex items-center gap-4">
              {/* Institution logo */}
              {instituicaoCabecalhoUrl && (
                <div className="h-14 w-28 border border-zinc-200 dark:border-zinc-800 rounded-lg p-1 bg-white flex items-center justify-center">
                  <img 
                    src={instituicaoCabecalhoUrl} 
                    alt="Logo Instituição" 
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
              {/* Unit/Sector logo */}
              {(setor?.logo_url || unidade?.logo_url) && (
                <div className="h-14 w-28 border border-zinc-200 dark:border-zinc-800 rounded-lg p-1 bg-white flex items-center justify-center">
                  <img 
                    src={setor?.logo_url || unidade?.logo_url} 
                    alt="Logo Unidade" 
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
              <div className="space-y-0.5">
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
              {isEditable && !isPortal ? (
                <input 
                  type="text"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                  className="font-bold text-zinc-900 dark:text-white uppercase bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-0.5 w-full text-xs print:hidden focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              ) : null}
              <div className={`font-bold text-zinc-900 dark:text-white uppercase ${isEditable && !isPortal ? 'hidden print:block' : ''}`}>{cargo || '---'}</div>
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
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="w-2 h-2 rounded-full bg-amber-500 ring-2 ring-amber-300 dark:ring-amber-800 inline-block"></span> Jornada Temporária
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

                const recordJornadaNome = r.jornada_nome || jornada?.nome || ''
                const recordHasInterval = (() => {
                  if (!recordJornadaNome) return false
                  const match = recordJornadaNome.match(/(\d{1,2})(?:[hH:](\d{2})?)?\s*(?:às|as|to|-|a)\s*(\d{1,2})(?:[hH:](\d{2})?)?/i)
                  if (!match) return false
                  const start = parseInt(match[1], 10)
                  const end = parseInt(match[3], 10)
                  let diff = end - start
                  if (diff < 0) diff += 24
                  return diff > 6
                })()

                // Virada de dia (plantão 18h às 06h e afins). Fonte única compartilhada com a
                // validação de salvarFolhaPonto e com o Auto-Corrigir — as três já divergiram
                // entre si, pintando vermelho num dia que o save aceitava. Ver sequenciaDia.ts.
                const seq = sequenciarDia(r, recordJornadaNome)

                const isEntradaInvertida = seq.entradaInvertida
                const isIntervaloInvertido = seq.intervaloInvertido
                const isSaidaInvertida = seq.saidaInvertida

                const isSaidaDiaSeguinte = seq.offsetDias.saida > 0
                const isRetornoDiaSeguinte = seq.offsetDias.retorno_intervalo > 0
                const isSaidaIntervaloDiaSeguinte = seq.offsetDias.saida_intervalo > 0

                // Arrastar-e-soltar pra reclassificar uma batida real (dia 12 do Fernando: uma
                // "saída" real que caiu em "saída intervalo" porque ele trabalhou direto). Só
                // arrasta quem tem origem 'real' e valor preenchido; só solta em passo vazio do
                // MESMO dia — mover entre dias é fora de escopo.
                const CAMPOS_PASSO: Record<string, { origem: string; valido: boolean }> = {
                  entrada: { origem: r.origem_entrada, valido: isWorkDay && !r.afastamento && !r.feriado },
                  saida_intervalo: { origem: r.origem_saida_intervalo, valido: isWorkDay && recordHasInterval && !r.afastamento && !r.feriado },
                  retorno_intervalo: { origem: r.origem_retorno_intervalo, valido: isWorkDay && recordHasInterval && !r.afastamento && !r.feriado },
                  saida: { origem: r.origem_saida, valido: isWorkDay && !r.afastamento && !r.feriado },
                }
                const isArrastavel = (campo: string) =>
                  podeReclassificar && CAMPOS_PASSO[campo]?.valido && CAMPOS_PASSO[campo]?.origem === 'real' && !!r[campo]
                const isAlvoDeSolta = (campo: string) =>
                  podeReclassificar && CAMPOS_PASSO[campo]?.valido &&
                  !!draggingFrom && draggingFrom.dia === r.dia && draggingFrom.passo !== campo && !r[campo]

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
                    <td 
                      className="px-2 py-2 border-r border-zinc-200 dark:border-zinc-700 text-center font-bold text-zinc-500 relative"
                      title={r.jornada_nome ? `Jornada: ${r.jornada_nome}${r.jornada_temporaria ? ' (Temporária)' : ''}` : undefined}
                    >
                      <div>{r.dia_semana}</div>
                      {r.jornada_temporaria && (
                        <span 
                          className="absolute top-1 right-1 flex h-2 w-2 print:hidden print-hidden"
                          title={`Jornada Temporária: ${r.jornada_nome}`}
                        >
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 ring-1 ring-white dark:ring-zinc-900"></span>
                        </span>
                      )}
                    </td>

                    {/* Entrada */}
                    <td
                      className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center ${isWorkDay ? borderClass(r.origem_entrada) : ''} ${isEntradaInvertida ? 'ring-2 ring-inset ring-red-500 bg-red-50/40 dark:bg-red-950/20' : ''} ${isArrastavel('entrada') ? 'cursor-grab active:cursor-grabbing' : ''} ${isAlvoDeSolta('entrada') ? 'ring-2 ring-inset ring-dashed ring-blue-400' : ''}`}
                      draggable={isArrastavel('entrada')}
                      onDragStart={() => setDraggingFrom({ dia: r.dia, passo: 'entrada' })}
                      onDragEnd={() => setDraggingFrom(null)}
                      onDragOver={(e) => { if (isAlvoDeSolta('entrada')) e.preventDefault() }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(r.dia, 'entrada') }}
                      title={isEntradaInvertida ? `Inconsistência: Entrada (${r.entrada}) >= Saída Intervalo (${r.saida_intervalo})` : (isArrastavel('entrada') ? 'Arraste para outro passo do dia para corrigir a classificação' : undefined)}
                    >
                      {isWorkDay && !r.afastamento && !r.feriado ? (
                        <input
                          type="time"
                          value={r.entrada || ''}
                          onChange={(e) => handleCellChange(r.dia, 'entrada', e.target.value)}
                          disabled={isPortal || !isEditable || (r.origem_entrada === 'real' && profile?.role !== 'super_admin')}
                          className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono disabled:opacity-50"
                        />
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Saída Intervalo */}
                    <td
                      className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center ${isWorkDay && recordHasInterval ? borderClass(r.origem_saida_intervalo) : ''} ${isIntervaloInvertido || isEntradaInvertida ? 'ring-2 ring-inset ring-red-500 bg-red-50/40 dark:bg-red-950/20' : ''} ${isArrastavel('saida_intervalo') ? 'cursor-grab active:cursor-grabbing' : ''} ${isAlvoDeSolta('saida_intervalo') ? 'ring-2 ring-inset ring-dashed ring-blue-400' : ''}`}
                      draggable={isArrastavel('saida_intervalo')}
                      onDragStart={() => setDraggingFrom({ dia: r.dia, passo: 'saida_intervalo' })}
                      onDragEnd={() => setDraggingFrom(null)}
                      onDragOver={(e) => { if (isAlvoDeSolta('saida_intervalo')) e.preventDefault() }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(r.dia, 'saida_intervalo') }}
                      title={isIntervaloInvertido ? `Inconsistência: Saída Intervalo (${r.saida_intervalo}) >= Retorno (${r.retorno_intervalo})` : (isArrastavel('saida_intervalo') ? 'Arraste para outro passo do dia para corrigir a classificação' : undefined)}
                    >
                      {isWorkDay && recordHasInterval && !r.afastamento && !r.feriado ? (
                        <div className="relative inline-flex items-center justify-center w-full">
                          <input
                            type="time"
                            value={r.saida_intervalo || ''}
                            onChange={(e) => handleCellChange(r.dia, 'saida_intervalo', e.target.value)}
                            disabled={isPortal || !isEditable || (r.origem_saida_intervalo === 'real' && profile?.role !== 'super_admin')}
                            className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono disabled:opacity-50"
                          />
                          {isSaidaIntervaloDiaSeguinte && r.saida_intervalo && <MarcadorDiaSeguinte passo="saída para o intervalo" />}
                        </div>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Retorno Intervalo */}
                    <td
                      className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center ${isWorkDay && recordHasInterval ? borderClass(r.origem_retorno_intervalo) : ''} ${isIntervaloInvertido || isSaidaInvertida ? 'ring-2 ring-inset ring-red-500 bg-red-50/40 dark:bg-red-950/20' : ''} ${isArrastavel('retorno_intervalo') ? 'cursor-grab active:cursor-grabbing' : ''} ${isAlvoDeSolta('retorno_intervalo') ? 'ring-2 ring-inset ring-dashed ring-blue-400' : ''}`}
                      draggable={isArrastavel('retorno_intervalo')}
                      onDragStart={() => setDraggingFrom({ dia: r.dia, passo: 'retorno_intervalo' })}
                      onDragEnd={() => setDraggingFrom(null)}
                      onDragOver={(e) => { if (isAlvoDeSolta('retorno_intervalo')) e.preventDefault() }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(r.dia, 'retorno_intervalo') }}
                      title={isIntervaloInvertido ? `Inconsistência: Retorno (${r.retorno_intervalo}) <= Saída Intervalo (${r.saida_intervalo})` : (isArrastavel('retorno_intervalo') ? 'Arraste para outro passo do dia para corrigir a classificação' : undefined)}
                    >
                      {isWorkDay && recordHasInterval && !r.afastamento && !r.feriado ? (
                        <div className="relative inline-flex items-center justify-center w-full">
                          <input
                            type="time"
                            value={r.retorno_intervalo || ''}
                            onChange={(e) => handleCellChange(r.dia, 'retorno_intervalo', e.target.value)}
                            disabled={isPortal || !isEditable || (r.origem_retorno_intervalo === 'real' && profile?.role !== 'super_admin')}
                            className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono disabled:opacity-50"
                          />
                          {isRetornoDiaSeguinte && r.retorno_intervalo && <MarcadorDiaSeguinte passo="retorno do intervalo" />}
                        </div>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Saída */}
                    <td
                      className={`px-2 py-1.5 border-r border-zinc-200 dark:border-zinc-700 text-center relative ${isWorkDay ? borderClass(r.origem_saida) : ''} ${isSaidaInvertida ? 'ring-2 ring-inset ring-red-500 bg-red-50/40 dark:bg-red-950/20' : ''} ${isArrastavel('saida') ? 'cursor-grab active:cursor-grabbing' : ''} ${isAlvoDeSolta('saida') ? 'ring-2 ring-inset ring-dashed ring-blue-400' : ''}`}
                      draggable={isArrastavel('saida')}
                      onDragStart={() => setDraggingFrom({ dia: r.dia, passo: 'saida' })}
                      onDragEnd={() => setDraggingFrom(null)}
                      onDragOver={(e) => { if (isAlvoDeSolta('saida')) e.preventDefault() }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(r.dia, 'saida') }}
                      title={isSaidaInvertida ? `Inconsistência: Retorno (${r.retorno_intervalo || r.entrada}) >= Saída Final (${r.saida})` : (isSaidaDiaSeguinte ? 'Saída realizada no dia seguinte (plantão noturno)' : (isArrastavel('saida') ? 'Arraste para outro passo do dia para corrigir a classificação' : undefined))}
                    >
                      {isWorkDay && !r.afastamento && !r.feriado ? (
                        <div className="relative inline-flex items-center justify-center w-full">
                          <input
                            type="time"
                            value={r.saida || ''}
                            onChange={(e) => handleCellChange(r.dia, 'saida', e.target.value)}
                            disabled={isPortal || !isEditable || (r.origem_saida === 'real' && profile?.role !== 'super_admin')}
                            className="w-full bg-transparent border-none text-center outline-none font-bold text-zinc-900 dark:text-white font-mono disabled:opacity-50"
                          />
                          {isSaidaDiaSeguinte && r.saida && <MarcadorDiaSeguinte passo="saída" />}
                        </div>
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

                    {/* Observações — e, no portal, o atalho para solicitar ajuste.
                        O botão mora aqui de propósito: acrescentar uma coluna própria
                        desalinharia a tabela, que tem cabeçalho fixo e é usada na impressão. */}
                    <td className="px-3 py-1.5 border-r border-zinc-200 dark:border-zinc-700 font-medium">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={r.observacao || ''}
                          onChange={(e) => handleCellChange(r.dia, 'observacao', e.target.value)}
                          disabled={isPortal || !isEditable}
                          className="w-full bg-transparent border-none text-left outline-none text-zinc-700 dark:text-zinc-300 font-semibold disabled:opacity-50"
                          placeholder={isOffDay ? '' : 'Digitar observação...'}
                        />
                        {/* Só em dia de trabalho JÁ OCORRIDO com célula vazia — o caso de
                            esquecimento de batida. Dia futuro não tem o que justificar. */}
                        {isPortal && onSolicitarAjuste && isWorkDay && !r.afastamento && !r.feriado
                          && r.dia <= ultimoDiaOcorrido
                          && (!r.entrada || !r.saida) && (
                          <button
                            type="button"
                            onClick={() => onSolicitarAjuste(r.dia)}
                            className="shrink-0 px-2 py-1 text-[10px] font-bold rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/70 transition-all whitespace-nowrap print:hidden"
                            title="Informar o horário que você cumpriu neste dia"
                          >
                            informar horário
                          </button>
                        )}
                      </div>
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

        {/* Nota de rodapé do marcador de virada de dia.
            Precisa existir na IMPRESSÃO: a legenda de origens acima é print:hidden, então sem
            isto o espelho — que é o documento oficial — sairia com um "+1d" sem explicação.
            Só aparece quando algum dia da competência realmente cruza a meia-noite. */}
        {registros.some(r => !!r.turno_codigo && temViradaDeDia(r, r.jornada_nome || jornada?.nome)) && (
          <div className="px-8 pt-3 text-[10px] font-semibold text-zinc-500 print:px-4 print:pt-2 print:text-[8px] print:text-zinc-600">
            <span className="font-bold">+1d</span> — marcação registrada no dia seguinte ao do
            início da jornada (plantão que cruza a meia-noite). A linha corresponde ao dia em que
            a jornada teve início, com o par entrada/saída mantido íntegro.
          </div>
        )}

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
          {isMounted && (
            <div className="hidden print:block text-right text-[6px] text-zinc-400 mt-12">
              Documento emitido digitalmente via SisEscala. Data da emissão: {new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR')}.
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PÁGINA 2: VERSO DA FOLHA DE PONTO — RELATÓRIO DE JUSTIFICATIVAS E OCORRÊNCIAS */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden print-full-width print-page-break mt-12 print:mt-0 print:rounded-none print:border-none print:shadow-none">
        {/* Verso Header */}
        <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 print:bg-white print:border-zinc-300 print:p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-zinc-200/60 dark:border-zinc-700/60 print:pb-3 print:gap-2">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                {/* Brasões */}
                <div className="h-10 w-24 relative flex items-center justify-center bg-white dark:bg-zinc-800 rounded-lg p-1 border border-zinc-100 dark:border-zinc-700 shadow-sm print:shadow-none print:border-none">
                  {instituicaoCabecalhoUrl ? (
                    <img 
                      src={instituicaoCabecalhoUrl} 
                      alt="Logo Institucional" 
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="w-5 h-5 bg-green-600 rounded flex items-center justify-center text-[7px] text-white font-bold">PMM</div>
                      <div className="text-[7px] font-black leading-tight text-zinc-700 dark:text-zinc-300">Marabá<br/><span className="text-[5px] text-zinc-400 font-normal">Prefeitura</span></div>
                    </div>
                  )}
                </div>
                <div className="h-10 w-10 relative flex items-center justify-center bg-white dark:bg-zinc-800 rounded-lg p-1 border border-zinc-100 dark:border-zinc-700 shadow-sm print:shadow-none print:border-none">
                  <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-[8px] text-white font-black">SMS</div>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase print:text-black tracking-tight">
                  Folha de Ponto Mensal — Verso
                </h3>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider print:text-zinc-500">
                  Relatório Detalhado de Justificativas e Tratamentos de Ocorrências • Portaria MTP 671/2021
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 block mb-0.5">Competência</span>
              <div className="text-lg font-bold text-zinc-900 dark:text-white uppercase print:text-black">
                {mesExtenso} / {folha.ano}
              </div>
            </div>
          </div>

          {/* Verso Servidor Details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-xs print:grid-cols-4 print:gap-4 print:text-[8px] mt-6 print:mt-3">
            <div>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Servidor</span>
              <div className="font-bold text-zinc-900 dark:text-white uppercase print:text-black">{servidor.nome}</div>
              <div className="text-zinc-500 font-mono text-[10px]">Matrícula: {servidor.matricula || '---'}</div>
            </div>
            <div>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Cargo / Vínculo</span>
              <div className="font-bold text-zinc-900 dark:text-white uppercase print:text-black">{cargo || '---'}</div>
              <div className="text-zinc-500 uppercase text-[10px]">{servidor.vinculo || 'CONTRATADO/EFETIVO'}</div>
            </div>
            <div>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Unidade</span>
              <div className="font-bold text-zinc-900 dark:text-white uppercase print:text-black truncate" title={unidade.nome}>
                {unidade.nome}
              </div>
            </div>
            <div>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Setor / Jornada</span>
              <div className="font-bold text-zinc-900 dark:text-white uppercase print:text-black truncate" title={setor?.nome}>
                {setor?.nome}
              </div>
              <div className="text-zinc-500 uppercase text-[10px]">{jornada?.nome || 'Jornada Padrão'}</div>
            </div>
          </div>
        </div>

        {/* Verso Content: Tabela de Ocorrências e Justificativas */}
        <div className="p-8 print:p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white print:text-black flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400 print:hidden" />
              1. Extrato Cronológico de Justificativas e Tratamentos ({ocorrenciasMes.length} registro(s))
            </h4>
            <span className="text-[10px] font-bold text-zinc-400 uppercase">
              Demonstrativo de Ausências, Atestados e Inclusões Manuais
            </span>
          </div>

          {ocorrenciasMes.length > 0 ? (
            <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-2xl mb-8 print:mb-4">
              <table className="w-full text-xs text-left border-collapse print:text-[8px]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold uppercase text-[9px] print:bg-zinc-200 print:text-black border-b border-zinc-200 dark:border-zinc-700">
                    <th className="py-2.5 px-3 text-center w-12 print-cell-border">Dia</th>
                    <th className="py-2.5 px-3 text-center w-12 print-cell-border">Sem</th>
                    <th className="py-2.5 px-3 print-cell-border">Tipo de Ocorrência</th>
                    <th className="py-2.5 px-3 print-cell-border">Horário / Passo</th>
                    <th className="py-2.5 px-4 print-cell-border">Justificativa / Motivo Detalhado</th>
                    <th className="py-2.5 px-3 print-cell-border">Origem / Responsável</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {ocorrenciasMes.map((oc, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 print:hover:bg-transparent">
                      <td className="py-2 px-3 text-center font-bold print-cell-border">{String(oc.dia).padStart(2, '0')}</td>
                      <td className="py-2 px-3 text-center text-zinc-500 uppercase font-semibold print-cell-border">{oc.dia_semana}</td>
                      <td className="py-2 px-3 font-bold text-zinc-900 dark:text-white print:text-black uppercase print-cell-border">{oc.tipo}</td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-300 font-mono text-[10px] print:text-[8px] print-cell-border">{oc.passo}</td>
                      <td className="py-2 px-4 text-zinc-800 dark:text-zinc-200 font-medium print:text-black print-cell-border">{oc.justificativa}</td>
                      <td className="py-2 px-3 text-zinc-500 print:text-black text-[10px] print:text-[8px] italic print-cell-border">{oc.origem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500 mb-8 print:mb-4 bg-zinc-50/50 dark:bg-zinc-800/20 print:bg-white">
              Nenhuma ocorrência extraordinária, atestado ou ajuste manual registrado nesta competência. Cumprimento regular da jornada de trabalho.
            </div>
          )}

          {/* Resumo Consolidado de Frequência do Verso */}
          <div className="mb-8 print:mb-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white print:text-black mb-3">
              2. Resumo Consolidado da Frequência no Mês
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center print:grid-cols-5 print:gap-2">
              <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl print:border-zinc-300 print:p-2">
                <div className="text-[8px] font-black uppercase text-zinc-400 mb-1">Dias Trabalhados</div>
                <div className="text-lg font-black text-zinc-900 dark:text-white print:text-black">{estatisticasVerso.diasTrabalhados}</div>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl print:border-zinc-300 print:p-2">
                <div className="text-[8px] font-black uppercase text-zinc-400 mb-1">Afastamentos / Licenças</div>
                <div className="text-lg font-black text-amber-600 dark:text-amber-400 print:text-black">{estatisticasVerso.diasAfastamento}</div>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl print:border-zinc-300 print:p-2">
                <div className="text-[8px] font-black uppercase text-zinc-400 mb-1">Folgas / Feriados / PF</div>
                <div className="text-lg font-black text-blue-600 dark:text-blue-400 print:text-black">{estatisticasVerso.diasFolgaFeriado}</div>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl print:border-zinc-300 print:p-2">
                <div className="text-[8px] font-black uppercase text-zinc-400 mb-1">Horas Extra Totais</div>
                <div className="text-lg font-black text-violet-600 dark:text-violet-400 print:text-black">
                  {(Number(totalizers.horas50) + Number(totalizers.horas100)).toFixed(1)}h
                </div>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl print:border-zinc-300 print:p-2">
                <div className="text-[8px] font-black uppercase text-zinc-400 mb-1">Faltas Computadas</div>
                <div className="text-lg font-black text-red-500 print:text-black">{totalizers.faltas}</div>
              </div>
            </div>
          </div>

          {/* Termo de Declaração e Assinaturas (Verso) */}
          <div className="border-t border-zinc-200 dark:border-zinc-700 pt-6 print:pt-4">
            <p className="text-[9px] text-zinc-500 dark:text-zinc-400 print:text-zinc-600 leading-relaxed text-justify mb-8 print:mb-6">
              Declaro para os devidos fins de direito e controle de frequência a veracidade de todas as ocorrências, atestados e justificativas apresentadas neste relatório (Verso), em conformidade com as diretrizes da Secretaria Municipal de Saúde e as exigências da Portaria MTP nº 671/2021.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 px-6 print:grid-cols-2 print:gap-10 print:px-0 text-center">
              <div className="space-y-2">
                <div className="w-full border-t border-zinc-400 dark:border-zinc-700 pt-3">
                  <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white print:text-[8px]">{servidor.nome}</div>
                  <div className="text-[8px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Assinatura do Servidor (Ciência do Verso)</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="w-full border-t border-zinc-400 dark:border-zinc-700 pt-3">
                  <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white print:text-[8px]">Chefia Imediata / Coordenação</div>
                  <div className="text-[8px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Visto e Homologação das Justificativas</div>
                </div>
              </div>
            </div>

            {isMounted && (
              <div className="hidden print:block text-right text-[6px] text-zinc-400 mt-8">
                Verso oficial da Folha de Ponto emitida via SisEscala em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Demonstrativo de Plantões e Sobreavisos */}
      {anexoModalOpen && anexoData && (
        <RelatorioPlantaoSobreavisoAnexo 
          dados={anexoData} 
          onClose={() => setAnexoModalOpen(false)} 
        />
      )}

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

      {/* Reclassify Modal — mover batida real pra outro passo do dia */}
      {reclassifyModal && (
        <Modal
          isOpen={true}
          onClose={() => setReclassifyModal(null)}
          title="Corrigir Classificação da Batida"
          type="warning"
          footer={
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setReclassifyModal(null)}
                disabled={reclassifyModal.submitting}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarReclassificacao}
                disabled={reclassifyModal.submitting || reclassifyModal.justificativa.trim().length < 5}
                className="flex-1 px-4 py-2 rounded-xl text-white font-bold text-[10px] uppercase tracking-widest bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
              >
                {reclassifyModal.submitting ? 'Movendo...' : 'Confirmar'}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Mover a batida das <strong className="font-mono text-zinc-900 dark:text-white">{reclassifyModal.horario}</strong> do
              dia {String(reclassifyModal.dia).padStart(2, '0')} de{' '}
              <strong>{PASSO_LABEL[reclassifyModal.passoOrigem]}</strong> para{' '}
              <strong>{PASSO_LABEL[reclassifyModal.passoDestino]}</strong>.
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              O horário real não muda — só a classificação. Isso corrige a escala e a folha ao
              mesmo tempo, e fica registrado na auditoria.
            </p>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
                Justificativa (obrigatória)
              </label>
              <textarea
                value={reclassifyModal.justificativa}
                onChange={(e) => setReclassifyModal({ ...reclassifyModal, justificativa: e.target.value })}
                disabled={reclassifyModal.submitting}
                rows={3}
                placeholder="Ex.: servidor trabalhou direto no dia, sem marcar intervalo — a batida é a saída final."
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white disabled:opacity-50"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
