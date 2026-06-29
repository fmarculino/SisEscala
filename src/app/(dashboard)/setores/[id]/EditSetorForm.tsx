'use client'

import { useState, useMemo } from 'react'
import { Save, Layers, Building2, ChevronRight, Info } from 'lucide-react'
import { updateSetor } from '../actions'
import { LogoUploadManager } from '@/components/LogoUploadManager'
import { GeoLocationPicker } from '@/components/GeoLocationPicker'

interface EditSetorFormProps {
  setor: any
  unidades: any[]
  setoresPai: any[]
  dicionario: any[]
}

export default function EditSetorForm({ setor, unidades, setoresPai, dicionario }: EditSetorFormProps) {
  const [nomeSetor, setNomeSetor] = useState(setor.nome || '')
  const [selectedUnidade, setSelectedUnidade] = useState(setor.unidade_id || '')
  const [loading, setLoading] = useState(false)

  const nomesPadronizados = useMemo(() => {
    return dicionario.map(d => d.nome)
  }, [dicionario])

  const setoresPaiDisponiveis = useMemo(() => {
    if (!selectedUnidade) return []
    return setoresPai.filter(s => s.unidade_id === selectedUnidade || s.id === setor.parent_id)
  }, [selectedUnidade, setoresPai, setor.parent_id])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    try {
      await updateSetor(setor.id, formData)
    } catch (error) {
      console.error(error)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-6">
        {/* Unidade */}
        <div>
          <label htmlFor="unidade_id" className="block text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
            Unidade de Saúde
          </label>
          <div className="relative group">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
            <select
              id="unidade_id"
              name="unidade_id"
              required
              value={selectedUnidade}
              onChange={(e) => setSelectedUnidade(e.target.value)}
              className="block w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold appearance-none"
            >
              {unidades?.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Nome com Sugestões */}
        <div>
          <label htmlFor="nome" className="block text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
            Nome do Setor
          </label>
          <div className="relative group">
            <Layers className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              name="nome"
              id="nome"
              required
              list="nomes-padronizados"
              autoComplete="off"
              value={nomeSetor}
              onChange={(e) => setNomeSetor(e.target.value.toUpperCase())}
              placeholder="Ex: PRONTO SOCORRO, UTI, ADMINISTRATIVO"
              className="block w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold placeholder:font-medium placeholder:italic uppercase"
            />
            <datalist id="nomes-padronizados">
              {nomesPadronizados.map(nome => (
                <option key={nome} value={nome} />
              ))}
            </datalist>

            {nomeSetor && nomesPadronizados.includes(nomeSetor) && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-lg text-[8px] font-black uppercase tracking-tighter">
                  Padronizado
                </span>
              </div>
            )}
          </div>

          <p className="mt-3 text-[10px] text-zinc-500 font-bold uppercase tracking-tight flex items-center">
            <Info className="h-3 w-3 mr-1" /> 
            {nomeSetor && !nomesPadronizados.includes(nomeSetor) 
              ? 'Este é um NOVO nome e será adicionado ao dicionário municipal.' 
              : 'Utilize nomes existentes para manter a padronização dos relatórios.'}
          </p>
        </div>

        {/* Setor Pai */}
        <div>
          <label htmlFor="parent_id" className="block text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
            Vincular a um Setor Pai? <span className="text-[10px] font-medium opacity-50 lowercase tracking-normal">(opcional)</span>
          </label>
          <div className="relative group">
            <ChevronRight className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
            <select
              id="parent_id"
              name="parent_id"
              defaultValue={setor.parent_id || ''}
              className="block w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold appearance-none"
            >
              <option value="">Nenhum (Este é um setor principal)</option>
              {setoresPaiDisponiveis.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dimensionamento por Turno */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 space-y-6">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
              Dimensionamento de Servidores por Turno
            </h3>
            <p className="text-xs text-zinc-500 italic mt-1">
              Configure as quantidades mínimas, ideais e máximas de servidores necessários por turno. Deixe em branco para ignorar validações.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-zinc-50 dark:bg-zinc-800/40 p-6 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50">
            {/* Manhã */}
            <div className="space-y-4 col-span-1 md:col-span-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">Turno da Manhã</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="servidores_manha_min" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Mínimo</label>
                  <input type="number" min="0" name="servidores_manha_min" id="servidores_manha_min" defaultValue={setor.servidores_manha_min ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_manha_ideal" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Ideal</label>
                  <input type="number" min="0" name="servidores_manha_ideal" id="servidores_manha_ideal" defaultValue={setor.servidores_manha_ideal ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_manha_max" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Máximo</label>
                  <input type="number" min="0" name="servidores_manha_max" id="servidores_manha_max" defaultValue={setor.servidores_manha_max ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
              </div>
            </div>

            {/* Tarde */}
            <div className="space-y-4 col-span-1 md:col-span-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">Turno da Tarde</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="servidores_tarde_min" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Mínimo</label>
                  <input type="number" min="0" name="servidores_tarde_min" id="servidores_tarde_min" defaultValue={setor.servidores_tarde_min ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_tarde_ideal" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Ideal</label>
                  <input type="number" min="0" name="servidores_tarde_ideal" id="servidores_tarde_ideal" defaultValue={setor.servidores_tarde_ideal ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_tarde_max" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Máximo</label>
                  <input type="number" min="0" name="servidores_tarde_max" id="servidores_tarde_max" defaultValue={setor.servidores_tarde_max ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
              </div>
            </div>

            {/* Noite */}
            <div className="space-y-4 col-span-1 md:col-span-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">Turno da Noite</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="servidores_noite_min" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Mínimo</label>
                  <input type="number" min="0" name="servidores_noite_min" id="servidores_noite_min" defaultValue={setor.servidores_noite_min ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_noite_ideal" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Ideal</label>
                  <input type="number" min="0" name="servidores_noite_ideal" id="servidores_noite_ideal" defaultValue={setor.servidores_noite_ideal ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_noite_max" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Máximo</label>
                  <input type="number" min="0" name="servidores_noite_max" id="servidores_noite_max" defaultValue={setor.servidores_noite_max ?? ''} className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
              </div>
            </div>
          </div>

          {/* Finais de semana e feriados flag */}
          <div className="flex flex-col gap-4 bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50">
            <div className="flex items-center gap-3">
              <input 
                type="checkbox" 
                name="dimensionamento_fds_feriados" 
                id="dimensionamento_fds_feriados"
                value="true"
                defaultChecked={setor.dimensionamento_fds_feriados !== false}
                className="h-5 w-5 text-blue-600 rounded border-zinc-300 focus:ring-blue-500"
              />
              <label htmlFor="dimensionamento_fds_feriados" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                Aplicar regras de dimensionamento nos finais de semana e feriados
              </label>
            </div>

            <div className="flex items-center gap-3 border-t border-zinc-200/50 dark:border-zinc-800/50 pt-3">
              <input 
                type="checkbox" 
                name="essencial" 
                id="essencial"
                value="true"
                defaultChecked={!!setor.essencial}
                className="h-5 w-5 text-blue-600 rounded border-zinc-300 focus:ring-blue-500"
              />
              <label htmlFor="essencial" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                Setor Essencial (não interrompe atividades em Pontos Facultativos)
              </label>
            </div>
          </div>
        </div>

        {/* Geolocalização */}
        <GeoLocationPicker 
          defaultLat={setor.latitude} 
          defaultLong={setor.longitude} 
          defaultRaio={setor.raio_geofence} 
        />

        {/* Logotipo do Setor */}
        <div>
          <label htmlFor="logo" className="block text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
            Logotipo do Setor <span className="text-[10px] font-medium opacity-50 lowercase tracking-normal">(opcional)</span>
          </label>
          <LogoUploadManager 
            initialLogoUrl={setor.logo_url}
            recommendationText="Recomendado: PNG com fundo transparente. Resolução máxima sugerida: 400x120px (máx. 1MB)."
          />
        </div>
      </div>

      <div className="pt-6">
        <button
          type="submit"
          disabled={loading}
          className="flex w-full justify-center items-center rounded-2xl bg-blue-600 px-6 py-4 text-sm font-black text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all uppercase tracking-widest disabled:opacity-50"
        >
          {loading ? 'Processando...' : (
            <>
              <Save className="mr-2 h-5 w-5" />
              Salvar Alterações
            </>
          )}
        </button>
      </div>
    </form>
  )
}
