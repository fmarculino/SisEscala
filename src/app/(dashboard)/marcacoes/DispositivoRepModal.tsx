'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Loader2, KeyRound } from 'lucide-react'
import { criarDispositivoRep, atualizarDispositivoRep, gerarTokenDispositivoRep } from './actions'
import { TokenRevealBox } from './TokenRevealBox'

interface Opcoes {
  unidades: { id: string; nome: string }[]
  setores: { id: string; unidade_id: string; nome: string }[]
}

interface DispositivoRep {
  id: string
  nome: string
  unidade_id: string
  setor_id: string | null
  numero_serie: string | null
  endereco_ip: string | null
  modo_operacao: string
  ativo: boolean
}

export function DispositivoRepModal({
  isOpen,
  onClose,
  onSaved,
  opcoes,
  dispositivo,
}: {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  opcoes: Opcoes
  dispositivo: DispositivoRep | null
}) {
  const [nome, setNome] = useState(dispositivo?.nome || '')
  const [unidadeId, setUnidadeId] = useState(dispositivo?.unidade_id || '')
  const [setorId, setSetorId] = useState(dispositivo?.setor_id || '')
  const [numeroSerie, setNumeroSerie] = useState(dispositivo?.numero_serie || '')
  const [enderecoIp, setEnderecoIp] = useState(dispositivo?.endereco_ip || '')
  const [modoOperacao, setModoOperacao] = useState(dispositivo?.modo_operacao || 'pull')
  const [ativo, setAtivo] = useState(dispositivo?.ativo ?? true)

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [gerandoToken, setGerandoToken] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [dispositivoId, setDispositivoId] = useState<string | null>(dispositivo?.id || null)

  const setoresDaUnidade = opcoes.setores.filter((s) => s.unidade_id === unidadeId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    setErro(null)

    const formData = new FormData()
    formData.set('nome', nome)
    formData.set('unidade_id', unidadeId)
    formData.set('setor_id', setorId)
    formData.set('numero_serie', numeroSerie)
    formData.set('endereco_ip', enderecoIp)
    formData.set('modo_operacao', modoOperacao)
    formData.set('ativo', String(ativo))

    const resultado = dispositivoId
      ? await atualizarDispositivoRep(dispositivoId, formData)
      : await criarDispositivoRep(formData)

    setSalvando(false)

    if ('error' in resultado && resultado.error) {
      setErro(resultado.error)
      return
    }
    if (!dispositivoId && 'id' in resultado) {
      setDispositivoId(resultado.id)
    }
    onSaved()
  }

  async function handleGerarToken() {
    if (!dispositivoId) return
    setGerandoToken(true)
    setErro(null)
    const resultado = await gerarTokenDispositivoRep(dispositivoId)
    setGerandoToken(false)

    if ('error' in resultado && resultado.error) {
      setErro(resultado.error)
      return
    }
    setToken((resultado as any).token)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={dispositivo ? 'Editar dispositivo REP' : 'Novo dispositivo REP'}
    >
      <div className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Nome</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              placeholder="Ex.: Relógio — Setor de TI"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Unidade</label>
              <select
                value={unidadeId}
                onChange={(e) => { setUnidadeId(e.target.value); setSetorId('') }}
                required
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
              >
                <option value="">Selecione…</option>
                {opcoes.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                Setor <span className="font-normal text-zinc-400">(opcional)</span>
              </label>
              <select
                value={setorId}
                onChange={(e) => setSetorId(e.target.value)}
                disabled={!unidadeId}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Toda a unidade</option>
                {setoresDaUnidade.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Número de série</label>
              <input
                value={numeroSerie}
                onChange={(e) => setNumeroSerie(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Endereço IP</label>
              <input
                value={enderecoIp}
                onChange={(e) => setEnderecoIp(e.target.value)}
                placeholder="10.110.2.89"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Modo de operação</label>
            <select
              value={modoOperacao}
              onChange={(e) => setModoOperacao(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
            >
              <option value="pull">Coletor online (pull)</option>
              <option value="usb">Só pendrive (usb)</option>
              <option value="pull_com_fallback_usb">Online com fallback de pendrive</option>
            </select>
          </div>

          {dispositivo && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              Dispositivo ativo
            </label>
          )}

          {erro && <p className="text-xs text-red-600 font-medium">{erro}</p>}

          <button
            type="submit"
            disabled={salvando}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {dispositivo ? 'Salvar alterações' : 'Criar dispositivo'}
          </button>
        </form>

        {dispositivoId && (
          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Credencial do coletor-rep</p>
            {token ? (
              <TokenRevealBox token={token} />
            ) : (
              <button
                type="button"
                onClick={handleGerarToken}
                disabled={gerandoToken}
                className="w-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {gerandoToken ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Gerar token
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
