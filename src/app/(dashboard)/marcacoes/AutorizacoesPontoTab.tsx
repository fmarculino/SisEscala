'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileCheck2, Loader2, Plus, Search, ShieldOff, X } from 'lucide-react'
import { formatarData } from '@/utils/horario'
import {
  listarAutorizacoesPontoColetivo,
  listarServidoresParaAutorizacao,
  concederAutorizacaoPontoColetivo,
  revogarAutorizacaoPontoColetivo,
} from './actions'

/**
 * Autorizações do RH Geral para validação coletiva de ponto.
 *
 * Caso que originou (Ofício 249/2026/SMS-PRO-ESP): os técnicos do Programa Porta a Porta saem de
 * casa direto para o atendimento e não passam na sede para registrar a entrada. O RH autoriza o
 * coordenador a DECLARAR os passos listados aqui, em massa; a batida de saída continua exigida e
 * o sistema nunca a preenche.
 *
 * ⚠️ Conceder e revogar são exclusivos do RH Geral — o coordenador é quem vai usar a autorização,
 * então não pode ser quem a concede. A tela esconde os botões e a RPC recusa de todo modo.
 */

const PASSOS_DISPONIVEIS = [
  { id: 'entrada', label: 'Entrada' },
  { id: 'intervalo_saida', label: 'Saída para intervalo' },
  { id: 'intervalo_retorno', label: 'Retorno do intervalo' },
]

const ROTULO_PASSO: Record<string, string> = {
  entrada: 'Entrada',
  intervalo_saida: 'Saída p/ intervalo',
  intervalo_retorno: 'Retorno do intervalo',
}

export function AutorizacoesPontoTab({ podeAutorizar }: { podeAutorizar: boolean }) {
  const [carregando, setCarregando] = useState(true)
  const [autorizacoes, setAutorizacoes] = useState<any[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)

  // Formulário
  const [busca, setBusca] = useState('')
  const [servidores, setServidores] = useState<any[]>([])
  const [selecionados, setSelecionados] = useState<string[]>([])
  const [passos, setPassos] = useState<string[]>(['entrada'])
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [documento, setDocumento] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  async function recarregar() {
    setCarregando(true)
    const res = await listarAutorizacoesPontoColetivo()
    setErro(res.error)
    setAutorizacoes(res.dados)
    setCarregando(false)
  }

  useEffect(() => { recarregar() }, [])

  useEffect(() => {
    if (!mostrarForm) return
    listarServidoresParaAutorizacao(null, null).then((res) => {
      if (!res.error) setServidores(res.dados)
    })
  }, [mostrarForm])

  // Busca local — o catálogo já veio inteiro, então filtrar aqui responde a cada tecla sem ida
  // ao servidor. Acentos ignorados dos dois lados.
  const encontrados = useMemo(() => {
    const normalizar = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const termo = normalizar(busca)
    if (!termo) return servidores.slice(0, 40)
    return servidores.filter((s) =>
      normalizar(s.nome).includes(termo) ||
      normalizar(s.matricula || '').includes(termo) ||
      normalizar(s.setor_nome || '').includes(termo)
    ).slice(0, 40)
  }, [busca, servidores])

  function alternarServidor(id: string) {
    setSelecionados((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function alternarPasso(id: string) {
    setPassos((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  async function conceder() {
    setResultado(null)

    if (selecionados.length === 0) { setResultado('Selecione ao menos um servidor.'); return }
    if (passos.length === 0) { setResultado('Selecione ao menos um passo.'); return }
    if (!inicio || !fim) { setResultado('Informe o período de vigência.'); return }
    if (!documento.trim()) { setResultado('Informe o número do ofício ou processo.'); return }
    if (!motivo.trim()) { setResultado('Informe o motivo da autorização.'); return }

    setSalvando(true)
    const res = await concederAutorizacaoPontoColetivo({
      servidorIds: selecionados,
      passos,
      vigenciaInicio: inicio,
      vigenciaFim: fim,
      documento: documento.trim(),
      motivo: motivo.trim(),
    })
    setSalvando(false)

    if (res.error) { setResultado(res.error); return }

    // Relata o que MUDOU, não o que foi pedido: um servidor com autorização sobreposta é pulado
    // pelo banco e precisa aparecer nominalmente (armadilha 22 do CLAUDE.md).
    const r: any = res.resultado
    const erros = Array.isArray(r?.erros) ? r.erros : []
    setResultado(
      `${r?.criadas ?? 0} autorização(ões) concedida(s)` +
      (erros.length > 0
        ? `. ${erros.length} ficaram de fora: ` + erros.map((e: any) => `${e.servidor_nome} (${e.erro})`).join('; ')
        : '.')
    )

    if ((r?.criadas ?? 0) > 0) {
      setSelecionados([])
      recarregar()
    }
  }

  async function revogar(a: any) {
    const motivoRevogacao = prompt(`Motivo da revogação da autorização de ${a.servidor_nome}:`)
    if (!motivoRevogacao || !motivoRevogacao.trim()) return

    const res = await revogarAutorizacaoPontoColetivo(a.id, motivoRevogacao.trim())
    if (res.error) { alert(res.error); return }
    recarregar()
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const vigentes = autorizacoes.filter((a) => !a.revogado_em && a.vigencia_fim >= hoje)
  const demais = autorizacoes.filter((a) => a.revogado_em || a.vigencia_fim < hoje)

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 p-4 text-xs text-blue-900 dark:text-blue-200 space-y-1">
        <p className="font-bold uppercase tracking-wider">Como isto funciona</p>
        <p>
          O RH Geral autoriza, por servidor e por período, quais passos o coordenador pode
          <strong> declarar em massa</strong> na grade de escala — sem precisar justificar dia a dia.
        </p>
        <p>
          A <strong>batida de saída nunca é dispensada</strong>: ela continua vindo do relógio. O que
          é declarado sai na folha como <strong>manual</strong>, com a justificativa e o número do
          ofício, nunca como batida.
        </p>
      </div>

      {podeAutorizar && (
        <div>
          <button
            onClick={() => { setMostrarForm((v) => !v); setResultado(null) }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-bold transition-colors"
          >
            {mostrarForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {mostrarForm ? 'Cancelar' : 'Nova autorização'}
          </button>
        </div>
      )}

      {podeAutorizar && mostrarForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
              Servidores autorizados ({selecionados.length} selecionado(s))
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, matrícula ou setor..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
              {encontrados.length === 0 ? (
                <p className="p-3 text-xs text-zinc-500 italic">Nenhum servidor ativo encontrado.</p>
              ) : encontrados.map((s) => (
                <label key={s.id} className="flex items-center gap-3 p-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selecionados.includes(s.id)}
                    onChange={() => alternarServidor(s.id)}
                    className="h-4 w-4 rounded border-zinc-300 text-blue-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-zinc-800 dark:text-zinc-100 truncate">{s.nome}</span>
                    <span className="block text-[11px] text-zinc-500 truncate">
                      Matrícula {s.matricula || '—'} · {s.unidade_nome || 'Sem unidade'} → {s.setor_nome || 'Sem setor'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
              Passos que o coordenador poderá declarar
            </label>
            <div className="flex flex-wrap gap-2">
              {PASSOS_DISPONIVEIS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => alternarPasso(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    passos.includes(p.id)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-400 italic">
              A saída não aparece aqui de propósito — ela nunca pode ser dispensada.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Vigência — início</label>
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Vigência — fim</label>
              <input type="date" value={fim} onChange={(e) => setFim(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-[11px] text-zinc-400 italic">Máximo de 12 meses — renovável por novo ato.</p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Ofício / Processo</label>
            <input value={documento} onChange={(e) => setDocumento(e.target.value)}
              placeholder="Ex.: Ofício 249/2026/SMS-PRO-ESP"
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Motivo</label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
              placeholder="Ex.: Programa Porta a Porta — início da jornada em campo, sem passagem pela sede."
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-[11px] text-zinc-400 italic">Este texto acompanha cada dia declarado na folha.</p>
          </div>

          {resultado && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-xs text-zinc-700 dark:text-zinc-300">
              {resultado}
            </div>
          )}

          <button
            onClick={conceder}
            disabled={salvando}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 text-sm font-bold transition-colors disabled:opacity-50"
          >
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
            Conceder autorização
          </button>
        </div>
      )}

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
      ) : erro ? (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">{erro}</div>
      ) : (
        <div className="space-y-6">
          <Secao titulo={`Vigentes (${vigentes.length})`} itens={vigentes} onRevogar={podeAutorizar ? revogar : undefined} />
          {demais.length > 0 && (
            <Secao titulo={`Revogadas e encerradas (${demais.length})`} itens={demais} historico />
          )}
        </div>
      )}
    </div>
  )
}

function Secao({ titulo, itens, onRevogar, historico }: {
  titulo: string
  itens: any[]
  onRevogar?: (a: any) => void
  historico?: boolean
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{titulo}</h3>
      {itens.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">Nenhuma autorização.</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          {itens.map((a) => (
            <div key={a.id} className={`p-4 flex items-start justify-between gap-4 ${historico ? 'opacity-60' : ''}`}>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                  {a.servidor_nome}
                  {a.servidor_matricula && <span className="ml-2 text-[11px] font-normal text-zinc-500">mat. {a.servidor_matricula}</span>}
                </p>
                <p className="text-[11px] text-zinc-500 truncate">
                  {a.unidade_nome || 'Sem unidade'} → {a.setor_nome || 'Sem setor'}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {(a.passos || []).map((p: string) => (
                    <span key={p} className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                      {ROTULO_PASSO[p] || p}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 pt-0.5">
                  {formatarData(a.vigencia_inicio)} a {formatarData(a.vigencia_fim)} · <strong>{a.documento}</strong>
                </p>
                <p className="text-[11px] text-zinc-500 italic">{a.motivo}</p>
                {a.revogado_em && (
                  <p className="text-[11px] text-red-600 dark:text-red-400">
                    Revogada em {formatarData(a.revogado_em)} — {a.revogacao_motivo}
                  </p>
                )}
              </div>

              {onRevogar && !a.revogado_em && (
                <button
                  onClick={() => onRevogar(a)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 text-[11px] font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  Revogar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
