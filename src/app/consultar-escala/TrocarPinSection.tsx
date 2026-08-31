'use client'

import { useState } from 'react'
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { trocarPinPortal } from './actions'
import { conferirPinNovo, PIN_MIN_DIGITOS, PIN_MAX_DIGITOS } from '@/utils/pin'

/**
 * Troca do PIN pelo próprio servidor (30/08/2026).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Até aqui o PIN era **gerado pelo coordenador e transmitido** por WhatsApp ou e-mail: duas
 * pessoas conheciam cada PIN, e ele passava por um canal. Definido pela própria pessoa, ele é
 * conhecido só por ela — a diferença entre segredo compartilhado e credencial pessoal.
 *
 * 🚨 **O AVISO DO TERMINAL NÃO PODE SAIR DAQUI.** Este PIN não é só do Portal: `fn_registrar_ponto`
 * usa a mesma credencial. Quem troca à noite e tenta bater o ponto de manhã com o antigo **leva
 * recusa** — e, pela conformidade da v1.22.0, matrícula/PIN inválidos é a única coisa que ainda
 * recusa batida: vira tentativa registrada e não vira ponto. Quem descobre isso na frente do
 * relógio, com fila atrás, perde a batida do dia.
 */
export function TrocarPinSection() {
  const [atual, setAtual] = useState('')
  const [novo, setNovo] = useState('')
  const [confirma, setConfirma] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  // Só dígitos, e nunca mais que o máximo: barrar na digitação evita a recusa que só apareceria
  // depois de o usuário preencher os três campos.
  const soDigitos = (v: string) => v.replace(/[^0-9]/g, '').slice(0, PIN_MAX_DIGITOS)

  const problemaNovo = novo ? conferirPinNovo(novo) : null
  const naoConfere = confirma.length > 0 && novo !== confirma
  const podeSalvar = !!atual && !!novo && !!confirma && !problemaNovo && !naoConfere && !salvando

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setOk(false)
    setSalvando(true)
    try {
      const res = await trocarPinPortal(atual, novo)
      if (res.error) {
        setErro(res.error)
      } else {
        setOk(true)
        setAtual('')
        setNovo('')
        setConfirma('')
      }
    } catch {
      setErro('Não foi possível trocar o PIN agora. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  const campo =
    'w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 ' +
    'text-lg font-bold tracking-[0.3em] text-center outline-none focus:ring-2 focus:ring-emerald-500 transition-all'

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-5">
      <div className="flex items-start gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <KeyRound className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            Trocar meu PIN
          </h3>
          <p className="text-xs text-zinc-500 mt-1">
            Escolha um PIN que só você saiba. O PIN atual foi gerado pela coordenação — trocá-lo faz
            dele uma senha sua.
          </p>
        </div>
      </div>

      {/* 🚨 Este bloco é a razão de a tela existir sem virar armadilha. Não remova nem esconda. */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
          <strong className="block text-sm mb-1">Este PIN também é o que você usa para bater o ponto.</strong>
          Depois de trocar, o PIN antigo <strong>não funciona mais</strong> — nem aqui no Portal, nem
          no terminal de presença da sua unidade. Guarde o novo antes de confirmar.
        </div>
      </div>

      {ok && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed">
            <strong className="block text-sm mb-1">PIN alterado.</strong>
            Use o novo PIN a partir de agora, inclusive no terminal de presença.
          </div>
        </div>
      )}

      {erro && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs font-bold text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      <form onSubmit={salvar} className="space-y-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
            PIN atual
          </label>
          <input
            type={mostrar ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="current-password"
            value={atual}
            onChange={e => setAtual(soDigitos(e.target.value))}
            className={campo}
            placeholder="••••"
          />
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
            Novo PIN
          </label>
          <input
            type={mostrar ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="new-password"
            value={novo}
            onChange={e => setNovo(soDigitos(e.target.value))}
            className={campo}
            placeholder={'•'.repeat(PIN_MIN_DIGITOS)}
          />
          <p className={`mt-1.5 text-[11px] ${problemaNovo ? 'text-red-600 font-bold' : 'text-zinc-500'}`}>
            {problemaNovo
              ? problemaNovo
              : `De ${PIN_MIN_DIGITOS} a ${PIN_MAX_DIGITOS} números, sem repetir o mesmo dígito e sem sequência.`}
          </p>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
            Repita o novo PIN
          </label>
          <input
            type={mostrar ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="new-password"
            value={confirma}
            onChange={e => setConfirma(soDigitos(e.target.value))}
            className={campo}
            placeholder={'•'.repeat(PIN_MIN_DIGITOS)}
          />
          {naoConfere && (
            <p className="mt-1.5 text-[11px] text-red-600 font-bold">Os dois PINs não são iguais.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={() => setMostrar(m => !m)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {mostrar ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {mostrar ? 'Ocultar' : 'Mostrar'} os números
          </button>

          <button
            type="submit"
            disabled={!podeSalvar}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {salvando ? 'Trocando…' : 'Trocar PIN'}
          </button>
        </div>
      </form>

      <p className="text-[11px] text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-3">
        Esqueceu o PIN? A coordenação da sua unidade pode gerar um novo para você. Toda troca fica
        registrada com data e hora.
      </p>
    </div>
  )
}
