'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  UserPlus, Search, ChevronLeft, ChevronRight, CheckCircle2, Info, Users2, X, Loader2,
} from 'lucide-react'
import { promoverPendenciaRh, buscarConflitoCpf, atualizarCadastroViaPendenciaRh } from '../actions'

interface ConflitoCpf {
  servidor_id: string
  nome: string
  matricula: string | null
  unidade_nome: string | null
  status: string
}

interface PendenteRh {
  id: string
  nome: string
  matricula: string
  classificacao: string | null
  cargo_sugerido: string | null
  unidade_id: string | null
  unidade_nome: string | null
  departamento_origem: string
  vinculo_adicional_de_cpf: boolean
}

interface Unidade { id: string; nome: string }
interface Setor { id: string; unidade_id: string; nome: string }
interface Cargo { id: string; nome: string }

interface ImportacaoRhSectionProps {
  pendentesRh: PendenteRh[]
  erroPendentesRh: string | null
  unidades: Unidade[]
  setores: Setor[]
  cargos: Cargo[]
}

type Filtro = 'todos' | 'com_unidade' | 'sem_unidade' | 'vinculo_adicional'

const PAGE_SIZE = 25

export function ImportacaoRhSection({ pendentesRh, erroPendentesRh, unidades, setores, cargos }: ImportacaoRhSectionProps) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [pagina, setPagina] = useState(1)
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null)
  const [promovidos, setPromovidos] = useState<Set<string>>(new Set())

  const filtrados = useMemo(() => {
    const termo = busca.toLowerCase().trim()
    return pendentesRh
      .filter(p => !promovidos.has(p.id))
      .filter(p => {
        if (filtro === 'com_unidade' && !p.unidade_id) return false
        if (filtro === 'sem_unidade' && p.unidade_id) return false
        if (filtro === 'vinculo_adicional' && !p.vinculo_adicional_de_cpf) return false
        if (!termo) return true
        return (
          p.nome.toLowerCase().includes(termo) ||
          p.matricula.toLowerCase().includes(termo) ||
          p.departamento_origem.toLowerCase().includes(termo)
        )
      })
  }, [pendentesRh, promovidos, filtro, busca])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const visiveis = filtrados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE)

  const semUnidadeCount = pendentesRh.filter(p => !promovidos.has(p.id) && !p.unidade_id).length
  const comUnidadeCount = pendentesRh.filter(p => !promovidos.has(p.id) && p.unidade_id).length
  const vinculoAdicionalCount = pendentesRh.filter(p => !promovidos.has(p.id) && p.vinculo_adicional_de_cpf).length

  function aoPromover(id: string) {
    setPromovidos(prev => new Set(prev).add(id))
    setLinhaAberta(null)
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-blue-500" /> Importados aguardando cadastro
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Vínculos ativos do relatório de RH cujo CPF ainda não está no SisEscala. Complete unidade,
            setor e cargo pra virar cadastro de verdade — nada disso é gravado até você confirmar.
          </p>
        </div>
        {pendentesRh.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={busca}
              onChange={e => { setBusca(e.target.value); setPagina(1) }}
              placeholder="Buscar por nome, matrícula ou departamento..."
              className="pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white w-full sm:w-80"
            />
          </div>
        )}
      </div>

      <div className="p-5">
        {erroPendentesRh ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Não foi possível carregar esta seção ({erroPendentesRh}).</span>
          </div>
        ) : pendentesRh.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 py-6 justify-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nenhum vínculo pendente de importação.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {([
                ['todos', `Todos (${pendentesRh.length - promovidos.size})`],
                ['sem_unidade', `Sem unidade (${semUnidadeCount})`],
                ['com_unidade', `Com unidade resolvida (${comUnidadeCount})`],
                ['vinculo_adicional', `Vínculo adicional (${vinculoAdicionalCount})`],
              ] as [Filtro, string][]).map(([valor, label]) => (
                <button
                  key={valor}
                  onClick={() => { setFiltro(valor); setPagina(1) }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    filtro === valor
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {filtrados.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">Nenhum resultado para esse filtro.</p>
            ) : (
              <div className="space-y-2">
                {visiveis.map(p => (
                  <LinhaPendente
                    key={p.id}
                    pendente={p}
                    aberta={linhaAberta === p.id}
                    onToggle={() => setLinhaAberta(linhaAberta === p.id ? null : p.id)}
                    onPromovido={() => aoPromover(p.id)}
                    unidades={unidades}
                    setores={setores}
                    cargos={cargos}
                  />
                ))}
              </div>
            )}

            {totalPaginas > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Página {paginaAtual} de {totalPaginas} — {filtrados.length} no filtro atual
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPagina(p => Math.max(1, p - 1))}
                    disabled={paginaAtual === 1}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                    disabled={paginaAtual === totalPaginas}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function LinhaPendente({ pendente, aberta, onToggle, onPromovido, unidades, setores, cargos }: {
  pendente: PendenteRh
  aberta: boolean
  onToggle: () => void
  onPromovido: () => void
  unidades: Unidade[]
  setores: Setor[]
  cargos: Cargo[]
}) {
  const cargoInicial = cargos.find(c => c.nome === pendente.cargo_sugerido)?.id || ''

  const [unidadeId, setUnidadeId] = useState(pendente.unidade_id || '')
  const [setorId, setSetorId] = useState('')
  const [cargoId, setCargoId] = useState(cargoInicial)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Conflito de CPF é checado proativamente ao abrir a linha — não mais reativo a um erro de
  // "confirme de novo". undefined = ainda não checou; null = checou, sem conflito.
  const [conflito, setConflito] = useState<ConflitoCpf | null | undefined>(undefined)
  const [checandoConflito, setChecandoConflito] = useState(false)
  const [escolha, setEscolha] = useState<'duplo' | 'atualizar' | null>(null)

  useEffect(() => {
    if (!aberta || conflito !== undefined) return
    setChecandoConflito(true)
    buscarConflitoCpf(pendente.id).then(res => {
      setConflito((res as any)?.conflito ?? null)
      setChecandoConflito(false)
    })
  }, [aberta, conflito, pendente.id])

  const setoresDaUnidade = useMemo(() => setores.filter(s => s.unidade_id === unidadeId), [setores, unidadeId])

  async function handleConfirmarVinculoDuplo() {
    const cargoNome = cargos.find(c => c.id === cargoId)?.nome
    if (!unidadeId || !setorId || !cargoNome) {
      setErro('Unidade, setor e cargo são obrigatórios.')
      return
    }
    setSalvando(true)
    setErro(null)
    const res = await promoverPendenciaRh(pendente.id, unidadeId, setorId, cargoNome, true)
    setSalvando(false)
    if (res?.error) {
      setErro(res.error)
      return
    }
    onPromovido()
  }

  async function handleAtualizarExistente() {
    if (!conflito) return
    setSalvando(true)
    setErro(null)
    const res = await atualizarCadastroViaPendenciaRh(pendente.id, conflito.servidor_id)
    setSalvando(false)
    if (res?.error) {
      setErro(res.error)
      return
    }
    onPromovido()
  }

  async function handleConfirmarNovoCadastro() {
    const cargoNome = cargos.find(c => c.id === cargoId)?.nome
    if (!unidadeId || !setorId || !cargoNome) {
      setErro('Unidade, setor e cargo são obrigatórios.')
      return
    }
    setSalvando(true)
    setErro(null)
    const res = await promoverPendenciaRh(pendente.id, unidadeId, setorId, cargoNome, false)
    setSalvando(false)
    if (res?.error) {
      setErro(res.error)
      return
    }
    onPromovido()
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{pendente.nome}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            matrícula {pendente.matricula} · {pendente.cargo_sugerido || 'cargo não sugerido'} ·{' '}
            {pendente.unidade_nome
              ? <span className="text-emerald-600 dark:text-emerald-400">{pendente.unidade_nome}</span>
              : <span className="text-amber-600 dark:text-amber-400">{pendente.departamento_origem} (sem unidade resolvida)</span>}
            {pendente.vinculo_adicional_de_cpf && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <Users2 className="h-3 w-3" /> vínculo adicional
              </span>
            )}
          </p>
        </div>
        {aberta ? <X className="h-4 w-4 text-zinc-400 shrink-0" /> : <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0">Completar cadastro</span>}
      </button>

      {aberta && (
        <div className="p-4 space-y-4 border-t border-zinc-200 dark:border-zinc-800">
          {checandoConflito && (
            <p className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Conferindo se este CPF já está cadastrado...
            </p>
          )}

          {conflito && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3">
              <p className="text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Já existe um cadastro com este CPF: <b>{conflito.nome}</b> (matrícula{' '}
                  {conflito.matricula || '—'}{conflito.unidade_nome ? `, ${conflito.unidade_nome}` : ''}).
                  O que isto é?
                </span>
              </p>
              <div className="space-y-2 pl-1">
                <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input
                    type="radio"
                    name={`escolha-${pendente.id}`}
                    className="mt-0.5"
                    checked={escolha === 'atualizar'}
                    onChange={() => setEscolha('atualizar')}
                  />
                  <span>
                    <b>É atualização do cadastro existente.</b> Preenche só o que estiver vazio
                    no cadastro de {conflito.nome} — nunca sobrescreve o que já está preenchido,
                    e não mexe em matrícula, unidade, setor nem status.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input
                    type="radio"
                    name={`escolha-${pendente.id}`}
                    className="mt-0.5"
                    checked={escolha === 'duplo'}
                    onChange={() => setEscolha('duplo')}
                  />
                  <span>
                    <b>É um vínculo adicional de verdade.</b> Mesma pessoa, outro cargo/lotação —
                    cria um cadastro novo, separado do existente.
                  </span>
                </label>
              </div>
              {escolha === 'atualizar' && pendente.unidade_nome && conflito.unidade_nome && pendente.unidade_nome !== conflito.unidade_nome && (
                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  O RH indica unidade <b>{pendente.unidade_nome}</b>; o cadastro atual está em{' '}
                  <b>{conflito.unidade_nome}</b> — isso não muda aqui. Se for mesmo mudança de
                  lotação, trate na ficha do servidor (exige aprovação do Administrador Geral).
                </p>
              )}
            </div>
          )}

          {(conflito === null || escolha === 'duplo') && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Unidade</label>
                <select
                  value={unidadeId}
                  onChange={e => { setUnidadeId(e.target.value); setSetorId('') }}
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white"
                >
                  <option value="">Selecione...</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
                {!pendente.unidade_id && (
                  <p className="mt-1 text-[10px] text-zinc-400">
                    Sem match automático. Se a unidade certa não existe, <Link href="/unidades/nova" target="_blank" className="text-blue-600 dark:text-blue-400 underline">crie-a</Link> e volte aqui.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Setor</label>
                <select
                  value={setorId}
                  onChange={e => setSetorId(e.target.value)}
                  disabled={!unidadeId}
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">{unidadeId ? 'Selecione...' : 'Escolha a unidade primeiro'}</option>
                  {setoresDaUnidade.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Cargo</label>
                <select
                  value={cargoId}
                  onChange={e => setCargoId(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white"
                >
                  <option value="">Selecione...</option>
                  {cargos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>
          )}

          {erro && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
              <p className="text-sm text-red-700 dark:text-red-400">{erro}</p>
            </div>
          )}

          <div className="flex justify-end">
            {(() => {
              const semEscolhaAinda = !!conflito && !escolha
              const desabilitado = checandoConflito || salvando || semEscolhaAinda
              const rotulo = checandoConflito
                ? 'Verificando...'
                : semEscolhaAinda
                  ? 'Escolha uma opção acima'
                  : escolha === 'atualizar'
                    ? 'Atualizar cadastro existente'
                    : escolha === 'duplo'
                      ? 'Confirmar cadastro novo (vínculo adicional)'
                      : 'Confirmar cadastro'
              const aoClicar = escolha === 'atualizar' ? handleAtualizarExistente
                : escolha === 'duplo' ? handleConfirmarVinculoDuplo
                : handleConfirmarNovoCadastro
              return (
                <button
                  onClick={aoClicar}
                  disabled={desabilitado}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {rotulo}
                </button>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
