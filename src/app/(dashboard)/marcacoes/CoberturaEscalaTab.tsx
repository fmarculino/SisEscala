'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Fingerprint, UserX, CloudOff, Download, CalendarClock, ArrowLeftRight, Building2,
} from 'lucide-react'
import {
  listarCoberturaEscala, listarCoberturaEscalaResumo,
  type CoberturaEscalaLinha, type CoberturaEscalaResumo, type SituacaoCoberturaEscala,
} from './actions'

/**
 * Cobertura da Escala: quem está escalado no mês e **não consegue registrar ponto onde foi
 * escalado**, ordenado pelo primeiro dia — a urgência.
 *
 * A pergunta que originou (06/09/2026): servidor lotado no HMM que faz plantão no CCE ou no HMI
 * precisa estar cadastrado com digital no relógio de lá. A identidade já chega sozinha (cron +
 * `fn_enfileirar_cadastros_por_escala`); a **digital não tem como chegar** — a cópia entre
 * relógios só acontece dentro da mesma unidade e da mesma máquina. Faltava o aviso.
 *
 * ⚠️ Medido em produção: só **2 dos 84** casos eram Servidor Externo. Por isso a tela mostra
 * **toda a escala** e apenas sinaliza o externo — filtrar por externo esconderia 82 dos 84.
 *
 * Toda a classificação vem de `fn_cobertura_escala_parque`; a tela não reclassifica nada, senão
 * o total do cabeçalho deixaria de bater com a lista logo abaixo dele.
 */

const SITUACOES: Record<SituacaoCoberturaEscala, {
  rotulo: string
  descricao: string
  acao: string
  cor: 'red' | 'amber' | 'zinc'
  icone: any
}> = {
  sem_biometria: {
    rotulo: 'Sem biometria',
    descricao: 'A identidade chegou ao relógio, mas não há digital cadastrada. A pessoa encosta o dedo e o equipamento não a reconhece.',
    acao: 'Biometria não pode ser enviada por API nem copiada de outra unidade: alguém precisa ir ao equipamento com o servidor, uma vez.',
    cor: 'red',
    icone: Fingerprint,
  },
  fora_do_relogio: {
    rotulo: 'Fora do relógio',
    descricao: 'Não está cadastrado no equipamento da unidade onde foi escalado.',
    acao: 'A rotina diária enfileira sozinha. Para não esperar, use "Sincronizar cadastros" no relógio, na aba Dispositivos REP. Depois ainda falta a digital.',
    cor: 'amber',
    icone: UserX,
  },
  sem_relogio_no_setor: {
    rotulo: 'Setor sem relógio',
    descricao: 'O setor da escala não é atendido por nenhum equipamento ativo — não há onde bater.',
    acao: 'Vincule o setor a um relógio na aba Dispositivos REP, ou confirme que essas pessoas registram ponto por outro meio.',
    cor: 'amber',
    icone: CloudOff,
  },
  parcial: {
    rotulo: 'Só em um relógio',
    descricao: 'Tem digital em parte dos relógios que atendem o setor, não em todos — só consegue bater numa das entradas.',
    acao: 'Quando os relógios estão na mesma máquina, a cópia automática fecha isso sozinha no próximo ciclo.',
    cor: 'zinc',
    icone: ArrowLeftRight,
  },
}

const CORES: Record<'red' | 'amber' | 'zinc', string> = {
  red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  zinc: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
}

export function CoberturaEscalaTab() {
  const hoje = new Date()
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [linhas, setLinhas] = useState<CoberturaEscalaLinha[]>([])
  const [resumo, setResumo] = useState<CoberturaEscalaResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
  const [soExternos, setSoExternos] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    const [l, r] = await Promise.all([
      listarCoberturaEscala(mes, ano),
      listarCoberturaEscalaResumo(mes, ano),
    ])
    // Um erro basta para a tela não mentir: número parcial é pior que número nenhum.
    setErro(l.error || r.error)
    setLinhas(l.dados)
    setResumo(r.dados)
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [mes, ano])

  const visiveis = useMemo(
    () => (soExternos ? linhas.filter((l) => l.externo) : linhas),
    [linhas, soExternos],
  )
  const porUnidade = useMemo(() => {
    const m: Record<string, CoberturaEscalaLinha[]> = {}
    for (const l of visiveis) (m[l.unidade_nome] ||= []).push(l)
    return m
  }, [visiveis])

  const totalPessoas = new Set(visiveis.map((l) => l.servidor_id)).size
  const totalExternos = new Set(visiveis.filter((l) => l.externo).map((l) => l.servidor_id)).size
  const totalBateEmOutra = new Set(visiveis.filter((l) => l.bate_em).map((l) => l.servidor_id)).size

  function exportarCsv() {
    const cab = ['primeiro_dia', 'matricula', 'nome', 'unidade_da_escala', 'setor', 'situacao',
      'externo', 'lotacao', 'dias_escalados', 'relogios_do_setor', 'bate_hoje_em']
    const linhasCsv = visiveis.map((l) => [
      `${String(l.primeiro_dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`,
      l.matricula, l.servidor_nome, l.unidade_nome, l.setor_nome || '',
      SITUACOES[l.situacao]?.rotulo || l.situacao,
      l.externo ? 'sim' : 'nao', l.lotacao_nome || '', String(l.dias_escalados),
      l.relogios_alvo || '', l.bate_em || '',
    ])
    const csv = [cab, ...linhasCsv]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    // BOM: o Excel em pt-BR abre CSV sem ele com os acentos quebrados.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cobertura-escala-${ano}-${String(mes).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Competência</label>
          <div className="flex gap-2">
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
            <select value={ano} onChange={(e) => setAno(Number(e.target.value))}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm">
              {[hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 pb-1.5">
          <input type="checkbox" checked={soExternos} onChange={(e) => setSoExternos(e.target.checked)}
            className="rounded border-zinc-300 dark:border-zinc-700" />
          Só Servidor Externo
        </label>
        <div className="flex-1" />
        <button onClick={exportarCsv} disabled={!visiveis.length}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-50">
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
        <button onClick={carregar} disabled={carregando}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-50">
          {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </button>
      </div>

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Quem está escalado nesta competência e <strong>não consegue registrar ponto onde foi
        escalado</strong>, do dia mais próximo para o mais distante. Quem já consegue bater não
        aparece aqui.
      </p>

      {erro && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500 py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : !visiveis.length && !erro ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5" />
          {soExternos
            ? 'Nenhum Servidor Externo com pendência nesta competência.'
            : 'Todo mundo escalado nesta competência consegue registrar ponto onde foi escalado.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Cartao icone={AlertTriangle} cor="red" valor={totalPessoas}
              rotulo="pessoas não conseguem bater onde estão escaladas" />
            <Cartao icone={ArrowLeftRight} cor="amber" valor={totalExternos}
              rotulo="são Servidor Externo (lotadas em outra unidade)" />
            <Cartao icone={Fingerprint} cor="zinc" valor={totalBateEmOutra}
              rotulo="já batem em outra unidade — falta a digital aqui" />
          </div>

          {/* O resumo vem da RPC, não de recontagem local: o número do cartão e o da lista têm
              que ser o mesmo número. */}
          {!soExternos && resumo.length > 1 && (
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Unidade</th>
                    <th className="text-right px-3 py-2 font-medium">Pessoas</th>
                    <th className="text-right px-3 py-2 font-medium">Externos</th>
                    <th className="text-right px-3 py-2 font-medium">Sem biometria</th>
                    <th className="text-right px-3 py-2 font-medium">Fora do relógio</th>
                    <th className="text-right px-3 py-2 font-medium">Setor sem relógio</th>
                    <th className="text-right px-3 py-2 font-medium">Batem em outra</th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.map((r) => (
                    <tr key={r.escala_unidade_id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-3 py-2">{r.unidade_nome}</td>
                      <td className="px-3 py-2 text-right font-medium">{r.pessoas}</td>
                      <td className="px-3 py-2 text-right">{r.externos || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.sem_biometria || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.fora_do_relogio || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.sem_relogio_no_setor || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.bate_em_outra || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2">
            {Object.entries(porUnidade)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([unidade, itens]) => {
                const expandido = aberto[unidade] !== false
                return (
                  <div key={unidade} className="rounded-md border border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => setAberto((s) => ({ ...s, [unidade]: !expandido }))}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Building2 className="h-4 w-4 text-zinc-400" />
                      <span className="font-medium">{unidade}</span>
                      <span className="text-sm text-zinc-500">
                        {itens.length} {itens.length === 1 ? 'pendência' : 'pendências'}
                      </span>
                    </button>
                    {expandido && (
                      <div className="border-t border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
                        {itens.map((l) => {
                          const s = SITUACOES[l.situacao]
                          const Icone = s?.icone || AlertTriangle
                          return (
                            <div key={`${l.servidor_id}-${l.setor_id}-${l.situacao}`} className="px-3 py-2.5 flex flex-wrap items-start gap-x-3 gap-y-1">
                              <span
                                title={`Primeiro dia escalado: ${String(l.primeiro_dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`}
                                className="inline-flex items-center gap-1 rounded border border-zinc-200 dark:border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-400 shrink-0"
                              >
                                <CalendarClock className="h-3 w-3" />
                                dia {String(l.primeiro_dia).padStart(2, '0')}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">{l.servidor_nome}</span>
                                  <span className="text-xs text-zinc-500">mat. {l.matricula}</span>
                                  {l.externo && (
                                    <span
                                      title={`Lotado em ${l.lotacao_nome || 'outra unidade'} — escalado aqui como Servidor Externo`}
                                      className="rounded border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-300"
                                    >
                                      externo · {l.lotacao_nome || 'outra unidade'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-zinc-500 mt-0.5">
                                  {l.setor_nome || 'sem setor'} · {l.dias_escalados}{' '}
                                  {l.dias_escalados === 1 ? 'dia escalado' : 'dias escalados'}
                                  {l.relogios_alvo && <> · relógio: {l.relogios_alvo}</>}
                                </div>
                                {/* Distingue "só falta a digital aqui" de "nunca cadastrou digital
                                    em lugar nenhum" — ações de custo bem diferente. */}
                                {l.bate_em ? (
                                  <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                                    já bate em: {l.bate_em}
                                  </div>
                                ) : (
                                  <div className="text-xs text-zinc-400 mt-0.5">
                                    não bate em nenhum relógio do município
                                  </div>
                                )}
                              </div>
                              <span
                                title={`${s?.descricao || ''}\n\n${s?.acao || ''}`}
                                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs shrink-0 ${CORES[s?.cor || 'zinc']}`}
                              >
                                <Icone className="h-3 w-3" />
                                {s?.rotulo || l.situacao}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>

          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 space-y-2 text-xs text-zinc-500 dark:text-zinc-400">
            <p className="font-medium text-zinc-600 dark:text-zinc-300">O que fazer em cada caso</p>
            {(Object.keys(SITUACOES) as SituacaoCoberturaEscala[]).map((k) => (
              <p key={k}>
                <span className="font-medium text-zinc-600 dark:text-zinc-300">{SITUACOES[k].rotulo}:</span>{' '}
                {SITUACOES[k].acao}
              </p>
            ))}
            <p className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
              A digital <strong>não pode ser copiada entre unidades</strong>: a cópia automática
              acontece entre relógios da mesma unidade atendidos pelo mesmo computador. Quem
              trabalha em mais de uma unidade cadastra a digital em cada uma, uma vez.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Cartao({ icone: Icone, cor, valor, rotulo }: {
  icone: any; cor: 'red' | 'amber' | 'zinc'; valor: number; rotulo: string
}) {
  return (
    <div className={`rounded-md border p-3 flex items-start gap-3 ${CORES[cor]}`}>
      <Icone className="h-5 w-5 mt-0.5 shrink-0" />
      <div>
        <div className="text-2xl font-semibold leading-none">{valor}</div>
        <div className="text-xs mt-1 opacity-90">{rotulo}</div>
      </div>
    </div>
  )
}
