'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { listarPendencias, buscarEscalasCandidatas, aceitarMarcacaoPendente } from './actions'

interface Pendencia {
  marcacao_id: string
  servidor_id: string
  servidor_nome: string
  matricula: string
  ocorrido_em: string
  unidade_id: string
  setor_id: string
  observacao: string
  dia: number
  ja_tratada: boolean
}

const PASSOS = [
  { value: 'entrada', label: 'Entrada' },
  { value: 'intervalo_saida', label: 'Saída do intervalo' },
  { value: 'intervalo_retorno', label: 'Retorno do intervalo' },
  { value: 'saida', label: 'Saída' },
]

function TratarPendenciaModal({
  pendencia,
  onClose,
  onTratada,
}: {
  pendencia: Pendencia
  onClose: () => void
  onTratada: () => void
}) {
  const [escalas, setEscalas] = useState<{ id: string; categoria: string; turno_codigo: string | null }[]>([])
  const [carregando, setCarregando] = useState(true)
  const [escalaId, setEscalaId] = useState('')
  const [passo, setPasso] = useState('entrada')
  const [justificativa, setJustificativa] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    buscarEscalasCandidatas(pendencia.servidor_id, pendencia.ocorrido_em)
      .then((data) => { if (vivo) { setEscalas(data); if (data[0]) setEscalaId(data[0].id) } })
      .catch((err) => { if (vivo) setErro(err.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [pendencia.servidor_id, pendencia.ocorrido_em])

  async function handleAceitar() {
    if (!escalaId || !justificativa.trim()) {
      setErro('Selecione a escala e informe a justificativa.')
      return
    }
    setSalvando(true)
    setErro(null)
    const resultado = await aceitarMarcacaoPendente({
      marcacaoId: pendencia.marcacao_id,
      escalaDiariaId: escalaId,
      passo,
      justificativa,
    })
    setSalvando(false)

    if (resultado?.error || resultado?.success === false) {
      setErro(resultado?.error || resultado?.message || 'Não foi possível tratar a marcação.')
      return
    }
    onTratada()
  }

  return (
    <Modal isOpen onClose={onClose} title={`Tratar marcação — ${pendencia.servidor_nome}`}>
      <div className="space-y-4">
        <div className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl text-xs text-zinc-600 dark:text-zinc-400">
          <p><b>Matrícula:</b> {pendencia.matricula}</p>
          <p><b>Batida real:</b> {new Date(pendencia.ocorrido_em).toLocaleString('pt-BR')}</p>
          {pendencia.observacao && <p className="mt-1 italic">{pendencia.observacao}</p>}
        </div>

        {carregando ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
        ) : escalas.length === 0 ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Nenhuma escala de Regular/Plantão/Extra encontrada para este servidor nesse dia.
          </p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Escala do dia</label>
              <select
                value={escalaId}
                onChange={(e) => setEscalaId(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
              >
                {escalas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.categoria}{e.turno_codigo ? ` — ${e.turno_codigo}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Passo</label>
              <select
                value={passo}
                onChange={(e) => setPasso(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
              >
                {PASSOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Justificativa</label>
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3}
                placeholder="Ex.: Chegou atrasado por consulta médica."
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
              />
            </div>

            {erro && <p className="text-xs text-red-600 font-medium">{erro}</p>}

            <button
              onClick={handleAceitar}
              disabled={salvando}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Gravar horário real como {PASSOS.find((p) => p.value === passo)?.label.toLowerCase()}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}

export function PendenciasTab() {
  const [pendencias, setPendencias] = useState<Pendencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionada, setSelecionada] = useState<Pendencia | null>(null)

  async function recarregar() {
    setCarregando(true)
    try {
      setPendencias(await listarPendencias())
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { recarregar() }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Batidas reais do terminal fora do horário previsto. A Portaria 671/2021 veda recusar por
          horário — a batida foi registrada e espera sua decisão sobre a que passo pertence.
        </p>
        <button
          onClick={recarregar}
          className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
          title="Atualizar"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : pendencias.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhuma pendência no seu escopo.</p>
      ) : (
        <div className="space-y-2">
          {pendencias.map((p) => (
            <div
              key={p.marcacao_id}
              className="flex items-center justify-between p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">
                    {p.servidor_nome} <span className="text-zinc-400 font-normal">({p.matricula})</span>
                  </p>
                  <p className="text-xs text-zinc-500">{new Date(p.ocorrido_em).toLocaleString('pt-BR')}</p>
                  {p.observacao && <p className="text-[11px] text-zinc-400 italic mt-0.5">{p.observacao}</p>}
                </div>
              </div>
              {p.ja_tratada ? (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="h-4 w-4" /> Tratada
                </span>
              ) : (
                <button
                  onClick={() => setSelecionada(p)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 shrink-0"
                >
                  Tratar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {selecionada && (
        <TratarPendenciaModal
          pendencia={selecionada}
          onClose={() => setSelecionada(null)}
          onTratada={() => { setSelecionada(null); recarregar() }}
        />
      )}
    </div>
  )
}
