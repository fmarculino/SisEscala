import { Sidebar } from '@/components/layout/sidebar'
import { NotificationListener } from '@/components/NotificationListener'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      <NotificationListener />
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}
