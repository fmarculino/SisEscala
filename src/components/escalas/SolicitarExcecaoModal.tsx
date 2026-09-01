'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Send, Loader2, X, AlertTriangle, ShieldQuestion } from 'lucide-react'
import { formatarHoras, type CargaEscala } from '@/utils/limiteCargaMensal'

/**
 * Pedido de Autorização Extraordinária ao RH (31/08/2026).
 *
 * ⚠️ **Existe porque a mensagem antiga mandava fazer algo que o sistema não oferecia.** Quem não
 * era admin recebia "Solicite a um Administrador a concessão de uma Autorização Extraordinária"
 * — e não havia pedido, tela nem registro. Eram 73 coordenadores e 8 ass_adm nessa situação,
 * contra 5 pessoas que podiam conceder. O combinado saía por WhatsApp e a decisão não ficava em
 * lugar nenhum.
 *
 * ⚠️ **A justificativa é obrigatória aqui e no banco** (`fn_solicitar_excecao_carga` recusa
 * texto vazio): é o único conteúdo que o RH tem para decidir, e o pedido vira registro de uma
 * decisão sobre carga horária de servidor público.
 *
 * ⚠️ O que se pede é o **adicional do mês inteiro da pessoa**, não desta grade — a autorização é
 * uma por (servidor, mês, ano) e vale para a soma de todas as escalas (armadilha 26). Por isso a
 * composição do mês aparece na tela: sem ela, quem pede olha 120h numa grade cujo mês soma 409h.
 */

interface SolicitarExcecaoModalProps {
  isOpen: boolean
  onClose: () => void
  onEnviado: (mensagem: string) => void
  servidorId: string
  servidorNome: string
  unidadeId: string
  setorId?: string | null
  mes: number
  ano: number
  /** Horas e sobreavisos desta grade. */
  horasAtuais: number
  sobreavisosAtuais: number
  /** As OUTRAS escalas do servidor na competência (`fn_carga_mensal_servidor`). */
  cargasOutras?: CargaEscala[]
  tetoHoras: number
  tetoSobreavisos: number
}

export function SolicitarExcecaoModal({
  isOpen,
  onClose,
  onEnviado,
  servidorId,
  servidorNome,
  unidadeId,
  setorId,
  mes,
  ano,
  horasAtuais,
  sobreavisosAtuais,
  cargasOutras,
  tetoHoras,
  tetoSobreavisos,
}: SolicitarExcecaoModalProps) {
  const supabase = createClient()
  const [enviando, setEnviando] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [horas, setHoras] = useState<number>(0)
  const [sobreavisos, setSobreavisos] = useState<number>(0)
  const [justificativa, setJustificativa] = useState('')

  const outras = (cargasOutras || []).filter(c => Number(c.horas) > 0 || Number(c.sobreavisos) > 0)
  const horasOutras = outras.reduce((acc, c) => acc + (Number(c.horas) || 0), 0)
  const sobreavisosOutras = outras.reduce((acc, c) => acc + (Number(c.sobreavisos) || 0), 0)
  const horasMes = (Number(horasAtuais) || 0) + horasOutras
  const sobreavisosMes = (Number(sobreavisosAtuais) || 0) + sobreavisosOutras

  useEffect(() => {
    if (!isOpen) return
    setErrorMsg('')
    setJustificativa('')
    // Sugere exatamente o que falta para o mês caber no teto — arredondado para cima, porque
    // pedir 3,4h não existe e pedir 3h deixaria o lançamento barrado do mesmo jeito.
    setHoras(Math.max(0, Math.ceil(horasMes - tetoHoras)))
    setSobreavisos(Math.max(0, sobreavisosMes - tetoSobreavisos))
  }, [isOpen, horasMes, sobreavisosMes, tetoHoras, tetoSobreavisos])

  if (!isOpen) return null

  const nomeMes = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()

  const handleEnviar = async () => {
    if (!justificativa.trim()) {
      setErrorMsg('Informe a justificativa: é o que o RH lê para decidir.')
      return
    }
    if (horas <= 0 && sobreavisos <= 0) {
      setErrorMsg('Informe quantas horas ou quantos sobreavisos adicionais o mês precisa.')
      return
    }

    setEnviando(true)
    setErrorMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_solicitar_excecao_carga', {
        p_servidor_id: servidorId,
        p_unidade_id: unidadeId,
        p_mes: mes,
        p_ano: ano,
        p_justificativa: justificativa.trim(),
        p_horas: horas,
        p_sobreavisos: sobreavisos,
        p_setor_id: setorId || null,
        p_horas_no_pedido: horasMes,
        p_teto_no_pedido: tetoHoras,
      })
      if (error) throw error

      // A RPC devolve `ok: false` quando já existe pedido pendente — não é erro de sistema, é
      // resposta de negócio, e o texto dela nomeia quem já pediu. Mostrar como falha genérica
      // esconderia justamente a informação útil.
      if (data && data.ok === false) {
        setErrorMsg(data.mensagem || 'Já existe um pedido pendente para este servidor nesta competência.')
        return
      }

      onEnviado(data?.mensagem || 'Pedido enviado ao RH.')
      onClose()
    } catch (err: any) {
      setErrorMsg(err.message || 'Não foi possível enviar o pedido.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    // z-[100] é a camada dos modais desta aplicação, a mesma de AutorizacaoExcecaoModal: este
    // nasce a partir do modal de confirmação do teto, e camada diferente entre diálogos irmãos é
    // o que já produziu "abriu por trás".
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 bg-blue-500/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-2xl">
              <ShieldQuestion className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                Solicitar Autorização
              </h3>
              <p className="text-xs text-zinc-500 font-medium">
                O pedido vai ao RH, que decide e registra
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-zinc-400 uppercase tracking-widest">Servidor</span>
              <span className="font-bold text-blue-600 dark:text-blue-400 uppercase">{nomeMes} / {ano}</span>
            </div>
            <p className="text-base font-black text-zinc-900 dark:text-white uppercase">{servidorNome}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-2xl space-y-1">
              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Horas de Trabalho</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Mês: <strong className="text-zinc-900 dark:text-white">{formatarHoras(horasMes)}h</strong></span>
                <span className="text-xs text-zinc-500">Teto: <strong>{formatarHoras(tetoHoras)}h</strong></span>
              </div>
            </div>
            <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl space-y-1">
              <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">Sobreavisos (Unidades)</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Mês: <strong className="text-zinc-900 dark:text-white">{sobreavisosMes} un</strong></span>
                <span className="text-xs text-zinc-500">Teto: <strong>{tetoSobreavisos} un</strong></span>
              </div>
            </div>
          </div>

          {outras.length > 0 && (
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 rounded-2xl space-y-2">
              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">
                Composição do mês
              </span>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-zinc-600 dark:text-zinc-300">Esta escala</span>
                <span className="font-bold text-zinc-900 dark:text-white">
                  {formatarHoras(horasAtuais)}h{sobreavisosAtuais > 0 ? ` · ${sobreavisosAtuais} un` : ''}
                </span>
              </div>
              {outras.map(c => (
                <div key={c.escala_mensal_id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-zinc-600 dark:text-zinc-300 truncate" title={`${c.unidade_nome} / ${c.setor_caminho}`}>
                    {c.unidade_nome} / {c.setor_caminho}
                    {c.status === 'Fechada' && <span className="text-[10px] text-zinc-400"> (Fechada)</span>}
                  </span>
                  <span className="font-bold text-zinc-900 dark:text-white whitespace-nowrap">
                    {formatarHoras(c.horas)}h{Number(c.sobreavisos) > 0 ? ` · ${c.sobreavisos} un` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                  Horas Adicionais
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={horas}
                    onChange={(e) => setHoras(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">h</span>
                </div>
                <p className="text-[10px] text-zinc-400">Teto pedido: <strong>{formatarHoras(tetoHoras + horas)}h</strong></p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                  Sobreavisos Adicionais
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={sobreavisos}
                    onChange={(e) => setSobreavisos(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold pr-10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">un</span>
                </div>
                <p className="text-[10px] text-zinc-400">Teto pedido: <strong>{tetoSobreavisos + sobreavisos} un</strong></p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                Justificativa <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Por que este servidor precisa ultrapassar o teto neste mês? (cobertura de setor, afastamento de colega, plantão extraordinário...)"
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs focus:ring-2 focus:ring-blue-500 outline-none font-medium"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl flex items-start gap-2 text-xs text-red-600 dark:text-red-400 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="px-5 py-3 rounded-xl font-bold text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleEnviar}
            disabled={enviando}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md shadow-blue-600/20 active:scale-95 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {enviando ? 'Enviando...' : 'Enviar Pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}
