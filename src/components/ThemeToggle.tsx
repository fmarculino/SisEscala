'use client'

import * as React from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from 'next-themes'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-9 w-[104px] bg-zinc-100 dark:bg-zinc-800 rounded-lg" /> // placeholder
  }

  return (
    <div className="flex items-center gap-1 bg-zinc-200 dark:bg-zinc-800 p-1 rounded-lg">
      <button
        onClick={() => setTheme('light')}
        className={`p-1 rounded-md flex items-center justify-center transition-colors ${theme === 'light' ? 'bg-white dark:bg-zinc-700 shadow-sm text-blue-500' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
        title="Claro"
      >
        <Sun className="h-4 w-4" />
      </button>
      <button
        onClick={() => setTheme('system')}
        className={`p-1 rounded-md flex items-center justify-center transition-colors ${theme === 'system' ? 'bg-white dark:bg-zinc-700 shadow-sm text-blue-500' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
        title="Sistema"
      >
        <Monitor className="h-4 w-4" />
      </button>
      <button
        onClick={() => setTheme('dark')}
        className={`p-1 rounded-md flex items-center justify-center transition-colors ${theme === 'dark' ? 'bg-white dark:bg-zinc-700 shadow-sm text-blue-500' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
        title="Escuro"
      >
        <Moon className="h-4 w-4" />
      </button>
    </div>
  )
}
