'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { listarPendencias, buscarEscalasCandidatas, aceitarMarcacaoPendente } from './actions'
import type { EscalaCandidata, PrevistoDoBloco } from './actions'

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
  { value: 'entrada', label: 'Entrada', campo: 'entrada' },
  { value: 'intervalo_saida', label: 'Saída do intervalo', campo: 'intervalo_saida' },
  { value: 'intervalo_retorno', label: 'Retorno do intervalo', campo: 'intervalo_retorno' },
  { value: 'saida', label: 'Saída', campo: 'saida' },
] as const

const POR_PAGINA = 15

function horaEm(iso: string, timezone: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function diaEm(iso: string, timezone: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: timezone, day: '2-digit', month: '2-digit',
  })
}

/**
 * Previsto formatado. Turno que cruza a meia-noite tem fim previsto no dia seguinte ao da batida —
 * mostrar só "06:00" ali esconde justamente a informação que explica a diferença.
 */
function previstoLegivel(iso: string | null, batidaIso: string, timezone: string) {
  if (!iso) return null
  const hora = horaEm(iso, timezone)
  const dia = diaEm(iso, timezone)
  return dia === diaEm(batidaIso, timezone) ? hora : `${hora} (${dia})`
}

/** Diferença da batida real para o horário previsto daquele passo. */
function diferencaLegivel(previstoIso: string | null, batidaIso: string) {
  if (!previstoIso) return null
  const ms = new Date(batidaIso).getTime() - new Date(previstoIso).getTime()
  const minutos = Math.round(Math.abs(ms) / 60000)
  if (minutos === 0) return { texto: 'no horário', minutos, atrasado: false }
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  const duracao = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
  return { texto: `${duracao} ${ms > 0 ? 'depois' : 'antes'}`, minutos, atrasado: ms > 0 }
}

function PainelPrevisto({
  previsto,
  batidaIso,
  timezone,
  passoSelecionado,
}: {
  previsto: PrevistoDoBloco | null
  batidaIso: string
  timezone: string
  passoSelecionado: string
}) {
  if (!previsto) {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Sem previsão de horário para esta escala — decida pelo horário da batida e pela escala do dia.
      </p>
    )
  }

  // O passo mais próximo é só uma pista visual: quem decide é o coordenador. O sistema não
  // pré-seleciona nada (Portaria 671/2021, vedação 2 — marcação por horário predeterminado).
  const distancias = PASSOS.map((p) => diferencaLegivel(previsto[p.campo], batidaIso)?.minutos ?? null)
  const validas = distancias.filter((d): d is number => d !== null)
  const menor = validas.length > 0 ? Math.min(...validas) : null

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/60 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
        Horário previsto
      </div>
      <table className="w-full text-xs">
        <tbody>
          {PASSOS.map((p, i) => {
            const iso = previsto[p.campo]
            const dif = diferencaLegivel(iso, batidaIso)
            const ehIntervalo = p.value.startsWith('intervalo')
            const selecionado = p.value === passoSelecionado
            const maisProximo = dif !== null && menor !== null && dif.minutos === menor
            return (
              <tr
                key={p.value}
                className={`border-t border-zinc-100 dark:border-zinc-800 ${
                  selecionado ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                }`}
              >
                <td className={`px-3 py-1.5 ${selecionado ? 'font-bold text-blue-700 dark:text-blue-300' : 'text-zinc-600 dark:text-zinc-400'}`}>
                  {p.label}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-zinc-900 dark:text-white whitespace-nowrap">
                  {previstoLegivel(iso, batidaIso, timezone)
                    || (ehIntervalo && !previsto.permite_intervalo
                      ? <span className="font-sans text-zinc-400">não marca intervalo</span>
                      : <span className="font-sans text-zinc-400">—</span>)}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {dif && (
                    <span className={dif.atrasado ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500'}>
                      {dif.texto}
                      {maisProximo && <span className="ml-1 text-[10px] font-bold text-blue-600 dark:text-blue-400">• mais próximo</span>}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TratarPendenciaModal({
  pendencia,
  onClose,
  onTratada,
}: {
  pendencia: Pendencia
  onClose: () => void
  onTratada: () => void
}) {
  const [escalas, setEscalas] = useState<EscalaCandidata[]>([])
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [carregando, setCarregando] = useState(true)
  const [escalaId, setEscalaId] = useState('')
  const [passo, setPasso] = useState('entrada')
  const [justificativa, setJustificativa] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    buscarEscalasCandidatas(pendencia.servidor_id, pendencia.ocorrido_em)
      .then((data) => {
        if (!vivo) return
        setTimezone(data.timezone)
        setEscalas(data.escalas)
        if (data.escalas[0]) setEscalaId(data.escalas[0].id)
      })
      .catch((err) => { if (vivo) setErro(err.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [pendencia.servidor_id, pendencia.ocorrido_em])

  const escalaSelecionada = escalas.find((e) => e.id === escalaId) || null
  const previsto = escalaSelecionada?.previsto || null

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
          <p><b>Batida real:</b> {new Date(pendencia.ocorrido_em).toLocaleString('pt-BR', { timeZone: timezone })}</p>
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
                    {e.previsto?.entrada && e.previsto?.saida
                      ? ` (${horaEm(e.previsto.entrada, timezone)}–${horaEm(e.previsto.saida, timezone)})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            <PainelPrevisto
              previsto={previsto}
              batidaIso={pendencia.ocorrido_em}
              timezone={timezone}
              passoSelecionado={passo}
            />

            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Passo</label>
              <select
                value={passo}
                onChange={(e) => setPasso(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
              >
                {PASSOS.map((p) => {
                  const iso = previsto?.[p.campo]
                  return (
                    <option key={p.value} value={p.value}>
                      {p.label}{iso ? ` — previsto ${horaEm(iso, timezone)}` : ''}
                    </option>
                  )
                })}
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

interface Opcoes {
  unidades: { id: string; nome: string }[]
  setores: { id: string; unidade_id: string | null; nome: string }[]
}

export function PendenciasTab({ opcoes }: { opcoes?: Opcoes }) {
  const [pendencias, setPendencias] = useState<Pendencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionada, setSelecionada] = useState<Pendencia | null>(null)

  // Unidade/setor filtram no SERVIDOR (fn_marcacoes_pendentes_revisao) - quem tem escopo amplo
  // (RH Geral, admin) pode ter a lista grande demais pra trazer inteira e filtrar so' na tela.
  // Servidor/situacao continuam filtrando no CLIENTE, em cima do que ja foi carregado.
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [filtroSetor, setFiltroSetor] = useState('')
  const [filtroServidor, setFiltroServidor] = useState('')
  const [filtroSituacao, setFiltroSituacao] = useState<'pendentes' | 'tratadas' | 'todas'>('pendentes')
  const [pagina, setPagina] = useState(1)

  const setoresDaUnidade = (opcoes?.setores || []).filter((s) => s.unidade_id === filtroUnidade)

  async function recarregar() {
    setCarregando(true)
    try {
      setPendencias(await listarPendencias(filtroUnidade || null, filtroSetor || null))
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { recarregar() }, [filtroUnidade, filtroSetor])

  const servidores = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of pendencias) m.set(p.servidor_id, `${p.servidor_nome} (${p.matricula})`)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [pendencias])

  const filtradas = useMemo(() => pendencias.filter((p) => {
    if (filtroServidor && p.servidor_id !== filtroServidor) return false
    if (filtroSituacao === 'pendentes' && p.ja_tratada) return false
    if (filtroSituacao === 'tratadas' && !p.ja_tratada) return false
    return true
  }), [pendencias, filtroServidor, filtroSituacao])

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))
  // Filtro que encurta a lista pode deixar a página atual fora do intervalo — sem isto a tela
  // fica vazia com resultados existentes.
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const visiveis = filtradas.slice(inicio, inicio + POR_PAGINA)

  const totalPendentes = pendencias.filter((p) => !p.ja_tratada).length

  function mudarFiltro(fn: () => void) {
    fn()
    setPagina(1)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-zinc-500">
          Batidas reais do terminal fora do horário previsto. A Portaria 671/2021 veda recusar por
          horário — a batida foi registrada e espera sua decisão sobre a que passo pertence.
        </p>
        <button
          onClick={recarregar}
          className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 shrink-0"
          title="Atualizar"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {opcoes && opcoes.unidades.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filtroUnidade}
            onChange={(e) => { setFiltroUnidade(e.target.value); setFiltroSetor(''); setFiltroServidor(''); setPagina(1) }}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm"
          >
            <option value="">Todas as unidades</option>
            {opcoes.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>

          {filtroUnidade && setoresDaUnidade.length > 0 && (
            <select
              value={filtroSetor}
              onChange={(e) => { setFiltroSetor(e.target.value); setFiltroServidor(''); setPagina(1) }}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm"
            >
              <option value="">Todos os setores</option>
              {setoresDaUnidade.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          )}
        </div>
      )}

      {!carregando && pendencias.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filtroServidor}
            onChange={(e) => mudarFiltro(() => setFiltroServidor(e.target.value))}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm"
          >
            <option value="">Todos os servidores ({servidores.length})</option>
            {servidores.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>

          <select
            value={filtroSituacao}
            onChange={(e) => mudarFiltro(() => setFiltroSituacao(e.target.value as typeof filtroSituacao))}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm"
          >
            <option value="pendentes">Só pendentes ({totalPendentes})</option>
            <option value="tratadas">Só tratadas ({pendencias.length - totalPendentes})</option>
            <option value="todas">Todas ({pendencias.length})</option>
          </select>

          <span className="text-xs text-zinc-400 ml-auto">
            {filtradas.length === 0
              ? 'nenhum resultado'
              : `${inicio + 1}–${Math.min(inicio + POR_PAGINA, filtradas.length)} de ${filtradas.length}`}
          </span>
        </div>
      )}

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : pendencias.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhuma pendência no seu escopo.</p>
      ) : filtradas.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhuma pendência com os filtros atuais.</p>
      ) : (
        <>
          <div className="space-y-2">
            {visiveis.map((p) => (
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

          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setPagina(paginaAtual - 1)}
                disabled={paginaAtual === 1}
                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-zinc-500">Página {paginaAtual} de {totalPaginas}</span>
              <button
                onClick={() => setPagina(paginaAtual + 1)}
                disabled={paginaAtual === totalPaginas}
                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
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
