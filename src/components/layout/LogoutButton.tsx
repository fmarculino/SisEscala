'use client'

import { LogOut } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter()

  async function handleLogout() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      
      // Use window.location.href to force a full page reload and clear all states/caches
      window.location.href = '/login'
    } catch (error) {
      console.error('Erro ao sair:', error)
      // Fallback
      window.location.href = '/login'
    }
  }

  return (
    <button
      onClick={handleLogout}
      title={collapsed ? "Sair" : undefined}
      className={`flex w-full items-center rounded-md py-2 text-sm font-medium hover:bg-zinc-800 hover:text-red-400 transition-colors ${collapsed ? 'justify-center px-0' : 'px-2'}`}
    >
      <LogOut className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mr-3'}`} />
      {!collapsed && <span>Sair</span>}
    </button>
  )
}
