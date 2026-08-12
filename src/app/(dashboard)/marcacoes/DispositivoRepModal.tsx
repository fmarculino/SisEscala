'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Loader2, KeyRound, Download, Users } from 'lucide-react'
import { criarDispositivoRep, atualizarDispositivoRep, gerarTokenDispositivoRep, enfileirarCadastrosRep } from './actions'
import { TokenRevealBox } from './TokenRevealBox'
import { baixarAplicativoColetorRep } from './baixarAplicativo'

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
  usuario_rep?: string | null
  porta?: number | null
  usa_https?: boolean | null
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
  const [usuarioRep, setUsuarioRep] = useState(dispositivo?.usuario_rep || 'admin')
  // Senha nunca vem preenchida do servidor (listarDispositivosRep não a devolve de propósito) —
  // em branco ao editar significa "manter a senha já salva", não "sem senha".
  const [senhaRep, setSenhaRep] = useState('')
  const [porta, setPorta] = useState(dispositivo?.porta ?? 443)
  const [usaHttps, setUsaHttps] = useState(dispositivo?.usa_https ?? true)

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [gerandoToken, setGerandoToken] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [dispositivoId, setDispositivoId] = useState<string | null>(dispositivo?.id || null)
  const [baixando, setBaixando] = useState(false)
  const [sincronizandoCadastros, setSincronizandoCadastros] = useState(false)
  const [resultadoCadastros, setResultadoCadastros] = useState<{ enfileirados: number; sem_cpf: number; ja_vinculados: number } | null>(null)

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
    formData.set('usuario_rep', usuarioRep)
    formData.set('senha_rep', senhaRep)
    formData.set('porta', String(porta))
    formData.set('usa_https', String(usaHttps))

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

  async function handleSincronizarCadastros() {
    if (!dispositivoId) return
    setSincronizandoCadastros(true)
    setErro(null)
    setResultadoCadastros(null)
    const resultado = await enfileirarCadastrosRep(dispositivoId)
    setSincronizandoCadastros(false)
    if ('error' in resultado && resultado.error) {
      setErro(resultado.error)
      return
    }
    setResultadoCadastros(resultado as any)
  }

  async function handleBaixarAplicativo() {
    if (!dispositivoId || !token) return
    setBaixando(true)
    setErro(null)
    try {
      await baixarAplicativoColetorRep('dispositivo', dispositivoId, token)
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

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-2 mt-3">
              Credenciais de admin do relógio (para o coletor logar nele)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Usuário</label>
                <input
                  value={usuarioRep}
                  onChange={(e) => setUsuarioRep(e.target.value)}
                  placeholder="admin"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Senha</label>
                <input
                  type="password"
                  value={senhaRep}
                  onChange={(e) => setSenhaRep(e.target.value)}
                  placeholder={dispositivo ? '•••••••• (deixe em branco para manter)' : ''}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">Porta</label>
                <input
                  type="number"
                  value={porta}
                  onChange={(e) => setPorta(Number(e.target.value) || 443)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm self-end pb-2">
                <input type="checkbox" checked={usaHttps} onChange={(e) => setUsaHttps(e.target.checked)} />
                Usa HTTPS
              </label>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Ficam gravadas aqui e embutidas automaticamente no config.yaml a cada "Baixar
              aplicativo" — ninguém mais precisa editar o arquivo à mão.
            </p>
            <p className="text-[11px] text-zinc-400 mt-2">
              💡 <b>Não dá para testar IP/usuário/senha por aqui.</b> O relógio fica na rede
              interna da unidade (ex.: <code>10.x.x.x</code>) — o servidor do SisEscala não
              alcança esse endereço de jeito nenhum, então um botão "Testar" nesta tela sempre
              falharia, mesmo com tudo certo. O teste real precisa rodar numa máquina que esteja
              na mesma rede do relógio: baixe{' '}
              <a href="/api/coletor-rep/download-cli" className="underline font-semibold">coletor-rep-cli.exe</a>{' '}
              nessa máquina e rode <code>coletor-rep-cli diagnostico</code> num Prompt de
              Comando — testa login no relógio e comunicação com o SisEscala, sem gravar nada.
            </p>
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
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              O aplicativo é montado com o que está salvo no banco, não com o que está digitado
              acima na tela. Clique em "Salvar alterações" antes de gerar o token/baixar, se
              mudou endereço, usuário, senha ou porta.
            </p>
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
                  Extraia o .zip inteiro na máquina onde o relógio está acessível e execute o
                  coletor-rep-tray.exe — o config.yaml já sai com endereço, usuário e senha
                  preenchidos com o que foi salvo acima.
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

        {dispositivoId && (
          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Cadastro de servidores no relógio</p>
            <p className="text-[11px] text-zinc-500">
              Prepara matrícula/nome/CPF no relógio para os servidores ativos desta unidade/setor
              que ainda não têm vínculo aqui. A biometria (digital) continua exigindo alguém
              presencial no aparelho — isso só evita digitar tudo na telinha dele.
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              ⚠️ Nunca testado contra relógio real. Antes de usar numa unidade nova, baixe{' '}
              <a href="/api/coletor-rep/download-cli" className="underline font-semibold">
                coletor-rep-cli.exe
              </a>{' '}
              para dentro da mesma pasta onde o app de bandeja já está instalado nessa máquina
              (ao lado do config.yaml existente) e rode <code>coletor-rep-cli cadastros-testar</code> num
              Prompt de Comando — ele cria um usuário de teste isolado e mostra se funcionou.
            </p>
            <button
              type="button"
              onClick={handleSincronizarCadastros}
              disabled={sincronizandoCadastros}
              className="w-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {sincronizandoCadastros ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Sincronizar cadastros
            </button>
            {resultadoCadastros && (
              <p className="text-[11px] text-zinc-500">
                {resultadoCadastros.enfileirados} enfileirado(s) para envio
                {resultadoCadastros.ja_vinculados > 0 && ` · ${resultadoCadastros.ja_vinculados} já vinculado(s)`}
                {resultadoCadastros.sem_cpf > 0 && ` · ${resultadoCadastros.sem_cpf} sem CPF cadastrado (não enviados)`}
                . O aplicativo local aplica no relógio no próximo ciclo.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
