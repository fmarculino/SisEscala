import { createClient } from '@/utils/supabase/server'
import { ServidorDetalhesClient } from './ServidorDetalhesClient'
import { formatSectorsHierarchy } from '@/utils/sectors'

export default async function EditServidorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Só o papel importa aqui agora — unidades/setores deixaram de ser filtrados por escopo
  // (ver comentário abaixo), então o resto do perfil (profile_unidades/profile_setores) não tem
  // mais uso nesta página.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id)
    .single()

  const { data: servidor } = await supabase
    .from('servidores')
    .select('*')
    .eq('id', id)
    .single()

  // Unidades/setores SEM filtro de escopo (v1.43.0) — de propósito. Estas duas listas alimentam
  // o seletor de lotação, que agora é também o formulário de SOLICITAR transferência
  // (updateServidor, `transferenciaPendente`): um coordenador precisa conseguir PROPOR um destino
  // fora do que ele administra — é o próprio ponto de existir a aprovação do super_admin depois.
  // Restringir aqui pelo escopo de quem edita tornaria essas transferências inatingíveis, porque
  // a opção nem apareceria no <select>. A escrita continua protegida: RLS de `servidores` recusa
  // o UPDATE direto fora do escopo, e `updateServidor` só efetiva na hora se for super_admin.
  //
  // permite_marca_intervalo/tipo_intervalo definem se os campos de intervalo do servidor
  // têm efeito — ver IntervaloPersonalizadoFields.
  const { data: unidades } = await supabase
    .from('unidades')
    .select('id, nome, permite_marca_intervalo, tipo_intervalo')
    .eq('ativo', true)
    .order('nome')

  const { data: sectorsRaw } = await supabase
    .from('setores')
    .select('id, unidade_id, parent_id, dicionario_setores(nome)')
    .eq('ativo', true)
  const sectorsMapped = (sectorsRaw as any[])?.map(s => {
    const dictData = Array.isArray(s.dicionario_setores) 
      ? s.dicionario_setores[0] 
      : s.dicionario_setores
      
    return {
      ...s,
      nome: dictData?.nome || 'SETOR SEM NOME'
    }
  }) || []
  const setores = formatSectorsHierarchy(sectorsMapped)

  const { data: cargos } = await supabase
    .from('cargos')
    .select('*')
    .order('nome')

  // Fetch all active journeys
  const { data: jornadas } = await supabase
    .from('jornadas')
    .select('id, nome, horas_totais, intervalo_minutos')
    .eq('ativo', true)
    .order('nome')

  // Fetch temporary journeys for this server
  const { data: jornadasTemporarias } = await supabase
    .from('servidores_jornadas_temporarias')
    .select('*, jornadas(nome)')
    .eq('servidor_id', id)
    .order('data_inicio', { ascending: false })

  // Quem pode gravar vigência de jornada vem da MESMA função que as policies de escrita usam
  // (fn_pode_gerir_vigencia_jornada, 20260828140000) — não de uma lista de papéis repetida aqui.
  // Até 28/08/2026 a tela oferecia o formulário a todo mundo e o RH da Unidade só descobria que
  // não podia quando a RLS recusava, com a mensagem crua do Postgres na cara dele.
  const { data: podeGerirRpc, error: erroPodeGerir } = await supabase
    .rpc('fn_pode_gerir_vigencia_jornada', { p_servidor_id: id })

  // Fallback para a janela entre o deploy do código e a aplicação da migration: sem a função no
  // banco, a RPC falha e todo mundo perderia o formulário — inclusive quem a policy ANTIGA já
  // aceitava. Nesse caso vale exatamente a lista antiga, nunca mais que ela: o banco continua
  // sendo quem decide, e prometer na tela o que ele ainda recusa é o defeito que se está
  // corrigindo. Pode sair depois que 20260828140000 estiver nos dois ambientes.
  const podeGerirVigencia = erroPodeGerir
    ? ['super_admin', 'admin', 'coordenador'].includes(profile?.role || '')
    : podeGerirRpc === true

  if (!servidor) {
    return <div className="p-8 text-center text-red-600 font-bold">Servidor não encontrado</div>
  }

  // Fetch transfer history
  const { data: historicoRaw } = await supabase
    .from('historico_transferencias')
    .select('*, unidade_origem:unidades!unidade_origem_id(nome), setor_origem:setores!setor_origem_id(dicionario_setores(nome)), unidade_destino:unidades!unidade_destino_id(nome), setor_destino:setores!setor_destino_id(dicionario_setores(nome))')
    .eq('servidor_id', id)
    .order('data_transferencia', { ascending: true })

  const historico = historicoRaw?.map(h => {
    const origSetData = Array.isArray(h.setor_origem) ? h.setor_origem[0] : h.setor_origem
    const destSetData = Array.isArray(h.setor_destino) ? h.setor_destino[0] : h.setor_destino
    
    const origDict = origSetData ? (Array.isArray(origSetData.dicionario_setores) ? origSetData.dicionario_setores[0] : origSetData.dicionario_setores) : null
    const destDict = destSetData ? (Array.isArray(destSetData.dicionario_setores) ? destSetData.dicionario_setores[0] : destSetData.dicionario_setores) : null

    return {
      ...h,
      unidade_origem_nome: h.unidade_origem?.nome || 'Sem Unidade',
      setor_origem_nome: origDict?.nome || 'Sem Setor',
      unidade_destino_nome: h.unidade_destino?.nome || 'Sem Unidade',
      setor_destino_nome: destDict?.nome || 'Sem Setor'
    }
  }) || []

  // Fetch scales history
  const { data: escalasRaw } = await supabase
    .from('escala_mensal')
    .select('*, unidades(nome), setores(dicionario_setores(nome))')
    .eq('servidor_id', id)
    .order('ano', { ascending: false })
    .order('mes', { ascending: false })

  const escalas = escalasRaw?.map(e => {
    const sectorData = Array.isArray(e.setores) ? e.setores[0] : e.setores
    const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) ? sectorData.dicionario_setores[0] : sectorData.dicionario_setores) : null
    return {
      ...e,
      unidade_nome: e.unidades?.nome || 'Sem Unidade',
      setor_nome: dictData?.nome || 'Sem Setor'
    }
  }) || []

  // Fetch timesheets
  const { data: folhas } = await supabase
    .from('folha_ponto')
    .select('id, escala_mensal_id, status')
    .eq('servidor_id', id)

  // ── Regime de apuração da folha (20260916110000) ──────────────────────────────────────────
  // ⚠️ TOLERA A AUSÊNCIA DAS TABELAS, e isso é obrigatório: o deploy é automático a cada push e
  // a migration é aplicada à mão. Sem o guard, a ficha de TODO servidor quebraria na janela
  // entre os dois — e a ficha é uma das telas mais usadas. Quando 20260916110000 estiver nos
  // dois ambientes, o `regimeDisponivel` pode sair.
  const { data: regimesRaw, error: erroRegimes } = await supabase
    .from('folha_regimes')
    .select('id, nome, dia_corte, padrao, ativo')
    .order('padrao', { ascending: false })
    .order('nome')

  const regimeDisponivel = !erroRegimes && Array.isArray(regimesRaw)

  // As vigências do servidor E as globais (servidor_id null): é a global que faz o corte valer
  // para a rede inteira sem uma linha por servidor, então ela precisa vir para a tela poder
  // dizer que o regime é "herdado da rede" em vez de inventar que é padrão do sistema.
  const { data: vigenciasRaw } = regimeDisponivel
    ? await supabase
        .from('folha_regime_vigencias')
        .select('id, servidor_id, regime_id, vigencia_inicio, vigencia_fim')
        .or(`servidor_id.eq.${id},servidor_id.is.null`)
        .order('vigencia_inicio', { ascending: false })
    : { data: [] as any[] }

  // Quem resolve o regime é o BANCO, nunca a tela: `fn_periodo_apuracao_servidor` é a mesma
  // função que a apuração vai usar. A tela só precisa saber de ONDE ele veio, para escrever isso.
  const hojeCompetencia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const competenciaApuracao = {
    mes: hojeCompetencia.getMonth() + 1,
    ano: hojeCompetencia.getFullYear(),
  }

  const { data: periodoRaw } = regimeDisponivel
    ? await supabase.rpc('fn_periodo_apuracao_servidor', {
        p_servidor_id: id,
        p_mes: competenciaApuracao.mes,
        p_ano: competenciaApuracao.ano,
      })
    : { data: null }

  const periodo = Array.isArray(periodoRaw) ? periodoRaw[0] : periodoRaw
  const regimes = regimeDisponivel ? (regimesRaw as any[]) : []
  const vigencias = (vigenciasRaw as any[]) || []
  const regimeVigente = periodo
    ? regimes.find(r => r.id === periodo.regime_id) || null
    : null

  const origemRegime: 'servidor' | 'rede' | 'padrao' =
    vigencias.some(v => v.servidor_id === id && v.vigencia_fim === null) ? 'servidor'
    : vigencias.some(v => v.servidor_id === null && v.vigencia_fim === null) ? 'rede'
    : 'padrao'

  // Mesmo público que gere marcações e o diagnóstico de cadastro (armadilha 62): o predicado do
  // banco é `fn_escopo_gestao_alcanca`, e as RPCs recusam sozinhas. Aqui é só a oferta na tela.
  const { data: alcancaGestao } = regimeDisponivel && servidor?.unidade_id
    ? await supabase.rpc('fn_escopo_gestao_alcanca', { p_unidade_id: servidor.unidade_id })
    : { data: false }

  return (
    <ServidorDetalhesClient
      id={id}
      servidor={servidor}
      unidades={unidades || []}
      setores={setores || []}
      cargos={cargos || []}
      isSuperAdmin={profile?.role === 'super_admin'}
      historico={historico}
      escalas={escalas}
      folhas={folhas || []}
      jornadas={jornadas || []}
      jornadasTemporarias={jornadasTemporarias || []}
      podeGerirVigencia={podeGerirVigencia}
      regimeDisponivel={regimeDisponivel}
      regimesApuracao={regimes}
      vigenciasApuracao={vigencias}
      regimeApuracaoVigente={regimeVigente}
      origemRegimeApuracao={origemRegime}
      competenciaApuracao={competenciaApuracao}
      podeDefinirRegimeApuracao={alcancaGestao === true}
    />
  )
}
