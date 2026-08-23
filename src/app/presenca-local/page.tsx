'use client'

import { useState, useEffect, useRef } from 'react'
import { formatarDataExtenso } from '@/utils/horario'
import { CheckCircle, Loader2, CheckSquare, XCircle, AlertTriangle, MessageCircle, ShieldOff } from 'lucide-react'

/**
 * Terminal de presença ativado pelo app local (coletor-rep), sem sessão Supabase Auth de
 * coordenador neste navegador — ver `/api/presenca-local/*` e `src/utils/terminalLocalSession.ts`.
 * Espelha `src/app/presenca/page.tsx` (mesmas cores de status, mesmo aviso legal, mesmo
 * polling de versão), com duas diferenças: não existe formulário de login, e a confirmação
 * chama `/api/presenca-local/registrar` em vez de `supabase.rpc('fn_registrar_ponto', ...)`.
 */
export default function PresencaTerminalLocalPage() {
  const [loading, setLoading] = useState(false)
  const [naoAtivado, setNaoAtivado] = useState(false)
  const matriculaInputRef = useRef<HTMLInputElement>(null)
  const pinInputRef = useRef<HTMLInputElement>(null)

  const [matricula, setMatricula] = useState('')
  const [pin, setPin] = useState('')
  // 'alerta' = a batida FOI registrada, mas fora do horário previsto e vai para revisão do
  // coordenador. Não é erro (Portaria 671/2021 veda recusa por horário) — ver src/app/presenca/page.tsx.
  const [status, setStatus] = useState<{ type: 'success' | 'alerta' | 'error' | 'idle', message: string }>({ type: 'idle', message: '' })

  // Mesmo risco do terminal clássico: fica aberto por dias numa tela de portaria e não
  // recarrega sozinho. Ver src/app/presenca/page.tsx para o histórico do incidente de 09/08/2026.
  const [atualizacaoPendente, setAtualizacaoPendente] = useState(false)

  useEffect(() => {
    const versaoCarregada = process.env.NEXT_PUBLIC_APP_VERSION
    if (!versaoCarregada) return

    let vivo = true
    async function conferir() {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const { version } = await r.json()
        if (vivo && version && version !== versaoCarregada) setAtualizacaoPendente(true)
      } catch {
        // Terminal de portaria costuma ter rede instável. Falhar a conferência não é evento.
      }
    }

    conferir()
    const id = setInterval(conferir, 5 * 60 * 1000)
    return () => { vivo = false; clearInterval(id) }
  }, [])

  useEffect(() => {
    if (!atualizacaoPendente) return
    if (loading || matricula || pin || status.type !== 'idle') return
    const id = setTimeout(() => window.location.reload(), 1500)
    return () => clearTimeout(id)
  }, [atualizacaoPendente, loading, matricula, pin, status.type])

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (!matricula || !pin) return

    setLoading(true)
    setStatus({ type: 'idle', message: '' })

    try {
      const r = await fetch('/api/presenca-local/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricula, pin }),
      })

      if (r.status === 401) {
        setNaoAtivado(true)
        return
      }

      const resultObj = await r.json().catch(() => null)
      const tipo: string = resultObj?.tipo || (resultObj?.success ? 'sucesso' : 'erro')

      if (tipo === 'sucesso') {
        setStatus({ type: 'success', message: resultObj?.message || 'Presença confirmada com sucesso!' })
        setMatricula('')
        setPin('')
        setTimeout(() => {
          setStatus({ type: 'idle', message: '' })
          matriculaInputRef.current?.focus()
        }, 3000)
      } else if (tipo === 'alerta') {
        setStatus({
          type: 'alerta',
          message: resultObj?.message || 'Ponto registrado fora do horário previsto. Seu coordenador vai revisar.'
        })
        setMatricula('')
        setPin('')
        setTimeout(() => {
          setStatus({ type: 'idle', message: '' })
          matriculaInputRef.current?.focus()
        }, 6000)
      } else {
        setStatus({ type: 'error', message: resultObj?.message || 'Não foi possível registrar. Confira a matrícula e o PIN.' })
        setTimeout(() => {
          setStatus({ type: 'idle', message: '' })
          setMatricula('')
          setPin('')
          matriculaInputRef.current?.focus()
        }, 3000)
      }
    } catch (err: any) {
      setStatus({ type: 'error', message: err?.message || 'Ocorreu um erro de rede ou de comunicação com o servidor.' })
      setTimeout(() => {
        setStatus({ type: 'idle', message: '' })
        setMatricula('')
        setPin('')
        matriculaInputRef.current?.focus()
      }, 3000)
    } finally {
      setLoading(false)
    }
  }

  // Sem cookie válido (nunca ativado, expirado, ou terminal desativado por um admin): não há
  // formulário de login aqui de propósito (decisão do usuário) — só reabrir pelo app local.
  if (naoAtivado) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
        <div className="w-full max-w-md space-y-6 bg-white dark:bg-zinc-900 p-10 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 text-center">
          <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-2xl flex items-center justify-center">
            <ShieldOff className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            Terminal não ativado
          </h1>
          <p className="text-zinc-500 text-sm">
            Este terminal precisa ser reaberto pelo aplicativo local instalado neste computador.
            Procure o administrador do sistema se o problema continuar.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 md:px-8 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-lg">
            <CheckSquare className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Terminal de Presença</h1>
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase">
              Ativado pelo aplicativo local deste computador
            </div>
          </div>
        </div>
      </header>

      {atualizacaoPendente && (
        <div className="bg-blue-600 text-white text-center text-xs font-bold py-2 px-4">
          Nova versão disponível — o terminal vai atualizar sozinho assim que ficar ocioso.
          Pode continuar registrando normalmente.
        </div>
      )}

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-[2.5rem] shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="p-8 md:p-12 space-y-10">
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">
                {(() => {
                  const hr = new Date().getHours();
                  if (hr >= 5 && hr < 12) return 'Bom dia!';
                  if (hr >= 12 && hr < 18) return 'Boa tarde!';
                  return 'Boa noite!';
                })()}
              </h2>
              <p className="text-zinc-500 font-medium">Informe sua matrícula e PIN individual para registrar sua <b>entrada ou saída</b> hoje.</p>
              <p className="mt-2 text-xs text-zinc-400 font-medium">
                Você pode registrar <b>a qualquer horário</b>. Se estiver fora do previsto, o ponto é
                registrado do mesmo jeito e seu coordenador revisa.
              </p>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full">
                <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                Quer receber um aviso no WhatsApp a cada ponto registrado? Ative em
                "Aviso de ponto no WhatsApp", no Portal do Servidor.
              </p>
            </div>

            {status.type !== 'idle' && (
              <div className={`p-6 rounded-2xl flex items-center gap-4 border animate-in fade-in slide-in-from-top-4 ${
                status.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                  : status.type === 'alerta'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              }`}>
                {status.type === 'success'
                  ? <CheckCircle className="h-8 w-8 shrink-0" />
                  : status.type === 'alerta'
                    ? <AlertTriangle className="h-8 w-8 shrink-0" />
                    : <XCircle className="h-8 w-8 shrink-0" />}
                <p className="text-lg font-black uppercase tracking-tight leading-none">{status.message}</p>
              </div>
            )}

            <form onSubmit={handleConfirm} className="grid grid-cols-1 md:grid-cols-2 gap-6" autoComplete="off">
              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Matrícula</label>
                <input
                  type="text"
                  ref={matriculaInputRef}
                  name="confirmacao_matricula"
                  id="confirmacao_matricula"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl px-6 py-5 text-2xl font-black text-center focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-zinc-300"
                  placeholder="000000"
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      pinInputRef.current?.focus()
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">PIN Individual</label>
                <input
                  type="password"
                  ref={pinInputRef}
                  name="confirmacao_pin"
                  id="confirmacao_pin"
                  required
                  maxLength={4}
                  autoComplete="new-password"
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl px-6 py-5 text-2xl font-black text-center focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all placeholder:text-zinc-300 tracking-[1em]"
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>

              <div className="md:col-span-2 pt-4">
                <button
                  type="submit"
                  disabled={loading || !matricula || !pin}
                  className="w-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-6 rounded-2xl font-black text-xl uppercase tracking-widest shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-4"
                >
                  {loading ? <Loader2 className="h-8 w-8 animate-spin" /> : 'Confirmar Presença'}
                </button>
              </div>
            </form>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-800/50 p-6 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              {formatarDataExtenso(new Date())}
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
