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
    />
  )
}
