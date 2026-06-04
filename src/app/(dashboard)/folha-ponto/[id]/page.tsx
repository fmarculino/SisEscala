import { createClient } from '@/utils/supabase/server'
import { AcessoNegado } from '@/components/AcessoNegado'
import { hasSectorAccess } from '@/utils/permissions'
import { FolhaPontoEditor } from './FolhaPontoEditor'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function FolhaPontoDetailPage({ params }: PageProps) {
  const supabase = await createClient()
  const { id } = await params

  // 1. Fetch current logged-in profile
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return <AcessoNegado />
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
    .eq('id', user.id)
    .single()

  const userProfile = profile ? {
    ...profile,
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
  } : null

  // 2. Fetch the folha_ponto row
  const { data: folha, error: folhaError } = await supabase
    .from('folha_ponto')
    .select('*, servidores(*)')
    .eq('id', id)
    .maybeSingle()

  if (folhaError || !folha) {
    return (
      <div className="p-8 space-y-6">
        <Link href="/folha-ponto" className="inline-flex items-center gap-2 text-sm text-zinc-500 font-bold hover:text-blue-600 transition-colors">
          <ChevronLeft className="h-4 w-4" /> Voltar para a Lista
        </Link>
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-8 rounded-2xl text-center text-red-700 dark:text-red-400">
          <h2 className="text-xl font-black uppercase mb-2">Folha não encontrada</h2>
          <p className="text-sm font-medium">A folha de ponto solicitada não existe ou foi excluída.</p>
        </div>
      </div>
    )
  }

  // 3. Fetch scale details
  const { data: escala, error: escError } = await supabase
    .from('escala_mensal')
    .select('*, unidades(*), setores(*, dicionario_setores(nome)), jornadas(*)')
    .eq('id', folha.escala_mensal_id)
    .single()

  if (escError || !escala) {
    return <AcessoNegado />
  }

  // Handle nested sector data structure
  const sectorData = Array.isArray(escala.setores) ? escala.setores[0] : escala.setores
  const dictData = sectorData ? (Array.isArray(sectorData.dicionario_setores) 
    ? sectorData.dicionario_setores[0] 
    : sectorData.dicionario_setores) : null

  const resolvedSetor = sectorData ? {
    ...sectorData,
    nome: dictData?.nome || 'SETOR SEM NOME'
  } : null

  // 4. Validate sector access permission
  if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id)) {
    return <AcessoNegado />
  }

  // 5. Build friendly prop shape
  const mappedFolha = {
    ...folha,
    escala: {
      ...escala,
      setores: resolvedSetor
    }
  }

  return (
    <FolhaPontoEditor 
      folha={mappedFolha}
      profile={userProfile}
    />
  )
}
