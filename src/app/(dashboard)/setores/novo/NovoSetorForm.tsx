'use client'

import { useState, useMemo } from 'react'
import { Save, Layers, Building2, ChevronRight, Info } from 'lucide-react'
import { createSetor } from '../actions'

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
              value={nomeSetor}
              onChange={(e) => setNomeSetor(e.target.value)}
              placeholder="Ex: Pronto Socorro, UTI, Administrativo"
              className="block w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-2xl text-zinc-900 dark:text-white focus:border-blue-500 focus:ring-0 transition-all font-bold placeholder:font-medium placeholder:italic"
            />
            <datalist id="nomes-padronizados">
              {nomesPadronizados.map(nome => (
                <option key={nome} value={nome} />
              ))}
            </datalist>
          </div>
          {nomesPadronizados.length > 0 && !nomeSetor && (
            <p className="mt-2 text-[10px] text-zinc-500 font-bold uppercase tracking-tight flex items-center">
              <Info className="h-3 w-3 mr-1" /> Digite para ver nomes já usados em outras unidades
            </p>
          )}
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
