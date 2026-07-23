'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  Calendar, Loader2, Search, Building2, Layers, Users, 
  CheckCircle, XCircle, MessageSquare, AlertTriangle, Clock,
  ChevronDown, ChevronUp, Printer, Eye, Filter, Bell
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { applyAccessFilters } from '@/utils/permissions'
import { formatSectorsHierarchy } from '@/utils/sectors'
import { 
  getSolicitacoesPendentes, avaliarSolicitacao, 
  cancelarSolicitacaoDeferida, getProgramacaoAnualSetor 
} from './actions'

// =========================================================================
// TYPES
// =========================================================================
interface OpcaoDatas {
  p1_inicio: string
  p1_fim: string
  p2_inicio?: string
  p2_fim?: string
}

const MODALIDADE_LABELS: Record<string, string> = {
  integral_30: 'Integral 30d',
  fracionado_15_15: '15 + 15 dias',
  abono_10_20: 'Abono 10d + 20d gozo',
  integral_90: 'Integral 90d',
  fracionado_45_45: '45 + 45 dias',
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  aguardando_validacao: { label: 'Aguardando', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', icon: Clock },
  deferido: { label: 'Deferido', color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: CheckCircle },
  indeferido: { label: 'Indeferido', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: XCircle },
  contraproposta: { label: 'Contraproposta', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', icon: MessageSquare },
  cancelado: { label: 'Cancelado', color: 'text-zinc-500', bg: 'bg-zinc-50 border-zinc-200', icon: XCircle },
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

// =========================================================================
// MAIN PAGE COMPONENT
// =========================================================================
export default function FeriasLicencasPage() {
  const [profile, setProfile] = useState<any>(null)
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [solicitacoes, setSolicitacoes] = useState<any[]>([])

  // Filters
  const [filterUnidade, setFilterUnidade] = useState('todas')
  const [filterSetor, setFilterSetor] = useState('todos')
  const [filterStatus, setFilterStatus] = useState('aguardando_validacao')
  const [searchTerm, setSearchTerm] = useState('')

  // Active tab
  const [activeTab, setActiveTab] = useState<'validacao' | 'programacao' | 'alertas'>('validacao')

  // Programação anual
  const [progAno, setProgAno] = useState(new Date().getFullYear())
  const [programacao, setProgramacao] = useState<any[]>([])
  const [loadingProg, setLoadingProg] = useState(false)

  // Modal states
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [avaliacaoModal, setAvaliacaoModal] = useState<{ isOpen: boolean; solicitacao: any | null; acao: 'deferir' | 'indeferir' | 'contraproposta' }>({
    isOpen: false, solicitacao: null, acao: 'deferir'
  })
  const [parecer, setParecer] = useState('')
  const [opcaoSelecionada, setOpcaoSelecionada] = useState<number>(1)
  const [contraP1Inicio, setContraP1Inicio] = useState('')
  const [contraP1Fim, setContraP1Fim] = useState('')
  const [contraP2Inicio, setContraP2Inicio] = useState('')
  const [contraP2Fim, setContraP2Fim] = useState('')
  const [saving, setSaving] = useState(false)
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'default' | 'danger' | 'success' | 'warning' }>({
    isOpen: false, title: '', message: '', type: 'default'
  })
  const [cancelModal, setCancelModal] = useState<{ isOpen: boolean; solicitacaoId: string; motivo: string }>({
    isOpen: false, solicitacaoId: '', motivo: ''
  })

  const supabase = createClient()

  // Init
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: prof } = await supabase
        .from('profiles')
        .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
        .eq('id', user.id)
        .single()

      if (prof) {
        const userProfile = {
          ...prof,
          permitted_unidades: prof.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
          permitted_setores: prof.profile_setores?.map((ps: any) => ps.setor_id) || [],
        }
        setProfile(userProfile)

        // Load unidades
        let uQuery = supabase.from('unidades').select('id, nome').eq('ativo', true).order('nome')
        const { data: unidadesData } = await uQuery
        setUnidades(unidadesData || [])

        // Load setores
        const { data: setoresData } = await supabase
          .from('setores')
          .select('id, nome, unidade_id, dicionario_setores(nome)')
          .eq('ativo', true)
          .order('nome')
        setSetores(setoresData || [])

        await loadSolicitacoes()
      }
      setLoading(false)
    }
    init()
  }, [])

  const loadSolicitacoes = useCallback(async () => {
    setLoading(true)
    const result = await getSolicitacoesPendentes({
      unidadeId: filterUnidade !== 'todas' ? filterUnidade : undefined,
      setorId: filterSetor !== 'todos' ? filterSetor : undefined,
      status: filterStatus !== 'todos' ? filterStatus : undefined,
    })
    if (result.solicitacoes) {
      setSolicitacoes(result.solicitacoes)
    }
    setLoading(false)
  }, [filterUnidade, filterSetor, filterStatus])

  useEffect(() => {
    if (profile) loadSolicitacoes()
  }, [filterUnidade, filterSetor, filterStatus, profile])

  const loadProgramacao = useCallback(async () => {
    setLoadingProg(true)
    const result = await getProgramacaoAnualSetor({
      unidadeId: filterUnidade !== 'todas' ? filterUnidade : undefined,
      setorId: filterSetor !== 'todos' ? filterSetor : undefined,
      ano: progAno,
    })
    if (result.programacao) {
      setProgramacao(result.programacao)
    }
    setLoadingProg(false)
  }, [filterUnidade, filterSetor, progAno])

  useEffect(() => {
    if (activeTab === 'programacao' && profile) loadProgramacao()
  }, [activeTab, progAno, filterUnidade, filterSetor, profile])

  // Filtered solicitacoes by search
  const filteredSolicitacoes = useMemo(() => {
    if (!searchTerm) return solicitacoes
    const term = searchTerm.toLowerCase()
    return solicitacoes.filter((s: any) => {
      const nome = s.servidores?.nome?.toLowerCase() || ''
      const mat = s.servidores?.matricula?.toLowerCase() || ''
      return nome.includes(term) || mat.includes(term)
    })
  }, [solicitacoes, searchTerm])

  // Filtered setores by selected unit
  const filteredSetores = useMemo(() => {
    if (filterUnidade === 'todas') return setores
    return setores.filter((s: any) => s.unidade_id === filterUnidade)
  }, [setores, filterUnidade])

  // Handle avaliação
  async function handleAvaliar() {
    if (!avaliacaoModal.solicitacao) return
    setSaving(true)

    const result = await avaliarSolicitacao({
      solicitacaoId: avaliacaoModal.solicitacao.id,
      acao: avaliacaoModal.acao,
      opcaoSelecionada: avaliacaoModal.acao === 'deferir' ? opcaoSelecionada : undefined,
      parecer,
      contrapropostaDatas: avaliacaoModal.acao === 'contraproposta' ? {
        p1_inicio: contraP1Inicio,
        p1_fim: contraP1Fim,
        p2_inicio: contraP2Inicio || undefined,
        p2_fim: contraP2Fim || undefined,
      } : undefined,
    })

    setSaving(false)

    if (result.error) {
      setAlertModal({ isOpen: true, title: 'Erro', message: result.error, type: 'danger' })
    } else {
      const acaoLabel = avaliacaoModal.acao === 'deferir' ? 'deferida' : avaliacaoModal.acao === 'indeferir' ? 'indeferida' : 'contraproposta enviada'
      setAlertModal({ isOpen: true, title: 'Sucesso', message: `Solicitação ${acaoLabel} com sucesso!`, type: 'success' })
      setAvaliacaoModal({ isOpen: false, solicitacao: null, acao: 'deferir' })
      setParecer('')
      await loadSolicitacoes()
    }
  }

  // Handle cancel deferido
  async function handleCancelar() {
    setSaving(true)
    const result = await cancelarSolicitacaoDeferida(cancelModal.solicitacaoId, cancelModal.motivo)
    setSaving(false)

    if (result.error) {
      setAlertModal({ isOpen: true, title: 'Erro', message: result.error, type: 'danger' })
    } else {
      setAlertModal({ isOpen: true, title: 'Sucesso', message: 'Solicitação cancelada e eventos removidos da escala.', type: 'success' })
      setCancelModal({ isOpen: false, solicitacaoId: '', motivo: '' })
      await loadSolicitacoes()
    }
  }

  function openAvaliacao(sol: any, acao: 'deferir' | 'indeferir' | 'contraproposta') {
    setAvaliacaoModal({ isOpen: true, solicitacao: sol, acao })
    setParecer('')
    setOpcaoSelecionada(1)
    setContraP1Inicio('')
    setContraP1Fim('')
    setContraP2Inicio('')
    setContraP2Fim('')
  }

  // Access check
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!profile || !['super_admin', 'admin', 'coordenador'].includes(profile.role)) {
    return (
      <div className="text-center py-16">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold">Acesso Restrito</h2>
        <p className="text-zinc-500 mt-2">Você não tem permissão para acessar este módulo.</p>
      </div>
    )
  }

  const pendingCount = solicitacoes.filter(s => s.status === 'aguardando_validacao').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-3">
          <Calendar className="h-8 w-8 text-emerald-600" />
          Férias e Licenças
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Gerencie solicitações de férias e licença prêmio dos servidores.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('validacao')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${
            activeTab === 'validacao'
              ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <Users className="h-4 w-4" />
          Painel de Validação
          {pendingCount > 0 && (
            <span className="ml-1 bg-amber-500 text-white text-xs rounded-full px-2 py-0.5 font-bold">{pendingCount}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('programacao')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${
            activeTab === 'programacao'
              ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <Calendar className="h-4 w-4" />
          Programação Anual
        </button>
        <button
          onClick={() => setActiveTab('alertas')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${
            activeTab === 'alertas'
              ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <Bell className="h-4 w-4" />
          Alertas
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por nome ou matrícula..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <select
          value={filterUnidade}
          onChange={e => { setFilterUnidade(e.target.value); setFilterSetor('todos') }}
          className="px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="todas">Todas as Unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
        <select
          value={filterSetor}
          onChange={e => setFilterSetor(e.target.value)}
          className="px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="todos">Todos os Setores</option>
          {filteredSetores.map((s: any) => (
            <option key={s.id} value={s.id}>{s.dicionario_setores?.nome || s.nome}</option>
          ))}
        </select>
        {activeTab === 'validacao' && (
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
          >
            <option value="todos">Todos os Status</option>
            <option value="aguardando_validacao">Aguardando Validação</option>
            <option value="deferido">Deferidos</option>
            <option value="indeferido">Indeferidos</option>
            <option value="contraproposta">Contraproposta</option>
            <option value="cancelado">Cancelados</option>
          </select>
        )}
      </div>

      {/* TAB: Validação */}
      {activeTab === 'validacao' && (
        <div className="space-y-3">
          {filteredSolicitacoes.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <Calendar className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
              <p className="text-zinc-500">Nenhuma solicitação encontrada com os filtros selecionados.</p>
            </div>
          ) : (
            filteredSolicitacoes.map((sol: any) => {
              const statusCfg = STATUS_CONFIG[sol.status] || STATUS_CONFIG.cancelado
              const StatusIcon = statusCfg.icon
              const isExpanded = expandedId === sol.id
              const opcoes = (sol.opcoes_datas as OpcaoDatas[]) || []
              const servidor = sol.servidores || {}

              return (
                <div key={sol.id} className={`bg-white dark:bg-zinc-900 rounded-xl border ${statusCfg.bg} dark:border-zinc-700 overflow-hidden`}>
                  {/* Row summary */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : sol.id)}
                  >
                    <StatusIcon className={`h-5 w-5 shrink-0 ${statusCfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-zinc-900 dark:text-white truncate">{servidor.nome || '—'}</span>
                        <span className="text-xs text-zinc-500">Mat. {servidor.matricula || '—'}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color} border`}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                        <span>{sol.tipo_beneficio === 'ferias' ? '🏖️ Férias' : '🏆 Licença Prêmio'}</span>
                        <span>Exercício: {sol.exercicio}</span>
                        <span>{MODALIDADE_LABELS[sol.modalidade] || sol.modalidade}</span>
                        <span>{servidor.cargo || ''}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sol.status === 'aguardando_validacao' && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); openAvaliacao(sol, 'deferir') }}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg font-medium transition-colors"
                          >Deferir</button>
                          <button
                            onClick={e => { e.stopPropagation(); openAvaliacao(sol, 'contraproposta') }}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg font-medium transition-colors"
                          >Contraproposta</button>
                          <button
                            onClick={e => { e.stopPropagation(); openAvaliacao(sol, 'indeferir') }}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg font-medium transition-colors"
                          >Indeferir</button>
                        </>
                      )}
                      {sol.status === 'deferido' && ['super_admin', 'admin'].includes(profile.role) && (
                        <button
                          onClick={e => { e.stopPropagation(); setCancelModal({ isOpen: true, solicitacaoId: sol.id, motivo: '' }) }}
                          className="px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 text-white text-xs rounded-lg font-medium transition-colors"
                        >Cancelar</button>
                      )}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-3">
                      <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Opções de Datas Sugeridas pelo Servidor:</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {opcoes.map((op: OpcaoDatas, idx: number) => (
                          <div key={idx} className={`p-3 rounded-lg border text-sm ${
                            sol.status === 'deferido' && sol.opcao_selecionada === idx + 1
                              ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                              : 'border-zinc-200 dark:border-zinc-700'
                          }`}>
                            <p className="font-semibold text-zinc-900 dark:text-white">
                              Opção {idx + 1}
                              {sol.status === 'deferido' && sol.opcao_selecionada === idx + 1 && (
                                <span className="ml-2 text-green-600 text-xs">✓ Aprovada</span>
                              )}
                            </p>
                            <p className="text-zinc-600 dark:text-zinc-400">1º: {formatDate(op.p1_inicio)} a {formatDate(op.p1_fim)}</p>
                            {op.p2_inicio && (
                              <p className="text-zinc-600 dark:text-zinc-400">2º: {formatDate(op.p2_inicio)} a {formatDate(op.p2_fim)}</p>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Sugestão fracionamento */}
                      {sol.sugestao_fracionamento && (
                        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 text-sm">
                          <p className="font-semibold text-amber-800 dark:text-amber-300">💡 Sugestão de Fracionamento 15/15 (caso chefia opte):</p>
                          <p className="text-amber-700 dark:text-amber-400">
                            1º: {formatDate((sol.sugestao_fracionamento as any).p1_inicio)} a {formatDate((sol.sugestao_fracionamento as any).p1_fim)} | 
                            2º: {formatDate((sol.sugestao_fracionamento as any).p2_inicio)} a {formatDate((sol.sugestao_fracionamento as any).p2_fim)}
                          </p>
                        </div>
                      )}

                      {sol.observacao_servidor && (
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                          <strong>Obs. do Servidor:</strong> {sol.observacao_servidor}
                        </p>
                      )}
                      {sol.parecer_coordenador && (
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                          <strong>Parecer:</strong> {sol.parecer_coordenador}
                        </p>
                      )}
                      {sol.abono_pecuniario && (
                        <p className="text-sm text-amber-600">💰 Abono pecuniário de 10 dias solicitado</p>
                      )}
                      {sol.adicional_terco && (
                        <p className="text-sm text-emerald-600">✓ Adicional de 1/3 constitucional solicitado</p>
                      )}

                      {/* Deferred periods */}
                      {sol.status === 'deferido' && sol.periodo_deferido_p1_inicio && (
                        <div className="p-3 rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 text-sm">
                          <p className="font-semibold text-green-800">📅 Períodos Deferidos:</p>
                          <p>1º: {formatDate(sol.periodo_deferido_p1_inicio)} a {formatDate(sol.periodo_deferido_p1_fim)}</p>
                          {sol.periodo_deferido_p2_inicio && (
                            <p>2º: {formatDate(sol.periodo_deferido_p2_inicio)} a {formatDate(sol.periodo_deferido_p2_fim)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* TAB: Programação Anual */}
      {activeTab === 'programacao' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Ano:</label>
            <select
              value={progAno}
              onChange={e => setProgAno(Number(e.target.value))}
              className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
            >
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button
              onClick={() => window.print()}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Printer className="h-4 w-4" />
              Imprimir Programação
            </button>
          </div>

          {loadingProg ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800">
                    <th className="px-3 py-2 text-left border border-zinc-200 dark:border-zinc-700 font-semibold">Nº</th>
                    <th className="px-3 py-2 text-left border border-zinc-200 dark:border-zinc-700 font-semibold">Nome</th>
                    <th className="px-3 py-2 text-left border border-zinc-200 dark:border-zinc-700 font-semibold">Mat.</th>
                    <th className="px-3 py-2 text-left border border-zinc-200 dark:border-zinc-700 font-semibold">Cargo</th>
                    <th className="px-3 py-2 text-center border border-zinc-200 dark:border-zinc-700 font-semibold">Benefício</th>
                    <th className="px-3 py-2 text-center border border-zinc-200 dark:border-zinc-700 font-semibold">Exercício</th>
                    <th className="px-3 py-2 text-center border border-zinc-200 dark:border-zinc-700 font-semibold">1º Período</th>
                    <th className="px-3 py-2 text-center border border-zinc-200 dark:border-zinc-700 font-semibold">2º Período</th>
                    <th className="px-3 py-2 text-center border border-zinc-200 dark:border-zinc-700 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {programacao.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-zinc-500 border border-zinc-200 dark:border-zinc-700">
                        Nenhuma programação encontrada para {progAno}.
                      </td>
                    </tr>
                  ) : (
                    programacao.map((sol: any, idx: number) => {
                      const statusCfg = STATUS_CONFIG[sol.status] || STATUS_CONFIG.cancelado
                      const srv = sol.servidores || {}
                      const p1 = sol.periodo_deferido_p1_inicio
                        ? `${formatDate(sol.periodo_deferido_p1_inicio)} a ${formatDate(sol.periodo_deferido_p1_fim)}`
                        : (sol.opcoes_datas as any[])?.[0]
                          ? `${formatDate((sol.opcoes_datas as any[])[0].p1_inicio)} a ${formatDate((sol.opcoes_datas as any[])[0].p1_fim)} (prev.)`
                          : '—'
                      const p2 = sol.periodo_deferido_p2_inicio
                        ? `${formatDate(sol.periodo_deferido_p2_inicio)} a ${formatDate(sol.periodo_deferido_p2_fim)}`
                        : (sol.opcoes_datas as any[])?.[0]?.p2_inicio
                          ? `${formatDate((sol.opcoes_datas as any[])[0].p2_inicio)} a ${formatDate((sol.opcoes_datas as any[])[0].p2_fim)} (prev.)`
                          : '—'

                      return (
                        <tr key={sol.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700">{idx + 1}</td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 font-medium">{srv.nome || '—'}</td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700">{srv.matricula || '—'}</td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700">{srv.cargo || '—'}</td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-center">
                            {sol.tipo_beneficio === 'ferias' ? 'Férias' : 'L. Prêmio'}
                          </td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-center">{sol.exercicio}</td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-center text-xs">{p1}</td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-center text-xs">{p2}</td>
                          <td className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color} border`}>
                              {statusCfg.label}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB: Alertas */}
      {activeTab === 'alertas' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Bell className="h-5 w-5 text-amber-500" />
              Pendências e Alertas
            </h3>
            <div className="space-y-3">
              {/* Pending for > 15 days */}
              {solicitacoes.filter(s => {
                if (s.status !== 'aguardando_validacao') return false
                const created = new Date(s.created_at)
                const diff = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)
                return diff > 15
              }).length > 0 && (
                <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">⚠️ Solicitações pendentes há mais de 15 dias</p>
                  <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                    {solicitacoes.filter(s => {
                      if (s.status !== 'aguardando_validacao') return false
                      const created = new Date(s.created_at)
                      return (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24) > 15
                    }).length} solicitação(ões) aguardando validação há mais de 15 dias.
                  </p>
                </div>
              )}

              {/* No pending */}
              {solicitacoes.filter(s => s.status === 'aguardando_validacao').length === 0 && (
                <div className="p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20">
                  <p className="text-green-800 dark:text-green-300">✅ Nenhuma solicitação pendente de avaliação.</p>
                </div>
              )}

              <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20">
                <p className="font-semibold text-blue-800 dark:text-blue-300">📊 Resumo do Período</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-600">{solicitacoes.filter(s => s.status === 'aguardando_validacao').length}</p>
                    <p className="text-xs text-zinc-500">Pendentes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{solicitacoes.filter(s => s.status === 'deferido').length}</p>
                    <p className="text-xs text-zinc-500">Deferidas</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-red-600">{solicitacoes.filter(s => s.status === 'indeferido').length}</p>
                    <p className="text-xs text-zinc-500">Indeferidas</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{solicitacoes.filter(s => s.status === 'contraproposta').length}</p>
                    <p className="text-xs text-zinc-500">Contrapropostas</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Avaliação */}
      <Modal
        isOpen={avaliacaoModal.isOpen}
        onClose={() => setAvaliacaoModal({ isOpen: false, solicitacao: null, acao: 'deferir' })}
        title={
          avaliacaoModal.acao === 'deferir' ? '✅ Deferir Solicitação'
          : avaliacaoModal.acao === 'indeferir' ? '❌ Indeferir Solicitação'
          : '💬 Enviar Contraproposta'
        }
      >
        <div className="space-y-4">
          {avaliacaoModal.solicitacao && (
            <div className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg text-sm">
              <p><strong>Servidor:</strong> {avaliacaoModal.solicitacao.servidores?.nome}</p>
              <p><strong>Tipo:</strong> {avaliacaoModal.solicitacao.tipo_beneficio === 'ferias' ? 'Férias' : 'Licença Prêmio'} — {MODALIDADE_LABELS[avaliacaoModal.solicitacao.modalidade]}</p>
              <p><strong>Exercício:</strong> {avaliacaoModal.solicitacao.exercicio}</p>
            </div>
          )}

          {/* Option selection for deferir */}
          {avaliacaoModal.acao === 'deferir' && avaliacaoModal.solicitacao && (
            <div>
              <label className="block text-sm font-medium mb-2">Selecione a opção de datas a aprovar:</label>
              <div className="space-y-2">
                {((avaliacaoModal.solicitacao.opcoes_datas as OpcaoDatas[]) || []).map((op: OpcaoDatas, idx: number) => (
                  <label key={idx} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    opcaoSelecionada === idx + 1
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                      : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}>
                    <input
                      type="radio"
                      name="opcao"
                      checked={opcaoSelecionada === idx + 1}
                      onChange={() => setOpcaoSelecionada(idx + 1)}
                      className="text-green-600"
                    />
                    <div className="text-sm">
                      <p className="font-medium">Opção {idx + 1}</p>
                      <p className="text-zinc-600 dark:text-zinc-400">
                        1º: {formatDate(op.p1_inicio)} a {formatDate(op.p1_fim)}
                        {op.p2_inicio && ` | 2º: ${formatDate(op.p2_inicio)} a ${formatDate(op.p2_fim)}`}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Contraproposta dates */}
          {avaliacaoModal.acao === 'contraproposta' && (
            <div className="space-y-3">
              <label className="block text-sm font-medium">Datas Alternativas Propostas:</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">1º Período - Início</label>
                  <input type="date" value={contraP1Inicio} onChange={e => setContraP1Inicio(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">1º Período - Fim</label>
                  <input type="date" value={contraP1Fim} onChange={e => setContraP1Fim(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">2º Período - Início (opcional)</label>
                  <input type="date" value={contraP2Inicio} onChange={e => setContraP2Inicio(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">2º Período - Fim (opcional)</label>
                  <input type="date" value={contraP2Fim} onChange={e => setContraP2Fim(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
                </div>
              </div>
            </div>
          )}

          {/* Parecer/Justificativa */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {avaliacaoModal.acao === 'indeferir' ? 'Justificativa do Indeferimento *' : 'Parecer / Observações'}
            </label>
            <textarea
              value={parecer}
              onChange={e => setParecer(e.target.value)}
              rows={3}
              placeholder={avaliacaoModal.acao === 'indeferir' ? 'Informe o motivo do indeferimento...' : 'Observações (opcional)...'}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setAvaliacaoModal({ isOpen: false, solicitacao: null, acao: 'deferir' })}
              className="px-4 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >Cancelar</button>
            <button
              onClick={handleAvaliar}
              disabled={saving}
              className={`px-4 py-2 text-sm rounded-lg text-white font-medium flex items-center gap-2 ${
                avaliacaoModal.acao === 'deferir' ? 'bg-green-600 hover:bg-green-700'
                : avaliacaoModal.acao === 'indeferir' ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {avaliacaoModal.acao === 'deferir' ? 'Confirmar Deferimento'
                : avaliacaoModal.acao === 'indeferir' ? 'Confirmar Indeferimento'
                : 'Enviar Contraproposta'}
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Cancelar Deferido */}
      <Modal
        isOpen={cancelModal.isOpen}
        onClose={() => setCancelModal({ isOpen: false, solicitacaoId: '', motivo: '' })}
        title="⚠️ Cancelar Solicitação Deferida"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Ao cancelar, os eventos de férias/licença serão removidos da escala do servidor. Esta ação é irreversível.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Motivo do Cancelamento *</label>
            <textarea
              value={cancelModal.motivo}
              onChange={e => setCancelModal(prev => ({ ...prev, motivo: e.target.value }))}
              rows={3}
              placeholder="Informe o motivo..."
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setCancelModal({ isOpen: false, solicitacaoId: '', motivo: '' })}
              className="px-4 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600">Voltar</button>
            <button onClick={handleCancelar} disabled={saving || cancelModal.motivo.trim().length < 5}
              className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar Cancelamento
            </button>
          </div>
        </div>
      </Modal>

      {/* Alert Modal */}
      <Modal isOpen={alertModal.isOpen} onClose={() => setAlertModal({ ...alertModal, isOpen: false })} title={alertModal.title}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{alertModal.message}</p>
        <div className="flex justify-end mt-4">
          <button onClick={() => setAlertModal({ ...alertModal, isOpen: false })}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">OK</button>
        </div>
      </Modal>
    </div>
  )
}
