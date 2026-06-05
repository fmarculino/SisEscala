'use client'

import { useState, useMemo } from 'react'
import { Save, Layers, Building2, ChevronRight, Info } from 'lucide-react'
import { updateSetor } from '../actions'
import { LogoUploadManager } from '@/components/LogoUploadManager'

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
