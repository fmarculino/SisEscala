import { createClient } from '@/utils/supabase/server'
import { formatarDataCurta, obterTimezone } from '@/utils/horario'
import {
  Users, Building2, Calendar, ArrowRight, Clock, Phone,
  CheckCircle2, CalendarDays, BarChart3,
  ShieldCheck, FileText
} from 'lucide-react'
import Link from 'next/link'
import { applyAccessFilters } from '@/utils/permissions'
import { HistoricoChart } from './_components/HistoricoChart'
import { horasDaLinhaEscala, horasProntidaoSobreaviso } from '@/utils/escala/horasLinha'
import { SobreavisoPanel } from './_components/SobreavisoPanel'
import {
  getPainelSobreaviso,
  getDestinosSobreaviso,
  getLotacaoDoAcionador
} from '@/app/actions/sobreaviso'

export default async function DashboardHome() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), setores_no_escopo')
    .eq('id', user?.id)
    .single()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.setores_no_escopo || []
  } : null

  const userRole = profile?.role || ''
  const isCoord = userRole === 'coordenador' || userRole === 'ass_adm'

  // Data/hora atual no fuso CONFIGURADO (configuracoes_globais.timezone), não no do processo:
  // a VPS roda em UTC e as últimas 3 horas de todo dia já seriam "amanhã". Ver src/utils/horario.ts.
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: obterTimezone() }))
  const todayDay = today.getDate()
  const currentMonth = today.getMonth() + 1
  const currentYear = today.getFullYear()

  // ======================================================================
  // PARALLEL DATA FETCHING
  // ======================================================================

  // O PostgREST corta em 1000 linhas por padrão, em silêncio (CLAUDE.md, armadilha 8) — não é
  // erro, é a página seguinte que nunca é buscada. Toda consulta abaixo que devolve LINHAS (não
  // só contagem) pagina explicitamente por isso; já causou undercount real no card "Servidores"
  // (996 exibido contra bem mais de 1000 no cadastro).
  async function buscarTodasPaginas<T>(montarQuery: (from: number, to: number) => any): Promise<T[]> {
    const linhas: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await montarQuery(from, from + 999)
      if (error) {
        console.error('Erro ao paginar consulta do painel:', error)
        break
      }
      linhas.push(...((data || []) as T[]))
      if (!data || data.length < 1000) break
    }
    return linhas
  }

  // 1. Servidores por status — contagem exata via head:true. Diferente de buscar as linhas, o
  // header Content-Range da contagem não é afetado pelo corte de 1000, então isso é imune à
  // armadilha 8 por construção (e mais barato que buscar e paginar 'status' de cada linha).
  let servidoresAtivosQuery = supabase.from('servidores').select('id', { count: 'exact', head: true }).eq('status', 'Ativo')
  servidoresAtivosQuery = applyAccessFilters(servidoresAtivosQuery, userProfile)
  let servidoresInativosQuery = supabase.from('servidores').select('id', { count: 'exact', head: true }).eq('status', 'Inativo')
  servidoresInativosQuery = applyAccessFilters(servidoresInativosQuery, userProfile)
  // ⚠️ O CADASTRO TEM MAIS DE DOIS STATUS. Medido em 05/09/2026: 2.065 Ativo, 5 Inativo e 10
  // "Afastado" — e esses 10 não apareciam em NENHUM dos dois números do card, some de um lado
  // sem entrar no outro. O total serve para derivar o resto sem precisar enumerar os status
  // (um status novo no cadastro passaria a ser somado sozinho, em vez de sumir em silêncio).
  let servidoresTotalQuery = supabase.from('servidores').select('id', { count: 'exact', head: true })
  servidoresTotalQuery = applyAccessFilters(servidoresTotalQuery, userProfile)

  // 2. Setores count (total possible scales)
  let sectorsQuery = supabase.from('setores').select('id', { count: 'exact', head: true }).eq('ativo', true)
  sectorsQuery = applyAccessFilters(sectorsQuery, userProfile)

  // 2b. Unidades count
  let unitsQuery = supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('ativo', true)
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })

  // 3. Escalas do mês corrente — o painel "Escalas de <mês>" precisa do nome de unidade/setor
  // de cada linha, então pagina de verdade (não dá para virar head:true como os servidores).
  const escalasPromise = buscarTodasPaginas<any>((from, to) => {
    const q = supabase.from('escala_mensal').select(`
      id, servidor_id, unidade_id, setor_id, mes, ano, status,
      servidores(nome),
      unidades(nome),
      setores(dicionario_setores(nome))
    `).eq('mes', currentMonth).eq('ano', currentYear).order('id').range(from, to)
    return applyAccessFilters(q, userProfile)
  })

  // 3b. Em serviço hoje. "Ontem" saiu daqui junto com o painel de sobreaviso: quem cobre
  // o turno noturno que atravessa a meia-noite agora é fn_painel_sobreaviso_dia.
  //
  // ⚠️ ISTO CONTA PESSOAS, NÃO LINHAS DE ESCALA. Era uma contagem exata sobre escala_diaria,
  // e quem tem Regular + Plantão no mesmo dia contava DUAS vezes: medido em produção em
  // 05/09/2026, o card exibia 207 onde havia 188 servidores (+10%). O rótulo diz "em serviço",
  // e isso é gente. Por isso deixou de ser head:true e passou a buscar servidor_id — paginado,
  // porque agora traz LINHAS e o PostgREST corta em 1000 em silêncio (armadilha 8).
  const emServicoPromise = buscarTodasPaginas<any>((from, to) => {
    const q = supabase.from('escala_diaria')
      .select('id, escala_mensal!inner(servidor_id, unidade_id, setor_id, mes, ano)')
      .eq('dia', todayDay)
      .eq('escala_mensal.mes', currentMonth)
      .eq('escala_mensal.ano', currentYear)
      .neq('categoria', 'Sobreaviso')
      .order('id')
      .range(from, to)
    return applyAccessFilters(q, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })
  })

  // NOTA (08/08/2026): as consultas de sobreaviso saíram daqui.
  // O painel passou a ser global — todo coordenador/admin vê o sobreaviso de toda a secretaria,
  // porque quem está de sobreaviso atende várias unidades. Com applyAccessFilters, cada um via
  // só o próprio setor. A leitura agora é fn_painel_sobreaviso_dia (SECURITY DEFINER, com guard
  // de papel), que também devolve a janela do plantão e quem pode acionar cada um — as mesmas
  // funções que fn_acionar_sobreaviso aplica ao gravar.
  // Ver docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md

  // 4. Afastamentos ativos hoje — precisa das linhas para a lista abaixo, então pagina.
  // applyAccessFilters estava ausente aqui (única consulta do arquivo sem escopo): um RH da
  // Unidade via afastamento de toda a Secretaria nesta seção, mesmo com as outras já escopadas.
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const todayStr = `${yyyy}-${mm}-${dd}`
  const afastamentosPromise = buscarTodasPaginas<any>((from, to) => {
    const q = supabase.from('servidores_eventos').select(`
      id, data_inicio, data_fim, observacao,
      servidores!inner(id, nome, unidade_id),
      tipos_eventos(nome, cor)
    `).lte('data_inicio', todayStr).gte('data_fim', todayStr).order('id').range(from, to)
    return applyAccessFilters(q, userProfile, { unidadeField: 'servidores.unidade_id', setorField: null })
  })

  // 6. Historical data: last 3 months of escala_diaria for chart
  const months: { mes: number; ano: number; label: string }[] = []
  for (let i = 2; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1)
    months.push({
      mes: d.getMonth() + 1,
      ano: d.getFullYear(),
      label: d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')
    })
  }

  // For the chart, fetch escala_diaria for past 3 months — cada mês fechado facilmente passa de
  // 1000 linhas (armadilha 23: ~4.200/mês em produção), então pagina também.
  //
  // ⚠️ NÃO filtra por escala_mensal.status = 'Fechada' — filtrava até 01/09/2026, "só para
  // meses passados", e isso subcontava em silêncio: cada (servidor, unidade, setor) tem o
  // PRÓPRIO escala_mensal, fechado no seu próprio ritmo (fn_desfecho_eventos_escalas, cron de
  // auto-fechamento com `dias_inativacao_automatica`, default 5 dias após o fim do mês). Um
  // servidor com o Regular já fechado e o Sobreaviso (setor "geral", frequentemente uma
  // coordenação à parte) ainda em Rascunho aparecia com horas de Regular e ZERO de Sobreaviso no
  // mesmo mês — não porque não tivesse sobreaviso nenhum, mas porque aquela escala específica
  // não tinha virado Fechada ainda. Confirmado em homologação: `Sobreaviso` tinha linhas tanto em
  // `Fechada` quanto em `Rascunho`, prova de que a categoria convive nos dois estados. Igualando
  // ao tratamento que o mês corrente já tinha ("include real-time ongoing scales"), o
  // comparativo deixa de esconder trabalho real só porque uma escala específica ainda não foi
  // encerrada formalmente — este painel é informativo, não o documento legal (esse é a folha
  // fechada em si, com seu próprio ciclo de revisão).
  const historicalPromises = months.map(async (m) => {
    const data = await buscarTodasPaginas<any>((from, to) => {
      const q = supabase.from('escala_diaria').select(`
        id, categoria,
        dicionario_turnos(codigo, horas_computadas),
        escala_mensal!inner(mes, ano, status, unidade_id, setor_id, jornadas(horas_totais, intervalo_minutos))
      `)
        .eq('escala_mensal.mes', m.mes)
        .eq('escala_mensal.ano', m.ano)
        .order('id')
        .range(from, to)

      return applyAccessFilters(q, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })
    })
    return { ...m, data }
  })

  // Execute all queries in parallel
  const [
    { count: servidoresAtivosCount },
    { count: servidoresInativosCount },
    { count: servidoresTotalCount },
    { count: setoresCount },
    { count: unidadesCount },
    escalasData,
    emServicoData,
    afastamentosData,
    ...historicalResults
  ] = await Promise.all([
    servidoresAtivosQuery,
    servidoresInativosQuery,
    servidoresTotalQuery,
    sectorsQuery,
    unitsQuery,
    escalasPromise,
    emServicoPromise,
    afastamentosPromise,
    ...historicalPromises
  ])

  // Sobreaviso em bloco separado: estas três devolvem arrays/objetos, não o { data } do
  // PostgREST, e misturá-las no Promise.all acima quebraria a inferência do destructuring.
  const [sobreavisoItens, sobreavisoDestinos, sobreavisoLotacao] = await Promise.all([
    getPainelSobreaviso(),
    getDestinosSobreaviso(),
    getLotacaoDoAcionador()
  ])

  // ======================================================================
  // DATA PROCESSING
  // ======================================================================

  const escalas = (escalasData || []) as any[]
  const afastamentos = (afastamentosData || []) as any[]

  // --- KPIs ---
  const servidoresAtivos = servidoresAtivosCount || 0
  const servidoresInativos = servidoresInativosCount || 0
  const servidoresOutrosStatus = Math.max(0, (servidoresTotalCount || 0) - servidoresAtivos - servidoresInativos)

  // ⚠️ O CARD MISTURAVA DUAS GRANDEZAS NA MESMA FRASE. O número grande conta GRADES (pares
  // unidade|setor); o subtítulo contava LINHAS de escala_mensal, que é uma por SERVIDOR. Medido
  // em produção em 05/09/2026, competência 08/2026: o card dizia "113 Escalas Ativas" e, logo
  // abaixo, "694 fechadas" — 694 de 113. As duas contagens estavam certas e respondiam
  // perguntas diferentes. Agora as duas são de grades, e uma grade só conta como fechada quando
  // TODAS as escalas dela estão Fechadas: fechar 3 servidores de 40 não fecha o setor.
  const gradesPorSetor = new Map<string, { total: number; fechadas: number }>()
  escalas.forEach((e: any) => {
    const k = `${e.unidade_id}|${e.setor_id}`
    const a = gradesPorSetor.get(k) || { total: 0, fechadas: 0 }
    a.total++
    if (e.status === 'Fechada') a.fechadas++
    gradesPorSetor.set(k, a)
  })
  const totalEscalasCriadas = gradesPorSetor.size
  const escalasFechadas = Array.from(gradesPorSetor.values()).filter(a => a.total === a.fechadas).length
  const servidoresEscalados = new Set(escalas.map((e: any) => e.servidor_id)).size

  // Em serviço hoje: SERVIDORES distintos, nunca linhas de escala (ver a consulta acima).
  const emServicoHoje = new Set(
    ((emServicoData || []) as any[]).map((l: any) => l.escala_mensal?.servidor_id).filter(Boolean)
  ).size

  // Afastamentos ativos count
  const afastamentosAtivos = afastamentos.length

  // O painel de sobreaviso nao e mais montado aqui. A janela do plantao vinha de uma tabela
  // fixa de codigos neste arquivo (getShiftWindow) e de OUTRA heuristica, por prefixo, no
  // ScaleGrid. Com o botao Acionar passando a depender da janela, duas heuristicas viraram
  // risco: habilitar por uma regra e gravar por outra. A fonte unica agora e
  // fn_janela_sobreaviso_dia, consumida por fn_painel_sobreaviso_dia.
  const sobreavisoAtivosCount = sobreavisoItens.filter(i => i.ativo_agora).length

  // --- ESCALAS STATUS GRID ---
  type EscalaStatusItem = { unidadeNome: string; setorNome: string; status: string; unidadeId: string; setorId: string }
  const escalasStatusMap = new Map<string, EscalaStatusItem[]>()
  escalas.forEach((e: any) => {
    const unidadeNome = e.unidades?.nome || 'Sem unidade'
    const setorDict = e.setores?.dicionario_setores
    const setorNome = Array.isArray(setorDict) ? setorDict[0]?.nome : setorDict?.nome || 'Sem setor'
    const key = e.unidade_id
    if (!escalasStatusMap.has(key)) {
      escalasStatusMap.set(key, [])
    }
    // Avoid duplicates (same setor)
    const existing = escalasStatusMap.get(key)!
    if (!existing.find(x => x.setorId === e.setor_id)) {
      existing.push({
        unidadeNome,
        setorNome,
        status: e.status || 'Rascunho',
        unidadeId: e.unidade_id,
        setorId: e.setor_id,
      })
    }
  })
  const escalasStatus = Array.from(escalasStatusMap.entries()).map(([unidadeId, setores]) => ({
    unidadeId,
    unidadeNome: setores[0]?.unidadeNome || 'Sem unidade',
    setores: setores.sort((a, b) => a.setorNome.localeCompare(b.setorNome))
  })).sort((a, b) => a.unidadeNome.localeCompare(b.unidadeNome))

  // --- AFASTAMENTOS ATIVOS LIST ---
  const afastamentosList = afastamentos.map((a: any) => {
    const diasRestantes = Math.ceil((new Date(a.data_fim).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return {
      servidorNome: a.servidores?.nome || 'Desconhecido',
      tipo: a.tipos_eventos?.nome || 'Outro',
      cor: a.tipos_eventos?.cor || '#71717A',
      inicio: a.data_inicio,
      fim: a.data_fim,
      diasRestantes: Math.max(diasRestantes, 0),
    }
  }).sort((a, b) => a.diasRestantes - b.diasRestantes)

  // --- HISTORICAL CHART DATA ---
  // 🚨 O REGULAR SOMAVA O VÃO DO RELÓGIO, CONTANDO O INTERVALO COMO JORNADA (armadilha 46).
  //   Este painel era o ÚLTIMO lugar do sistema a fazer isso: a grade (calculateTotals), o
  //   /relatorios/consolidado e a folha (desde 09/2026) já descontam. Medido em produção em
  //   05/09/2026, competência 09/2026: o painel exibia 163.392h de Regular contra 126.169h das
  //   outras três telas — 37.223h (22,8%) de diferença na mesma competência, com o número maior
  //   justamente na tela usada para decidir. A conta agora tem fonte única em
  //   src/utils/escala/horasLinha.ts, compartilhada com o consolidado.
  //
  // ⚠️ Sobreaviso é PRONTIDÃO, não trabalho: sai por horasProntidaoSobreaviso e é exibido com
  //   rótulo próprio. horasDaLinhaEscala devolve 0 para ele de propósito, para que ninguém o
  //   some ao lado das horas trabalhadas por descuido.
  const chartData = (historicalResults as any[]).map((result: any) => {
    let regular = 0, plantao = 0, sobreaviso = 0, extra = 0
    ;(result.data || []).forEach((d: any) => {
      const turno = d.dicionario_turnos
      const jornada = d.escala_mensal?.jornadas
      const cat = d.categoria
      if (cat === 'Sobreaviso') {
        sobreaviso += horasProntidaoSobreaviso(turno?.horas_computadas, turno?.codigo)
        return
      }
      const horas = horasDaLinhaEscala(cat, turno?.horas_computadas, jornada)
      if (cat === 'Regular') regular += horas
      else if (cat === 'Plantão') plantao += horas
      else if (cat === 'Extra') extra += horas
    })
    return { label: result.label, regular: Math.round(regular), plantao: Math.round(plantao), sobreaviso: Math.round(sobreaviso), extra: Math.round(extra) }
  })

  // --- QUICK ACTIONS ---
  const quickActions = [
    { name: 'Escalas', description: 'Gerencie escalas mensais', href: '/escalas', icon: Calendar, color: 'bg-green-500' },
    { name: 'Auditoria', description: 'Geolocalização e presença', href: '/auditoria', icon: ShieldCheck, color: 'bg-orange-500' },
    { name: 'Folha de Ponto', description: 'Espelho de frequência', href: '/folha-ponto', icon: FileText, color: 'bg-indigo-500' },
    { name: 'Relatórios', description: 'Análises e exportações', href: '/relatorios', icon: BarChart3, color: 'bg-cyan-500' },
    { name: 'Afastamentos', description: 'Férias e licenças', href: '/afastamentos', icon: CalendarDays, color: 'bg-rose-500', hidden: isCoord },
    { name: 'Servidores', description: 'Quadro de pessoal', href: '/servidores', icon: Users, color: 'bg-purple-500', hidden: isCoord },
  ].filter(a => !a.hidden)

  // ======================================================================
  // RENDER
  // ======================================================================

  const monthName = today.toLocaleString('pt-BR', { month: 'long' })
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white">
          Painel de Controle
        </h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400 text-sm">
          Visão operacional do SisEscala — {capitalizedMonth}/{currentYear}
        </p>
      </div>

      {/* ============================================================ */}
      {/* SECTION 6 — QUICK ACTIONS */}
      {/* ============================================================ */}
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-4 flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-blue-500" />
          Ações Rápidas
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.name}
              href={action.href}
              className="flex flex-col items-center p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-400/50 hover:shadow-md transition-all group text-center"
            >
              <div className={`h-10 w-10 rounded-lg ${action.color} flex items-center justify-center text-white mb-3 shadow-sm group-hover:scale-110 transition-transform`}>
                <action.icon className="h-5 w-5" />
              </div>
              <h3 className="text-xs font-bold text-zinc-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {action.name}
              </h3>
              <p className="text-[10px] text-zinc-400 mt-1 leading-tight">
                {action.description}
              </p>
            </Link>
          ))}
        </div>
      </div>


      {/* ============================================================ */}
      {/* SECTION 1 — KPI CARDS */}
      {/* ============================================================ */}
      {!isCoord && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Servidores', value: servidoresAtivos, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', sub: `Hoje: ${emServicoHoje} em serviço | Inativos: ${servidoresInativos}${servidoresOutrosStatus > 0 ? ` | Outros status: ${servidoresOutrosStatus}` : ''}` },
            { label: 'Escalas Ativas', value: totalEscalasCriadas, icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', sub: `${totalEscalasCriadas} de ${setoresCount} setores | ${escalasFechadas} com tudo fechado | ${servidoresEscalados} servidores escalados` },
            { label: 'Afastados Agora', value: afastamentosAtivos, icon: CalendarDays, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', sub: 'Ausências registradas' },
            { label: 'Sobreaviso Hoje', value: sobreavisoAtivosCount, icon: Phone, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', sub: `${sobreavisoAtivosCount} ativo(s) agora | ${sobreavisoItens.length} total` },
            { label: 'Unidades', value: unidadesCount || 0, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', sub: 'Unidades cadastradas' },
          ].map((kpi, i) => (
            <div
              key={i}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm hover:shadow-md transition-shadow"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className={`inline-flex p-2 rounded-lg ${kpi.bg} mb-3`}>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{kpi.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mt-1">
                {kpi.label}
              </p>
              {kpi.sub && (
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-tight">{kpi.sub}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ============================================================ */}
      {/* SECTION 2 — SOBREAVISO PANEL */}
      {/* ============================================================ */}
      {/* Painel global: todo coordenador/admin ve o sobreaviso de toda a secretaria.
          Quem pode acionar cada um vem de fn_painel_sobreaviso_dia, nao daqui. */}
      <SobreavisoPanel
        itens={sobreavisoItens}
        destinos={sobreavisoDestinos}
        lotacao={sobreavisoLotacao}
      />

      {/* ============================================================ */}
      {/* SECTION 3 & 4 — ESCALAS STATUS + AFASTAMENTOS (Side by Side) */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Escalas Status Grid */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg text-white">
                <Calendar className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Escalas de {capitalizedMonth}
              </h3>
            </div>
            <Link href="/escalas" className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 dark:text-blue-400 flex items-center gap-1">
              Ver todas <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {escalasStatus.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-10 w-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-3 opacity-50" />
              <p className="text-sm text-zinc-400">Nenhuma escala encontrada este mês.</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
              {escalasStatus.map((unidade) => (
                <div key={unidade.unidadeId}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-2">
                    {unidade.unidadeNome}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unidade.setores.map((setor) => (
                      <Link
                        key={setor.setorId}
                        href={`/escalas/unidade/${unidade.unidadeId}?setor=${setor.setorId}&mes=${currentMonth}&ano=${currentYear}`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all hover:shadow-sm ${
                          setor.status === 'Fechada'
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        {setor.status === 'Fechada' ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {setor.setorNome}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Afastamentos Ativos */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-500 rounded-lg text-white">
                <CalendarDays className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Afastamentos Ativos
              </h3>
            </div>
            <Link href="/afastamentos" className="text-[10px] font-bold uppercase tracking-widest text-rose-600 hover:text-rose-800 dark:text-rose-400 flex items-center gap-1">
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {afastamentosList.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-emerald-300 dark:text-emerald-700 mx-auto mb-3 opacity-50" />
              <p className="text-sm text-zinc-400">Nenhum servidor afastado no momento.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {afastamentosList.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-2 h-8 rounded-full flex-shrink-0"
                      style={{ backgroundColor: a.cor }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{a.servidorNome}</p>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {a.tipo} • {formatarDataCurta(a.inicio)} - {formatarDataCurta(a.fim)}
                      </p>
                    </div>
                  </div>
                  <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-md ${
                    a.diasRestantes <= 2
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    {a.diasRestantes === 0 ? 'Último dia' : `${a.diasRestantes}d restantes`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* SECTION 5 — HISTORICAL CHART */}
      {/* ============================================================ */}
      {chartData.length > 0 && (
        <HistoricoChart data={chartData} />
      )}

    </div>
  )
}
