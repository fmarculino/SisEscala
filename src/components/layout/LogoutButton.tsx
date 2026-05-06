'use client'

import { LogOut } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
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
      className="flex w-full items-center rounded-md px-2 py-2 text-sm font-medium hover:bg-zinc-800 hover:text-red-400 transition-colors"
    >
      <LogOut className="mr-3 h-5 w-5" />
      Sair
    </button>
  )
}
