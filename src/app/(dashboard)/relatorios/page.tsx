import { FileText, ChevronRight, BarChart3, PieChart, Download, Search } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import { AcessoNegado } from '@/components/AcessoNegado'
import Link from 'next/link'

export default async function RelatoriosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user?.id).single()

  const relatorios = [
    { 
      title: 'Consolidado de Horas', 
      desc: 'Resumo total de CH, HE e Sobreaviso por setor.', 
      icon: BarChart3,
      href: '/relatorios/consolidado'
    },
    { 
      title: 'Frequência Mensal', 
      desc: 'Espelho de ponto baseado nas escalas fechadas.', 
      icon: FileText,
      href: '/relatorios/frequencia'
    },
    { 
      title: 'Distribuição de Plantões', 
      desc: 'Análise de cobertura por unidade e turno.', 
      icon: PieChart,
      href: '/relatorios/distribuicao'
    },
    { 
      title: 'Folha de RH', 
      desc: 'Exportação simplificada para fechamento de folha.', 
      icon: Download,
      href: '/relatorios/rh'
    },
  ]

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-600/20">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Relatórios & Gestão</h1>
            <p className="text-zinc-500 text-sm">Extraia dados e análises para tomada de decisão.</p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {relatorios.map((rel, i) => (
          <Link 
            key={i} 
            href={rel.href}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-2xl hover:border-indigo-500 transition-all cursor-pointer group shadow-sm flex flex-col"
          >
            <div className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl w-fit mb-4 text-zinc-600 dark:text-zinc-400 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 group-hover:text-indigo-600 transition-all">
              <rel.icon className="h-6 w-6" />
            </div>
            <h3 className="font-bold text-zinc-900 dark:text-white mb-1">{rel.title}</h3>
            <p className="text-xs text-zinc-500 leading-relaxed mb-6 flex-1">{rel.desc}</p>
            <div className="flex items-center text-[10px] font-black uppercase tracking-widest text-indigo-600 group-hover:gap-2 transition-all">
              Acessar Relatório <ChevronRight className="h-3 w-3" />
            </div>
          </Link>
        ))}
      </div>

      <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 p-12 rounded-3xl text-center">
        <Search className="h-12 w-12 text-indigo-300 mx-auto mb-4 opacity-50" />
        <h2 className="text-xl font-bold text-zinc-900 dark:text-white uppercase tracking-tight">Precisa de um relatório customizado?</h2>
        <p className="text-sm text-zinc-500 max-w-md mx-auto mt-2">
          Entre em contato com o suporte para solicitar novas visualizações de dados específicas para sua unidade.
        </p>
      </div>
    </div>
  )
}
