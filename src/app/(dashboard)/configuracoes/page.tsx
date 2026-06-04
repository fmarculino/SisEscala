'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, Loader2, Settings, Clock, Shield, Bell, Database, Zap, Lock, CheckSquare, Calendar, FileText } from 'lucide-react'

export default function ConfigPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [configs, setConfigs] = useState<any[]>([])
  const [originalConfigs, setOriginalConfigs] = useState<any[]>([])

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
      setOriginalConfigs(JSON.parse(JSON.stringify(data || [])))
    }
    setLoading(false)
  }

  const hasChanges = JSON.stringify(configs) !== JSON.stringify(originalConfigs)

  async function handleSaveAll() {
    setSaving(true)
    
    const updates = configs.filter(c => {
      const original = originalConfigs.find(oc => oc.chave === c.chave)
      return JSON.stringify(original?.valor) !== JSON.stringify(c.valor)
    })

    if (updates.length === 0) {
      setSaving(false)
      return
    }

    const { error } = await supabase
      .from('configuracoes_globais')
      .upsert(updates.map(u => ({
        chave: u.chave,
        valor: u.valor,
        updated_at: new Date().toISOString()
      })), { onConflict: 'chave' })

    if (error) {
      alert('Erro ao salvar: ' + error.message)
    } else {
      setOriginalConfigs(JSON.parse(JSON.stringify(configs)))
      // Trigger a brief success state or notification would be better than an alert
      alert('Configurações aplicadas com sucesso!')
    }
    setSaving(false)
  }

  const getConfig = (chave: string) => configs.find(c => c.chave === chave)

  const updateConfig = (chave: string, valor: any) => {
    setConfigs(prev => prev.map(c => c.chave === chave ? { ...c, valor } : c))
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 pb-32">
      {/* Header com Botão Salvar Global */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-zinc-200 dark:border-zinc-800 pb-8 sticky top-0 bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-md z-20 -mx-8 px-8 py-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20 text-white">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Governança do Sistema</h1>
            <p className="text-zinc-500 text-sm font-medium">Ajuste as regras de negócio e parâmetros globais da plataforma.</p>
          </div>
        </div>

        <button 
          onClick={handleSaveAll}
          disabled={!hasChanges || saving}
          className={`
            flex items-center gap-3 px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all
            ${hasChanges 
              ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/20 hover:scale-105 active:scale-95' 
              : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed opacity-50'}
          `}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          {saving ? 'Gravando...' : hasChanges ? 'Salvar Alterações' : 'Nada para salvar'}
        </button>
      </div>

      <div className="grid gap-8">
        {/* Inativação Automática */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex flex-col md:flex-row md:items-center gap-8">
            <div className="p-4 bg-amber-100 dark:bg-amber-900/30 rounded-2xl text-amber-600">
              <Clock className="h-6 w-6" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Inativação Automática de Escalas</h3>
              <p className="text-sm text-zinc-500 leading-relaxed max-w-2xl">Bloqueio automático de edição após o fechamento do mês para garantir integridade dos dados históricos.</p>
            </div>
            <div className="flex items-center gap-4 bg-zinc-50 dark:bg-zinc-800 p-2 rounded-2xl border border-zinc-200 dark:border-zinc-700">
              <input 
                type="number" 
                className="w-24 bg-white dark:bg-zinc-900 border-none rounded-xl px-4 py-3 text-lg focus:ring-2 focus:ring-blue-500 outline-none font-black text-center"
                value={getConfig('dias_inativacao_automatica')?.valor || ''}
                onChange={(e) => updateConfig('dias_inativacao_automatica', e.target.value)}
              />
              <span className="pr-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">Dias úteis</span>
            </div>
          </div>
        </div>

        {/* Prazo de Planejamento */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex flex-col md:flex-row md:items-center gap-8">
            <div className="p-4 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl text-indigo-600">
              <Lock className="h-6 w-6" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Prazo de Planejamento Mensal</h3>
              <p className="text-sm text-zinc-500 leading-relaxed max-w-2xl">Define o dia limite para coordenadores submeterem o planejamento da escala do mês atual.</p>
            </div>
            <div className="flex items-center gap-4 bg-zinc-50 dark:bg-zinc-800 p-2 rounded-2xl border border-zinc-200 dark:border-zinc-700">
              <span className="pl-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Até dia</span>
              <input 
                type="number" 
                min="1" max="31"
                className="w-24 bg-white dark:bg-zinc-900 border-none rounded-xl px-4 py-3 text-lg focus:ring-2 focus:ring-indigo-500 outline-none font-black text-center"
                value={getConfig('dia_limite_planejamento')?.valor || ''}
                onChange={(e) => updateConfig('dia_limite_planejamento', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Regras de Sobreaviso */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-orange-100 dark:bg-orange-900/30 rounded-2xl text-orange-600">
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Protocolos de Sobreaviso</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">Gerencie prazos, geolocalização e fluxos de aceite para o regime de prontidão.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Exigir Localização (GPS)</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all"
                  value={getConfig('sobreaviso_exigir_localizacao')?.valor || 'false'}
                  onChange={(e) => updateConfig('sobreaviso_exigir_localizacao', e.target.value)}
                >
                  <option value="true">Sim, obrigatório</option>
                  <option value="false">Não exigir</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Tempo para Aceite</label>
                <div className="relative">
                  <input 
                    type="number" 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all pr-12"
                    value={getConfig('sobreaviso_tempo_accite_minutos')?.valor || getConfig('sobreaviso_tempo_aceite_minutos')?.valor || ''}
                    onChange={(e) => updateConfig('sobreaviso_tempo_aceite_minutos', e.target.value)}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-400 uppercase">min</div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Tempo de Deslocamento</label>
                <div className="relative">
                  <input 
                    type="number" 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all pr-12"
                    value={getConfig('sobreaviso_tempo_chegada_minutos')?.valor || ''}
                    onChange={(e) => updateConfig('sobreaviso_tempo_chegada_minutos', e.target.value)}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-400 uppercase">min</div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Penalizar Falha</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all"
                  value={getConfig('sobreaviso_desconsiderar_falha')?.valor || 'false'}
                  onChange={(e) => updateConfig('sobreaviso_desconsiderar_falha', e.target.value)}
                >
                  <option value="true">Desconsiderar Turno</option>
                  <option value="false">Manter nos Totais</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Validação Manual</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all"
                  value={getConfig('sobreaviso_permitir_validacao_manual')?.valor || 'false'}
                  onChange={(e) => updateConfig('sobreaviso_permitir_validacao_manual', e.target.value)}
                >
                  <option value="true">Sim, Permitir</option>
                  <option value="false">Bloquear Manual</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Configuração de Presença */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl text-emerald-600">
                <CheckSquare className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Presença e Ponto Digital</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">Defina a janela de tolerância e a obrigatoriedade da confirmação de plantão.</p>
              </div>
            </div>
              
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Obrigatoriedade</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold transition-all"
                  value={getConfig('exigir_confirmacao_presenca')?.valor || 'false'}
                  onChange={(e) => updateConfig('exigir_confirmacao_presenca', e.target.value)}
                >
                  <option value="true">Sim, Obrigatório</option>
                  <option value="false">Não, Apenas Visual</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Janela de Tolerância</label>
                <div className="relative">
                  <input 
                    type="number" 
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold transition-all pr-12"
                    value={getConfig('janela_presenca_minutos')?.valor || '30'}
                    onChange={(e) => updateConfig('janela_presenca_minutos', e.target.value)}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-400 uppercase">min</div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Fuso Horário (Timezone)</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold transition-all"
                  value={getConfig('timezone')?.valor || 'America/Sao_Paulo'}
                  onChange={(e) => updateConfig('timezone', e.target.value)}
                >
                  <option value="America/Sao_Paulo">Brasília (GMT-3)</option>
                  <option value="America/Manaus">Manaus (GMT-4)</option>
                  <option value="America/Cuiaba">Cuiabá (GMT-4)</option>
                  <option value="America/Rio_Branco">Acre (GMT-5)</option>
                  <option value="UTC">UTC (Universal)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Gestão de Afastamentos e Eventos */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded-2xl text-red-600">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Afastamentos e Eventos</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">Gerencie as regras de conciliação entre escalas de serviço e afastamentos (férias, atestados, licenças).</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest block">Flexibilização de Escalas</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-red-500 outline-none font-bold transition-all"
                  value={getConfig('permitir_plantao_extra_durante_eventos')?.valor || 'false'}
                  onChange={(e) => updateConfig('permitir_plantao_extra_durante_eventos', e.target.value)}
                >
                  <option value="false">Bloquear Totalmente (Recomendado)</option>
                  <option value="true">Permitir Plantão, Extra e Sobreaviso (Flexível)</option>
                </select>
                <p className="text-[11px] text-zinc-400 leading-normal mt-1">
                  Se desativado, o servidor não poderá ser escalado para NENHUM turno nos dias de afastamento. Se ativado, permite escalas de plantão, extras e sobreaviso, mas impede a carga horária regular.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Folha de Ponto */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-2xl text-blue-600">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Folha de Ponto</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">Parâmetros para geração, tolerância e preenchimento das folhas de ponto dos servidores.</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest block">Módulo Folha de Ponto</label>
                <select 
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all"
                  value={getConfig('folha_ponto_habilitada')?.valor !== undefined ? String(getConfig('folha_ponto_habilitada')?.valor) : 'false'}
                  onChange={(e) => updateConfig('folha_ponto_habilitada', e.target.value === 'true')}
                >
                  <option value="true">Habilitado</option>
                  <option value="false">Desabilitado</option>
                </select>
                <p className="text-[11px] text-zinc-400 leading-normal mt-1">
                  Ativa o menu e permite que coordenadores gerem as folhas de ponto a partir da escala regular dos servidores.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest block">Janela de Variação de Horários Fictícios</label>
                <div className="relative">
                  <input 
                    type="number" 
                    min="1" max="60"
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all pr-12"
                    value={getConfig('folha_ponto_variacao_minutos')?.valor !== undefined ? String(getConfig('folha_ponto_variacao_minutos')?.valor) : '15'}
                    onChange={(e) => updateConfig('folha_ponto_variacao_minutos', parseInt(e.target.value) || 15)}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-400 uppercase">min</div>
                </div>
                <p className="text-[11px] text-zinc-400 leading-normal mt-1">
                  Variação máxima (ex: 15min) adicionada ou subtraída dos horários oficiais ao preencher de forma fictícia os horários sem presença real.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Placeholders com design premium */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 opacity-60">
          <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-[2rem] p-8 flex items-center justify-between group cursor-not-allowed border border-dashed border-zinc-300 dark:border-zinc-700">
            <div className="flex items-center gap-6">
              <div className="p-4 bg-white dark:bg-zinc-800 rounded-2xl text-zinc-400 shadow-sm">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white uppercase tracking-tight">Segurança Avançada</h3>
                <p className="text-xs text-zinc-500">MFA e auditoria detalhada.</p>
              </div>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest bg-zinc-200 dark:bg-zinc-800 px-3 py-1 rounded-full text-zinc-500">Breve</span>
          </div>

          <div className="bg-zinc-100 dark:bg-zinc-800/50 rounded-[2rem] p-8 flex items-center justify-between group cursor-not-allowed border border-dashed border-zinc-300 dark:border-zinc-700">
            <div className="flex items-center gap-6">
              <div className="p-4 bg-white dark:bg-zinc-800 rounded-2xl text-zinc-400 shadow-sm">
                <Database className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white uppercase tracking-tight">Arquivamento</h3>
                <p className="text-xs text-zinc-500">Backup automático em nuvem.</p>
              </div>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest bg-zinc-200 dark:bg-zinc-800 px-3 py-1 rounded-full text-zinc-500">Breve</span>
          </div>
        </div>
      </div>
    </div>
  )
}
