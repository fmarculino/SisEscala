import { createClient } from '@/utils/supabase/server'
import { ScaleGrid } from './ScaleGrid'
import { hasUnitAccess, hasSectorAccess } from '@/utils/permissions'

export default async function UnidadeEscalaPage({
  params,
  searchParams,
}: {
  params: Promise<{ unidadeId: string }>
  searchParams: Promise<{ mes: string; ano: string; setor: string }>
}) {
  const { unidadeId } = await params
  const { mes, ano, setor } = await searchParams
  
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return <div>Não autenticado</div>
  }

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user.id)
    .single()

  const profile = profileRaw ? {
    ...profileRaw,
    permitted_unidades: profileRaw.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profileRaw.profile_setores?.map((ps: any) => ps.setor_id) || []
  } : null

  // Permission Check
  if (profile?.role === 'coordenador') {
    if (!hasUnitAccess(profile, unidadeId)) {
      return <div className="p-8 text-center text-red-600 font-bold">Acesso negado: Unidade não permitida.</div>
    }
    if (!hasSectorAccess(profile, setor, unidadeId)) {
      return <div className="p-8 text-center text-red-600 font-bold">Acesso negado: Setor não permitido.</div>
    }
  } else if (profile?.role === 'comum' || profile?.role === 'servidor') {
    // Check if the user is in the scale being viewed
    const { data: servidor } = await supabase
      .from('servidores')
      .select('id')
      .eq('email', user.email)
      .single()
    
    if (!servidor) {
      return <div>Acesso negado: Servidor não encontrado.</div>
    }
  }

  // 1. Fetch unit info
  const { data: unidade } = await supabase
    .from('unidades')
    .select('*')
    .eq('id', unidadeId)
    .single()

  // 2. Fetch sector info
  const { data: setorRaw } = await supabase
    .from('setores')
    .select('*, dicionario_setores(nome)')
    .eq('id', setor)
    .single()

  const setorInfo = setorRaw ? {
    ...setorRaw,
    nome: (Array.isArray(setorRaw.dicionario_setores) 
      ? setorRaw.dicionario_setores[0]?.nome 
      : (setorRaw as any).dicionario_setores?.nome) || 'SETOR SEM NOME'
  } : null

  // 3. Fetch ALL servers for this sector (to allow adding them)
  const { data: todosServidores } = await supabase
    .from('servidores')
    .select('*')
    .eq('unidade_id', unidadeId)
    .eq('setor_id', setor)
    .order('nome')

  // 4. Fetch turn dictionary
  const { data: turnos } = await supabase
    .from('dicionario_turnos')
    .select('*')
    .order('codigo')

  // 5. Fetch existing monthly scales for this combination
  const { data: escalaMensal } = await supabase
    .from('escala_mensal')
    .select('*, servidores(*)')
    .eq('unidade_id', unidadeId)
    .eq('setor_id', setor)
    .eq('mes', parseInt(mes))
    .eq('ano', parseInt(ano))

  // 6. Fetch daily records for these monthly scales
  const escalaMensalIds = escalaMensal?.map(e => e.id) || []
  const { data: escalaDiaria } = await supabase
    .from('escala_diaria')
    .select('*')
    .in('escala_mensal_id', escalaMensalIds)

  // 7. Fetch holidays for the period
  const lastDay = new Date(parseInt(ano), parseInt(mes), 0).getDate()
  const { data: feriados } = await supabase
    .from('feriados')
    .select('*')
    .gte('data', `${ano}-${mes.toString().padStart(2, '0')}-01`)
    .lte('data', `${ano}-${mes.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`)

  // 8. Fetch global config for auto-inactivation and sobreaviso rules
  const { data: configsGlobais } = await supabase
    .from('configuracoes_globais')
    .select('chave, valor')

  const diasInativacao = parseInt(configsGlobais?.find(c => c.chave === 'dias_inativacao_automatica')?.valor || '5')
  
  // 9. Fetch logs_sobreaviso for these monthly scales
  const { data: logsSobreaviso } = await supabase
    .from('logs_sobreaviso')
    .select('*')
    .in('escala_mensal_id', escalaMensalIds)

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Grade de Escala: {unidade?.nome}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Setor: <span className="font-bold text-blue-600">{setorInfo?.nome}</span> • 
            Período: {new Date(parseInt(ano), parseInt(mes) - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      <ScaleGrid
        key={`${unidadeId}-${setor}-${mes}-${ano}`}
        unidadeId={unidadeId}
        setorId={setor}
        mes={parseInt(mes)}
        ano={parseInt(ano)}
        todosServidoresSetor={todosServidores || []}
        turnos={turnos || []}
        escalaMensalInicial={escalaMensal || []}
        escalaDiariaInicial={escalaDiaria || []}
        feriados={feriados || []}
        diasInativacao={diasInativacao}
        logsSobreavisoInicial={logsSobreaviso || []}
        configsGlobais={configsGlobais || []}
        userProfile={profile}
      />
    </div>
  )
}
