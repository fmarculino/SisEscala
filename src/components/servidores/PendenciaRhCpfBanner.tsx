'use client'

import { useEffect, useState } from 'react'
import { Info, Loader2, CheckCircle2 } from 'lucide-react'
import { buscarPendenciaPorCpf, atualizarCadastroViaPendenciaRh } from '@/app/(dashboard)/servidores/actions'

interface PendenciaEncontrada {
  id: string
  nome: string
  matricula: string
  classificacao: string | null
  cargo_sugerido: string | null
  departamento_origem: string
}

interface PendenciaRhCpfBannerProps {
  cpf: string
  /**
   * 'novo' — servidor ainda não existe. O banner só marca a intenção (`onSelecionar`); quem
   * aplica é `createServidor`, depois que o cadastro é criado de verdade (reusa
   * `atualizarCadastroViaPendenciaRh` internamente).
   * 'edicao' — servidor já existe (`servidorIdAtual`). O botão aplica na hora.
   */
  modo: 'novo' | 'edicao'
  servidorIdAtual?: string
  onSelecionar?: (pendenciaId: string | null) => void
  onAplicado?: () => void
}

/**
 * Detecta, pelo CPF digitado no cadastro/edição de servidor, se existe uma pendência de
 * importação do RH (v1.42.0) esperando virar cadastro — sem que ninguém precise saber que a tela
 * de Pendências existe. Pedido do usuário (12/08/2026): "o próprio sistema consultar" essa base
 * ao criar ou editar um servidor, e tirar da fila de pendências à medida que for usada — a
 * segunda parte já é garantida por `fn_atualizar_cadastro_via_pendencia_rh`, que sempre marca
 * `promovido_em` como parte de aplicar os dados (não há caminho aqui que puxe dado sem também
 * consumir a pendência).
 */
export function PendenciaRhCpfBanner({ cpf, modo, servidorIdAtual, onSelecionar, onAplicado }: PendenciaRhCpfBannerProps) {
  const [match, setMatch] = useState<PendenciaEncontrada | null>(null)
  const [querPuxar, setQuerPuxar] = useState(true)
  const [aplicando, setAplicando] = useState(false)
  const [aplicado, setAplicado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const digitos = (cpf || '').replace(/\D/g, '')
    if (digitos.length !== 11) {
      setMatch(null)
      return
    }
    let cancelado = false
    const timer = setTimeout(async () => {
      const res = await buscarPendenciaPorCpf(digitos)
      if (cancelado) return
      setMatch((res && !(res as any).error ? (res as PendenciaEncontrada) : null))
    }, 400)
    return () => { cancelado = true; clearTimeout(timer) }
  }, [cpf])

  useEffect(() => {
    if (modo === 'novo') onSelecionar?.(match && querPuxar ? match.id : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, querPuxar, modo])

  async function handleAplicarAgora() {
    if (!match || !servidorIdAtual) return
    setAplicando(true)
    setErro(null)
    const res = await atualizarCadastroViaPendenciaRh(match.id, servidorIdAtual)
    setAplicando(false)
    if ((res as any)?.error) {
      setErro((res as any).error)
      return
    }
    setAplicado(true)
    onAplicado?.()
  }

  if (!match) return null

  if (aplicado) {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Dados complementares aplicados a partir da pendência de importação do RH.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-500/10 p-3 text-sm text-blue-900 dark:text-blue-200 flex items-start gap-2">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 space-y-2">
        <p>
          Encontramos uma pendência de importação do RH para este CPF: <b>{match.nome}</b>
          {match.departamento_origem ? ` (${match.departamento_origem})` : ''}. Dados
          complementares podem ser puxados automaticamente — só preenche o que estiver vazio,
          nunca sobrescreve o que já foi digitado aqui.
        </p>
        {modo === 'novo' ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={querPuxar} onChange={e => setQuerPuxar(e.target.checked)} />
            Puxar dados complementares desta pendência ao salvar
          </label>
        ) : (
          <button
            type="button"
            onClick={handleAplicarAgora}
            disabled={aplicando}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {aplicando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Puxar dados complementares agora
          </button>
        )}
        {erro && <p className="text-red-600 dark:text-red-400 text-xs">{erro}</p>}
      </div>
    </div>
  )
}
