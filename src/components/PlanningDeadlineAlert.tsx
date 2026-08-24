'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { AlertTriangle, X, CalendarClock, ClipboardCheck, ShieldAlert } from 'lucide-react'

interface PlanningDeadlineAlertProps {
  userRole?: string
}

export function PlanningDeadlineAlert({ userRole }: PlanningDeadlineAlertProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dontShowToday, setDontShowToday] = useState(false)
  const [deadlineDay, setDeadlineDay] = useState<number | null>(null)
  const [currentDay, setCurrentDay] = useState<number>(new Date().getDate())
  const [monthName, setMonthName] = useState<string>('')

  /**
   * PENDÊNCIAS DE DESFECHO — acrescentado em 24/08/2026 a pedido do usuário.
   *
   * O aviso de prazo falava só de planejamento ("depois do dia 25 só admin edita"). Faltava a
   * consequência que dói: plantão sem registro completo de ponto e sem decisão do coordenador
   * não entra na carga horária do anexo, e depois do fechamento automático **só o RH reverte**.
   * "Muito coordenador deixa pra última hora e esquece" — e o trabalho cai no RH.
   *
   * O prazo que importa aqui NÃO é o dia 25: é o fim do mês + `dias_inativacao_automatica`,
   * quando o auto-fechamento congela a competência. São dois prazos diferentes no mesmo aviso.
   */
  const [pendencias, setPendencias] = useState(0)
  const [prazoFalta, setPrazoFalta] = useState<Date | null>(null)
  const [gateLigado, setGateLigado] = useState(false)
  const [compRisco, setCompRisco] = useState<{ mes: number; ano: number } | null>(null)
  const supabase = createClient()

  useEffect(() => {
    // Only show for coordinators
    if (userRole !== 'coordenador' && userRole !== 'ass_adm') return

    async function checkDeadline() {
      try {
        const { data, error } = await supabase
          .from('configuracoes_globais')
          .select('valor')
          .eq('chave', 'dia_limite_planejamento')
          .single()

        if (error || !data || !data.valor) return

        const dayLimit = parseInt(data.valor, 10)
        if (isNaN(dayLimit)) return

        setDeadlineDay(dayLimit)

        const now = new Date()
        const todayDay = now.getDate()
        const todayMonth = now.getMonth() // 0-11
        const todayYear = now.getFullYear()
        
        setCurrentDay(todayDay)

        // Capitalized current month name in Portuguese
        const rawMonth = now.toLocaleString('pt-BR', { month: 'long' })
        const capitalizedMonth = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1)
        setMonthName(capitalizedMonth)

        // ---------------------------------------------------------------------
        // PENDÊNCIAS DE DESFECHO E O PRAZO QUE DE FATO VIRA FALTA
        // ---------------------------------------------------------------------
        // A competência em risco não é sempre a corrente: nos primeiros dias do mês, quem
        // ainda pode ser congelado é o mês ANTERIOR (o auto-fechamento roda em fim do mês +
        // `dias_inativacao_automatica`). Avisar sobre o mês corrente no dia 02 seria apontar
        // para o prazo errado justamente na véspera do que importa.
        const { data: cfgDias } = await supabase
          .from('configuracoes_globais').select('valor')
          .eq('chave', 'dias_inativacao_automatica').maybeSingle()
        const diasInativacao = parseInt(String(cfgDias?.valor ?? '3').replace(/"/g, ''), 10) || 3

        const emRisco = todayDay <= diasInativacao
          ? { mes: todayMonth === 0 ? 12 : todayMonth, ano: todayMonth === 0 ? todayYear - 1 : todayYear }
          : { mes: todayMonth + 1, ano: todayYear }
        setCompRisco(emRisco)

        const fimDaCompetencia = new Date(emRisco.ano, emRisco.mes, 0)
        const prazo = new Date(fimDaCompetencia)
        prazo.setDate(prazo.getDate() + diasInativacao)
        setPrazoFalta(prazo)

        const { data: cfgGate } = await supabase
          .from('configuracoes_globais').select('valor')
          .eq('chave', 'desfecho_obrigatorio_fechar').maybeSingle()
        setGateLigado(String(cfgGate?.valor ?? 'false').replace(/"/g, '') === 'true')

        // A RLS de escala_mensal já restringe ao escopo do coordenador — o número que ele vê é
        // o dele, não o da rede.
        const { data: escalas } = await supabase
          .from('escala_mensal').select('id')
          .eq('mes', emRisco.mes).eq('ano', emRisco.ano).eq('ativo', true)

        let totalPendente = 0
        const ids = (escalas || []).map(e => e.id)
        for (let i = 0; i < ids.length; i += 100) {
          const { data: desfechos } = await supabase.rpc('fn_desfecho_eventos_escalas', {
            p_escala_mensal_ids: ids.slice(i, i + 100),
            p_hoje: `${todayYear}-${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`
          })
          totalPendente += (desfechos || []).filter((d: any) => d.estado === 'em_avaliacao').length
        }
        setPendencias(totalPendente)

        // ---------------------------------------------------------------------
        // QUANDO ABRIR
        // ---------------------------------------------------------------------
        // O aviso de planejamento continua nos 3 dias que antecedem o dia-limite. Mas o prazo
        // da FALTA é outro, e some do radar justamente depois do dia 25 — quando o coordenador
        // ainda tem uma semana para justificar e ninguém mais o lembra. Por isso, havendo
        // pendência, o aviso continua aparecendo até o dia do fechamento automático.
        const startDay = Math.max(1, dayLimit - 3)
        const janelaPlanejamento = todayDay >= startDay && todayDay <= dayLimit
        const janelaPendencia = totalPendente > 0 && now <= prazo

        if (janelaPlanejamento || janelaPendencia) {
          // Check if dismissed for today
          const todayStr = `${todayYear}-${todayMonth + 1}-${todayDay}`
          const dismissedDate = localStorage.getItem('sisescala_deadline_alert_dismissed')

          if (dismissedDate !== todayStr) {
            setIsOpen(true)
          }
        }
      } catch (err) {
        console.error('Erro ao verificar o prazo de planejamento:', err)
      }
    }

    checkDeadline()
  }, [userRole, supabase])

  const handleDismiss = () => {
    if (dontShowToday && deadlineDay !== null) {
      const now = new Date()
      const todayStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
      localStorage.setItem('sisescala_deadline_alert_dismissed', todayStr)
    }
    setIsOpen(false)
  }

  if (!isOpen || deadlineDay === null) return null

  const daysRemaining = deadlineDay - currentDay

  const nomeMes = (m: number) => [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ][m - 1]
  const prazoTexto = prazoFalta
    ? `${String(prazoFalta.getDate()).padStart(2, '0')}/${String(prazoFalta.getMonth() + 1).padStart(2, '0')}`
    : null
  const diasAteOPrazo = prazoFalta
    ? Math.ceil((prazoFalta.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-300"
        onClick={handleDismiss}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md overflow-hidden rounded-[2rem] bg-white p-8 shadow-2xl transition-all dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button 
          onClick={handleDismiss}
          className="absolute right-6 top-6 rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          aria-label="Fechar alerta"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          {/* Header Icon Box */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-500 mb-6 animate-pulse">
            <AlertTriangle className="h-8 w-8" />
          </div>

          {/* Title */}
          <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight mb-2">
            Atenção Coordenador!
          </h3>

          <div className="h-px w-16 bg-zinc-200 dark:bg-zinc-800 my-2" />

          {/* Description */}
          <div className="space-y-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {daysRemaining === 0 ? (
              <p>
                O prazo limite para o planejamento e edição das escalas do mês de <strong className="text-zinc-900 dark:text-white font-bold">{monthName}</strong> encerra <span className="text-amber-600 dark:text-amber-500 font-extrabold">HOJE (dia {deadlineDay})</span>!
              </p>
            ) : (
              <p>
                O prazo limite para o planejamento e edição das escalas do mês de <strong className="text-zinc-900 dark:text-white font-bold">{monthName}</strong> encerra no dia <strong className="text-zinc-900 dark:text-white font-bold">{deadlineDay}</strong>.
              </p>
            )}

            {daysRemaining > 0 && (
              <p className="flex items-center justify-center gap-1.5 bg-zinc-50 dark:bg-zinc-950 px-4 py-2 rounded-xl border border-zinc-150 dark:border-zinc-800 text-xs font-semibold">
                <CalendarClock className="h-4 w-4 text-indigo-500" />
                <span>
                  Restam apenas <strong className="text-indigo-600 dark:text-indigo-400 font-extrabold">{daysRemaining} {daysRemaining === 1 ? 'dia' : 'dias'}</strong> para realizar e submeter as devidas alterações.
                </span>
              </p>
            )}

            <p className="text-xs">
              Caso isso não seja feito, após o prazo a escala <span className="underline font-semibold text-zinc-700 dark:text-zinc-300">só poderá ser alterada por um administrador</span>.
            </p>

            {/*
              O BLOCO QUE DÓI — e por isso ele é o mais visível do aviso.
              O prazo do planejamento (dia 25) e o prazo da falta (fim do mês + inatividade) são
              DIFERENTES, e o segundo é o que gera trabalho para o RH: depois dele, só RH Geral
              ou RH da Unidade revertem. Um coordenador que só ouve falar do dia 25 acha que
              está em dia no dia 26.
            */}
            {pendencias > 0 && compRisco && (
              <div className="text-left bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-900/60 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <ShieldAlert className="h-5 w-5 shrink-0" />
                  <span className="font-black uppercase tracking-wider text-xs">
                    {pendencias} plantão(ões) sem justificativa
                  </span>
                </div>

                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
                  Na competência de <strong>{nomeMes(compRisco.mes)}</strong> há{' '}
                  <strong>{pendencias} plantão(ões)/sobreaviso(s)</strong> sem registro completo de
                  ponto e sem a sua decisão. Enquanto ficarem assim,{' '}
                  <strong>não entram na carga horária</strong> do anexo do servidor.
                </p>

                {gateLigado ? (
                  <p className="text-xs text-red-800 dark:text-red-200 leading-relaxed font-bold">
                    ⚠️ No fechamento automático{prazoTexto && <> (dia <u>{prazoTexto}</u>)</>}, o que
                    não for justificado será registrado como <u>FALTA do servidor</u>. Depois disso,{' '}
                    <u>somente o RH consegue reverter</u>.
                  </p>
                ) : (
                  <p className="text-xs text-red-800 dark:text-red-200 leading-relaxed font-bold">
                    Regularize antes do fechamento da competência
                    {prazoTexto && <> (dia <u>{prazoTexto}</u>)</>}: depois de fechada, a correção
                    passa a depender do RH.
                  </p>
                )}

                {diasAteOPrazo !== null && diasAteOPrazo >= 0 && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 font-black uppercase tracking-wider">
                    {diasAteOPrazo === 0
                      ? 'Último dia para regularizar'
                      : `Faltam ${diasAteOPrazo} dia(s) para o fechamento`}
                  </p>
                )}

                <a
                  href="/justificativas"
                  className="mt-1 w-full inline-flex items-center justify-center gap-2 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-[11px] uppercase tracking-widest transition-all"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Resolver agora
                </a>
              </div>
            )}
          </div>

          {/* Checkbox */}
          <div className="w-full mt-6 bg-zinc-50 dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-150 dark:border-zinc-855 flex items-center justify-center gap-3">
            <input
              id="dontShowTodayCheckbox"
              type="checkbox"
              checked={dontShowToday}
              onChange={(e) => setDontShowToday(e.target.checked)}
              className="h-4 w-4 rounded-md border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer dark:bg-zinc-900"
            />
            <label 
              htmlFor="dontShowTodayCheckbox" 
              className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-650 dark:hover:text-zinc-450 transition-colors select-none"
            >
              Não mostrar este aviso novamente hoje
            </label>
          </div>

          {/* Confirm Button */}
          <button
            onClick={handleDismiss}
            className="w-full mt-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/35"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
