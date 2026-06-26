import { createClient } from '@/utils/supabase/server'
import { ServidorDetalhesClient } from './ServidorDetalhesClient'
import { applyAccessFilters } from '@/utils/permissions'
import { formatSectorsHierarchy } from '@/utils/sectors'

export default async function EditServidorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  // Fetch profile with permissions
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user?.id)
    .single()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
  } : null

  const { data: servidor } = await supabase
    .from('servidores')
    .select('*')
    .eq('id', id)
    .single()

  // Fetch Units with access filter
  let unitsQuery = supabase
    .from('unidades')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')
  
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
  const { data: unidades } = await unitsQuery

  // Fetch Sectors with access filter
  let sectorsQuery = supabase
    .from('setores')
    .select('id, unidade_id, parent_id, dicionario_setores(nome)')
    .eq('ativo', true)

  sectorsQuery = applyAccessFilters(sectorsQuery, userProfile)
  const { data: sectorsRaw } = await sectorsQuery
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

  return (
    <ServidorDetalhesClient
      id={id}
      servidor={servidor}
      unidades={unidades || []}
      setores={setores || []}
      cargos={cargos || []}
      isSuperAdmin={userProfile?.role === 'super_admin'}
      historico={historico}
      escalas={escalas}
      folhas={folhas || []}
      jornadas={jornadas || []}
      jornadasTemporarias={jornadasTemporarias || []}
    />
  )
}
