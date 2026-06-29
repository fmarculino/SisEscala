'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Plus, Calendar as CalendarIcon, Loader2, Check, X, Info, ShieldAlert, Clock, Layers } from 'lucide-react'

interface Feriado {
  id: string
  data: string
  descricao: string
}

interface Sector {
  id: string
  essencial: boolean
  dicionario_setores: {
    nome: string
  } | null
}

interface PontoFacultativo {
  id: string
  data: string
  descricao: string
  inicio_liberacao_em: string | null
  fim_liberacao_em: string | null
  gera_he_para_essenciais: boolean
  ponto_facultativo_setores?: {
    setor_id: string
    tipo_regra: 'incluido' | 'excluido'
  }[]
}

export default function FeriadosPage() {
  const [activeTab, setActiveTab] = useState<'feriados' | 'pontos_facultativos'>('feriados')
  
  // Feriados State
  const [feriados, setFeriados] = useState<Feriado[]>([])
  const [newData, setNewData] = useState({ data: '', descricao: '' })
  
  // Pontos Facultativos State
  const [pontosFacultativos, setPontosFacultativos] = useState<PontoFacultativo[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [selectedSectorIds, setSelectedSectorIds] = useState<string[]>([])
  const [newPF, setNewPF] = useState({
    data: '',
    descricao: '',
    tipo: 'dia_todo', // 'dia_todo' | 'saida_antecipada' | 'entrada_tardia'
    horario: '', // HH:MM
    gera_he_para_essenciais: false
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const supabase = createClient()

  useEffect(() => {
    fetchInitialData()
  }, [])

  async function fetchInitialData() {
    setLoading(true)
    try {
      await Promise.all([
        fetchFeriados(),
        fetchPontosFacultativos(),
        fetchSectors()
      ])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchFeriados() {
    const { data, error } = await supabase
      .from('feriados')
      .select('*')
      .order('data', { ascending: true })
    
    if (error) throw error
    setFeriados(data || [])
  }

  async function fetchPontosFacultativos() {
    const { data, error } = await supabase
      .from('pontos_facultativos')
      .select('*, ponto_facultativo_setores(setor_id, tipo_regra)')
      .order('data', { ascending: true })
    
    if (error) throw error
    setPontosFacultativos(data || [])
  }

  async function fetchSectors() {
    const { data, error } = await supabase
      .from('setores')
      .select('id, essencial, dicionario_setores(nome)')
      .eq('ativo', true)
    
    if (error) throw error
    
    const formatted: Sector[] = (data || []).map((s: any) => ({
      id: s.id,
      essencial: s.essencial,
      dicionario_setores: Array.isArray(s.dicionario_setores) 
        ? s.dicionario_setores[0] 
        : s.dicionario_setores
    }))
    
    setSectors(formatted)
    
    // Default checked sectors: non-essential sectors
    const defaultSelected = formatted
      .filter(s => !s.essencial)
      .map(s => s.id)
    setSelectedSectorIds(defaultSelected)
  }

  async function handleAddFeriado() {
    if (!newData.data || !newData.descricao) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('feriados')
        .insert(newData)
      
      if (error) throw error
      setNewData({ data: '', descricao: '' })
      await fetchFeriados()
    } catch (error: any) {
      alert('Erro ao adicionar feriado: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddPontoFacultativo() {
    if (!newPF.data || !newPF.descricao) return
    setSaving(true)
    try {
      let inicio_liberacao_em = null
      let fim_liberacao_em = null

      if (newPF.tipo === 'saida_antecipada') {
        inicio_liberacao_em = newPF.horario ? `${newPF.horario}:00` : '12:00:00'
      } else if (newPF.tipo === 'entrada_tardia') {
        fim_liberacao_em = newPF.horario ? `${newPF.horario}:00` : '12:00:00'
      }

      // 1. Insert Ponto Facultativo
      const { data: pfData, error: pfError } = await supabase
        .from('pontos_facultativos')
        .insert({
          data: newPF.data,
          descricao: newPF.descricao,
          inicio_liberacao_em,
          fim_liberacao_em,
          gera_he_para_essenciais: newPF.gera_he_para_essenciais
        })
        .select()
        .single()

      if (pfError) throw pfError

      // 2. Insert exceptions based on deviating selected state
      const rulesToInsert: { ponto_facultativo_id: string; setor_id: string; tipo_regra: 'incluido' | 'excluido' }[] = []
      
      sectors.forEach(sector => {
        const isChecked = selectedSectorIds.includes(sector.id)
        
        if (sector.essencial && isChecked) {
          // Essential sector was explicitly included
          rulesToInsert.push({
            ponto_facultativo_id: pfData.id,
            setor_id: sector.id,
            tipo_regra: 'incluido'
          })
        } else if (!sector.essencial && !isChecked) {
          // Non-essential sector was explicitly excluded
          rulesToInsert.push({
            ponto_facultativo_id: pfData.id,
            setor_id: sector.id,
            tipo_regra: 'excluido'
          })
        }
      })

      if (rulesToInsert.length > 0) {
        const { error: ruleError } = await supabase
          .from('ponto_facultativo_setores')
          .insert(rulesToInsert)
        if (ruleError) throw ruleError
      }

      // Reset form
      setNewPF({
        data: '',
        descricao: '',
        tipo: 'dia_todo',
        horario: '',
        gera_he_para_essenciais: false
      })
      // Reset selected sectors to default non-essentials
      setSelectedSectorIds(sectors.filter(s => !s.essencial).map(s => s.id))
      
      await fetchPontosFacultativos()
    } catch (error: any) {
      alert('Erro ao adicionar ponto facultativo: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleSectorSelection = (id: string) => {
    setSelectedSectorIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">Gestão de Datas Especiais</h1>
        <p className="mt-1 text-zinc-500 text-sm italic">Configuração de Feriados Municipais e Pontos Facultativos.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setActiveTab('feriados')}
          className={`px-6 py-3 text-sm font-black uppercase tracking-wider transition-all border-b-2 ${
            activeTab === 'feriados'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          Feriados
        </button>
        <button
          onClick={() => setActiveTab('pontos_facultativos')}
          className={`px-6 py-3 text-sm font-black uppercase tracking-wider transition-all border-b-2 ${
            activeTab === 'pontos_facultativos'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          Pontos Facultativos
        </button>
      </div>

      {/* Warning Banner */}
      <div className="bg-amber-50 border border-amber-200 dark:bg-amber-900/10 dark:border-amber-800 p-4 rounded-2xl flex gap-3">
        <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          <strong>Atenção:</strong> Por motivos de integridade dos cálculos de escalas passadas, feriados e pontos facultativos <strong>não podem ser excluídos</strong>. 
          Certifique-se de cadastrar a data correta.
        </p>
      </div>

      {activeTab === 'feriados' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Form */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm h-fit">
            <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center text-blue-600">
              <Plus className="mr-2 h-5 w-5" /> Novo Feriado
            </h2>
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Data do Evento</label>
                <input
                  type="date"
                  value={newData.data}
                  onChange={e => setNewData({ ...newData, data: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-zinc-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Descrição / Nome</label>
                <input
                  type="text"
                  placeholder="Ex: Confraternização Universal"
                  value={newData.descricao}
                  onChange={e => setNewData({ ...newData, descricao: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-zinc-900 dark:text-white"
                />
              </div>
              <button
                onClick={handleAddFeriado}
                disabled={saving || !newData.data || !newData.descricao}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-blue-600/20"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Cadastrar Feriado'}
              </button>
            </div>
          </div>

          {/* List */}
          <div className="md:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Data</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {loading ? (
                  <tr>
                    <td colSpan={2} className="px-6 py-20 text-center">
                      <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                    </td>
                  </tr>
                ) : feriados.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-6 py-20 text-center">
                      <CalendarIcon className="h-12 w-12 mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
                      <p className="text-zinc-400 font-bold uppercase text-xs tracking-widest">Nenhum feriado cadastrado</p>
                    </td>
                  </tr>
                ) : (
                  feriados.map(f => (
                    <tr key={f.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center font-black text-zinc-900 dark:text-white uppercase tracking-tighter">
                          <CalendarIcon className="mr-2 h-4 w-4 text-blue-500" />
                          {new Date(f.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                        {f.descricao}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm h-fit space-y-5">
            <h2 className="text-sm font-black uppercase tracking-widest flex items-center text-blue-600">
              <Plus className="mr-2 h-5 w-5" /> Novo Ponto Facultativo
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Data</label>
                <input
                  type="date"
                  value={newPF.data}
                  onChange={e => setNewPF({ ...newPF, data: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-zinc-900 dark:text-white"
                />
              </div>
              
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Descrição</label>
                <input
                  type="text"
                  placeholder="Ex: Jogo da Copa / Véspera de Natal"
                  value={newPF.descricao}
                  onChange={e => setNewPF({ ...newPF, descricao: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-zinc-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Tipo de Liberação</label>
                <select
                  value={newPF.tipo}
                  onChange={e => setNewPF({ ...newPF, tipo: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-zinc-900 dark:text-white"
                >
                  <option value="dia_todo">Dia Inteiro</option>
                  <option value="saida_antecipada">Saída Antecipada (Liberar a partir de...)</option>
                  <option value="entrada_tardia">Entrada Tardia (Expediente começa às...)</option>
                </select>
              </div>

              {newPF.tipo !== 'dia_todo' && (
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Horário de Liberação/Início</label>
                  <input
                    type="time"
                    value={newPF.horario}
                    onChange={e => setNewPF({ ...newPF, horario: e.target.value })}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-zinc-900 dark:text-white"
                  />
                </div>
              )}

              <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <input
                  type="checkbox"
                  id="gera_he_para_essenciais"
                  checked={newPF.gera_he_para_essenciais}
                  onChange={e => setNewPF({ ...newPF, gera_he_para_essenciais: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="gera_he_para_essenciais" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  Gerar HE 100% para essenciais que trabalharem no período liberado
                </label>
              </div>

              {/* Sectors Selection */}
              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1">
                  <Layers className="h-3 w-3 text-zinc-400" /> Setores Afetados
                </label>
                <p className="text-[10px] text-zinc-400 mb-3 italic">Por padrão, os setores marcados como essenciais estão excluídos do ponto facultativo.</p>
                <div className="max-h-48 overflow-y-auto space-y-2 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/20">
                  {sectors.map(sector => (
                    <div key={sector.id} className="flex items-center justify-between text-xs py-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`sector-${sector.id}`}
                          checked={selectedSectorIds.includes(sector.id)}
                          onChange={() => toggleSectorSelection(sector.id)}
                          className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                        />
                        <label htmlFor={`sector-${sector.id}`} className="font-bold text-zinc-700 dark:text-zinc-300">
                          {sector.dicionario_setores?.nome || 'Sem Nome'}
                        </label>
                      </div>
                      {sector.essencial && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                          Essencial
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleAddPontoFacultativo}
                disabled={saving || !newPF.data || !newPF.descricao || (newPF.tipo !== 'dia_todo' && !newPF.horario)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-blue-600/20"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Cadastrar Facultativo'}
              </button>
            </div>
          </div>

          {/* List */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Data</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Descrição</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Configuração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-20 text-center">
                      <Loader2 className="h-10 w-10 animate-spin mx-auto text-blue-500 opacity-50" />
                    </td>
                  </tr>
                ) : pontosFacultativos.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-20 text-center">
                      <CalendarIcon className="h-12 w-12 mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
                      <p className="text-zinc-400 font-bold uppercase text-xs tracking-widest">Nenhum ponto facultativo</p>
                    </td>
                  </tr>
                ) : (
                  pontosFacultativos.map(pf => {
                    let configStr = 'Dia Inteiro'
                    if (pf.inicio_liberacao_em) {
                      configStr = `Saída a partir das ${pf.inicio_liberacao_em.substring(0, 5)}`
                    } else if (pf.fim_liberacao_em) {
                      configStr = `Entrada após as ${pf.fim_liberacao_em.substring(0, 5)}`
                    }
                    
                    return (
                      <tr key={pf.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center font-black text-zinc-900 dark:text-white uppercase tracking-tighter">
                            <Clock className="mr-2 h-4 w-4 text-amber-500" />
                            {new Date(pf.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                          {pf.descricao}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs font-bold text-zinc-500 dark:text-zinc-400">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded-full text-[10px] font-black uppercase text-zinc-600 dark:text-zinc-300">
                                {configStr}
                              </span>
                            </div>
                            {pf.gera_he_para_essenciais && (
                              <div className="flex items-center gap-1 text-[9px] text-amber-600 dark:text-amber-400 uppercase font-black tracking-wider">
                                <ShieldAlert className="h-3 w-3" /> Gera HE 100%
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
