'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, CheckCircle2, Loader2, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { redefinirPinComToken } from '../../actions'
import { PIN_MIN_DIGITOS, PIN_MAX_DIGITOS, conferirPinNovo } from '@/utils/pin'

export function RedefinirPinClient({ token }: { token: string }) {
  const [pin, setPin] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [expirado, setExpirado] = useState(false)
  const [pronto, setPronto] = useState(false)

  async function salvar() {
    setErro(null)

    if (pin !== confirmacao) {
      setErro('Os dois campos precisam ser iguais.')
      return
    }

    // Espelho da regra do banco, só para responder sem ida ao servidor. Quem decide continua
    // sendo `fn_validar_pin_novo` — e é ela que conhece `pin_min_digitos` configurado.
    const local = conferirPinNovo(pin)
    if (local) {
      setErro(local)
      return
    }

    setSalvando(true)
    const res: any = await redefinirPinComToken(token, pin)
    setSalvando(false)

    if (res?.success) {
      setPronto(true)
      return
    }
    setErro(res?.error || 'Não foi possível redefinir o PIN.')
    setExpirado(!!res?.expirado)
  }

  if (pronto) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-7 space-y-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-2xl shrink-0 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h1 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                PIN redefinido
              </h1>
              <p className="text-sm text-zinc-500 leading-relaxed">
                Use o PIN novo para entrar no Portal <b>e para bater o ponto</b> no terminal da
                sua unidade. O PIN antigo não funciona mais.
              </p>
            </div>
          </div>

          <Link
            href="/consultar-escala"
            className="block w-full py-3 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider hover:bg-blue-700 text-center"
          >
            Entrar no Portal
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-7 space-y-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl shrink-0 bg-blue-50 dark:bg-blue-900/20 text-blue-600">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
              Escolher um PIN novo
            </h1>
            <p className="text-sm text-zinc-500 leading-relaxed">
              De {PIN_MIN_DIGITOS} a {PIN_MAX_DIGITOS} números. Evite datas de nascimento,
              sequências (123456) e números repetidos.
            </p>
          </div>
        </div>

        {/* O mesmo aviso da troca dentro do Portal. Sem ele a pessoa troca à noite e descobre na
            frente do relógio, de manhã, que o PIN antigo não bate mais o ponto. */}
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            <b>Este PIN também é o que você usa para bater o ponto.</b> Depois de trocar, o PIN
            antigo <b>não funciona mais</b> — nem aqui no Portal, nem no terminal da sua unidade.
            Guarde o novo antes de confirmar.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-400 mb-1">
              Novo PIN
            </label>
            <div className="relative">
              <input
                type={mostrar ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={PIN_MAX_DIGITOS}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                className="block w-full px-3 py-2.5 pr-10 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white sm:text-sm font-mono tracking-[0.5em] text-center focus:ring-2 focus:ring-blue-500"
                placeholder="••••••"
              />
              <button
                type="button"
                onClick={() => setMostrar(!mostrar)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600"
              >
                {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-zinc-400 mb-1">
              Repita o novo PIN
            </label>
            <input
              type={mostrar ? 'text' : 'password'}
              inputMode="numeric"
              maxLength={PIN_MAX_DIGITOS}
              value={confirmacao}
              onChange={e => setConfirmacao(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvar() } }}
              className="block w-full px-3 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white sm:text-sm font-mono tracking-[0.5em] text-center focus:ring-2 focus:ring-blue-500"
              placeholder="••••••"
            />
          </div>
        </div>

        {erro && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
            <p className="text-xs font-bold text-red-700 dark:text-red-400 leading-relaxed">{erro}</p>
          </div>
        )}

        {/* Link vencido não tem o que tentar de novo nesta tela — o caminho é pedir outro. */}
        {expirado ? (
          <Link
            href="/consultar-escala"
            className="block w-full py-3 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider hover:bg-blue-700 text-center"
          >
            Pedir um link novo
          </Link>
        ) : (
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || !pin || !confirmacao}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar novo PIN
          </button>
        )}
      </div>
    </div>
  )
}
