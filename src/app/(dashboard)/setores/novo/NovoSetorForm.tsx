'use client'

import { useState, useMemo } from 'react'
import { Save, Layers, Building2, ChevronRight, Info } from 'lucide-react'
import { createSetor } from '../actions'
import { GeoLocationPicker } from '@/components/GeoLocationPicker'

interface NovoSetorFormProps {
  unidades: any[]
  setoresExistentes: any[]
  dicionario: any[]
}

export default function NovoSetorForm({ unidades, setoresExistentes, dicionario }: NovoSetorFormProps) {
  const [selectedUnidade, setSelectedUnidade] = useState('')
  const [nomeSetor, setNomeSetor] = useState('')
  const [loading, setLoading] = useState(false)

  // Nomes sugeridos para padronização (vindo do dicionário)
  const nomesPadronizados = useMemo(() => {
    return dicionario.map(d => d.nome)
  }, [dicionario])

  // Filtrar setores pai apenas da unidade selecionada
  const setoresPaiDisponiveis = useMemo(() => {
    if (!selectedUnidade) return []
    return setoresExistentes.filter(s => s.unidade_id === selectedUnidade && !s.parent_id)
  }, [selectedUnidade, setoresExistentes])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    try {
      await createSetor(formData)
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
              <option value="">Selecione uma unidade...</option>
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

          {/* Sugestões Visuais Rápidas */}
          {!nomeSetor && nomesPadronizados.length > 0 && (
            <div className="mt-3">
              <p className="text-[9px] font-black uppercase text-zinc-400 mb-2 tracking-widest">Sugestões comuns do dicionário:</p>
              <div className="flex flex-wrap gap-2">
                {nomesPadronizados.slice(0, 8).map(nome => (
                  <button
                    key={nome}
                    type="button"
                    onClick={() => setNomeSetor(nome)}
                    className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 rounded-xl text-[10px] font-bold text-zinc-500 transition-all border border-transparent hover:border-blue-500/30"
                  >
                    {nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-[10px] text-zinc-500 font-bold uppercase tracking-tight flex items-center">
            <Info className="h-3 w-3 mr-1" /> 
            {nomeSetor && !nomesPadronizados.includes(nomeSetor) 
              ? 'Este é um NOVO nome e será adicionado ao dicionário municipal.' 
              : 'Utilize nomes existentes para manter a padronização dos relatórios.'}
          </p>
        </div>

        {/* Setor Pai - Dependente da Unidade */}
        <div className={`transition-all duration-300 ${selectedUnidade ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <label htmlFor="parent_id" className="block text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
            Vincular a um Setor Pai? <span className="text-[10px] font-medium opacity-50 lowercase tracking-normal">(opcional)</span>
          </label>
          <div className="relative group">
            <ChevronRight className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400 group-focus-within:text-blue-500 transition-colors" />
            <select
              id="parent_id"
              name="parent_id"
              className="block w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold appearance-none"
            >
              <option value="">Nenhum (Este é um setor principal)</option>
              {setoresPaiDisponiveis.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>
          {!selectedUnidade ? (
            <p className="mt-2 text-xs text-amber-600 font-bold italic">
              Selecione uma unidade primeiro para ver os setores pais disponíveis.
            </p>
          ) : setoresPaiDisponiveis.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500 italic">
              Nenhum setor principal nesta unidade para servir como pai.
            </p>
          ) : (
            <p className="mt-2 text-[10px] text-blue-600 font-bold uppercase tracking-tight">
              Apenas setores principais da unidade selecionada são exibidos aqui.
            </p>
          )}
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
                  <input type="number" min="0" name="servidores_manha_min" id="servidores_manha_min" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_manha_ideal" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Ideal</label>
                  <input type="number" min="0" name="servidores_manha_ideal" id="servidores_manha_ideal" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_manha_max" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Máximo</label>
                  <input type="number" min="0" name="servidores_manha_max" id="servidores_manha_max" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
              </div>
            </div>

            {/* Tarde */}
            <div className="space-y-4 col-span-1 md:col-span-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">Turno da Tarde</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="servidores_tarde_min" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Mínimo</label>
                  <input type="number" min="0" name="servidores_tarde_min" id="servidores_tarde_min" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_tarde_ideal" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Ideal</label>
                  <input type="number" min="0" name="servidores_tarde_ideal" id="servidores_tarde_ideal" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_tarde_max" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Máximo</label>
                  <input type="number" min="0" name="servidores_tarde_max" id="servidores_tarde_max" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
              </div>
            </div>

            {/* Noite */}
            <div className="space-y-4 col-span-1 md:col-span-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">Turno da Noite</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="servidores_noite_min" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Mínimo</label>
                  <input type="number" min="0" name="servidores_noite_min" id="servidores_noite_min" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_noite_ideal" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Ideal</label>
                  <input type="number" min="0" name="servidores_noite_ideal" id="servidores_noite_ideal" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
                <div>
                  <label htmlFor="servidores_noite_max" className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-1">Máximo</label>
                  <input type="number" min="0" name="servidores_noite_max" id="servidores_noite_max" defaultValue="" className="block w-full px-3 py-2 bg-white dark:bg-zinc-900 border-2 border-zinc-200 border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold" />
                </div>
              </div>
            </div>
          </div>

          {/* Finais de semana e feriados flag */}
          <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50">
            <input 
              type="checkbox" 
              name="dimensionamento_fds_feriados" 
              id="dimensionamento_fds_feriados"
              value="true"
              defaultChecked={true}
              className="h-5 w-5 text-blue-600 rounded border-zinc-300 focus:ring-blue-500"
            />
            <label htmlFor="dimensionamento_fds_feriados" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
              Aplicar regras de dimensionamento nos finais de semana e feriados
            </label>
          </div>
        </div>

        {/* Geolocalização */}
        <GeoLocationPicker />

        {/* Logotipo do Setor */}
        <div>
          <label htmlFor="logo" className="block text-sm font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
            Logotipo do Setor <span className="text-[10px] font-medium opacity-50 lowercase tracking-normal">(opcional)</span>
          </label>
          <div className="relative group">
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/png, image/jpeg, image/svg+xml"
              className="block w-full text-sm text-zinc-500 file:mr-4 file:py-3 file:px-6 file:rounded-2xl file:border-2 file:border-dashed file:border-zinc-200 dark:file:border-zinc-700 file:text-sm file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-zinc-800 dark:file:text-zinc-300 file:transition-all cursor-pointer"
            />
          </div>
          <p className="mt-2 text-[10px] text-zinc-500 font-bold uppercase tracking-tight">
            Recomendado: PNG com fundo transparente. Resolução máxima sugerida: 400x120px (máx. 1MB).
          </p>
        </div>
      </div>

      <div className="pt-6">
        <button
          type="submit"
          disabled={loading || !selectedUnidade}
          className="flex w-full justify-center items-center rounded-2xl bg-blue-600 px-6 py-4 text-sm font-black text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all uppercase tracking-widest disabled:opacity-50 disabled:shadow-none"
        >
          {loading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processando...
            </span>
          ) : (
            <>
              <Save className="mr-2 h-5 w-5" />
              Finalizar Cadastro
            </>
          )}
        </button>
      </div>
    </form>
  )
}
