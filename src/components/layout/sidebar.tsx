'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  LayoutDashboard, Users, Building2, Clock, ShieldCheck, 
  Calendar, Layers, Shield, User, Briefcase, CalendarDays, 
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Settings, Database, Lock, FileText, Activity
} from 'lucide-react'
import { LogoutButton } from './LogoutButton'
import { ThemeToggle } from '../ThemeToggle'

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
      { name: 'Dicionário de Turnos', href: '/turnos', icon: Clock },
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
    title: 'MEU PERFIL',
    items: [
      { name: 'Meu Perfil', href: '/perfil', icon: User },
    ]
  }
]

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'OPERAÇÃO': true,
    'CADASTROS': true,
    'AUDITORIA & GESTÃO': false,
    'SISTEMA': false,
  })

  const toggleGroup = (title: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [title]: !prev[title]
    }))
  }

  return (
    <div className={`flex h-screen flex-col bg-[#020817] text-zinc-400 border-r border-zinc-800 transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div className="flex h-16 items-center justify-between px-4 border-b border-zinc-800/50">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Calendar className="text-white h-5 w-5" />
            </div>
            <h1 className="text-lg font-black tracking-tighter text-white">SISESCALA</h1>
          </div>
        )}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)} 
          className={`p-1.5 rounded-md hover:bg-zinc-800 hover:text-white transition-colors ${isCollapsed ? 'mx-auto' : ''}`}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>

      <nav className="flex-1 space-y-4 px-3 py-6 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-zinc-800">
        {menuGroups.map((group) => {
          const isSingle = group.items.length === 1 && !group.icon
          const isExpanded = expandedGroups[group.title]

          if (isSingle) {
            const item = group.items[0]
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`group flex items-center rounded-lg py-2.5 px-3 text-sm font-semibold transition-all hover:bg-blue-600/10 hover:text-blue-400 ${isCollapsed ? 'justify-center' : ''}`}
                title={isCollapsed ? item.name : undefined}
              >
                <item.icon className={`h-5 w-5 shrink-0 ${isCollapsed ? '' : 'mr-3 text-zinc-500 group-hover:text-blue-400'}`} />
                {!isCollapsed && <span>{item.name}</span>}
              </Link>
            )
          }

          return (
            <div key={group.title} className="space-y-1">
              {!isCollapsed ? (
                <button
                  onClick={() => toggleGroup(group.title)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {group.icon && <group.icon className="h-3 w-3" />}
                    {group.title}
                  </div>
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              ) : (
                <div className="h-px bg-zinc-800 my-4 mx-2" />
              )}

              {(isExpanded || isCollapsed) && (
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`group flex items-center rounded-lg py-2 px-3 text-sm font-medium transition-all hover:bg-zinc-800/50 hover:text-white ${isCollapsed ? 'justify-center' : 'pl-8'}`}
                      title={isCollapsed ? item.name : undefined}
                    >
                      {isCollapsed ? (
                        <item.icon className="h-5 w-5 shrink-0 text-zinc-500 group-hover:text-blue-400" />
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

      <div className="p-4 border-t border-zinc-800/50 space-y-4">
        {!isCollapsed && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
            <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-500">
              <User className="h-4 w-4" />
            </div>
            <div className="flex flex-col truncate">
              <span className="text-[10px] font-bold text-white truncate uppercase">Fernando M.</span>
              <span className="text-[9px] text-zinc-500 truncate">Administrador</span>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <ThemeToggle collapsed={isCollapsed} />
          <LogoutButton collapsed={isCollapsed} />
        </div>
        {!isCollapsed && (
          <div className="pt-2 text-center">
            <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter">Sobre o Sistema</p>
            <p className="text-[8px] text-zinc-700">Versão 0.8.0-beta</p>
          </div>
        )}
      </div>
    </div>
  )
}
