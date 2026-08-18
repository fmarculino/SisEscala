'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, UserX, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react'
import { listarDispositivosRep, listarHigieneUsuariosDispositivo, enfileirarRemocaoUsuariosDispositivo } from './actions'

interface UsuarioDispositivo {
  identificador_afd: string
  registration_bruto: string | null
  nome_no_device: string | null
  tem_biometria: boolean
  servidor_id: string | null
  servidor_nome: string | null
  servidor_matricula: string | null
  servidor_status: string | null
  origem_match: 'vinculo' | 'cpf' | null
  fila_status: 'pendente' | null
  pode_remover: boolean
  atualizado_em: string
}

/**
 * Usuários cadastrados no relógio agora (`load_users.fcgi`, reportado pelo coletor via
 * `coletor-rep higiene`) — inclui quem sobrou de um sistema anterior ao SisEscala, que o
 * equipamento pode ter usado antes. Não aciona o relógio direto: o servidor do SisEscala não tem
 * caminho até a rede da unidade (CLAUDE.md) — isto só lê o último snapshot reportado e enfileira
 * a intenção de remover; quem aplica de verdade é `coletor-rep higiene-remover`.
 */
export function HigieneDispositivoTab() {
  const [dispositivos, setDispositivos] = useState<any[]>([])
  const [dispositivoId, setDispositivoId] = useState<string>('')
  const [usuarios, setUsuarios] = useState<UsuarioDispositivo[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    listarDispositivosRep()
      .then((lista: any[]) => {
        setDispositivos(lista)
        if (lista.length > 0) setDispositivoId(lista[0].id)
        else setCarregando(false)
      })
      .catch((e: any) => { setErro(e.message); setCarregando(false) })
  }, [])

  async function recarregar() {
    if (!dispositivoId) return
    setCarregando(true)
    setErro(null)
    setSelecionados(new Set())
    try {
      setUsuarios(await listarHigieneUsuariosDispositivo(dispositivoId))
    } catch (e: any) {
      setErro(e.message || 'Falha ao carregar cadastros do relógio.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { recarregar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dispositivoId])

  function alternarSelecao(identificador: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (novo.has(identificador)) novo.delete(identificador)
      else novo.add(identificador)
      return novo
    })
  }

  // Só entra aqui quem a própria tela deixaria clicar um a um — servidor ativo vinculado e quem
  // já está na fila continuam de fora do "selecionar todos". A regra de verdade é do banco
  // (fn_enfileirar_remocao_usuarios_dispositivo recusa vínculo vigente); isto é só a UI.
  const removiveis = usuarios.filter((u) => u.pode_remover && u.fila_status !== 'pendente')
  const todosSelecionados = removiveis.length > 0 && removiveis.every((u) => selecionados.has(u.identificador_afd))

  function alternarTodos() {
    setSelecionados(todosSelecionados ? new Set() : new Set(removiveis.map((u) => u.identificador_afd)))
  }

  async function handleMarcarParaRemocao() {
    if (selecionados.size === 0) return
    if (!confirm(
      `Marcar ${selecionados.size} cadastro(s) para remoção do relógio? ` +
      `Os cadastros marcados serão removidos automaticamente pelo aplicativo coletor no próximo ciclo de sincronização (ou via menu da bandeja).`
    )) return

    setProcessando(true)
    setErro(null)
    setAviso(null)
    const res = await enfileirarRemocaoUsuariosDispositivo(dispositivoId, Array.from(selecionados))
    setProcessando(false)
    if ('error' in res && res.error) { setErro(res.error); return }
    if (!('enfileirados' in res)) return

    setAviso(
      `${res.enfileirados} cadastro(s) marcado(s) para remoção. ` +
      (res.bloqueados_por_vinculo_ativo > 0
        ? `${res.bloqueados_por_vinculo_ativo} não foram porque correspondem a um servidor ativo. `
        : '') +
      `O aplicativo coletor na unidade executará a remoção física no relógio automaticamente no próximo ciclo.`
    )
    recarregar()
  }

  const dispositivoAtual = dispositivos.find((d) => d.id === dispositivoId)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={dispositivoId}
            onChange={(e) => setDispositivoId(e.target.value)}
            className="text-sm font-bold px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
          >
            {dispositivos.map((d) => (
              <option key={d.id} value={d.id}>{d.nome}</option>
            ))}
          </select>
          <button onClick={recarregar} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500" title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        {selecionados.size > 0 && (
          <button
            onClick={handleMarcarParaRemocao}
            disabled={processando}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold"
          >
            <UserX className="h-4 w-4" /> Marcar {selecionados.size} para remoção
          </button>
        )}
      </div>

      <p className="text-sm text-zinc-500">
        Quem está cadastrado neste relógio agora, conforme o último snapshot reportado pelo
        coletor. Relógios reaproveitados de outro sistema costumam ter gente que já não faz parte
        do quadro — só é possível selecionar para remoção quem não corresponde a nenhum servidor
        ativo do SisEscala.
      </p>

      {erro && <p className="text-xs text-red-600 font-medium">{erro}</p>}
      {aviso && <p className="text-xs text-emerald-600 font-medium">{aviso}</p>}

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : !dispositivoAtual ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhum dispositivo REP cadastrado.</p>
      ) : usuarios.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">
          Nenhum snapshot ainda. Rode <code className="font-mono">coletor-rep higiene</code> (ou
          "Atualizar lista de cadastros do relógio" no menu da bandeja) na máquina desta unidade.
        </p>
      ) : (
        <div className="space-y-2">
          {removiveis.length > 0 && (
            <label className="flex items-center gap-3 px-3 py-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={todosSelecionados}
                ref={(el) => {
                  if (el) el.indeterminate = !todosSelecionados && selecionados.size > 0
                }}
                onChange={alternarTodos}
                className="h-4 w-4"
              />
              <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                {todosSelecionados ? 'Desmarcar todos' : `Selecionar todos os ${removiveis.length} removíveis`}
              </span>
              <span className="text-[11px] text-zinc-400">
                não inclui quem está vinculado a servidor ativo nem quem já está na fila
              </span>
            </label>
          )}
          {usuarios.map((u) => {
            const vinculadoAtivo = u.servidor_id && u.servidor_status === 'Ativo'
            const pendenteRemocao = u.fila_status === 'pendente'
            const selecionavel = u.pode_remover && !pendenteRemocao
            return (
              <div
                key={u.identificador_afd}
                className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              >
                {selecionavel ? (
                  <input
                    type="checkbox"
                    checked={selecionados.has(u.identificador_afd)}
                    onChange={() => alternarSelecao(u.identificador_afd)}
                    className="h-4 w-4"
                  />
                ) : (
                  <div className="w-4" />
                )}

                {vinculadoAtivo ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : pendenteRemocao ? (
                  <Clock3 className="h-4 w-4 text-zinc-400 shrink-0" />
                ) : u.origem_match === 'cpf' ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                ) : (
                  <UserX className="h-4 w-4 text-red-500 shrink-0" />
                )}

                <div className="flex-1">
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">
                    {u.nome_no_device || '(sem nome)'}{' '}
                    <span className="text-zinc-400 font-normal">
                      {u.registration_bruto ? `· cadastro ${u.registration_bruto}` : ''}
                    </span>
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {vinculadoAtivo
                      ? `Vinculado a ${u.servidor_nome} (${u.servidor_matricula})`
                      : pendenteRemocao
                      ? 'Marcado para remoção — aguardando o coletor aplicar no relógio'
                      : u.origem_match === 'cpf'
                      ? `CPF corresponde a ${u.servidor_nome}, mas ainda sem vínculo confirmado — não remova, vincule pela Fase 7`
                      : 'Sem correspondência com nenhum servidor ativo do SisEscala'}
                    {u.tem_biometria ? ' · com biometria' : ''}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
