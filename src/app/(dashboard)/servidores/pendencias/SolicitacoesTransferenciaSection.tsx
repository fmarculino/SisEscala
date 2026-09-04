'use client'

import { useMemo, useState } from 'react'
import { formatarData } from '@/utils/horario'
import { ArrowRightLeft, Info, CheckCircle2, XCircle, Loader2, User, Calendar, MapPin } from 'lucide-react'
import { avaliarSolicitacaoTransferencia } from '../actions'
import { opcoesParaEscolha, rotularInativo } from '@/utils/opcoesAtivas'
import { SeletorSetorArvore } from '@/components/setores/SeletorSetorArvore'

interface SolicitacaoTransferencia {
  id: string
  servidorId: string
  servidorNome: string
  servidorMatricula: string | null
  unidadeOrigemId: string | null
  setorOrigemId: string | null
  unidadeDestinoId: string | null
  setorDestinoId: string | null
  unidadeOrigemNome: string
  setorOrigemNome: string
  unidadeDestinoNome: string
  setorDestinoNome: string
  dataTransferenciaSugerida: string
  motivo: string
  solicitadoPorNome: string
  solicitadoEm: string
  /**
   * Decidido NO SERVIDOR por `avaliarPermissaoTransferencia` (src/utils/avaliacaoTransferencia.ts),
   * linha a linha — o RH da Unidade avalia o remanejamento dentro das unidades dele e enxerga,
   * sem botão, o pedido que precisa do RH Geral. A action confere de novo: isto aqui só decide o
   * que a tela mostra.
   */
  podeAvaliar: boolean
  /** Por que esta linha não tem botão, quando quem olha é um avaliador. */
  motivoSemPermissao: string | null
}

interface SolicitacoesTransferenciaSectionProps {
  solicitacoes: SolicitacaoTransferencia[]
  erro: string | null
  /** O papel de quem olha avalia transferência (super_admin, RH Geral ou RH da Unidade). */
  avaliador: boolean
  unidades: { id: string; nome: string; ativo?: boolean | null }[]
  /**
   * `nome` é o CAMINHO completo ("SHL \ BLOCO A"); `nomeFolha` e `parent_id` são o que a árvore
   * de seleção usa (`formatSectorPaths` devolve os três).
   */
  setores: {
    id: string
    unidade_id: string | null
    parent_id?: string | null
    nome: string
    nomeFolha?: string
    ativo?: boolean
  }[]
}

export function SolicitacoesTransferenciaSection({
  solicitacoes,
  erro,
  avaliador,
  unidades,
  setores,
}: SolicitacoesTransferenciaSectionProps) {
  const [resolvidas, setResolvidas] = useState<Set<string>>(new Set())
  const visiveis = solicitacoes.filter(s => !resolvidas.has(s.id))

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-blue-500" /> Solicitações de Transferência / Disponibilização ao RH
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          {avaliador
            ? 'Administrador Geral e RH Geral avaliam qualquer pedido; o RH da Unidade avalia o remanejamento dentro das próprias unidades. Quando o pedido vier sem destino ("A definir pelo RH"), escolha a unidade e setor de destino ao aprovar.'
            : 'Pedidos de transferência aguardando avaliação do RH. Você vê aqui os que estão no seu escopo.'}
        </p>
      </div>

      <div className="p-5">
        {erro ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Não foi possível carregar esta seção ({erro}).</span>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 py-6 justify-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nenhuma solicitação pendente.
          </div>
        ) : (
          <div className="space-y-3">
            {visiveis.map(s => (
              <LinhaSolicitacao
                key={s.id}
                solicitacao={s}
                avaliador={avaliador}
                unidades={unidades}
                setores={setores}
                onResolvida={() => setResolvidas(prev => new Set(prev).add(s.id))}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function LinhaSolicitacao({
  solicitacao,
  avaliador,
  unidades,
  setores,
  onResolvida,
}: {
  solicitacao: SolicitacaoTransferencia
  avaliador: boolean
  unidades: { id: string; nome: string; ativo?: boolean | null }[]
  /**
   * `nome` é o CAMINHO completo ("SHL \ BLOCO A"); `nomeFolha` e `parent_id` são o que a árvore
   * de seleção usa (`formatSectorPaths` devolve os três).
   */
  setores: {
    id: string
    unidade_id: string | null
    parent_id?: string | null
    nome: string
    nomeFolha?: string
    ativo?: boolean
  }[]
  onResolvida: () => void
}) {
  const isDestinoIndefinido = !solicitacao.unidadeDestinoId
  const podeAvaliar = solicitacao.podeAvaliar

  const [mostrarRejeicao, setMostrarRejeicao] = useState(false)
  const [mostrarSelecaoDestino, setMostrarSelecaoDestino] = useState(isDestinoIndefinido)
  const [selectedUnidade, setSelectedUnidade] = useState(solicitacao.unidadeDestinoId || '')
  const [selectedSetor, setSelectedSetor] = useState(solicitacao.setorDestinoId || '')
  const [parecer, setParecer] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  /**
   * Destino de transferência é escolha NOVA — setor inativo fica fora (mesma regra da promoção
   * de pendência). Exceção: o destino que a própria solicitação já trazia continua selecionável,
   * senão aprovar um pedido antigo passaria a ser impossível sem ninguém entender por quê.
   *
   * ⚠️ O recorte por unidade é feito AQUI, não dentro da árvore: um setor cujo pai é de outra
   * unidade vira raiz na montagem (`arvoreSetores.ts`) em vez de sumir, que é o que se quer.
   *
   * `nome` da árvore é a FOLHA (a hierarquia já aparece no recuo); o caminho completo vai para o
   * resumo do escolhido, que é onde ele faz falta depois de recolher um ramo.
   */
  const filteredSetores = useMemo(
    () =>
      (selectedUnidade ? setores.filter(s => s.unidade_id === selectedUnidade) : setores)
        .filter(s => s.ativo !== false || s.id === solicitacao.setorDestinoId)
        .map(s => ({
          id: s.id,
          parent_id: s.parent_id ?? null,
          nome: s.nomeFolha || s.nome,
          caminho: s.nome,
          ativo: s.ativo,
        })),
    [setores, selectedUnidade, solicitacao.setorDestinoId]
  )

  async function aprovar() {
    if (mostrarSelecaoDestino || isDestinoIndefinido) {
      if (!selectedUnidade || !selectedSetor) {
        setErro('Por favor, selecione a unidade e o setor de destino antes de aprovar.')
        return
      }
    }

    setSalvando(true)
    setErro(null)
    const res = await avaliarSolicitacaoTransferencia({
      solicitacaoId: solicitacao.id,
      acao: 'aprovar',
      unidadeDestinoId: selectedUnidade || undefined,
      setorDestinoId: selectedSetor || undefined,
    })
    setSalvando(false)
    if (res?.error) { setErro(res.error); return }
    onResolvida()
  }

  async function rejeitar() {
    if (parecer.trim().length < 5) {
      setErro('Informe o motivo da rejeição (mínimo 5 caracteres).')
      return
    }
    setSalvando(true)
    setErro(null)
    const res = await avaliarSolicitacaoTransferencia({ solicitacaoId: solicitacao.id, acao: 'rejeitar', parecer })
    setSalvando(false)
    if (res?.error) { setErro(res.error); return }
    onResolvida()
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {solicitacao.servidorNome}
              {solicitacao.servidorMatricula && <span className="text-zinc-400 font-normal"> · matrícula {solicitacao.servidorMatricula}</span>}
            </p>
            {isDestinoIndefinido && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 rounded">
                Disponibilizado para o RH
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
            <span className="text-zinc-500">{solicitacao.unidadeOrigemNome} / {solicitacao.setorOrigemNome}</span>
            {' → '}
            <span className={`font-semibold ${isDestinoIndefinido ? 'text-amber-600 dark:text-amber-400 italic' : 'text-blue-600 dark:text-blue-400'}`}>
              {solicitacao.unidadeDestinoNome} / {solicitacao.setorDestinoNome}
            </span>
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{solicitacao.motivo}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> {solicitacao.solicitadoPorNome}</span>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> efetivação pretendida {formatarData(solicitacao.dataTransferenciaSugerida)}</span>
          </div>
        </div>

        {podeAvaliar && (
          <div className="flex items-center gap-2 shrink-0">
            {!mostrarSelecaoDestino && !isDestinoIndefinido && (
              <button
                onClick={aprovar}
                disabled={salvando}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Aprovar
              </button>
            )}
            <button
              onClick={() => setMostrarRejeicao(v => !v)}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Rejeitar
            </button>
          </div>
        )}
      </div>

      {avaliador && !podeAvaliar && solicitacao.motivoSemPermissao && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 italic border-t border-zinc-100 dark:border-zinc-800 pt-2">
          {solicitacao.motivoSemPermissao}
        </p>
      )}

      {podeAvaliar && (mostrarSelecaoDestino || isDestinoIndefinido) && (
        <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-amber-500" />
              {isDestinoIndefinido ? 'Defina a nova lotação do servidor para aprovar:' : 'Confirmar/Alterar lotação de destino:'}
            </p>
          </div>
          {/* Empilhado, não lado a lado: a árvore de setores é alta (busca + lista rolável) e
              ao lado de um <select> de uma linha deixava metade da caixa vazia. */}
          <div className="space-y-3">
            <div className="sm:max-w-sm">
              <label className="block text-[11px] font-semibold text-zinc-500 uppercase">Unidade de Destino *</label>
              <select
                value={selectedUnidade}
                onChange={(e) => {
                  const unit = e.target.value
                  setSelectedUnidade(unit)
                  const belongs = setores.some(s => s.id === selectedSetor && s.unidade_id === unit)
                  if (!belongs) setSelectedSetor('')
                }}
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-white"
              >
                <option value="">Selecione a Unidade...</option>
                {/* Unidade inativa nao e destino de transferencia; a do proprio pedido
                      continua na lista para nao trocar o valor sozinho (opcoesAtivas.ts). */}
                {opcoesParaEscolha(unidades, selectedUnidade).map(u => (
                  <option key={u.id} value={u.id}>{rotularInativo(u, ' (inativa)')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 uppercase">Setor de Destino *</label>
              {/* Árvore, não <select> plano: o HMM tem 196 setores em 40 raízes e 3 níveis, e a
                  lista plana obrigava a caçar o ramo dentro de um dropdown rolando. Seleção
                  ÚNICA e sem cascata — a lotação é um setor só (ver SeletorSetorArvore). */}
              <div className="mt-1">
                <SeletorSetorArvore
                  setores={filteredSetores}
                  selecionado={selectedSetor}
                  onChange={setSelectedSetor}
                  placeholder={selectedUnidade ? 'Selecione o setor de destino…' : 'Selecione a unidade primeiro'}
                  disabled={salvando}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={aprovar}
              disabled={salvando || !selectedUnidade || !selectedSetor}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
            >
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Confirmar e Efetivar Transferência
            </button>
          </div>
        </div>
      )}

      {mostrarRejeicao && (
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
          <textarea
            value={parecer}
            onChange={e => setParecer(e.target.value)}
            placeholder="Motivo da rejeição..."
            rows={2}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white"
          />
          <div className="flex justify-end">
            <button
              onClick={rejeitar}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirmar rejeição'}
            </button>
          </div>
        </div>
      )}

      {erro && <p className="text-xs text-red-600 dark:text-red-400 font-medium">{erro}</p>}
    </div>
  )
}
