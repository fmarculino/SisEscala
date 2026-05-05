import Link from 'next/link'
import { LayoutDashboard, Users, Building2, Clock, ShieldCheck, LogOut, Calendar, Layers } from 'lucide-react'

const navItems = [
  { name: 'Dashboard', href: '/home', icon: LayoutDashboard },
  { name: 'Escalas', href: '/escalas', icon: Calendar },
  { name: 'Unidades', href: '/unidades', icon: Building2 },
  { name: 'Setores', href: '/setores', icon: Layers },
  { name: 'Servidores', href: '/servidores', icon: Users },
  { name: 'Dicionário de Turnos', href: '/turnos', icon: Clock },
  { name: 'Auditoria', href: '/auditoria', icon: ShieldCheck },
]

export function Sidebar() {
  return (
    <div className="flex h-screen w-64 flex-col bg-zinc-900 text-white">
      <div className="flex h-16 items-center justify-center border-b border-zinc-800">
        <h1 className="text-xl font-bold tracking-wider text-blue-400">SISEscala</h1>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className="group flex items-center rounded-md px-2 py-2 text-sm font-medium hover:bg-zinc-800 hover:text-blue-400 transition-colors"
          >
            <item.icon className="mr-3 h-5 w-5" />
            {item.name}
          </Link>
        ))}
      </nav>
      <div className="border-t border-zinc-800 p-4">
        <button className="flex w-full items-center rounded-md px-2 py-2 text-sm font-medium hover:bg-zinc-800 hover:text-red-400 transition-colors">
          <LogOut className="mr-3 h-5 w-5" />
          Sair
        </button>
      </div>
    </div>
  )
}
