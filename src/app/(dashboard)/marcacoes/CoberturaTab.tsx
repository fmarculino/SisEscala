'use client'

import { useEffect, useState } from 'react'
import {
  Loader2, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Link2, Fingerprint, UserX, IdCard, CloudOff,
} from 'lucide-react'
import {
  listarCoberturaResumo, listarCoberturaDispositivo, vincularCadastrosPorCpf,
  type CoberturaResumo, type CoberturaServidor, type SituacaoCobertura,
} from './actions'

/**
 * Cobertura de ponto: quem está escalado no mês e **não consegue** ter o ponto registrado no
 * relógio da unidade, e por quê.
 *
 * A pergunta que originou a tela (13/08/2026, LACEM): "todos os servidores que estão nas escalas
 * estão efetivamente no ponto?". A resposta medida em produção foi 1 de 40 — e o caso dominante
 * (27) era gente cadastrada no equipamento, com biometria, batendo o dedo todo dia, com a batida
 * morrendo como órfã por falta de vínculo. Falha silenciosa dos dois lados: o relógio aceita e o
 * SisEscala não registra. Com dezenas de relógios previstos, isso precisa ser alerta permanente.
 *
 * Toda a classificação vem de `fn_cobertura_ponto_dispositivo` — a tela não reclassifica nada,
 * senão o número do alerta deixaria de ser o número da lista.
 */

const SITUACOES: Record<SituacaoCobertura, {
  rotulo: string
  descricao: string
  acao: string
  cor: string
  icone: any
  ordem: number
}> = {
  sem_vinculo: {
    rotulo: 'Bate e não registra',
    descricao: 'Está cadastrado no relógio e com biometria, mas sem vínculo no SisEscala — o equipamento aceita a digital e a batida fica órfã, sem virar registro de ninguém.',
    acao: 'Use o botão "Criar vínculos por CPF" abaixo. Não precisa mexer no equipamento.',
    cor: 'red',
    icone: Link2,
    ordem: 1,
  },
  fora_do_relogio: {
    rotulo: 'Fora do relógio',
    descricao: 'Não está cadastrado no equipamento — não tem como bater.',
    acao: 'Abra o dispositivo em "Dispositivos REP" e use "Sincronizar cadastros" para empurrar a identidade.',
    cor: 'red',
    icone: UserX,
    ordem: 2,
  },
  sem_biometria: {
    rotulo: 'Sem biometria',
    descricao: 'A identidade chegou ao relógio, mas não há digital cadastrada.',
    acao: 'Biometria não pode ser enviada por API: alguém precisa ir até o equipamento com o servidor.',
    cor: 'amber',
    icone: Fingerprint,
    ordem: 3,
  },
  sem_cpf: {
    rotulo: 'Sem CPF no SisEscala',
    descricao: 'O identificador do relógio é o CPF — sem ele não dá nem para enviar o cadastro.',
    acao: 'Preencha o CPF no cadastro do servidor.',
    cor: 'amber',
    icone: IdCard,
    ordem: 4,
  },
  sem_snapshot: {
    rotulo: 'Cadastro do relógio nunca lido',
    descricao: 'O coletor ainda não reportou quem está cadastrado neste equipamento, então não dá para afirmar nada sobre estes servidores.',
    acao: 'Rode "coletor-rep higiene" (ou o item correspondente no menu da bandeja) na máquina da unidade.',
    cor: 'zinc',
    icone: CloudOff,
    ordem: 5,
  },
  ok: {
    rotulo: 'Pronto para bater',
    descricao: 'Cadastrado no relógio, com biometria e com vínculo vigente.',
    acao: '',
    cor: 'emerald',
    icone: CheckCircle2,
    ordem: 6,
  },
}

const CLASSES_CHIP: Record<string, string> = {
  red: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
}

function mesAtual() {
  const agora = new Date()
  return { mes: agora.getMonth() + 1, ano: agora.getFullYear() }
}

export function CoberturaTab({ isAdmin }: { isAdmin: boolean }) {
  const [{ mes, ano }, setPeriodo] = useState(mesAtual)
  const [resumo, setResumo] = useState<CoberturaResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<Record<string, CoberturaServidor[]>>({})
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false)
  const [processando, setProcessando] = useState(false)

  async function recarregar() {
    setCarregando(true)
    setErro(null)
    setDetalhe({})
    try {
      setResumo(await listarCoberturaResumo(mes, ano))
    } catch (e: any) {
      setErro(e.message || 'Falha ao carregar a cobertura.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { recarregar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mes, ano])

  async function alternarDispositivo(id: string) {
    if (expandido === id) { setExpandido(null); return }
    setExpandido(id)
    if (detalhe[id]) return
    setCarregandoDetalhe(true)
    try {
      setDetalhe((atual) => ({ ...atual, [id]: [] }))
      const lista = await listarCoberturaDispositivo(id, mes, ano)
      setDetalhe((atual) => ({ ...atual, [id]: lista }))
    } catch (e: any) {
      setErro(e.message || 'Falha ao carregar os servidores deste relógio.')
    } finally {
      setCarregandoDetalhe(false)
    }
  }

  async function handleVincular(d: CoberturaResumo) {
    if (!confirm(
      `Criar vínculo para ${d.sem_vinculo} servidor(es) já cadastrado(s) em "${d.dispositivo_nome}", casando por CPF?\n\n` +
      `Isto não escreve nada no equipamento — só liga, no SisEscala, o cadastro que já existe lá ao servidor. ` +
      `A partir daí as batidas deles passam a virar registro em vez de cair como órfãs.\n\n` +
      `As batidas ANTERIORES continuam órfãs: recuperá-las é uma decisão à parte, porque mexe em ponto passado.`
    )) return

    setProcessando(true)
    setErro(null)
    setAviso(null)
    const res = await vincularCadastrosPorCpf(d.dispositivo_id)
    setProcessando(false)
    if ('error' in res && res.error) { setErro(res.error); return }
    if (!('criados' in res)) return

    setAviso(
      `${res.criados} vínculo(s) criado(s) em "${d.dispositivo_nome}", vigentes desde ` +
      `${new Date(res.vigente_de).toLocaleString('pt-BR')}. As próximas batidas dessas pessoas já viram registro.`
    )
    recarregar()
  }

  const totalNaoBatem = resumo.reduce((s, d) => s + d.nao_conseguem_bater, 0)
  const totalEscalados = resumo.reduce((s, d) => s + d.escalados, 0)
  const totalPerdidas = resumo.reduce((s, d) => s + d.batidas_perdidas, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={`${ano}-${String(mes).padStart(2, '0')}`}
            onChange={(e) => {
              const [a, m] = e.target.value.split('-')
              if (a && m) setPeriodo({ mes: Number(m), ano: Number(a) })
            }}
            className="text-sm font-bold px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
          />
          <button onClick={recarregar} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500" title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="text-sm text-zinc-500">
        Quem está escalado no mês e <strong>não consegue</strong> ter o ponto registrado no relógio
        da unidade, e por quê. Confere a escala contra o cadastro real do equipamento (último
        snapshot reportado pelo coletor) e contra os vínculos do SisEscala.
      </p>

      {erro && <p className="text-xs text-red-600 font-medium">{erro}</p>}
      {aviso && <p className="text-xs text-emerald-600 font-medium">{aviso}</p>}

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : resumo.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhum relógio de ponto no seu escopo.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={`p-4 rounded-2xl border ${totalNaoBatem > 0 ? 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-900/40' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'}`}>
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{totalNaoBatem}</p>
              <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">não conseguem bater</p>
              <p className="text-[11px] text-zinc-400">de {totalEscalados} escalado(s) no mês</p>
            </div>
            <div className={`p-4 rounded-2xl border ${totalPerdidas > 0 ? 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-900/40' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'}`}>
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{totalPerdidas}</p>
              <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">batidas perdidas (30 dias)</p>
              <p className="text-[11px] text-zinc-400">registradas no relógio e sem dono no SisEscala</p>
            </div>
            <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{resumo.length}</p>
              <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">relógio(s) no seu escopo</p>
              <p className="text-[11px] text-zinc-400">clique em um para ver servidor por servidor</p>
            </div>
          </div>

          <div className="space-y-2">
            {resumo.map((d) => {
              const aberto = expandido === d.dispositivo_id
              const chips: { s: SituacaoCobertura; n: number }[] = ([
                'sem_vinculo', 'fora_do_relogio', 'sem_biometria', 'sem_cpf', 'sem_snapshot', 'ok',
              ] as SituacaoCobertura[])
                .map((s) => ({ s, n: (d as any)[s] as number }))
                .filter((c) => c.n > 0)

              return (
                <div key={d.dispositivo_id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                  <button
                    onClick={() => alternarDispositivo(d.dispositivo_id)}
                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    {aberto ? <ChevronDown className="h-4 w-4 mt-1 text-zinc-400 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 text-zinc-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2 flex-wrap">
                        {d.dispositivo_nome}
                        {!d.ativo && <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">DESATIVADO</span>}
                        {d.nao_conseguem_bater > 0 && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {d.nao_conseguem_bater} de {d.escalados}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {d.unidade_nome}{d.setor_nome ? ` — ${d.setor_nome}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {chips.map((c) => (
                          <span key={c.s} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${CLASSES_CHIP[SITUACOES[c.s].cor]}`}>
                            {c.n} {SITUACOES[c.s].rotulo.toLowerCase()}
                          </span>
                        ))}
                        {d.batidas_perdidas > 0 && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                            {d.batidas_perdidas} batida(s) sem dono
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        Cadastro do relógio lido em{' '}
                        {d.snapshot_em ? new Date(d.snapshot_em).toLocaleString('pt-BR') : 'nunca'}
                        {' · '}último contato do coletor:{' '}
                        {d.ultimo_contato_em ? new Date(d.ultimo_contato_em).toLocaleString('pt-BR') : 'nunca'}
                      </p>
                    </div>
                  </button>

                  {aberto && (
                    <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                      {isAdmin && d.sem_vinculo > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10">
                          <p className="text-xs text-red-700 dark:text-red-400 flex-1 min-w-[240px]">
                            <strong>{d.sem_vinculo} servidor(es) batendo sem registrar.</strong> Já estão
                            cadastrados no equipamento — falta só o vínculo no SisEscala, que não exige
                            tocar no relógio.
                          </p>
                          <button
                            onClick={() => handleVincular(d)}
                            disabled={processando}
                            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold"
                          >
                            <Link2 className="h-4 w-4" /> Criar vínculos por CPF
                          </button>
                        </div>
                      )}

                      {carregandoDetalhe && !detalhe[d.dispositivo_id]?.length ? (
                        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
                      ) : (detalhe[d.dispositivo_id]?.length || 0) === 0 ? (
                        <p className="text-sm text-zinc-400 text-center py-6">
                          Nenhum servidor escalado neste relógio em {String(mes).padStart(2, '0')}/{ano}.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {[...(detalhe[d.dispositivo_id] || [])]
                            .sort((a, b) => SITUACOES[a.situacao].ordem - SITUACOES[b.situacao].ordem
                              || a.servidor_nome.localeCompare(b.servidor_nome))
                            .map((s) => {
                              const meta = SITUACOES[s.situacao]
                              const Icone = meta.icone
                              return (
                                <div key={s.servidor_id} className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40">
                                  <Icone className={`h-4 w-4 mt-0.5 shrink-0 ${
                                    meta.cor === 'red' ? 'text-red-500'
                                    : meta.cor === 'amber' ? 'text-amber-500'
                                    : meta.cor === 'emerald' ? 'text-emerald-500' : 'text-zinc-400'
                                  }`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                                      {s.servidor_nome}
                                      <span className="text-zinc-400 font-normal"> · {s.matricula || 'sem matrícula'}</span>
                                    </p>
                                    <p className="text-[11px] text-zinc-500">
                                      {s.dias_com_escala} dia(s) de escala no mês
                                      {s.nome_no_device ? ` · no relógio como "${s.nome_no_device}"` : ''}
                                      {s.batidas_perdidas > 0 && (
                                        <span className="text-red-600 font-bold"> · {s.batidas_perdidas} batida(s) perdida(s) em 30 dias</span>
                                      )}
                                    </p>
                                  </div>
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${CLASSES_CHIP[meta.cor]}`}>
                                    {meta.rotulo}
                                  </span>
                                </div>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
            <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">O que cada situação significa</p>
            {(Object.keys(SITUACOES) as SituacaoCobertura[])
              .sort((a, b) => SITUACOES[a].ordem - SITUACOES[b].ordem)
              .map((s) => (
                <p key={s} className="text-[11px] text-zinc-500">
                  <span className={`font-bold px-1.5 py-0.5 rounded ${CLASSES_CHIP[SITUACOES[s].cor]}`}>{SITUACOES[s].rotulo}</span>{' '}
                  {SITUACOES[s].descricao} {SITUACOES[s].acao && <em>{SITUACOES[s].acao}</em>}
                </p>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
