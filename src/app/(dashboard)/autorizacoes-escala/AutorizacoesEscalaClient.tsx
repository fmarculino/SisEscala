'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  Loader2, Check, X, AlertTriangle, Clock, ShieldCheck, ShieldX, Ban, RefreshCw
} from 'lucide-react'
import { formatarHoras } from '@/utils/limiteCargaMensal'
import { rotuloStatusSolicitacao } from '@/utils/autorizacaoCarga'
import { formatarData, formatarDataHora } from '@/utils/horario'

/**
 * Lista e decisão dos pedidos de Autorização Extraordinária de carga mensal (31/08/2026).
 *
 * ⚠️ Toda linha vem de `fn_solicitacoes_excecao_carga`, que já aplicou o escopo e resolveu
 * `pode_avaliar` no banco. **Esta tela não reclassifica nada** — se ela decidisse por conta
 * própria quem avalia o quê, seria a segunda cópia da regra, e a divergência apareceria no
 * primeiro papel novo (foi assim que RH ficou três meses sem poder autorizar).
 *
 * ⚠️ Aprovar GRAVA a exceção na mesma transação (`fn_avaliar_solicitacao_excecao_carga`). A tela
 * nunca escreve em `excecoes_escala_servidor` daqui: duas etapas produziriam pedido "aprovado"
 * sem teto ampliado, com a escala continuando barrada.
 */

interface Props {
  podeAutorizar: boolean
  mesInicial: number
  anoInicial: number
}

const STATUS_FILTROS = [
  { valor: 'pendente', rotulo: 'Pendentes' },
  { valor: 'aprovada', rotulo: 'Aprovadas' },
  { valor: 'rejeitada', rotulo: 'Rejeitadas' },
  { valor: '', rotulo: 'Todos' },
]

export function AutorizacoesEscalaClient({ podeAutorizar, mesInicial, anoInicial }: Props) {
  const supabase = createClient()
  const [linhas, setLinhas] = useState<any[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [status, setStatus] = useState('pendente')
  const [mes, setMes] = useState(mesInicial)
  const [ano, setAno] = useState(anoInicial)

  /** Decisão em andamento: id do pedido + os valores que o avaliador vai conceder. */
  const [decisao, setDecisao] = useState<{
    id: string
    aprovar: boolean
    horas: number
    sobreavisos: number
    parecer: string
    linha: any
  } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    const { data, error } = await supabase.rpc('fn_solicitacoes_excecao_carga', {
      p_status: status || null,
      p_mes: mes || null,
      p_ano: ano || null,
    })
    if (error) setErro(error.message)
    setLinhas(data || [])
    setCarregando(false)
  }, [supabase, status, mes, ano])

  useEffect(() => { carregar() }, [carregar])

  const abrirDecisao = (linha: any, aprovar: boolean) => {
    setDecisao({
      id: linha.id,
      aprovar,
      // Pré-preenche com o pedido. Conceder MENOS é legítimo e comum — o campo fica editável.
      horas: Number(linha.horas_solicitadas) || 0,
      sobreavisos: Number(linha.sobreavisos_solicitados) || 0,
      parecer: '',
      linha,
    })
  }

  const confirmarDecisao = async () => {
    if (!decisao) return
    setSalvando(true)
    setErro('')
    try {
      const { data, error } = await supabase.rpc('fn_avaliar_solicitacao_excecao_carga', {
        p_solicitacao_id: decisao.id,
        p_aprovar: decisao.aprovar,
        p_parecer: decisao.parecer.trim() || null,
        p_horas: decisao.aprovar ? decisao.horas : null,
        p_sobreavisos: decisao.aprovar ? decisao.sobreavisos : null,
      })
      if (error) throw error
      // `substituiu_anterior` vem da RPC: quando a aprovação passou por cima de uma autorização
      // que já existia (possivelmente concedida a partir de OUTRA unidade), quem decidiu precisa
      // ver o que mudou, e não só "salvo com sucesso".
      if (data?.substituiu_anterior) {
        setErro(
          `Aprovado. ⚠️ Este mês já tinha autorização de +${data.horas_anteriores}h / ` +
          `+${data.sobreavisos_anteriores} un, e ela foi substituída pelos valores concedidos agora.`
        )
      }
      setDecisao(null)
      await carregar()
    } catch (err: any) {
      setErro(err.message || 'Não foi possível registrar a decisão.')
    } finally {
      setSalvando(false)
    }
  }

  const cancelar = async (id: string) => {
    setSalvando(true)
    setErro('')
    try {
      const { error } = await supabase.rpc('fn_cancelar_solicitacao_excecao_carga', { p_solicitacao_id: id })
      if (error) throw error
      await carregar()
    } catch (err: any) {
      setErro(err.message || 'Não foi possível cancelar o pedido.')
    } finally {
      setSalvando(false)
    }
  }

  const corDoStatus = (s: string) =>
    s === 'pendente' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800'
    : s === 'aprovada' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
    : s === 'rejeitada' ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800'
    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
          {STATUS_FILTROS.map(f => (
            <button
              key={f.valor || 'todos'}
              onClick={() => setStatus(f.valor)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                status === f.valor
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block">Competência</label>
          <div className="flex gap-2">
            <select
              value={mes}
              onChange={e => setMes(Number(e.target.value))}
              className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString('pt-BR', { month: 'long' })}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={ano}
              onChange={e => setAno(Number(e.target.value))}
              className="w-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          onClick={carregar}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </button>
      </div>

      {erro && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900/50 rounded-xl flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-line">{erro}</span>
        </div>
      )}

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500 p-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedidos...
        </div>
      ) : linhas.length === 0 ? (
        <div className="p-10 text-center text-sm text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl">
          Nenhum pedido nesta competência.
        </div>
      ) : (
        <div className="space-y-3">
          {linhas.map(l => (
            <div
              key={l.id}
              className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-zinc-900 dark:text-white uppercase">
                      {l.servidor_nome}
                    </span>
                    {l.servidor_matricula && (
                      <span className="text-xs text-zinc-400">mat. {l.servidor_matricula}</span>
                    )}
                    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wider ${corDoStatus(l.status)}`}>
                      {rotuloStatusSolicitacao(l.status)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {l.unidade_nome}{l.setor_caminho ? ` / ${l.setor_caminho}` : ''}
                    {' · '}{String(l.mes).padStart(2, '0')}/{l.ano}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Pedido por {l.solicitado_por_nome} em {formatarDataHora(l.solicitado_em)}
                  </p>
                </div>

                <div className="text-right space-y-0.5">
                  <p className="text-sm font-black text-zinc-900 dark:text-white">
                    +{formatarHoras(Number(l.horas_solicitadas) || 0)}h
                    {Number(l.sobreavisos_solicitados) > 0 && ` · +${l.sobreavisos_solicitados} un`}
                  </p>
                  {/* Fotografia do momento do pedido: sem ela, quem avalia dias depois não sabe
                      contra o que a pessoa estava pedindo — a grade já mudou. */}
                  {l.horas_no_pedido != null && (
                    <p className="text-[11px] text-zinc-400">
                      Mês somava {formatarHoras(Number(l.horas_no_pedido))}h
                      {l.teto_no_pedido != null && ` (teto ${formatarHoras(Number(l.teto_no_pedido))}h)`}
                    </p>
                  )}
                </div>
              </div>

              <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-700/60 rounded-xl p-3 whitespace-pre-line">
                {l.justificativa}
              </p>

              {l.status !== 'pendente' && (
                <p className="text-[11px] text-zinc-500">
                  {rotuloStatusSolicitacao(l.status)}
                  {l.avaliado_por_nome ? ` por ${l.avaliado_por_nome}` : ''}
                  {l.avaliado_em ? ` em ${formatarData(l.avaliado_em)}` : ''}
                  {l.status === 'aprovada' && l.horas_concedidas != null && (
                    <> — concedido +{formatarHoras(Number(l.horas_concedidas))}h
                      {Number(l.sobreavisos_concedidos) > 0 && ` · +${l.sobreavisos_concedidos} un`}</>
                  )}
                  {l.parecer ? ` · ${l.parecer}` : ''}
                </p>
              )}

              {l.status === 'pendente' && (
                <div className="flex flex-wrap gap-2 justify-end">
                  {l.pode_cancelar && !l.pode_avaliar && (
                    <button
                      onClick={() => cancelar(l.id)}
                      disabled={salvando}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-700 disabled:opacity-50"
                    >
                      <Ban className="h-3.5 w-3.5" /> Cancelar pedido
                    </button>
                  )}
                  {l.pode_avaliar ? (
                    <>
                      <button
                        onClick={() => abrirDecisao(l, false)}
                        disabled={salvando}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 hover:bg-red-100 disabled:opacity-50"
                      >
                        <ShieldX className="h-3.5 w-3.5" /> Recusar
                      </button>
                      <button
                        onClick={() => abrirDecisao(l, true)}
                        disabled={salvando}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-50"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Autorizar
                      </button>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-semibold">
                      <Clock className="h-3.5 w-3.5" /> Aguardando decisão do RH
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Decisão */}
      {decisao && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-base font-black uppercase tracking-tight text-zinc-900 dark:text-white">
                {decisao.aprovar ? 'Autorizar excepcionalmente' : 'Recusar pedido'}
              </h3>
              <button onClick={() => setDecisao(null)} className="p-2 text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                <strong className="uppercase">{decisao.linha.servidor_nome}</strong>
                {' · '}{String(decisao.linha.mes).padStart(2, '0')}/{decisao.linha.ano}
              </p>

              {decisao.aprovar && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider block">
                        Horas concedidas
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={decisao.horas}
                        onChange={e => setDecisao({ ...decisao, horas: Math.max(0, parseInt(e.target.value) || 0) })}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider block">
                        Sobreavisos concedidos
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={decisao.sobreavisos}
                        onChange={e => setDecisao({ ...decisao, sobreavisos: Math.max(0, parseInt(e.target.value) || 0) })}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm font-bold"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Conceder menos que o pedido é permitido. A autorização vale para o mês inteiro
                    do servidor, somando todas as escalas dele.
                  </p>
                </>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-wider block">
                  {decisao.aprovar ? 'Parecer (opcional)' : 'Motivo da recusa *'}
                </label>
                <textarea
                  rows={3}
                  value={decisao.parecer}
                  onChange={e => setDecisao({ ...decisao, parecer: e.target.value })}
                  placeholder={decisao.aprovar
                    ? 'Fundamentação da autorização (fica gravada como motivo da exceção).'
                    : 'Por que o pedido não pode ser atendido? Quem pediu precisa saber o que fazer em seguida.'}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs"
                />
              </div>
            </div>

            <div className="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900 flex justify-end gap-3">
              <button
                onClick={() => setDecisao(null)}
                disabled={salvando}
                className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                Voltar
              </button>
              <button
                onClick={confirmarDecisao}
                disabled={salvando}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white shadow-md active:scale-95 disabled:opacity-50 ${
                  decisao.aprovar ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {decisao.aprovar ? 'Confirmar autorização' : 'Confirmar recusa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
