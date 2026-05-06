import { createClient } from '@/utils/supabase/server'
import { ScaleGrid } from './ScaleGrid'

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

  // 1. Fetch unit info
  const { data: unidade } = await supabase
    .from('unidades')
    .select('*')
    .eq('id', unidadeId)
    .single()

  // 2. Fetch sector info
  const { data: setorInfo } = await supabase
    .from('setores')
    .select('*')
    .eq('id', setor)
    .single()

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

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between">
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
        unidadeId={unidadeId}
        setorId={setor}
        mes={parseInt(mes)}
        ano={parseInt(ano)}
        todosServidoresSetor={todosServidores || []}
        turnos={turnos || []}
        escalaMensalInicial={escalaMensal || []}
        escalaDiariaInicial={escalaDiaria || []}
      />
    </div>
  )
}
