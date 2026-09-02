'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { formatarData, formatarDataHora, formatarHora, formatarHoraComSegundos, dataISOLocal } from '@/utils/horario'
import { avaliarSequenciaPresenca, type PassoPresenca } from '@/utils/sequenciaPresenca'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { 
  Save, Loader2, Info, Zap, Lock, Unlock, FileText, Plus, UserPlus, Users, 
  CheckCircle, Trash2, Globe, X, Copy, Check, Clock, Navigation2, Send, CheckSquare,
  Shield, ShieldCheck, ShieldAlert, AlertTriangle, LayoutTemplate,
  ChevronLeft, ChevronRight, Sparkles, ExternalLink
} from 'lucide-react'
import { gerarFolhaPonto } from '@/app/(dashboard)/folha-ponto/actions'
import { ScalePrintView } from '@/components/ScalePrintView'
import { Modal } from '@/components/ui/Modal'
import { SelectComBuscaRemota, type OpcaoRemota } from '@/components/ui/SelectComBuscaRemota'
import React from 'react'
import { canEditScale, podeEditarForaDoPrazo, UserRole } from '@/utils/governance'
import { runComplianceCheck, getViolationsForCell, type ComplianceViolation } from '@/utils/complianceEngine'
import { generateTemplate, TEMPLATE_OPTIONS, type TemplateType, countWorkDays } from '@/utils/scaleTemplates'
import { encontrarConflitoExterno, diasComConflitoExterno } from '@/utils/conflitoEscala'
import {
  avaliarCarga,
  avisoAoAdicionar,
  descreverExcesso,
  formatarHoras,
  type AvaliacaoCarga,
  type CargaEscala,
  type TetoServidor
} from '@/utils/limiteCargaMensal'
import {
  podeAutorizarCarga,
  mensagemTetoExcedido,
  instrucaoSalvarBloqueado,
  type PedidoPendente
} from '@/utils/autorizacaoCarga'
import { buildSectorPathMap, formatSectorsHierarchy } from '@/utils/sectors'
import { decomporPlantao } from '@/utils/plantaoUnidades'
import { celulaTemPassosDeIntervalo } from '@/utils/intervaloIntrajornada'
import { statusAcionamento } from '@/utils/sobreaviso/statusAcionamento'
import {
  gerarEscalaInteligente,
  CATEGORIAS_GERAVEIS,
  LIMIAR_CONFIANCA,
  MESES_HISTORICO_PADRAO,
  MESES_HISTORICO_MAX,
  montarResumoGerador,
  type MesGerado
} from '@/utils/intelligentScaleGenerator'
import {
  encontrarAfastamentosBloqueantes,
  dataISODoDia,
  siglaAfastamento,
  rotuloAfastamento,
  type AfastamentoEvento
} from '@/utils/afastamentos'
import { NavegacaoEscalas } from './NavegacaoEscalas'
import { SwapRequestPanel } from '@/components/SwapRequestPanel'
import { sendWhatsAppMessageAction } from '@/app/actions/communication'
import { AcionarSobreavisoModal } from '@/components/sobreaviso/AcionarSobreavisoModal'
import { AutorizacaoExcecaoModal } from '@/components/escalas/AutorizacaoExcecaoModal'
import { SolicitarExcecaoModal } from '@/components/escalas/SolicitarExcecaoModal'
import { AlterarJornadaModal, type AlterarJornadaAlvo } from '@/components/escalas/AlterarJornadaModal'

interface ScaleGridProps {
  unidadeId: string
  setorId: string
  mes: number
  ano: number
  todosServidoresSetor: any[]
  turnos: any[]
  escalaMensalInicial: any[]
  escalaDiariaInicial: any[]
  feriados: any[]
  diasInativacao: number
  logsSobreavisoInicial: any[]
  configsGlobais: any[]
  userProfile: any
}

type RowCategory = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'


// Uma batida real que o coordenador escolheu para um passo. `fonte` diz de onde ela veio, e o
// banco resolve cada uma por um caminho diferente (fn_validar_presenca_manual):
//   marcacao  → linha em marcacoes_ponto (batida registrada fora da janela, desde a v1.22.0)
//   tentativa → linha em logs_tentativas_presenca (recusa anterior ao wrapper)
// O que trafega é o ID, nunca o horário: o servidor relê o timestamp da fonte, com os segundos.
type SelecaoBatida = { fonte: 'marcacao' | 'tentativa'; id: string; hora: string }

// Com segundos de propósito: é o que distingue batida real de horário sintético (armadilha 5).
// Esconder os segundos aqui apagaria justamente a evidência que a seleção existe para preservar.
const horaComSegundos = (d: Date) => formatarHoraComSegundos(d)

/**
 * Assinatura canonica do que a grade tem lancado (turno + hora informada por celula).
 *
 * Serve para saber se ha edicao pendente antes de sair da tela pelas setas de navegacao.
 * Ignora celula vazia de proposito: adicionar servidor a grade JA grava `escala_mensal` no
 * banco e cria uma linha vazia no estado -- contar isso como alteracao daria aviso falso, e
 * aviso falso ensina o usuario a ignorar o aviso verdadeiro.
 */
function assinaturaDaGrade(
  gridData: Record<string, Record<string, Record<number, string>>>,
  gridHoras: Record<string, Record<string, Record<number, string>>>
): string {
  const partes: string[] = []
  Object.keys(gridData).sort().forEach(servidorId => {
    const categorias = gridData[servidorId] || {}
    Object.keys(categorias).sort().forEach(categoria => {
      const dias = categorias[categoria] || {}
      Object.keys(dias).map(Number).sort((a, b) => a - b).forEach(dia => {
        const turno = dias[dia]
        if (!turno) return
        const hora = gridHoras[servidorId]?.[categoria]?.[dia] || ''
        partes.push(`${servidorId}|${categoria}|${dia}|${turno}|${hora}`)
      })
    })
  })
  return partes.join(';')
}

export function ScaleGrid({
  unidadeId,
  setorId,
  mes,
  ano,
  todosServidoresSetor,
  turnos,
  escalaMensalInicial,
  escalaDiariaInicial,
  feriados = [],
  diasInativacao,
  logsSobreavisoInicial,
  configsGlobais,
  userProfile
}: ScaleGridProps) {
  const router = useRouter()
  // Initialize Supabase client once
  const [supabase] = useState(() => createClient())
  const [loading, setLoading] = useState(false)
  const [navigatingFolhaId, setNavigatingFolhaId] = useState<string | null>(null)
  const [isTotalsCollapsed, setIsTotalsCollapsed] = useState(false)
  const [servidoresEventos, setServidoresEventos] = useState<any[]>([])
  const [jornadasTemporarias, setJornadasTemporarias] = useState<any[]>([])

  // Servidor Afastado/Inativo sai da ESCOLHA de quem entra numa escala nova — o próprio
  // StatusToggle promete isso ("sai das novas escalas até voltar para Ativo" / "não aparecerá
  // mais nas novas escalas"), mas a query que traz todosServidoresSetor não filtra por status,
  // então "+ Adicionar Servidor" e "Adicionar Todos do Setor" ofereciam (e inseriam de verdade em
  // escala_mensal) gente afastada ou inativa. `todosServidoresSetor` em si fica intacto — o resto
  // do arquivo usa ele para achar nome/cargo de quem JÁ está na escala, mesmo que tenha ficado
  // afastado depois de escalado, e não deve parar de achar.
  const servidoresElegiveisParaEscala = useMemo(
    () => todosServidoresSetor.filter(s => s.status === 'Ativo'),
    [todosServidoresSetor]
  )

  const handleNavigateToFolha = async (em: any) => {
    if (!em?.servidor_id) return
    setNavigatingFolhaId(em.servidor_id)
    try {
      // 1. Procurar se já existe folha_ponto no banco de dados para esta escala mensal
      const { data: folha } = await supabase
        .from('folha_ponto')
        .select('id')
        .eq('escala_mensal_id', em.id)
        .maybeSingle()

      if (folha?.id) {
        router.push(`/folha-ponto/${folha.id}`)
        return
      }

      // 2. Se a folha ainda não foi criada no banco, chamar a action para gerar/obter em rascunho
      const res = await gerarFolhaPonto(em.servidor_id, em.mes || mes, em.ano || ano, true, em.id)

      if (res?.success && (res.folha_id || (res as any).folhaId)) {
        const targetId = res.folha_id || (res as any).folhaId
        router.push(`/folha-ponto/${targetId}`)
      } else if (res?.error) {
        setAlertModal({
          isOpen: true,
          title: 'Escala em Rascunho',
          message: `${res.error}\n\nDica: Clique no botão verde "Salvar Previsão" no canto superior direito para gravar a escala no banco e gerar a folha de ponto.`,
          type: 'warning'
        })
      }
    } catch (err: any) {
      console.error('Erro ao navegar para folha de ponto:', err)
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: 'Não foi possível carregar a folha de ponto deste servidor.',
        type: 'danger'
      })
    } finally {
      setNavigatingFolhaId(null)
    }
  }

  const fetchServidoresEventos = useCallback(async () => {
    if (escalaMensalInicial.length === 0) return
    const servantIds = escalaMensalInicial.map(em => em.servidor_id)
    const lastDay = new Date(ano, mes, 0).getDate()
    const startRange = `${ano}-${mes.toString().padStart(2, '0')}-01`
    const endRange = `${ano}-${mes.toString().padStart(2, '0')}-${lastDay}`

    const { data, error } = await supabase
      .from('servidores_eventos')
      .select('*, tipos_eventos(*)')
      .in('servidor_id', servantIds)
      .lte('data_inicio', endRange)
      .gte('data_fim', startRange)

    if (error) {
      console.error('Erro ao buscar eventos dos servidores:', error)
    } else {
      setServidoresEventos(data || [])
    }
  }, [supabase, escalaMensalInicial, mes, ano])

  const fetchJornadasTemporarias = useCallback(async () => {
    if (escalaMensalInicial.length === 0) return
    const servantIds = escalaMensalInicial.map(em => em.servidor_id)
    const lastDay = new Date(ano, mes, 0).getDate()
    const startRange = `${ano}-${mes.toString().padStart(2, '0')}-01`
    const endRange = `${ano}-${mes.toString().padStart(2, '0')}-${lastDay}`

    const { data, error } = await supabase
      .from('servidores_jornadas_temporarias')
      .select('*, jornadas(*)')
      .in('servidor_id', servantIds)
      .lte('data_inicio', endRange)
      .gte('data_fim', startRange)

    if (error) {
      console.error('Erro ao buscar jornadas temporárias:', error)
    } else {
      setJornadasTemporarias(data || [])
    }
  }, [supabase, escalaMensalInicial, mes, ano])

  const fetchLogsTentativas = useCallback(async () => {
    if (escalaMensalInicial.length === 0) return
    const servantIds = escalaMensalInicial.map(em => em.servidor_id)
    const lastDay = new Date(ano, mes, 0).getDate()
    const startRange = `${ano}-${mes.toString().padStart(2, '0')}-01T00:00:00Z`
    const endRange = `${ano}-${mes.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}T23:59:59Z`

    // Vem da RPC, e não da tabela, por causa da coluna `elegivel`: nem toda tentativa recusada
    // prova presença (PIN inválido, sem escala). A regra vive em fn_tentativa_recusada_elegivel
    // e é a mesma que fn_batidas_reais_recusadas usa — duplicá-la aqui criaria divergência.
    const { data, error } = await supabase.rpc('fn_tentativas_recusadas_mes', {
      p_servidor_ids: servantIds,
      p_mes: mes,
      p_ano: ano
    })

    if (!error && data) {
      setLogsTentativas(data)
    }

    // Batidas registradas no mês (terminal, rep, pendrive, ajuste_servidor).
    // Busca via RPC dedicada (mesmo padrão de fn_tentativas_recusadas_mes) para
    // garantir que regras de RLS não mascarem marcações dos servidores da grade.
    const { data: pendRpc, error: rpcErr } = await supabase.rpc('fn_marcacoes_mes', {
      p_servidor_ids: servantIds,
      p_mes: mes,
      p_ano: ano
    })

    if (!rpcErr && pendRpc) {
      setMarcacoesPendentes(pendRpc)
    } else {
      const { data: pend } = await supabase
        .from('marcacoes_ponto')
        .select('id, servidor_id, ocorrido_em, observacao, origem')
        .in('servidor_id', servantIds)
        .in('origem', ['terminal', 'rep', 'ajuste_servidor', 'ajuste_coordenador'])
        .gte('ocorrido_em', startRange)
        .lte('ocorrido_em', endRange)
        .order('ocorrido_em')

      setMarcacoesPendentes(pend || [])
    }
  }, [supabase, escalaMensalInicial, mes, ano])

  const [unidadedata, setUnidadedata] = useState<any>(null)
  const [excecoesEscala, setExcecoesEscala] = useState<any[]>([])
  /**
   * Pedidos de Autorização Extraordinária EM ABERTO na competência, por servidor.
   *
   * ⚠️ Sem isto o coordenador que já pediu recebe de novo o convite para pedir, e a RPC recusa
   * com "já existe pedido pendente" — a tela mandaria fazer algo que ela mesma vai negar. É a
   * mesma regra do texto de teto: não oferecer o que não vai acontecer.
   */
  const [pedidosPendentes, setPedidosPendentes] = useState<Record<string, PedidoPendente>>({})
  const [solicitacaoModalState, setSolicitacaoModalState] = useState<{
    isOpen: boolean
    servidorId: string
    servidorNome: string
    horasAtuais: number
    sobreavisosAtuais: number
  } | null>(null)
  const [autorizacaoModalState, setAutorizacaoModalState] = useState<{
    isOpen: boolean
    servidorId: string
    servidorNome: string
    horasAtuais: number
    sobreavisosAtuais: number
  } | null>(null)

  /**
   * ⚠️ SEM filtro por unidade desde 28/08/2026. A Autorização Extraordinária passou a ser uma por
   * (servidor, mês, ano) — o teto é da pessoa, então a autorização também é. Filtrar por unidade
   * faria esta grade ignorar uma autorização concedida a partir do outro setor e recusar um
   * lançamento que já estava autorizado.
   */
  const fetchExcecoesEscala = useCallback(async () => {
    if (!mes || !ano) return
    const { data, error } = await supabase
      .from('excecoes_escala_servidor')
      .select('*')
      .eq('mes', mes)
      .eq('ano', ano)

    if (!error && data) {
      setExcecoesEscala(data)
    }
  }, [supabase, mes, ano])

  /**
   * ⚠️ Vem de `fn_solicitacoes_excecao_carga` (SECURITY DEFINER), não de um SELECT na tabela: a
   * listagem precisa do NOME de quem pediu, e a RLS de `profiles` só libera a tabela inteira
   * para super_admin — um coordenador consultando o autor receberia zero linhas.
   */
  const fetchPedidosPendentes = useCallback(async () => {
    if (!mes || !ano) return
    const { data, error } = await supabase.rpc('fn_solicitacoes_excecao_carga', {
      p_status: 'pendente', p_mes: mes, p_ano: ano
    })
    if (error || !data) return
    const porServidor: Record<string, PedidoPendente> = {}
    for (const s of data) porServidor[s.servidor_id] = s
    setPedidosPendentes(porServidor)
  }, [supabase, mes, ano])

  useEffect(() => {
    fetchServidoresEventos()
    fetchJornadasTemporarias()
    fetchLogsTentativas()
    fetchExcecoesEscala()
    fetchPedidosPendentes()

    async function fetchUnidadeConfig() {
      if (!unidadeId) return
      const { data } = await supabase
        .from('unidades')
        .select('id, permite_marca_intervalo, tipo_intervalo, tolerancia_intervalo_minutos')
        .eq('id', unidadeId)
        .maybeSingle()
      if (data) setUnidadedata(data)
    }
    fetchUnidadeConfig()
  }, [escalaMensalInicial, fetchServidoresEventos, fetchJornadasTemporarias, fetchLogsTentativas, fetchExcecoesEscala, supabase, unidadeId])

  /**
   * TODOS os eventos do servidor naquele dia. Um dia pode ter mais de um afastamento —
   * declaracao de comparecimento pela manha e outra a tarde, por exemplo — e ate
   * 24/08/2026 a grade usava `.find()`, nomeando so o primeiro.
   */
  const getEventosDoDia = useCallback((servidorId: string, day: number) => {
    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    return servidoresEventos.filter(se =>
      se.servidor_id === servidorId &&
      dateStr >= se.data_inicio &&
      dateStr <= se.data_fim
    )
  }, [servidoresEventos, mes, ano])

  const permitirPlantaoExtraEventos = configsGlobais.some(
    c => c.chave === 'permitir_plantao_extra_durante_eventos' && String(c.valor) === 'true'
  )

  /**
   * TODOS os afastamentos que impedem lancar este turno neste dia. Mesma regra do trigger
   * fn_prevent_shift_during_event: por horas nao bloqueia, por slot bloqueia so o periodo,
   * Regular e Sobreaviso nunca sao liberados pela configuracao de governanca.
   * Celula vazia entra com turnoSlots = [] — so afastamento integral a bloqueia.
   */
  const getAfastamentosBloqueantes = useCallback((
    servidorId: string,
    day: number,
    categoria: RowCategory | string,
    turnoSlots?: string[] | null
  ): AfastamentoEvento[] => {
    return encontrarAfastamentosBloqueantes({
      eventos: servidoresEventos as AfastamentoEvento[],
      servidorId,
      dataISO: dataISODoDia(ano, mes, day),
      categoria,
      turnoSlots,
      permitirPlantaoExtra: permitirPlantaoExtraEventos
    })
  }, [servidoresEventos, mes, ano, permitirPlantaoExtraEventos])

  /** O primeiro bloqueante. Basta para RECUSAR; para EXIBIR use a lista. */
  const getAfastamentoBloqueante = useCallback((
    servidorId: string,
    day: number,
    categoria: RowCategory | string,
    turnoSlots?: string[] | null
  ): AfastamentoEvento | null =>
    getAfastamentosBloqueantes(servidorId, day, categoria, turnoSlots)[0] || null,
  [getAfastamentosBloqueantes])

  useEffect(() => {
    const saved = localStorage.getItem('scale-totals-collapsed')
    if (saved !== null) {
      setIsTotalsCollapsed(saved === 'true')
    }
  }, [])

  const toggleTotals = useCallback(() => {
    setIsTotalsCollapsed(prev => {
      const newVal = !prev
      localStorage.setItem('scale-totals-collapsed', String(newVal))
      return newVal
    })
  }, [])

  const logAction = useCallback(async (acao: string, detalhes: any = {}) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase.from('logs_sistema').insert({
        user_id: user.id,
        acao,
        detalhes: {
          ...detalhes,
          mes,
          ano,
          setor_id: setorId,
          unidade_id: unidadeId
        },
        unidade_id: unidadeId,
        setor_id: setorId
      })
    } catch (error) {
      console.error('Erro ao registrar log:', error)
    }
  }, [supabase, mes, ano, setorId, unidadeId])
  const [escalaMensal, setEscalaMensal] = useState(escalaMensalInicial)
  const [logsSobreaviso, setLogsSobreaviso] = useState(logsSobreavisoInicial)
  const [linkedServidorId, setLinkedServidorId] = useState<string | null>(null)

  useEffect(() => {
    async function findServidor() {
      if (userProfile?.role === 'comum' || userProfile?.role === 'servidor') {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: serv } = await supabase
            .from('servidores')
            .select('id')
            .eq('email', user.email)
            .single()
          if (serv) setLinkedServidorId(serv.id)
        }
      }
    }
    findServidor()
  }, [userProfile, supabase])
  
  const configs = useMemo(() => {
    const obj: Record<string, string> = {}
    configsGlobais.forEach(c => {
      obj[c.chave] = String(c.valor)
    })
    return obj
  }, [configsGlobais])

  // `sobreaviso_desconsiderar_falha` foi APOSENTADA em 24/08/2026 (migration 20260824150000).
  // Ela nunca fez mais do que mudar um tooltip, mas com a decisao de 23/08/2026 - falha de
  // acionamento vira FALTA - viraria um interruptor global capaz de anular a falta de
  // sobreaviso na rede inteira, sem log e sem justificativa. A unica porta para desfazer uma
  // falta agora e a validacao do coordenador na fila, que grava autor, data e motivo.
  const permitirValidacaoManual = configs['sobreaviso_permitir_validacao_manual'] === 'true'
  const [triggerModal, setTriggerModal] = useState<{
    isOpen: boolean;
    servidorId: string;
    servidorNome: string;
    turnoId: string;
    escalaMensalId: string;
    dia: number;
  } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [allUnidades, setAllUnidades] = useState<any[]>([])
  const [allSetores, setAllSetores] = useState<any[]>([])
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false)
  const [jornadas, setJornadas] = useState<any[]>([])
  const [externalData, setExternalData] = useState({
    unidadeId: '',
    setorId: '',
    servidorId: ''
  })
  const [externalSectors, setExternalSectors] = useState<any[]>([])
  const [externalServers, setExternalServers] = useState<any[]>([])
  /**
   * O servidor escolhido pela BUSCA POR NOME do modal de Servidor Externo (31/08/2026).
   *
   * Guarda o registro inteiro, não só o id, por dois motivos: o rótulo do campo fechado precisa
   * do nome (a lista da busca é volátil — some a cada termo novo), e a LOTAÇÃO encontrada é
   * mostrada logo abaixo como confirmação. Quem busca pelo nome está justamente escolhendo sem
   * saber onde a pessoa está lotada; ver a lotação antes de adicionar é o que evita levar para a
   * grade um homônimo.
   */
  const [externalEncontrado, setExternalEncontrado] = useState<{
    id: string; nome: string; matricula: string | null; cargo: string | null
    unidade_nome: string | null; setor_caminho: string | null
  } | null>(null)
  const [currentSector, setCurrentSector] = useState<any>(null)

  // Modal & Alert states
  // Modal de hora de início para turnos de duração livre (T4, N4, N6, M7...). Abre ao lançar
  // o turno na grade — decisão de 08/08/2026: a hora é informada na hora de escalar.
  const [horaModal, setHoraModal] = useState<{
    isOpen: boolean, servidorId: string, servidorNome: string, categoria: RowCategory,
    day: number, turnoCodigo: string, horasComputadas: number, valor: string, ancorado: boolean
  }>({ isOpen: false, servidorId: '', servidorNome: '', categoria: 'Plantão', day: 0, turnoCodigo: '', horasComputadas: 0, valor: '', ancorado: false })

  // Troca de turno em dia que JÁ TEM PONTO — o caso da dobra: a servidora estava no Plantão T,
  // o plantonista seguinte não compareceu e o coordenador a convocou a emendar a noite (T → TN).
  // Trocar o turno reescreve o previsto contra o qual aquele ponto é julgado, então o motivo é
  // obrigatório e vira histórico + justificativa do evento (aparece no relatório de plantão).
  // A regra é do BANCO: trg_registrar_troca_turno recusa o UPDATE sem justificativa.
  const [trocaTurnoModal, setTrocaTurnoModal] = useState<{
    isOpen: boolean, servidorId: string, servidorNome: string, escalaMensalId: string,
    categoria: RowCategory, day: number, turnoNovoId: string,
    codigoAnterior: string, codigoNovo: string, texto: string, salvando: boolean
  }>({ isOpen: false, servidorId: '', servidorNome: '', escalaMensalId: '', categoria: 'Plantão', day: 0, turnoNovoId: '', codigoAnterior: '', codigoNovo: '', texto: '', salvando: false })

  const [alertModal, setAlertModal] = useState<{ 
    isOpen: boolean
    title: string
    message: string
    type: 'default' | 'danger' | 'success' | 'warning'
    action?: {
      label: string
      onClick: () => void
    }
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'default'
  })
  const [confirmModal, setConfirmModal] = useState<{ 
    isOpen: boolean, 
    title: string, 
    message: string, 
    onConfirm: () => void,
    type: 'default' | 'danger' | 'warning' | 'success'
  } | null>(null)
  
  const [logsTentativas, setLogsTentativas] = useState<any[]>([])
  const [marcacoesPendentes, setMarcacoesPendentes] = useState<any[]>([])

  // Alvo do AlterarJornadaModal. Preenchido quando alguem troca a jornada de um servidor que
  // ja tem ponto registrado no mes; null significa "nenhuma troca pendente de decisao".
  const [jornadaModalAlvo, setJornadaModalAlvo] = useState<AlterarJornadaAlvo | null>(null)

  const [manualPresenceModal, setManualPresenceModal] = useState<{
    isOpen: boolean;
    servidorId: string;
    servidorNome: string;
    dia: number;
    categoria: RowCategory;
    tipo: 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida' | 'completo' | 'periodo_1' | 'periodo_2';
    escalaMensalId: string;
    isReverting: boolean;
    justificativa?: string;
    // Horários informados pelo servidor, em HH:MM. NÃO vêm pré-preenchidos de propósito:
    // herdar o horário da jornada é a "marcação automática por horário contratual" vedada pela
    // Portaria 671/2021, e respondia por ~25% das entradas e saídas da folha.
    horarios?: { entrada?: string; intervalo_saida?: string; intervalo_retorno?: string; saida?: string };
    // Batidas REAIS escolhidas pelo coordenador, por passo. Atribuição 1:1 — uma batida serve um
    // passo, um passo aceita um horário. Selecionado ganha de digitado: o horário real preserva
    // segundos, origem `terminal` e o vínculo com a marcação, que digitar perderia.
    selecoes?: Partial<Record<PassoPresenca, SelecaoBatida>>;
  } | null>(null)

  const [bulkServerModal, setBulkServerModal] = useState<{
    isOpen: boolean;
    servidorId: string;
    servidorNome: string;
    escalaMensalId: string;
    startDay: number;
    endDay: number;
    modo: 'completo' | 'periodo_1' | 'periodo_2';
    categorias: RowCategory[];
    justificativa: string;
  } | null>(null)

  const [bulkGlobalModal, setBulkGlobalModal] = useState<{
    isOpen: boolean;
    selectedServidorIds: string[];
    startDay: number;
    endDay: number;
    modo: 'completo' | 'periodo_1' | 'periodo_2' | 'autorizado';
    categorias: RowCategory[];
    justificativa: string;
  } | null>(null)

  // Autorizações do RH para validação coletiva (27/08/2026), por servidor desta grade.
  //
  // Quem decide o que pode ser declarado é o banco (fn_atestar_passos_autorizados_bulk); isto
  // aqui é só para a tela saber se oferece o modo e com qual texto — se a tela derivasse a regra
  // por conta própria, prometeria o que o banco recusa.
  const [autorizacoesPonto, setAutorizacoesPonto] = useState<Record<string, any>>({})

  const [sobreavisoManualModal, setSobreavisoManualModal] = useState<{
    isOpen: boolean;
    logId: string;
    servidorNome: string;
    dia: number;
    justificativa: string;
  } | null>(null)

  const [sobreavisoHistoryModal, setSobreavisoHistoryModal] = useState<{
    isOpen: boolean
    servidorId: string
    servidorNome: string
    dia: number
    escalaMensalId: string
    turnoId: string
  } | null>(null)

  /**
   * Janela do plantão de sobreaviso aberto no modal de histórico.
   *
   * ⚠️ Vem de `fn_janela_sobreaviso_dia`, a MESMA função que `fn_acionar_sobreaviso` consulta
   * para autorizar a gravação — nunca de heurística por prefixo de código. É essa igualdade que
   * faz o botão prometer exatamente o que o banco aceita; duas contas para a mesma pergunta já
   * divergiram uma vez neste projeto (Fase 8 do plano de sobreaviso).
   *
   * `dentro` nulo = ainda carregando. Enquanto não se sabe, o acionamento não é oferecido.
   */
  const [janelaSobreaviso, setJanelaSobreaviso] = useState<{
    carregando: boolean
    inicio: string | null
    fim: string | null
    dentro: boolean | null
  }>({ carregando: false, inicio: null, fim: null, dentro: null })

  useEffect(() => {
    if (!sobreavisoHistoryModal) {
      setJanelaSobreaviso({ carregando: false, inicio: null, fim: null, dentro: null })
      return
    }

    let cancelado = false
    setJanelaSobreaviso({ carregando: true, inicio: null, fim: null, dentro: null })

    ;(async () => {
      // fn_janela_sobreaviso_dia recebe a LINHA de escala_diaria, não (escala_mensal, dia) — a
      // janela depende do turno lançado naquele dia, e é ele que a linha carrega.
      const { data: linha } = await supabase
        .from('escala_diaria')
        .select('id')
        .eq('escala_mensal_id', sobreavisoHistoryModal.escalaMensalId)
        .eq('dia', sobreavisoHistoryModal.dia)
        .eq('categoria', 'Sobreaviso')
        .maybeSingle()

      if (cancelado) return
      if (!linha?.id) {
        setJanelaSobreaviso({ carregando: false, inicio: null, fim: null, dentro: false })
        return
      }

      const { data: janela } = await supabase.rpc('fn_janela_sobreaviso_dia', { p_escala_diaria_id: linha.id })
      if (cancelado) return

      const j = Array.isArray(janela) ? janela[0] : janela
      if (!j?.inicio || !j?.fim) {
        // Sem janela conhecida o acionamento seria recusado no banco de qualquer forma.
        setJanelaSobreaviso({ carregando: false, inicio: null, fim: null, dentro: false })
        return
      }

      const agora = Date.now()
      setJanelaSobreaviso({
        carregando: false,
        inicio: j.inicio,
        fim: j.fim,
        dentro: agora >= Date.parse(j.inicio) && agora < Date.parse(j.fim),
      })
    })()

    return () => { cancelado = true }
  }, [sobreavisoHistoryModal, supabase])

  const [externalOccupancy, setExternalOccupancy] = useState<any[]>([])

  /**
   * Carga do servidor em TODAS as escalas da competência (`fn_carga_mensal_servidor`), indexada
   * por servidor_id — inclusive a escala desta grade, que `avaliarCarga` descarta em favor do
   * total local. Ver src/utils/limiteCargaMensal.ts.
   */
  const [cargaMensal, setCargaMensal] = useState<Record<string, CargaEscala[]>>({})
  /** Teto efetivo por servidor (`fn_teto_carga_servidor`): global + Autorização Extraordinária. */
  const [tetoCarga, setTetoCarga] = useState<Record<string, TetoServidor>>({})

  // Template Modal State
  const [templateModal, setTemplateModal] = useState<{
    isOpen: boolean
    servidorId: string
    templateType: TemplateType
    turnoId: string
    startDay: number
    startWorking: boolean
    validatePastDays?: boolean
  } | null>(null)

  // Intelligent Generator Modal State
  const [intelligentModal, setIntelligentModal] = useState<{
    isOpen: boolean
    respectContinuity: boolean
    respectEvents: boolean
    respectPreferences: boolean
    /** Quais linhas da grade gerar. Extra e Sobreaviso entram desligadas — ver LIMIAR_CONFIANCA. */
    categorias: RowCategory[]
    /** Meses de histórico ponderados por recência (1..3). */
    mesesHistorico: number
    /** 1 = só a competência aberta. 2+ grava as seguintes como Rascunho. */
    quantidadeMeses: number
  } | null>(null)

  // WhatsApp Sending State para Sobreaviso
  const [waSending, setWaSending] = useState(false)
  const [waError, setWaError] = useState('')
  const [waFallbackUrl, setWaFallbackUrl] = useState('')

  const fetchOccupancy = useCallback(async (servidorIds: string[]) => {
    if (servidorIds.length === 0) return
    const { data, error } = await supabase.rpc('fn_get_monthly_occupancy', {
      p_servidor_ids: servidorIds,
      p_mes: mes,
      p_ano: ano
    })
    if (data) setExternalOccupancy(data)
    if (error) console.error('Erro ao buscar ocupação externa:', error)
  }, [supabase, mes, ano])

  /**
   * A carga do servidor nas OUTRAS escalas do mês e o teto efetivo dele.
   *
   * ⚠️ Sem isto, o teto de 300h era conferido só contra o `gridData` DESTA grade — servidor em
   * dois setores tinha duas contas dentro do teto e uma soma fora dele (JEANE, 09/2026: 289h no
   * ACOLHIMENTO + 120h na LAVANDERIA = 409h, com as duas telas mostrando um número válido).
   * As duas RPCs recebem a lista inteira de servidores de uma vez: uma chamada por linha da
   * grade seria dezenas de requisições a cada carregamento.
   */
  const fetchCargaMensal = useCallback(async (
    servidorIds: string[]
  ): Promise<{ cargas: Record<string, CargaEscala[]>; tetos: Record<string, TetoServidor> }> => {
    const vazio = { cargas: {} as Record<string, CargaEscala[]>, tetos: {} as Record<string, TetoServidor> }
    const ids = Array.from(new Set(servidorIds.filter(Boolean)))
    if (ids.length === 0) return vazio

    const [{ data: cargas, error: errCarga }, { data: tetos, error: errTeto }] = await Promise.all([
      supabase.rpc('fn_carga_mensal_servidor', { p_servidor_ids: ids, p_mes: mes, p_ano: ano }),
      supabase.rpc('fn_teto_carga_servidor', { p_servidor_ids: ids, p_mes: mes, p_ano: ano })
    ])

    if (errCarga) console.error('Erro ao buscar a carga mensal consolidada:', errCarga)
    if (errTeto) console.error('Erro ao buscar o teto mensal do servidor:', errTeto)

    const porCarga: Record<string, CargaEscala[]> = {}
    ;((cargas as any[]) || []).forEach(c => {
      (porCarga[c.servidor_id] = porCarga[c.servidor_id] || []).push(c as CargaEscala)
    })
    const porTeto: Record<string, TetoServidor> = {}
    ;((tetos as any[]) || []).forEach(t => { porTeto[t.servidor_id] = t as TetoServidor })

    if (cargas) setCargaMensal(porCarga)
    if (tetos) setTetoCarga(porTeto)

    // Devolvido além de guardado no estado: quem acabou de adicionar um servidor precisa do
    // dado AGORA para avisar "esta pessoa já tem 289h em outro setor", e o setState só chega
    // no próximo render.
    return { cargas: porCarga, tetos: porTeto }
  }, [supabase, mes, ano])

  useEffect(() => {
    if (escalaMensal.length > 0) {
      const ids = escalaMensal.map(em => em.servidor_id)
      fetchOccupancy(ids)
      fetchCargaMensal(ids)
    }
  }, [escalaMensal, fetchOccupancy, fetchCargaMensal])

  useEffect(() => {
    const fetchData = async () => {
      // Fetch all units and sectors for external server logic
      const { data: units } = await supabase.from('unidades').select('*').eq('ativo', true).order('nome')
      const { data: sectorsRaw } = await supabase.from('setores').select('*, dicionario_setores(nome)').eq('ativo', true)
      const sectors = sectorsRaw?.map(s => ({
        ...s,
        nome: (s as any).dicionario_setores?.nome || 'SETOR SEM NOME'
      })) || []
      const { data: journeys } = await supabase.from('jornadas').select('*').order('nome')
      if (units) setAllUnidades(units)
      setAllSetores(sectors)
      if (journeys) setJornadas(journeys)

      // Fetch specific sector info for dimensioning rules
      const { data: currentSec } = await supabase.from('setores').select('*').eq('id', setorId).single()
      if (currentSec) setCurrentSector(currentSec)
    }
    fetchData()
  }, [supabase, setorId])

  /**
   * O setor da grade com o nome em CAMINHO COMPLETO ("SHL \ BLOCO A"), só para o cabeçalho do
   * PDF: "BLOCO A — HMI" não diz de qual dos "BLOCO A" da unidade a folha impressa é.
   *
   * `allSetores` continua com o nome curto de propósito — quem consome a lista é o modal de
   * Servidor Externo, que usa `formatSectorsHierarchy` (árvore com "↳"), e somar caminho ao
   * recuo mostraria a hierarquia duas vezes.
   *
   * ⚠️ `allSetores` vem filtrado por `ativo = true`: setor cujo pai foi desativado cai no
   * fallback e imprime só a folha, como antes. Nunca fica sem nome.
   */
  const setorAtualComCaminho = useMemo(() => {
    const atual = allSetores.find(s => s.id === setorId)
    if (!atual) return atual
    return { ...atual, nome: buildSectorPathMap(allSetores).get(setorId) || atual.nome }
  }, [allSetores, setorId])

  // Fetch sectors when unit changes in modal
  useEffect(() => {
    if (externalData.unidadeId) {
      // Em arvore (pai seguido dos filhos, com recuo "↳"), mesmo criterio das demais telas:
      // ha setores com o MESMO nome em ramos diferentes da mesma unidade, e a lista plana nao
      // dizia qual era qual -- quem escolhia o setor de origem do servidor externo escolhia as
      // cegas. Ver `formatSectorsHierarchy` em `src/utils/sectors.ts`.
      const filtered = formatSectorsHierarchy(
        allSetores.filter(s => s.unidade_id === externalData.unidadeId)
      )
      setExternalSectors(filtered)
      setExternalData(prev => ({ ...prev, setorId: '', servidorId: '' }))
    }
  }, [externalData.unidadeId, allSetores])

  // Fetch servers when sector changes in modal
  useEffect(() => {
    const fetchExtServers = async () => {
      if (externalData.setorId) {
        const { data } = await supabase
          .rpc('get_external_servers_for_scale', { p_setor_id: externalData.setorId })
        setExternalServers(data || [])
        setExternalData(prev => ({ ...prev, servidorId: '' }))
        setExternalEncontrado(null)
      }
    }
    fetchExtServers()
  }, [externalData.setorId, supabase])

  /**
   * A última resposta crua de `fn_buscar_servidor_para_escala`, para recuperar a LOTAÇÃO da
   * pessoa escolhida — o combobox devolve só a opção (id + rótulo), e o modal precisa exibir de
   * onde ela veio.
   */
  const externalAchadosRef = useRef<any[]>([])

  /**
   * Busca por nome/matrícula em toda a rede (31/08/2026).
   *
   * ⚠️ **Não dá para trocar isto por uma consulta a `servidores` pelo cliente.** A RLS da tabela
   * mostra a um coordenador só o próprio escopo, e servidor externo é, por definição, de fora
   * dele — a lista viria vazia justamente para os casos que este campo existe para resolver.
   * Quem atravessa a RLS é a RPC `SECURITY DEFINER`, que em troca é bounded (3 caracteres,
   * LIMIT 30) e nunca devolve a base inteira.
   */
  const buscarServidorExterno = useCallback(async (termo: string): Promise<OpcaoRemota[]> => {
    const { data, error } = await supabase.rpc('fn_buscar_servidor_para_escala', { p_termo: termo })
    if (error) throw new Error(error.message)
    externalAchadosRef.current = data || []
    return (data || []).map((s: any) => {
      const jaNaGrade = escalaMensal.some(em => em.servidor_id === s.id)
      const lotacao = [s.unidade_nome, s.setor_caminho].filter(Boolean).join(' / ')
      return {
        value: s.id,
        label: s.matricula ? `${s.nome} (${s.matricula})` : s.nome,
        detalhe: [lotacao, s.cargo].filter(Boolean).join(' · ') || undefined,
        // Já escalado aqui continua VISÍVEL, só não selecionável: sumir da lista faria quem
        // procura concluir que a pessoa não existe, em vez de que ela já está na grade.
        disabled: jaNaGrade,
        motivoDesabilitado: jaNaGrade ? 'Já está nesta escala' : undefined,
      }
    })
  }, [supabase, escalaMensal])
  
  // Realtime subscription for logs_sobreaviso
  useEffect(() => {
    const channel = supabase
      .channel('logs_sobreaviso_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'logs_sobreaviso'
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setLogsSobreaviso((prev: any[]) => [...prev, payload.new])
        } else if (payload.eventType === 'UPDATE') {
          setLogsSobreaviso((prev: any[]) => prev.map(log => 
            log.id === payload.new.id ? payload.new : log
          ))
        } else if (payload.eventType === 'DELETE') {
          setLogsSobreaviso((prev: any[]) => prev.filter(log => log.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  // Realtime subscription for escala_diaria (presence updates)
  useEffect(() => {
    const channel = supabase
      .channel('escala_diaria_presence')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'escala_diaria'
      }, (payload) => {
        // Find which server/category/day this belongs to
        const ed = payload.new as any
        const em = escalaMensal.find(x => x.id === ed.escala_mensal_id)
        if (em) {
          setPresenceData(prev => ({
            ...prev,
            [em.servidor_id]: {
              ...prev[em.servidor_id],
              [ed.categoria as RowCategory]: {
                ...(prev[em.servidor_id]?.[ed.categoria as RowCategory] || {}),
                [ed.dia]: {
                  entrada: !!ed.presenca_entrada_em,
                  intervalo_saida: !!ed.presenca_intervalo_saida_em,
                  intervalo_retorno: !!ed.presenca_intervalo_retorno_em,
                  saida: !!ed.presenca_saida_em,
                  entrada_em: ed.presenca_entrada_em || null,
                  intervalo_saida_em: ed.presenca_intervalo_saida_em || null,
                  intervalo_retorno_em: ed.presenca_intervalo_retorno_em || null,
                  saida_em: ed.presenca_saida_em || null,
                  is_entrada_manual: ed.presenca_entrada_manual !== undefined ? !!ed.presenca_entrada_manual : !!ed.confirmado_por_id,
                  is_intervalo_saida_manual: !!ed.presenca_intervalo_saida_manual,
                  is_intervalo_retorno_manual: !!ed.presenca_intervalo_retorno_manual,
                  is_saida_manual: ed.presenca_saida_manual !== undefined ? !!ed.presenca_saida_manual : !!ed.confirmado_por_id
                }
              }
            }
          }))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, escalaMensal])
  
  // State structured by Servidor -> Categoria -> Dia -> TurnoId
  const [gridData, setGridData] = useState<Record<string, Record<RowCategory, Record<number, string>>>>(() => {
    const initial: Record<string, Record<RowCategory, Record<number, string>>> = {}
    escalaMensalInicial.forEach(em => {
      initial[em.servidor_id] = {
        'Regular': {},
        'Extra': {},
        'Plantão': {},
        'Sobreaviso': {}
      }
      const dailies = escalaDiariaInicial.filter(ed => ed.escala_mensal_id === em.id)
      dailies.forEach(ed => {
        const cat = (ed.categoria || 'Regular') as RowCategory
        initial[em.servidor_id][cat][ed.dia] = ed.dicionario_turnos_id
      })
    })
    return initial
  })

  // Hora de início informada pelo coordenador (escala_diaria.hora_inicio_prevista).
  // Só existe para os turnos de "duração livre" — aqueles em que o código do turno diz a
  // duração e o período, mas não a hora (T4, N4, N6, M7...). Ver a migration 20260808110000
  // e docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md.
  // Guardado como 'HH:00' (hora cheia — o motor de blocos trabalha em horas inteiras e há
  // CHECK no banco impedindo minutos).
  const [gridHoras, setGridHoras] = useState<Record<string, Record<RowCategory, Record<number, string>>>>(() => {
    const initial: Record<string, Record<RowCategory, Record<number, string>>> = {}
    escalaMensalInicial.forEach(em => {
      initial[em.servidor_id] = { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
      escalaDiariaInicial
        .filter(ed => ed.escala_mensal_id === em.id && ed.hora_inicio_prevista)
        .forEach(ed => {
          const cat = (ed.categoria || 'Regular') as RowCategory
          initial[em.servidor_id][cat][ed.dia] = String(ed.hora_inicio_prevista).slice(0, 5)
        })
    })
    return initial
  })

  // Foto do que ja esta gravado. Comeca nula e e preenchida no mount (o primeiro render ainda
  // nao tem os dados normalizados), entao "sem alteracao" e o estado inicial seguro.
  const [assinaturaSalva, setAssinaturaSalva] = useState<string | null>(null)

  const assinaturaAtual = useMemo(() => assinaturaDaGrade(gridData, gridHoras), [gridData, gridHoras])

  useEffect(() => {
    setAssinaturaSalva(assinaturaDaGrade(gridData, gridHoras))
    // So no mount: daqui em diante quem atualiza a foto e o "Salvar Previsao".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Ha lancamento na tela que ainda nao foi gravado. */
  const gradeAlterada = assinaturaSalva !== null && assinaturaAtual !== assinaturaSalva


  const [presenceData, setPresenceData] = useState<Record<string, Record<RowCategory, Record<number, { entrada: boolean, intervalo_saida: boolean, intervalo_retorno: boolean, saida: boolean, entrada_em?: string | null, intervalo_saida_em?: string | null, intervalo_retorno_em?: string | null, saida_em?: string | null, is_entrada_manual?: boolean, is_intervalo_saida_manual?: boolean, is_intervalo_retorno_manual?: boolean, is_saida_manual?: boolean }>>>>(() => {
    const initial: Record<string, Record<RowCategory, Record<number, { entrada: boolean, intervalo_saida: boolean, intervalo_retorno: boolean, saida: boolean, entrada_em?: string | null, intervalo_saida_em?: string | null, intervalo_retorno_em?: string | null, saida_em?: string | null, is_entrada_manual?: boolean, is_intervalo_saida_manual?: boolean, is_intervalo_retorno_manual?: boolean, is_saida_manual?: boolean }>>> = {}
    escalaMensalInicial.forEach(em => {
      initial[em.servidor_id] = {
        'Regular': {},
        'Extra': {},
        'Plantão': {},
        'Sobreaviso': {}
      }
      const dailies = escalaDiariaInicial.filter(ed => ed.escala_mensal_id === em.id)
      dailies.forEach(ed => {
        const cat = (ed.categoria || 'Regular') as RowCategory
        initial[em.servidor_id][cat][ed.dia] = {
          entrada: !!ed.presenca_entrada_em,
          intervalo_saida: !!ed.presenca_intervalo_saida_em,
          intervalo_retorno: !!ed.presenca_intervalo_retorno_em,
          saida: !!ed.presenca_saida_em,
          entrada_em: ed.presenca_entrada_em || null,
          intervalo_saida_em: ed.presenca_intervalo_saida_em || null,
          intervalo_retorno_em: ed.presenca_intervalo_retorno_em || null,
          saida_em: ed.presenca_saida_em || null,
          is_entrada_manual: ed.presenca_entrada_manual !== undefined ? !!ed.presenca_entrada_manual : !!ed.confirmado_por_id,
          is_intervalo_saida_manual: !!ed.presenca_intervalo_saida_manual,
          is_intervalo_retorno_manual: !!ed.presenca_intervalo_retorno_manual,
          is_saida_manual: ed.presenca_saida_manual !== undefined ? !!ed.presenca_saida_manual : !!ed.confirmado_por_id
        }
      })
    })
    return initial
  })

  const daysInMonth = useMemo(() => new Date(ano, mes, 0).getDate(), [mes, ano])
  const daysArray = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  const getPastDaysCount = useCallback(() => {
    const today = new Date()
    const currentDay = today.getDate()
    const currentMonth = today.getMonth() + 1
    const currentYear = today.getFullYear()
    const nMes = Number(mes)
    const nAno = Number(ano)

    if (nAno < currentYear || (nAno === currentYear && nMes < currentMonth)) {
      return daysInMonth
    } else if (nAno === currentYear && nMes === currentMonth) {
      return currentDay - 1
    }
    return 0
  }, [mes, ano, daysInMonth])

  const getShiftStartHour = useCallback((codigo: string, horasComputadas?: number): number => {
    const c = codigo.toUpperCase().trim()
    // Família M?N (MN, M2N...M8N): a noite emenda na manhã seguinte, então começa às 19h
    // igual ao N — o trecho "manhã" é a continuação a partir das 07h. Precisa vir ANTES do
    // startsWith('M'), senão M2N cairia em 07h. Espelha a âncora gravada em
    // dicionario_turnos.horario_inicio por 20260808100000; se as duas divergirem, a grade
    // desenha um turno e o terminal cobra outro. MTN não entra (tem T e é 07h-07h).
    if (/^M[0-9]*N$/.test(c)) return 19
    // Família T?N (TN, T2N...T8N): a tarde vem ANTES da noite, que termina sempre às 07:00 do
    // dia seguinte — então início = 31 − duração (TN 18h→13:00, T2N 14h→17:00, T8N 20h→11:00).
    // Precisa vir ANTES do startsWith('T'), senão T2N cairia em 13:00 contra a âncora de 17:00.
    // Espelha dicionario_turnos.horario_inicio gravado em 20260808130000. MT4N não casa
    // (tem M e T) e não é ancorado.
    if (/^T[0-9]*N$/.test(c) && horasComputadas) return 31 - horasComputadas
    if (c.startsWith('M') || c === 'MT' || c === 'MTN') return 7
    if (c.startsWith('T')) return 13
    if (c.startsWith('N')) return 19
    // Intermediário = 11:00-15:00, o turno que cobre o vale entre a manhã e a tarde.
    // Único horário em que I (4h), M4I (manhã 4h + interm.) e IT4 (interm. + tarde 4h) fecham
    // contíguos. Precisa vir antes do includes('T'), senão IT4 cairia em 13:00 contra a âncora
    // de 11:00. M4I começa com M e já resolve em 07:00 acima. Ver 20260808130000.
    if (c.startsWith('I')) return 11
    if (c.includes('M')) return 7
    if (c.includes('T')) return 13
    if (c.includes('N')) return 19
    const match = c.match(/^([0-9]+)\s*H\s*(?:AS|ÀS|A)\s*([0-9]+)\s*H/)
    if (match) {
      return parseInt(match[1], 10)
    }
    return 7
  }, [])

  const getShiftEndHour = useCallback((codigo: string, horasComputadas?: number): number => {
    const c = codigo.toUpperCase().trim()
    if (c === 'MTN') return 31
    if (c === 'MT') return 19
    // Família M?N: 19h + duração. MN 19->13h(+1), M2N 19->09h(+1), M4N 19->11h(+1).
    // Substitui o antigo `MN -> 31`, que assumia início às 07h. Ver 20260808100000.
    if (/^M[0-9]*N$/.test(c)) return 19 + (horasComputadas ?? 18)
    // Família T?N inteira termina às 07:00 do dia seguinte (=31), não só o TN.
    // Substitui o antigo `TN -> 31`, que deixava T2N..T8N caírem no cálculo genérico.
    if (/^T[0-9]*N$/.test(c)) return 31
    if (c === 'N' || c === 'N12') return 31
    
    const match = c.match(/^([0-9]+)\s*H\s*(?:AS|ÀS|A)\s*([0-9]+)\s*H/)
    if (match) {
      let end = parseInt(match[2], 10)
      const start = parseInt(match[1], 10)
      if (end < start) end += 24
      return end
    }

    if (horasComputadas) {
      const start = getShiftStartHour(c, horasComputadas)
      return start + horasComputadas
    }
    if (c === 'M' || c.startsWith('M')) return 13
    if (c === 'T' || c.startsWith('T')) return 19
    return 19
  }, [getShiftStartHour])

  // FONTE ÚNICA DE HORÁRIO PREVISTO (Fase 3).
  //
  // A previsão que a grade desenha passa a vir de fn_blocos_previstos_mes, que é um LATERAL
  // sobre a MESMA fn_blocos_previstos_dia que o terminal usa. Antes a grade re-derivava o
  // horário com regras próprias e discordava do terminal — num dia de Regular M (08H-14H) +
  // Plantão T, a grade previa 13:00 e o terminal exigia 14:00.
  //
  // Mapa: escala_diaria_id -> bloco previsto (já com fusão de blocos e intervalo aplicados).
  // Enquanto não carrega, ou para célula ainda não salva no banco, cai no cálculo local.
  const [blocosPrevistos, setBlocosPrevistos] = useState<Map<string, any>>(new Map())
  // Bumpado quando a grade altera o previsto de um dia direto no banco (troca de turno com
  // justificativa), para o mapa não ficar desenhando a janela do turno antigo.
  const [previsaoVersao, setPrevisaoVersao] = useState(0)

  useEffect(() => {
    const ids = escalaMensal.map(e => e.id).filter(Boolean)
    if (ids.length === 0) { setBlocosPrevistos(new Map()); return }
    let cancelado = false
    ;(async () => {
      const { data, error } = await supabase.rpc('fn_blocos_previstos_mes', { p_escala_mensal_ids: ids })
      if (cancelado) return
      if (error || !Array.isArray(data)) {
        // Silencioso de propósito: sem a RPC a grade continua funcionando com o cálculo
        // local. Perde-se a garantia de igualdade com o terminal, não a tela.
        console.warn('fn_blocos_previstos_mes indisponível, usando cálculo local:', error?.message)
        return
      }
      const m = new Map<string, any>()
      for (const b of data) {
        for (const edId of (b.escala_diaria_ids || [])) m.set(edId, b)
      }
      setBlocosPrevistos(m)
    })()
    return () => { cancelado = true }
  }, [supabase, escalaMensal, previsaoVersao])

  // (servidor, categoria, dia) -> escala_diaria_id, para achar o bloco da célula.
  // Só cobre o que está salvo no banco; célula recém-lançada ainda não tem id.
  const edIdPorCelula = useMemo(() => {
    const m = new Map<string, string>()
    const emPorId = new Map(escalaMensal.map(e => [e.id, e]))
    for (const ed of escalaDiariaInicial) {
      const em = emPorId.get(ed.escala_mensal_id)
      if (!em) continue
      m.set(`${em.servidor_id}|${ed.categoria}|${ed.dia}`, ed.id)
    }
    return m
  }, [escalaDiariaInicial, escalaMensal])

  const blocoDaCelula = useCallback((servidorId?: string, cat?: string, day?: number) => {
    if (!servidorId || !cat || !day) return null
    const edId = edIdPorCelula.get(`${servidorId}|${cat}|${day}`)
    if (!edId) return null
    return blocosPrevistos.get(edId) || null
  }, [edIdPorCelula, blocosPrevistos])

  // Este dia termina no dia seguinte?
  //
  // A resposta vem do PREVISTO do bloco (fn_blocos_previstos_mes, a mesma fonte que o terminal
  // cobra): inicio e fim em dias civis diferentes. Quando o previsto ainda nao chegou — ou a
  // celula acabou de ser lancada e nem tem escala_diaria_id —, cai no codigo do turno pelo mesmo
  // getShiftEndHour que a grade ja usa para desenhar (> 24 = vira o dia).
  //
  // ⚠️ NUNCA deduzir isso do horario digitado. Era o que produzia o remendo `mSai > 360`, que
  // aceitava saida ate as 06:00 e recusava as 07:00 de um plantao `N`.
  const celulaCruzaMeiaNoite = useCallback((servidorId?: string, cat?: string, day?: number) => {
    const bloco = blocoDaCelula(servidorId, cat, day)
    const ini = bloco?.inicio_previsto
    const fim = bloco?.fim_previsto
    if (ini && fim) {
      const dIni = dataISOLocal(ini)
      const dFim = dataISOLocal(fim)
      if (dIni && dFim) return dIni !== dFim
    }
    const em = escalaMensal.find(e => e.servidor_id === servidorId)
    const turnoId = day && cat ? em?.dias?.[day]?.[cat] : undefined
    const turno = turnos.find(t => t.id === turnoId)
    if (!turno?.codigo) return false
    return getShiftEndHour(turno.codigo, Number(turno.horas_computadas)) > 24
  }, [blocoDaCelula, escalaMensal, turnos, getShiftEndHour])

  // O previsto DESTA linha dentro do bloco, quando o bloco funde mais de um turno.
  //
  // A fusão (armadilha 6) junta Regular 08:00–14:00 + Plantão T4 14:00–18:00 num bloco só
  // 08:00–18:00. Indexar a previsão por escala_diaria_id devolve o BLOCO para as duas linhas,
  // então a linha do Plantão passava a exibir o horário do EXPEDIENTE — 08:00 em vez das 14:00
  // que o coordenador informou em hora_inicio_prevista. Caso real: IRIZAN SILVA, 26/08/2026.
  //
  // turnos_inicio/turnos_fim vêm de fn_blocos_previstos_dia (20260819200000) na MESMA ordem de
  // escala_diaria_ids, e chegam à grade desde 20260826000000. Nada é derivado aqui: é o mesmo
  // previsto que o terminal usa para os slots de fronteira, escolhido por posição.
  //
  // Só entrada e saída. O intervalo continua sendo o do bloco — um bloco carrega UM intervalo
  // (v_b1_int_ini), não existe intervalo por turno fundido.
  const previstoDaLinhaNoBloco = useCallback((
    bloco: any,
    tipo: 'entrada' | 'saida',
    servidorId?: string,
    cat?: string,
    day?: number
  ): string | null => {
    if (!bloco || !servidorId || !cat || !day) return null
    const edId = edIdPorCelula.get(`${servidorId}|${cat}|${day}`)
    if (!edId || !Array.isArray(bloco.escala_diaria_ids)) return null
    const idx = bloco.escala_diaria_ids.indexOf(edId)
    if (idx < 0) return null
    const arr = tipo === 'entrada' ? bloco.turnos_inicio : bloco.turnos_fim
    // Bundle novo contra banco sem a migration: cai no horário do bloco, como antes.
    if (!Array.isArray(arr) || arr.length !== bloco.escala_diaria_ids.length) return null
    return arr[idx] || null
  }, [edIdPorCelula])

  // Um turno é "ancorado" quando o próprio código determina a hora — o banco diz isso em
  // dicionario_turnos.horario_inicio (M, T, N, MT e a família M?N, gravados em 20260808100000).
  // Os demais são de duração livre: o código dá duração e período, e só quem escala sabe a hora.
  // Ler do dicionário em vez de manter uma lista aqui é o que impede a grade de divergir do
  // terminal quando alguém ancorar um código novo.
  const isTurnoAncorado = useCallback((turnoId?: string | null) => {
    if (!turnoId) return true
    return !!turnos.find(t => t.id === turnoId)?.horario_inicio
  }, [turnos])

  // O turno EXIGE hora: o código não a determina, então sem informar ninguém sabe quando começa.
  // É esse caso que abre o modal sozinho ao escalar.
  const precisaHoraInicio = useCallback((categoria: RowCategory, turnoId?: string | null) => {
    if (!turnoId) return false
    // Regular tem a hora no nome da jornada; Sobreaviso não marca presença (CLAUDE.md armadilha 6).
    if (categoria === 'Regular' || categoria === 'Sobreaviso') return false
    return !isTurnoAncorado(turnoId)
  }, [isTurnoAncorado])

  // O turno ACEITA hora: o coordenador pode sobrepor até o que o código ancora. É o nível 1 da
  // cadeia de precedência, que vence todos os outros — inclusive a âncora do dicionário e a
  // âncora espelho da jornada noturna. Serve para a exceção que nenhuma regra prevê; o banco já
  // aceitava (só chk_hora_prevista_nao_regular barra), era a grade que não deixava informar.
  const permiteHoraInicio = useCallback((categoria: RowCategory, turnoId?: string | null) => {
    if (!turnoId) return false
    if (categoria === 'Regular' || categoria === 'Sobreaviso') return false
    return true
  }, [])

  // Sugestão por encadeamento: o turno de duração livre normalmente emenda no fim do que já
  // existe no dia, na ordem Regular -> Extra -> Plantão. É o caso relatado em 08/08/2026:
  // "regular de 8h às 18h, 2h extras, e um plantão N4 que estende até as 24h" -> sugere 20:00.
  // É só sugestão: fica editável, e o valor gravado é o que o coordenador confirmar.
  const sugerirHoraInicio = useCallback((servidorId: string, day: number, categoria: RowCategory): string => {
    const serverRows = gridData[servidorId] || {}
    let fim: number | null = null

    const regularId = serverRows['Regular']?.[day]
    if (regularId) {
      const emRecord = escalaMensal.find(e => e.servidor_id === servidorId)
      const jornada = emRecord?.jornada_id ? jornadas.find(j => j.id === emRecord.jornada_id) : null
      const m = jornada?.nome?.match(/(?:ÀS|AS|A)\s*([0-9]+)/i)
      if (m) fim = parseInt(m[1], 10)
      else {
        const t = turnos.find(x => x.id === regularId)
        if (t) fim = getShiftEndHour(t.codigo, Number(t.horas_computadas))
      }
    }

    // Extra empurra o fim para frente (é extensão do expediente, não turno paralelo).
    const extraId = serverRows['Extra']?.[day]
    if (extraId && categoria !== 'Extra' && fim !== null) {
      const t = turnos.find(x => x.id === extraId)
      if (t?.horas_computadas) fim += Number(t.horas_computadas)
    }

    if (fim === null) return ''
    return `${String(fim % 24).padStart(2, '0')}:00`
  }, [gridData, escalaMensal, jornadas, turnos, getShiftEndHour])

  // Motor de Compliance: validação de interjornada e DSR
  const complianceViolations = useMemo(() => {
    if (!gridData || escalaMensal.length === 0) return [] as ComplianceViolation[]
    // A jornada entra no motor porque quem tem jornada noturna ("18H ÀS 06H") tem o turno
    // diurno ancorado no FIM dela, não no início — mesma regra do nível 2-A do banco.
    const jornadaPorServidor = Object.fromEntries(
      escalaMensal.map(em => [em.servidor_id, jornadas.find(j => j.id === em.jornada_id)?.nome])
    )
    return runComplianceCheck(
      gridData,
      turnos,
      escalaMensal.map(em => em.servidor_id),
      daysInMonth,
      jornadaPorServidor
    )
  }, [gridData, turnos, escalaMensal, daysInMonth, jornadas])

  const complianceCount = complianceViolations.length

  const getStatusForDay = useCallback((day: number, emId: string, categoria?: string) => {
    const logs = logsSobreaviso.filter(l => 
      l.escala_mensal_id === emId && 
      l.dia === day && 
      (!categoria || l.categoria === categoria || (categoria === 'Sobreaviso' && !l.categoria))
    )
    if (logs.length === 0) return { status: null, reason: null, log: null }

    // A derivacao vive em src/utils/sobreaviso/statusAcionamento.ts, espelho de
    // fn_status_acionamento_sobreaviso. Esta era uma das QUATRO copias, e a unica que usava
    // `else if` entre os dois prazos - um log 'Aceito' nunca chegava a ser testado pelo prazo
    // de aceite, entao ela divergia das outras tres em silencio.
    for (const log of logs) {
      const s = statusAcionamento(log, configs)
      if (s.falhou && s.estado !== 'recusado') {
        return { status: 'Falhou', reason: s.motivo || 'Tempo expirado', log }
      }
    }

    const pending = logs.find(l => l.status === 'Aceito' || l.status === 'Aguardando')
    if (pending) return { status: pending.status, reason: null, log: pending }

    const last = logs[logs.length - 1]
    return { status: last.status, reason: null, log: last }
  }, [logsSobreaviso, configs])

  const maxValidDay = useMemo(() => {
    const today = new Date()
    const currentYear = today.getFullYear()
    const currentMonth = today.getMonth() + 1
    const currentDayNum = today.getDate()

    if (ano < currentYear || (ano === currentYear && mes < currentMonth)) {
      return daysInMonth
    }
    if (ano === currentYear && mes === currentMonth) {
      return Math.min(daysInMonth, currentDayNum)
    }
    return 0
  }, [ano, mes, daysInMonth])

  const shiftTotals = useMemo(() => {
    const totals = {
      M: {} as Record<number, number>,
      T: {} as Record<number, number>,
      N: {} as Record<number, number>,
      S: {} as Record<number, number>
    }

    daysArray.forEach(day => {
      let countM = 0
      let countT = 0
      let countN = 0
      let countS = 0
      
      escalaMensal.forEach(em => {
        let hasM = false
        let hasT = false
        let hasN = false
        let hasS = false

        const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']
        
        categories.forEach(cat => {
           const turnoId = gridData[em.servidor_id]?.[cat]?.[day]
           const turno = turnos.find(t => t.id === turnoId)
           if (turno && turno.codigo) {
             const code = turno.codigo.toUpperCase()
             if (code.includes('M')) hasM = true
             if (code.includes('T')) hasT = true
             if (code.includes('N')) hasN = true
           }
        })

        const turnoIdS = gridData[em.servidor_id]?.['Sobreaviso']?.[day]
        if (turnoIdS) {
          hasS = true
        }

        if (hasM) countM++
        if (hasT) countT++
        if (hasN) countN++
        if (hasS) countS++
      })
      
      totals.M[day] = countM
      totals.T[day] = countT
      totals.N[day] = countN
      totals.S[day] = countS
    })
    
    return totals
  }, [daysArray, escalaMensal, gridData, turnos, getStatusForDay])

  const getShiftTotalStyleAndTooltip = useCallback((count: number, shift: 'M' | 'T' | 'N', day: number) => {
    if (!currentSector) return { className: '', title: '' }

    const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    const d = new Date(ano, mes - 1, day)
    const isWE = d.getDay() === 0 || d.getDay() === 6
    const isHoliday = feriados.some(f => f.data === dateStr)
    const isWeekendOrHoliday = isWE || isHoliday

    const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

    if (isWeekendOrHoliday && !applyOnFdsFeriados) {
      return { className: '', title: 'Dimensionamento ignorado em finais de semana/feriados neste setor' }
    }

    let min = null
    let ideal = null
    let max = null

    if (shift === 'M') {
      min = currentSector.servidores_manha_min
      ideal = currentSector.servidores_manha_ideal
      max = currentSector.servidores_manha_max
    } else if (shift === 'T') {
      min = currentSector.servidores_tarde_min
      ideal = currentSector.servidores_tarde_ideal
      max = currentSector.servidores_tarde_max
    } else if (shift === 'N') {
      min = currentSector.servidores_noite_min
      ideal = currentSector.servidores_noite_ideal
      max = currentSector.servidores_noite_max
    }

    if (ideal === null || ideal === 0) return { className: '', title: '' }

    const safeMin = min ?? 0
    const safeMax = max ?? 0

    if (count < safeMin) {
      return { 
        className: 'bg-red-100 text-red-700 dark:bg-red-950/45 dark:text-red-300 border-red-350 dark:border-red-900', 
        title: `Desfalque crítico: ${count} de ${ideal} ideal (Mínimo: ${safeMin})` 
      }
    } else if (count >= safeMin && count < ideal) {
      return { 
        className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-350 dark:border-amber-900', 
        title: `Abaixo do ideal: ${count} de ${ideal} ideal (Mínimo: ${safeMin})` 
      }
    } else if (safeMax > 0 && count > safeMax) {
      return { 
        className: 'bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400 border-purple-350 dark:border-purple-900', 
        title: `Excesso de servidores: ${count} de ${ideal} ideal (Máximo: ${safeMax})` 
      }
    } else {
      return { 
        className: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-green-350 dark:border-green-900', 
        title: `Dimensionamento ideal: ${count} servidores` 
      }
    }
  }, [currentSector, ano, mes, feriados])

  const hasConfirmedPresence = useCallback((servidorId: string, escalaMensalId: string) => {
    const presenceForServer = presenceData[servidorId]
    if (presenceForServer) {
      const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']
      for (const cat of categories) {
        const days = presenceForServer[cat]
        if (days) {
          const hasPresence = Object.values(days).some(p => p.entrada || p.saida)
          if (hasPresence) return true
        }
      }
    }

    const hasOnCallArrival = logsSobreaviso.some(l => 
      l.escala_mensal_id === escalaMensalId && 
      l.status === 'Chegou' &&
      (l.categoria === 'Sobreaviso' || !l.categoria)
    )
    return hasOnCallArrival
  }, [presenceData, logsSobreaviso])

  // Autorizações do RH que alcançam ESTE mês. Uma vigência que cobre qualquer parte do mês já
  // conta: o banco confere dia a dia depois, e o dia exato é decidido lá, não aqui.
  useEffect(() => {
    const servidorIds = escalaMensal.map(em => em.servidor_id).filter(Boolean)
    if (servidorIds.length === 0) { setAutorizacoesPonto({}); return }

    const primeiroDia = `${ano}-${String(mes).padStart(2, '0')}-01`
    const ultimoDia = `${ano}-${String(mes).padStart(2, '0')}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`

    let vivo = true
    supabase
      .from('autorizacoes_ponto_coletivo')
      .select('id, servidor_id, passos, documento, motivo, vigencia_inicio, vigencia_fim')
      .in('servidor_id', servidorIds)
      .is('revogado_em', null)
      .lte('vigencia_inicio', ultimoDia)
      .gte('vigencia_fim', primeiroDia)
      .then(({ data }) => {
        if (!vivo) return
        const mapa: Record<string, any> = {}
        ;(data || []).forEach((a: any) => { mapa[a.servidor_id] = a })
        setAutorizacoesPonto(mapa)
      })

    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escalaMensal, mes, ano])

  /**
   * Dias do mes em que este servidor ja tem entrada ou saida registrada, em qualquer categoria
   * de trabalho presencial. Sobreaviso fica de fora: nao marca presenca e tem ciclo proprio.
   *
   * Usado para decidir se trocar a jornada precisa passar pelo AlterarJornadaModal — e para
   * mostrar ali quantos dias ja trabalhados seriam reavaliados pela troca.
   */
  const diasComBatidaDoServidor = useCallback((servidorId: string): number[] => {
    const presenceForServer = presenceData[servidorId]
    if (!presenceForServer) return []
    const dias = new Set<number>()
    for (const cat of ['Regular', 'Extra', 'Plantão'] as RowCategory[]) {
      const days = presenceForServer[cat]
      if (!days) continue
      for (const [dia, p] of Object.entries(days)) {
        if (p?.entrada || p?.saida) dias.add(parseInt(dia))
      }
    }
    return [...dias].sort((a, b) => a - b)
  }, [presenceData])

  const hasPresenceForDay = useCallback((servidorId: string, escalaMensalId: string, categoria: RowCategory, day: number) => {
    // Check regular presence
    const presence = presenceData[servidorId]?.[categoria]?.[day]
    if (presence?.entrada || presence?.saida) return true

    // Check on-call status for that specific day
    if (categoria === 'Sobreaviso') {
      const { status } = getStatusForDay(day, escalaMensalId, 'Sobreaviso')
      if (status === 'Chegou') return true
    }

    return false
  }, [presenceData, getStatusForDay])

  const handleClearScale = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Limpar Escala',
      message: 'Deseja limpar os lançamentos desta escala? Servidores com presença confirmada serão preservados para proteger seus registros.',
      type: 'danger',
      onConfirm: () => {
        setGridData(prev => {
          const newData = { ...prev }
          // Só limpar servidores que NÃO possuem presença
          for (const sId in newData) {
            const em = escalaMensal.find(x => x.servidor_id === sId)
            if (em && !hasConfirmedPresence(sId, em.id)) {
              delete newData[sId]
            }
          }
          return newData
        })
        logAction('LIMPAR_ESCALA', { info: 'Lançamentos removidos (preservando presenças)' })
        setAlertModal({
          isOpen: true,
          title: 'Escala Ajustada',
          message: 'Lançamentos removidos. Servidores com registros de presença foram mantidos por segurança.',
          type: 'success'
        })
        setConfirmModal(null)
      }
    })
  }

  /** Fecha o modal de Servidor Externo sem deixar seleção pendurada para a próxima abertura. */
  const fecharModalExterno = () => {
    setIsExternalModalOpen(false)
    setExternalData({ unidadeId: '', setorId: '', servidorId: '' })
    setExternalEncontrado(null)
  }

  const handleAddExternalServer = async () => {
    if (!externalData.servidorId) return

    // Check if already in grid
    if (escalaMensal.some(em => em.servidor_id === externalData.servidorId)) {
      setAlertModal({
        isOpen: true,
        title: 'Servidor já Adicionado',
        message: 'Este servidor já está inserido nesta escala.',
        type: 'warning'
      })
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('escala_mensal')
        .insert({
          unidade_id: unidadeId,
          setor_id: setorId,
          servidor_id: externalData.servidorId,
          mes,
          ano,
          status: 'Rascunho',
          jornada_id: jornadas.find(j => j.nome === '07H ÀS 19H')?.id
        })
        .select('*, servidores(*)')
        .single()

      if (error) throw error

      setEscalaMensal(prev => [...prev, data])
      logAction('ADICIONAR_SERVIDOR_EXTERNO', { 
        servidor_id: externalData.servidorId,
        nome: data.servidores?.nome 
      })
      fecharModalExterno()

      // Servidor Externo é o caso onde a carga em outra escala é mais provável — ele vem de
      // outra lotação, e a escala de origem dele é justamente a que esta grade não mostra.
      const { cargas, tetos } = await fetchCargaMensal(
        [...escalaMensal.map(em => em.servidor_id), externalData.servidorId]
      )
      const nome = data.servidores?.nome || 'Servidor'
      const aviso = avisoAoAdicionar(nome, cargas[externalData.servidorId], tetos[externalData.servidorId])

      setAlertModal({
        isOpen: true,
        title: aviso ? 'Adicionado — atenção à carga do mês' : 'Sucesso',
        message: aviso
          ? `Servidor externo adicionado à grade.\n\n${aviso}`
          : 'Servidor externo adicionado à grade!',
        type: aviso ? 'warning' : 'success'
      })
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Adicionar',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveServer = async (escalaMensalId: string, servidorId: string) => {
    const em = escalaMensal.find(x => x.servidor_id === servidorId)
    if (em && hasConfirmedPresence(servidorId, em.id)) {
      setAlertModal({
        isOpen: true,
        title: 'Direito Adquirido',
        message: 'Este servidor já possui registros de presença validados ou sobreavisos concluídos. Por questões de integridade e direitos adquiridos, ele não pode ser removido da escala.',
        type: 'warning'
      })
      return
    }

    if (isCompetenciaEncerrada || escalaMensal[0]?.status === 'Fechada' || (isClosed && !podeEditarForaDoPrazo(userProfile?.role))) return
    
    setConfirmModal({
      isOpen: true,
      title: 'Remover Servidor',
      message: 'Deseja remover este servidor e todos os seus lançamentos desta escala?',
      type: 'danger',
      onConfirm: async () => {
        setLoading(true)
        try {
          // Delete daily records first
          await supabase.from('escala_diaria').delete().eq('escala_mensal_id', escalaMensalId)
          
          // Delete monthly record
          const { error } = await supabase.from('escala_mensal').delete().eq('id', escalaMensalId)

          if (error) throw error

          // Update local state
          const servidorRemovido = escalaMensal.find(em => em.id === escalaMensalId)
          logAction('REMOVER_SERVIDOR_DA_ESCALA', { 
            escala_mensal_id: escalaMensalId, 
            servidor_id: servidorId,
            nome: servidorRemovido?.servidores?.nome
          })
          setEscalaMensal(prev => prev.filter(em => em.id !== escalaMensalId))
          setGridData(prev => {
            const newData = { ...prev }
            delete newData[servidorId]
            return newData
          })
          setAlertModal({
            isOpen: true,
            title: 'Removido',
            message: 'Servidor removido com sucesso.',
            type: 'success'
          })
        } catch (error: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro ao Remover',
            message: error.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const getDayOfWeek = (day: number) => {
    return new Date(ano, mes - 1, day).getDay()
  }

  const handleCellChange = async (servidorId: string, categoria: RowCategory, day: number, turnoId: string) => {
    // REGRA DE DIREITO ADQUIRIDO: Se existe presença confirmada para o dia/categoria, não permite apagar o turno
    const emRecord = escalaMensal.find(x => x.servidor_id === servidorId)
    if (!turnoId) {
      if (emRecord) {
        const hasPresence = hasPresenceForDay(servidorId, emRecord.id, categoria, day)
        if (hasPresence) {
          setAlertModal({
            isOpen: true,
            title: 'Direito Adquirido',
            message: 'Não é possível remover o turno de um dia que já possui registro de presença ou sobreaviso concluído.',
            type: 'warning'
          })
          return
        }
      }

      // Impedir a remoção de Regular/Plantão se houver Extra cadastrado no mesmo dia
      if (categoria === 'Regular' || categoria === 'Plantão') {
        const serverRows = gridData[servidorId] || {}
        const hasExtra = !!serverRows['Extra']?.[day]
        if (hasExtra) {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Remoção Impedida',
            message: 'Não é possível remover o plantão ou escala regular de um dia no qual há horas extras cadastradas. Remova primeiro a hora extra.',
            type: 'warning'
          })
          return
        }
      }
    }

    // Se estiver limpando a célula, atualiza direto
    if (!turnoId) {
      setGridData(prev => ({
        ...prev,
        [servidorId]: {
          ...prev[servidorId],
          [categoria]: {
            ...prev[servidorId][categoria],
            [day]: turnoId
          }
        }
      }))
      return
    }

    // Validação de Afastamento / Evento — mesma regra do trigger do banco
    // (fn_prevent_shift_during_event), pelo helper compartilhado src/utils/afastamentos.ts.
    // Antes esta checagem ignorava os slots do turno e o afastamento por horas: recusava
    // o que o banco aceita (declaração de comparecimento de 2h bloqueava o dia inteiro) e,
    // do outro lado, deixava passar Sobreaviso quando a config de governança estava ligada.
    const turnoDigitado = turnos.find(t => t.id === turnoId)
    const afastamentoBloqueante = getAfastamentoBloqueante(servidorId, day, categoria, turnoDigitado?.slots || [])
    if (afastamentoBloqueante) {
      setAlertModal({
        isOpen: true,
        title: '⚠️ Servidor Afastado',
        message: `Este servidor está afastado (${afastamentoBloqueante.tipos_eventos?.nome || 'Afastamento'}) no dia ${day}${afastamentoBloqueante.slots && afastamentoBloqueante.slots.length > 0 ? ` no período ${afastamentoBloqueante.slots.join(', ')}` : ''} e não pode receber nenhum lançamento nesta linha.`,
        type: 'warning'
      })
      return
    }

    // Validação de Conflito Interno (Checa mudanças não salvas na grade atual)
    try {
      const currentTurno = turnos.find(t => t.id === turnoId)
      
      // Valitações de Governança para Horas Extras e Sobreavisos
      if (categoria === 'Extra' && currentTurno) {
        if (currentTurno.tipo !== 'Extra') {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Turno Inválido',
            message: 'Apenas turnos do tipo Extra podem ser inseridos na linha de Extras.',
            type: 'warning'
          })
          return
        }
        if (Number(currentTurno.horas_computadas) > 2) {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Limite Legal Excedido',
            message: 'O limite legal permitido para horas extras é de no máximo 2 horas diárias por servidor.',
            type: 'warning'
          })
          return
        }
        // Hora extra é extensão do expediente REGULAR, nunca do plantão — que já tem duração e
        // pagamento próprios (PL12/PL6/PL4, armadilha 16). Decisão do usuário, 01/09/2026: um
        // dia só com Plantão não habilita Extra, mesmo que o servidor esteja trabalhando nele.
        const serverRows = gridData[servidorId] || {}
        const hasRegular = !!serverRows['Regular']?.[day]
        if (!hasRegular) {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Servidor Não Escalado',
            message: 'Não é possível inserir horas extras em um dia no qual o servidor não está escalado no turno Regular. Hora extra é extensão do expediente regular — plantão não conta para isso.',
            type: 'warning'
          })
          return
        }
      }

      if (categoria === 'Sobreaviso' && currentTurno) {
        if (currentTurno.tipo !== 'Sobreaviso') {
          setAlertModal({
            isOpen: true,
            title: '⚠️ Turno Inválido',
            message: 'Apenas turnos do tipo Sobreaviso podem ser inseridos na linha de Sobreaviso.',
            type: 'warning'
          })
          return
        }
      }

      const currentSlots = currentTurno?.slots || []
      const serverRows = gridData[servidorId] || {}
      
      let internalConflictMsg = null
      Object.entries(serverRows).forEach(([cat, days]: [string, any]) => {
        if (cat === categoria) return
        const otherTurnoId = days[day]
        if (!otherTurnoId) return
        
        const otherTurno = turnos.find(t => t.id === otherTurnoId)
        const otherSlots = otherTurno?.slots || []
        
        if (otherSlots.some((s: string) => currentSlots.includes(s))) {
          internalConflictMsg = `Este servidor já possui um turno (${otherTurno.codigo}) na linha de ${cat} para este dia nesta escala.`
        }
      })

      if (internalConflictMsg) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Conflito Interno Detectado',
          message: internalConflictMsg,
          type: 'warning'
        })
        return
      }
    } catch (err) {
      console.error('Erro na validação interna:', err)
    }

    // Validação de Conflito Externo (Cross-Unit/Cross-Sector via Banco)
    //
    // p_escala_mensal_id diz à RPC QUAL célula está sendo editada. Sem ele a função busca
    // conflito em todas as linhas do servidor naquele dia — inclusive a própria célula — e
    // trocar um código já salvo por outro que compartilhe qualquer slot conflitava com ele
    // mesmo (medido em 21/08/2026: MT -> MT devolvia conflito). Junto com o Direito Adquirido,
    // que impede apagar célula com presença, isso congelava o dia que já tinha ponto: não dava
    // para apagar nem para trocar — nem para lançar a dobra de plantão (T -> TN).
    // Ver 20260821100000_conflict_check_ignores_own_cell.sql.
    try {
      const { data, error } = await supabase.rpc('fn_check_shift_conflicts', {
        p_servidor_id: servidorId,
        p_dia: day,
        p_mes: mes,
        p_ano: ano,
        p_turno_id: turnoId,
        p_categoria: categoria,
        p_escala_mensal_id: emRecord?.id || null
      })

      if (error) throw error

      if (data && data.length > 0 && data[0].conflito) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Conflito de Escala Detectado',
          message: data[0].mensagem,
          type: 'warning'
        })
        return // Bloqueia a alteração
      }
    } catch (err) {
      console.error('Erro na validação de conflito:', err)
    }

    // Validação de Dimensionamento Máximo (Regra Rígida)
    const regraDimensionamento = configs['escala_regra_dimensionamento'] || 'flexivel'
    if (regraDimensionamento === 'rigida' && currentSector) {
      const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
      const d = new Date(ano, mes - 1, day)
      const isWE = d.getDay() === 0 || d.getDay() === 6
      const isHoliday = feriados.some(f => f.data === dateStr)
      const isWeekendOrHoliday = isWE || isHoliday
      const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

      if (!isWeekendOrHoliday || applyOnFdsFeriados) {
        const targetTurno = turnos.find(t => t.id === turnoId)
        if (targetTurno && targetTurno.codigo) {
          const code = targetTurno.codigo.toUpperCase()
          const isM = code.includes('M')
          const isT = code.includes('T')
          const isN = code.includes('N')

          let simulatedCountM = 0
          let simulatedCountT = 0
          let simulatedCountN = 0

          escalaMensal.forEach(em => {
            let hasM = false
            let hasT = false
            let hasN = false

            const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão']
            categories.forEach(cat => {
              let cellTurnoId = gridData[em.servidor_id]?.[cat]?.[day]
              if (em.servidor_id === servidorId && cat === categoria) {
                cellTurnoId = turnoId
              }

              const cellTurno = turnos.find(t => t.id === cellTurnoId)
              if (cellTurno && cellTurno.codigo) {
                const cCode = cellTurno.codigo.toUpperCase()
                if (cCode.includes('M')) hasM = true
                if (cCode.includes('T')) hasT = true
                if (cCode.includes('N')) hasN = true
              }
            })

            if (hasM) simulatedCountM++
            if (hasT) simulatedCountT++
            if (hasN) simulatedCountN++
          })

          if (isM && currentSector.servidores_manha_max > 0 && simulatedCountM > currentSector.servidores_manha_max) {
            setAlertModal({
              isOpen: true,
              title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
              message: `O limite máximo para o turno da MANHÃ é de ${currentSector.servidores_manha_max} servidores. Esta ação elevaria o total para ${simulatedCountM} servidores no dia ${day}.`,
              type: 'warning'
            })
            return
          }

          if (isT && currentSector.servidores_tarde_max > 0 && simulatedCountT > currentSector.servidores_tarde_max) {
            setAlertModal({
              isOpen: true,
              title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
              message: `O limite máximo para o turno da TARDE é de ${currentSector.servidores_tarde_max} servidores. Esta ação elevaria o total para ${simulatedCountT} servidores no dia ${day}.`,
              type: 'warning'
            })
            return
          }

          if (isN && currentSector.servidores_noite_max > 0 && simulatedCountN > currentSector.servidores_noite_max) {
            setAlertModal({
              isOpen: true,
              title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
              message: `O limite máximo para o turno da NOITE é de ${currentSector.servidores_noite_max} servidores. Esta ação elevaria o total para ${simulatedCountN} servidores no dia ${day}.`,
              type: 'warning'
            })
            return
          }
        }
      }
    }

    // Teto mensal de horas e sobreavisos — consolidado entre TODAS as escalas do servidor.
    //
    // ⚠️ A conta era só a desta grade (`calculateTotals`), e o teto sempre foi da PESSOA. Servidor
    // escalado em dois setores tinha duas contas dentro do teto e uma soma fora dele. Ver
    // src/utils/limiteCargaMensal.ts e a migration 20260828120000.
    if (turnoId) {
      const totals = calculateTotals(servidorId)
      let simulatedHoras = totals.totalPlanejado
      let simulatedSobreavisos = totals.p_soQtd

      const currentTurnoId = gridData[servidorId]?.[categoria]?.[day]
      if (categoria === 'Sobreaviso') {
        if (!currentTurnoId) simulatedSobreavisos += 1
      } else {
        const newTurno = turnos.find(t => t.id === turnoId)
        const currTurno = turnos.find(t => t.id === currentTurnoId)
        const newH = newTurno ? Number(newTurno.horas_computadas) || 0 : 0
        const currH = currTurno ? Number(currTurno.horas_computadas) || 0 : 0
        simulatedHoras = simulatedHoras - currH + newH
      }

      const avaliacao = avaliarCargaDoServidor(servidorId, simulatedHoras, simulatedSobreavisos)

      if (avaliacao.excede) {
        const servidor = todosServidoresSetor.find(s => s.id === servidorId)
        const servidorNome = servidor?.nome || 'Servidor'
        // O texto lista as outras escalas: sem dizer ONDE estão as horas, quem lança não tem
        // como decidir nada — o número dele continua parecendo certo.
        const detalhe = descreverExcesso(avaliacao, servidorNome)
        // Quem decide de fato é o banco (`fn_pode_autorizar_excecao_carga`, avaliada dentro da
        // policy de escrita); aqui se decide só O QUE OFERECER. Ver src/utils/autorizacaoCarga.ts.
        const aviso = mensagemTetoExcedido(detalhe, userProfile?.role, pedidosPendentes[servidorId])

        if (aviso.acao === 'autorizar' && !pedidosPendentes[servidorId]) {
          setConfirmModal({
            isOpen: true,
            title: aviso.titulo,
            message: aviso.mensagem,
            type: 'warning',
            onConfirm: () => {
              setAutorizacaoModalState({
                isOpen: true,
                servidorId,
                servidorNome,
                horasAtuais: totals.totalPlanejado,
                sobreavisosAtuais: totals.p_soQtd
              })
            }
          })
        } else if (aviso.acao === 'solicitar' && !pedidosPendentes[servidorId]) {
          setConfirmModal({
            isOpen: true,
            title: aviso.titulo,
            message: aviso.mensagem,
            type: 'warning',
            onConfirm: () => {
              setSolicitacaoModalState({
                isOpen: true,
                servidorId,
                servidorNome,
                horasAtuais: totals.totalPlanejado,
                sobreavisosAtuais: totals.p_soQtd
              })
            }
          })
        } else {
          setAlertModal({
            isOpen: true,
            title: aviso.titulo,
            message: aviso.mensagem,
            type: 'warning'
          })
        }
        return
      }
    }

    // Dia que JÁ TEM PONTO não troca de turno em silêncio: exige justificativa, que vira
    // histórico (escala_diaria_turno_historico) e entra na justificativa do evento daquele dia,
    // que é o que o relatório de plantão imprime. É o caso da dobra (Plantão T → TN).
    // O banco recusa o UPDATE sem justificativa (trg_registrar_troca_turno); a tela existe para
    // coletar o texto e usar a RPC que sabe carregá-lo, em vez de deixar o "Salvar Previsão"
    // morrer em lote com a exceção crua do Postgres. Ver 20260821110000.
    const turnoAtualCelula = gridData[servidorId]?.[categoria]?.[day]
    if (emRecord && turnoAtualCelula && turnoAtualCelula !== turnoId &&
        hasPresenceForDay(servidorId, emRecord.id, categoria, day)) {
      const servidor = todosServidoresSetor.find(s => s.id === servidorId)
      setTrocaTurnoModal({
        isOpen: true,
        servidorId,
        servidorNome: servidor?.nome || '',
        escalaMensalId: emRecord.id,
        categoria,
        day,
        turnoNovoId: turnoId,
        codigoAnterior: turnos.find(t => t.id === turnoAtualCelula)?.codigo || '',
        codigoNovo: turnos.find(t => t.id === turnoId)?.codigo || '',
        texto: '',
        salvando: false
      })
      return
    }

    // Turno de duração livre: o código não determina a hora, então pergunta ao coordenador.
    // A sugestão vem do encadeamento com o que já existe no dia; ele pode alterar.
    if (precisaHoraInicio(categoria, turnoId)) {
      const t = turnos.find(x => x.id === turnoId)
      const servidor = todosServidoresSetor.find(s => s.id === servidorId)
      setHoraModal({
        isOpen: true,
        servidorId,
        servidorNome: servidor?.nome || '',
        categoria,
        day,
        turnoCodigo: t?.codigo || '',
        horasComputadas: Number(t?.horas_computadas) || 0,
        ancorado: false,
        valor: gridHoras[servidorId]?.[categoria]?.[day] || sugerirHoraInicio(servidorId, day, categoria)
      })
    } else {
      // Turno ancorado (ou célula limpa): a hora vem do dicionário, então descarta qualquer
      // hora que tenha ficado de um turno anterior nesta célula — senão viraria dado órfão
      // que o banco recusaria ou que ninguém entenderia depois.
      setGridHoras(prev => {
        if (!prev[servidorId]?.[categoria]?.[day]) return prev
        const catData = { ...prev[servidorId][categoria] }
        delete catData[day]
        return { ...prev, [servidorId]: { ...prev[servidorId], [categoria]: catData } }
      })
    }

    setGridData(prev => {
      const serverData = prev[servidorId] || {
        'Regular': {},
        'Extra': {},
        'Plantão': {},
        'Sobreaviso': {}
      }
      const catData = serverData[categoria] || {}

      return {
        ...prev,
        [servidorId]: {
          ...serverData,
          [categoria]: {
            ...catData,
            [day]: turnoId
          }
        }
      }
    })
  }

  // Aplica a troca de turno de um dia que já tem ponto. Vai direto ao banco pela RPC, sem
  // esperar o "Salvar Previsão": a justificativa e a troca precisam ser a MESMA transação — é a
  // RPC que publica o texto para a trigger que grava o histórico. Depois disso a grade e o banco
  // ficam com o mesmo valor, então o "Salvar Previsão" seguinte reenvia o mesmo turno e o
  // IS NOT DISTINCT FROM da trigger sai na hora, sem histórico duplicado.
  const confirmarTrocaTurno = async () => {
    const m = trocaTurnoModal
    if (m.texto.trim().length < 10) return

    setTrocaTurnoModal(prev => ({ ...prev, salvando: true }))
    try {
      const { error } = await supabase.rpc('fn_alterar_turno_escala_diaria', {
        p_escala_mensal_id: m.escalaMensalId,
        p_dia: m.day,
        p_categoria: m.categoria,
        p_dicionario_turnos_id: m.turnoNovoId,
        p_justificativa: m.texto.trim()
      })
      if (error) throw error

      setGridData(prev => {
        const serverData = prev[m.servidorId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
        return {
          ...prev,
          [m.servidorId]: {
            ...serverData,
            [m.categoria]: { ...(serverData[m.categoria] || {}), [m.day]: m.turnoNovoId }
          }
        }
      })
      // O previsto daquele dia mudou; recarrega fn_blocos_previstos_mes para a grade não
      // continuar desenhando a janela do turno antigo.
      setPrevisaoVersao(v => v + 1)
      setTrocaTurnoModal(prev => ({ ...prev, isOpen: false, salvando: false }))
      setAlertModal({
        isOpen: true,
        title: 'Turno Alterado',
        message: `${m.servidorNome} — dia ${m.day}: ${m.codigoAnterior} → ${m.codigoNovo}.\n\nA alteração já está salva no banco, com a justificativa no histórico e no relatório de ${m.categoria}. As marcações de ponto do dia foram preservadas.`,
        type: 'success'
      })
    } catch (err: any) {
      setTrocaTurnoModal(prev => ({ ...prev, salvando: false }))
      setAlertModal({
        isOpen: true,
        title: 'Não foi possível alterar o turno',
        message: err?.message || 'Erro desconhecido ao alterar o turno.',
        type: 'danger'
      })
    }
  }

  /**
   * @param override  grade hipotética do servidor, para SIMULAR o efeito de um lançamento antes
   *                  de escrevê-lo (Aplicar Template, Gerador Inteligente). Sem ele, usa a grade
   *                  viva. Existe para a checagem de teto não ter que reimplementar a fórmula de
   *                  horas — inclusive o teto líquido da jornada, que é fácil de esquecer.
   */
  const calculateTotals = (
    servidorId: string,
    override?: Record<RowCategory, Record<number, string>>
  ) => {
    const serverData = override || gridData[servidorId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
    
    // Contadores para o Total Validado (Respeita as regras de presença)
    let v_ch = 0, v_he100 = 0, v_he50 = 0, v_pl12 = 0, v_pl6 = 0, v_pl4 = 0, v_so12 = 0
    // Contadores para o Total Planejado (Cálculo bruto da grade)
    let p_ch = 0, p_he100 = 0, p_he50 = 0, p_pl12 = 0, p_pl6 = 0, p_pl4 = 0, p_so12 = 0
    // Horas de plantão que não formam unidade de pagamento (ex.: a 7ª hora de um M7). Entram no
    // total — nenhuma hora se perde — mas em coluna nenhuma: PL6 arredondado para cima seria
    // pagar plantão que não houve. Em produção isso é 1 lançamento em 636 (medido em 21/08/2026).
    let v_plAvulso = 0, p_plAvulso = 0

    const exigirPresenca = configs['exigir_confirmacao_presenca'] === 'true'
    const today = new Date()
    const currentDay = today.getDate()
    const currentMonth = today.getMonth() + 1
    const currentYear = today.getFullYear()

    // Ensure numeric comparison
    const nMes = Number(mes)
    const nAno = Number(ano)

    const emRecord = escalaMensal.find(x => x.servidor_id === servidorId)
    const jornada = jornadas.find(j => j.id === emRecord?.jornada_id)
    const intervaloHoras = (jornada?.intervalo_minutos || 0) / 60

    // Sum Regular CH
    Object.entries(serverData['Regular']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = parseInt(day)
        const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
        const presence = presenceData[servidorId]?.['Regular']?.[d]
        
        const shiftHours = Number(t.horas_computadas)
        let liquidHours = shiftHours

        if (jornada && Number(jornada.horas_totais) > 0) {
          const journeyMaxLiquid = Math.max(0, Number(jornada.horas_totais) - intervaloHoras)
          // Se o turno for reduzido (ex: M4=4h), usa as 4h.
          // Se o turno for normal/longo (ex: MT=12h), limita ao teto da jornada (ex: 8h).
          liquidHours = Math.min(shiftHours, journeyMaxLiquid)
        }
        
        p_ch += liquidHours
        const isValidated = (isPast && !exigirPresenca) || presence?.entrada
        if (isValidated) {
          v_ch += liquidHours
        }
      }
    })

    // Sum Extras
    Object.entries(serverData['Extra']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = parseInt(day)
        const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
        const presence = presenceData[servidorId]?.['Extra']?.[d]
        
        const dateObj = new Date(nAno, nMes - 1, d)
        const isNightShift = t.codigo.toUpperCase().includes('N')
        const isWE = dateObj.getDay() === 0 || dateObj.getDay() === 6
        const dateStr = `${nAno}-${nMes.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
        const isHoliday = feriados.some(f => f.data === dateStr)
        const horas = Number(t.horas_computadas)

        // REGRA: Toda hora extra noturna (qualquer turno com 'N') é 100%
        const isValidated = (isPast && !exigirPresenca) || presence?.entrada
        if (isNightShift || isWE || isHoliday) {
          p_he100 += horas
          if (isValidated) v_he100 += horas
        } else {
          p_he50 += horas
          if (isValidated) v_he50 += horas
        }
      }
    })

    // Sum Plantões
    //
    // Um plantão vale as UNIDADES DE PAGAMENTO que ele contém, não a faixa em que a duração
    // total cai. `MTN` (24h) é 2×PL12, `TN` (18h) é PL6 + PL12 — por isso não existe coluna
    // PL24 nem PL18. A regra inteira mora em src/utils/plantaoUnidades.ts; não replicar aqui.
    //
    // A conta anterior classificava o código inteiro por faixa e multiplicava pela FAIXA:
    // 44 dos 53 códigos do dicionário contavam errado (MTN valia 12h em vez de 24, TN valia 12
    // em vez de 18, e N1 de 1h valia 4h). O total da grade discordava de todos os relatórios,
    // que já somavam horas_computadas direto.
    Object.entries(serverData['Plantão']).forEach(([day, turnoId]) => {
      const t = turnos.find(x => x.id === turnoId)
      if (t) {
        const d = parseInt(day)
        const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
        const presence = presenceData[servidorId]?.['Plantão']?.[d]
        const dec = decomporPlantao(t.codigo, Number(t.horas_computadas))

        p_pl12 += dec.pl12
        p_pl6 += dec.pl6
        p_pl4 += dec.pl4
        p_plAvulso += dec.horasAvulsas

        const isValidated = (isPast && !exigirPresenca) || presence?.entrada
        if (isValidated) {
          v_pl12 += dec.pl12
          v_pl6 += dec.pl6
          v_pl4 += dec.pl4
          v_plAvulso += dec.horasAvulsas
        }
      }
    })

    // Sum Sobreavisos (Computado em Unidades com detalhamento por tipo/código)
    const overData = (serverData as any)['Sobreaviso'] || (serverData as any)['sobreaviso'] || {}
    const p_sobreaviso_breakdown: Record<string, { codigo: string; descricao: string; count: number }> = {}
    const v_sobreaviso_breakdown: Record<string, { codigo: string; descricao: string; count: number }> = {}
    let p_so_qtd = 0
    let v_so_qtd = 0

    Object.entries(overData).forEach(([day, turnoId]) => {
      const d = parseInt(day)
      const t = turnos.find(x => x.id === turnoId)
      if (!t) return

      const isPast = nAno < currentYear || (nAno === currentYear && nMes < currentMonth) || (nAno === currentYear && nMes === currentMonth && d < currentDay)
      const pServ = presenceData[servidorId] as any
      const presence = (pServ?.['Sobreaviso'] || pServ?.['sobreaviso'])?.[d]

      const code = t.codigo?.toUpperCase().trim() || 'SOB'
      const desc = t.descricao || code

      // Incrementa a contagem de unidades
      p_so_qtd += 1
      if (!p_sobreaviso_breakdown[code]) {
        p_sobreaviso_breakdown[code] = { codigo: code, descricao: desc, count: 0 }
      }
      p_sobreaviso_breakdown[code].count += 1

      if (isPast || presence?.entrada) {
        v_so_qtd += 1
        if (!v_sobreaviso_breakdown[code]) {
          v_sobreaviso_breakdown[code] = { codigo: code, descricao: desc, count: 0 }
        }
        v_sobreaviso_breakdown[code].count += 1
      }
    })

    // O Sobreaviso NÃO entra no cálculo do total de horas (totalValidado e totalPlanejado)
    // As unidades já somam as horas do plantão; `plAvulso` é só o resto que não virou unidade.
    // Somando os dois, o total é exatamente a soma de horas_computadas — que é o que o relatório
    // de RH, o consolidado e o de plantão/sobreaviso sempre mostraram.
    const totalValidado = v_ch + v_he100 + v_he50 + (v_pl12 * 12) + (v_pl6 * 6) + (v_pl4 * 4) + v_plAvulso
    const totalPlanejado = p_ch + p_he100 + p_he50 + (p_pl12 * 12) + (p_pl6 * 6) + (p_pl4 * 4) + p_plAvulso

    return { 
      chTotal: v_ch, he100: v_he100, he50: v_he50, pl12: v_pl12, pl6: v_pl6, pl4: v_pl4, 
      so12: v_so_qtd,
      p_so12: p_so_qtd,
      soQtd: v_so_qtd,
      p_soQtd: p_so_qtd,
      p_sobreaviso_breakdown,
      v_sobreaviso_breakdown,
      p_ch, p_he100, p_he50, p_pl12, p_pl6, p_pl4,
      totalGeral: totalValidado,
      totalPlanejado
    }
  }

  /**
   * A carga do servidor no MÊS INTEIRO — esta grade mais todas as outras escalas dele na
   * competência — contra o teto efetivo dele.
   *
   * ⚠️ Fonte única da checagem de teto na tela. Os quatro caminhos que escrevem na grade
   * (célula, Aplicar Template, Gerador Inteligente e a barreira do "Salvar Previsão") passam
   * por aqui. Até 28/08/2026 só a digitação célula a célula conferia qualquer coisa, e ainda
   * assim contra o `gridData` deste setor — é a armadilha 14/23 num terceiro eixo.
   *
   * `horasLocais`/`sobreavisosLocais` omitidos = usa o total da grade viva. Passe valores
   * explícitos para SIMULAR o efeito de um lançamento antes de escrevê-lo.
   */
  const avaliarCargaDoServidor = (
    servidorId: string,
    horasLocais?: number,
    sobreavisosLocais?: number
  ): AvaliacaoCarga => {
    const totals = horasLocais === undefined || sobreavisosLocais === undefined
      ? calculateTotals(servidorId)
      : null
    return avaliarCarga({
      horasLocais: horasLocais ?? totals!.totalPlanejado,
      sobreavisosLocais: sobreavisosLocais ?? totals!.p_soQtd,
      cargas: cargaMensal[servidorId],
      escalaMensalIdAtual: escalaMensal.find(em => em.servidor_id === servidorId)?.id ?? null,
      teto: tetoCarga[servidorId]
    })
  }



  // confirmTriggerSobreaviso foi removida na Fase 8 do plano
  // docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
  //
  // Ela inseria direto em logs_sobreaviso a partir do navegador. Com a policy FOR ALL, isso
  // permitia gravar qualquer linha dentro do escopo do coordenador — inclusive status='Chegou'
  // sem token, sem GPS e sem ninguém aceitar nada. Todas as travas (janela ativa, chamado em
  // aberto) viviam só no frontend, e o painel global tornaria isso uma corrida entre
  // coordenadores de unidades diferentes.
  //
  // O acionamento agora é fn_acionar_sobreaviso, chamada pelo AcionarSobreavisoModal — que
  // também é onde se informa o destino do chamado.

  const isRedIndicator = (day: number, categoria: string, tipo: 'entrada' | 'saida') => {
    // REGRA: Somente mostra indicadores vermelhos se a confirmação de presença estiver exigida nas configurações
    if (configs['exigir_confirmacao_presenca'] !== 'true') return false

    const today = new Date()
    const currentMonth = today.getMonth() + 1
    const currentYear = today.getFullYear()
    
    // Only show red indicators for current or past months
    if (ano > currentYear) return false
    if (ano === currentYear && mes > currentMonth) return false

    // If past month, all missed shifts are red
    if (ano < currentYear || (ano === currentYear && mes < currentMonth)) return true

    // Current month logic
    if (day > today.getDate()) return false
    if (day < today.getDate()) return true
    
    const shiftHour = categoria === 'Plantão' || categoria === 'Regular' ? 7 : 0
    const endHour = shiftHour + 12
    const currentHour = today.getHours()
    
    if (tipo === 'entrada') return currentHour >= shiftHour + 1
    return currentHour >= endHour
  }

  const formatPresenceTime = useCallback((isoString?: string | null) => {
    if (!isoString) return null
    try {
      const d = new Date(isoString)
      if (isNaN(d.getTime())) return null
      return formatarHora(d)
    } catch {
      return null
    }
  }, [])

  const getShiftForecastTime = useCallback((
    turnoId: string, 
    tipo: 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida',
    servidorId?: string,
    cat?: string,
    day?: number
  ) => {
    if (!turnoId) return null
    const turno = turnos.find(t => t.id === turnoId)
    if (!turno) return null

    // FONTE ÚNICA (Fase 3): o bloco previsto vem de fn_blocos_previstos_mes, que envelopa a
    // mesma fn_blocos_previstos_dia usada pelo terminal. O que aparece aqui é literalmente o
    // que o terminal vai cobrar — inclusive fusão de blocos e intervalo.
    // O cálculo local abaixo só roda se a célula ainda não estiver salva no banco ou se a RPC
    // não tiver respondido.
    const bloco = blocoDaCelula(servidorId, cat, day)
    if (bloco) {
      // Em bloco fundido, entrada/saída são as DESTE turno (previstoDaLinhaNoBloco); só quando
      // o banco não informa o previsto por turno é que se cai no horário do bloco inteiro.
      const iso =
        tipo === 'entrada'           ? (previstoDaLinhaNoBloco(bloco, 'entrada', servidorId, cat, day) || bloco.inicio_previsto) :
        tipo === 'saida'             ? (previstoDaLinhaNoBloco(bloco, 'saida', servidorId, cat, day) || bloco.fim_previsto) :
        tipo === 'intervalo_saida'   ? bloco.intervalo_inicio_previsto :
        tipo === 'intervalo_retorno' ? bloco.intervalo_fim_previsto : null
      if (iso) {
        return formatarHora(iso)
      }
      // Passo de intervalo nulo é resposta legítima: o bloco não tem intervalo previsto
      // (CLT Art. 71, ou unidade sem marcação). Não cair no cálculo local, que inventaria um.
      if (tipo === 'intervalo_saida' || tipo === 'intervalo_retorno') return null
    }

    let startH = 7
    let endH = 19

    if (turno.horario_inicio) {
      const parts = turno.horario_inicio.split(':')
      if (parts.length >= 2) startH = parseInt(parts[0], 10)
    } else if (turno.codigo) {
      startH = getShiftStartHour(turno.codigo, Number(turno.horas_computadas))
    }

    if (turno.horario_fim) {
      const parts = turno.horario_fim.split(':')
      if (parts.length >= 2) endH = parseInt(parts[0], 10)
    } else if (turno.codigo) {
      endH = getShiftEndHour(turno.codigo, turno.horas_computadas)
    }

    let jornada: any = null
    let sRecord: any = null

    if (servidorId) {
      sRecord = todosServidoresSetor.find(s => s.id === servidorId)
      const emRecord = escalaMensal.find(e => e.servidor_id === servidorId)
      if (emRecord?.jornada_id) {
        jornada = jornadas.find(j => j.id === emRecord.jornada_id)
      }
    }

    // Se for categoria Regular e o servidor tiver jornada cadastrada (coluna Tipo),
    // a hora de início/fim da jornada (ex: "18H ÀS 06H") se sobrepõe ao padrão do código do turno
    if (cat === 'Regular' && jornada?.nome) {
      const matchStart = jornada.nome.match(/^([0-9]+)/)
      if (matchStart) {
        startH = parseInt(matchStart[1], 10)
      }
      const matchEnd = jornada.nome.match(/(?:ÀS|AS|as|às)\s*([0-9]+)/)
      if (matchEnd) {
        let parsedEnd = parseInt(matchEnd[1], 10)
        if (parsedEnd < startH) parsedEnd += 24
        endH = parsedEnd
      }
    }

    // Se for categoria Extra e houver um servidor/dia parametrizado:
    // O início da hora extra é alinhado dinamicamente ao fim do turno Regular/Plantão do mesmo dia
    if (cat === 'Extra' && servidorId && day) {
      const emRecord = escalaMensal.find(e => e.servidor_id === servidorId)
      const regTurnoId = gridData[servidorId]?.['Regular']?.[day] || gridData[servidorId]?.['Plantão']?.[day]
      if (regTurnoId) {
        let regEndH = 19
        if (jornada?.nome) {
          const matchStart = jornada.nome.match(/^([0-9]+)/)
          const matchEnd = jornada.nome.match(/(?:ÀS|AS|as|às)\s*([0-9]+)/)
          if (matchEnd) {
            let parsedEnd = parseInt(matchEnd[1], 10)
            const sH = matchStart ? parseInt(matchStart[1], 10) : 7
            if (parsedEnd < sH) parsedEnd += 24
            regEndH = parsedEnd
          }
        } else {
          const regTurno = turnos.find(t => t.id === regTurnoId)
          if (regTurno?.codigo) {
            regEndH = getShiftEndHour(regTurno.codigo, regTurno.horas_computadas)
          }
        }
        startH = regEndH
        const extraHours = turno.horas_computadas || 1
        endH = startH + extraHours
      }
    }

    const padTime = (h: number, m: number = 0) => 
      `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`

    if (tipo === 'entrada') return padTime(startH)
    if (tipo === 'saida') return padTime(endH)

    if (tipo === 'intervalo_saida' || tipo === 'intervalo_retorno') {
      const parseTimeString = (timeStr?: string | null) => {
        if (!timeStr) return null
        const parts = timeStr.split(':')
        if (parts.length >= 2) {
          const h = parseInt(parts[0], 10)
          const m = parseInt(parts[1], 10)
          if (!isNaN(h) && !isNaN(m)) return { hour: h, minute: m }
        }
        return null
      }

      // Cascata do Início do Intervalo:
      // 1. Personalizado no cadastro do Servidor
      // 2. Padrão na Jornada
      // 3. Fallback: startH + 4
      const servIni = parseTimeString(sRecord?.intervalo_inicio_personalizado)
      const jorIni = parseTimeString(jornada?.intervalo_inicio_padrao)

      let intStartH = startH + 4
      let intStartM = 0

      if (servIni) {
        intStartH = servIni.hour
        intStartM = servIni.minute
      } else if (jorIni) {
        intStartH = jorIni.hour
        intStartM = jorIni.minute
      }

      if (tipo === 'intervalo_saida') {
        return padTime(intStartH, intStartM)
      }

      // Cascata do Fim/Retorno do Intervalo:
      // 1. Personalizado no cadastro do Servidor
      // 2. Padrão na Jornada
      // 3. Fallback: intStart + (jornada.intervalo_minutos || 60)
      const servFim = parseTimeString(sRecord?.intervalo_fim_personalizado)
      const jorFim = parseTimeString(jornada?.intervalo_fim_padrao)

      let intEndH = intStartH + 1
      let intEndM = intStartM

      if (servFim) {
        intEndH = servFim.hour
        intEndM = servFim.minute
      } else if (jorFim) {
        intEndH = jorFim.hour
        intEndM = jorFim.minute
      } else if (jornada?.intervalo_minutos) {
        const totalM = intStartH * 60 + intStartM + jornada.intervalo_minutos
        intEndH = Math.floor(totalM / 60)
        intEndM = totalM % 60
      }

      if (tipo === 'intervalo_retorno') {
        return padTime(intEndH, intEndM)
      }
    }

    return null
    // ⚠️ blocoDaCelula PRECISA estar aqui. Ele fecha sobre blocosPrevistos, que começa VAZIO e
    // só é preenchido quando fn_blocos_previstos_mes responde. Sem a dependência, este callback
    // continuava com a closure do primeiro render — mapa vazio — e nenhuma das outras deps muda
    // ao abrir a tela, então TODA previsão da grade caía no cálculo local até o coordenador
    // digitar alguma coisa (o que mexe em gridData e recria o callback por acaso).
    // Sintoma medido em 26/08/2026: Plantão T4 com hora 14:00 informada exibindo previsão de
    // 13:00 (a âncora do prefixo 'T' em getShiftStartHour) contra as 14:00 que o banco previa.
    // O lint já apontava isso como warning; react-hooks/exhaustive-deps é "warn" no projeto,
    // então não quebrava build nem deploy.
  }, [turnos, escalaMensal, jornadas, gridData, todosServidoresSetor, getShiftStartHour, getShiftEndHour, blocoDaCelula, previstoDaLinhaNoBloco])

  const getAttemptTime = useCallback((servidorId: string, day: number, tipo: string) => {
    const matches = logsTentativas.filter(l => {
      if (l.servidor_id !== servidorId) return false
      const d = new Date(l.data_hora_tentativa)
      if (d.getDate() !== day || d.getMonth() + 1 !== mes || d.getFullYear() !== ano) return false
      if (tipo === 'entrada' && (l.motivo_acionamento?.toLowerCase().includes('entrada') || l.tipo_presenca?.toLowerCase().includes('entrada'))) return true
      if (tipo === 'saida' && (l.motivo_acionamento?.toLowerCase().includes('saí') || l.motivo_acionamento?.toLowerCase().includes('sai') || l.tipo_presenca?.toLowerCase().includes('sai'))) return true
      return true
    })
    if (matches.length === 0) return null
    matches.sort((a, b) => new Date(b.data_hora_tentativa).getTime() - new Date(a.data_hora_tentativa).getTime())
    const lastAttempt = matches[0]
    try {
      const dt = new Date(lastAttempt.data_hora_tentativa)
      return formatarHoraComSegundos(dt)
    } catch {
      return null
    }
  }, [logsTentativas, mes, ano])

  const getSegmentTooltip = useCallback((
    segmentIndex: number,
    labelBase: string,
    isConfirmed: boolean,
    isPendingYellow: boolean,
    isRed: boolean,
    recordedIso: string | null | undefined,
    isManual: boolean | undefined,
    servidorId: string,
    day: number,
    turnoId: string,
    tipo: 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida',
    cat?: string
  ) => {
    const showHoverDetails = configs['exibir_horarios_indicadores_presenca'] !== 'false'
    const prefix = segmentIndex > 0 ? `${segmentIndex}. ` : ''
    
    if (!showHoverDetails) {
      if (isConfirmed) return `${prefix}${labelBase} Confirmada (Clique para reverter)`
      if (isPendingYellow) return `${prefix}Em Expediente (${labelBase})`
      if (isRed) return `${prefix}${labelBase} Faltante/Pendente`
      return `${prefix}${labelBase} Programada`
    }

    const recTime = formatPresenceTime(recordedIso)
    const forecastTime = getShiftForecastTime(turnoId, tipo, servidorId, cat, day)
    const attemptTime = getAttemptTime(servidorId, day, tipo)

    if (isConfirmed) {
      const origText = isManual ? 'Manual' : 'Terminal'
      const timeInfo = recTime ? ` às ${recTime} (${origText})` : ''
      return `${prefix}${labelBase} Confirmada${timeInfo} • Clique para reverter`
    }

    if (isPendingYellow) {
      const prevText = forecastTime ? ` • Previsão: ${forecastTime}` : ''
      return `${prefix}Aguardando ${labelBase}${prevText}`
    }

    if (isRed) {
      if (attemptTime) {
        return `${prefix}${labelBase} Faltante • Tentativa em ${attemptTime} (Negada)`
      }
      const prevText = forecastTime ? ` (Previsão era ${forecastTime})` : ''
      return `${prefix}${labelBase} Faltante/Pendente • Sem tentativa registrada${prevText}`
    }

    const prevText = forecastTime ? ` • Horário previsto: ${forecastTime}` : ''
    return `${prefix}${labelBase} Programada${prevText}`
  }, [configs, formatPresenceTime, getShiftForecastTime, getAttemptTime])


  const handleCloseModal = () => {
    setTriggerModal(null)
    setGeneratedLink(null)
    setMotivo('')
  }

  const handleManualOverride = async (logId: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Validar Sobreaviso',
      message: 'Deseja validar manualmente este sobreaviso que falhou? Ele voltará a ser contabilizado na carga horária do servidor.',
      type: 'warning',
      onConfirm: async () => {
        setLoading(true)
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Usuário não autenticado')

          const now = new Date().toISOString()
          
          const { error } = await supabase
            .from('logs_sobreaviso')
            .update({ 
              status: 'Chegou', 
              validacao_manual: true,
              tipo_validacao_chegada: 'Manual',
              motivo_falha: null,
              validado_por: user.id,
              data_hora_validacao: now
            })
            .eq('id', logId)

          if (error) throw error
          
          // Update local state
          setLogsSobreaviso(prev => prev.map(l => l.id === logId ? { 
            ...l, 
            status: 'Chegou', 
            validacao_manual: true, 
            motivo_falha: null,
            validado_por: user.id,
            data_hora_validacao: now
          } : l))
          
          logAction('VALIDACAO_MANUAL_SOBREAVISO', { 
            log_id: logId,
            info: 'Validação manual de sobreaviso que falhou'
          })

          setAlertModal({
            isOpen: true,
            title: 'Validado',
            message: 'O sobreaviso foi validado manualmente com sucesso.',
            type: 'success'
          })
        } catch (err: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro na Validação',
            message: err.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const fetchData = useCallback(async () => {
    try {
      const { data: dailies, error } = await supabase
        .from('escala_diaria')
        .select('*')
        .in('escala_mensal_id', escalaMensal.map(em => em.id))
        .limit(5000)

      if (error) throw error

      if (dailies) {
        const newPresence: Record<string, Record<RowCategory, Record<number, { entrada: boolean, intervalo_saida: boolean, intervalo_retorno: boolean, saida: boolean, entrada_em?: string | null, intervalo_saida_em?: string | null, intervalo_retorno_em?: string | null, saida_em?: string | null, is_entrada_manual?: boolean, is_intervalo_saida_manual?: boolean, is_intervalo_retorno_manual?: boolean, is_saida_manual?: boolean }>>> = {}
        escalaMensal.forEach(em => {
          newPresence[em.servidor_id] = {
            'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {}
          }
          const serverDailies = dailies.filter(ed => ed.escala_mensal_id === em.id)
          serverDailies.forEach(ed => {
            const cat = (ed.categoria || 'Regular') as RowCategory
            newPresence[em.servidor_id][cat][ed.dia] = {
              entrada: !!ed.presenca_entrada_em,
              intervalo_saida: !!ed.presenca_intervalo_saida_em,
              intervalo_retorno: !!ed.presenca_intervalo_retorno_em,
              saida: !!ed.presenca_saida_em,
              entrada_em: ed.presenca_entrada_em || null,
              intervalo_saida_em: ed.presenca_intervalo_saida_em || null,
              intervalo_retorno_em: ed.presenca_intervalo_retorno_em || null,
              saida_em: ed.presenca_saida_em || null,
              is_entrada_manual: ed.presenca_entrada_manual !== undefined ? !!ed.presenca_entrada_manual : !!ed.confirmado_por_id,
              is_intervalo_saida_manual: !!ed.presenca_intervalo_saida_manual,
              is_intervalo_retorno_manual: !!ed.presenca_intervalo_retorno_manual,
              is_saida_manual: ed.presenca_saida_manual !== undefined ? !!ed.presenca_saida_manual : !!ed.confirmado_por_id
            }
          })
        })
        setPresenceData(newPresence)
      }
    } catch (err) {
      console.error('Erro ao recarregar dados:', err)
    }
  }, [supabase, escalaMensal])

  const handleConfirmManualPresence = async () => {
    if (!manualPresenceModal) return
    
    if (!manualPresenceModal.isReverting) {
      if (manualPresenceModal.dia > maxValidDay) {
        setAlertModal({
          isOpen: true,
          title: 'Data Futura não Permitida',
          message: maxValidDay === 0
            ? 'Não é possível validar presenças para um mês futuro.'
            : `Não é possível validar presenças para datas futuras. O dia máximo permitido para validação neste mês é dia ${maxValidDay}.`,
          type: 'warning'
        })
        return
      }

      if (!manualPresenceModal.justificativa || !manualPresenceModal.justificativa.trim()) {
        setAlertModal({
          isOpen: true,
          title: 'Justificativa Obrigatória',
          message: 'Por favor, informe a justificativa/motivo para esta validação manual.',
          type: 'warning'
        })
        return
      }

      const algumHorario = Object.values(manualPresenceModal.horarios || {}).some(v => !!v)
      const algumaSelecao = Object.values(manualPresenceModal.selecoes || {}).some(v => !!v)
      if (!algumHorario && !algumaSelecao) {
        setAlertModal({
          isOpen: true,
          title: 'Selecione ou Informe o Horário',
          message: 'Selecione uma batida registrada no terminal ou informe ao menos um horário. '
            + 'O sistema não preenche mais o horário da jornada automaticamente: registrar horário '
            + 'contratual como se fosse cumprido é vedado pela Portaria 671/2021.',
          type: 'warning'
        })
        return
      }

      // Ordem cronológica dos passos. Fonte única: src/utils/sequenciaPresenca.ts.
      //
      // ⚠️ COMPARAR MINUTOS DO MESMO DIA CIVIL RECUSA TODO PLANTÃO QUE ATRAVESSA A MEIA-NOITE.
      // Entrada 19:00, intervalo 22:00/23:00 e saída 07:00 é a sequência CORRETA de um `N` — a
      // saída é do dia seguinte. Até 01/09/2026 a tela respondia "a saída final (07:00) não pode
      // ser anterior ou igual ao retorno do intervalo (23:00)" e a validação não tinha como ser
      // concluída. O remendo que existia (`mSai > 360`) aceitava saída até 06:00 e recusava
      // justamente as 07:00 em que a família `N`/`T?N`/`MTN` termina.
      const diaPres = presenceData[manualPresenceModal.servidorId]?.[manualPresenceModal.categoria]?.[manualPresenceModal.dia]
      const toHHMM = (isoOrTime?: string | null) => {
        if (!isoOrTime) return null
        if (isoOrTime.includes('T')) {
          return formatarHora(isoOrTime)
        }
        return isoOrTime.slice(0, 5)
      }

      const getFinalPassoHora = (p: PassoPresenca) => {
        if (manualPresenceModal.selecoes?.[p]?.hora) return manualPresenceModal.selecoes[p]!.hora.slice(0, 5)
        if (manualPresenceModal.horarios?.[p]) return manualPresenceModal.horarios[p].slice(0, 5)
        if (p === 'entrada') return toHHMM(diaPres?.entrada_em)
        if (p === 'intervalo_saida') return toHHMM(diaPres?.intervalo_saida_em)
        if (p === 'intervalo_retorno') return toHHMM(diaPres?.intervalo_retorno_em)
        if (p === 'saida') return toHHMM(diaPres?.saida_em)
        return null
      }

      const seq = avaliarSequenciaPresenca({
        entrada: getFinalPassoHora('entrada'),
        intervalo_saida: getFinalPassoHora('intervalo_saida'),
        intervalo_retorno: getFinalPassoHora('intervalo_retorno'),
        saida: getFinalPassoHora('saida'),
      }, {
        cruzaMeiaNoite: celulaCruzaMeiaNoite(
          manualPresenceModal.servidorId, manualPresenceModal.categoria, manualPresenceModal.dia),
      })

      if (!seq.ok) {
        setAlertModal({
          isOpen: true,
          title: 'Horários Inconsistentes',
          message: seq.mensagem || 'Os horários informados não formam uma sequência válida.',
          type: 'warning'
        })
        return
      }
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado')

      if (manualPresenceModal.isReverting) {
        const { error } = await supabase.rpc('fn_reverter_presenca_manual', {
          p_escala_mensal_id: manualPresenceModal.escalaMensalId,
          p_dia: manualPresenceModal.dia,
          p_categoria: manualPresenceModal.categoria,
          p_tipo: manualPresenceModal.tipo,
          p_validador_id: user.id
        })
        if (error) throw error
      } else {
        // Duas naturezas de horário na mesma chamada, e o banco as grava com origens diferentes:
        // batida SELECIONADA entra com o horário real (origem `terminal`, segundos preservados,
        // vínculo com a marcação); horário DIGITADO entra como declaração do coordenador
        // (`ajuste_coordenador`). fn_validar_presenca_manual resolve as duas numa transação só.
        // fn_confirmar_presenca_manual continua existindo e serve à validação em massa, onde
        // não há horário individual a informar — aqui, no caso a caso, existe.
        const { data: linha, error: errLinha } = await supabase
          .from('escala_diaria')
          .select('id')
          .eq('escala_mensal_id', manualPresenceModal.escalaMensalId)
          .eq('dia', manualPresenceModal.dia)
          .eq('categoria', manualPresenceModal.categoria)
          .maybeSingle()
        if (errLinha) throw errLinha
        if (!linha?.id) throw new Error('Não encontrei a linha de escala deste dia.')

        const selecoes = Object.fromEntries(
          Object.entries(manualPresenceModal.selecoes || {})
            .filter(([, v]) => !!v)
            .map(([passo, v]) => [passo, { fonte: v!.fonte, id: v!.id }])
        )

        // Passo com batida selecionada ignora o que houver digitado: o fato ganha da declaração.
        const horarios = Object.fromEntries(
          Object.entries(manualPresenceModal.horarios || {})
            .filter(([passo, v]) => !!v && !selecoes[passo])
        )

        const { data, error } = await supabase.rpc('fn_validar_presenca_manual', {
          p_escala_diaria_id: linha.id,
          p_selecoes: selecoes,
          p_horarios: horarios,
          p_validador_id: user.id,
          p_justificativa: (manualPresenceModal.justificativa || '').trim()
        })
        if (error) throw error
        if (data && !data.success) throw new Error(data.message)
      }

      await fetchData()
      setManualPresenceModal(null)
      setAlertModal({
        isOpen: true,
        title: manualPresenceModal.isReverting ? 'Presença Revertida' : 'Presença Validada',
        message: manualPresenceModal.isReverting ? 'Validação manual revertida com sucesso.' : 'Presença validada manualmente com sucesso.',
        type: manualPresenceModal.isReverting ? 'warning' : 'success'
      })
    } catch (err: any) {
      setManualPresenceModal(null)
      setAlertModal({
        isOpen: true,
        title: 'Erro na Operação',
        message: err.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBulkServerValidation = async () => {
    if (!bulkServerModal) return

    if (maxValidDay === 0) {
      setAlertModal({
        isOpen: true,
        title: 'Mês Futuro não Permitido',
        message: 'Não é possível executar validações de presença para um mês futuro.',
        type: 'warning'
      })
      return
    }

    if (bulkServerModal.startDay > maxValidDay) {
      setAlertModal({
        isOpen: true,
        title: 'Período Futuro não Permitido',
        message: `Não é possível validar presenças para datas futuras. O dia máximo permitido para validação até hoje é dia ${maxValidDay}.`,
        type: 'warning'
      })
      return
    }

    if (!bulkServerModal.justificativa || !bulkServerModal.justificativa.trim()) {
      setAlertModal({
        isOpen: true,
        title: 'Justificativa Obrigatória',
        message: 'Por favor, informe a justificativa/motivo para a validação em massa.',
        type: 'warning'
      })
      return
    }

    const start = Math.min(bulkServerModal.startDay, bulkServerModal.endDay)
    let end = Math.max(bulkServerModal.startDay, bulkServerModal.endDay)
    if (end > maxValidDay) {
      end = maxValidDay
    }

    const days: number[] = []
    for (let d = start; d <= end; d++) {
      days.push(d)
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.rpc('fn_atestar_jornada_bulk', {
        p_escala_mensal_ids: [bulkServerModal.escalaMensalId],
        p_dias: days,
        p_categorias: bulkServerModal.categorias,
        p_tipo: bulkServerModal.modo,
        p_validador_id: user?.id || userProfile?.id,
        p_justificativa: bulkServerModal.justificativa.trim()
      })
      if (error) throw error
      if (data && !data.success) throw new Error(data.message)

      await fetchData()
      setBulkServerModal(null)
      // Dias com ponto registrado no terminal ficam de fora do atestado em massa: existe
      // horário real esperando decisão, e atestar por cima gravaria o contratual por cima dele.
      const pendentes: any[] = data?.pendentes || []
      setAlertModal({
        isOpen: true,
        title: pendentes.length ? 'Atestado Concluído — com pendências' : 'Atestado Concluído',
        message: pendentes.length
          ? `Jornada atestada em ${data.atestados} registro(s) para ${bulkServerModal.servidorNome}. `
            + `${pendentes.length} dia(s) ficaram de fora porque têm ponto registrado no terminal `
            + `aguardando revisão: ${pendentes.map(p => `dia ${p.dia} (${p.primeira_batida})`).join(', ')}. `
            + `Abra cada um e use o horário real da batida.`
          : `Jornada atestada em ${data?.atestados ?? 0} registro(s) para ${bulkServerModal.servidorNome}, dias ${start} a ${end}.`,
        type: pendentes.length ? 'warning' : 'success'
      })
    } catch (err: any) {
      console.error('Erro na validação por servidor:', err)
      setAlertModal({
        isOpen: true,
        title: 'Erro na Validação',
        message: err.message || 'Falha ao executar validação.',
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBulkGlobalValidation = async () => {
    if (!bulkGlobalModal) return

    if (maxValidDay === 0) {
      setAlertModal({
        isOpen: true,
        title: 'Mês Futuro não Permitido',
        message: 'Não é possível executar validações de presença para um mês futuro.',
        type: 'warning'
      })
      return
    }

    if (bulkGlobalModal.selectedServidorIds.length === 0) {
      setAlertModal({
        isOpen: true,
        title: 'Nenhum Servidor Selecionado',
        message: 'Por favor, selecione ao menos um servidor para a validação.',
        type: 'warning'
      })
      return
    }

    if (bulkGlobalModal.startDay > maxValidDay) {
      setAlertModal({
        isOpen: true,
        title: 'Período Futuro não Permitido',
        message: `Não é possível validar presenças para datas futuras. O dia máximo permitido para validação até hoje é dia ${maxValidDay}.`,
        type: 'warning'
      })
      return
    }

    if (!bulkGlobalModal.justificativa || !bulkGlobalModal.justificativa.trim()) {
      setAlertModal({
        isOpen: true,
        title: 'Justificativa Obrigatória',
        message: 'Por favor, informe a justificativa/motivo para a validação em massa.',
        type: 'warning'
      })
      return
    }

    const start = Math.min(bulkGlobalModal.startDay, bulkGlobalModal.endDay)
    let end = Math.max(bulkGlobalModal.startDay, bulkGlobalModal.endDay)
    if (end > maxValidDay) {
      end = maxValidDay
    }

    const days: number[] = []
    for (let d = start; d <= end; d++) {
      days.push(d)
    }

    const escalaMensalIds = escalaMensal
      .filter(em => bulkGlobalModal.selectedServidorIds.includes(em.servidor_id))
      .map(em => em.id)

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Modo autorizado pelo RH: RPC diferente, que declara SOMENTE os passos autorizados por
      // servidor e por data — e nunca toca na saída. Quem não tiver autorização vigente é
      // pulado pelo banco e volta nominalmente na resposta.
      const { data, error } = bulkGlobalModal.modo === 'autorizado'
        ? await supabase.rpc('fn_atestar_passos_autorizados_bulk', {
            p_escala_mensal_ids: escalaMensalIds,
            p_dias: days,
            p_categorias: bulkGlobalModal.categorias,
            p_validador_id: user?.id || userProfile?.id,
            p_justificativa: bulkGlobalModal.justificativa.trim()
          })
        : await supabase.rpc('fn_atestar_jornada_bulk', {
            p_escala_mensal_ids: escalaMensalIds,
            p_dias: days,
            p_categorias: bulkGlobalModal.categorias,
            p_tipo: bulkGlobalModal.modo,
            p_validador_id: user?.id || userProfile?.id,
            p_justificativa: bulkGlobalModal.justificativa.trim()
          })
      if (error) throw error
      if (data && !data.success) throw new Error(data.message)

      await fetchData()
      setBulkGlobalModal(null)
      const pendentesG: any[] = data?.pendentes || []
      // Agrupa por servidor: numa validação global a lista de dias soltos seria ilegível.
      const porServidor = pendentesG.reduce((acc: Record<string, number[]>, p: any) => {
        (acc[p.servidor_nome] = acc[p.servidor_nome] || []).push(p.dia)
        return acc
      }, {})
      // ⚠️ Relatar o que MUDOU e por que o resto não (armadilha 22 do CLAUDE.md). No modo
      // autorizado há uma segunda razão de exclusão — servidor sem autorização vigente — e
      // esconder isso faria o coordenador achar que declarou o setor inteiro.
      const semAutorizacao: any[] = data?.sem_autorizacao || []
      const nomesSemAutorizacao = [...new Set(semAutorizacao.map((x: any) => x.servidor_nome))]

      setAlertModal({
        isOpen: true,
        title: (pendentesG.length || nomesSemAutorizacao.length)
          ? 'Atestado Concluído — com pendências'
          : 'Atestado Global Concluído',
        message: [
          bulkGlobalModal.modo === 'autorizado'
            ? `Jornada declarada em ${data?.atestados ?? 0} registro(s), somente nos passos autorizados pelo RH. A saída não foi preenchida em nenhum dia.`
            : `Jornada atestada em ${data?.atestados ?? 0} registro(s) para ${escalaMensalIds.length} servidor(es), dias ${start} a ${end}.`,
          nomesSemAutorizacao.length
            ? `Sem autorização vigente (nada foi declarado): ${nomesSemAutorizacao.join(', ')}.`
            : '',
          pendentesG.length
            ? `${pendentesG.length} dia(s) ficaram de fora por terem ponto registrado no terminal aguardando revisão — `
              + `${Object.entries(porServidor).map(([n, ds]) => `${n}: dia(s) ${(ds as number[]).join(', ')}`).join(' | ')}. `
              + `Abra cada um e use o horário real da batida.`
            : '',
        ].filter(Boolean).join(' '),
        type: (pendentesG.length || nomesSemAutorizacao.length) ? 'warning' : 'success'
      })
    } catch (err: any) {
      console.error('Erro na validação em massa global:', err)
      setAlertModal({
        isOpen: true,
        title: 'Erro na Validação',
        message: err.message || 'Falha ao executar validação em massa.',
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleManualSobreavisoOverride = async (logId: string, justificativa: string) => {
    if (!justificativa || !justificativa.trim()) {
      setAlertModal({
        isOpen: true,
        title: 'Justificativa Obrigatória',
        message: 'Por favor, informe a justificativa/motivo para validar o sobreaviso manualmente.',
        type: 'warning'
      })
      return
    }

    setLoading(true)
    try {
      const now = new Date().toISOString()
      const motivoStr = `Validação Manual (Sobreaviso) — Justificativa: ${justificativa.trim()}`
      const { error } = await supabase
        .from('logs_sobreaviso')
        .update({
          status: 'Chegou',
          data_hora_chegada: now,
          data_hora_validacao: now,
          validacao_manual: true,
          validado_por: userProfile?.id,
          motivo_acionamento: motivoStr,
          tipo_validacao_chegada: 'Manual'
        })
        .eq('id', logId)

      if (error) throw error
      await fetchData()

      setAlertModal({
        isOpen: true,
        title: 'Sobreaviso Validado',
        message: 'Chamado de sobreaviso validado manualmente com sucesso!',
        type: 'success'
      })
    } catch (err: any) {
      console.error('Erro ao validar sobreaviso manualmente:', err)
      setAlertModal({
        isOpen: true,
        title: 'Erro na Validação',
        message: err.message || 'Falha ao validar chamado de sobreaviso.',
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  /**
   * Grava as competências EXTRAS do Gerador Inteligente (a 2ª em diante) como Rascunho.
   *
   * A competência aberta na tela continua sendo rascunho LOCAL — nada dela vai ao banco sem
   * "Salvar Previsão". As seguintes não têm grade aberta para segurá-las, então ou são gravadas
   * ou não existem. Quatro travas, e nenhuma delas é opcional:
   *
   *  1. Competência encerrada (`competencias_encerradas`) é pulada e dita no resumo.
   *  2. Escala mensal que não esteja em Rascunho é pulada — escala Fechada de mês futuro é
   *     decisão de alguém, não do gerador.
   *  3. Célula que JÁ EXISTE nunca é sobrescrita, só as que faltam são inseridas. É o que torna
   *     seguro rodar o gerador duas vezes, e o que impede o palpite de apagar trabalho manual.
   *  4. O motor já removeu dia de afastamento; sem isso o trigger fn_prevent_shift_during_event
   *     derrubaria o lote inteiro (armadilha 14).
   */
  const persistirMesesGerados = useCallback(async (
    mesesExtras: MesGerado[],
    jornadasHerdadas: Record<string, string>
  ): Promise<{ rotulo: string; celulas: number }[]> => {
    const resumo: { rotulo: string; celulas: number }[] = []

    // Lido aqui do prop, e não da const `closedPeriods`: ela é declarada mais abaixo no corpo
    // do componente, e citá-la na lista de dependências deste useCallback estouraria a zona
    // morta temporal (TDZ) já no primeiro render.
    const encerradasRaw = configsGlobais?.find(c => c.chave === 'competencias_encerradas')?.valor
    const encerradas: any[] = Array.isArray(encerradasRaw) ? encerradasRaw : []

    for (const alvo of mesesExtras) {
      const rotulo = `${String(alvo.mes).padStart(2, '0')}/${alvo.ano}`

      if (encerradas.some((p: any) => p.mes === alvo.mes && p.ano === alvo.ano)) {
        resumo.push({ rotulo: `${rotulo} (encerrada, ignorada)`, celulas: 0 })
        continue
      }

      const { data: existentes, error: errSel } = await supabase
        .from('escala_mensal')
        .select('id, servidor_id, status')
        .eq('unidade_id', unidadeId)
        .eq('setor_id', setorId)
        .eq('mes', alvo.mes)
        .eq('ano', alvo.ano)
      if (errSel) throw new Error(`Competência ${rotulo}: ${errSel.message}`)

      const porServidor = new Map<string, any>((existentes || []).map((e: any) => [e.servidor_id, e]))

      const faltantes = escalaMensal.filter(em => em.servidor_id && !porServidor.has(em.servidor_id))
      if (faltantes.length > 0) {
        const { data: criadas, error: errIns } = await supabase
          .from('escala_mensal')
          .insert(faltantes.map(em => ({
            servidor_id: em.servidor_id,
            unidade_id: unidadeId,
            setor_id: setorId,
            mes: alvo.mes,
            ano: alvo.ano,
            status: 'Rascunho',
            jornada_id: em.jornada_id || jornadasHerdadas[em.servidor_id] || null
          })))
          .select('id, servidor_id, status')
        if (errIns) throw new Error(`Competência ${rotulo}: ${errIns.message}`)
        criadas?.forEach((c: any) => porServidor.set(c.servidor_id, c))
      }

      const emEditaveis = [...porServidor.values()].filter((e: any) => e.status !== 'Fechada')
      if (emEditaveis.length === 0) {
        resumo.push({ rotulo, celulas: 0 })
        continue
      }

      const { data: jaGravadas, error: errEd } = await supabase
        .from('escala_diaria')
        .select('escala_mensal_id, categoria, dia')
        .in('escala_mensal_id', emEditaveis.map((e: any) => e.id))
      if (errEd) throw new Error(`Competência ${rotulo}: ${errEd.message}`)

      const ocupadas = new Set(
        (jaGravadas || []).map((d: any) => `${d.escala_mensal_id}|${d.categoria}|${d.dia}`)
      )

      // O que entraria, agrupado por servidor — antes de decidir se entra.
      const porServidorInserts = new Map<string, any[]>()
      const gridNovoPorServidor = new Map<string, Record<RowCategory, Record<number, string>>>()
      let puladasPorExtraSemRegular = 0
      // Ordem fixa (não a do objeto vindo do motor): Regular antes de Extra, para o guard
      // abaixo enxergar o Regular que ESTE lote acabou de gerar, e não só o que já está no banco.
      const ORDEM_CATEGORIAS: RowCategory[] = ['Regular', 'Plantão', 'Sobreaviso', 'Extra']
      for (const [servidorId, categorias] of Object.entries(alvo.grid)) {
        const emAlvo = porServidor.get(servidorId)
        if (!emAlvo || emAlvo.status === 'Fechada') continue
        for (const cat of ORDEM_CATEGORIAS) {
          const dias = (categorias as Partial<Record<RowCategory, Record<string, string>>>)[cat]
          if (!dias) continue
          for (const [diaStr, turnoId] of Object.entries(dias)) {
            const dia = parseInt(diaStr)
            if (ocupadas.has(`${emAlvo.id}|${cat}|${dia}`)) continue

            // Hora extra é extensão do Regular, nunca do plantão (mesma regra do merge da
            // competência aberta, acima). Estes meses vão direto para o banco sem grade aberta
            // para segurar — se não checar aqui, não checa em lugar nenhum para eles.
            if (cat === 'Extra') {
              const temRegularNoLote = !!gridNovoPorServidor.get(servidorId)?.['Regular'][dia]
              const temRegularNoBanco = ocupadas.has(`${emAlvo.id}|Regular|${dia}`)
              if (!temRegularNoLote && !temRegularNoBanco) {
                puladasPorExtraSemRegular++
                continue
              }
            }

            const linha = {
              escala_mensal_id: emAlvo.id,
              dia,
              categoria: cat,
              dicionario_turnos_id: turnoId
            }
            const lista = porServidorInserts.get(servidorId)
            if (lista) lista.push(linha)
            else porServidorInserts.set(servidorId, [linha])

            const g = gridNovoPorServidor.get(servidorId)
              || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
            g[cat][dia] = turnoId
            gridNovoPorServidor.set(servidorId, g)
          }
        }
      }

      // Teto mensal do servidor NAQUELA competência. Estes meses vão direto para o banco, sem
      // grade aberta para segurá-los — se o teto não for conferido aqui, ele não é conferido em
      // lugar nenhum para eles.
      //
      // ⚠️ `escalaMensalIdAtual: null` de propósito: aqui NADA é excluído da carga do banco. As
      // células novas são o "local", e tudo que já está gravado (neste setor e nos outros) é o
      // externo. Excluir a escala deste setor apagaria da conta o que já foi lançado nela.
      const idsParaConferir = [...porServidorInserts.keys()]
      let bloqueadosPorTeto = 0
      if (idsParaConferir.length > 0) {
        const [{ data: cargasAlvo }, { data: tetosAlvo }] = await Promise.all([
          supabase.rpc('fn_carga_mensal_servidor', { p_servidor_ids: idsParaConferir, p_mes: alvo.mes, p_ano: alvo.ano }),
          supabase.rpc('fn_teto_carga_servidor', { p_servidor_ids: idsParaConferir, p_mes: alvo.mes, p_ano: alvo.ano })
        ])

        const cargasPor: Record<string, CargaEscala[]> = {}
        ;((cargasAlvo as any[]) || []).forEach(c => {
          (cargasPor[c.servidor_id] = cargasPor[c.servidor_id] || []).push(c as CargaEscala)
        })
        const tetosPor: Record<string, TetoServidor> = {}
        ;((tetosAlvo as any[]) || []).forEach(t => { tetosPor[t.servidor_id] = t as TetoServidor })

        for (const servidorId of idsParaConferir) {
          const novo = gridNovoPorServidor.get(servidorId)
          if (!novo) continue
          // A jornada usada é a da grade aberta (ou a herdada, que é a mesma que acabou de ser
          // gravada em escala_mensal) — é o teto líquido do Regular, e não há outra fonte aqui.
          const totaisNovos = calculateTotals(servidorId, novo)
          const avaliacao = avaliarCarga({
            horasLocais: totaisNovos.totalPlanejado,
            sobreavisosLocais: totaisNovos.p_soQtd,
            cargas: cargasPor[servidorId],
            escalaMensalIdAtual: null,
            teto: tetosPor[servidorId]
          })
          if (avaliacao.excede) {
            bloqueadosPorTeto += (porServidorInserts.get(servidorId) || []).length
            porServidorInserts.delete(servidorId)
          }
        }
      }

      const inserts: any[] = [...porServidorInserts.values()].flat()

      // Em lotes: o upsert em bloco único de um mês inteiro de um setor grande já passou de
      // 2 mil linhas, e o erro de uma derruba todas.
      for (let i = 0; i < inserts.length; i += 500) {
        const { error } = await supabase.from('escala_diaria').insert(inserts.slice(i, i + 500))
        if (error) throw new Error(`Competência ${rotulo}: ${error.message}`)
      }

      // Relatar o que MUDOU, e por que o resto não (armadilha 22): dizer "0 células" sem contar
      // que um servidor inteiro foi recusado pelo teto é o mesmo defeito de 25/08/2026.
      const motivosDescartados = [
        bloqueadosPorTeto > 0 ? `${bloqueadosPorTeto} não gerada(s) por teto mensal` : null,
        puladasPorExtraSemRegular > 0 ? `${puladasPorExtraSemRegular} de Hora Extra descartada(s) por não ter Regular no dia` : null
      ].filter((m): m is string => m !== null)
      resumo.push({
        rotulo: motivosDescartados.length > 0 ? `${rotulo} (${motivosDescartados.join('; ')})` : rotulo,
        celulas: inserts.length
      })
    }

    return resumo
  }, [supabase, unidadeId, setorId, escalaMensal, configsGlobais, calculateTotals])

  const handleSave = async () => {
    if (isCompetenciaEncerrada) return

    // Validação de Dimensionamento Máximo (Regra Rígida)
    const regraDimensionamento = configs['escala_regra_dimensionamento'] || 'flexivel'
    if (regraDimensionamento === 'rigida' && currentSector) {
      const maxM = currentSector.servidores_manha_max || 0
      const maxT = currentSector.servidores_tarde_max || 0
      const maxN = currentSector.servidores_noite_max || 0
      const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

      const overstaffedDays: string[] = []

      daysArray.forEach(day => {
        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
        const d = new Date(ano, mes - 1, day)
        const isWE = d.getDay() === 0 || d.getDay() === 6
        const isHoliday = feriados.some(f => f.data === dateStr)
        const isWeekendOrHoliday = isWE || isHoliday

        if (!isWeekendOrHoliday || applyOnFdsFeriados) {
          const countM = shiftTotals.M[day] || 0
          const countT = shiftTotals.T[day] || 0
          const countN = shiftTotals.N[day] || 0

          const violations = []
          if (maxM > 0 && countM > maxM) violations.push(`Manhã: ${countM}/${maxM}`)
          if (maxT > 0 && countT > maxT) violations.push(`Tarde: ${countT}/${maxT}`)
          if (maxN > 0 && countN > maxN) violations.push(`Noite: ${countN}/${maxN}`)

          if (violations.length > 0) {
            overstaffedDays.push(`Dia ${day} (${violations.join(', ')})`)
          }
        }
      })

      if (overstaffedDays.length > 0) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Limite Máximo Excedido (Regra Rígida)',
          message: `A escala possui dias com mais servidores do que o limite máximo permitido:\n\n${overstaffedDays.slice(0, 5).join('\n')}${overstaffedDays.length > 5 ? `\n...e mais ${overstaffedDays.length - 5} dias.` : ''}`,
          type: 'warning'
        })
        return
      }
    }

    // Validação de Afastamento — última barreira antes do banco.
    // O trigger fn_prevent_shift_during_event recusa linha a linha, mas o upsert vai em
    // lote: um único lançamento em dia de afastamento aborta TODO o "Salvar Previsão", e o
    // coordenador perde o resto do trabalho com uma mensagem crua de exceção do Postgres.
    // Aqui a recusa é específica e diz qual servidor, dia e linha precisam ser corrigidos.
    const conflitosAfastamento: string[] = []
    escalaMensal.forEach(em => {
      const serverData = gridData[em.servidor_id]
      if (!serverData) return
      Object.entries(serverData).forEach(([categoria, days]) => {
        Object.entries(days).forEach(([dayStr, turnoId]) => {
          if (!turnoId) return
          const day = parseInt(dayStr)
          const turnoCel = turnos.find(t => t.id === turnoId)
          const ev = getAfastamentoBloqueante(em.servidor_id, day, categoria as RowCategory, turnoCel?.slots || [])
          if (ev) {
            conflitosAfastamento.push(`Dia ${day} — ${em.servidores?.nome || 'Servidor'} (${categoria}: ${turnoCel?.codigo || '?'}) em ${ev.tipos_eventos?.nome || 'afastamento'}`)
          }
        })
      })
    })

    if (conflitosAfastamento.length > 0) {
      setAlertModal({
        isOpen: true,
        title: '⚠️ Lançamento em Dia de Afastamento',
        message: `Não é possível salvar: há ${conflitosAfastamento.length} lançamento(s) em dias de afastamento. Remova-os da grade antes de salvar.\n\n${conflitosAfastamento.slice(0, 8).join('\n')}${conflitosAfastamento.length > 8 ? `\n...e mais ${conflitosAfastamento.length - 8}.` : ''}`,
        type: 'warning'
      })
      return
    }

    // Validação de Hora Extra sem Regular — última barreira antes do banco.
    // handleCellChange já bloqueia isso na digitação célula a célula, mas Aplicar Template e o
    // Gerador Inteligente escrevem direto no gridData sem passar por ali (armadilha 14/23/26:
    // não é só a digitação que precisa proteger regra de negócio, e sim todo caminho que grava).
    // Extra é extensão do expediente REGULAR — nunca do plantão, que já tem duração e pagamento
    // próprios (PL12/PL6/PL4).
    const conflitosExtraSemRegular: string[] = []
    escalaMensal.forEach(em => {
      const serverData = gridData[em.servidor_id]
      if (!serverData) return
      Object.entries(serverData['Extra'] || {}).forEach(([dayStr, turnoId]) => {
        if (!turnoId) return
        const day = parseInt(dayStr)
        if (!serverData['Regular']?.[day]) {
          const turnoCel = turnos.find(t => t.id === turnoId)
          conflitosExtraSemRegular.push(`Dia ${day} — ${em.servidores?.nome || 'Servidor'} (Extra: ${turnoCel?.codigo || '?'})`)
        }
      })
    })

    if (conflitosExtraSemRegular.length > 0) {
      setAlertModal({
        isOpen: true,
        title: '⚠️ Hora Extra sem Regular',
        message: `Não é possível salvar: há ${conflitosExtraSemRegular.length} lançamento(s) de Hora Extra em dia sem turno Regular. Hora extra é extensão do expediente regular — plantão não conta para isso. Remova-os ou lance o Regular do dia antes de salvar.\n\n${conflitosExtraSemRegular.slice(0, 8).join('\n')}${conflitosExtraSemRegular.length > 8 ? `\n...e mais ${conflitosExtraSemRegular.length - 8}.` : ''}`,
        type: 'warning'
      })
      return
    }

    // Validação de Sobreposição entre Setores — última barreira antes do banco.
    // O trigger trg_escala_diaria_sem_sobreposicao_setor (20260826220000) recusa linha a linha,
    // mas o upsert vai em LOTE: um único lançamento sobreposto aborta TODO o "Salvar Previsão"
    // e o coordenador perde o resto do trabalho com uma mensagem crua do Postgres. Aqui a recusa
    // é específica e diz qual servidor, dia e setor precisam ser corrigidos.
    //
    // A ocupação é RELIDA do banco de propósito: o externalOccupancy do mount pode estar velho,
    // e aba desatualizada é justamente o caso que a checagem local não cobre.
    try {
      const { data: ocupacaoFresca } = await supabase.rpc('fn_get_monthly_occupancy', {
        p_servidor_ids: escalaMensal.map(em => em.servidor_id),
        p_mes: mes,
        p_ano: ano
      })

      const conflitosSobreposicao: string[] = []
      escalaMensal.forEach(em => {
        const serverData = gridData[em.servidor_id]
        if (!serverData) return
        Object.entries(serverData).forEach(([categoria, days]) => {
          Object.entries(days).forEach(([dayStr, turnoId]) => {
            if (!turnoId) return
            const day = parseInt(dayStr)
            const turnoCel = turnos.find(t => t.id === turnoId)
            const conflito = encontrarConflitoExterno(
              ocupacaoFresca || externalOccupancy, em.servidor_id, em.id, day, turnoCel?.slots || []
            )
            if (conflito) {
              conflitosSobreposicao.push(`Dia ${day} — ${em.servidores?.nome || 'Servidor'} (${categoria}: ${turnoCel?.codigo || '?'}) já está em ${conflito.descricao}`)
            }
          })
        })
      })

      if (conflitosSobreposicao.length > 0) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Servidor Escalado em Outro Setor',
          message: `Não é possível salvar: há ${conflitosSobreposicao.length} lançamento(s) em que o servidor já está escalado em outro setor no mesmo horário. Remova-os da grade antes de salvar.\n\n${conflitosSobreposicao.slice(0, 8).join('\n')}${conflitosSobreposicao.length > 8 ? `\n...e mais ${conflitosSobreposicao.length - 8}.` : ''}`,
          type: 'warning'
        })
        return
      }
    } catch (err) {
      // Falha ao reler a ocupação não pode impedir de salvar: o trigger do banco continua sendo
      // a defesa real. Aqui só se perde a mensagem amigável.
      console.error('Erro ao verificar sobreposição entre setores:', err)
    }

    // Teto mensal consolidado — última barreira antes do banco.
    //
    // ⚠️ A carga das outras escalas é RELIDA do banco de propósito, como já se faz com
    // fn_get_monthly_occupancy: o `cargaMensal` do mount pode estar velho, e aba desatualizada é
    // justamente o caso que a checagem por célula não cobre — dois coordenadores lançando o mesmo
    // servidor em setores diferentes ao mesmo tempo é o caso real (49 servidores em 2+ escalas
    // em 09/2026).
    //
    // ⚠️ E não existe trigger equivalente no banco (decisão registrada no plano): diferente da
    // sobreposição entre setores, aqui esta é a ÚLTIMA defesa. Uma falha de rede não pode virar
    // "salvou mesmo estourando" em silêncio, então o `catch` recusa em vez de deixar passar.
    try {
      const servidorIds = escalaMensal.map(em => em.servidor_id)
      const [{ data: cargasFrescas }, { data: tetosFrescos }] = await Promise.all([
        supabase.rpc('fn_carga_mensal_servidor', { p_servidor_ids: servidorIds, p_mes: mes, p_ano: ano }),
        supabase.rpc('fn_teto_carga_servidor', { p_servidor_ids: servidorIds, p_mes: mes, p_ano: ano })
      ])

      const cargasPorServidor: Record<string, CargaEscala[]> = {}
      ;((cargasFrescas as any[]) || []).forEach(c => {
        (cargasPorServidor[c.servidor_id] = cargasPorServidor[c.servidor_id] || []).push(c as CargaEscala)
      })
      const tetosPorServidor: Record<string, TetoServidor> = {}
      ;((tetosFrescos as any[]) || []).forEach(t => { tetosPorServidor[t.servidor_id] = t as TetoServidor })

      const estouros: string[] = []
      escalaMensal.forEach(em => {
        const totals = calculateTotals(em.servidor_id)
        const avaliacao = avaliarCarga({
          horasLocais: totals.totalPlanejado,
          sobreavisosLocais: totals.p_soQtd,
          cargas: cargasPorServidor[em.servidor_id] ?? cargaMensal[em.servidor_id],
          escalaMensalIdAtual: em.id,
          teto: tetosPorServidor[em.servidor_id] ?? tetoCarga[em.servidor_id]
        })
        if (!avaliacao.excede) return

        const nome = em.servidores?.nome || 'Servidor'
        const partes: string[] = []
        if (avaliacao.excedeHoras) {
          partes.push(`${formatarHoras(avaliacao.totalHoras)}h no mês (teto ${formatarHoras(avaliacao.tetoHoras)}h)`)
        }
        if (avaliacao.excedeSobreavisos) {
          partes.push(`${avaliacao.totalSobreavisos} un de sobreaviso (teto ${avaliacao.tetoSobreavisos})`)
        }
        const onde = avaliacao.outras.length > 0
          ? ` — ${formatarHoras(avaliacao.horasLocais)}h aqui e ${avaliacao.outras.map(o => `${formatarHoras(o.horas)}h em ${o.unidade_nome} / ${o.setor_caminho}`).join(', ')}`
          : ''
        estouros.push(`${nome}: ${partes.join(' e ')}${onde}`)
      })

      if (estouros.length > 0) {
        // Cache atualizado antes de mostrar a mensagem: o escudo vermelho na linha do servidor
        // (por onde o administrador abre a Autorização Extraordinária) precisa aparecer agora,
        // não no próximo carregamento da tela.
        setCargaMensal(prev => ({ ...prev, ...cargasPorServidor }))
        setTetoCarga(prev => ({ ...prev, ...tetosPorServidor }))

        setAlertModal({
          isOpen: true,
          title: '⚠️ Teto Mensal Excedido',
          message: `Não é possível salvar: ${estouros.length === 1 ? 'um servidor ultrapassa' : `${estouros.length} servidores ultrapassam`} o teto do mês somando TODAS as escalas da competência.\n\n${estouros.slice(0, 8).join('\n')}${estouros.length > 8 ? `\n...e mais ${estouros.length - 8}.` : ''}\n\n${instrucaoSalvarBloqueado(userProfile?.role)}`,
          type: 'warning'
        })
        return
      }
    } catch (err) {
      console.error('Erro ao verificar o teto mensal consolidado:', err)
      setAlertModal({
        isOpen: true,
        title: 'Não foi possível conferir o teto mensal',
        message: 'A conferência do teto de horas do mês não pôde ser feita agora, e ela é a única defesa contra lançar acima do limite (não há trava no banco). Verifique a conexão e tente salvar de novo.',
        type: 'danger'
      })
      return
    }

    // Validação: Todas as Jornadas devem estar selecionadas
    const servidorSemJornada = escalaMensal.find(em => !em.jornada_id)
    if (servidorSemJornada) {
      setAlertModal({
        isOpen: true,
        title: 'Jornada Obrigatória',
        message: `O servidor ${servidorSemJornada.servidores?.nome || 'da lista'} não possui uma jornada de trabalho selecionada. Por favor, selecione a jornada para todos os servidores antes de salvar.`,
        type: 'warning'
      })
      return
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const validadorId = userProfile?.id || user?.id || null
      const allInserts: any[] = []
      
      escalaMensal.forEach(em => {
        const serverData = gridData[em.servidor_id]
        if (!serverData) return

        Object.entries(serverData).forEach(([categoria, days]) => {
          Object.entries(days).forEach(([day, turnoId]) => {
            if (turnoId) {
              allInserts.push({
                escala_mensal_id: em.id,
                dia: parseInt(day),
                dicionario_turnos_id: turnoId,
                categoria: categoria
              })
            }
          })
        })
      })

      // Update escala_mensal (jornadas)
      const updates = escalaMensal.map(em => ({
        id: em.id,
        mes: em.mes || mes,
        ano: em.ano || ano,
        unidade_id: em.unidade_id || unidadeId,
        setor_id: em.setor_id || setorId,
        servidor_id: em.servidor_id,
        jornada_id: em.jornada_id,
        status: em.status || 'Rascunho',
        updated_at: new Date().toISOString()
      }))

      const { error: emError } = await supabase
        .from('escala_mensal')
        .upsert(updates)

      if (emError) throw emError

      // 1. Buscar registros diários existentes para preservar presenças
      const emIds = escalaMensal.map(em => em.id)
      const { data: existingDailies } = await supabase
        .from('escala_diaria')
        .select('*')
        .in('escala_mensal_id', emIds)

      const existingMap = new Map()
      existingDailies?.forEach(ed => {
        existingMap.set(`${ed.escala_mensal_id}-${ed.categoria}-${ed.dia}`, ed)
      })

      const toUpdate: any[] = []
      const toInsert: any[] = []
      const processedKeys = new Set()
      const trocasDesatualizadas: string[] = []

      // 2. Mapear o que deve ser inserido/atualizado
      escalaMensal.forEach(em => {
        const serverData = gridData[em.servidor_id]
        if (!serverData) return

        Object.entries(serverData).forEach(([categoria, days]) => {
          Object.entries(days).forEach(([dayStr, turnoId]) => {
            const day = parseInt(dayStr)
            if (!turnoId) return

            const key = `${em.id}-${categoria}-${day}`
            const existing = existingMap.get(key)
            
            const localPresence = presenceData[em.servidor_id]?.[categoria as RowCategory]?.[day]
            const isLocalValidated = !!localPresence?.entrada

            let ent = existing?.presenca_entrada_em || null
            let sai = existing?.presenca_saida_em || null
            let intSai = existing?.presenca_intervalo_saida_em || null
            let intVolta = existing?.presenca_intervalo_retorno_em || null
            let conf = existing?.presenca_confirmada || false
            let confBy = existing?.confirmado_por_id || null
            // Flags de origem por passo. Preservam o valor existente por padrao — so viram
            // true quando ESTE save fabrica o horario a partir do previsto (nunca de uma
            // batida real), para a folha nao rotular como "Real" o que foi confirmado pela
            // grade sem marcacao. Ver CLAUDE.md, "presenca_*_manual" / origemMarcacao.ts.
            let entManual = existing?.presenca_entrada_manual || false
            let saiManual = existing?.presenca_saida_manual || false
            let intSaiManual = existing?.presenca_intervalo_saida_manual || false
            let intVoltaManual = existing?.presenca_intervalo_retorno_manual || false
            // Justificativa/confirmação são por LINHA (não por passo, ver
            // 20260807070000). Preservam o que já existe — se a linha já tinha sido validada
            // pelo modal de verdade (fn_confirmar_presenca_manual, com justificativa digitada
            // pelo coordenador), este save não pode sobrescrever isso com o texto automático.
            let justificativaManual = existing?.justificativa_manual || null
            let confirmacaoManual = existing?.confirmacao_manual || false

            if (isLocalValidated) {
              conf = true
              if (!confBy) {
                confBy = validadorId
              }
              // FONTE ÚNICA (Fase 3): o horário sintético gravado aqui tem que ser o MESMO que
              // o terminal considera previsto. Antes vinha da regra local da grade, que
              // discordava do backend — e aqui não é cosmético, isso vira timestamp em
              // escala_diaria. Usa o bloco do banco quando a célula já existe lá.
              const blocoSalvar = blocoDaCelula(em.servidor_id, categoria, day)
              if (blocoSalvar) {
                if (localPresence?.entrada && !ent) { ent = blocoSalvar.inicio_previsto; entManual = true }
                if (localPresence?.saida && !sai) { sai = blocoSalvar.fim_previsto; saiManual = true }
                if (localPresence?.intervalo_saida && !intSai) { intSai = blocoSalvar.intervalo_inicio_previsto; intSaiManual = true }
                if (localPresence?.intervalo_retorno && !intVolta) { intVolta = blocoSalvar.intervalo_fim_previsto; intVoltaManual = true }
              }

              const t = turnos.find(x => x.id === turnoId)
              if (t && (!ent || !sai)) {
                let startHour = getShiftStartHour(t.codigo, Number(t.horas_computadas))
                let endHourVal = getShiftEndHour(t.codigo, Number(t.horas_computadas))

                // Regular: o nome da jornada manda sobre a ancora do codigo do turno — mesma
                // prioridade de getShiftForecastTime (~linha 1864) e da fonte unica em SQL
                // (fn_blocos_previstos_dia). Sem isto, Regular usando um codigo que TAMBEM e
                // ancora de plantao no dicionario (ex.: "MT" = 07:00-19:00, 12h) herdava o
                // horario do plantao em vez do da propria jornada — bug relatado em 14/08/2026
                // com jornada "08H AS 17H" virando 07:00-19:00 na folha. CLAUDE.md armadilha 4.
                if (categoria === 'Regular' && em.jornada_id) {
                  const jornadaReg = jornadas.find((j: any) => j.id === em.jornada_id)
                  if (jornadaReg?.nome) {
                    const matchStart = jornadaReg.nome.match(/^([0-9]+)/)
                    if (matchStart) startHour = parseInt(matchStart[1], 10)
                    const matchEnd = jornadaReg.nome.match(/(?:ÀS|AS|as|às)\s*([0-9]+)/)
                    if (matchEnd) {
                      let parsedEnd = parseInt(matchEnd[1], 10)
                      if (parsedEnd < startHour) parsedEnd += 24
                      endHourVal = parsedEnd
                    }
                  }
                }

                if (localPresence?.entrada && !ent) {
                  // Construct entry ISO
                  ent = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:00:00-03:00`
                  entManual = true
                }

                if (localPresence?.saida && !sai) {
                  // Construct exit ISO
                  const endHourValNorm = endHourVal % 24
                  const dateObj = new Date(ano, mes - 1, day)
                  if (endHourVal >= 24) {
                    dateObj.setDate(dateObj.getDate() + 1)
                  }
                  const endYear = dateObj.getFullYear()
                  const endMonth = dateObj.getMonth() + 1
                  const endDay = dateObj.getDate()
                  sai = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}T${String(endHourValNorm).padStart(2, '0')}:00:00-03:00`
                  saiManual = true
                }
              }

              // Saída/retorno de intervalo (unidade com permite_marca_intervalo, ver isUnitInterval
              // ~linha 3827) — mesma fonte única de acima (getShiftForecastTime), que já implementa
              // a cascata personalizado do servidor → padrão da jornada → fallback início+4h, e
              // nunca inventa horário de intervalo quando o passo não existe pra este bloco (CLT
              // Art. 71). Sem isto, "validar dias passados" do Aplicar Template só gravava
              // entrada/saída mesmo em unidade com intervalo — a linha de indicadores mostrava os
              // 4 segmentos como confirmados na hora, mas nada de intervalo ia pro banco ao salvar.
              if (localPresence?.intervalo_saida && !intSai) {
                const hhmm = getShiftForecastTime(turnoId, 'intervalo_saida', em.servidor_id, categoria, day)
                if (hhmm) { intSai = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hhmm}:00-03:00`; intSaiManual = true }
              }
              if (localPresence?.intervalo_retorno && !intVolta) {
                const hhmm = getShiftForecastTime(turnoId, 'intervalo_retorno', em.servidor_id, categoria, day)
                if (hhmm) { intVolta = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hhmm}:00-03:00`; intVoltaManual = true }
              }

              // Justificativa automática, não digitada pelo coordenador. O ponto desta flag
              // (validar dias passados ao aplicar template) é exatamente dispensar justificar
              // cada marcação uma a uma — isso é o que separa este caminho do modal de
              // validação manual "de verdade" (fn_confirmar_presenca_manual), que exige
              // justificativa digitada por ser uma decisão pontual do coordenador. Aqui a
              // decisão é uma só (aplicar o template) e vale para todo o lote de uma vez.
              if (entManual || saiManual || intSaiManual || intVoltaManual) {
                confirmacaoManual = true
                if (!justificativaManual) {
                  justificativaManual = 'Ajuste automático — presença aplicada a partir do horário previsto ao validar dias passados no Aplicar Template.'
                }
              }
            }

            // Hora informada pelo coordenador. Vale para qualquer turno que a aceite — inclusive
            // o ancorado, onde ela é a sobreposição manual do nível 1. Precisa estar SEMPRE no
            // payload (mesmo null): o upsert monta o SET a partir das chaves enviadas, então
            // omitir a coluna faria a limpeza de uma hora nunca chegar ao banco. O banco recusa
            // hora em categoria Regular (chk_hora_prevista_nao_regular).
            const horaCel = gridHoras[em.servidor_id]?.[categoria as RowCategory]?.[day]
            const horaPrevista = permiteHoraInicio(categoria as RowCategory, turnoId) && horaCel
              ? `${horaCel.slice(0, 2)}:00:00`
              : null

            const item: any = {
              escala_mensal_id: em.id,
              dia: day,
              categoria: categoria,
              dicionario_turnos_id: turnoId,
              hora_inicio_prevista: horaPrevista,
              presenca_entrada_em: ent,
              presenca_saida_em: sai,
              presenca_intervalo_saida_em: intSai,
              presenca_intervalo_retorno_em: intVolta,
              presenca_entrada_manual: entManual,
              presenca_saida_manual: saiManual,
              presenca_intervalo_saida_manual: intSaiManual,
              presenca_intervalo_retorno_manual: intVoltaManual,
              justificativa_manual: justificativaManual,
              confirmacao_manual: confirmacaoManual,
              presenca_confirmada: conf,
              confirmado_por_id: confBy
            }

            // Aba desatualizada salvando por cima de uma troca de turno já aplicada no banco
            // (dobra feita em outra sessão, ou nesta mesma antes de recarregar). O trigger
            // trg_registrar_troca_turno recusaria a linha por falta de justificativa e o upsert
            // vai em LOTE: a exceção crua do Postgres derrubaria o mês inteiro de todo mundo.
            // Aqui a recusa é específica e diz o que recarregar. Ver armadilha 14 do CLAUDE.md.
            const existingTemPonto = !!existing && (
              !!existing.presenca_entrada_em || !!existing.presenca_saida_em ||
              !!existing.presenca_intervalo_saida_em || !!existing.presenca_intervalo_retorno_em ||
              existing.presenca_confirmada === true
            )
            if (existingTemPonto && existing.dicionario_turnos_id !== turnoId) {
              trocasDesatualizadas.push(
                `Dia ${day} — ${em.servidores?.nome || 'Servidor'} (${categoria}): a grade tem ${turnos.find(t => t.id === turnoId)?.codigo || '?'} e o banco já está com ${turnos.find(t => t.id === existing.dicionario_turnos_id)?.codigo || '?'}`
              )
            }

            if (existing?.id) {
              item.id = existing.id
              toUpdate.push(item)
            } else {
              toInsert.push(item)
            }

            processedKeys.add(key)
          })
        })
      })

      if (trocasDesatualizadas.length > 0) {
        setLoading(false)
        setAlertModal({
          isOpen: true,
          title: '⚠️ Escala Desatualizada nesta Tela',
          message: `O turno de ${trocasDesatualizadas.length} dia(s) com ponto registrado foi alterado no banco depois que esta tela carregou. Recarregue a página antes de salvar, para não desfazer a alteração.\n\n${trocasDesatualizadas.slice(0, 8).join('\n')}${trocasDesatualizadas.length > 8 ? `\n...e mais ${trocasDesatualizadas.length - 8}.` : ''}`,
          type: 'warning'
        })
        return
      }

      // 3. Identificar o que deve ser deletado (apenas se não houver presença)
      const idsToDelete = existingDailies
        ?.filter(ed => {
          const key = `${ed.escala_mensal_id}-${ed.categoria}-${ed.dia}`
          return !processedKeys.has(key) && !ed.presenca_entrada_em && !ed.presenca_saida_em
        })
        .map(ed => ed.id) || []

      // 4. Executar operações no banco separadamente para evitar erro de colunas nulas
      if (idsToDelete.length > 0) {
        const { error: delError } = await supabase.from('escala_diaria').delete().in('id', idsToDelete)
        if (delError) throw delError
      }

      if (toUpdate.length > 0) {
        const { error: updError } = await supabase.from('escala_diaria').upsert(toUpdate)
        if (updError) throw updError
      }

      if (toInsert.length > 0) {
        const { error: insError } = await supabase.from('escala_diaria').insert(toInsert)
        if (insError) throw insError
      }
      
      
      // O que acabou de ser gravado passa a ser a foto: sem isso o aviso de "alteracoes nao
      // salvas" continuaria aparecendo depois de salvar.
      setAssinaturaSalva(assinaturaDaGrade(gridData, gridHoras))

      setAlertModal({
        isOpen: true,
        title: 'Escala Salva',
        message: 'A previsão da escala foi salva com sucesso no banco de dados.',
        type: 'success'
      })
      logAction('SALVAR_PREVISAO_ESCALA', { 
        total_lancamentos: allInserts.length,
        total_servidores: escalaMensal.length
      })
      // Refresh local states
      const ids = escalaMensal.map(em => em.servidor_id)
      fetchOccupancy(ids)
      await fetchData()
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro ao Salvar',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddServer = async (servidorId: string) => {
    if (!servidorId) return
    setLoading(true)
    try {
      const servidor = todosServidoresSetor.find(s => s.id === servidorId)
      if (!servidor) return

      const { data, error } = await supabase
        .from('escala_mensal')
        .insert({
          servidor_id: servidorId,
          unidade_id: unidadeId,
          setor_id: setorId,
          mes,
          ano,
          status: 'Rascunho'
        })
        .select('*, servidores(*)')
        .single()

      if (error) throw error

      setEscalaMensal(prev => [...prev, data])
      logAction('ADICIONAR_SERVIDOR', { 
        servidor_id: servidorId,
        nome: data.servidores?.nome
      })
      setGridData(prev => ({
        ...prev,
        [servidorId]: {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      }))
      // Refresh occupancy for the new server
      const todosIds = [...escalaMensal.map(em => em.servidor_id), servidorId]
      fetchOccupancy(todosIds)

      // Avisar AGORA que a pessoa já tem carga em outra escala do mês. É o momento mais barato:
      // depois de lançar o mês inteiro dela aqui, a saída é apagar tudo de novo.
      const { cargas, tetos } = await fetchCargaMensal(todosIds)
      const aviso = avisoAoAdicionar(
        data.servidores?.nome || servidor.nome || 'Servidor',
        cargas[servidorId],
        tetos[servidorId]
      )
      if (aviso) {
        setAlertModal({
          isOpen: true,
          title: 'Servidor já escalado em outro lugar neste mês',
          message: aviso,
          type: 'warning'
        })
      }
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: 'Não foi possível adicionar o servidor: ' + error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddAll = async () => {
    const serversToAdd = servidoresElegiveisParaEscala.filter(s => !escalaMensal.some(em => em.servidor_id === s.id))
    if (serversToAdd.length === 0) return
    
    setLoading(true)
    try {
      const newRecords = serversToAdd.map(s => ({
        servidor_id: s.id,
        unidade_id: unidadeId,
        setor_id: setorId,
        mes,
        ano,
        status: 'Rascunho'
      }))

      const { data, error } = await supabase
        .from('escala_mensal')
        .insert(newRecords)
        .select('*, servidores(*)')

      if (error) throw error

      setEscalaMensal(prev => [...prev, ...data])
      logAction('ADICIONAR_TODOS_SERVIDORES', { 
        quantidade: data.length,
        servidores: data.map((em: any) => em.servidores?.nome)
      })
      
      const newGridData = { ...gridData }
      const newIds = data.map(em => em.servidor_id)
      data.forEach(em => {
        newGridData[em.servidor_id] = {
          'Regular': {},
          'Extra': {},
          'Plantão': {},
          'Sobreaviso': {}
        }
      })
      setGridData(newGridData)
      // Refresh occupancy for all
      const todosIds = [...escalaMensal.map(em => em.servidor_id), ...newIds]
      fetchOccupancy(todosIds)

      // Quem entrou já carregando horas de outra escala. Um por linha: "Adicionar Todos" traz
      // o setor inteiro, e um resumo agregado não diria de quem é o problema.
      const { cargas, tetos } = await fetchCargaMensal(todosIds)
      const jaCarregados = data
        .map((em: any) => ({
          nome: em.servidores?.nome || 'Servidor',
          aviso: avisoAoAdicionar(em.servidores?.nome || 'Servidor', cargas[em.servidor_id], tetos[em.servidor_id])
        }))
        .filter((x: any) => x.aviso)
      if (jaCarregados.length > 0) {
        setAlertModal({
          isOpen: true,
          title: `${jaCarregados.length} ${jaCarregados.length === 1 ? 'servidor já escalado' : 'servidores já escalados'} em outro lugar neste mês`,
          message: jaCarregados.map((x: any) => x.aviso).join('\n\n'),
          type: 'warning'
        })
      }
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        title: 'Erro',
        message: error.message,
        type: 'danger'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCloseScale = async () => {
    if (isCompetenciaEncerrada) {
      setAlertModal({
        isOpen: true,
        title: 'Competência Encerrada',
        message: 'Esta competência já foi encerrada e não permite alterações no status da escala.',
        type: 'warning'
      })
      return
    }

    if (escalaMensal.length === 0) {
      setAlertModal({
        isOpen: true,
        title: 'Escala Vazia',
        message: 'Adicione pelo menos um servidor à escala antes de finalizá-la.',
        type: 'warning'
      })
      return
    }

    // Validação de Dimensionamento (Regra Rígida - Mínimos e Máximos)
    const regraDimensionamento = configs['escala_regra_dimensionamento'] || 'flexivel'
    if (regraDimensionamento === 'rigida' && currentSector) {
      const minM = currentSector.servidores_manha_min || 0
      const minT = currentSector.servidores_tarde_min || 0
      const minN = currentSector.servidores_noite_min || 0

      const maxM = currentSector.servidores_manha_max || 0
      const maxT = currentSector.servidores_tarde_max || 0
      const maxN = currentSector.servidores_noite_max || 0

      const applyOnFdsFeriados = currentSector.dimensionamento_fds_feriados !== false

      const dimensioningViolations: string[] = []

      daysArray.forEach(day => {
        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
        const d = new Date(ano, mes - 1, day)
        const isWE = d.getDay() === 0 || d.getDay() === 6
        const isHoliday = feriados.some(f => f.data === dateStr)
        const isWeekendOrHoliday = isWE || isHoliday

        if (!isWeekendOrHoliday || applyOnFdsFeriados) {
          const countM = shiftTotals.M[day] || 0
          const countT = shiftTotals.T[day] || 0
          const countN = shiftTotals.N[day] || 0

          const violations = []
          // Check Min
          if (currentSector.servidores_manha_ideal > 0 && countM < minM) {
            violations.push(`Manhã: ${countM} (Mín: ${minM})`)
          }
          if (currentSector.servidores_tarde_ideal > 0 && countT < minT) {
            violations.push(`Tarde: ${countT} (Mín: ${minT})`)
          }
          if (currentSector.servidores_noite_ideal > 0 && countN < minN) {
            violations.push(`Noite: ${countN} (Mín: ${minN})`)
          }

          // Check Max
          if (currentSector.servidores_manha_ideal > 0 && maxM > 0 && countM > maxM) {
            violations.push(`Manhã: ${countM} (Máx: ${maxM})`)
          }
          if (currentSector.servidores_tarde_ideal > 0 && maxT > 0 && countT > maxT) {
            violations.push(`Tarde: ${countT} (Máx: ${maxT})`)
          }
          if (currentSector.servidores_noite_ideal > 0 && maxN > 0 && countN > maxN) {
            violations.push(`Noite: ${countN} (Máx: ${maxN})`)
          }

          if (violations.length > 0) {
            dimensioningViolations.push(`Dia ${day} (${violations.join(', ')})`)
          }
        }
      })

      if (dimensioningViolations.length > 0) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Erro de Dimensionamento (Regra Rígida)',
          message: `Não é possível fechar a escala. Há dias que não cumprem os limites mínimos ou máximos de servidores definidos para o setor:\n\n${dimensioningViolations.slice(0, 5).join('\n')}${dimensioningViolations.length > 5 ? `\n...e mais ${dimensioningViolations.length - 5} dias.` : ''}`,
          type: 'warning'
        })
        return
      }
    }
    // Validação: Todas as Jornadas devem estar selecionadas
    const servidorSemJornada = escalaMensal.find(em => !em.jornada_id)
    if (servidorSemJornada) {
      setAlertModal({
        isOpen: true,
        title: 'Jornada Obrigatória',
        message: `Não é possível fechar a escala pois o servidor ${servidorSemJornada.servidores?.nome || 'da lista'} não possui uma jornada de trabalho selecionada.`,
        type: 'warning'
      })
      return
    }

    // Validação: Justificativas Obrigatórias (se habilitado nas Configurações Globais)
    if (configs['justificativa_obrigatoria_fechar_escala'] === 'true') {
      const { data: pendencias } = await supabase.rpc('fn_contar_pendencias_justificativa', {
        p_unidade_id: unidadeId,
        p_setor_id: setorId,
        p_mes: mes,
        p_ano: ano
      })

      if (pendencias && pendencias > 0) {
        setAlertModal({
          isOpen: true,
          title: '⚠️ Justificativas Pendentes',
          message: `Não é possível fechar a escala. Existem ${pendencias} evento(s) de Hora Extra, Plantão ou Sobreaviso sem justificativa registrada no setor. Acesse o menu lateral em Justificativas ou clique no botão abaixo para regularizar.`,
          type: 'warning',
          action: {
            label: 'Regularizar Justificativas Agora',
            onClick: () => {
              sessionStorage.setItem('justificativa_filtro_unidade', unidadeId)
              sessionStorage.setItem('justificativa_filtro_setor', setorId)
              sessionStorage.setItem('justificativa_filtro_mes', String(mes))
              sessionStorage.setItem('justificativa_filtro_ano', String(ano))
              sessionStorage.setItem('justificativa_filtro_status', 'pendentes')
              router.push(`/justificativas?unidadeId=${unidadeId}&setorId=${setorId}&mes=${mes}&ano=${ano}&status=pendentes`)
            }
          }
        })
        return
      }
    }

    // Validação: Desfecho de plantão/sobreaviso (fase 5 do plano de 23/08/2026).
    //
    // ⚠️ CHAVE SEPARADA de `justificativa_obrigatoria_fechar_escala`, e não é preciosismo: a
    // outra já está LIGADA em produção, e reaproveitá-la ligaria este gate junto — com 132
    // plantões em avaliação em 08/2026, isso travaria o fechamento do mês no dia do deploy.
    // `desfecho_obrigatorio_fechar` nasce false (20260824160000) e só é ligada quando a fila
    // estiver tratada.
    //
    // "Justificativa" e "desfecho" são coisas diferentes: a primeira é o porquê do serviço
    // extraordinário; o segundo é se ele foi cumprido. Um evento pode ter texto escrito e
    // continuar sem decisão — em 08/2026 são 6 casos.
    if (configs['desfecho_obrigatorio_fechar'] === 'true') {
      const { data: desfechos } = await supabase.rpc('fn_desfecho_eventos_escalas', {
        p_escala_mensal_ids: escalaMensal.map(em => em.id),
        p_hoje: `${ano}-${String(mes).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
      })

      const pendentesDesfecho = (desfechos || []).filter((d: any) => d.estado === 'em_avaliacao')
      if (pendentesDesfecho.length > 0) {
        const porServidor = new Map<string, number[]>()
        pendentesDesfecho.forEach((d: any) => {
          const em = escalaMensal.find(x => x.id === d.escala_mensal_id)
          const nome = em?.servidores?.nome || 'Servidor'
          if (!porServidor.has(nome)) porServidor.set(nome, [])
          porServidor.get(nome)!.push(d.dia)
        })
        // A mensagem lista QUEM e QUAIS DIAS. "Existem 132 pendências" manda o coordenador
        // procurar sozinho; dizer os dias é a diferença entre um bloqueio e uma instrução.
        const linhas = Array.from(porServidor.entries())
          .slice(0, 6)
          .map(([nome, dias]) => `• ${nome}: dia(s) ${dias.sort((a, b) => a - b).join(', ')}`)
        const resto = porServidor.size > 6 ? `\n...e mais ${porServidor.size - 6} servidor(es).` : ''

        setAlertModal({
          isOpen: true,
          title: '⚠️ Plantões sem desfecho',
          message: `Não é possível fechar a escala. Existem ${pendentesDesfecho.length} plantão(ões)/sobreaviso(s) sem registro completo de ponto e sem decisão do coordenador:\n\n${linhas.join('\n')}${resto}\n\nAcesse o menu lateral em Justificativas (filtro "Em avaliação") ou clique no botão abaixo para validar ou registrar falta.`,
          type: 'warning',
          action: {
            label: 'Avaliar Plantões Pendentes Agora',
            onClick: () => {
              sessionStorage.setItem('justificativa_filtro_unidade', unidadeId)
              sessionStorage.setItem('justificativa_filtro_setor', setorId)
              sessionStorage.setItem('justificativa_filtro_mes', String(mes))
              sessionStorage.setItem('justificativa_filtro_ano', String(ano))
              sessionStorage.setItem('justificativa_filtro_status', 'em_avaliacao')
              router.push(`/justificativas?unidadeId=${unidadeId}&setorId=${setorId}&mes=${mes}&ano=${ano}&status=em_avaliacao`)
            }
          }
        })
        return
      }
    }

    setConfirmModal({
      isOpen: true,
      title: 'Fechar Escala',
      message: 'Deseja FECHAR esta escala? Uma escala fechada não permite mais edições manuais, apenas acionamentos de sobreaviso.',
      type: 'warning',
      onConfirm: async () => {
        setLoading(true)
        try {
          const ids = escalaMensal.map(em => em.id)
          await supabase.from('escala_mensal').update({ status: 'Fechada' }).in('id', ids)
          setEscalaMensal(prev => prev.map(em => ({ ...em, status: 'Fechada' })))
          logAction('FECHAR_ESCALA', { 
            ids_escala: ids,
            total_servidores: ids.length
          })
          setAlertModal({
            isOpen: true,
            title: 'Escala Fechada',
            message: 'A escala foi finalizada com sucesso.',
            type: 'success'
          })
        } catch (error: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro',
            message: error.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const handleReopenScale = async () => {
    if (isCompetenciaEncerrada) return
    setConfirmModal({
      isOpen: true,
      title: 'Reabrir Escala',
      message: 'Deseja REABRIR esta escala? Isso permitirá edições manuais novamente.',
      type: 'warning',
      onConfirm: async () => {
        setLoading(true)
        try {
          const ids = escalaMensal.map(em => em.id)
          await supabase.from('escala_mensal').update({ status: 'Rascunho' }).in('id', ids)
          setEscalaMensal(prev => prev.map(em => ({ ...em, status: 'Rascunho' })))
          logAction('REABRIR_ESCALA', { 
            ids_escala: ids,
            total_servidores: ids.length
          })
          setAlertModal({
            isOpen: true,
            title: 'Escala Reaberta',
            message: 'A escala foi reaberta para edições.',
            type: 'success'
          })
        } catch (error: any) {
          setAlertModal({
            isOpen: true,
            title: 'Erro',
            message: error.message,
            type: 'danger'
          })
        } finally {
          setLoading(false)
          setConfirmModal(null)
        }
      }
    })
  }

  const endOfMonth = new Date(ano, mes, 0)
  const thresholdDate = new Date(endOfMonth)
  thresholdDate.setDate(thresholdDate.getDate() + (diasInativacao || 5))
  const isAutoInactivated = new Date() > thresholdDate

  const isInactive = escalaMensal[0]?.ativo === false || isAutoInactivated
  const isComum = userProfile?.role === 'comum' || userProfile?.role === 'servidor'

  // Quem pode validar presenca manualmente, celula a celula. RH Geral e RH da Unidade entram
  // aqui (20/08/2026): e o papel que apura a folha e precisa justificar quem esqueceu de bater.
  // O banco nunca os barrou - fn_validar_presenca_manual e SECURITY DEFINER com GRANT a
  // `authenticated`, e a RLS de escala_diaria reconhece os dois desde 20260812070000. O unico
  // bloqueio era este gate de tela, e o sintoma era clicar no segmento e nada acontecer, sem
  // erro nenhum.
  const isAdminRole = userProfile?.role === 'admin' || userProfile?.role === 'super_admin'
  const isRh = userProfile?.role === 'rh' || userProfile?.role === 'rh_unidade'
  const podeValidarPresenca = isAdminRole || isRh
    || userProfile?.role === 'coordenador' || userProfile?.role === 'ass_adm'
  // isClosed embute governanceLock (prazo de planejamento) e isInactive - regras sobre a
  // PREVISAO da escala, nao sobre apurar presenca do que ja passou. RH e COORDENADOR
  // acompanham admin aqui (decisao do usuario, 20/08/2026): apurar o ponto depois do dia
  // limite, ou de um mes ja virado, e justamente o trabalho deles - sem isto o coordenador
  // perdia a validacao manual do mes corrente a partir do dia limite de planejamento, pelo
  // mesmo `return` mudo. ass_adm NAO entra, por decisao do usuario na mesma data.
  // Competencia encerrada e escala Fechada continuam barrando todo mundo, nos dois primeiros
  // termos de canEditPresence.
  const ignoraTravaDePrevisao = isAdminRole || isRh || userProfile?.role === 'coordenador'
  
  const closedPeriodsRaw = configsGlobais?.find(c => c.chave === 'competencias_encerradas')?.valor
  const closedPeriods = Array.isArray(closedPeriodsRaw) ? closedPeriodsRaw : []
  const isCompetenciaEncerrada = closedPeriods.some((p: any) => p.mes === mes && p.ano === ano)

  const deadlineDay = parseInt(configs['dia_limite_planejamento'] || '10')
  const governanceLock = canEditScale({
    role: userProfile?.role as UserRole,
    scaleMonth: mes,
    scaleYear: ano,
    deadlineDay
  })

  const isStatusFechada = escalaMensal.length > 0 && escalaMensal.every(em => em.status === 'Fechada')
  const isClosed = isStatusFechada || isInactive || isComum || !governanceLock.canEdit || isCompetenciaEncerrada

  // Sort escalaMensal alphabetically by server name
  const sortedEscalaMensal = useMemo(() => {
    return [...escalaMensal].sort((a, b) => {
      const nameA = a.servidores?.nome || ''
      const nameB = b.servidores?.nome || ''
      return nameA.localeCompare(nameB, 'pt-BR')
    })
  }, [escalaMensal])

  // Filter scales for common users
  const visibleEscalaMensal = useMemo(() => {
    if (isComum && linkedServidorId) {
      return sortedEscalaMensal.filter(em => em.servidor_id === linkedServidorId)
    }
    return sortedEscalaMensal
  }, [isComum, linkedServidorId, sortedEscalaMensal])

  return (
    <>
      <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden print:hidden">
      {isInactive && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-amber-700 dark:text-amber-500 text-xs font-bold uppercase tracking-tight">
          <Lock className="h-4 w-4" />
          Escala Inativa {isAutoInactivated ? '(Inativação Automática por Prazo)' : '(Inativada Manualmente)'} - Modo de Visualização Ativado
        </div>
      )}

      {!governanceLock.canEdit && !isInactive && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-200 dark:border-indigo-800 px-4 py-2 flex items-center gap-2 text-indigo-700 dark:text-indigo-400 text-xs font-bold uppercase tracking-tight">
          <Lock className="h-4 w-4" />
          {governanceLock.reason} - Modo de Somente Leitura Ativado
        </div>
      )}

      {/* Navegacao entre escalas: percorre a mesma sequencia da lista de onde o usuario veio,
          e o botao da esquerda devolve a lista COM os filtros que ele tinha. Fica fora do
          `!isComum` de proposito -- quem so consulta tambem precisa do caminho de volta. */}
      <NavegacaoEscalas
        unidadeId={unidadeId}
        setorId={setorId}
        mes={mes}
        ano={ano}
        userProfile={userProfile}
        gradeAlterada={gradeAlterada}
      />

      {/* Toolbar */}
      {!isComum && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex items-center space-x-4">
            <select 
              onChange={(e) => {
                const val = e.target.value
                if (val === 'all') {
                  handleAddAll()
                } else if (val === 'external') {
                  // Abre sempre limpo: reabrir com a escolha anterior ainda no campo já fez
                  // alguém adicionar a pessoa errada por não reparar no que estava selecionado.
                  setExternalData({ unidadeId: '', setorId: '', servidorId: '' })
                  setExternalEncontrado(null)
                  setIsExternalModalOpen(true)
                } else if (val) {
                  handleAddServer(val)
                }
              }}
              value=""
              disabled={loading || isClosed}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
            >
              <option value="">+ Adicionar Servidor...</option>
              
              <optgroup label="Ações Rápidas">
                <option value="all" disabled={servidoresElegiveisParaEscala.every(s => escalaMensal.some(em => em.servidor_id === s.id))}>
                  👥 Adicionar Todos do Setor
                </option>
                <option value="external">
                  🌍 Servidor Externo...
                </option>
              </optgroup>

              <optgroup label="Servidores do Setor">
                {servidoresElegiveisParaEscala
                  .filter(s => !escalaMensal.some(em => em.servidor_id === s.id))
                  .map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))
                }
              </optgroup>
            </select>
            
            <button
              onClick={handleClearScale}
              disabled={loading || isClosed}
              className="inline-flex items-center rounded-md border border-red-200 text-red-600 px-3 py-2 text-sm font-medium hover:bg-red-50 dark:border-red-900/30 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Limpar Escala
            </button>

            <button
              onClick={() => {
                if (escalaMensal.length === 0) {
                  setAlertModal({ isOpen: true, title: 'Sem Servidores', message: 'Adicione pelo menos um servidor à grade antes de usar o Gerador Inteligente.', type: 'warning' })
                  return
                }
                setIntelligentModal({
                  isOpen: true,
                  respectContinuity: true,
                  respectEvents: true,
                  respectPreferences: true,
                  // Regular e Plantão vêm marcados; Extra e Sobreaviso não. O backtest de
                  // 25/08/2026 mediu 57,5% de precisão no Extra — 43% da hora extra que ele
                  // sugeriria nunca aconteceu — e 33,3% no Sobreaviso. Sugerir sobrejornada
                  // por padrão é o tipo de erro que ninguém revisa.
                  categorias: ['Regular', 'Plantão'],
                  mesesHistorico: MESES_HISTORICO_PADRAO,
                  quantidadeMeses: 1
                })
              }}
              disabled={loading || isClosed}
              className="inline-flex items-center rounded-md border border-indigo-200 text-indigo-700 bg-indigo-50/50 px-3 py-2 text-sm font-medium hover:bg-indigo-100 dark:border-indigo-800 dark:text-indigo-400 dark:bg-indigo-950/20 transition-colors disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4 mr-2 text-indigo-500 animate-pulse" />
              Gerador Inteligente
            </button>

            <button
              onClick={() => {
                if (escalaMensal.length === 0) {
                  setAlertModal({ isOpen: true, title: 'Sem Servidores', message: 'Adicione pelo menos um servidor à grade antes de aplicar um template.', type: 'warning' })
                  return
                }
                const normalTurnos = turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Normal'))
                const defaultTurnId = normalTurnos.find(t => t.codigo === 'MT')?.id || normalTurnos[0]?.id || turnos[0]?.id || ''
                setTemplateModal({
                  isOpen: true,
                  servidorId: escalaMensal[0]?.servidor_id || '',
                  templateType: '12x36',
                  turnoId: defaultTurnId,
                  startDay: 1,
                  startWorking: true,
                  validatePastDays: false
                })
              }}
              disabled={loading || isClosed}
              className="inline-flex items-center rounded-md border border-purple-200 text-purple-700 px-3 py-2 text-sm font-medium hover:bg-purple-50 dark:border-purple-800 dark:text-purple-400 transition-colors disabled:opacity-50"
            >
              <LayoutTemplate className="h-4 w-4 mr-2" />
              Aplicar Template
            </button>

            {!isComum && (
              <button
                onClick={() => {
                  if (escalaMensal.length === 0) {
                    setAlertModal({ isOpen: true, title: 'Sem Servidores', message: 'Adicione pelo menos um servidor à grade antes de realizar a validação em massa.', type: 'warning' })
                    return
                  }
                  setBulkGlobalModal({
                    isOpen: true,
                    selectedServidorIds: escalaMensal.map(em => em.servidor_id),
                    startDay: 1,
                    endDay: Math.min(daysInMonth, maxValidDay || 1),
                    modo: 'completo',
                    categorias: ['Regular', 'Plantão'],
                    justificativa: ''
                  })
                }}
                disabled={loading || isClosed}
                className="inline-flex items-center rounded-md border border-emerald-300 text-emerald-700 bg-emerald-50/50 px-3 py-2 text-sm font-bold hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400 dark:bg-emerald-950/20 transition-all disabled:opacity-50"
              >
                <CheckSquare className="h-4 w-4 mr-2 text-emerald-600" />
                ⚡ Validar em Massa
              </button>
            )}
          </div>
          
          <div className="flex items-center space-x-3">
            {complianceCount > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-bold animate-in fade-in">
                <AlertTriangle className="h-3.5 w-3.5" />
                {complianceCount} {complianceCount === 1 ? 'alerta' : 'alertas'} de compliance
              </div>
            )}
            <button onClick={() => window.print()} className="inline-flex items-center rounded-md bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50">
              <FileText className="mr-2 h-4 w-4" /> Gerar PDF
            </button>
            
            <button onClick={handleSave} disabled={loading || isCompetenciaEncerrada || escalaMensal[0]?.status === 'Fechada' || (isClosed && !podeEditarForaDoPrazo(userProfile?.role))} className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-all disabled:opacity-50">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Previsão
            </button>
            {!isStatusFechada && !isCompetenciaEncerrada && (
              <button 
                onClick={handleCloseScale} 
                disabled={loading || escalaMensal.length === 0} 
                className="inline-flex items-center rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 shadow-sm hover:bg-black dark:hover:bg-white transition-all cursor-pointer disabled:opacity-50"
              >
                <Lock className="mr-2 h-4 w-4" /> Fechar Escala
              </button>
            )}
            {isStatusFechada && !isCompetenciaEncerrada && podeEditarForaDoPrazo(userProfile?.role) && (
              <button 
                onClick={handleReopenScale} 
                disabled={loading} 
                className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 transition-all cursor-pointer"
              >
                <Unlock className="mr-2 h-4 w-4" /> Reabrir Escala
              </button>
            )}
          </div>
        </div>
      )}

      {/* Painel de Solicitações de Troca */}
      {!isComum && (
        <SwapRequestPanel
          unidadeId={unidadeId}
          setorId={setorId}
          mes={mes}
          ano={ano}
          isClosed={isClosed}
        />
      )}

      <div className="flex-1 overflow-auto no-print">
        <table className="w-full border-collapse text-[10px] table-fixed">
          <thead className="sticky top-0 z-20 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
            <tr>
              <th className="sticky left-0 z-30 bg-zinc-100 dark:bg-zinc-800 p-2 border border-zinc-200 dark:border-zinc-700 text-left w-[180px]">Servidor</th>
              <th className="sticky left-[180px] z-30 bg-zinc-100 dark:bg-zinc-800 p-2 border border-zinc-200 dark:border-zinc-700 w-[100px]">Tipo</th>
              {daysArray.map(day => {
                const d = new Date(ano, mes - 1, day)
                const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                const isWE = d.getDay() === 0 || d.getDay() === 6
                const feriado = feriados.find(f => f.data === dateStr)
                const isHoliday = !!feriado

                return (
                  <th
                    key={day}
                    className={`p-1 border border-zinc-200 dark:border-zinc-700 min-w-[44px] w-[44px] text-center ${isHoliday ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : isWE ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`}
                    title={feriado?.descricao}
                  >
                    {day}
                    <div className="text-[8px] opacity-75">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()]}</div>
                  </th>
                )
              })}
              {!isTotalsCollapsed && (
                <>
                  <th className="sticky right-[296px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">CH</th>
                  <th className="sticky right-[258px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE100</th>
                  <th className="sticky right-[220px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">HE50</th>
                  <th className="sticky right-[182px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL12</th>
                  <th className="sticky right-[144px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL6</th>
                  <th className="sticky right-[106px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">PL4</th>
                  <th className="sticky right-[68px] z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[38px] bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-blue-100" title="Sobreaviso (Quantidade de Unidades)">SOB (Qtd)</th>
                </>
              )}
              <th className="sticky right-0 z-30 p-1 border border-zinc-200 dark:border-zinc-700 w-[68px] bg-amber-400 text-black font-black uppercase leading-tight text-[8px] whitespace-nowrap relative select-none">
                <button
                  type="button"
                  onClick={toggleTotals}
                  className="absolute -left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-650 shadow-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all hover:scale-105 active:scale-95 cursor-pointer z-50"
                  title={isTotalsCollapsed ? "Expandir resumo de horas" : "Recolher resumo de horas"}
                >
                  {isTotalsCollapsed ? (
                    <ChevronLeft className="h-3 w-3 stroke-[2.5]" />
                  ) : (
                    <ChevronRight className="h-3 w-3 stroke-[2.5]" />
                  )}
                </button>
                <div className="pl-1">
                  TOTAL<br/>H/MÊS
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const gridStartRange = `${ano}-${mes.toString().padStart(2, '0')}-01`
              const gridEndRange = `${ano}-${mes.toString().padStart(2, '0')}-${daysInMonth.toString().padStart(2, '0')}`
              return visibleEscalaMensal.map(em => {
                const totals = calculateTotals(em.servidor_id)
                // Carga do MÊS (esta escala + as outras da competência) contra o teto da pessoa.
                const cargaMes = avaliarCargaDoServidor(em.servidor_id)
                const categories: RowCategory[] = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']
                const isExternal = em.servidores?.unidade_id !== unidadeId || em.servidores?.setor_id !== setorId
                const serverTempJourneys = jornadasTemporarias.filter(jt => 
                  jt.servidor_id === em.servidor_id &&
                  jt.data_inicio <= gridEndRange &&
                  jt.data_fim >= gridStartRange
                )
                const hasTempJourney = serverTempJourneys.length > 0
              
              return (
                <React.Fragment key={em.id}>
                  {categories.map((cat, catIdx) => (
                    <tr key={`${em.id}-${cat}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 group">
                      {catIdx === 0 && (
                        <td rowSpan={4} className="sticky left-0 z-10 bg-white dark:bg-zinc-900 p-2 border border-zinc-200 dark:border-zinc-700 font-bold align-top text-zinc-900 dark:text-zinc-100">
                          <div className="flex items-start justify-between gap-1 max-w-full">
                            <button
                              type="button"
                              onClick={() => handleNavigateToFolha(em)}
                              disabled={navigatingFolhaId === em.servidor_id}
                              className="leading-tight break-words text-[11px] font-bold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline text-left transition-colors cursor-pointer group/name flex items-center gap-1.5 pr-1"
                              title={`Clique para abrir a Folha de Ponto de ${em.servidores?.nome} (${(em.mes || mes).toString().padStart(2, '0')}/${em.ano || ano})`}
                            >
                              {navigatingFolhaId === em.servidor_id ? (
                                <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                              ) : null}
                              <span>{em.servidores?.nome}</span>
                              <ExternalLink className="h-3 w-3 opacity-0 group-hover/name:opacity-100 text-blue-500 transition-opacity shrink-0" />
                            </button>
                            <div className="flex items-center gap-1 shrink-0 mt-0.5">
                              {!isComum && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setBulkServerModal({
                                      isOpen: true,
                                      servidorId: em.servidor_id,
                                      servidorNome: em.servidores?.nome || 'Servidor',
                                      escalaMensalId: em.id,
                                      startDay: 1,
                                      endDay: Math.min(daysInMonth, maxValidDay || 1),
                                      modo: 'completo',
                                      categorias: ['Regular', 'Plantão'],
                                      justificativa: ''
                                    })
                                  }}
                                  className="p-1 text-emerald-700 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-950/70 hover:bg-emerald-200 dark:hover:bg-emerald-900 rounded border border-emerald-300 dark:border-emerald-800 transition-colors shadow-xs"
                                  title="Validar Presenças deste Servidor por Período"
                                >
                                  <CheckSquare className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {hasTempJourney && (
                                <span 
                                  className="inline-flex items-center" 
                                  title={`Possui jornada temporária cadastrada:\n${serverTempJourneys.map(jt => `${jt.jornadas?.nome} (De ${formatarData(jt.data_inicio)} até ${formatarData(jt.data_fim)})`).join('\n')}`}
                                >
                                  <Clock className="h-3.5 w-3.5 text-amber-500 fill-amber-500/10 cursor-help" />
                                </span>
                              )}
                              {hasConfirmedPresence(em.servidor_id, em.id) && (
                                <span title="Escala Protegida: Contém registros de presença">
                                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                                </span>
                              )}
                              {isExternal && (
                                <span title="Servidor Externo">
                                  <Globe className="h-3.5 w-3.5 text-blue-500" />
                                </span>
                              )}
                              {(() => {
                                const excecao = excecoesEscala.find(e => e.servidor_id === em.servidor_id)
                                const podeAutorizar = podeAutorizarCarga(userProfile?.role)
                                const pedido = pedidosPendentes[em.servidor_id]
                                if (excecao) {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (podeAutorizar) {
                                          setAutorizacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        }
                                      }}
                                      className="p-1 text-amber-700 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-950/70 hover:bg-amber-200 dark:hover:bg-amber-900 rounded border border-amber-300 dark:border-amber-800 transition-colors shadow-xs"
                                      title={`Autorização Extraordinária Vigente:\n+${excecao.horas_adicionais_autorizadas}h adicionais\n+${excecao.sobreavisos_adicionais_autorizados} sobreavisos adicionais\nMotivo: ${excecao.motivo_justificativa}`}
                                    >
                                      <Shield className="h-3.5 w-3.5 fill-amber-500/20" />
                                    </button>
                                  )
                                }
                                // Sem autorização e acima do teto do MÊS: o alerta precisa estar
                                // na linha do servidor, não só no momento do lançamento. É por
                                // aqui que o administrador abre a autorização depois de o
                                // "Salvar Previsão" recusar o lote.
                                if (cargaMes.excede) {
                                  const resumo = descreverExcesso(cargaMes, em.servidores?.nome || 'Servidor')
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const aviso = mensagemTetoExcedido(resumo, userProfile?.role, pedido)
                                        if (aviso.acao === 'autorizar' && !pedido) {
                                          setAutorizacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        } else if (aviso.acao === 'solicitar' && !pedido) {
                                          setSolicitacaoModalState({
                                            isOpen: true,
                                            servidorId: em.servidor_id,
                                            servidorNome: em.servidores?.nome || 'Servidor',
                                            horasAtuais: totals.totalPlanejado,
                                            sobreavisosAtuais: totals.p_soQtd
                                          })
                                        } else {
                                          setAlertModal({
                                            isOpen: true,
                                            title: aviso.titulo,
                                            message: aviso.mensagem,
                                            type: 'warning'
                                          })
                                        }
                                      }}
                                      className={`p-1 rounded border transition-colors shadow-xs ${
                                        pedido
                                          ? 'text-blue-700 dark:text-blue-300 bg-blue-100/80 dark:bg-blue-950/70 hover:bg-blue-200 dark:hover:bg-blue-900 border-blue-300 dark:border-blue-800'
                                          : 'text-red-700 dark:text-red-300 bg-red-100/80 dark:bg-red-950/70 hover:bg-red-200 dark:hover:bg-red-900 border-red-300 dark:border-red-800'
                                      }`}
                                      title={`${resumo}\n\n${
                                        pedido
                                          ? `Pedido de autorização em análise${pedido.solicitado_por_nome ? ` (aberto por ${pedido.solicitado_por_nome})` : ''}.`
                                          : podeAutorizar
                                            ? 'Clique para autorizar excepcionalmente.'
                                            : 'Clique para solicitar autorização ao RH.'
                                      }`}
                                    >
                                      {/* Azul = pedido em análise; vermelho = ninguém pediu nada
                                          ainda. A cor precisa distinguir "travado e parado" de
                                          "travado e em andamento" — sem isso, quem já pediu vê o
                                          mesmo alerta do primeiro dia e pede de novo. */}
                                      <ShieldAlert className="h-3.5 w-3.5 fill-red-500/20" />
                                    </button>
                                  )
                                }
                                return null
                              })()}
                            </div>
                          </div>
                          <div className="text-[8px] font-normal text-zinc-600 dark:text-zinc-400 uppercase">{em.servidores?.cargo}</div>
                          {isExternal && (
                            <div className="text-[8px] text-blue-600 dark:text-blue-400 font-medium italic mt-1 leading-tight">
                              Origem: {allUnidades.find(u => u.id === em.servidores?.unidade_id)?.nome || '...'}
                              <br />
                              {allSetores.find(s => s.id === em.servidores?.setor_id)?.nome || '...'}
                            </div>
                          )}

                          {!isClosed && !hasConfirmedPresence(em.servidor_id, em.id) && (
                            <button
                              onClick={() => handleRemoveServer(em.id, em.servidor_id)}
                              className="mt-2 text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                              title="Remover Servidor da Escala"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      )}
                      <td className={`sticky left-[180px] z-10 p-1 border border-zinc-200 dark:border-zinc-700 font-bold uppercase text-zinc-800 dark:text-zinc-200 ${cat === 'Extra' ? 'bg-zinc-50 dark:bg-zinc-800/50' : 'bg-white dark:bg-zinc-900'}`}>
                        {cat === 'Regular' ? (
                          <select
                            value={em.jornada_id || ''}
                            onChange={(e) => {
                              const newJornadaId = e.target.value
                              // A jornada do mes vale para TODOS os dias: trocar aqui reavalia
                              // tambem os ja trabalhados. Com ponto registrado, a escolha entre
                              // "mudou a partir de X" e "estava errada desde o dia 1" e de quem
                              // sabe o que aconteceu — ver AlterarJornadaModal.
                              const dias = diasComBatidaDoServidor(em.servidor_id)
                              if (newJornadaId && em.jornada_id && newJornadaId !== em.jornada_id && dias.length > 0) {
                                setJornadaModalAlvo({
                                  escalaMensalId: em.id,
                                  servidorId: em.servidor_id,
                                  servidorNome: em.servidores?.nome || 'servidor',
                                  jornadaAtualId: em.jornada_id,
                                  jornadaAtualNome: jornadas.find(j => j.id === em.jornada_id)?.nome || '—',
                                  jornadaNovaId: newJornadaId,
                                  jornadaNovaNome: jornadas.find(j => j.id === newJornadaId)?.nome || '—',
                                  diasComBatida: dias,
                                })
                                return
                              }
                              setEscalaMensal(prev => prev.map(item =>
                                item.id === em.id ? { ...item, jornada_id: newJornadaId } : item
                              ))
                            }}
                            // Mesmo guard das celulas de turno. O seletor de jornada nunca teve
                            // um: dava para trocar a jornada de uma escala Fechada ou de
                            // competencia encerrada na tela (o Salvar e que barrava depois).
                            disabled={isCompetenciaEncerrada || escalaMensal[0]?.status === 'Fechada' || (isClosed && !podeEditarForaDoPrazo(userProfile?.role))}
                            className={`w-full ${!em.jornada_id ? 'bg-red-50 dark:bg-red-900/10 text-red-500 animate-pulse' : 'bg-transparent'} border-none outline-none text-[10px] font-bold uppercase focus:ring-1 focus:ring-blue-500 rounded p-0 transition-colors disabled:opacity-60 disabled:cursor-not-allowed`}
                          >
                            <option value="">Selecione...</option>
                            {jornadas.filter(j => j.ativo || j.id === em.jornada_id).map(j => (
                              <option key={j.id} value={j.id}>{j.nome} {!j.ativo ? '(Inativo)' : ''}</option>
                            ))}
                          </select>
                        ) : cat === 'Extra' ? 'EXTRAS' : cat === 'Plantão' ? 'PLANTÕES' : 'SOBREAVISO'}
                      </td>
                      {daysArray.map(day => {
                        const turnoId = gridData[em.servidor_id]?.[cat]?.[day] || ''
                        const turno = turnos.find(t => t.id === turnoId)
                        const d = new Date(ano, mes - 1, day)
                        const isWE = d.getDay() === 0 || d.getDay() === 6
                        const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
                        const feriado = feriados.find(f => f.data === dateStr)
                        const isHoliday = !!feriado
                        
                        let isTriggerAllowed = false
                        if (cat === 'Sobreaviso' && turno) {
                          const now = new Date()
                          let startHour = 7
                          let endHour = 16 // Padrão para MT: 07h às 16h
                          let endDayOffset = 0
                      
                          const code = turno.codigo || ''
                          if (code.startsWith('MTN')) {
                            startHour = 7
                            endHour = 7
                            endDayOffset = 1
                          } else if (code.startsWith('N')) {
                            startHour = 19
                            endHour = 7
                            endDayOffset = 1
                          } else if (code.startsWith('T')) {
                            startHour = 13
                            endHour = 19
                            endDayOffset = 0
                          } else if (code.startsWith('M') && !code.startsWith('MT')) {
                            startHour = 7
                            endHour = 13
                            endDayOffset = 0
                          } else if (code.startsWith('D') || code.startsWith('MT')) {
                            startHour = 7
                            endHour = (code === 'MT') ? 16 : 19
                            endDayOffset = 0
                          }
                      
                          const start = new Date(ano, mes - 1, day, startHour, 0, 0)
                          const end = new Date(ano, mes - 1, day + endDayOffset, endHour, 0, 0)
                      
                          isTriggerAllowed = now >= start && now < end
                        }

                        const { status: effectiveStatus, reason: virtualReason, log: logForDay } = cat === 'Sobreaviso' 
                          ? getStatusForDay(day, em.id, 'Sobreaviso') 
                          : { status: null, reason: null, log: null }

                        const cellLogs = logsSobreaviso.filter((l: any) => l.escala_mensal_id === em.id && l.dia === day && (l.categoria === 'Sobreaviso' || !l.categoria))
                        const latestLog = cellLogs.length > 0 ? cellLogs[cellLogs.length - 1] : logForDay
                        const currentOvercallStatus = latestLog ? latestLog.status : effectiveStatus

                        // Check for REAL external conflicts (different unit/sector)
                        const realExternalShifts = (externalOccupancy || []).filter((o: any) => 
                          o && o.servidor_id === em.servidor_id && 
                          o.dia === day && 
                          o.escala_mensal_id !== em.id
                        )
                        
                        // Current turno in THIS grid
                        const currentTurno = turnos.find(t => t.id === turnoId)
                        const currentSlots = currentTurno?.slots || []
                        
                        // Does it overlap with external? (Time-based conflict)
                        const hasExternalConflict = realExternalShifts.some((os: any) => 
                          Array.isArray(os.slots) && os.slots.some((s: string) => currentSlots.includes(s))
                        )
                        
                        // Is the server busy elsewhere IN THIS SPECIFIC CATEGORY?
                        const isBusyElsewhere = realExternalShifts.some((os: any) => 
                          os.categoria && cat && os.categoria.toLowerCase().trim() === cat.toLowerCase().trim()
                        )
                        
                        // Tooltip details
                        const externalBusyDetails = realExternalShifts
                          .filter((os: any) => os.categoria === cat)
                          .map((os: any) => os.descricao_conflito)
                          .join(' | ')

                        const realConflictDetails = realExternalShifts
                          .filter(os => os.slots.some((s: string) => currentSlots.includes(s)))
                          .map(os => os.descricao_conflito)
                          .join(' | ')

                        const isFailed = currentOvercallStatus === 'Falhou' || effectiveStatus === 'Falhou'
                        // Hide trigger button if currently pending (Accepted/Waiting)
                        if (currentOvercallStatus === 'Aceito' || currentOvercallStatus === 'Aguardando' || effectiveStatus === 'Aceito' || effectiveStatus === 'Aguardando') {
                          isTriggerAllowed = false
                        }
                        const eventosDoDia = getEventosDoDia(em.servidor_id, day)
                        const activeEvent = eventosDoDia[0] || null
                        const dayTempJourney = serverTempJourneys.find(jt => dateStr >= jt.data_inicio && dateStr <= jt.data_fim)
                        const blockingEvents = getAfastamentosBloqueantes(em.servidor_id, day, cat, currentSlots)
                        const blockingEvent = blockingEvents[0] || null
                        const isCellBlockedByEvent = !!blockingEvent
                        // Sigla do primeiro mais o quanto sobrou: o `+1` denuncia o segundo
                        // lancamento, que a celula nao tem largura para escrever.
                        const eventAbbr = blockingEvent
                          ? `${siglaAfastamento(blockingEvent)}${blockingEvents.length > 1 ? `+${blockingEvents.length - 1}` : ''}`
                          : ''

                        return (
                          <td 
                            key={day} 
                            className={`p-0 border border-zinc-200 dark:border-zinc-700 text-center relative 
                              ${isCellBlockedByEvent ? '' : (isHoliday ? 'bg-red-50 dark:bg-red-900/10' : isWE ? 'bg-zinc-50 dark:bg-zinc-800/50' : '')} 
                              ${isFailed ? 'bg-red-100 dark:bg-red-900/30' : ''} 
                              ${hasExternalConflict ? 'ring-1 ring-inset ring-red-500' : ''}
                              ${(presenceData[em.servidor_id]?.[cat]?.[day]?.entrada || presenceData[em.servidor_id]?.[cat]?.[day]?.saida || effectiveStatus === 'Chegou') ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}
                            title={
                              `${dayTempJourney ? `🕒 Jornada Temporária Ativa: ${dayTempJourney.jornadas?.nome}\n` : ''}${
                              isCellBlockedByEvent 
                                ? `⚠️ BLOQUEADO: Servidor em afastamento — ${blockingEvents.map(rotuloAfastamento).join(' | ')}`
                                : hasExternalConflict 
                                  ? `⚠️ CONFLITO REAL: ${realConflictDetails}` 
                                  : isBusyElsewhere
                                    ? `ℹ️ Servidor já escalado em: ${externalBusyDetails}`
                                    : isFailed 
                                      ? `FALHOU: ${logForDay?.motivo_falha || virtualReason || 'Tempo expirado'} — registrado como FALTA no relatório, salvo se o coordenador validar em Justificativas` 
                                      : isHoliday
                                        ? `🎉 Feriado: ${feriado?.descricao}`
                                        : activeEvent
                                          ? `ℹ️ Servidor em afastamento — ${eventosDoDia.map(ev => `${rotuloAfastamento(ev)}${(ev.periodo_tipo === 'horas' || ev.hora_inicio) ? ' (por horas, não bloqueia a escala do dia)' : ' (alocação permitida nesta linha)'}`).join(' | ')}`
                                          : ''
                              }`
                            }
                          >
                            {isCellBlockedByEvent ? (
                              <div 
                                className="w-full h-full flex items-center justify-center text-[9px] font-black text-white cursor-not-allowed select-none px-0.5 py-2"
                                style={{ backgroundColor: blockingEvent!.tipos_eventos?.cor || '#EF4444' }}
                              >
                                {eventAbbr}
                              </div>
                            ) : (
                              <div className="relative w-full h-full">
                                {dayTempJourney && (
                                  <div 
                                    className="absolute top-0 left-0 right-0 h-[2.5px] bg-amber-500 dark:bg-amber-600 z-10 pointer-events-none" 
                                    title={`Jornada Temporária: ${dayTempJourney.jornadas?.nome}`}
                                  />
                                )}
                                {activeEvent && (
                                  <div 
                                    className="absolute inset-0 pointer-events-none opacity-20"
                                    style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                                  />
                                )}
                                <input
                                  list={
                                    cat === 'Sobreaviso' ? 'turnos-sobreaviso-list' :
                                    cat === 'Extra' ? 'turnos-extra-list' :
                                    cat === 'Plantão' ? 'turnos-plantao-list' :
                                    'turnos-normal-list'
                                  }
                                  value={turno?.codigo || ''}
                                  disabled={isCompetenciaEncerrada || escalaMensal[0]?.status === 'Fechada' || (isClosed && !podeEditarForaDoPrazo(userProfile?.role))}
                                  onChange={(e) => {
                                    const val = e.target.value.toUpperCase()
                                    const targetTipo = cat === 'Sobreaviso' ? 'Sobreaviso' : cat === 'Extra' ? 'Extra' : cat === 'Plantão' ? 'Plantão' : 'Normal'
                                    
                                    if (val !== '') {
                                      const hasMatch = turnos.some(x => x.ativo !== false && x.tipo && x.tipo.split(',').map((s: string) => s.trim()).includes(targetTipo) && x.codigo.startsWith(val))
                                      if (!hasMatch) return
                                    }
                                    const t = turnos.find(x => x.ativo !== false && x.tipo && x.tipo.split(',').map((s: string) => s.trim()).includes(targetTipo) && x.codigo === val)
                                    handleCellChange(em.servidor_id, cat, day, t?.id || '')
                                  }}
                                  className={`w-full h-full bg-transparent border-none text-center focus:outline-none focus:ring-1 focus:ring-blue-500 font-black p-0 text-[11px] uppercase ${isFailed ? 'text-red-600 dark:text-red-400 line-through' : 'text-zinc-900 dark:text-zinc-100'}`}
                                  placeholder="-"
                                />
                                {activeEvent && (
                                  <div
                                    className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full"
                                    style={{ backgroundColor: activeEvent.tipos_eventos?.cor || '#EF4444' }}
                                    title={`Afastamento: ${eventosDoDia.map(rotuloAfastamento).join(' | ')}`}
                                  />
                                )}
                                {/* Turno de duração livre: mostra a hora definida, ou avisa que
                                    ainda falta. Sem isso o coordenador não teria como ver nem
                                    corrigir o que informou. Clicar reabre o modal. */}
                                {permiteHoraInicio(cat, turno?.id) && (() => {
                                  const hora = gridHoras[em.servidor_id]?.[cat]?.[day]
                                  const exige = precisaHoraInicio(cat, turno?.id)
                                  // No turno ancorado não há o que cobrar: mostra em cinza o que o
                                  // BANCO prevê (fn_blocos_previstos_mes, a mesma fonte do terminal),
                                  // que já inclui a âncora espelho da jornada noturna. Clicar sobrepõe.
                                  const previsto = !hora && !exige
                                    ? getShiftForecastTime(turno?.id || '', 'entrada', em.servidor_id, cat, day)
                                    : null
                                  const label = hora || (exige ? '?h' : previsto)
                                  if (!label) return null
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => setHoraModal({
                                        isOpen: true,
                                        servidorId: em.servidor_id,
                                        servidorNome: todosServidoresSetor.find(s => s.id === em.servidor_id)?.nome || '',
                                        categoria: cat,
                                        day,
                                        turnoCodigo: turno?.codigo || '',
                                        horasComputadas: Number(turno?.horas_computadas) || 0,
                                        ancorado: !exige,
                                        valor: hora || (exige ? sugerirHoraInicio(em.servidor_id, day, cat) : '')
                                      })}
                                      title={hora
                                        ? `Início às ${hora} (informado pelo coordenador). Clique para alterar.`
                                        : exige
                                          ? `O código ${turno?.codigo} não define a hora de início. Clique para informar.`
                                          : `Início previsto às ${previsto}, calculado pela escala do dia. Clique para informar outra hora.`}
                                      className={`absolute bottom-0 left-0 right-0 text-[7px] leading-none py-px font-bold ${
                                        hora
                                          ? 'text-blue-600 dark:text-blue-400'
                                          : exige
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : 'text-zinc-400 dark:text-zinc-500 font-normal'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  )
                                })()}
                              </div>
                            )}

                            {/* Indicador de Compliance (Interjornada/DSR) */}
                            {(() => {
                              const cellViolations = getViolationsForCell(complianceViolations, em.servidor_id, day)
                              if (cellViolations.length === 0 || (cat !== 'Regular' && cat !== 'Extra')) return null
                              return (
                                <div 
                                  className="absolute top-0 left-0 w-0 h-0 z-20" 
                                  style={{ borderLeft: '8px solid #f59e0b', borderBottom: '8px solid transparent' }}
                                  title={`⚠️ ${cellViolations.map(v => v.message).join(' | ')}`}
                                />
                              )
                            })()}
                            {/* Indicador de Ocupação Externa (Bônus) */}
                            {isBusyElsewhere && !hasExternalConflict && (
                              <div 
                                className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full z-30 shadow-sm border border-white dark:border-zinc-800" 
                                title={`Trabalha em outro setor: ${realExternalShifts.find(os => os.categoria?.toLowerCase().trim() === cat.toLowerCase().trim())?.descricao_conflito || ''}`}
                              />
                            )}
                            {isFailed && permitirValidacaoManual && !isClosed && podeEditarForaDoPrazo(userProfile?.role) && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (logForDay) handleManualOverride(logForDay.id)
                                }}
                                disabled={loading}
                                className="absolute bottom-[2px] right-[2px] hidden group-hover:flex h-3 w-3 items-center justify-center rounded bg-red-600 text-white z-30 hover:bg-green-600 transition-colors shadow-sm"
                                title="Validar Manualmente (Remover Falha)"
                              >
                                <CheckCircle className="h-2 w-2" />
                              </button>
                            )}

                            {/* Indicadores de Status em Tempo Real (Sobreaviso) - Somente se houver turno escalado */}
                            {cat === 'Sobreaviso' && turnoId && (
                              <>
                                {/* Bolinha Laranja: Clique para Reabrir o Modal de Disparo / Cópia de Link */}
                                {(currentOvercallStatus === 'Aguardando' || effectiveStatus === 'Aguardando') && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const pendingLog = cellLogs.find((l: any) => l.status === 'Aguardando') || cellLogs[cellLogs.length - 1]
                                      if (pendingLog) {
                                        const link = `${window.location.origin}/sobreaviso/${pendingLog.token_magic_link}`
                                        setMotivo(pendingLog.motivo_acionamento || '')
                                        setGeneratedLink(link)
                                        const servidorMatch = escalaMensal.find(emItem => emItem.servidor_id === em.servidor_id)?.servidores || todosServidoresSetor.find(s => s.id === em.servidor_id)
                                        const phone = servidorMatch?.telefone || ''
                                        const cleanPhone = phone.replace(/\D/g, '')
                                        const fallback = `https://api.whatsapp.com/send?phone=${cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone}&text=${encodeURIComponent(`Olá *${em.servidores?.nome || 'Servidor'}*, você foi acionado(a) para um chamado de Sobreaviso.\n\n*Motivo:*\n${pendingLog.motivo_acionamento || ''}\n\n*Para confirmar seu aceite, acesse o link abaixo:*\n${link}`)}`
                                        setWaFallbackUrl(fallback)
                                        setTriggerModal({
                                          isOpen: true,
                                          servidorId: em.servidor_id,
                                          servidorNome: em.servidores?.nome || 'Servidor',
                                          turnoId: turno.id,
                                          escalaMensalId: em.id,
                                          dia: day
                                        })
                                      }
                                    }}
                                    className="absolute -top-1 -right-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-amber-500 text-white z-30 shadow-md border border-white dark:border-zinc-800 hover:scale-110 transition-transform" 
                                    title="Aguardando Aceite - Clique para reenviar mensagem ou copiar o link"
                                  >
                                    <Clock className="h-2.5 w-2.5" />
                                  </button>
                                )}
                                {(currentOvercallStatus === 'Aceito' || (effectiveStatus === 'Aceito' && currentOvercallStatus !== 'Aguardando')) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const activeLog = cellLogs.find((l: any) => l.status === 'Aceito') || cellLogs[cellLogs.length - 1]
                                      if (activeLog) {
                                        const link = `${window.location.origin}/sobreaviso/${activeLog.token_magic_link}`
                                        setMotivo(activeLog.motivo_acionamento || '')
                                        setGeneratedLink(link)
                                        const servidorMatch = escalaMensal.find(emItem => emItem.servidor_id === em.servidor_id)?.servidores || todosServidoresSetor.find(s => s.id === em.servidor_id)
                                        const phone = servidorMatch?.telefone || ''
                                        const cleanPhone = phone.replace(/\D/g, '')
                                        const fallback = `https://api.whatsapp.com/send?phone=${cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone}&text=${encodeURIComponent(`Olá *${em.servidores?.nome || 'Servidor'}*, você foi acionado(a) para um chamado de Sobreaviso.\n\n*Motivo:*\n${activeLog.motivo_acionamento || ''}\n\n*Para confirmar seu aceite, acesse o link abaixo:*\n${link}`)}`
                                        setWaFallbackUrl(fallback)
                                        setTriggerModal({
                                          isOpen: true,
                                          servidorId: em.servidor_id,
                                          servidorNome: em.servidores?.nome || 'Servidor',
                                          turnoId: turno.id,
                                          escalaMensalId: em.id,
                                          dia: day
                                        })
                                      }
                                    }}
                                    className="absolute -top-1 -right-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-emerald-500 text-white z-30 shadow-md border border-white dark:border-zinc-800 animate-pulse hover:scale-110 transition-transform" 
                                    title="Em Deslocamento (Aceito) - Clique para reenviar mensagem ou copiar o link"
                                  >
                                    <Navigation2 className="h-2.5 w-2.5 fill-current" />
                                  </button>
                                )}
                                {(currentOvercallStatus === 'Chegou' || effectiveStatus === 'Chegou') && (
                                  <div className="absolute -top-1 -left-1 flex h-3 w-3 items-center justify-center rounded-full bg-blue-500 text-white z-20 shadow-sm border border-white dark:border-zinc-800" title="Servidor chegou">
                                    <Check className="h-2 w-2" />
                                  </div>
                                )}

                                {/* Badge de Múltiplos Acionamentos no mesmo dia (ex: 2x, 3x) */}
                                {cellLogs.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSobreavisoHistoryModal({
                                        isOpen: true,
                                        servidorId: em.servidor_id,
                                        servidorNome: em.servidores?.nome || 'Servidor',
                                        dia: day,
                                        escalaMensalId: em.id,
                                        turnoId: turno.id
                                      })
                                    }}
                                    className="absolute bottom-0 right-0 flex h-3.5 px-1 items-center justify-center rounded-full bg-purple-600 text-white text-[8px] font-black z-30 shadow-sm border border-white dark:border-zinc-800 hover:scale-110 transition-transform"
                                    title={`${cellLogs.length} chamados de sobreaviso neste dia. Clique para ver o histórico.`}
                                  >
                                    {cellLogs.length}x
                                  </button>
                                )}
                              </>
                            )}
                            {isTriggerAllowed && (
                              <button 
                                onClick={() => setTriggerModal({
                                  isOpen: true,
                                  servidorId: em.servidor_id,
                                  servidorNome: em.servidores?.nome || 'Servidor',
                                  turnoId: turno.id,
                                  escalaMensalId: em.id,
                                  dia: day
                                })}
                                disabled={loading}
                                className="absolute -top-1 -right-1 hidden group-hover:flex h-3 w-3 items-center justify-center rounded-full bg-orange-500 text-white z-30 hover:bg-orange-600 transition-colors shadow-sm"
                              >
                                <span title="Acionar Novo Sobreaviso">
                                  <Zap className="h-2 w-2 fill-current" />
                                </span>
                              </button>
                            )}

                            {/* Indicador de Presença (Entrada/Saída) */}
                            {turnoId && cat !== 'Sobreaviso' && (
                              <div className="absolute bottom-0 left-0 right-0 h-[3px] flex gap-[1px] z-20">
                                {(() => {
                                  const today = new Date()
                                  const currentDay = today.getDate()
                                  const currentMonth = today.getMonth() + 1
                                  const currentYear = today.getFullYear()
                                  const currentHour = today.getHours()
                                  
                                  const d = new Date(ano, mes - 1, day)
                                  const isPast = d < new Date(currentYear, currentMonth - 1, currentDay)
                                  const isToday = day === currentDay && mes === currentMonth && ano === currentYear
                                  
                                  const presence = presenceData[em.servidor_id]?.[cat]?.[day] || { 
                                    entrada: false, 
                                    intervalo_saida: false, 
                                    intervalo_retorno: false, 
                                    saida: false 
                                  }

                                  const redEntrada = isRedIndicator(day, cat, 'entrada')
                                  const redSaida = isRedIndicator(day, cat, 'saida')

                                  const canEditPresence = !isCompetenciaEncerrada && escalaMensal[0]?.status !== 'Fechada' && (!isClosed || ignoraTravaDePrevisao) && podeValidarPresenca

                                  // Espelho de public.fn_jornada_tem_intervalo + fn_intervalo_previsto_minutos
                                  // (CLT Art. 71, caput): trabalho contínuo de até 6h não tem intervalo, então a
                                  // célula mostra 2 segmentos em vez de 4. A jornada temporária do dia prevalece
                                  // sobre a fixa, como no backend (obter_jornada_servidor_data).
                                  //
                                  // ⚠️ Para Plantão/Extra, DURAÇÃO e INTERVALO vêm os dois do turno. Até 22/08/2026
                                  // só a duração vinha — o intervalo era herdado da jornada Regular do servidor, e o
                                  // `intervalo_minutos = 0` de uma jornada de 6h suprimia o intervalo de um plantão
                                  // de 12h. A regra agora vive em src/utils/intervaloIntrajornada.ts, fonte única.
                                  const jornadaDoDia = dayTempJourney?.jornadas || jornadas.find(j => j.id === em.jornada_id)
                                  const turnoDaCelula = turnos.find(t => t.id === turnoId)
                                  const duracaoMinutos = cat === 'Regular'
                                    ? Number(jornadaDoDia?.horas_totais || 0) * 60
                                    : Number(turnoDaCelula?.horas_computadas || 0) * 60

                                  const isUnitInterval = celulaTemPassosDeIntervalo({
                                    categoria: cat,
                                    duracaoMinutos,
                                    permiteMarcaIntervalo: unidadedata?.permite_marca_intervalo,
                                    jornadaIntervaloMinutos: jornadaDoDia?.intervalo_minutos,
                                    turnoIntervaloMinutos: turnoDaCelula?.intervalo_minutos
                                  })

                                  const handleSegmentClick = (tipo: 'entrada' | 'intervalo_saida' | 'intervalo_retorno' | 'saida', isDone: boolean, isManualFlag?: boolean) => {
                                    if (!canEditPresence) return
                                    // Batida real de terminal/REP so e alterada por administrador. Vale para
                                    // coordenador, ass_adm e tambem RH (Geral e da Unidade): validar o passo que
                                    // faltou e o caso de uso deles; mexer no que a pessoa realmente bateu, nao.
                                    if (isDone && !isManualFlag && !isAdminRole) {
                                      setAlertModal({
                                        isOpen: true,
                                        title: 'Acesso Restrito',
                                        message: 'Apenas administradores podem alterar ou reverter batidas presenciais registradas em terminal.',
                                        type: 'warning'
                                      })
                                      return
                                    }
                                    setManualPresenceModal({
                                      isOpen: true,
                                      servidorId: em.servidor_id,
                                      servidorNome: em.servidores?.nome,
                                      dia: day,
                                      categoria: cat,
                                      tipo,
                                      escalaMensalId: em.id,
                                      isReverting: isDone
                                    })
                                  }

                                  if (isUnitInterval) {
                                    return (
                                      <>
                                        {/* Segmento 1: Entrada */}
                                        <div 
                                          onClick={(e) => { e.stopPropagation(); handleSegmentClick('entrada', !!presence.entrada, presence.is_entrada_manual) }}
                                          className={`flex-1 h-full cursor-pointer transition-colors ${presence.entrada ? 'bg-emerald-500 hover:bg-emerald-600' : (redEntrada ? 'bg-red-500 hover:bg-red-600' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600')}`} 
                                          title={getSegmentTooltip(1, 'Entrada', !!presence.entrada, false, redEntrada, presence.entrada_em, presence.is_entrada_manual, em.servidor_id, day, turnoId, 'entrada', cat)} 
                                        />
                                        {/* Segmento 2: Saída Intervalo */}
                                        <div 
                                          onClick={(e) => { e.stopPropagation(); handleSegmentClick('intervalo_saida', !!presence.intervalo_saida, presence.is_intervalo_saida_manual) }}
                                          className={`flex-1 h-full cursor-pointer transition-colors ${presence.intervalo_saida ? 'bg-emerald-500 hover:bg-emerald-600' : (presence.entrada && !presence.intervalo_saida && isToday ? 'bg-amber-400 animate-pulse hover:bg-amber-500' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600')}`} 
                                          title={getSegmentTooltip(2, 'Saída do Intervalo', !!presence.intervalo_saida, !!(presence.entrada && !presence.intervalo_saida && isToday), false, presence.intervalo_saida_em, presence.is_intervalo_saida_manual, em.servidor_id, day, turnoId, 'intervalo_saida', cat)} 
                                        />
                                        {/* Segmento 3: Retorno Intervalo */}
                                        <div 
                                          onClick={(e) => { e.stopPropagation(); handleSegmentClick('intervalo_retorno', !!presence.intervalo_retorno, presence.is_intervalo_retorno_manual) }}
                                          className={`flex-1 h-full cursor-pointer transition-colors ${presence.intervalo_retorno ? 'bg-emerald-500 hover:bg-emerald-600' : (presence.intervalo_saida && !presence.intervalo_retorno && isToday ? 'bg-amber-400 animate-pulse hover:bg-amber-500' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600')}`} 
                                          title={getSegmentTooltip(3, 'Retorno do Intervalo', !!presence.intervalo_retorno, !!(presence.intervalo_saida && !presence.intervalo_retorno && isToday), false, presence.intervalo_retorno_em, presence.is_intervalo_retorno_manual, em.servidor_id, day, turnoId, 'intervalo_retorno', cat)} 
                                        />
                                        {/* Segmento 4: Saída Final */}
                                        <div 
                                          onClick={(e) => { e.stopPropagation(); handleSegmentClick('saida', !!presence.saida, presence.is_saida_manual) }}
                                          className={`flex-1 h-full cursor-pointer transition-colors ${presence.saida ? 'bg-emerald-500 hover:bg-emerald-600' : (presence.intervalo_retorno && isToday ? 'bg-amber-400 animate-pulse hover:bg-amber-500' : (redSaida ? 'bg-red-500 hover:bg-red-600' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600'))}`} 
                                          title={getSegmentTooltip(4, 'Saída Final', !!presence.saida, !!(presence.intervalo_retorno && !presence.saida && isToday), redSaida, presence.saida_em, presence.is_saida_manual, em.servidor_id, day, turnoId, 'saida', cat)} 
                                        />
                                      </>
                                    )
                                  }

                                  return (
                                    <>
                                      {/* Metade Entrada */}
                                      <div 
                                        onClick={(e) => { e.stopPropagation(); handleSegmentClick('entrada', !!presence.entrada, presence.is_entrada_manual) }}
                                        className={`flex-1 h-full cursor-pointer transition-colors ${presence.entrada ? 'bg-emerald-500 hover:bg-emerald-600' : (redEntrada ? 'bg-red-500 hover:bg-red-600' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600')}`} 
                                        title={getSegmentTooltip(0, 'Entrada', !!presence.entrada, false, redEntrada, presence.entrada_em, presence.is_entrada_manual, em.servidor_id, day, turnoId, 'entrada', cat)} 
                                      />
                                      {/* Metade Saída */}
                                      <div 
                                        onClick={(e) => { e.stopPropagation(); handleSegmentClick('saida', !!presence.saida, presence.is_saida_manual) }}
                                        className={`flex-1 h-full cursor-pointer transition-colors ${presence.saida ? 'bg-emerald-500 hover:bg-emerald-600' : (presence.entrada && isToday ? 'bg-amber-400 animate-pulse hover:bg-amber-500' : (redSaida ? 'bg-red-500 hover:bg-red-600' : 'bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600'))}`} 
                                        title={getSegmentTooltip(0, 'Saída', !!presence.saida, !!(presence.entrada && !presence.saida && isToday), redSaida, presence.saida_em, presence.is_saida_manual, em.servidor_id, day, turnoId, 'saida', cat)} 
                                      />
                                    </>
                                  )
                                })()}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      {catIdx === 0 && (
                        <>
                          {!isTotalsCollapsed && (
                            <>
                              {/* CH */}
                              <td rowSpan={4} className="sticky right-[296px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-blue-50 dark:bg-blue-900 text-blue-900 dark:text-blue-100">
                                <div className="flex flex-col h-full divide-y divide-blue-200 dark:divide-blue-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Prev</span>
                                    <span className="text-[10px] leading-tight">{totals.p_ch}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-blue-100/50 dark:bg-blue-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.chTotal}</span>
                                  </div>
                                </div>
                              </td>
                              {/* HE100 */}
                              <td rowSpan={4} className="sticky right-[258px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">
                                <div className="flex flex-col h-full divide-y divide-indigo-200 dark:divide-indigo-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Prev</span>
                                    <span className="text-[10px] leading-tight">{totals.p_he100}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-indigo-100/50 dark:bg-indigo-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.he100}</span>
                                  </div>
                                </div>
                              </td>
                              {/* HE50 */}
                              <td rowSpan={4} className="sticky right-[220px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-indigo-50 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100">
                                <div className="flex flex-col h-full divide-y divide-indigo-200 dark:divide-indigo-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Prev</span>
                                    <span className="text-[10px] leading-tight">{totals.p_he50}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-indigo-100/50 dark:bg-indigo-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.he50}</span>
                                  </div>
                                </div>
                              </td>
                              {/* PL12 */}
                              <td rowSpan={4} className="sticky right-[182px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">
                                <div className="flex flex-col h-full divide-y divide-orange-200 dark:divide-orange-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Prev</span>
                                    <span className="text-[10px] leading-tight">{totals.p_pl12}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-orange-100/50 dark:bg-orange-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.pl12}</span>
                                  </div>
                                </div>
                              </td>
                              {/* PL6 */}
                              <td rowSpan={4} className="sticky right-[144px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">
                                <div className="flex flex-col h-full divide-y divide-orange-200 dark:divide-orange-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Prev</span>
                                    <span className="text-[10px] leading-tight">{totals.p_pl6}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-orange-100/50 dark:bg-orange-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.pl6}</span>
                                  </div>
                                </div>
                              </td>
                              {/* PL4 */}
                              <td rowSpan={4} className="sticky right-[106px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-orange-50 dark:bg-orange-900 text-orange-900 dark:text-orange-100">
                                <div className="flex flex-col h-full divide-y divide-orange-200 dark:divide-orange-800">
                                  <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                    <span className="text-[6px] uppercase leading-none">Prev</span>
                                    <span className="text-[10px] leading-tight">{totals.p_pl4}</span>
                                  </div>
                                  <div className="flex-1 flex flex-col justify-center p-1 bg-orange-100/50 dark:bg-orange-800/30">
                                    <span className="text-[6px] uppercase leading-none">Val</span>
                                    <span className="text-[10px] leading-tight">{totals.pl4}</span>
                                  </div>
                                </div>
                              </td>
                              {/* SOBREAVISO (Qtd em Unidades com Tooltip dos 5 Tipos) */}
                              {(() => {
                                const pBreakdownText = Object.values(totals.p_sobreaviso_breakdown || {})
                                  .map((b: any) => `${b.codigo}: ${b.count} un`)
                                  .join('\n• ')
                                const vBreakdownText = Object.values(totals.v_sobreaviso_breakdown || {})
                                  .map((b: any) => `${b.codigo}: ${b.count} un`)
                                  .join('\n• ')
                                const sobTooltip = `Detalhamento de Sobreavisos (${totals.p_soQtd} Unidades):\n\nPREVISTOS (${totals.p_soQtd} un):\n${pBreakdownText ? '• ' + pBreakdownText : 'Nenhum'}\n\nVALIDADOS (${totals.soQtd} un):\n${vBreakdownText ? '• ' + vBreakdownText : 'Nenhum'}`
                                
                                return (
                                  <td 
                                    rowSpan={4} 
                                    title={sobTooltip}
                                    className="sticky right-[68px] z-10 p-0 border border-zinc-200 dark:border-zinc-700 font-black bg-emerald-50 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100 cursor-help"
                                  >
                                    <div className="flex flex-col h-full divide-y divide-emerald-200 dark:divide-emerald-800">
                                      <div className="flex-1 flex flex-col justify-center p-1 opacity-60">
                                        <span className="text-[6px] uppercase leading-none">Prev</span>
                                        <span className="text-[10px] leading-tight">{totals.p_soQtd} un</span>
                                      </div>
                                      <div className="flex-1 flex flex-col justify-center p-1 bg-emerald-100/50 dark:bg-emerald-800/30">
                                        <span className="text-[6px] uppercase leading-none">Val</span>
                                        <span className="text-[10px] leading-tight">{totals.soQtd} un</span>
                                      </div>
                                    </div>
                                  </td>
                                )
                              })()}
                            </>
                          )}

                          {/*
                            TOTAL H/MÊS. "Previsão" e "Validado" são desta escala; "Outras" e
                            "Mês" só aparecem quando o servidor tem carga em OUTRA escala da
                            competência — o caso comum é não ter, e uma linha "0" em 500 linhas
                            de grade seria ruído. É este bloco que responde "409h, e as outras
                            289h estão no ACOLHIMENTO" sem obrigar a abrir a outra grade.
                          */}
                          {(() => {
                            const carga = cargaMes
                            const temOutras = carga.outras.length > 0
                            const tooltip = temOutras
                              ? `Carga do mês inteiro: ${formatarHoras(carga.totalHoras)}h (teto ${formatarHoras(carga.tetoHoras)}h)\n\n`
                                + `• esta escala — ${formatarHoras(carga.horasLocais)}h\n`
                                + carga.outras
                                    .map(o => `• ${o.unidade_nome} / ${o.setor_caminho} — ${formatarHoras(o.horas)}h${o.sobreavisos > 0 ? ` e ${o.sobreavisos} un de sobreaviso` : ''}`)
                                    .join('\n')
                                + (carga.excede ? '\n\n⚠️ Acima do teto mensal. Exige Autorização Extraordinária.' : '')
                              : `Previsão desta escala: ${formatarHoras(totals.totalPlanejado)}h (teto do mês: ${formatarHoras(carga.tetoHoras)}h)`
                            return (
                              <td
                                rowSpan={4}
                                title={tooltip}
                                className={`sticky right-0 z-10 p-0 border font-black cursor-help ${
                                  carga.excede
                                    ? 'border-red-700 bg-red-500 text-white'
                                    : 'border-zinc-200 dark:border-zinc-700 bg-amber-400 text-black'
                                }`}
                              >
                                <div className={`flex flex-col h-full ${carga.excede ? 'divide-y divide-white/20' : 'divide-y divide-black/10'}`}>
                                  <div className="flex-1 flex flex-col justify-center p-1">
                                    <span className="text-[7px] uppercase leading-none opacity-60">Previsão</span>
                                    <span className="text-[11px] leading-tight">{totals.totalPlanejado}</span>
                                  </div>
                                  <div className={`flex-1 flex flex-col justify-center p-1 ${carga.excede ? 'bg-white/10' : 'bg-black/5'}`}>
                                    <span className="text-[7px] uppercase leading-none opacity-60">Validado</span>
                                    <span className="text-[11px] leading-tight">{totals.totalGeral}</span>
                                  </div>
                                  {temOutras && (
                                    <>
                                      <div className="flex-1 flex flex-col justify-center p-1">
                                        <span className="text-[7px] uppercase leading-none opacity-60">Outras</span>
                                        <span className="text-[11px] leading-tight">{formatarHoras(carga.horasOutras)}</span>
                                      </div>
                                      <div className={`flex-1 flex flex-col justify-center p-1 ${carga.excede ? 'bg-white/20' : 'bg-black/10'}`}>
                                        <span className="text-[7px] uppercase leading-none opacity-60">Mês</span>
                                        <span className="text-[11px] leading-tight">{formatarHoras(carga.totalHoras)}</span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            )
                          })()}
                        </>
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              )
            })
          })()}
          </tbody>
          <tfoot className="bg-zinc-100 dark:bg-zinc-800">
            <tr>
              <td rowSpan={4} className="sticky left-0 z-10 bg-zinc-200 dark:bg-zinc-700 p-2 border border-zinc-300 dark:border-zinc-600 text-center align-middle uppercase text-sm font-black text-zinc-900 dark:text-zinc-100">
                SERVIDORES POR TURNO
              </td>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                MANHÃ
              </td>
              {daysArray.map(day => {
                const count = shiftTotals.M[day] || 0
                const { className, title } = getShiftTotalStyleAndTooltip(count, 'M', day)
                return (
                  <td key={day} className={`p-1 border border-zinc-300 dark:border-zinc-600 text-center text-[11px] font-bold ${className || 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'}`} title={title}>
                    {count || ''}
                  </td>
                )
              })}
              <td colSpan={isTotalsCollapsed ? 1 : 8} rowSpan={4} className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600"></td>
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                TARDE
              </td>
              {daysArray.map(day => {
                const count = shiftTotals.T[day] || 0
                const { className, title } = getShiftTotalStyleAndTooltip(count, 'T', day)
                return (
                  <td key={day} className={`p-1 border border-zinc-300 dark:border-zinc-600 text-center text-[11px] font-bold ${className || 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'}`} title={title}>
                    {count || ''}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                NOITE
              </td>
              {daysArray.map(day => {
                const count = shiftTotals.N[day] || 0
                const { className, title } = getShiftTotalStyleAndTooltip(count, 'N', day)
                return (
                  <td key={day} className={`p-1 border border-zinc-300 dark:border-zinc-600 text-center text-[11px] font-bold ${className || 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'}`} title={title}>
                    {count || ''}
                  </td>
                )
              })}
            </tr>
            <tr>
              <td className="sticky left-[180px] z-10 bg-white dark:bg-zinc-900 p-1 border border-zinc-300 dark:border-zinc-600 uppercase text-[10px] text-center font-bold text-zinc-800 dark:text-zinc-200">
                SOBREAVISO
              </td>
              {daysArray.map(day => (
                <td key={day} className="p-1 border border-zinc-300 dark:border-zinc-600 text-center bg-white dark:bg-zinc-900 text-[11px] font-bold text-zinc-900 dark:text-zinc-100">
                  {shiftTotals.S[day] || ''}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>

        <datalist id="turnos-normal-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Normal')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>

        <datalist id="turnos-plantao-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Plantão')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>

        <datalist id="turnos-sobreaviso-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Sobreaviso')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>

        <datalist id="turnos-extra-list">
          {turnos.filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Extra')).map(t => (
            <option key={t.id} value={t.codigo}>{t.descricao}</option>
          ))}
        </datalist>
      </div>

      </div> {/* Closes the main print:hidden container */}

      {/* Actual Print View Hidden component */}
      <ScalePrintView 
        unidade={allUnidades.find(u => u.id === unidadeId)}
        setor={setorAtualComCaminho}
        mes={mes}
        ano={ano}
        escalaMensal={escalaMensal}
        gridData={gridData} 
        turnos={turnos}
        jornadas={jornadas}
        shiftTotals={shiftTotals}
        servidoresEventos={servidoresEventos}
        permitirPlantaoExtra={configs['permitir_plantao_extra_durante_eventos'] === 'true'}
      />
      {/* Modal de Acionamento de Sobreaviso — Fase 8 do plano
          docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
          Passou a ser o MESMO componente do painel do dashboard, pela MESMA RPC. O modal
          antigo daqui inseria direto em logs_sobreaviso, o que a policy nao permite mais, e
          nao tinha como informar o destino do chamado. */}
      {triggerModal && (
        <AcionarSobreavisoModal
          alvo={{
            escalaMensalId: triggerModal.escalaMensalId,
            dia: triggerModal.dia,
            servidorNome: triggerModal.servidorNome,
            unidadeOrigemId: unidadeId,
            contexto: `Plantão de sobreaviso do dia ${triggerModal.dia}`
          }}
          onClose={handleCloseModal}
          onSucesso={() => { void fetchData() }}
        />
      )}

      {/* Modal de Histórico de Acionamentos de Sobreaviso do Dia */}
      {sobreavisoHistoryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 dark:bg-purple-900/30 text-purple-600 rounded-2xl">
                  <Zap className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                    Histórico de Acionamentos (Dia {sobreavisoHistoryModal.dia})
                  </h3>
                  <p className="text-xs text-zinc-500 font-medium">{sobreavisoHistoryModal.servidorNome}</p>
                </div>
              </div>
              <button 
                onClick={() => setSobreavisoHistoryModal(null)}
                className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Lista de Chamados Registrados para o dia */}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {(() => {
                const dayLogs = logsSobreaviso.filter((l: any) => 
                  l.servidor_id === sobreavisoHistoryModal.servidorId && 
                  l.dia === sobreavisoHistoryModal.dia &&
                  (l.categoria === 'Sobreaviso' || !l.categoria)
                )

                if (dayLogs.length === 0) {
                  return (
                    <div className="text-center py-6 text-xs text-zinc-500 font-bold uppercase tracking-wider">
                      Nenhum acionamento registrado neste dia.
                    </div>
                  )
                }

                return dayLogs.map((log: any, idx: number) => {
                  const link = `${window.location.origin}/sobreaviso/${log.token_magic_link}`
                  const createdStr = log.created_at ? formatarHora(log.created_at) : '—'
                  const acceptedStr = log.data_hora_aceite ? formatarHora(log.data_hora_aceite) : null
                  const arrivedStr = log.data_hora_chegada ? formatarHora(log.data_hora_chegada) : null

                  return (
                    <div key={log.id || idx} className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider text-purple-700 dark:text-purple-400">
                          Chamado #{idx + 1} — {createdStr}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          log.status === 'Chegou'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : log.status === 'Aceito'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : log.status === 'Aguardando'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        }`}>
                          {log.status}
                        </span>
                      </div>

                      {log.motivo_acionamento && (
                        <p className="text-xs text-zinc-700 dark:text-zinc-300 font-medium italic bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                          "{log.motivo_acionamento}"
                        </p>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500 font-bold">
                        {/* Sem aceite mas com chegada = o servidor não aceitou a tempo e compareceu
                            assim mesmo. "Pendente" seria enganoso: o chamado já foi atendido. */}
                        <div>Aceite: <span
                          className="text-zinc-800 dark:text-zinc-200"
                          title={!acceptedStr && arrivedStr ? 'O servidor não registrou o aceite do chamado, mas compareceu ao local.' : undefined}
                        >{acceptedStr || (arrivedStr ? 'Não registrado' : 'Pendente')}</span></div>
                        <div>Chegada: <span className="text-zinc-800 dark:text-zinc-200">{arrivedStr || 'Pendente'}</span></div>
                      </div>

                      {/* Botões de Ação para este Chamado */}
                      <div className="flex items-center gap-2 pt-1">
                        {(log.status === 'Aguardando' || log.status === 'Aceito') && (
                          <button
                            type="button"
                            // Este botão reabre o modal de ACIONAMENTO (gera chamado novo com o
                            // mesmo motivo), não é um reenvio passivo — por isso respeita a mesma
                            // janela do botão de baixo.
                            disabled={janelaSobreaviso.dentro !== true}
                            title={janelaSobreaviso.dentro !== true ? 'Fora da janela deste plantão de sobreaviso.' : undefined}
                            onClick={() => {
                              setSobreavisoHistoryModal(null)
                              setMotivo(log.motivo_acionamento || '')
                              setGeneratedLink(link)
                              
                              const servidorMatch = escalaMensal.find(emItem => emItem.servidor_id === sobreavisoHistoryModal.servidorId)?.servidores || todosServidoresSetor.find(s => s.id === sobreavisoHistoryModal.servidorId)
                              const phone = servidorMatch?.telefone || ''
                              const cleanPhone = phone.replace(/\D/g, '')
                              const fallback = `https://api.whatsapp.com/send?phone=${cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone}&text=${encodeURIComponent(`Olá *${sobreavisoHistoryModal.servidorNome}*, você foi acionado(a) para um chamado de Sobreaviso.\n\n*Motivo:*\n${log.motivo_acionamento || ''}\n\n*Para confirmar seu aceite, acesse o link abaixo:*\n${link}`)}`
                              setWaFallbackUrl(fallback)

                              setTriggerModal({
                                isOpen: true,
                                servidorId: sobreavisoHistoryModal.servidorId,
                                servidorNome: sobreavisoHistoryModal.servidorNome,
                                turnoId: sobreavisoHistoryModal.turnoId,
                                escalaMensalId: sobreavisoHistoryModal.escalaMensalId,
                                dia: sobreavisoHistoryModal.dia
                              })
                            }}
                            className={`flex-1 py-1.5 px-3 font-bold text-[10px] uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                              log.status === 'Aceito'
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-amber-500 hover:bg-amber-600 text-white'
                            }`}
                          >
                            <Send className="h-3 w-3" /> Reenviar Notificação / Link
                          </button>
                        )}

                        {log.status !== 'Chegou' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSobreavisoManualModal({
                                isOpen: true,
                                logId: log.id,
                                servidorNome: sobreavisoHistoryModal.servidorNome,
                                dia: sobreavisoHistoryModal.dia,
                                justificativa: ''
                              })
                            }}
                            className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1"
                          >
                            <Check className="h-3 w-3" /> Validar Este Chamado (Manual)
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>

            {/* Ação para Novo Acionamento / Trava de Deslocamento e Janela Ativa */}
            {(() => {
              const dayLogs = logsSobreaviso.filter((l: any) => 
                l.servidor_id === sobreavisoHistoryModal.servidorId && 
                l.dia === sobreavisoHistoryModal.dia &&
                (l.categoria === 'Sobreaviso' || !l.categoria)
              )
              const latestLog = dayLogs[dayLogs.length - 1]
              const isInTransitOrWaiting = latestLog?.status === 'Aceito' || latestLog?.status === 'Aguardando'

              // ⚠️ FORA DA JANELA NÃO SE ACIONA, e a tela não pode mais oferecer.
              //
              // Até 29/08/2026 o botão ficava habilitado sempre, de propósito: a heurística de
              // janela do frontend divergia da do banco, e preferiu-se deixar a RPC recusar com o
              // horário exato ("melhor um erro preciso do que um botão cinza sem explicação").
              // O problema é que, num plantão de semanas atrás, o botão CONVIDA a acionar algo
              // impossível — quem clica só descobre depois de escrever o motivo.
              //
              // Agora o botão é desabilitado pela janela que vem de fn_janela_sobreaviso_dia, a
              // mesma que fn_acionar_sobreaviso usa para autorizar — então continua não havendo
              // duas contas — e o motivo aparece com a janela exata, não como cinza sem
              // explicação. A recusa no banco continua lá: é ela que protege quem chama a RPC
              // direto (armadilha 12).
              const foraDaJanela = janelaSobreaviso.dentro === false
              const janelaCarregando = janelaSobreaviso.carregando
              const janelaTexto = janelaSobreaviso.inicio && janelaSobreaviso.fim
                ? `${formatarDataHora(janelaSobreaviso.inicio)} até ${formatarDataHora(janelaSobreaviso.fim)}`
                : null
              const acionamentoBloqueado = isInTransitOrWaiting || foraDaJanela || janelaCarregando

              // A heuristica de janela que existia aqui foi removida na Fase 8 do plano
              // docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
              //
              // Ela deduzia a janela do sobreaviso por prefixo do codigo (code.startsWith),
              // enquanto o dashboard usava outra tabela de codigos. Duas heuristicas para a
              // mesma pergunta, e nenhuma delas era o que o banco cobraria.
              //
              // Quem decide agora e fn_janela_sobreaviso_dia, dentro de fn_acionar_sobreaviso.
              // O botao fica habilitado e a RPC recusa dizendo a janela exata do plantao -
              // melhor um erro preciso do que um botao cinza sem explicacao.

              return (
                <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  {isInTransitOrWaiting && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300 font-medium flex items-center gap-2">
                      <Navigation2 className="h-4 w-4 text-amber-600 flex-shrink-0 animate-pulse" />
                      <span>O servidor já aceitou o chamado e está em deslocamento (ou aguardando). Aguarde a chegada no local para um novo acionamento.</span>
                    </div>
                  )}

                  {!isInTransitOrWaiting && janelaCarregando && (
                    <div className="p-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-600 dark:text-zinc-400 font-medium flex items-center gap-2">
                      <Info className="h-4 w-4 text-zinc-500 flex-shrink-0" />
                      <span>Conferindo a janela deste plantão…</span>
                    </div>
                  )}

                  {!isInTransitOrWaiting && !janelaCarregando && foraDaJanela && (
                    <div className="p-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-600 dark:text-zinc-400 font-medium flex items-start gap-2">
                      <Info className="h-4 w-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                      <span>
                        {janelaTexto
                          ? <>Este plantão valia de <strong>{janelaTexto}</strong>. Fora dessa janela o acionamento não é permitido — este histórico é apenas para consulta.</>
                          : <>Não há janela de plantão vigente para este dia, então o acionamento não é permitido — este histórico é apenas para consulta.</>}
                        {' '}Para registrar um atendimento que aconteceu, use <strong>Validar Este Chamado (Manual)</strong> no chamado correspondente.
                      </span>
                    </div>
                  )}

                  {!isInTransitOrWaiting && !janelaCarregando && !foraDaJanela && janelaTexto && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-2">
                      <Info className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                      <span>Plantão em andamento ({janelaTexto}) — o acionamento está liberado.</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={acionamentoBloqueado}
                      title={foraDaJanela ? 'Fora da janela deste plantão de sobreaviso.' : undefined}
                      onClick={() => {
                        const s = sobreavisoHistoryModal
                        setSobreavisoHistoryModal(null)
                        setTriggerModal({
                          isOpen: true,
                          servidorId: s.servidorId,
                          servidorNome: s.servidorNome,
                          turnoId: s.turnoId,
                          escalaMensalId: s.escalaMensalId,
                          dia: s.dia
                        })
                      }}
                      className="py-2.5 px-4 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Zap className="h-4 w-4" /> Novo Acionamento neste Dia
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setSobreavisoHistoryModal(null)}
                      className="py-2.5 px-4 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs uppercase tracking-wider rounded-xl transition-all"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
      {/* Modal Servidor Externo */}
      {isExternalModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          {/* ⚠️ Sem `overflow-hidden` aqui, ao contrário dos outros modais: o painel da busca de
              servidor é `absolute` e mais alto que o corpo do modal — recortado, ele mostraria
              duas ou três linhas de resultado e o restante ficaria inalcançável. Os cantos
              arredondados vêm de `rounded-t-xl`/`rounded-b-xl` no cabeçalho e no rodapé. */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md" style={{ maxWidth: '450px' }}>
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 rounded-t-xl">
              <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-900 dark:text-white">
                <Globe className="h-5 w-5 text-blue-600" />
                Adicionar Servidor Externo
              </h2>
              <button onClick={() => fecharModalExterno()} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {/* ── Busca direta pelo nome ────────────────────────────────────────────────────
                  Caminho principal desde 31/08/2026: escolher a PESSOA sem precisar saber a
                  lotação dela. O caminho por Unidade → Setor continua abaixo, porque quem já
                  sabe de onde a pessoa vem acha mais rápido por ali. */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Buscar Servidor <span className="text-zinc-400 font-normal">(nome ou matrícula)</span>
                </label>
                <SelectComBuscaRemota
                  value={externalEncontrado?.id || ''}
                  rotuloSelecionado={externalEncontrado
                    ? `${externalEncontrado.nome}${externalEncontrado.matricula ? ` (${externalEncontrado.matricula})` : ''}`
                    : undefined}
                  buscar={buscarServidorExterno}
                  placeholder="Digite o nome do servidor…"
                  aria-label="Buscar servidor por nome ou matrícula"
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all text-zinc-900 dark:text-white"
                  onChange={(op) => {
                    if (!op) {
                      setExternalEncontrado(null)
                      setExternalData(prev => ({ ...prev, servidorId: '' }))
                      return
                    }
                    const bruto = externalAchadosRef.current.find((s: any) => s.id === op.value)
                    setExternalEncontrado(bruto ? {
                      id: bruto.id, nome: bruto.nome, matricula: bruto.matricula, cargo: bruto.cargo,
                      unidade_nome: bruto.unidade_nome, setor_caminho: bruto.setor_caminho,
                    } : null)
                    // Escolher pela busca zera o caminho por lotação: dois campos apontando para
                    // servidores diferentes ao mesmo tempo é a receita para adicionar o errado.
                    setExternalData({ unidadeId: '', setorId: '', servidorId: op.value })
                  }}
                />
                {externalEncontrado && (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
                    <span className="font-semibold">Lotação:</span>{' '}
                    {[externalEncontrado.unidade_nome, externalEncontrado.setor_caminho].filter(Boolean).join(' / ') || 'não informada'}
                    {externalEncontrado.cargo && <> · {externalEncontrado.cargo}</>}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                <span className="text-[11px] uppercase tracking-wider text-zinc-400">ou localize pela lotação</span>
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Unidade de Origem</label>
                <select
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all text-zinc-900 dark:text-white"
                  value={externalData.unidadeId}
                  onChange={(e) => setExternalData(prev => ({ ...prev, unidadeId: e.target.value }))}
                >
                  <option value="">Selecione a Unidade</option>
                  {allUnidades.map(u => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Setor de Origem</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 text-zinc-900 dark:text-white"
                  value={externalData.setorId}
                  disabled={!externalData.unidadeId}
                  onChange={(e) => setExternalData(prev => ({ ...prev, setorId: e.target.value }))}
                >
                  <option value="">Selecione o Setor</option>
                  {externalSectors.map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Servidor</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 text-zinc-900 dark:text-white"
                  value={externalEncontrado ? '' : externalData.servidorId}
                  disabled={!externalData.setorId}
                  onChange={(e) => {
                    setExternalEncontrado(null)
                    setExternalData(prev => ({ ...prev, servidorId: e.target.value }))
                  }}
                >
                  <option value="">Selecione o Servidor</option>
                  {externalServers.map(s => {
                    const jaNaGrade = escalaMensal.some(em => em.servidor_id === s.id)
                    return (
                      <option key={s.id} value={s.id} disabled={jaNaGrade}>
                        {s.nome}{jaNaGrade ? ' — já está nesta escala' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3 rounded-b-xl">
              <button
                onClick={() => fecharModalExterno()}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleAddExternalServer}
                disabled={!externalData.servidorId || loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20 min-w-[120px]"
              >
                {loading ? 'Adicionando...' : 'Adicionar na Grade'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Template de Escala */}
      {templateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
              <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-900 dark:text-white">
                <LayoutTemplate className="h-5 w-5 text-purple-600" />
                Aplicar Template de Escala
              </h2>
              <button onClick={() => setTemplateModal(null)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Servidor</label>
                <select
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  value={templateModal.servidorId}
                  onChange={(e) => setTemplateModal(prev => prev ? { ...prev, servidorId: e.target.value } : null)}
                >
                  {sortedEscalaMensal.map(em => (
                    <option key={em.servidor_id} value={em.servidor_id}>{em.servidores?.nome}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Modelo de Escala</label>
                <select
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  value={templateModal.templateType}
                  onChange={(e) => setTemplateModal(prev => prev ? { ...prev, templateType: e.target.value as TemplateType } : null)}
                >
                  {TEMPLATE_OPTIONS.map(opt => (
                    <option key={opt.type} value={opt.type}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-zinc-500">
                  {TEMPLATE_OPTIONS.find(o => o.type === templateModal.templateType)?.description}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Turno a Aplicar</label>
                <select
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  value={templateModal.turnoId}
                  onChange={(e) => setTemplateModal(prev => prev ? { ...prev, turnoId: e.target.value } : null)}
                >
                  {turnos
                    .filter(t => t.ativo !== false && t.tipo && t.tipo.split(',').map((s: string) => s.trim()).includes('Normal'))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.codigo} — {t.descricao}</option>
                    ))
                  }
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Dia de Início</label>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={templateModal.startDay}
                    onChange={(e) => setTemplateModal(prev => prev ? { ...prev, startDay: Math.max(1, Math.min(daysInMonth, parseInt(e.target.value) || 1)) } : null)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Início</label>
                  <select
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 text-zinc-900 dark:text-white"
                    value={templateModal.startWorking ? 'true' : 'false'}
                    onChange={(e) => setTemplateModal(prev => prev ? { ...prev, startWorking: e.target.value === 'true' } : null)}
                  >
                    <option value="true">Trabalhando</option>
                    <option value="false">Folgando</option>
                  </select>
                </div>
              </div>

              {getPastDaysCount() > 0 && (
                <div className="flex items-center space-x-2.5 py-1 bg-purple-50/50 dark:bg-purple-950/10 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/30">
                  <input
                    type="checkbox"
                    id="validatePastDays"
                    checked={templateModal.validatePastDays || false}
                    onChange={(e) => setTemplateModal(prev => prev ? { ...prev, validatePastDays: e.target.checked } : null)}
                    className="h-4 w-4 rounded border-zinc-350 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                  <label htmlFor="validatePastDays" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
                    Validar automaticamente dias passados (dias 1 a {getPastDaysCount()})
                  </label>
                </div>
              )}

              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-3 rounded-lg">
                <p className="text-[10px] text-purple-700 dark:text-purple-400">
                  ⚠️ Dias com presença já confirmada <strong>não serão sobrescritos</strong>, e dias de <strong>afastamento</strong> não serão preenchidos. O template preenche apenas a linha <strong>Regular</strong>.
                </p>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3">
              <button
                onClick={() => setTemplateModal(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!templateModal) return
                  const sId = templateModal.servidorId
                  const em = escalaMensal.find(x => x.servidor_id === sId)
                  if (!em) return

                  // Coletar dias protegidos (presença confirmada)
                  const protectedDays = new Set<number>()
                  for (let d = 1; d <= daysInMonth; d++) {
                    if (hasPresenceForDay(sId, em.id, 'Regular', d)) {
                      protectedDays.add(d)
                    }
                  }

                  // Dias de afastamento não recebem template. O banco já recusa isso no
                  // trigger fn_prevent_shift_during_event, mas a recusa só chegava no
                  // "Salvar Previsão" — e derrubava o lote inteiro, perdendo todo o resto
                  // do trabalho. Aqui o dia simplesmente não é preenchido.
                  const turnoTemplate = turnos.find(t => t.id === templateModal.turnoId)
                  const leaveDays = new Set<number>()
                  for (let d = templateModal.startDay; d <= daysInMonth; d++) {
                    if (getAfastamentoBloqueante(sId, d, 'Regular', turnoTemplate?.slots || [])) {
                      leaveDays.add(d)
                    }
                  }

                  // Dias em que o servidor já está escalado em OUTRO setor no mesmo horário.
                  // O template varria o mês inteiro sem consultar as outras escalas: foi assim
                  // que um servidor transferido de setor no dia 7 apareceu escalado nos dois
                  // setores dos dias 3 a 7, com a mesma batida contada em duas folhas
                  // (medido em 26/08/2026). fn_check_shift_conflicts existia e detectaria,
                  // mas só a digitação célula a célula a chamava. Ver src/utils/conflitoEscala.ts.
                  const conflitosExternos = diasComConflitoExterno(
                    externalOccupancy, sId, em.id,
                    templateModal.startDay, daysInMonth,
                    turnoTemplate?.slots || []
                  )
                  const conflictDays = new Set<number>(conflitosExternos.map(c => c.dia))

                  // generateTemplate não escreve nos dias que recebe como protegidos —
                  // presença confirmada, afastamento e sobreposição entram pelo mesmo canal.
                  const skipDays = new Set<number>([...protectedDays, ...leaveDays, ...conflictDays])

                  const templateResult = generateTemplate(
                    {
                      type: templateModal.templateType,
                      turnoId: templateModal.turnoId,
                      startDay: templateModal.startDay,
                      startWorking: templateModal.startWorking
                    },
                    daysInMonth,
                    mes,
                    ano,
                    skipDays
                  )

                  // Injetar no gridData apenas na linha Regular, preservando os dias anteriores ao
                  // dia de início.
                  //
                  // ⚠️ A mesclagem é feita AQUI, síncrona, e só o resultado pronto vai para o
                  // setGridData — o React chama o updater na fase de render, e a checagem de teto
                  // abaixo precisa do mapa final antes de decidir se aplica (mesma razão do
                  // contador do Gerador Inteligente, armadilha 22).
                  const existingRegular = gridData[sId]?.['Regular'] || {}
                  const updatedRegular = { ...existingRegular }

                  // Limpa escalas do dia de início em diante e aplica as geradas pelo template.
                  // Dia com presença confirmada é preservado como está — a tela promete que
                  // ele "não será sobrescrito", e apagar o turno de um dia já batido deixaria
                  // a marcação real sem escala correspondente.
                  for (let d = templateModal.startDay; d <= daysInMonth; d++) {
                    if (templateResult[d]) {
                      updatedRegular[d] = templateResult[d]
                    } else if (!protectedDays.has(d) && !conflictDays.has(d)) {
                      delete updatedRegular[d]
                    }
                  }

                  // Teto mensal do servidor, somando as outras escalas da competência.
                  //
                  // ⚠️ O template preenche o mês inteiro de uma vez e NUNCA consultou o teto:
                  // `handleCellChange` era o único chamador da checagem em todo o repositório, e
                  // ele só roda na digitação célula a célula. É a armadilha 14/23 num terceiro
                  // eixo — lá o furo era afastamento e sobreposição, aqui é carga horária.
                  const simulado = calculateTotals(sId, {
                    ...(gridData[sId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }),
                    'Regular': updatedRegular
                  })
                  const cargaSimulada = avaliarCargaDoServidor(sId, simulado.totalPlanejado, simulado.p_soQtd)

                  if (cargaSimulada.excede) {
                    const nome = escalaMensal.find(x => x.servidor_id === sId)?.servidores?.nome || 'Servidor'
                    const detalhe = descreverExcesso(cargaSimulada, nome)
                    const pedidoAberto = pedidosPendentes[sId]
                    const aviso = mensagemTetoExcedido(detalhe, userProfile?.role, pedidoAberto)
                    const semTemplate = 'O template NÃO foi aplicado.'

                    if (aviso.acao === 'autorizar' && !pedidoAberto) {
                      setConfirmModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: `${detalhe}\n\n${semTemplate} Você pode conceder uma Autorização Extraordinária e aplicá-lo de novo. Deseja abrir a tela de autorização?`,
                        type: 'warning',
                        onConfirm: () => {
                          setTemplateModal(null)
                          setAutorizacaoModalState({
                            isOpen: true,
                            servidorId: sId,
                            servidorNome: nome,
                            horasAtuais: calculateTotals(sId).totalPlanejado,
                            sobreavisosAtuais: calculateTotals(sId).p_soQtd
                          })
                        }
                      })
                    } else if (aviso.acao === 'solicitar' && !pedidoAberto) {
                      setConfirmModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: `${detalhe}\n\n${semTemplate} Você pode solicitar ao RH uma Autorização Extraordinária. Deseja abrir o pedido agora?`,
                        type: 'warning',
                        onConfirm: () => {
                          setTemplateModal(null)
                          setSolicitacaoModalState({
                            isOpen: true,
                            servidorId: sId,
                            servidorNome: nome,
                            horasAtuais: calculateTotals(sId).totalPlanejado,
                            sobreavisosAtuais: calculateTotals(sId).p_soQtd
                          })
                        }
                      })
                    } else {
                      setAlertModal({
                        isOpen: true,
                        title: '⚠️ Teto Mensal Excedido (Template não aplicado)',
                        message: `${detalhe}\n\n${semTemplate} ${aviso.mensagem.split('\n\n').slice(1).join('\n\n')}`,
                        type: 'warning'
                      })
                    }
                    return
                  }

                  setGridData(prev => ({
                    ...prev,
                    [sId]: {
                      ...prev[sId],
                      'Regular': updatedRegular
                    }
                  }))

                  // Se marcado para validar dias passados, atualizar a presenceData local
                  if (templateModal.validatePastDays) {
                    // Mesma unidade/jornada usada pelo indicador de presença da grade
                    // (isUnitInterval, ~linha 3827): unidade com marcação de intervalo habilitada
                    // + jornada do dia (respeitando jornada temporária) com duração > 6h e
                    // intervalo_minutos > 0 exige as 4 marcações (CLT Art. 71), não só entrada/saída.
                    // Sem isto, validar automaticamente aqui sempre gravava só 2 marcações mesmo em
                    // unidade com intervalo — inconsistente com o resto da grade e com o que
                    // fn_confirmar_presenca_manual grava numa validação manual por célula/servidor.
                    const gridStartRange = `${ano}-${mes.toString().padStart(2, '0')}-01`
                    const gridEndRange = `${ano}-${mes.toString().padStart(2, '0')}-${daysInMonth.toString().padStart(2, '0')}`
                    const serverTempJourneys = jornadasTemporarias.filter(jt =>
                      jt.servidor_id === sId &&
                      jt.data_inicio <= gridEndRange &&
                      jt.data_fim >= gridStartRange
                    )

                    setPresenceData(prev => {
                      const serverPres = prev[sId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
                      const updatedRegular = { ...serverPres['Regular'] }

                      const today = new Date()
                      const currentDay = today.getDate()
                      const currentMonth = today.getMonth() + 1
                      const currentYear = today.getFullYear()
                      const nMes = Number(mes)
                      const nAno = Number(ano)

                      for (let d = templateModal.startDay; d <= daysInMonth; d++) {
                        const isPast = nAno < currentYear ||
                                       (nAno === currentYear && nMes < currentMonth) ||
                                       (nAno === currentYear && nMes === currentMonth && d < currentDay)

                        if (isPast && templateResult[d] && !protectedDays.has(d)) {
                          const dateStr = `${ano}-${mes.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
                          const dayTempJourney = serverTempJourneys.find(jt => dateStr >= jt.data_inicio && dateStr <= jt.data_fim)
                          const jornadaDoDia = dayTempJourney?.jornadas || jornadas.find(j => j.id === em.jornada_id)
                          // Aplicar Template só escreve a linha Regular, então a duração é a da jornada e
                          // não há turno de plantão em jogo. Passa pela mesma fonte única mesmo assim, para
                          // não voltar a existir duas versões da regra na mesma tela.
                          const isUnitInterval = celulaTemPassosDeIntervalo({
                            categoria: 'Regular',
                            duracaoMinutos: Number(jornadaDoDia?.horas_totais || 0) * 60,
                            permiteMarcaIntervalo: unidadedata?.permite_marca_intervalo,
                            jornadaIntervaloMinutos: jornadaDoDia?.intervalo_minutos,
                            turnoIntervaloMinutos: null
                          })

                          updatedRegular[d] = isUnitInterval
                            ? { entrada: true, intervalo_saida: true, intervalo_retorno: true, saida: true }
                            : { entrada: true, intervalo_saida: false, intervalo_retorno: false, saida: true }
                        }
                      }

                      return {
                        ...prev,
                        [sId]: {
                          ...prev[sId],
                          'Regular': updatedRegular
                        }
                      }
                    })
                  }

                  const workDays = countWorkDays(templateResult)
                  logAction('APLICAR_TEMPLATE', {
                    servidor_id: sId,
                    template: templateModal.templateType,
                    dias_preenchidos: workDays,
                    dias_protegidos: protectedDays.size,
                    dias_afastamento: leaveDays.size,
                    dias_conflito_setor: conflictDays.size
                  })

                  setTemplateModal(null)
                  const diasAfastado = [...leaveDays].sort((a, b) => a - b)
                  const diasConflito = [...conflictDays].sort((a, b) => a - b)
                  setAlertModal({
                    isOpen: true,
                    title: 'Template Aplicado',
                    message: `Template ${templateModal.templateType} aplicado com sucesso! ${workDays} dias preenchidos${protectedDays.size > 0 ? `, ${protectedDays.size} dias protegidos por presença` : ''}${diasAfastado.length > 0 ? `, ${diasAfastado.length} dias não preenchidos por afastamento (dias ${diasAfastado.join(', ')})` : ''}${diasConflito.length > 0 ? `, ${diasConflito.length} dias não preenchidos porque o servidor já está escalado em outro setor no mesmo horário (dias ${diasConflito.join(', ')})` : ''}. Lembre-se de salvar a escala.`,
                    type: 'success'
                  })
                }}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-purple-500/20 min-w-[140px]"
              >
                Aplicar Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Gerador Inteligente de Escala.
          O motor vive em src/utils/intelligentScaleGenerator.ts — inclusive os limiares de
          confiança por categoria, que saíram de backtest contra a produção. Não replicar
          regra aqui: esta tela escolhe as opções e mostra o resultado. */}
      {intelligentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-lg overflow-hidden animate-in fade-in duration-200 max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2 text-zinc-900 dark:text-white">
                <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                Gerador Inteligente
              </h2>
              <button onClick={() => setIntelligentModal(null)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                O gerador estuda o que foi lançado nas competências anteriores deste setor e sugere,
                por servidor e por dia da semana, o turno mais provável.
              </p>

              {/* ---- Linhas da grade ---- */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 block mb-2">
                  Linhas a gerar
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIAS_GERAVEIS.map(cat => {
                    const marcada = intelligentModal.categorias.includes(cat)
                    const limiar = LIMIAR_CONFIANCA[cat]
                    return (
                      <label
                        key={cat}
                        className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                          marcada
                            ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/20'
                            : 'border-zinc-200 dark:border-zinc-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={(e) => setIntelligentModal(prev => prev ? {
                            ...prev,
                            categorias: e.target.checked
                              ? [...prev.categorias, cat]
                              : prev.categorias.filter(c => c !== cat)
                          } : null)}
                          className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 block">
                            {cat === 'Regular' ? 'Regular' : cat === 'Extra' ? 'Hora Extra' : cat === 'Plantão' ? 'Plantão' : 'Sobreaviso'}
                          </span>
                          <span className="text-[10px] text-zinc-500 block leading-tight">
                            só sugere com {Math.round(limiar * 100)}% de repetição
                          </span>
                        </div>
                      </label>
                    )
                  })}
                </div>
                {(intelligentModal.categorias.includes('Extra') || intelligentModal.categorias.includes('Sobreaviso')) && (
                  <p className="mt-2 text-[11px] leading-snug text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-2">
                    Medido em agosto/2026: no histórico real, o acerto do gerador em Hora Extra foi de
                    57% e em Sobreaviso de 33%. Por isso essas duas linhas só são preenchidas quando o
                    padrão se repetiu em <strong>todas</strong> as ocorrências daquele dia da semana —
                    e ainda assim confira antes de salvar.
                  </p>
                )}
              </div>

              {/* ---- Histórico ---- */}
              <div>
                <label htmlFor="ger-meses-hist" className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 block mb-1.5">
                  Competências analisadas
                </label>
                <select
                  id="ger-meses-hist"
                  value={intelligentModal.mesesHistorico}
                  onChange={(e) => setIntelligentModal(prev => prev ? { ...prev, mesesHistorico: parseInt(e.target.value) } : null)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
                >
                  {Array.from({ length: MESES_HISTORICO_MAX }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>
                      {n === 1 ? 'Apenas o mês anterior (recomendado)' : `Os ${n} meses anteriores`}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                  Parece que olhar mais meses acertaria mais, mas foi medido e é o contrário: com 3
                  competências o acerto no Regular caiu de 76% para 69%. Quem foi constante no mês
                  passado e diferente dois meses atrás deixa de alcançar o limiar e some da sugestão.
                  Use 2 ou 3 só em setor de rotina muito estável.
                </p>
              </div>

              {/* ---- Quantos meses gerar ---- */}
              <div>
                <label htmlFor="ger-meses-alvo" className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 block mb-1.5">
                  Competências a gerar
                </label>
                <select
                  id="ger-meses-alvo"
                  value={intelligentModal.quantidadeMeses}
                  onChange={(e) => setIntelligentModal(prev => prev ? { ...prev, quantidadeMeses: parseInt(e.target.value) } : null)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4, 5, 6].map(n => {
                    const nomes = Array.from({ length: n }, (_, i) => {
                      let m = mes + i, a = ano
                      while (m > 12) { m -= 12; a += 1 }
                      return `${new Date(a, m - 1, 1).toLocaleString('pt-BR', { month: 'short' })}/${String(a).slice(2)}`
                    })
                    return <option key={n} value={n}>{n === 1 ? 'Somente esta competência' : `${n} competências — ${nomes.join(', ')}`}</option>
                  })}
                </select>
                {intelligentModal.quantidadeMeses > 1 && (
                  <p className="mt-1.5 text-[11px] leading-snug text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 rounded-lg p-2">
                    A competência aberta continua sendo rascunho desta tela — nada vai ao banco sem você
                    clicar em <strong>Salvar Previsão</strong>. As competências seguintes são
                    <strong> criadas no banco com status Rascunho</strong>, porque não existe grade aberta
                    para segurá-las. Rascunho não entra em folha e não fecha competência; revise cada uma
                    antes de fechar.
                  </p>
                )}
                {intelligentModal.quantidadeMeses > 1 && intelligentModal.quantidadeMeses > 3 && (
                  <p className="mt-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                    Todas as competências são previstas a partir do mesmo histórico real — nenhuma é
                    prevista a partir do palpite da anterior. Ainda assim, quanto mais longe, menos o
                    passado descreve o futuro: afastamentos e férias desses meses provavelmente nem
                    foram cadastrados ainda.
                  </p>
                )}
              </div>

              {/* ---- Opções ---- */}
              <div className="space-y-3 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <label className="flex items-start gap-3 cursor-pointer pt-3">
                  <input
                    type="checkbox"
                    checked={intelligentModal.respectContinuity}
                    onChange={(e) => setIntelligentModal(prev => prev ? { ...prev, respectContinuity: e.target.checked } : null)}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 block">Respeitar Continuidade Histórica</span>
                    <span className="text-xs text-zinc-500 block">Detecta ciclos de passo fixo (12x36 e parentes) e continua a sequência na virada do mês.</span>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={intelligentModal.respectEvents}
                    onChange={(e) => setIntelligentModal(prev => prev ? { ...prev, respectEvents: e.target.checked } : null)}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 block">Evitar Dias de Afastamento</span>
                    <span className="text-xs text-zinc-500 block">Governa o padrão de folgas. Dia de férias ou licença nunca recebe turno, marcada ou não — é regra do banco.</span>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={intelligentModal.respectPreferences}
                    onChange={(e) => setIntelligentModal(prev => prev ? { ...prev, respectPreferences: e.target.checked } : null)}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 block">Respeitar Preferências de Turno</span>
                    <span className="text-xs text-zinc-500 block">Aceita um padrão menos consistente quando o turno é o preferido do servidor. Nunca inventa dia sem histórico.</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setIntelligentModal(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!intelligentModal) return
                  if (intelligentModal.categorias.length === 0) {
                    setAlertModal({ isOpen: true, title: 'Nenhuma Linha Marcada', message: 'Escolha pelo menos uma linha da grade para o gerador preencher.', type: 'warning' })
                    return
                  }
                  const opcoes = {
                    respectContinuity: intelligentModal.respectContinuity,
                    respectEvents: intelligentModal.respectEvents,
                    respectPreferences: intelligentModal.respectPreferences,
                    categorias: intelligentModal.categorias,
                    mesesHistorico: intelligentModal.mesesHistorico
                  }
                  const quantidadeMeses = intelligentModal.quantidadeMeses
                  setLoading(true)
                  try {
                    const resultado = await gerarEscalaInteligente(supabase, {
                      unidadeId,
                      setorId,
                      mes,
                      ano,
                      escalaMensal,
                      turnos,
                      options: opcoes,
                      quantidadeMeses
                    })

                    const mesDaGrade = resultado.meses.find(m => m.naGrade)
                    const mesesExtras = resultado.meses.filter(m => !m.naGrade)

                    // ---- 1. competência aberta: rascunho local, como sempre foi ----
                    //
                    // ⚠️ O contador precisa medir o que ENTROU na grade, não o que o motor
                    // produziu. Até 25/08/2026 ele contava a saída do motor e os dois `return`
                    // abaixo descartavam célula sem contabilizar nada — a tela dizia "111 turnos
                    // preenchidos" com ZERO células alteradas (caso real: TI da SMS, 08/2026,
                    // onde 81 caíram por já ter ponto batido e as 30 restantes já estavam
                    // lançadas com o mesmo turno). "Executou e não achei a escala" era isso.
                    let aplicadas = 0
                    let jaIguais = 0
                    let puladasPorPonto = 0
                    let puladasPorAfastamento = 0
                    let puladasPorConflito = 0
                    let puladasPorTeto = 0
                    let puladasPorExtraSemRegular = 0
                    const servidoresPorTeto: string[] = []

                    // ⚠️ A mesclagem é feita AQUI, de forma síncrona, e só o resultado pronto vai
                    // para o setGridData. Não mover isto para dentro de um `setGridData(prev => …)`:
                    // o React chama o updater na fase de render, não na linha em que ele é
                    // escrito, então os contadores abaixo ainda valeriam zero quando o resumo e o
                    // logAction os lessem — e a tela voltaria a relatar um número que não é o que
                    // aconteceu, que é exatamente o defeito que esta mudança conserta. Em modo
                    // estrito o updater ainda roda duas vezes, o que dobraria as contagens.
                    if (mesDaGrade) {
                      const atualizado = { ...gridData }

                      Object.entries(mesDaGrade.grid).forEach(([servidorId, categorias]) => {
                        const anterior = atualizado[servidorId] || { Regular: {}, Extra: {}, 'Plantão': {}, Sobreaviso: {} }
                        let aplicadasDoServidor = 0
                        const novo: Record<RowCategory, Record<number, string>> = {
                          Regular: { ...anterior['Regular'] },
                          Extra: { ...anterior['Extra'] },
                          'Plantão': { ...anterior['Plantão'] },
                          Sobreaviso: { ...anterior['Sobreaviso'] }
                        }

                        // Ordem fixa (não a ordem em que o motor devolveu as categorias): Regular
                        // antes de Extra, para a rede de segurança abaixo enxergar o Regular que
                        // este MESMO lote acabou de gerar, e não só o que já estava salvo.
                        const ORDEM_CATEGORIAS: RowCategory[] = ['Regular', 'Plantão', 'Sobreaviso', 'Extra']
                        ORDEM_CATEGORIAS.forEach(cat => {
                          const days = (categorias as Partial<Record<RowCategory, Record<string, string>>>)[cat]
                          if (!days) return
                          Object.entries(days).forEach(([dayStr, turnoId]) => {
                            const day = parseInt(dayStr)

                            // Dia com presença confirmada não é sobrescrito: a batida real já
                            // aconteceu contra o turno que está lá.
                            const em = escalaMensal.find(x => x.servidor_id === servidorId)
                            if (em && hasPresenceForDay(servidorId, em.id, cat, day)) {
                              puladasPorPonto++
                              return
                            }

                            // Rede de segurança do afastamento. O motor já limpou, mas a grade
                            // conhece `permitir_plantao_extra_durante_eventos`, que ele não vê.
                            const turnoGerado = turnos.find(t => t.id === turnoId)
                            if (getAfastamentoBloqueante(servidorId, day, cat, turnoGerado?.slots || [])) {
                              puladasPorAfastamento++
                              return
                            }

                            // Sobreposição com outro setor. O motor não enxerga as outras escalas
                            // do servidor — ele prevê a partir do histórico DESTE setor. Sem esta
                            // rede o gerador escala alguém que já está em outro lugar no mesmo
                            // horário, e o trigger do banco derruba o lote inteiro no salvar.
                            if (em && encontrarConflitoExterno(externalOccupancy, servidorId, em.id, day, turnoGerado?.slots || [])) {
                              puladasPorConflito++
                              return
                            }

                            // Hora extra é extensão do expediente REGULAR, nunca do plantão
                            // (armadilha 16 — plantão já tem duração e pagamento próprios,
                            // PL12/PL6/PL4). O motor prevê cada linha de forma independente a
                            // partir do histórico, então uma Extra órfã de mês antigo pode
                            // ensinar o gerador a repetir o erro — esta rede olha o dia FINAL
                            // (Regular já aplicado nesta mesma passada, graças à ordem acima).
                            if (cat === 'Extra' && !novo['Regular'][day]) {
                              puladasPorExtraSemRegular++
                              return
                            }

                            if (novo[cat][day] === turnoId) {
                              jaIguais++
                              return
                            }

                            novo[cat][day] = turnoId
                            aplicadas++
                            aplicadasDoServidor++
                          })
                        })

                        // Teto mensal do servidor, somando as outras escalas da competência.
                        //
                        // ⚠️ Tudo ou nada por servidor, de propósito. Preencher "até bater no
                        // teto" entregaria meio mês escalado e a outra metade em branco, com o
                        // corte caindo num dia arbitrário — pior que não gerar e dizer por quê.
                        //
                        // Só recusa se o resultado PIORA: quem já estava acima do teto (com
                        // Autorização Extraordinária vencida ou lançamento anterior) não fica
                        // impedido de receber uma sugestão que não acrescenta hora nenhuma.
                        if (aplicadasDoServidor > 0) {
                          const antes = calculateTotals(servidorId, anterior)
                          const depois = calculateTotals(servidorId, novo)
                          const cargaDepois = avaliarCargaDoServidor(servidorId, depois.totalPlanejado, depois.p_soQtd)
                          const piorou = depois.totalPlanejado > antes.totalPlanejado
                                      || depois.p_soQtd > antes.p_soQtd

                          if (cargaDepois.excede && piorou) {
                            const nome = escalaMensal.find(x => x.servidor_id === servidorId)?.servidores?.nome || 'Servidor'
                            const onde = cargaDepois.outras.length > 0
                              ? ` (${formatarHoras(cargaDepois.horasLocais)}h aqui e ${cargaDepois.outras.map(o => `${formatarHoras(o.horas)}h em ${o.setor_caminho}`).join(', ')})`
                              : ''
                            servidoresPorTeto.push(`${nome} chegaria a ${formatarHoras(cargaDepois.totalHoras)}h, teto ${formatarHoras(cargaDepois.tetoHoras)}h${onde}`)
                            puladasPorTeto += aplicadasDoServidor
                            aplicadas -= aplicadasDoServidor
                            atualizado[servidorId] = anterior
                            return
                          }
                        }

                        atualizado[servidorId] = novo
                      })

                      setGridData(atualizado)
                    }

                    // Jornada herdada da competência anterior, para quem ainda não tem.
                    setEscalaMensal(prev => prev.map(em =>
                      !em.jornada_id && resultado.jornadas[em.servidor_id]
                        ? { ...em, jornada_id: resultado.jornadas[em.servidor_id] }
                        : em
                    ))

                    // ---- 2. competências seguintes: gravadas como Rascunho ----
                    let extrasGravadas: { rotulo: string; celulas: number }[] = []
                    let extrasErro = ''
                    if (mesesExtras.length > 0) {
                      try {
                        extrasGravadas = await persistirMesesGerados(mesesExtras, resultado.jornadas)
                      } catch (e: any) {
                        extrasErro = e?.message || 'erro desconhecido'
                      }
                    }

                    logAction('GERAR_ESCALA_INTELIGENTE', {
                      setor_id: setorId,
                      opcoes,
                      quantidade_meses: quantidadeMeses,
                      // Os dois números que faltavam: o que o motor propôs e o que de fato mudou.
                      celulas_sugeridas: mesDaGrade?.total || 0,
                      celulas_aplicadas: aplicadas,
                      ja_iguais: jaIguais,
                      puladas_por_ponto: puladasPorPonto,
                      puladas_por_afastamento: puladasPorAfastamento,
                      puladas_por_conflito_setor: puladasPorConflito,
                      puladas_por_teto_mensal: puladasPorTeto,
                      puladas_por_extra_sem_regular: puladasPorExtraSemRegular,
                      servidores_acima_do_teto: servidoresPorTeto,
                      meses_extras: extrasGravadas,
                      meses_de_origem: resultado.mesesDeOrigemEncontrados
                    })

                    setIntelligentModal(null)
                    setAlertModal({
                      isOpen: true,
                      title: 'Gerador Inteligente',
                      message: montarResumoGerador({
                        mesDaGrade,
                        aplicadas,
                        jaIguais,
                        puladasPorPonto,
                        puladasPorAfastamento,
                        puladasPorConflito,
                        puladasPorTeto,
                        puladasPorExtraSemRegular,
                        servidoresPorTeto,
                        extrasGravadas,
                        extrasErro,
                        servidoresSemHistorico: resultado.servidoresSemHistorico,
                        mesesDeOrigem: resultado.mesesDeOrigemEncontrados,
                        mesRef: mes,
                        anoRef: ano
                      }),
                      type: aplicadas > 0 || extrasGravadas.length > 0 ? 'success' : 'warning'
                    })
                  } catch (err: any) {
                    console.error('Erro no gerador inteligente:', err)
                    setAlertModal({
                      isOpen: true,
                      title: 'Erro na Geração',
                      message: `Não foi possível calcular a escala.\n\n${err?.message || 'Verifique a conexão e tente novamente.'}`,
                      type: 'danger'
                    })
                  } finally {
                    setLoading(false)
                  }
                }}
                disabled={loading}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-all shadow-lg shadow-indigo-500/20 min-w-[140px] flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Sugerir Escala
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Troca de turno em dia que já tem ponto (dobra de plantão, correção de turno trabalhado).
          Não é confirmação: é justificativa. O motivo vira histórico com de→para e autor, e é
          acrescentado à justificativa do evento daquele dia — que é o que sai no relatório.
          Ver 20260821110000_shift_change_history_and_justification.sql */}
      <Modal
        isOpen={trocaTurnoModal.isOpen}
        onClose={() => { if (!trocaTurnoModal.salvando) setTrocaTurnoModal(prev => ({ ...prev, isOpen: false })) }}
        title="Justificativa da alteração de turno"
        footer={
          <>
            <button
              onClick={() => setTrocaTurnoModal(prev => ({ ...prev, isOpen: false }))}
              disabled={trocaTurnoModal.salvando}
              className="flex-1 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 font-bold disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={confirmarTrocaTurno}
              disabled={trocaTurnoModal.salvando || trocaTurnoModal.texto.trim().length < 10}
              className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold disabled:opacity-50"
            >
              {trocaTurnoModal.salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Alterar e justificar
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              {trocaTurnoModal.servidorNome} — dia {trocaTurnoModal.day} ({trocaTurnoModal.categoria})
            </p>
            <p className="text-sm text-amber-900 dark:text-amber-200 mt-1">
              <span className="font-black">{trocaTurnoModal.codigoAnterior || '—'}</span>
              {' → '}
              <span className="font-black">{trocaTurnoModal.codigoNovo}</span>
            </p>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Este dia <span className="font-bold">já tem ponto registrado</span>. Trocar o turno muda o
            horário previsto contra o qual esse ponto é julgado — hora extra, falta e o horário que o
            terminal vai cobrar. As marcações já registradas <span className="font-bold">não se perdem</span>.
            Descreva o motivo: ele fica no histórico da escala e sai no relatório de {trocaTurnoModal.categoria}.
          </p>
          <textarea
            value={trocaTurnoModal.texto}
            onChange={(e) => setTrocaTurnoModal(prev => ({ ...prev, texto: e.target.value }))}
            rows={4}
            autoFocus
            placeholder="Ex.: o servidor do plantão noturno não compareceu e a servidora foi convocada a dobrar."
            className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
          />
          <p className="text-xs text-zinc-500">
            {trocaTurnoModal.texto.trim().length < 10
              ? 'Descreva o motivo com pelo menos 10 caracteres.'
              : 'A alteração é gravada assim que você confirmar — não depende do "Salvar Previsão".'}
          </p>
        </div>
      </Modal>

      {/* Hora de início de turno de duração livre (T4, N4, N6, M7...).
          O código do turno diz a duração e o período, não a hora — só quem escala sabe.
          Ver docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md */}
      <Modal
        isOpen={horaModal.isOpen}
        onClose={() => setHoraModal(prev => ({ ...prev, isOpen: false }))}
        title={`Horário do turno ${horaModal.turnoCodigo}`}
        footer={
          <>
            <button
              onClick={() => setHoraModal(prev => ({ ...prev, isOpen: false }))}
              className="flex-1 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 font-bold"
            >
              Definir depois
            </button>
            <button
              onClick={() => {
                setGridHoras(prev => {
                  const serverData = prev[horaModal.servidorId] || { 'Regular': {}, 'Extra': {}, 'Plantão': {}, 'Sobreaviso': {} }
                  const catData = { ...(serverData[horaModal.categoria] || {}) }
                  if (horaModal.valor) catData[horaModal.day] = horaModal.valor
                  else delete catData[horaModal.day]
                  return { ...prev, [horaModal.servidorId]: { ...serverData, [horaModal.categoria]: catData } }
                })
                setHoraModal(prev => ({ ...prev, isOpen: false }))
              }}
              className="flex-1 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-bold"
            >
              Confirmar
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-bold">{horaModal.servidorNome}</span> — dia {horaModal.day}.{' '}
            {horaModal.ancorado ? (
              <>
                O código <span className="font-bold">{horaModal.turnoCodigo}</span> já determina a hora
                pela escala do dia. Informe aqui só para <span className="font-bold">sobrepor</span> esse
                cálculo neste dia — a hora informada vence todas as demais regras.
              </>
            ) : (
              <>
                O código <span className="font-bold">{horaModal.turnoCodigo}</span> define a duração
                ({horaModal.horasComputadas}h) e o período, mas não a hora de início. Informe quando começa.
              </>
            )}
          </p>
          <select
            value={horaModal.valor}
            onChange={(e) => setHoraModal(prev => ({ ...prev, valor: e.target.value }))}
            className="w-full px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-transparent font-bold"
          >
            <option value="">{horaModal.ancorado ? 'Não sobrepor (usar o cálculo do sistema)' : 'Não informar (o sistema estima)'}</option>
            {Array.from({ length: 24 }, (_, h) => {
              const hh = `${String(h).padStart(2, '0')}:00`
              const fimH = (h + horaModal.horasComputadas) % 24
              const vira = h + horaModal.horasComputadas >= 24
              return (
                <option key={hh} value={hh}>
                  {hh} às {String(fimH).padStart(2, '0')}:00{vira ? ' (dia seguinte)' : ''}
                </option>
              )
            })}
          </select>
          <p className="text-xs text-zinc-500">
            {horaModal.ancorado
              ? 'Use só quando o dia fugir da regra. O cálculo automático já considera a jornada do servidor, inclusive a noturna. O horário aqui vale para este dia apenas.'
              : 'Sem informar, o sistema continua estimando pela escala do dia — que é justamente o que deixou servidores sem conseguir bater o ponto. O horário aqui vale para este dia apenas.'}
          </p>
        </div>
      </Modal>

      {/* Modals Extras */}
      {/*
        🚨 O ALERTA É O ÚLTIMO A APARECER E TEM DE FICAR POR CIMA DE TODOS (01/09/2026).
        Ele é renderizado ANTES dos outros modais deste arquivo e todos usam o `z-[100]` padrão
        do `Modal` — com o mesmo z-index, quem vem depois no DOM ganha. Resultado medido em
        campo: a recusa da validação manual ("Horários Inconsistentes") abria ATRÁS do modal de
        Validar Presença, que continua aberto de propósito para o coordenador corrigir. Ninguém
        via a mensagem, e a tela parecia travada no clique. Não é o caso do `confirmModal` logo
        abaixo, onde quem fecha é o botão: aqui o modal de baixo PRECISA continuar aberto.
      */}
      <Modal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
        title={alertModal.title}
        type={alertModal.type as any}
        zIndexClass="z-[130]"
        footer={
          <div className="w-full flex flex-col gap-2">
            {alertModal.action && (
              <button
                type="button"
                onClick={() => {
                  const act = alertModal.action?.onClick
                  setAlertModal(prev => ({ ...prev, isOpen: false }))
                  act?.()
                }}
                className="w-full px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                {alertModal.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
              className={`w-full px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                alertModal.action 
                  ? 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs' 
                  : 'bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-bold'
              }`}
            >
              Entendido
            </button>
          </div>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-line leading-relaxed">{alertModal.message}</p>
      </Modal>

      {confirmModal && (
        <Modal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(null)}
          title={confirmModal.title}
          type={confirmModal.type as any}
          footer={
            <>
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
              >
                Cancelar
              </button>
              <button
                /*
                  🚨 FECHAR É RESPONSABILIDADE DO BOTÃO, NUNCA DO CALLBACK (28/08/2026).
                  Isto era `onClick={confirmModal.onConfirm}`: quem fechava era cada callback,
                  um por um, e dois dos oito esqueceram — os dois de "Teto Mensal Excedido",
                  que abrem o modal de Autorização Extraordinária. O de confirmação ficava na
                  tela por cima do que acabou de abrir (`AutorizacaoExcecaoModal` é `z-50`, o
                  `Modal` compartilhado é `z-[100]`), e o usuário via a tela nova "por trás".
                  Fechar aqui é o único lugar que não dá para esquecer ao acrescentar um fluxo.

                  ⚠️ A ORDEM IMPORTA: fecha ANTES de executar. React agrupa os setState do
                  mesmo handler e o último vence — então um callback que ENCADEIA outra
                  confirmação continua funcionando (null → novo = novo). Invertido, o encadeado
                  seria apagado pelo próprio fechamento.
                */
                onClick={() => {
                  const acao = confirmModal.onConfirm
                  setConfirmModal(null)
                  acao?.()
                }}
                className={`flex-1 px-4 py-2 rounded-xl text-white font-bold ${
                  confirmModal.type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 
                  confirmModal.type === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                Confirmar
              </button>
            </>
          }
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{confirmModal.message}</p>
        </Modal>
      )}

      {manualPresenceModal && (() => {
        const cellEmItem = escalaMensal.find(em => em.id === manualPresenceModal.escalaMensalId)
        const cellTurnoId = cellEmItem?.dias?.[manualPresenceModal.dia]?.[manualPresenceModal.categoria]
        const cellTurno = turnos.find(t => t.id === cellTurnoId)
        const turnoCode = cellTurno?.codigo || ''

        let p1Sub = '1º Turno / Entrada'
        let p2Sub = '2º Turno / Saída'

        if (turnoCode === 'MT' || (cellTurno?.slots?.includes('M') && cellTurno?.slots?.includes('T'))) {
          p1Sub = 'Manhã (07h-11h)'
          p2Sub = 'Tarde (13h-17h)'
        } else if (turnoCode.startsWith('N') || cellTurno?.slots?.includes('N')) {
          p1Sub = 'Entrada Noturna'
          p2Sub = 'Saída Noturna'
        } else if (turnoCode.startsWith('T') || cellTurno?.slots?.includes('T')) {
          p1Sub = 'Entrada Tarde'
          p2Sub = 'Saída Tarde'
        } else if (turnoCode.startsWith('M') || cellTurno?.slots?.includes('M')) {
          p1Sub = 'Entrada Manhã'
          p2Sub = 'Saída Manhã'
        }

        const formatTipoLabel = (tipo: string) => {
          switch (tipo) {
            case 'completo': return 'Dia Completo'
            case 'periodo_1': return `1º Período (${p1Sub})`
            case 'periodo_2': return `2º Período (${p2Sub})`
            case 'entrada': return 'Entrada'
            case 'intervalo_saida': return 'Saída do Intervalo'
            case 'intervalo_retorno': return 'Retorno do Intervalo'
            case 'saida': return 'Saída Final'
            default: return tipo
          }
        }
        const labelTipo = formatTipoLabel(manualPresenceModal.tipo)
        const noDiaDaCelula = (iso: string) => {
          const d = new Date(iso)
          return d.getDate() === manualPresenceModal.dia && d.getMonth() + 1 === mes && d.getFullYear() === ano
        }

        const cellDeniedAttempts = logsTentativas.filter(l =>
          l.servidor_id === manualPresenceModal.servidorId && noDiaDaCelula(l.data_hora_tentativa))

        // Batidas fora da janela que o terminal registrou para este servidor neste dia.
        const cellPendentes = marcacoesPendentes.filter(m =>
          m.servidor_id === manualPresenceModal.servidorId && noDiaDaCelula(m.ocorrido_em))

        // Quais campos de horário o escopo escolhido pede.
        const unidadeMarcaIntervalo = !!unidadedata?.permite_marca_intervalo
          && (manualPresenceModal.categoria === 'Regular' || manualPresenceModal.categoria === 'Plantão')

        const passosDoEscopo: PassoPresenca[] = (() => {
          switch (manualPresenceModal.tipo) {
            case 'completo':
              return unidadeMarcaIntervalo
                ? ['entrada', 'intervalo_saida', 'intervalo_retorno', 'saida']
                : ['entrada', 'saida']
            case 'periodo_1':
              return unidadeMarcaIntervalo ? ['entrada', 'intervalo_saida'] : ['entrada']
            case 'periodo_2':
              return unidadeMarcaIntervalo ? ['intervalo_retorno', 'saida'] : ['saida']
            default:
              return [manualPresenceModal.tipo as PassoPresenca]
          }
        })()

        // Identifica horários já preenchidos/utilizados na escala em passos fora do escopo atual
        const diaPresence = presenceData[manualPresenceModal.servidorId]?.[manualPresenceModal.categoria]?.[manualPresenceModal.dia]
        const horariosJaUsados = new Set<string>()
        if (diaPresence) {
          const addHora = (iso?: string | null) => {
            if (!iso) return
            const d = new Date(iso)
            horariosJaUsados.add(formatarHoraComSegundos(d))
            horariosJaUsados.add(formatarHora(d))
          }
          if (!passosDoEscopo.includes('entrada')) addHora(diaPresence.entrada_em)
          if (!passosDoEscopo.includes('intervalo_saida')) addHora(diaPresence.intervalo_saida_em)
          if (!passosDoEscopo.includes('intervalo_retorno')) addHora(diaPresence.intervalo_retorno_em)
          if (!passosDoEscopo.includes('saida')) addHora(diaPresence.saida_em)
        }

        // A MESMA batida física aparece nas duas listas: desde a v1.22.0 (20260808100000) uma
        // batida fora da janela gera tentativa em logs_tentativas_presenca E marcação pendente em
        // marcacoes_ponto. Exibir as duas confundiria, e selecionar as duas gravaria em dobro.
        // A marcação vence porque é ela que tem id em marcacoes_ponto. 5s de folga porque os dois
        // now() do banco não são o mesmo instante.
        type BatidaDoDia = {
          fonte: 'marcacao' | 'tentativa'
          id: string
          quando: Date
          elegivel: boolean
          motivo?: string
          previstoNaEpoca?: string | null
        }
        const todasBatidas: BatidaDoDia[] = cellPendentes.map((m): BatidaDoDia => ({
          fonte: 'marcacao', id: m.id, quando: new Date(m.ocorrido_em), elegivel: true
        }))
        for (const l of cellDeniedAttempts) {
          const quando = new Date(l.data_hora_tentativa)
          const gemea = todasBatidas.find(o => o.fonte === 'marcacao'
            && Math.abs(o.quando.getTime() - quando.getTime()) <= 5000)
          if (gemea) {
            gemea.motivo = gemea.motivo || l.mensagem_erro
            gemea.previstoNaEpoca = gemea.previstoNaEpoca || l.escala_prevista_inicio
            continue
          }
          todasBatidas.push({
            fonte: 'tentativa', id: l.id, quando,
            elegivel: !!l.elegivel, motivo: l.mensagem_erro,
            previstoNaEpoca: l.escala_prevista_inicio
          })
        }
        todasBatidas.sort((a, b) => a.quando.getTime() - b.quando.getTime())

        // Suprime batidas que já estão em uso em passos fora do escopo e deduplica horários repetidos
        const batidasDoDia: BatidaDoDia[] = []
        const horariosVistos = new Set<string>()
        for (const b of todasBatidas) {
          const hComSec = horaComSegundos(b.quando)
          const hSemSec = hComSec.slice(0, 5)
          if (horariosJaUsados.has(hComSec) || horariosJaUsados.has(hSemSec)) {
            continue // Já utilizada em outro período/passo da escala
          }
          if (horariosVistos.has(hComSec)) {
            continue // Deduplica tentativa/marcação idêntica
          }
          horariosVistos.add(hComSec)
          batidasDoDia.push(b)
        }

        const batidasSelecionaveis = batidasDoDia.filter(b => b.elegivel)

        // Rajada de tentativas repetidas cai toda com a mesma mensagem. Repeti-la em cada linha
        // triplicava a altura do modal sem dizer nada de novo: quando é uma só, sai no rodapé.
        const motivosDistintos = Array.from(new Set(
          batidasDoDia.map(b => `${b.motivo || ''}|${b.previstoNaEpoca || ''}`).filter(k => k !== '|')))
        const motivoComum = motivosDistintos.length === 1 && batidasDoDia.every(b => b.motivo)
          ? { texto: batidasDoDia[0].motivo!, previsto: batidasDoDia[0].previstoNaEpoca }
          : null

        const rotuloPasso = (p: PassoPresenca) => ({
          entrada: 'Entrada',
          intervalo_saida: 'Saída Interv.',
          intervalo_retorno: 'Retorno Interv.',
          saida: 'Saída',
        }[p])

        // O previsto vem do BANCO (fn_blocos_previstos_mes, via blocoDaCelula) — a mesma fonte
        // que o terminal cobra, já com a âncora espelho da jornada noturna (armadilha 4, nível
        // 2-A). Sem ele o coordenador decide às cegas, e a sugestão de passo não tem âncora.
        const blocoCelula = blocoDaCelula(
          manualPresenceModal.servidorId, manualPresenceModal.categoria, manualPresenceModal.dia)
        const previstoIso = (p: PassoPresenca): string | null => {
          if (!blocoCelula) return null
          return (p === 'entrada'           ? blocoCelula.inicio_previsto
                : p === 'saida'             ? blocoCelula.fim_previsto
                : p === 'intervalo_saida'   ? blocoCelula.intervalo_inicio_previsto
                : p === 'intervalo_retorno' ? blocoCelula.intervalo_fim_previsto : null) || null
        }
        const previstoHHMM = (p: PassoPresenca) => {
          const iso = previstoIso(p)
          if (!iso) return null
          return formatarHora(iso)
        }

        const selecoes = manualPresenceModal.selecoes || {}
        const passoDaBatida = (id: string) =>
          (Object.keys(selecoes) as PassoPresenca[]).find(p => selecoes[p]?.id === id) || null

        // "+1 dia" ao lado do passo que cai no dia seguinte.
        //
        // O campo é `<input type="time">`: o coordenador digita HH:MM e não tem onde dizer a
        // DATA. Num plantão 19:00–07:00 a saída é do dia seguinte, e sem esta marca ele não tem
        // como saber se o sistema entendeu "07:00 de hoje" (o que seria 12h antes da entrada) ou
        // "07:00 de amanhã". A regra é a MESMA que valida o envio e a que o banco aplica ao
        // gravar (fn_registrar_presenca_informada) — não é uma terceira conta.
        const horaFinalDoPasso = (p: PassoPresenca) => {
          if (selecoes[p]?.hora) return selecoes[p]!.hora.slice(0, 5)
          if (manualPresenceModal.horarios?.[p]) return manualPresenceModal.horarios[p]!.slice(0, 5)
          const iso = p === 'entrada' ? diaPresence?.entrada_em
            : p === 'intervalo_saida' ? diaPresence?.intervalo_saida_em
            : p === 'intervalo_retorno' ? diaPresence?.intervalo_retorno_em
            : diaPresence?.saida_em
          return iso ? formatarHora(iso) : null
        }
        const cruzaMeiaNoiteNaCelula = celulaCruzaMeiaNoite(
          manualPresenceModal.servidorId, manualPresenceModal.categoria, manualPresenceModal.dia)
        const passosNoDiaSeguinte = new Set(avaliarSequenciaPresenca({
          entrada: horaFinalDoPasso('entrada'),
          intervalo_saida: horaFinalDoPasso('intervalo_saida'),
          intervalo_retorno: horaFinalDoPasso('intervalo_retorno'),
          saida: horaFinalDoPasso('saida'),
        }, { cruzaMeiaNoite: cruzaMeiaNoiteNaCelula }).diaSeguinte)

        // Sugestão de qual passo cada batida preenche: mesma ideia de fn_batidas_reais_recusadas
        // — proximidade ao previsto, gulosa, sem reuso, 90 min de tolerância. Aqui ela só
        // pré-seleciona o passo no momento do clique; quem grava é o banco, e o coordenador pode
        // trocar. Sem previsto no bloco, o palpite é a ordem cronológica.
        const sugestaoPorBatida = (() => {
          const out = new Map<string, PassoPresenca>()
          const pares: { id: string; passo: PassoPresenca; dist: number }[] = []
          for (const b of batidasSelecionaveis) {
            for (const p of passosDoEscopo) {
              const iso = previstoIso(p)
              if (!iso) continue
              const dist = Math.abs(b.quando.getTime() - new Date(iso).getTime())
              if (dist <= 90 * 60 * 1000) pares.push({ id: b.id, passo: p, dist })
            }
          }
          pares.sort((a, b) => a.dist - b.dist)
          const passosUsados = new Set<PassoPresenca>()
          for (const par of pares) {
            if (out.has(par.id) || passosUsados.has(par.passo)) continue
            out.set(par.id, par.passo)
            passosUsados.add(par.passo)
          }
          // Sobrou batida sem par: cai no primeiro passo ainda livre, em ordem cronológica.
          for (const b of batidasSelecionaveis) {
            if (out.has(b.id)) continue
            const livre = passosDoEscopo.find(p => !passosUsados.has(p))
            if (!livre) break
            out.set(b.id, livre)
            passosUsados.add(livre)
          }
          return out
        })()

        const alternarBatida = (b: BatidaDoDia, passo?: PassoPresenca) => {
          setManualPresenceModal(prev => {
            if (!prev) return null
            const atuais = { ...(prev.selecoes || {}) }
            const passoAtual = (Object.keys(atuais) as PassoPresenca[])
              .find(p => atuais[p]?.id === b.id)

            if (passoAtual && !passo) {
              delete atuais[passoAtual]
              return { ...prev, selecoes: atuais }
            }

            const destino = passo
              || sugestaoPorBatida.get(b.id)
              || passosDoEscopo.find(p => !atuais[p])
              || passosDoEscopo[0]
            if (!destino) return prev

            // Um passo aceita um horário e uma batida serve um passo: as duas direções da
            // exclusão mútua precisam valer, senão a mesma batida entraria duas vezes.
            if (passoAtual) delete atuais[passoAtual]
            atuais[destino] = { fonte: b.fonte, id: b.id, hora: horaComSegundos(b.quando) }

            const horarios = { ...(prev.horarios || {}) }
            delete horarios[destino]
            return { ...prev, selecoes: atuais, horarios }
          })
        }

        return (
          <Modal
            isOpen={manualPresenceModal.isOpen}
            onClose={() => setManualPresenceModal(null)}
            title={manualPresenceModal.isReverting ? `Reverter Presença — ${manualPresenceModal.servidorNome}` : `Validar Presença — ${manualPresenceModal.servidorNome}`}
            type={manualPresenceModal.isReverting ? "danger" : "warning"}
            footer={
              <>
                <button
                  onClick={() => setManualPresenceModal(null)}
                  className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmManualPresence}
                  // Batida SELECIONADA vale tanto quanto horário digitado: o passo já tem horário,
                  // só que vindo do terminal. Exigir digitação aqui trancaria justamente o caminho
                  // que preserva o horário real — que é o preferível dos dois.
                  disabled={loading || (!manualPresenceModal.isReverting && (
                    !manualPresenceModal.justificativa?.trim() || (
                      !Object.values(manualPresenceModal.horarios || {}).some(v => !!v) &&
                      !Object.values(manualPresenceModal.selecoes || {}).some(v => !!v)
                    )
                  ))}
                  className={`flex-1 px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 ${
                    manualPresenceModal.isReverting 
                      ? "bg-red-600 hover:bg-red-700 text-white" 
                      : "bg-amber-600 hover:bg-amber-700 text-white"
                  }`}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (manualPresenceModal.isReverting ? 'Confirmar Reversão' : 'Confirmar Validação')}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {manualPresenceModal.isReverting ? (
                  <>Reverter registro de <strong>{labelTipo}</strong> do dia <strong>{manualPresenceModal.dia}</strong>.</>
                ) : (
                  <>Validando presença do dia <strong>{manualPresenceModal.dia}</strong> para <strong>{manualPresenceModal.servidorNome}</strong>.</>
                )}
              </p>

              {!manualPresenceModal.isReverting && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                    Selecione o Escopo da Validação:
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setManualPresenceModal(prev => prev ? { ...prev, tipo: 'completo' } : null)}
                      className={`p-2 text-xs font-bold rounded-lg border transition-all ${manualPresenceModal.tipo === 'completo' ? 'bg-emerald-600 text-white border-emerald-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                    >
                      🟢 Dia Completo
                      <span className="block text-[10px] font-normal opacity-80 mt-0.5">Integral</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualPresenceModal(prev => prev ? { ...prev, tipo: 'periodo_1' } : null)}
                      className={`p-2 text-xs font-bold rounded-lg border transition-all ${manualPresenceModal.tipo === 'periodo_1' ? 'bg-amber-600 text-white border-amber-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                    >
                      ⛅ 1º Período
                      <span className="block text-[10px] font-normal opacity-80 mt-0.5">{p1Sub}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualPresenceModal(prev => prev ? { ...prev, tipo: 'periodo_2' } : null)}
                      className={`p-2 text-xs font-bold rounded-lg border transition-all ${manualPresenceModal.tipo === 'periodo_2' ? 'bg-blue-600 text-white border-blue-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                    >
                      🌇 2º Período
                      <span className="block text-[10px] font-normal opacity-80 mt-0.5">{p2Sub}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Batidas do dia — tentativas recusadas e marcações fora da janela na MESMA lista,
                  deduplicadas: desde a v1.22.0 o mesmo evento físico gera as duas. Selecionar
                  manda o ID ao banco, não o horário: é assim que os segundos, a origem `terminal`
                  e o vínculo com a marcação sobrevivem. Copiar o HH:MM para o campo, como antes,
                  rebaixava a batida real a declaração do coordenador. */}
              {!manualPresenceModal.isReverting && batidasDoDia.length > 0 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 text-xs font-bold">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>Batidas registradas no terminal neste dia:</span>
                  </div>
                  {/* Em colunas: uma rajada de retentativas rendia uma linha cada e empurrava o
                      rodapé para fora da tela. Só uma coluna quando há seletor de passo, que não
                      cabe ao lado da hora em meia largura. */}
                  <div className={`grid gap-x-3 gap-y-1.5 ${
                    batidasDoDia.length > 2 && passosDoEscopo.length === 1
                      ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}>
                    {batidasDoDia.map(b => {
                      const passoSel = passoDaBatida(b.id)
                      return (
                        <div key={`${b.fonte}-${b.id}`} className="flex items-start gap-2 flex-wrap">
                          {b.elegivel ? (
                            <input
                              type="checkbox"
                              checked={!!passoSel}
                              onChange={() => alternarBatida(b)}
                              className="mt-0.5 h-4 w-4 rounded border-amber-400 text-emerald-600 focus:ring-emerald-500"
                              aria-label={`Usar a batida das ${horaComSegundos(b.quando)}`}
                            />
                          ) : (
                            <span className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          )}
                          <strong className={`text-sm tabular-nums ${b.elegivel ? 'text-amber-900 dark:text-amber-200' : 'text-zinc-500 line-through'}`}>
                            {horaComSegundos(b.quando)}
                          </strong>

                          {b.elegivel && passosDoEscopo.length > 1 && (
                            <select
                              value={passoSel || ''}
                              onChange={(e) => alternarBatida(b, e.target.value as PassoPresenca)}
                              disabled={!passoSel}
                              className="text-[11px] rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-800 px-1.5 py-0.5 disabled:opacity-50"
                            >
                              <option value="" disabled>selecione o passo</option>
                              {passosDoEscopo.map(p => (
                                <option key={p} value={p}>{rotuloPasso(p)}</option>
                              ))}
                            </select>
                          )}

                          {/* Inelegível continua VISÍVEL — nunca descartar batida. Só não pode
                              virar horário de folha: PIN inválido não prova nem identidade. */}
                          {!b.elegivel && (
                            <span className="text-[11px] text-zinc-500 leading-snug">
                              {!motivoComum && b.motivo}
                              <span className="block italic">Não comprova presença.</span>
                            </span>
                          )}
                          {b.elegivel && !motivoComum && b.motivo && (
                            <span className="text-[10px] text-amber-700/80 dark:text-amber-400/80 leading-snug basis-full pl-6">
                              {b.motivo}
                              {b.previstoNaEpoca ? ` (previsão vigente na época: ${b.previstoNaEpoca})` : ''}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* O previsto da época NÃO é recalculado: divergir do previsto atual é o que
                      denuncia recusa por bug. Ver 20260809000000. */}
                  {motivoComum && (
                    <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 leading-snug">
                      Recusadas pelo terminal: {motivoComum.texto}
                      {motivoComum.previsto ? ` (previsão vigente na época: ${motivoComum.previsto})` : ''}
                    </p>
                  )}
                  {batidasSelecionaveis.length > 0 && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
                      Marcar usa o <b>horário exato</b> em que o servidor registrou. Deixe desmarcado
                      para digitar outro horário — é o caso de quem chegou no horário e só bateu depois.
                    </p>
                  )}
                </div>
              )}

              {/* Horários informados pelo servidor. Sem pré-preenchimento: o previsto aparece só
                  como referência ao lado do rótulo. Ver 20260808110000. */}
              {!manualPresenceModal.isReverting && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                    Horários Cumpridos <span className="text-red-500">*</span>
                  </label>
                  <div className={`grid gap-2 ${passosDoEscopo.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
                    {passosDoEscopo.map(p => {
                      const sel = selecoes[p]
                      const previsto = previstoHHMM(p)
                      return (
                        <div key={p}>
                          <label className="flex items-baseline justify-between gap-1 text-[10px] font-semibold text-zinc-500 mb-0.5">
                            <span>
                              {rotuloPasso(p)}
                              {passosNoDiaSeguinte.has(p) && (
                                <span
                                  title="Este horário é do dia seguinte — o turno atravessa a meia-noite."
                                  className="ml-1 px-1 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold"
                                >+1 dia</span>
                              )}
                            </span>
                            {previsto && <span className="font-normal tabular-nums">previsto {previsto}</span>}
                          </label>
                          {sel ? (
                            // Campo travado: o horário é o da batida, não há o que digitar. O ✕
                            // libera para digitação, que é o caminho de quem vai declarar outro.
                            <div className="w-full flex items-center gap-1 rounded-lg border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1.5">
                              <span className="text-sm tabular-nums font-bold text-emerald-800 dark:text-emerald-300 flex-1">{sel.hora}</span>
                              <button
                                type="button"
                                title="Usar outro horário"
                                onClick={() => setManualPresenceModal(prev => {
                                  if (!prev) return null
                                  const atuais = { ...(prev.selecoes || {}) }
                                  delete atuais[p]
                                  return { ...prev, selecoes: atuais }
                                })}
                                className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <input
                              type="time"
                              value={manualPresenceModal.horarios?.[p] || ''}
                              onChange={(e) => setManualPresenceModal(prev => prev
                                ? { ...prev, horarios: { ...(prev.horarios || {}), [p]: e.target.value } }
                                : null)}
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-sm tabular-nums focus:border-amber-500 focus:ring-amber-500"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-zinc-500 leading-snug">
                    Campo em verde = <b>batida real do terminal</b>, com o horário exato. Digitado =
                    o horário que o servidor <b>declara ter cumprido</b>. O sistema não preenche
                    mais o horário da jornada sozinho — registrar horário contratual como se fosse
                    cumprido é vedado pela Portaria 671/2021.
                  </p>
                </div>
              )}

              {/* O bloco vermelho de "histórico de recusas" foi removido: repetia exatamente as
                  mesmas batidas da lista acima, com os mesmos horários, em duas cores opostas —
                  dobrando a altura do modal para não dizer nada de novo. O motivo da recusa agora
                  aparece junto da batida a que pertence, e a previsão da época viaja com ele. */}

              {!manualPresenceModal.isReverting && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                    Justificativa da Validação Manual <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={2}
                    value={manualPresenceModal.justificativa || ''}
                    onChange={(e) => setManualPresenceModal(prev => prev ? { ...prev, justificativa: e.target.value } : null)}
                    placeholder="Informe o motivo/justificativa desta validação manual..."
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-xs outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-white"
                  />
                </div>
              )}

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 rounded-lg">
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Esta ação será gravada nos registros de auditoria vinculados ao seu usuário.
                </p>
              </div>
            </div>
          </Modal>
        )
      })()}

      {bulkServerModal && (
        <Modal
          isOpen={bulkServerModal.isOpen}
          onClose={() => setBulkServerModal(null)}
          title={`Validar Período — ${bulkServerModal.servidorNome}`}
          type="warning"
          footer={
            <>
              <button
                onClick={() => setBulkServerModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkServerValidation}
                disabled={loading || !bulkServerModal.justificativa?.trim()}
                className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar Validação'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Validar presenças para <strong>{bulkServerModal.servidorNome}</strong> em um intervalo de dias.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Dia Inicial</label>
                <input
                  type="number"
                  min={1}
                  max={maxValidDay || daysInMonth}
                  value={bulkServerModal.startDay}
                  onChange={(e) => setBulkServerModal(prev => prev ? { ...prev, startDay: Math.max(1, Math.min(maxValidDay || daysInMonth, parseInt(e.target.value) || 1)) } : null)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white font-bold text-center"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Dia Final</label>
                <input
                  type="number"
                  min={1}
                  max={maxValidDay || daysInMonth}
                  value={bulkServerModal.endDay}
                  onChange={(e) => setBulkServerModal(prev => prev ? { ...prev, endDay: Math.max(1, Math.min(maxValidDay || daysInMonth, parseInt(e.target.value) || (maxValidDay || daysInMonth))) } : null)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white font-bold text-center"
                />
              </div>
            </div>

            {maxValidDay > 0 && maxValidDay < daysInMonth && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                ⚠️ Apenas presenças até hoje (dia {maxValidDay}) podem ser validadas. Datas futuras estão bloqueadas.
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                Modo de Validação:
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setBulkServerModal(prev => prev ? { ...prev, modo: 'completo' } : null)}
                  className={`p-2 text-xs font-bold rounded-lg border transition-all ${bulkServerModal.modo === 'completo' ? 'bg-emerald-600 text-white border-emerald-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                >
                  🟢 Dia Completo
                </button>
                <button
                  type="button"
                  onClick={() => setBulkServerModal(prev => prev ? { ...prev, modo: 'periodo_1' } : null)}
                  className={`p-2 text-xs font-bold rounded-lg border transition-all ${bulkServerModal.modo === 'periodo_1' ? 'bg-amber-600 text-white border-amber-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                >
                  ⛅ 1º Período
                </button>
                <button
                  type="button"
                  onClick={() => setBulkServerModal(prev => prev ? { ...prev, modo: 'periodo_2' } : null)}
                  className={`p-2 text-xs font-bold rounded-lg border transition-all ${bulkServerModal.modo === 'periodo_2' ? 'bg-blue-600 text-white border-blue-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                >
                  🌇 2º Período
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                Justificativa Obrigatória <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={2}
                value={bulkServerModal.justificativa || ''}
                onChange={(e) => setBulkServerModal(prev => prev ? { ...prev, justificativa: e.target.value } : null)}
                placeholder="Informe o motivo desta validação por período..."
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
              />
            </div>
          </div>
        </Modal>
      )}

      {bulkGlobalModal && (
        <Modal
          isOpen={bulkGlobalModal.isOpen}
          onClose={() => setBulkGlobalModal(null)}
          title="⚡ Validação de Presença em Massa na Unidade"
          type="warning"
          footer={
            <>
              <button
                onClick={() => setBulkGlobalModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkGlobalValidation}
                disabled={loading || bulkGlobalModal.selectedServidorIds.length === 0 || !bulkGlobalModal.justificativa?.trim()}
                className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Executar Validação em Massa'}
              </button>
            </>
          }
        >
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Valida automaticamente as presenças pendentes para múltiplos servidores e dias. Batidas presenciais registradas em terminal <strong>não serão sobrescritas</strong>.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  Servidores Incluídos ({bulkGlobalModal.selectedServidorIds.length}/{escalaMensal.length})
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const allIds = escalaMensal.map(em => em.servidor_id)
                    setBulkGlobalModal(prev => prev ? {
                      ...prev,
                      selectedServidorIds: prev.selectedServidorIds.length === allIds.length ? [] : allIds
                    } : null)
                  }}
                  className="text-[11px] font-bold text-emerald-600 hover:underline"
                >
                  {bulkGlobalModal.selectedServidorIds.length === escalaMensal.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 space-y-1">
                {escalaMensal.map(em => (
                  <label key={em.servidor_id} className="flex items-center gap-2 text-xs text-zinc-800 dark:text-zinc-200 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700/50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={bulkGlobalModal.selectedServidorIds.includes(em.servidor_id)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setBulkGlobalModal(prev => {
                          if (!prev) return null
                          const ids = checked 
                            ? [...prev.selectedServidorIds, em.servidor_id]
                            : prev.selectedServidorIds.filter(id => id !== em.servidor_id)
                          return { ...prev, selectedServidorIds: ids }
                        })
                      }}
                      className="h-3.5 w-3.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-semibold">{em.servidores?.nome}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Dia Inicial</label>
                <input
                  type="number"
                  min={1}
                  max={maxValidDay || daysInMonth}
                  value={bulkGlobalModal.startDay}
                  onChange={(e) => setBulkGlobalModal(prev => prev ? { ...prev, startDay: Math.max(1, Math.min(maxValidDay || daysInMonth, parseInt(e.target.value) || 1)) } : null)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white font-bold text-center"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Dia Final</label>
                <input
                  type="number"
                  min={1}
                  max={maxValidDay || daysInMonth}
                  value={bulkGlobalModal.endDay}
                  onChange={(e) => setBulkGlobalModal(prev => prev ? { ...prev, endDay: Math.max(1, Math.min(maxValidDay || daysInMonth, parseInt(e.target.value) || (maxValidDay || daysInMonth))) } : null)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white font-bold text-center"
                />
              </div>
            </div>

            {maxValidDay > 0 && maxValidDay < daysInMonth && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                ⚠️ Apenas presenças até hoje (dia {maxValidDay}) podem ser validadas. Datas futuras estão bloqueadas.
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                Modo de Aplicação:
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setBulkGlobalModal(prev => prev ? { ...prev, modo: 'completo' } : null)}
                  className={`p-2 text-xs font-bold rounded-lg border transition-all ${bulkGlobalModal.modo === 'completo' ? 'bg-emerald-600 text-white border-emerald-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                >
                  🟢 Dia Completo
                </button>
                <button
                  type="button"
                  onClick={() => setBulkGlobalModal(prev => prev ? { ...prev, modo: 'periodo_1' } : null)}
                  className={`p-2 text-xs font-bold rounded-lg border transition-all ${bulkGlobalModal.modo === 'periodo_1' ? 'bg-amber-600 text-white border-amber-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                >
                  ⛅ 1º Período
                </button>
                <button
                  type="button"
                  onClick={() => setBulkGlobalModal(prev => prev ? { ...prev, modo: 'periodo_2' } : null)}
                  className={`p-2 text-xs font-bold rounded-lg border transition-all ${bulkGlobalModal.modo === 'periodo_2' ? 'bg-blue-600 text-white border-blue-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                >
                  🌇 2º Período
                </button>
              </div>

              {/* Modo autorizado pelo RH (27/08/2026). Só aparece quando algum dos servidores
                  selecionados tem autorização vigente neste mês — oferecer sempre daria a
                  entender que o coordenador decide isso sozinho, e não decide. */}
              {(() => {
                const comAutorizacao = bulkGlobalModal.selectedServidorIds
                  .map(id => autorizacoesPonto[id])
                  .filter(Boolean)
                if (comAutorizacao.length === 0) return null

                const documentos = [...new Set(comAutorizacao.map((a: any) => a.documento))]
                const passos = [...new Set(comAutorizacao.flatMap((a: any) => a.passos))] as string[]
                const rotulos: Record<string, string> = {
                  entrada: 'entrada',
                  intervalo_saida: 'saída p/ intervalo',
                  intervalo_retorno: 'retorno do intervalo',
                }

                return (
                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      onClick={() => setBulkGlobalModal(prev => prev ? {
                        ...prev,
                        modo: 'autorizado',
                        // A justificativa oficial vem do ato do RH — é ela que sai na folha.
                        justificativa: prev.justificativa?.trim()
                          ? prev.justificativa
                          : (comAutorizacao[0] as any).motivo,
                      } : null)}
                      className={`w-full p-2 text-xs font-bold rounded-lg border transition-all ${bulkGlobalModal.modo === 'autorizado' ? 'bg-indigo-600 text-white border-indigo-600 shadow' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100'}`}
                    >
                      🔒 Autorizado pelo RH — somente {passos.map(x => rotulos[x] || x).join(', ')}
                    </button>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                      {comAutorizacao.length} de {bulkGlobalModal.selectedServidorIds.length} servidor(es)
                      selecionado(s) com autorização vigente ({documentos.join(', ')}).
                      <strong> A saída não é preenchida</strong> — continua vindo do relógio. Quem não
                      tem autorização é ignorado neste modo.
                    </p>
                  </div>
                )
              })()}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                Justificativa Obrigatória da Validação <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={2}
                value={bulkGlobalModal.justificativa || ''}
                onChange={(e) => setBulkGlobalModal(prev => prev ? { ...prev, justificativa: e.target.value } : null)}
                placeholder="Informe a justificativa/motivo para este procedimento em massa..."
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-900 dark:text-white"
              />
            </div>
          </div>
        </Modal>
      )}

      {sobreavisoManualModal && (
        <Modal
          isOpen={sobreavisoManualModal.isOpen}
          onClose={() => setSobreavisoManualModal(null)}
          title={`Validar Sobreaviso Manualmente — ${sobreavisoManualModal.servidorNome}`}
          type="warning"
          footer={
            <>
              <button
                onClick={() => setSobreavisoManualModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!sobreavisoManualModal.justificativa?.trim()) return
                  await handleManualSobreavisoOverride(sobreavisoManualModal.logId, sobreavisoManualModal.justificativa)
                  setSobreavisoManualModal(null)
                  setSobreavisoHistoryModal(null)
                }}
                disabled={loading || !sobreavisoManualModal.justificativa?.trim()}
                className="flex-1 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar Validação'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Você está validando manualmente o chamado de sobreaviso do servidor <strong>{sobreavisoManualModal.servidorNome}</strong> no dia <strong>{sobreavisoManualModal.dia}</strong>.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block">
                Justificativa da Validação <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={2}
                value={sobreavisoManualModal.justificativa || ''}
                onChange={(e) => setSobreavisoManualModal(prev => prev ? { ...prev, justificativa: e.target.value } : null)}
                placeholder="Ex: Servidor atendeu o chamado e compareceu, mas estava sem sinal no celular..."
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 text-xs outline-none focus:ring-2 focus:ring-amber-500 text-zinc-900 dark:text-white"
              />
            </div>
          </div>
        </Modal>
      )}
      {solicitacaoModalState?.isOpen && (
        <SolicitarExcecaoModal
          isOpen={solicitacaoModalState.isOpen}
          onClose={() => setSolicitacaoModalState(null)}
          onEnviado={(mensagem) => {
            fetchPedidosPendentes()
            setAlertModal({ isOpen: true, title: 'Pedido enviado', message: mensagem, type: 'success' })
          }}
          servidorId={solicitacaoModalState.servidorId}
          servidorNome={solicitacaoModalState.servidorNome}
          unidadeId={unidadeId}
          setorId={setorId}
          mes={mes}
          ano={ano}
          horasAtuais={solicitacaoModalState.horasAtuais}
          sobreavisosAtuais={solicitacaoModalState.sobreavisosAtuais}
          cargasOutras={(cargaMensal[solicitacaoModalState.servidorId] || []).filter(
            c => c.escala_mensal_id !== escalaMensal.find(em => em.servidor_id === solicitacaoModalState.servidorId)?.id
          )}
          tetoHoras={Number(tetoCarga[solicitacaoModalState.servidorId]?.teto_horas ?? configs['max_horas_escala_servidor']) || 300}
          tetoSobreavisos={Number(tetoCarga[solicitacaoModalState.servidorId]?.teto_sobreavisos ?? configs['max_sobreavisos_escala_servidor']) || 10}
        />
      )}

      {autorizacaoModalState?.isOpen && (
        <AutorizacaoExcecaoModal
          isOpen={autorizacaoModalState.isOpen}
          onClose={() => setAutorizacaoModalState(null)}
          onSaved={() => {
            fetchExcecoesEscala()
            // O teto vem de fn_teto_carga_servidor, que soma a autorização: sem recarregar, o
            // escudo vermelho continuaria na linha e o lançamento seguiria recusado.
            fetchCargaMensal(escalaMensal.map(em => em.servidor_id))
          }}
          servidorId={autorizacaoModalState.servidorId}
          servidorNome={autorizacaoModalState.servidorNome}
          unidadeId={unidadeId}
          unidadeNome={allUnidades.find(u => u.id === unidadeId)?.nome}
          mes={mes}
          ano={ano}
          limiteGlobalHoras={Number(tetoCarga[autorizacaoModalState.servidorId]?.limite_global_horas ?? configs['max_horas_escala_servidor']) || 300}
          limiteGlobalSobreavisos={Number(tetoCarga[autorizacaoModalState.servidorId]?.limite_global_sobreavisos ?? configs['max_sobreavisos_escala_servidor']) || 10}
          horasAtuais={autorizacaoModalState.horasAtuais}
          sobreavisosAtuais={autorizacaoModalState.sobreavisosAtuais}
          cargasOutras={(cargaMensal[autorizacaoModalState.servidorId] || []).filter(
            c => c.escala_mensal_id !== escalaMensal.find(em => em.servidor_id === autorizacaoModalState.servidorId)?.id
          )}
          excecaoExistente={excecoesEscala.find(e => e.servidor_id === autorizacaoModalState.servidorId)}
        />
      )}
      <AlterarJornadaModal
        isOpen={!!jornadaModalAlvo}
        onClose={() => setJornadaModalAlvo(null)}
        alvo={jornadaModalAlvo}
        mes={mes}
        ano={ano}
        unidadeId={unidadeId}
        onCorrigido={(escalaMensalId, jornadaId) => {
          // A RPC ja gravou no banco. O estado local so acompanha, para o select nao voltar
          // a mostrar a jornada antiga ate o proximo carregamento.
          setEscalaMensal(prev => prev.map(item =>
            item.id === escalaMensalId ? { ...item, jornada_id: jornadaId } : item
          ))
        }}
        onVigenciaCriada={() => {
          // A jornada do MES nao mudou de proposito: quem passa a valer a partir da data e a
          // vigencia, resolvida por obter_jornada_servidor_data. Refaz o fetch da grade (e nao
          // router.refresh()) porque jornadasTemporarias e estado deste client component: o
          // refresh recarregaria os Server Components sem repopular esta lista.
          fetchJornadasTemporarias()
        }}
      />
    </>
  )
}
