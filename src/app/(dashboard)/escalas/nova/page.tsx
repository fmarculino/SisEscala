'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, ArrowLeft, Loader2, Layers } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function NovaEscalaPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [selectedUnidade, setSelectedUnidade] = useState('')
  const [selectedSetor, setSelectedSetor] = useState('')
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())
  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      const { data: units } = await supabase.from('unidades').select('id, nome').eq('ativo', true).order('nome')
      if (units) setUnidades(units)

      const { data: sectors } = await supabase.from('setores').select('id, nome, unidade_id').eq('ativo', true).order('nome')
      if (sectors) setSetores(sectors)
    }
    loadData()
  }, [])

  const filteredSetores = selectedUnidade 
    ? setores.filter(s => s.unidade_id === selectedUnidade)
    : setores

  async function handleGenerate() {
    if (!selectedUnidade || !selectedSetor) {
      alert('Selecione a unidade e o setor.')
      return
    }
    setLoading(true)

    try {
      // Just redirect to the grid view. The grid view will handle adding servers.
      router.push(`/escalas/unidade/${selectedUnidade}?setor=${selectedSetor}&mes=${mes}&ano=${ano}`)
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <Link href="/escalas" className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Gerar Nova Escala</h1>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Unidade</label>
            <select
              value={selectedUnidade}
              onChange={(e) => {
                setSelectedUnidade(e.target.value)
                setSelectedSetor('') // Reset sector when unit changes
              }}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">Selecione a Unidade</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center">
              <Layers className="h-4 w-4 mr-1 text-blue-500" />
              Setor / Serviço
            </label>
            <select
              value={selectedSetor}
              disabled={!selectedUnidade}
              onChange={(e) => setSelectedSetor(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-50"
            >
              <option value="">Selecione o Setor</option>
              {filteredSetores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Mês</label>
              <select
                value={mes}
                onChange={(e) => setMes(parseInt(e.target.value))}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
              >
                {[...Array(12)].map((_, i) => (
                  <option key={i+1} value={i+1}>{new Date(2000, i).toLocaleString('pt-BR', { month: 'long' })}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Ano</label>
              <input
                type="number"
                value={ano}
                onChange={(e) => setAno(parseInt(e.target.value))}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={loading || !selectedUnidade || !selectedSetor}
            className="inline-flex items-center rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-all"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Gerar Grade por Setor
          </button>
        </div>
      </div>
    </div>
  )
}
