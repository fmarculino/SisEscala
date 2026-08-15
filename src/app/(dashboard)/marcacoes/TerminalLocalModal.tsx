'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Loader2, KeyRound, Download } from 'lucide-react'
import { criarTerminalLocal, atualizarTerminalLocal, gerarTokenTerminalLocal } from './actions'
import { TokenRevealBox } from './TokenRevealBox'
import { baixarAplicativoColetorRep } from './baixarAplicativo'

interface Opcoes {
  unidades: { id: string; nome: string }[]
  setores: { id: string; unidade_id: string | null; nome: string }[]
  coordenadores: { id: string; full_name: string; role: string }[]
}

interface TerminalLocal {
  id: string
  nome: string
  unidade_id: string
  setor_id: string | null
  responsavel_coordenador_id: string
  ativo: boolean
}

export function TerminalLocalModal({
  isOpen,
  onClose,
  onSaved,
  opcoes,
  terminal,
}: {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  opcoes: Opcoes
  terminal: TerminalLocal | null
}) {
  const [nome, setNome] = useState(terminal?.nome || '')
  const [unidadeId, setUnidadeId] = useState(terminal?.unidade_id || '')
  const [setorId, setSetorId] = useState(terminal?.setor_id || '')
  const [responsavelId, setResponsavelId] = useState(terminal?.responsavel_coordenador_id || '')
  const [ativo, setAtivo] = useState(terminal?.ativo ?? true)

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [gerandoToken, setGerandoToken] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(terminal?.id || null)
  const [baixando, setBaixando] = useState(false)

  const setoresDaUnidade = opcoes.setores.filter((s) => s.unidade_id === unidadeId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    setErro(null)

    const formData = new FormData()
    formData.set('nome', nome)
    formData.set('unidade_id', unidadeId)
    formData.set('setor_id', setorId)
    formData.set('responsavel_coordenador_id', responsavelId)
    formData.set('ativo', String(ativo))

    const resultado = terminalId
      ? await atualizarTerminalLocal(terminalId, formData)
      : await criarTerminalLocal(formData)

    setSalvando(false)

    if ('error' in resultado && resultado.error) {
      setErro(resultado.error)
      return
    }

    if (!terminalId && 'id' in resultado) {
      setTerminalId(resultado.id)
    }
    onSaved()
  }

  async function handleGerarToken() {
    if (!terminalId) return
    setGerandoToken(true)
    setErro(null)
    const resultado = await gerarTokenTerminalLocal(terminalId)
    setGerandoToken(false)

    if ('error' in resultado && resultado.error) {
      setErro(resultado.error)
      return
    }
    setToken((resultado as any).token)
  }

  async function handleBaixarAplicativo() {
    if (!terminalId || !token) return
    setBaixando(true)
    setErro(null)
    try {
      await baixarAplicativoColetorRep('terminal', terminalId, token)
    } catch (e: any) {
      setErro(e.message || 'Falha ao baixar o aplicativo.')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={terminal ? 'Editar terminal local' : 'Novo terminal local'}
    >
      <div className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Nome</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              placeholder="Ex.: Recepção — Térreo"
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
                <option value="">Qualquer setor da unidade</option>
                {setoresDaUnidade.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
              Coordenador responsável
            </label>
            <select
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
            >
              <option value="">Selecione…</option>
              {opcoes.coordenadores.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">
              Registrado como supervisor de toda marcação feita neste terminal — não é uma sessão ao
              vivo, é identificação de responsabilidade.
            </p>
          </div>

          {terminal && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              Terminal ativo
              <span className="text-[11px] text-zinc-500">
                (desativar derruba a sessão do navegador na marcação seguinte)
              </span>
            </label>
          )}

          {erro && <p className="text-xs text-red-600 font-medium">{erro}</p>}

          <button
            type="submit"
            disabled={salvando}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {terminal ? 'Salvar alterações' : 'Criar terminal'}
          </button>
        </form>

        {terminalId && (
          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Credencial do aplicativo local</p>
            {token ? (
              <>
                <TokenRevealBox token={token} />
                <button
                  type="button"
                  onClick={handleBaixarAplicativo}
                  disabled={baixando}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Baixar aplicativo (já configurado)
                </button>
                <p className="text-[11px] text-zinc-500">
                  Extraia o .zip inteiro na máquina do terminal e execute o
                  coletor-rep-tray.exe — ele mesmo se instala e ativa a tela de presença.
                </p>
              </>
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
