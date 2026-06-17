'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { AlertTriangle, X, CalendarClock } from 'lucide-react'

interface PlanningDeadlineAlertProps {
  userRole?: string
}

export function PlanningDeadlineAlert({ userRole }: PlanningDeadlineAlertProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dontShowToday, setDontShowToday] = useState(false)
  const [deadlineDay, setDeadlineDay] = useState<number | null>(null)
  const [currentDay, setCurrentDay] = useState<number>(new Date().getDate())
  const [monthName, setMonthName] = useState<string>('')
  const supabase = createClient()

  useEffect(() => {
    // Only show for coordinators
    if (userRole !== 'coordenador') return

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

        // Show alert starting 3 days before the deadline until the deadline day itself
        const startDay = Math.max(1, dayLimit - 3)

        if (todayDay >= startDay && todayDay <= dayLimit) {
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
