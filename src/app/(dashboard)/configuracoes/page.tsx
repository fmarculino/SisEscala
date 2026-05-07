'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, Loader2, Settings, Clock, Shield, Bell, Database } from 'lucide-react'

export default function ConfigPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [configs, setConfigs] = useState<any[]>([])

  useEffect(() => {
    fetchConfigs()
  }, [])

  async function fetchConfigs() {
    setLoading(true)
    const { data, error } = await supabase
      .from('configuracoes_globais')
      .select('*')
      .order('chave')
    
    if (error) {
      console.error('Erro ao carregar configurações:', error)
    } else {
      setConfigs(data || [])
    }
    setLoading(false)
  }

  async function handleSave(chave: string, valor: any) {
    setSaving(true)
    const { error } = await supabase
      .from('configuracoes_globais')
      .update({ valor, updated_at: new Date().toISOString() })
      .eq('chave', chave)

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      // Update local state
      setConfigs(prev => prev.map(c => c.chave === chave ? { ...c, valor } : c))
    }
    setSaving(false)
  }

  const getConfig = (chave: string) => configs.find(c => c.chave === chave)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div className="p-3 bg-blue-600 rounded-xl">
          <Settings className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Configurações do Sistema</h1>
          <p className="text-zinc-500 text-sm">Gerencie as regras globais e o comportamento da plataforma.</p>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Regra de Inativação */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
          <div className="p-6 flex items-start gap-4">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="font-bold text-zinc-900 dark:text-white">Inativação Automática de Escalas</h3>
              <p className="text-xs text-zinc-500">Define após quantos dias do fechamento do mês as escalas serão bloqueadas para edição automática.</p>
              
              <div className="pt-4 flex items-center gap-4">
                <input 
                  type="number" 
                  className="w-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                  value={getConfig('dias_inativacao_automatica')?.valor || ''}
                  onChange={(e) => {
                    const newVal = e.target.value
                    setConfigs(prev => prev.map(c => c.chave === 'dias_inativacao_automatica' ? { ...c, valor: newVal } : c))
                  }}
                />
                <span className="text-sm text-zinc-600 dark:text-zinc-400 font-medium">Dias após o fim do mês</span>
                
                <button 
                  onClick={() => handleSave('dias_inativacao_automatica', getConfig('dias_inativacao_automatica')?.valor)}
                  disabled={saving}
                  className="ml-auto inline-flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar Regra
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Placeholder: Segurança */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 flex items-center justify-between opacity-50 cursor-not-allowed">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg text-red-600">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-white">Políticas de Segurança</h3>
              <p className="text-xs text-zinc-500">MFA, expiração de senha e logs de acesso.</p>
            </div>
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">Em breve</span>
        </div>

        {/* Placeholder: Backup */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 flex items-center justify-between opacity-50 cursor-not-allowed">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-white">Backup e Exportação</h3>
              <p className="text-xs text-zinc-500">Agendamento de backups e snapshots do banco.</p>
            </div>
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">Em breve</span>
        </div>
      </div>
    </div>
  )
}
