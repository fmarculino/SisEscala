'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Save, Loader2, Settings, Clock, Shield, Bell, Database, Zap, Lock, CheckSquare, Calendar, FileText, Image, Unlock } from 'lucide-react'
import { toggleCompetencyClosure } from '@/utils/autoClose'

export default function ConfigPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [configs, setConfigs] = useState<any[]>([])
  const [originalConfigs, setOriginalConfigs] = useState<any[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [lockMonth, setLockMonth] = useState(new Date().getMonth() + 1)
  const [lockYear, setLockYear] = useState(new Date().getFullYear())
  const [togglingLock, setTogglingLock] = useState(false)

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 1 * 1024 * 1024) {
      alert('A imagem deve ter no máximo 1MB.')
      return
    }

    setUploadingImage(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `instituicao_cabecalho.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, file, {
          contentType: file.type,
          upsert: true
        })

      if (uploadError) {
        alert('Erro ao fazer upload: ' + uploadError.message)
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('logos')
        .getPublicUrl(fileName)

      updateConfig('instituicao_cabecalho_url', publicUrl)
    } catch (error: any) {
      alert('Erro ao processar imagem: ' + error.message)
    } finally {
      setUploadingImage(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()
        if (prof) setProfile(prof)
      }
    }
    loadProfile()
  }, [])

  const handleToggleLock = async (mes: number, ano: number, lock: boolean) => {
    setTogglingLock(true)
    const res = await toggleCompetencyClosure(mes, ano, lock)
    setTogglingLock(false)
    if (res.error) {
      alert(res.error)
    } else {
      fetchConfigs()
    }
  }

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
    setConfigs(prev => {
      const exists = prev.some(c => c.chave === chave)
      if (exists) {
        return prev.map(c => c.chave === chave ? { ...c, valor } : c)
      } else {
        return [...prev, { chave, valor }]
      }
    })
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

        {/* Regra de Dimensionamento de Servidores */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex flex-col md:flex-row md:items-center gap-8">
            <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-2xl text-blue-600">
              <Shield className="h-6 w-6" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Regra de Dimensionamento de Turnos</h3>
              <p className="text-sm text-zinc-500 leading-relaxed max-w-2xl">
                Define a rigidez das regras de servidores por turno (mínimo, ideal, máximo) configuradas nos setores.
              </p>
            </div>
            <div className="flex items-center gap-4 bg-zinc-50 dark:bg-zinc-800 p-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 w-full md:w-auto">
              <select 
                className="w-full md:w-64 bg-white dark:bg-zinc-900 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all"
                value={getConfig('escala_regra_dimensionamento')?.valor || 'flexivel'}
                onChange={(e) => updateConfig('escala_regra_dimensionamento', e.target.value)}
              >
                <option value="flexivel">Flexível (Exibe apenas avisos)</option>
                <option value="rigida">Rígida (Bloqueia e força limites)</option>
              </select>
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

        {/* Cabeçalho da Instituição */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-2xl text-blue-600">
                <Image className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Cabeçalho da Instituição</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">Envie a imagem que será utilizada nos cabeçalhos dos relatórios, escalas e folhas de ponto.</p>
              </div>
            </div>

            <div className="space-y-4">
              {getConfig('instituicao_cabecalho_url')?.valor && (
                <div className="flex items-center gap-4 animate-in fade-in">
                  <div className="h-20 w-48 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-hidden bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#3f3f46_1px,transparent_1px)] bg-[size:10px_10px] bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center p-2 shadow-inner">
                    <img 
                      src={getConfig('instituicao_cabecalho_url')?.valor} 
                      alt="Cabeçalho atual" 
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => updateConfig('instituicao_cabecalho_url', '')}
                    className="px-4 py-2 text-xs font-black text-red-600 bg-red-50 dark:bg-red-950/30 rounded-xl hover:bg-red-100 dark:hover:bg-red-950/50 transition-all uppercase tracking-wider"
                  >
                    Remover Imagem
                  </button>
                </div>
              )}

              {!getConfig('instituicao_cabecalho_url')?.valor && (
                <>
                  <div className="relative group max-w-md animate-in fade-in duration-200">
                    <input
                      id="instituicao_cabecalho"
                      type="file"
                      accept="image/png, image/jpeg, image/svg+xml"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                      className="block w-full text-sm text-zinc-500 file:mr-4 file:py-3 file:px-6 file:rounded-2xl file:border-2 file:border-dashed file:border-zinc-200 dark:file:border-zinc-700 file:text-sm file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-zinc-800 dark:file:text-zinc-300 file:transition-all cursor-pointer disabled:opacity-50"
                    />
                    {uploadingImage && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        <span className="text-[10px] font-bold text-zinc-400 uppercase">Processando...</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">
                    Recomendado: PNG com fundo transparente ou SVG. Tamanho máximo: 1MB.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Encerramento de Competência */}
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm hover:shadow-md transition-shadow">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded-2xl text-red-600">
                <Lock className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Encerramento de Competências</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">Gerencie o fechamento definitivo de competências mensais. Uma vez encerradas, as escalas e folhas são congeladas como dados históricos imutáveis.</p>
              </div>
            </div>

            {profile?.role === 'super_admin' ? (
              <div className="space-y-6">
                {/* Formulário para Fechar Nova Competência */}
                <div className="flex flex-wrap items-end gap-6 bg-zinc-50 dark:bg-zinc-800/40 p-6 rounded-2xl border border-zinc-150 dark:border-zinc-700/60">
                  <div className="space-y-2 flex-1 min-w-[150px]">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest block">Mês</label>
                    <select 
                      className="w-full bg-white dark:bg-zinc-900 border border-zinc-250 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-red-500 outline-none font-bold"
                      value={lockMonth}
                      onChange={(e) => setLockMonth(parseInt(e.target.value))}
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>
                          {new Date(2026, m - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2 flex-1 min-w-[120px]">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest block">Ano</label>
                    <select 
                      className="w-full bg-white dark:bg-zinc-900 border border-zinc-250 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-red-500 outline-none font-bold"
                      value={lockYear}
                      onChange={(e) => setLockYear(parseInt(e.target.value))}
                    >
                      {[2025, 2026, 2027, 2028].map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => handleToggleLock(lockMonth, lockYear, true)}
                    disabled={togglingLock}
                    className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider px-6 py-4 rounded-xl transition-all shadow-md shadow-red-500/20 active:scale-95 disabled:opacity-50 min-h-[46px]"
                  >
                    {togglingLock ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Encerrar Competência'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-2xl p-4 text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <Shield className="h-4 w-4 shrink-0" />
                <span>Apenas o Administrador Geral (super_admin) possui permissões para gerenciar e reverter o encerramento de competências.</span>
              </div>
            )}

            {/* Lista de Competências Encerradas */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Competências Encerradas</h4>
              
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-850 rounded-2xl overflow-hidden bg-zinc-50/20 dark:bg-zinc-900/20">
                {(Array.isArray(getConfig('competencias_encerradas')?.valor) ? getConfig('competencias_encerradas')?.valor : []).map((p: any) => (
                  <div key={`${p.mes}-${p.ano}`} className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-all">
                    <div className="flex items-center gap-3">
                      <Lock className="h-4 w-4 text-red-600" />
                      <div>
                        <span className="font-black text-sm text-zinc-900 dark:text-white uppercase tracking-tight">
                          {new Date(p.ano, p.mes - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
                        </span>
                        {p.encerrado_em && (
                          <span className="block text-[10px] text-zinc-400 font-bold uppercase tracking-tight mt-0.5">
                            Encerrado em: {new Date(p.encerrado_em).toLocaleDateString('pt-BR')} às {new Date(p.encerrado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    </div>

                    {profile?.role === 'super_admin' && (
                      <button
                        onClick={() => handleToggleLock(p.mes, p.ano, false)}
                        disabled={togglingLock}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/40 rounded-lg transition-all uppercase tracking-wider disabled:opacity-50"
                      >
                        <Unlock className="h-3 w-3" />
                        Reabrir
                      </button>
                    )}
                  </div>
                ))}

                {(!getConfig('competencias_encerradas')?.valor || getConfig('competencias_encerradas')?.valor.length === 0) && (
                  <div className="p-8 text-center text-zinc-500 text-xs font-bold uppercase tracking-wider">
                    Nenhuma competência encerrada até o momento.
                  </div>
                )}
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
