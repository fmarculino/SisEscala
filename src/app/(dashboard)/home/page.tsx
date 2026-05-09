import { createClient } from '@/utils/supabase/server'
import { LayoutDashboard, Users, Building2, Calendar, ShieldCheck, ArrowRight, Clock } from 'lucide-react'
import Link from 'next/link'

import { applyAccessFilters } from '@/utils/permissions'

export default async function DashboardHome() {
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

  // Fetch scoped stats
  let unitsQuery = supabase.from('unidades').select('*', { count: 'exact', head: true })
  unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
  const { count: unidadesCount } = await unitsQuery

  let serversQuery = supabase.from('servidores').select('*', { count: 'exact', head: true })
  serversQuery = applyAccessFilters(serversQuery, userProfile)
  const { count: servidoresCount } = await serversQuery
  
  // Calculate unique scales matching the list view grouping (unidade, setor, mes, ano)
  let escalasQuery = supabase.from('escala_mensal').select('unidade_id, setor_id, mes, ano')
  escalasQuery = applyAccessFilters(escalasQuery, userProfile)
  const { data: escalasData } = await escalasQuery
  const escalasCount = escalasData ? new Set(escalasData.map(e => `${e.unidade_id}|${e.setor_id}|${e.mes}|${e.ano}`)).size : 0

  const userRole = profile?.role || ''
  const isCoord = userRole === 'coordenador'

  const stats = [
    { name: 'Unidades', value: unidadesCount || 0, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50' },
    { name: 'Servidores', value: servidoresCount || 0, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
    { name: 'Escalas Ativas', value: escalasCount, icon: Calendar, color: 'text-green-600', bg: 'bg-green-50' },
  ]

  const quickActions = [
    { 
      name: 'Gerenciar Escalas', 
      description: 'Crie e visualize as escalas mensais por unidade.', 
      href: '/escalas', 
      icon: Calendar, 
      color: 'bg-green-500' 
    },
    { 
      name: 'Auditória Digital', 
      description: 'Valide acionamentos e verifique geolocalização.', 
      href: '/auditoria', 
      icon: ShieldCheck, 
      color: 'bg-orange-500' 
    },
    { 
      name: 'Dicionário de Turnos', 
      description: 'Configure códigos e cargas horárias.', 
      href: '/turnos', 
      icon: Clock, 
      color: 'bg-blue-500',
      hidden: isCoord
    },
    { 
      name: 'Quadro de Servidores', 
      description: 'Gestão de vínculos e matrículas.', 
      href: '/servidores', 
      icon: Users, 
      color: 'bg-purple-500',
      hidden: isCoord
    },
  ].filter(a => !a.hidden)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Painel de Controle</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Bem-vindo ao SisEscala. Visão geral do sistema e acessos rápidos.
        </p>
      </div>

      {!isCoord && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {stats.map((item) => (
            <div key={item.name} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center">
                <div className={`rounded-lg p-3 ${item.bg}`}>
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
                <div className="ml-5">
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 truncate">{item.name}</p>
                  <p className="text-2xl font-bold text-zinc-900 dark:text-white">{item.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-6 flex items-center text-zinc-900 dark:text-white">
          <ArrowRight className="mr-2 h-5 w-5 text-blue-500" />
          Ações Rápidas
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => (
            <Link 
              key={action.name} 
              href={action.href}
              className="flex flex-col p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:border-zinc-800 dark:bg-zinc-900 hover:border-blue-500/50 hover:shadow-md transition-all group"
            >
              <div className={`h-12 w-12 rounded-lg ${action.color} flex items-center justify-center text-white mb-4 shadow-sm`}>
                <action.icon className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-zinc-900 dark:text-white group-hover:text-blue-500 transition-colors">
                {action.name}
              </h3>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {action.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
