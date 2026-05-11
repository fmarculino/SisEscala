'use client'

import { LogOut } from 'lucide-react'
import { logout } from '@/app/login/actions'

export function LogoutButton({ collapsed = false }: { collapsed?: boolean }) {
  async function handleLogout() {
    await logout()
  }

  return (
    <button
      onClick={handleLogout}
      title={collapsed ? "Sair" : undefined}
      className={`flex w-full items-center rounded-md py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-red-600 transition-colors ${collapsed ? 'justify-center px-0' : 'px-2'}`}
    >
      <LogOut className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mr-3'}`} />
      {!collapsed && <span>Sair</span>}
    </button>
  )
}
