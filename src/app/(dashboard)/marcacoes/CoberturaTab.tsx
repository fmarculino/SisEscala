'use client'

import { useEffect, useState } from 'react'
import { formatarDataHoraComSegundos } from '@/utils/horario'
import {
  Loader2, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Link2, Fingerprint, UserX, IdCard, CloudOff, Users,
} from 'lucide-react'
import {
  listarCoberturaResumo, listarCoberturaDispositivo, vincularCadastrosPorCpf, enfileirarCadastrosPorEscala,
  enfileirarCadastrosEmLote,
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
    acao: 'Use o botão "Criar vínculos por CPF", no cartão do relógio acima. Não precisa mexer no equipamento.',
    cor: 'red',
    icone: Link2,
    ordem: 1,
  },
  fora_do_relogio: {
    rotulo: 'Fora do relógio',
    descricao: 'Não está cadastrado no equipamento — não tem como bater. Pode estar batendo no terminal do computador e ninguém perceber que ele nunca chegou ao relógio.',
    acao: 'Use "Enfileirar cadastro(s)", no cartão do relógio acima: escolhe por escala, então pega também quem está lotado em outra unidade. Depois rode o coletor na máquina da unidade para aplicar no equipamento.',
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

  // limparDetalhe = false depois de uma ação: os totais mudaram, mas o painel aberto continua
  // aberto e é recarregado à parte (carregarDetalhe) - descartar tudo faria a lista que a pessoa
  // está lendo piscar para "nenhum servidor" no meio da operação.
  async function recarregar(limparDetalhe = true) {
    setCarregando(true)
    setErro(null)
    if (limparDetalhe) setDetalhe({})
    try {
      const res = await listarCoberturaResumo(mes, ano)
      if (res.error) { setErro(res.error); setResumo([]) } else { setResumo(res.dados) }
    } catch (e: any) {
      setErro(e.message || 'Falha ao carregar a cobertura.')
    } finally {
      setCarregando(false)
    }
  }

  const recarregarResumo = () => recarregar(false)

  useEffect(() => { recarregar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mes, ano])

  async function carregarDetalhe(id: string) {
    setCarregandoDetalhe(true)
    try {
      const res = await listarCoberturaDispositivo(id, mes, ano)
      if (res.error) setErro(res.error)
      else setDetalhe((atual) => ({ ...atual, [id]: res.dados }))
    } catch (e: any) {
      setErro(e.message || 'Falha ao carregar os servidores deste relógio.')
    } finally {
      setCarregandoDetalhe(false)
    }
  }

  async function alternarDispositivo(id: string) {
    if (expandido === id) { setExpandido(null); return }
    setExpandido(id)
    if (!detalhe[id]) await carregarDetalhe(id)
  }

  async function handleSincronizarTodos() {
    if (resumo.length === 0) return
    const nomesDispositivos = resumo.map((d) => d.dispositivo_nome).join(', ')
    if (!confirm(
      `Enviar cadastros dos servidores para a fila de sincronização do(s) relógio(s) (${nomesDispositivos})?\n\n` +
      `Isso enfileira todos os servidores ativos da lotação e escalados no mês selecionado (${String(mes).padStart(2, '0')}/${ano}) que ainda não estão no relógio.\n\n` +
      `Após o envio para a fila, o aplicativo coletor na unidade fará a gravação no equipamento de ponto.`
    )) return

    setProcessando(true)
    setErro(null)
    setAviso(null)

    const res = await enfileirarCadastrosEmLote(resumo.map((d) => d.dispositivo_id), mes, ano)
    setProcessando(false)

    if (res.erros && res.erros.length > 0 && res.enfileirados === 0) {
      setErro(res.erros.join('; '))
      return
    }

    if (res.enfileirados > 0) {
      setAviso(
        `${res.enfileirados} cadastro(s) adicionado(s) com sucesso à fila de sincronização` +
        (res.ja_na_fila > 0 ? ` (${res.ja_na_fila} já estavam na fila)` : '') +
        `. O aplicativo coletor na unidade irá aplicar no equipamento.`
      )
    } else if (res.ja_na_fila > 0) {
      setAviso('Os cadastros já estão na fila de envio aguardando o coletor na unidade sincronizar.')
    } else {
      setAviso('Todos os servidores da lotação e escala já estão sincronizados ou vinculados aos relógios de ponto.')
    }

    if (expandido) carregarDetalhe(expandido)
    recarregarResumo()
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
      `${formatarDataHoraComSegundos(res.vigente_de)}. As próximas batidas dessas pessoas já viram registro.`
    )
    carregarDetalhe(d.dispositivo_id)
    recarregarResumo()
  }

  async function handleEnfileirar(d: CoberturaResumo) {
    if (!confirm(
      `Enfileirar ${d.fora_do_relogio} servidor(es) escalado(s) para serem cadastrados em "${d.dispositivo_nome}"?\n\n` +
      `Inclui quem está escalado aqui mas lotado em outra unidade/setor — esses o botão ` +
      `"Sincronizar cadastros" do dispositivo nunca alcança, porque ele escolhe por lotação.\n\n` +
      `Isto não escreve no equipamento agora: quem aplica é o coletor, no próximo ` +
      `"Sincronizar cadastros agora" da bandeja (ou "coletor-rep cadastros").`
    )) return

    setProcessando(true)
    setErro(null)
    setAviso(null)
    const res = await enfileirarCadastrosPorEscala(d.dispositivo_id, mes, ano)
    setProcessando(false)
    if ('error' in res && res.error) { setErro(res.error); return }
    if (!('enfileirados' in res)) return

    setAviso(
      `${res.enfileirados} cadastro(s) enfileirado(s) para "${d.dispositivo_nome}"` +
      (res.ja_na_fila > 0 ? ` (${res.ja_na_fila} já estava(m) na fila)` : '') +
      '. Rode o coletor na máquina da unidade para aplicar no equipamento.'
    )
    carregarDetalhe(d.dispositivo_id)
    recarregarResumo()
  }

  const totalNaoBatem = resumo.reduce((s, d) => s + d.nao_conseguem_bater, 0)
  const totalEscalados = resumo.reduce((s, d) => s + d.escalados, 0)
  const totalPerdidas = resumo.reduce((s, d) => s + d.batidas_perdidas, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={`${ano}-${String(mes).padStart(2, '0')}`}
            onChange={(e) => {
              const [a, m] = e.target.value.split('-')
              if (a && m) setPeriodo({ mes: Number(m), ano: Number(a) })
            }}
            className="text-sm font-bold px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
          />
          <button onClick={() => recarregar()} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500" title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={handleSincronizarTodos}
            disabled={processando || carregando || resumo.length === 0}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-sm font-bold shadow-xs transition-colors cursor-pointer"
            title="Enviar cadastros dos servidores para a fila de sincronização do relógio"
          >
            {processando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            <span>Sincronizar cadastros</span>
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
                        {/* Unidade com mais de um relógio: separa quem não registra ponto em lugar
                            nenhum (urgente) de quem usa outra entrada da unidade (opcional). */}
                        {d.cobertos_em_outro > 0 && (
                          <span
                            title="Estas pessoas não conseguem bater NESTE relógio, mas já batem em outro relógio ativo da mesma unidade."
                            className="text-[10px] font-bold text-zinc-600 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 px-2 py-0.5 rounded-full"
                          >
                            {d.cobertos_em_outro} batem em outro relógio
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {d.unidade_nome}{d.setores_nomes ? ` — ${d.setores_nomes}` : ''}
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
                        {d.snapshot_em ? formatarDataHoraComSegundos(d.snapshot_em) : 'nunca'}
                        {' · '}último contato do coletor:{' '}
                        {d.ultimo_contato_em ? formatarDataHoraComSegundos(d.ultimo_contato_em) : 'nunca'}
                      </p>
                      <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1">
                        {aberto ? 'Clique para recolher' : 'Clique para ver servidor por servidor'}
                      </p>
                    </div>
                  </button>

                  {/* Os botões de conserto ficam FORA do bloco expansível: são a razão de existir da
                      tela, e escondê-los atrás de um clique fez a legenda mandar clicar num botão
                      que ninguém achava (13/08/2026). Também não podem ficar dentro do <button> do
                      cabeçalho — botão dentro de botão é HTML inválido. */}
                  {(d.sem_vinculo > 0 || d.fora_do_relogio > 0) && (
                    <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                      {d.sem_vinculo > 0 && (
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

                      {d.fora_do_relogio > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10">
                          <p className="text-xs text-red-700 dark:text-red-400 flex-1 min-w-[240px]">
                            <strong>{d.fora_do_relogio} escalado(s) não estão cadastrados no relógio.</strong>{' '}
                            Enfileira por <em>escala</em> — inclusive quem está lotado em outra unidade
                            ou setor, que o botão "Sincronizar cadastros" do dispositivo não alcança
                            porque escolhe por lotação.
                          </p>
                          <button
                            onClick={() => handleEnfileirar(d)}
                            disabled={processando}
                            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold"
                          >
                            <UserX className="h-4 w-4" /> Enfileirar {d.fora_do_relogio} cadastro(s)
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {aberto && (
                    <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
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
                                    {s.situacao === 'sem_biometria' && s.coberto_em && (
                                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                        A digital desta pessoa já existe em {s.coberto_em}. Não
                                        precisa cadastrar de novo: no coletor da unidade, use
                                        "Copiar biometria entre os relógios".
                                      </p>
                                    )}
                                    {s.situacao !== 'ok' && s.situacao !== 'sem_biometria' && s.coberto_em && (
                                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                        Já bate ponto em {s.coberto_em} — cadastrar aqui só é
                                        necessário se esta pessoa também usa esta entrada.
                                      </p>
                                    )}
                                    {s.situacao === 'fora_do_relogio' && (
                                      <p className="text-[11px] text-zinc-500">
                                        {s.fila_status === 'pendente' ? (
                                          <>Na fila desde já — falta o coletor rodar "Sincronizar cadastros agora" na máquina da unidade.</>
                                        ) : s.fila_status === 'falhou' ? (
                                          <span className="text-red-600">O envio ao relógio falhou: {s.fila_erro || 'sem detalhe'}</span>
                                        ) : !s.lotacao_compativel ? (
                                          <span className="text-amber-600">
                                            Escalado aqui, mas lotado em outra unidade/setor — o botão
                                            "Sincronizar cadastros" do dispositivo nunca pega esta pessoa.
                                            Use "Enfileirar cadastro(s)" acima.
                                          </span>
                                        ) : (
                                          <>Ainda não foi enfileirado para este relógio.</>
                                        )}
                                      </p>
                                    )}
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
