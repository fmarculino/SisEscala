'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Shield, Loader2, Save, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatarHoras, type CargaEscala } from '@/utils/limiteCargaMensal'

interface AutorizacaoExcecaoModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  servidorId: string
  servidorNome: string
  unidadeId: string
  unidadeNome?: string
  mes: number
  ano: number
  limiteGlobalHoras: number
  limiteGlobalSobreavisos: number
  /** Horas e sobreavisos desta grade. */
  horasAtuais: number
  sobreavisosAtuais: number
  /**
   * As OUTRAS escalas do servidor na mesma competência (`fn_carga_mensal_servidor`).
   *
   * ⚠️ Sem isto o modal comparava o teto contra o total de uma grade só — o mesmo erro que ele
   * existe para tratar. A autorização é sobre o mês da pessoa, então a tela precisa mostrar o
   * mês da pessoa.
   */
  cargasOutras?: CargaEscala[]
  excecaoExistente?: {
    id?: string
    horas_adicionais_autorizadas: number
    sobreavisos_adicionais_autorizados: number
    motivo_justificativa: string
  } | null
}

export function AutorizacaoExcecaoModal({
  isOpen,
  onClose,
  onSaved,
  servidorId,
  servidorNome,
  unidadeId,
  unidadeNome,
  mes,
  ano,
  limiteGlobalHoras,
  limiteGlobalSobreavisos,
  horasAtuais,
  sobreavisosAtuais,
  cargasOutras,
  excecaoExistente
}: AutorizacaoExcecaoModalProps) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const [horasAdicionais, setHorasAdicionais] = useState<number>(0)
  const [sobreavisosAdicionais, setSobreavisosAdicionais] = useState<number>(0)
  const [justificativa, setJustificativa] = useState('')

  // O que a autorização de fato precisa cobrir: a soma de TODAS as escalas do mês, não só a
  // desta grade. Era exatamente aqui que a margem sugerida saía curta.
  const outras = (cargasOutras || []).filter(c => Number(c.horas) > 0 || Number(c.sobreavisos) > 0)
  const horasOutras = outras.reduce((acc, c) => acc + (Number(c.horas) || 0), 0)
  const sobreavisosOutras = outras.reduce((acc, c) => acc + (Number(c.sobreavisos) || 0), 0)
  const horasMes = (Number(horasAtuais) || 0) + horasOutras
  const sobreavisosMes = (Number(sobreavisosAtuais) || 0) + sobreavisosOutras

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('')
      if (excecaoExistente) {
        setHorasAdicionais(Number(excecaoExistente.horas_adicionais_autorizadas) || 0)
        setSobreavisosAdicionais(Number(excecaoExistente.sobreavisos_adicionais_autorizados) || 0)
        setJustificativa(excecaoExistente.motivo_justificativa || '')
      } else {
        // Sugere margem para cobrir o excesso do MÊS INTEIRO, se houver
        const excessoHoras = Math.max(0, Math.ceil(horasMes - limiteGlobalHoras))
        const excessoSob = Math.max(0, sobreavisosMes - limiteGlobalSobreavisos)
        setHorasAdicionais(excessoHoras)
        setSobreavisosAdicionais(excessoSob)
        setJustificativa('')
      }
    }
  }, [isOpen, excecaoExistente, horasMes, sobreavisosMes, limiteGlobalHoras, limiteGlobalSobreavisos])

  if (!isOpen) return null

  const nomeMes = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()
  const tetoEfetivoHoras = limiteGlobalHoras + horasAdicionais
  const tetoEfetivoSob = limiteGlobalSobreavisos + sobreavisosAdicionais

  const handleSave = async () => {
    if (!justificativa.trim()) {
      setErrorMsg('Por favor, informe a justificativa obrigatória para esta autorização extraordinária.')
      return
    }

    setSaving(true)
    setErrorMsg('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada. Faça login novamente.')

      const payload = {
        servidor_id: servidorId,
        unidade_id: unidadeId,
        mes,
        ano,
        horas_adicionais_autorizadas: horasAdicionais,
        sobreavisos_adicionais_autorizados: sobreavisosAdicionais,
        motivo_justificativa: justificativa.trim(),
        autorizado_por: user.id,
        updated_at: new Date().toISOString()
      }

      // ⚠️ A chave é (servidor, mês, ano) desde 20260828120000: o teto é da pessoa no mês, e uma
      // autorização por unidade deixaria dois administradores concederem +100h cada, elevando o
      // teto efetivo a 500h sem que ninguém tenha decidido isso. `unidade_id` continua no
      // payload como registro de ONDE a autorização foi dada.
      const { error } = await supabase
        .from('excecoes_escala_servidor')
        .upsert(payload, { onConflict: 'servidor_id,mes,ano' })

      if (error) throw error

      onSaved()
      onClose()
    } catch (err: any) {
      console.error('Erro ao salvar autorização extraordinária:', err)
      setErrorMsg(err.message || 'Erro ao salvar a autorização extraordinária.')
    } finally {
      setSaving(false)
    }
  }

  return (
    // z-[100] é a camada dos modais desta aplicação (`src/components/ui/Modal.tsx`); o
    // DialogProvider fica acima, em z-[200]. Este modal estava em `z-50` e é aberto A PARTIR do
    // modal de confirmação do Teto Mensal — então nascia ATRÁS de quem o abriu, e era isso que
    // o usuário via como "abriu por trás". O fechamento do modal anterior já foi corrigido no
    // botão (ScaleGrid), mas empilhar camadas diferentes para diálogos irmãos é a armadilha em
    // si: qualquer sobreposição futura voltaria a inverter.
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Modal */}
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 bg-amber-500/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                Autorização Extraordinária
              </h3>
              <p className="text-xs text-zinc-500 font-medium">
                Prerrogativa do Administrador para exceção de limites na escala
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

        {/* Form Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Info Card do Servidor */}
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-zinc-400 uppercase tracking-widest">Servidor</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 uppercase">{nomeMes} / {ano}</span>
            </div>
            <p className="text-base font-black text-zinc-900 dark:text-white uppercase">{servidorNome}</p>
            {unidadeNome && <p className="text-xs text-zinc-500">{unidadeNome}</p>}
          </div>

          {/* Comparativo de Limites Globais vs o MÊS INTEIRO da pessoa */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-2xl space-y-1">
              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Horas de Trabalho</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Mês: <strong className="text-zinc-900 dark:text-white">{formatarHoras(horasMes)}h</strong></span>
                <span className="text-xs text-zinc-500">Global: <strong>{formatarHoras(limiteGlobalHoras)}h</strong></span>
              </div>
            </div>

            <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl space-y-1">
              <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">Sobreavisos (Unidades)</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-zinc-500">Mês: <strong className="text-zinc-900 dark:text-white">{sobreavisosMes} un</strong></span>
                <span className="text-xs text-zinc-500">Global: <strong>{limiteGlobalSobreavisos} un</strong></span>
              </div>
            </div>
          </div>

          {/*
            De onde vem o número do mês. Sem esta composição, o administrador vê "409h" numa
            grade que mostra 120h e não tem como conferir nada — e é justamente essa cegueira
            que a autorização está sendo chamada a resolver.
          */}
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
              <div className="flex items-baseline justify-between text-xs pt-2 border-t border-zinc-200 dark:border-zinc-700">
                <span className="font-black text-zinc-500 uppercase tracking-wider">Total</span>
                <span className="font-black text-zinc-900 dark:text-white">
                  {formatarHoras(horasMes)}h{sobreavisosMes > 0 ? ` · ${sobreavisosMes} un` : ''}
                </span>
              </div>
            </div>
          )}

          {/* Formulário de Exceção */}
          <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                  Horas Adicionais Autorizadas
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={horasAdicionais}
                    onChange={(e) => setHorasAdicionais(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none font-bold pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">h</span>
                </div>
                <p className="text-[10px] text-zinc-400">Teto final: <strong>{tetoEfetivoHoras}h</strong></p>
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
                    value={sobreavisosAdicionais}
                    onChange={(e) => setSobreavisosAdicionais(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none font-bold pr-10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">un</span>
                </div>
                <p className="text-[10px] text-zinc-400">Teto final: <strong>{tetoEfetivoSob} un</strong></p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                Motivo / Justificativa Legal <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Descreva fundamentação legal ou operacional que autoriza o aumento extraordinário..."
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs focus:ring-2 focus:ring-amber-500 outline-none font-medium"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl flex items-center gap-2 text-xs text-red-600 dark:text-red-400 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-5 py-3 rounded-xl font-bold text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider bg-amber-600 text-white hover:bg-amber-700 transition-all shadow-md shadow-amber-600/20 active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Gravando...' : 'Salvar Autorização'}
          </button>
        </div>
      </div>
    </div>
  )
}
