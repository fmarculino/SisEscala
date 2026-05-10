'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, Loader2, Settings, Clock, Shield, Bell, Database, Zap, Lock, CheckSquare } from 'lucide-react'

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

        {/* Dia Limite de Planejamento */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
          <div className="p-6 flex items-start gap-4">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600">
              <Lock className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="font-bold text-zinc-900 dark:text-white">Prazo de Planejamento Mensal</h3>
              <p className="text-xs text-zinc-500">Bloqueia a edição de escalas do mês atual para Coordenadores após este dia.</p>
              
              <div className="pt-4 flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Dia Limite:</span>
                  <input 
                    type="number" 
                    min="1"
                    max="28"
                    className="w-24 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                    value={getConfig('dia_limite_planejamento')?.valor || ''}
                    onChange={(e) => {
                      const newVal = e.target.value
                      setConfigs(prev => prev.map(c => c.chave === 'dia_limite_planejamento' ? { ...c, valor: newVal } : c))
                    }}
                  />
                </div>
                <p className="text-[10px] text-zinc-500 max-w-[250px]">Do dia seguinte em diante, apenas Admins podem alterar o mês corrente.</p>
                
                <button 
                  onClick={() => handleSave('dia_limite_planejamento', getConfig('dia_limite_planejamento')?.valor)}
                  disabled={saving}
                  className="ml-auto inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Atualizar Prazo
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Regras de Sobreaviso */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
          <div className="p-6 flex items-start gap-4">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white">Regras de Sobreaviso</h3>
                <p className="text-xs text-zinc-500">Defina os prazos, obrigações de GPS e penalidades para acionamento de sobreaviso.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Exigir Localização (GPS)</label>
                  <select 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={getConfig('sobreaviso_exigir_localizacao')?.valor || 'false'}
                    onChange={(e) => handleSave('sobreaviso_exigir_localizacao', e.target.value)}
                    disabled={saving}
                  >
                    <option value="true">Sim, obrigatório</option>
                    <option value="false">Não exigir</option>
                  </select>
                  <p className="text-[10px] text-zinc-500">Bloqueia o aceite se o servidor não compartilhar a localização.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Tempo Limite para Aceite (minutos)</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={getConfig('sobreaviso_tempo_aceite_minutos')?.valor || ''}
                    onBlur={(e) => handleSave('sobreaviso_tempo_aceite_minutos', e.target.value)}
                    onChange={(e) => setConfigs(prev => prev.map(c => c.chave === 'sobreaviso_tempo_aceite_minutos' ? { ...c, valor: e.target.value } : c))}
                    disabled={saving}
                  />
                  <p className="text-[10px] text-zinc-500">Tempo máximo antes de invalidar a chamada.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Tempo Limite de Deslocamento (minutos)</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={getConfig('sobreaviso_tempo_chegada_minutos')?.valor || ''}
                    onBlur={(e) => handleSave('sobreaviso_tempo_chegada_minutos', e.target.value)}
                    onChange={(e) => setConfigs(prev => prev.map(c => c.chave === 'sobreaviso_tempo_chegada_minutos' ? { ...c, valor: e.target.value } : c))}
                    disabled={saving}
                  />
                  <p className="text-[10px] text-zinc-500">Tempo máximo para registrar a chegada após o aceite.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Penalizar Falha na Escala</label>
                  <select 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={getConfig('sobreaviso_desconsiderar_falha')?.valor || 'false'}
                    onChange={(e) => handleSave('sobreaviso_desconsiderar_falha', e.target.value)}
                    disabled={saving}
                  >
                    <option value="true">Desconsiderar turno da soma de totais</option>
                    <option value="false">Manter contabilizado nos totais</option>
                  </select>
                  <p className="text-[10px] text-zinc-500">Se ativo, o plantão não entra nos cálculos mensais.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Permitir Validação Manual</label>
                  <select 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={getConfig('sobreaviso_permitir_validacao_manual')?.valor || 'false'}
                    onChange={(e) => handleSave('sobreaviso_permitir_validacao_manual', e.target.value)}
                    disabled={saving}
                  >
                    <option value="true">Sim, administradores podem sobrepor a falha</option>
                    <option value="false">Não permitir sobreposição manual</option>
                  </select>
                  <p className="text-[10px] text-zinc-500">Permite que um admin valide manualmente um sobreaviso que falhou.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Configuração de Presença */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
          <div className="p-6 flex items-start gap-4">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600">
              <CheckSquare className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white">Confirmação de Presença (Ponto Digital)</h3>
                <p className="text-xs text-zinc-500">Gerencie como os servidores devem registrar entrada e saída dos plantões.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Obrigatoriedade</label>
                  <select 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold"
                    value={getConfig('exigir_confirmacao_presenca')?.valor || 'false'}
                    onChange={(e) => handleSave('exigir_confirmacao_presenca', e.target.value)}
                    disabled={saving}
                  >
                    <option value="true">Sim, Obrigatório para cálculo</option>
                    <option value="false">Não, Apenas Visual</option>
                  </select>
                  <p className="text-[10px] text-zinc-500">Se obrigatório, plantões não confirmados são excluídos dos totais.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Janela de Tolerância (minutos)</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="number" 
                      className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold"
                      value={getConfig('janela_presenca_minutos')?.valor || '30'}
                      onBlur={(e) => handleSave('janela_presenca_minutos', e.target.value)}
                      onChange={(e) => setConfigs(prev => prev.map(c => c.chave === 'janela_presenca_minutos' ? { ...c, valor: e.target.value } : c))}
                      disabled={saving}
                    />
                    <button 
                      onClick={() => handleSave('janela_presenca_minutos', getConfig('janela_presenca_minutos')?.valor)}
                      disabled={saving}
                      className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500">Tempo permitido antes/depois do horário de entrada/saída.</p>
                </div>
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
