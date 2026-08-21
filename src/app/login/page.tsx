'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { login } from './actions'
import { createClient } from '@/utils/supabase/client'

import { Eye, EyeOff, CalendarDays, ChevronRight } from 'lucide-react'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [headerLogoUrl, setHeaderLogoUrl] = useState<string>('')
  const [terminalClassicoHabilitado, setTerminalClassicoHabilitado] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetchHeaderLogo() {
      const { data } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'instituicao_cabecalho_url')
        .single()
      if (data?.valor) {
        setHeaderLogoUrl(data.valor)
      }

      const { data: terminalData } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'terminal_classico_habilitado')
        .single()
      if (terminalData && terminalData.valor === false) {
        setTerminalClassicoHabilitado(false)
      }
    }
    fetchHeaderLogo()
  }, [])

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await login(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <div className="text-center flex flex-col items-center">
          {headerLogoUrl && (
            <div className="mb-4 h-24 w-full flex items-center justify-center overflow-hidden">
              <img 
                src={headerLogoUrl} 
                alt="Logo Instituição" 
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
          <h2 className={`text-3xl font-extrabold tracking-tight text-foreground ${headerLogoUrl ? 'mt-2' : 'mt-6'}`}>
            SisEscala
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Entre para gerenciar suas escalas
          </p>
        </div>
        <form className="mt-8 space-y-6" action={handleSubmit}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
                placeholder="email@municipio.gov.br"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Senha
                </label>
                <div className="text-sm">
                  <Link href="/esqueci-a-senha" className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300">
                    Esqueceu a senha?
                  </Link>
                </div>
              </div>
              <div className="relative mt-1">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="block w-full rounded-md border border-zinc-300 bg-zinc-50 pl-3 pr-10 py-2 text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-200 dark:border-zinc-800"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-zinc-500 dark:bg-zinc-900">Acesso Rápido</span>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {/* Porta de entrada do servidor: e o caminho mais usado desta tela, mas era o
                elemento mais apagado dela. Cor propria (indigo), para nao competir com o
                "Entrar" azul do formulario de coordenador. */}
            <Link
              href="/consultar-escala"
              className="group flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 py-3.5 px-4 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-indigo-700/20 hover:from-indigo-700 hover:to-indigo-600 hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 transition-all duration-200"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                <CalendarDays className="h-5 w-5" />
              </span>
              <span className="flex flex-col text-left leading-tight">
                <span className="text-sm font-bold uppercase tracking-wide">Portal do Servidor</span>
                <span className="text-[11px] font-medium text-indigo-100">Consulte sua escala e folha de ponto</span>
              </span>
              <ChevronRight className="ml-auto h-5 w-5 text-indigo-100 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            
            {terminalClassicoHabilitado && (
              <Link
                href="/presenca"
                className="flex w-full justify-center items-center rounded-md border border-emerald-200 bg-emerald-50/50 py-2 px-4 text-sm font-bold text-emerald-700 shadow-sm hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-400 dark:hover:bg-emerald-900/20 transition-all duration-200"
              >
                ✅ Confirmação de Presença
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
