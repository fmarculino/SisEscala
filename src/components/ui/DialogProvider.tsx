'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react'
import { Modal } from './Modal'

type DialogType = 'default' | 'danger' | 'warning' | 'success'

interface AlertOptions {
  title?: string
  message: string
  type?: DialogType
  confirmLabel?: string
}

interface ConfirmOptions extends AlertOptions {
  cancelLabel?: string
}

interface DialogContextValue {
  /** Substitui window.alert. Resolve quando o usuário fecha o modal. */
  alert: (options: string | AlertOptions) => Promise<void>
  /** Substitui window.confirm. Resolve true se confirmado, false caso contrário. */
  confirm: (options: string | ConfirmOptions) => Promise<boolean>
}

const DialogContext = createContext<DialogContextValue | null>(null)

interface DialogState {
  mode: 'alert' | 'confirm'
  title: string
  message: string
  type: DialogType
  confirmLabel: string
  cancelLabel: string
}

const TITULO_PADRAO: Record<DialogType, string> = {
  default: 'Aviso',
  danger: 'Erro',
  warning: 'Atenção',
  success: 'Tudo certo',
}

// Muitas chamadas herdadas do window.alert passam só a mensagem, no formato
// "Erro ao salvar: ...". Quando o chamador não define o tipo, inferimos pelo texto para
// que a cor e o título acompanhem a gravidade. Passar `type` explicitamente sempre vence.
function inferirTipo(message: string): DialogType {
  const texto = message ?? ''
  if (/^\s*(erro|falha|não foi possível|nao foi possivel)/i.test(texto)) return 'danger'
  if (/sucesso|enviad[oa]|aplicad[ao]|registrad[ao]/i.test(texto)) return 'success'
  return 'default'
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)
  // Guarda o resolve da Promise em aberto para o clique do usuário concluí-la.
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const abrir = useCallback((next: DialogState) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState(next)
    })
  }, [])

  const fechar = useCallback((resultado: boolean) => {
    setState(null)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(resultado)
  }, [])

  const alert = useCallback(
    async (options: string | AlertOptions) => {
      const o = typeof options === 'string' ? { message: options } : options
      const type = o.type ?? inferirTipo(o.message)
      await abrir({
        mode: 'alert',
        title: o.title ?? TITULO_PADRAO[type],
        message: o.message,
        type,
        confirmLabel: o.confirmLabel ?? 'Entendido',
        cancelLabel: '',
      })
    },
    [abrir]
  )

  const confirm = useCallback(
    (options: string | ConfirmOptions) => {
      const o = typeof options === 'string' ? { message: options } : options
      const type = o.type ?? 'warning'
      return abrir({
        mode: 'confirm',
        title: o.title ?? 'Confirmar ação',
        message: o.message,
        type,
        confirmLabel: o.confirmLabel ?? 'Confirmar',
        cancelLabel: o.cancelLabel ?? 'Cancelar',
      })
    },
    [abrir]
  )

  const value = useMemo(() => ({ alert, confirm }), [alert, confirm])

  const botaoConfirmar =
    state?.type === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : state?.type === 'success'
        ? 'bg-emerald-600 hover:bg-emerald-700'
        : 'bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-700 dark:hover:bg-zinc-600'

  return (
    <DialogContext.Provider value={value}>
      {children}

      <Modal
        isOpen={state !== null}
        // Fechar pelo X equivale a cancelar.
        onClose={() => fechar(false)}
        title={state?.title ?? ''}
        type={state?.type ?? 'default'}
        zIndexClass="z-[200]"
        footer={
          <>
            {state?.mode === 'confirm' && (
              <button
                type="button"
                onClick={() => fechar(false)}
                className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                {state?.cancelLabel}
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => fechar(true)}
              className={`flex-1 px-4 py-2.5 rounded-lg font-semibold text-white transition-colors ${botaoConfirmar}`}
            >
              {state?.confirmLabel}
            </button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-line leading-relaxed">
          {state?.message || 'Ocorreu um erro sem detalhes adicionais.'}
        </p>
      </Modal>
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) {
    throw new Error('useDialog precisa estar dentro de <DialogProvider> (montado no layout raiz).')
  }
  return ctx
}
