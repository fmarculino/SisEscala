'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, XCircle, Loader2, MessageSquare, ShieldCheck } from 'lucide-react'
import { confirmarAvisoPontoPorToken } from '../../actions'

export function ConfirmarAvisoClient({ token }: { token: string }) {
  const [estado, setEstado] = useState<'aguardando' | 'enviando' | 'ok' | 'erro'>('aguardando')
  const [nome, setNome] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function confirmar() {
    setEstado('enviando')
    const res: any = await confirmarAvisoPontoPorToken(token)
    if (res?.success) {
      setNome(res.nome || null)
      setEstado('ok')
    } else {
      setErro(res?.error || 'Não foi possível confirmar.')
      setEstado('erro')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-7 space-y-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-2xl shrink-0 ${estado === 'ok'
            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600'
            : estado === 'erro'
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600'
              : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600'}`}>
            {estado === 'ok' ? <CheckCircle2 className="h-5 w-5" />
              : estado === 'erro' ? <XCircle className="h-5 w-5" />
              : <MessageSquare className="h-5 w-5" />}
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
              Aviso de registro de ponto
            </h1>
            <p className="text-sm text-zinc-500 leading-relaxed">
              {estado === 'ok'
                ? 'Pronto! O aviso está ativo.'
                : estado === 'erro'
                  ? 'Não foi possível ativar.'
                  : 'Confirme abaixo para começar a receber o resumo dos seus registros por e-mail.'}
            </p>
          </div>
        </div>

        {estado !== 'ok' && estado !== 'erro' && (
          <>
            <div className="flex items-start gap-3 p-4 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 rounded-2xl">
              <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                É um <b>aviso informativo</b>. Não é o Comprovante de Registro de Ponto e não
                substitui a sua folha. <b>Ativar ou não ativar não altera em nada o registro do
                seu ponto.</b>
              </p>
            </div>

            <button
              type="button"
              onClick={confirmar}
              disabled={estado === 'enviando'}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {estado === 'enviando' && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar ativação
            </button>
          </>
        )}

        {estado === 'ok' && (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl">
              <p className="text-sm text-emerald-800 dark:text-emerald-300 leading-relaxed">
                {nome ? <><b>{nome}</b>, o</> : 'O'} aviso foi ativado. Você passará a receber o
                resumo dos seus registros de ponto por e-mail, uma vez por semana.
              </p>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Quer receber todo dia, trocar para WhatsApp ou desligar? É tudo na aba
              <b> Minha Conta</b> do Portal do Servidor.
            </p>
          </div>
        )}

        {estado === 'erro' && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
            <p className="text-sm text-red-700 dark:text-red-400 leading-relaxed">{erro}</p>
          </div>
        )}

        <Link
          href="/consultar-escala"
          className="block text-center text-xs font-bold text-blue-600 hover:text-blue-700 pt-1"
        >
          Ir para o Portal do Servidor
        </Link>
      </div>
    </div>
  )
}
