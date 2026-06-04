'use client'

import { useState, useEffect } from 'react'
import packageJson from '../../../package.json'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { 
  LayoutDashboard, Users, Building2, Clock, ShieldCheck, 
  Calendar, Layers, Shield, User, Briefcase, CalendarDays, 
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Settings, Database, Lock, FileText, Activity, HelpCircle, BookOpen
} from 'lucide-react'
import { LogoutButton } from './LogoutButton'
import { ThemeToggle } from '../ThemeToggle'
import { getRoleLabel } from '@/utils/roles'

interface MenuItem {
  name: string
  href: string
  icon: any
}

interface MenuGroup {
  title: string
  icon?: any
  items: MenuItem[]
}

const menuGroups: MenuGroup[] = [
  {
    title: 'Dashboard',
    items: [
      { name: 'Dashboard', href: '/home', icon: LayoutDashboard },
    ]
  },
  {
    title: 'OPERAÇÃO',
    icon: Activity,
    items: [
      { name: 'Escalas', href: '/escalas', icon: Calendar },
      { name: 'Afastamentos', href: '/afastamentos', icon: CalendarDays },
      { name: 'Folha de Ponto', href: '/folha-ponto', icon: FileText },
    ]
  },
  {
    title: 'CADASTROS',
    icon: Layers,
    items: [
      { name: 'Unidades', href: '/unidades', icon: Building2 },
      { name: 'Setores', href: '/setores', icon: Layers },
      { name: 'Servidores', href: '/servidores', icon: Users },
      { name: 'Cargos', href: '/cargos', icon: Briefcase },
      { name: 'Feriados', href: '/feriados', icon: CalendarDays },
      { name: 'Jornadas', href: '/jornadas', icon: Clock },
      { name: 'Dicionário de Turnos', href: '/turnos', icon: Clock },
      { name: 'Tipos de Afastamento', href: '/tipos-eventos', icon: Layers },
    ]
  },
  {
    title: 'AUDITORIA & GESTÃO',
    icon: ShieldCheck,
    items: [
      { name: 'Auditoria Digital', href: '/auditoria', icon: ShieldCheck },
      { name: 'Relatórios', href: '/relatorios', icon: FileText },
    ]
  },
  {
    title: 'SISTEMA',
    icon: Settings,
    items: [
      { name: 'Configurações', href: '/configuracoes', icon: Settings },
      { name: 'Usuários', href: '/usuarios', icon: Shield },
      { name: 'Backup', href: '/backup', icon: Database },
      { name: 'Segurança', href: '/seguranca', icon: Lock },
    ]
  },
  {
    title: 'SUPORTE',
    icon: HelpCircle,
    items: [
      { name: 'Ajuda', href: '/ajuda', icon: BookOpen },
    ]
  },
  {
    title: 'MEU PERFIL',
    items: [
      { name: 'Meu Perfil', href: '/perfil', icon: User },
    ]
  }
]

export function Sidebar({ user }: { user?: any }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'OPERAÇÃO': true,
    'CADASTROS': true,
    'AUDITORIA & GESTÃO': false,
    'SISTEMA': false,
  })
  const [folhaPontoHabilitada, setFolhaPontoHabilitada] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function checkConfig() {
      const { data, error } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'folha_ponto_habilitada')
        .single()
      if (data && !error) {
        setFolhaPontoHabilitada(data.valor === true)
      }
    }
    checkConfig()
  }, [supabase])

  const toggleGroup = (title: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [title]: !prev[title]
    }))
  }

  // Role-based filtering
  const userRole = user?.role || ''
  const isSuperAdmin = userRole === 'super_admin'
  const isAdmin = userRole === 'admin'
  const isCoord = userRole === 'coordenador'

  const filteredGroups = menuGroups.map(group => {
    // Filter items within group
    const filteredItems = group.items.filter(item => {
      if (item.name === 'Folha de Ponto' && !folhaPontoHabilitada) return false

      if (isSuperAdmin) return true
      
      if (isAdmin) {
        // Administrador não vê Sistema
        if (group.title === 'SISTEMA') return false
        // Administrador não vê itens de configuração estrutural (apenas Super Admin)
        const superAdminOnlyItems = ['Unidades', 'Cargos', 'Jornadas', 'Dicionário de Turnos']
        if (superAdminOnlyItems.includes(item.name)) return false
        return true
      }
      
      if (isCoord) {
        // Coordenador não vê Cadastros, Sistema nem Auditoria & Gestão
        if (group.title === 'CADASTROS' || group.title === 'SISTEMA' || group.title === 'AUDITORIA & GESTÃO') return false
        return true
      }

      return false
    })

    return { ...group, items: filteredItems }
  }).filter(group => group.items.length > 0)

  // Nome e Cargo amigáveis
  const userName = user?.full_name || 'Usuário'
  const userRoleLabel = getRoleLabel(userRole)

  return (
    <div className={`flex h-screen flex-col bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-r border-zinc-200 dark:border-zinc-800 transition-all duration-300 print:hidden ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div className="flex h-16 items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800/50">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Calendar className="text-white h-5 w-5" />
            </div>
            <h1 className="text-lg font-black tracking-tighter text-zinc-900 dark:text-white">SISESCALA</h1>
          </div>
        )}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)} 
          className={`p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-blue-600 transition-colors ${isCollapsed ? 'mx-auto' : ''}`}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>

      <nav className="flex-1 space-y-4 px-3 py-6 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
        {filteredGroups.map((group) => {
          const isSingle = group.items.length === 1 && !group.icon
          const isExpanded = expandedGroups[group.title]

          if (isSingle) {
            const item = group.items[0]
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`group flex items-center rounded-lg py-2.5 px-3 text-sm font-semibold transition-all hover:bg-blue-600/10 hover:text-blue-600 dark:hover:text-blue-400 ${isCollapsed ? 'justify-center' : ''}`}
                title={isCollapsed ? item.name : undefined}
              >
                <item.icon className={`h-5 w-5 shrink-0 ${isCollapsed ? '' : 'mr-3 text-zinc-400 dark:text-zinc-500 group-hover:text-blue-600 dark:group-hover:text-blue-400'}`} />
                {!isCollapsed && <span>{item.name}</span>}
              </Link>
            )
          }

          return (
            <div key={group.title} className="space-y-1">
              {!isCollapsed ? (
                <button
                  onClick={() => toggleGroup(group.title)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 hover:text-blue-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {group.icon && <group.icon className="h-3 w-3" />}
                    {group.title}
                  </div>
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              ) : (
                <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-4 mx-2" />
              )}

              {(isExpanded || isCollapsed) && (
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`group flex items-center rounded-lg py-2 px-3 text-sm font-medium transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-blue-600 dark:hover:text-white ${isCollapsed ? 'justify-center' : 'pl-8'}`}
                      title={isCollapsed ? item.name : undefined}
                    >
                      {isCollapsed ? (
                        <item.icon className="h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                      ) : (
                        <span className="truncate">{item.name}</span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800/50 space-y-4">
        {!isCollapsed && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800/50">
            <div className="w-8 h-8 rounded-full bg-blue-600/10 dark:bg-blue-600/20 flex items-center justify-center text-blue-600 dark:text-blue-500">
              <User className="h-4 w-4" />
            </div>
            <div className="flex flex-col truncate">
              <span className="text-[10px] font-bold text-zinc-900 dark:text-white truncate uppercase">{userName}</span>
              <span className="text-[9px] text-zinc-500 truncate">{userRoleLabel}</span>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <ThemeToggle collapsed={isCollapsed} />
          <LogoutButton collapsed={isCollapsed} />
        </div>
        {!isCollapsed && (
          <div className="pt-2 text-center">
            <p className="text-[8px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-tighter">Sobre o Sistema</p>
            <p className="text-[8px] text-zinc-500 dark:text-zinc-700">Versão {packageJson.version}</p>
          </div>
        )}
      </div>
    </div>
  )
}
