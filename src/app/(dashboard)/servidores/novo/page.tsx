'use client'

import { createServidor } from '../actions'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Layers, ChevronRight } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { applyAccessFilters } from '@/utils/permissions'

interface Cargo {
  id: string
  nome: string
  parent_id: string | null
  nivel: number
}

export default function NovoServidorPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unidades, setUnidades] = useState<any[]>([])
  const [setores, setSetores] = useState<any[]>([])
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [selectedUnidade, setSelectedUnidade] = useState('')

  // Estados para hierarquia de cargos
  const [nivel1, setNivel1] = useState('')
  const [nivel2, setNivel2] = useState('')
  const [nivel3, setNivel3] = useState('')

  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      
      // 1. Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 2. Fetch profile with permissions
      const { data: profile } = await supabase
        .from('profiles')
        .select('*, profile_unidades(unidade_id), profile_setores(setor_id)')
        .eq('id', user.id)
        .single()

      const userProfile = profile ? {
        ...profile,
        permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
        permitted_setores: profile.profile_setores?.map((ps: any) => ps.setor_id) || []
      } : null

      // 3. Fetch Units with access filter
      let unitsQuery = supabase.from('unidades').select('id, nome').eq('ativo', true).order('nome')
      unitsQuery = applyAccessFilters(unitsQuery, userProfile, { unidadeField: 'id' })
      const { data: units } = await unitsQuery
      if (units) {
        setUnidades(units)
        // Auto-select if only one unit available
        if (units.length === 1) {
          setSelectedUnidade(units[0].id)
        }
      }

      // 4. Fetch Sectors with access filter
      let sectorsQuery = supabase.from('setores').select('id, nome, unidade_id').eq('ativo', true).order('nome')
      sectorsQuery = applyAccessFilters(sectorsQuery, userProfile)
      const { data: sectors } = await sectorsQuery
      if (sectors) setSetores(sectors)

      const { data: roles } = await supabase.from('cargos').select('*').eq('ativo', true).order('nome')
      if (roles) setCargos(roles)
    }
    loadData()
  }, [])

  const filteredSetores = selectedUnidade 
    ? setores.filter(s => s.unidade_id === selectedUnidade)
    : setores

  // Lógica de filtragem de cargos
  const cargosNivel1 = useMemo(() => cargos.filter(c => c.nivel === 1), [cargos])
  const cargosNivel2 = useMemo(() => cargos.filter(c => c.nivel === 2 && c.parent_id === nivel1), [cargos, nivel1])
  const cargosNivel3 = useMemo(() => cargos.filter(c => c.nivel === 3 && c.parent_id === nivel2), [cargos, nivel2])

  // Valor final do cargo para salvar (concatenado)
  const cargoFinal = useMemo(() => {
    const c1 = cargos.find(c => c.id === nivel1)?.nome || ''
    const c2 = cargos.find(c => c.id === nivel2)?.nome || ''
    const c3 = cargos.find(c => c.id === nivel3)?.nome || ''
    
    return [c1, c2, c3].filter(Boolean).join(' / ')
  }, [cargos, nivel1, nivel2, nivel3])

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    // Sobrescrever o campo cargo com o valor hierárquico
    formData.set('cargo', cargoFinal)
    
    const result = await createServidor(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <Link
          href="/servidores"
          className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Novo Servidor</h1>
      </div>

      <form action={handleSubmit} className="space-y-6 bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
          <div className="sm:col-span-4">
            <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nome Completo
            </label>
            <input
              id="nome"
              name="nome"
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="matricula" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Matrícula
            </label>
            <input
              id="matricula"
              name="matricula"
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono"
            />
          </div>

          <div className="sm:col-span-6 space-y-4 pt-2">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-600 dark:text-blue-400">
              <Layers className="h-4 w-4" />
              Hierarquia de Cargo
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase mb-1">Nível 1 (Categoria)</label>
                <select
                  value={nivel1}
                  onChange={(e) => {
                    setNivel1(e.target.value)
                    setNivel2('')
                    setNivel3('')
                  }}
                  required
                  className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500"
                >
                  <option value="">Selecione...</option>
                  {cargosNivel1.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase mb-1">Nível 2 (Especialidade)</label>
                <select
                  value={nivel2}
                  onChange={(e) => {
                    setNivel2(e.target.value)
                    setNivel3('')
                  }}
                  disabled={!nivel1}
                  className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">Selecione...</option>
                  {cargosNivel2.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase mb-1">Nível 3 (Sub-especialidade)</label>
                <select
                  value={nivel3}
                  onChange={(e) => setNivel3(e.target.value)}
                  disabled={!nivel2}
                  className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">Selecione...</option>
                  {cargosNivel3.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>

            {cargoFinal && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30 flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                <span className="font-bold">Cargo Selecionado:</span>
                <span>{cargoFinal}</span>
              </div>
            )}
            <input type="hidden" name="cargo" value={cargoFinal} />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="vinculo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Vínculo
            </label>
            <select
              id="vinculo"
              name="vinculo"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="Efetiva">Efetiva</option>
              <option value="Contratada">Contratada</option>
              <option value="Concursada">Concursada</option>
              <option value="Comissionada">Comissionada</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="unidade_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Unidade
            </label>
            <select
              id="unidade_id"
              name="unidade_id"
              value={selectedUnidade}
              onChange={(e) => setSelectedUnidade(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="">Selecione uma unidade</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-6">
            <label htmlFor="setor_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center">
              <Layers className="h-4 w-4 mr-1 text-blue-500" />
              Setor / Serviço
            </label>
            <select
              id="setor_id"
              name="setor_id"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="">Selecione o setor...</option>
              {filteredSetores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} {!selectedUnidade && `(${unidades.find(u => u.id === s.unidade_id)?.nome})`}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-6 space-y-4 pt-6 border-t border-zinc-100 dark:border-zinc-800">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center">
              <div className="w-1.5 h-4 bg-amber-500 rounded-full mr-2" />
              Portal do Servidor (Consulta de Escala)
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-zinc-500 uppercase">E-mail</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="email@servidor.com"
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
              <div>
                <label htmlFor="telefone" className="block text-xs font-medium text-zinc-500 uppercase">Telefone / WhatsApp</label>
                <input
                  id="telefone"
                  name="telefone"
                  type="text"
                  placeholder="(00) 00000-0000"
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
              <div className="sm:col-span-1">
                <label htmlFor="pin_acesso" className="block text-xs font-medium text-zinc-500 uppercase">PIN de Acesso</label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="pin_acesso"
                    name="pin_acesso"
                    type="text"
                    maxLength={6}
                    placeholder="Ex: 1234"
                    className="block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const pin = Math.floor(1000 + Math.random() * 9000).toString()
                      const input = document.getElementById('pin_acesso') as HTMLInputElement
                      if (input) input.value = pin
                    }}
                    className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-xs font-bold rounded-md hover:bg-zinc-200"
                  >
                    Gerar PIN
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">Este PIN permitirá ao servidor consultar sua escala sem senha.</p>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={loading || !cargoFinal}
            className="inline-flex items-center rounded-md bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-all"
          >
            <Save className="mr-2 h-4 w-4" />
            {loading ? 'Salvando...' : 'Salvar Servidor'}
          </button>
        </div>
      </form>
    </div>
  )
}
