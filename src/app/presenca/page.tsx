'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { CheckCircle, Loader2, UserCheck, ShieldCheck, XCircle, ArrowLeft, LogOut, CheckSquare, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'

export default function PresencaTerminalPage() {
  const supabase = createClient()
  const [supervisor, setSupervisor] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [showSupervisorPassword, setShowSupervisorPassword] = useState(false)
  const matriculaInputRef = useRef<HTMLInputElement>(null)
  
  // Terminal states
  const [matricula, setMatricula] = useState('')
  const [pin, setPin] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'idle', message: string }>({ type: 'idle', message: '' })

  // 1. Check for supervisor session on load
  useEffect(() => {
    async function checkSession() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()
        
        if (profile && (profile.role === 'admin' || profile.role === 'super_admin' || profile.role === 'coordenador')) {
          setSupervisor(profile)
        }
      }
    }
    checkSession()
  }, [supabase])

  // 2. Supervisor Login
  async function handleSupervisorLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setAuthError(null)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setAuthError('Falha na autenticação: ' + error.message)
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()

    if (profile && (profile.role === 'admin' || profile.role === 'super_admin' || profile.role === 'coordenador')) {
      setSupervisor(profile)
    } else {
      setAuthError('Acesso negado: Apenas supervisores podem ativar este terminal.')
      await supabase.auth.signOut()
    }
    setLoading(false)
  }

  // 3. Presence Confirmation
  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (!matricula || !pin || !supervisor) return

    setLoading(true)
    setStatus({ type: 'idle', message: '' })

    try {
      const { data, error } = await supabase.rpc('fn_confirmar_presenca', {
        p_matricula: matricula,
        p_pin_servidor: pin,
        p_coordenador_id: supervisor.id
      })

      if (error) throw error

      // PostgREST might return the scalar jsonb result as an array or a flat object
      const resultObj = Array.isArray(data) ? data[0] : data

      if (resultObj && resultObj.success) {
        setStatus({ 
          type: 'success', 
          message: resultObj.message || 'Presença confirmada com sucesso!' 
        })
        // Clear inputs immediately
        setMatricula('')
        setPin('')
        // Auto clear success message after 3 seconds
        setTimeout(() => {
          setStatus({ type: 'idle', message: '' })
          matriculaInputRef.current?.focus()
        }, 3000)
      } else {
        setStatus({ 
          type: 'error', 
          message: (resultObj && resultObj.message) || 'Erro na validação: Verifique os dados inseridos ou a janela de horário.' 
        })
        // Auto clear inputs and error message after 3 seconds for the next user
        setTimeout(() => {
          setStatus({ type: 'idle', message: '' })
          setMatricula('')
          setPin('')
          matriculaInputRef.current?.focus()
        }, 3000)
      }
    } catch (err: any) {
      setStatus({ 
        type: 'error', 
        message: err?.message || 'Ocorreu um erro de rede ou de comunicação com o servidor.' 
      })
      // Auto clear inputs and error message on exception after 3 seconds
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

  // Supervisor Logout
  async function handleLogout() {
    await supabase.auth.signOut()
    setSupervisor(null)
    setStatus({ type: 'idle', message: '' })
  }

  // IF NO SUPERVISOR: Show activation screen
  if (!supervisor) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
        <Link href="/login" className="absolute top-8 left-8 flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors font-medium">
          <ArrowLeft className="h-4 w-4" />
          Voltar para o Login
        </Link>

        <div className="w-full max-w-md space-y-8 bg-white dark:bg-zinc-900 p-10 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800">
          <div className="text-center space-y-2">
            <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h1 className="text-3xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Ativar Terminal</h1>
            <p className="text-zinc-500 text-sm">Um Coordenador ou Administrador deve ativar este terminal para iniciar a confirmação de presença.</p>
          </div>

          <form onSubmit={handleSupervisorLogin} className="space-y-6 pt-4">
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Email do Supervisor</label>
                <input 
                  name="email"
                  type="email"
                  required
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="supervisor@municipio.gov.br"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">Senha</label>
                <div className="relative">
                  <input 
                    name="password"
                    type={showSupervisorPassword ? 'text' : 'password'}
                    required
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl pl-4 pr-10 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSupervisorPassword(!showSupervisorPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    {showSupervisorPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {authError && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400 font-medium">{authError}</p>
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black uppercase tracking-tighter shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
              Ativar Modo Presença
            </button>
          </form>
        </div>
      </div>
    )
  }

  // IF SUPERVISOR ACTIVE: Show terminal screen
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 md:px-8 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-lg">
            <CheckSquare className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Terminal de Presença</h1>
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase">
              <UserCheck className="h-3 w-3 text-blue-500" />
              Supervisor Ativo: <span className="text-blue-600">{supervisor.nome || supervisor.email}</span>
            </div>
          </div>
        </div>
        
        <button 
          onClick={handleLogout}
          className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
          title="Sair e Desativar Terminal"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      {/* Main Terminal */}
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
            </div>

            {/* Status Feedback */}
            {status.type !== 'idle' && (
              <div className={`p-6 rounded-2xl flex items-center gap-4 border animate-in fade-in slide-in-from-top-4 ${
                status.type === 'success' 
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' 
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              }`}>
                {status.type === 'success' ? <CheckCircle className="h-8 w-8 shrink-0" /> : <XCircle className="h-8 w-8 shrink-0" />}
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
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest ml-1">PIN Individual</label>
                <input 
                  type="password"
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
                  {loading ? (
                    <Loader2 className="h-8 w-8 animate-spin" />
                  ) : (
                    <>
                      Confirmar Presença
                      <ArrowLeft className="h-6 w-6 rotate-180" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
          
          <div className="bg-zinc-50 dark:bg-zinc-800/50 p-6 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </p>
            <button 
              onClick={handleLogout}
              className="text-[10px] font-black text-red-500 hover:text-red-600 uppercase tracking-tighter flex items-center gap-2 px-3 py-1 bg-red-100/50 dark:bg-red-900/20 rounded-full transition-all"
            >
              <LogOut className="h-3 w-3" />
              Encerrar Terminal
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
