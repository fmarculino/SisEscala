'use client'

import { useEffect, useMemo, useState } from 'react'
import { Zap, Loader2, MapPin, Building2, X, AlertTriangle, Check } from 'lucide-react'
import {
  acionarSobreavisoAction,
  enviarAcionamentoWhatsAppAction,
  getDestinosSobreaviso,
  getLotacaoDoAcionador,
  type DestinoUnidade
} from '@/app/actions/sobreaviso'

/**
 * Props mínimas do alvo. De propósito não é o item inteiro do painel: o ScaleGrid usa o mesmo
 * modal e não tem aquela forma. O que o acionamento precisa é isto — o resto é texto de tela.
 */
export type AlvoAcionamento = {
  escalaMensalId: string
  dia: number
  servidorNome: string
  /** Ex.: "SMS — TI · N12 (12h) · 19:00 → 07:00". Só exibição. */
  contexto?: string
  /** Unidade da escala, usada como último recurso quando o acionador não tem lotação. */
  unidadeOrigemId?: string
}

/**
 * Modal de acionamento — Fase 6 do plano
 * docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
 *
 * Existe para que o acionamento não dependa mais de navegar até a grade da escala: o painel é
 * global e quem aciona pode não ter acesso àquela escala.
 *
 * O destino vem pré-selecionado com a lotação de quem aciona, mas é livre — quem está de
 * sobreaviso atende a rede inteira e o chamado quase nunca é para a unidade de origem.
 */
export function AcionarSobreavisoModal({
  alvo,
  destinos: destinosProp,
  lotacao: lotacaoProp,
  onClose,
  onSucesso
}: {
  alvo: AlvoAcionamento
  /** O dashboard já carrega os dois no servidor. Quem não carrega (ScaleGrid) omite e o
   *  modal busca sozinho — as duas actions são chamáveis do cliente. */
  destinos?: DestinoUnidade[]
  lotacao?: { unidadeId: string | null; setorId: string | null }
  onClose: () => void
  onSucesso: () => void
}) {
  const [destinos, setDestinos] = useState<DestinoUnidade[]>(destinosProp || [])
  const [lotacao, setLotacao] = useState<{ unidadeId: string | null; setorId: string | null }>(
    lotacaoProp || { unidadeId: null, setorId: null }
  )

  const [motivo, setMotivo] = useState('')
  const [unidadeId, setUnidadeId] = useState(
    lotacaoProp?.unidadeId || alvo.unidadeOrigemId || ''
  )
  const [setorId, setSetorId] = useState<string>('')
  const [referencia, setReferencia] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const [link, setLink] = useState('')
  const [logId, setLogId] = useState('')
  const [waSending, setWaSending] = useState(false)
  const [waError, setWaError] = useState('')
  const [waFallback, setWaFallback] = useState('')
  const [waOk, setWaOk] = useState(false)

  useEffect(() => {
    if (destinosProp && lotacaoProp) return
    let vivo = true
    Promise.all([getDestinosSobreaviso(), getLotacaoDoAcionador()]).then(([d, l]) => {
      if (!vivo) return
      setDestinos(d)
      setLotacao(l)
      setUnidadeId(prev => prev || l.unidadeId || alvo.unidadeOrigemId || '')
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setoresDaUnidade = useMemo(
    () => destinos.find(d => d.id === unidadeId)?.setores || [],
    [destinos, unidadeId]
  )

  // Só pré-seleciona o setor quando a unidade escolhida é mesmo a de lotação. Trocar de unidade
  // tem de limpar o setor: manter o setor antigo formaria um par (setor, unidade) inválido, que
  // a FK composta do banco recusaria — melhor não chegar lá.
  useEffect(() => {
    if (unidadeId === lotacao.unidadeId && lotacao.setorId
        && setoresDaUnidade.some(s => s.id === lotacao.setorId)) {
      setSetorId(lotacao.setorId)
    } else {
      setSetorId('')
    }
  }, [unidadeId, lotacao.unidadeId, lotacao.setorId, setoresDaUnidade])

  const confirmar = async () => {
    setLoading(true)
    setErro('')
    const res = await acionarSobreavisoAction({
      escalaMensalId: alvo.escalaMensalId,
      dia: alvo.dia,
      motivo,
      destinoUnidadeId: unidadeId,
      destinoSetorId: setorId || null,
      destinoReferencia: referencia || null
    })
    setLoading(false)

    if (!res.success) {
      setErro(res.error || 'Falha ao acionar sobreaviso.')
      return
    }
    setLink(res.link || `${window.location.origin}/sobreaviso/${res.token}`)
    setLogId(res.logId || '')
    onSucesso()
  }

  const enviarWhatsApp = async () => {
    setWaSending(true)
    setWaError('')
    const res = await enviarAcionamentoWhatsAppAction({ logId, origin: window.location.origin })
    setWaSending(false)
    if (res.success) {
      setWaOk(true)
      if (res.fallbackUrl) setWaFallback(res.fallbackUrl)
    } else {
      setWaError(res.error || 'Falha no envio automático.')
      if (res.fallbackUrl) setWaFallback(res.fallbackUrl)
    }
  }

  const nomeUnidadeDestino = destinos.find(d => d.id === unidadeId)?.nome || ''

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg border border-zinc-200 dark:border-zinc-800 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3 text-orange-600">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-xl">
              <Zap className="h-5 w-5 fill-current" />
            </div>
            <div>
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">Acionar Sobreaviso</h2>
              <p className="text-xs text-zinc-500">{alvo.servidorNome}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!link ? (
            <>
              {alvo.contexto && (
                <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-3 text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{alvo.contexto}</span>
                </div>
              )}

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 block mb-1.5">
                  Motivo do acionamento
                </label>
                <textarea
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  autoFocus
                  className="w-full h-20 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                  placeholder="Ex.: sem internet na recepção"
                />
              </div>

              {/* Destino — o ponto central desta mudança. O geofence da chegada confere ESTE
                  local, não a unidade da escala. */}
              <div className="rounded-xl border-2 border-orange-200 dark:border-orange-900/50 bg-orange-50/50 dark:bg-orange-950/20 p-3 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> Para onde a pessoa deve ir
                </p>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1">
                    Unidade de destino
                  </label>
                  <select
                    value={unidadeId}
                    onChange={e => setUnidadeId(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {destinos.map(d => (
                      <option key={d.id} value={d.id}>{d.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1">
                    Setor <span className="font-normal normal-case">(opcional)</span>
                  </label>
                  <select
                    value={setorId}
                    onChange={e => setSetorId(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">Toda a unidade</option>
                    {setoresDaUnidade.map(s => (
                      <option key={s.id} value={s.id}>{s.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1">
                    Ponto de referência <span className="font-normal normal-case">(opcional)</span>
                  </label>
                  <input
                    value={referencia}
                    onChange={e => setReferencia(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Ex.: CPD do 2º andar"
                  />
                </div>
              </div>

              {erro && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl text-xs text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{erro}</span>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmar}
                  disabled={loading || !motivo.trim() || !unidadeId}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-orange-600 text-white font-bold text-sm hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Acionar
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4 rounded-xl text-center">
                <Check className="h-6 w-6 text-emerald-600 mx-auto mb-1" />
                <p className="text-emerald-700 dark:text-emerald-400 text-sm font-bold">Acionamento registrado</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                  Destino: {nomeUnidadeDestino}
                  {setorId ? ` — ${setoresDaUnidade.find(s => s.id === setorId)?.nome}` : ''}
                  {referencia ? ` (${referencia})` : ''}
                </p>
              </div>

              <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-xl break-all text-[10px] font-mono text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                {link}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(link)}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold text-sm hover:opacity-90 transition-opacity"
                >
                  Copiar link
                </button>

                <button
                  onClick={enviarWhatsApp}
                  disabled={waSending || waOk}
                  className="w-full px-4 py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {waSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {waOk ? 'Notificação enviada' : waSending ? 'Disparando…' : 'Enviar via WhatsApp (automático)'}
                </button>

                {waFallback && (
                  <a
                    href={waFallback}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full py-2.5 px-4 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-center font-bold rounded-xl text-xs uppercase tracking-wider transition-all"
                  >
                    💬 Abrir no WhatsApp Web / App (manual)
                  </a>
                )}

                {waError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl text-xs">
                    <p className="text-red-700 dark:text-red-400 font-bold">{waError}</p>
                    <p className="text-zinc-500 text-[10px] mt-0.5">
                      Use o botão manual acima para enviar pelo WhatsApp Web.
                    </p>
                  </div>
                )}

                <button
                  onClick={onClose}
                  className="w-full px-4 py-2 rounded-lg text-zinc-600 dark:text-zinc-400 text-xs hover:underline"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** "19:00 → 07:00 (09/08)" — o período inteiro, não só o início. */
export function formatarJanela(inicioLocal: string, fimLocal: string) {
  const hhmm = (s: string) => s.slice(11, 16)
  const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
  const mesmoDia = inicioLocal.slice(0, 10) === fimLocal.slice(0, 10)
  return mesmoDia
    ? `${hhmm(inicioLocal)} → ${hhmm(fimLocal)}`
    : `${hhmm(inicioLocal)} → ${hhmm(fimLocal)} (${ddmm(fimLocal)})`
}
