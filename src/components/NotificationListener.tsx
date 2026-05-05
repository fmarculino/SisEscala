'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { AlertTriangle, X, MapPin, Zap } from 'lucide-react'

export function NotificationListener() {
  const [notification, setNotification] = useState<any>(null)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('global-notifications')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'logs_sobreaviso'
        },
        async (payload) => {
          console.log('Realtime Update Received:', payload)
          
          // If the new status is 'Recusado', fetch the details and show notification
          if (payload.new && payload.new.status === 'Recusado') {
            console.log('Refusal Detected, fetching details...')
            const { data: logDetails, error } = await supabase
              .from('logs_sobreaviso')
              .select(`
                *,
                servidores (nome),
                unidades (nome)
              `)
              .eq('id', payload.new.id)
              .single()

            if (error) {
              console.error('Error fetching log details:', error)
              return
            }

            if (logDetails) {
              setNotification(logDetails)
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  if (!notification) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border-2 border-red-500 animate-in zoom-in slide-in-from-top-12 duration-500">
        <div className="bg-red-600 p-6 text-white flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <AlertTriangle className="h-8 w-8 text-white animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tighter">Chamado Recusado!</h2>
              <p className="text-red-100 text-sm font-medium opacity-90">Ação imediata necessária</p>
            </div>
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Servidor</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-white leading-tight">
                {notification.servidores?.nome}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Unidade</p>
              <p className="text-lg font-bold text-zinc-900 dark:text-white leading-tight">
                {notification.unidades?.nome}
              </p>
            </div>
          </div>

          <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-2xl border border-red-100 dark:border-red-800 space-y-3">
            <div className="flex items-center space-x-2 text-red-700 dark:text-red-400">
              <Zap className="h-4 w-4" />
              <p className="text-xs font-black uppercase">Justificativa do Servidor:</p>
            </div>
            <p className="text-lg font-medium text-red-900 dark:text-red-100 italic leading-relaxed">
              "{notification.justificativa_recusa}"
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Motivo do Chamado Original:</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 italic">
              "{notification.motivo_acionamento}"
            </p>
          </div>

          <div className="pt-4 flex space-x-4">
            <button 
              onClick={() => {
                window.location.href = `/auditoria`
                setNotification(null)
              }}
              className="flex-1 bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-black py-4 rounded-2xl hover:opacity-90 transition-all shadow-xl flex items-center justify-center space-x-2"
            >
              <MapPin className="h-5 w-5" />
              <span>Ver Auditoria Completa</span>
            </button>
            <button 
              onClick={() => setNotification(null)}
              className="px-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-bold rounded-2xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
