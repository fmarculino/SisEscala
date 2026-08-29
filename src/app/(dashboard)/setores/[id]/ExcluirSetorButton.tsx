'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { excluirSetor, listarDependenciasSetor, verificarFusaoSetor, fundirEExcluirSetor } from '../actions'

/**
 * Excluir setor — só aparece para o Administrador Geral.
 *
 * Dois caminhos, e a tela escolhe sozinha qual oferecer:
 *
 *   - setor SEM vínculo nenhum: exclusão direta (`fn_excluir_setor`, 20260827010000);
 *   - setor COM vínculo: transferir tudo para outro setor da mesma unidade e então excluir
 *     (`fn_fundir_setor`, 20260829110000).
 *
 * ⚠️ Não existe "excluir em cascata", e a ausência é deliberada: as FKs que apontam para setores
 * são metade ON DELETE CASCADE e metade SET NULL, então apagar direto apagaria escala e marcação
 * de ponto — prova legal (Portaria 671/2021) — sem avisar ninguém. Transferir move o dono e não
 * perde nada; é a operação que resolve o caso real (setor cadastrado errado, ou duplicado).
 *
 * ⚠️ A lista de vínculos e a de impedimentos vêm do banco e são mostradas como vieram. Não as
 * resuma para "não foi possível": é justamente aí que está o que precisa ser resolvido antes.
 */

interface Dependencia { tabela: string; coluna: string; qtd: number; truncado: boolean }
interface Impedimento { motivo: string; detalhe: string }

/** Nome de tabela → o que aquilo significa para quem está na tela. */
const ROTULOS: Record<string, string> = {
  servidores: 'servidores lotados aqui',
  escala_mensal: 'escalas mensais',
  escala_diaria: 'lançamentos de escala',
  marcacoes_ponto: 'marcações de ponto',
  profile_setores: 'usuários com acesso a este setor',
  dispositivos_rep_setores: 'relógios de ponto que atendem este setor',
  dispositivos_rep: 'relógios de ponto',
  terminais_locais: 'terminais de presença',
  setores: 'subsetores',
  logs_sistema: 'registros de log',
  logs_sobreaviso: 'acionamentos de sobreaviso',
  justificativas_eventos: 'justificativas',
  historico_transferencias: 'histórico de transferências',
  solicitacoes_transferencia_servidor: 'solicitações de transferência',
  solicitacoes_ferias_licencas: 'solicitações de férias/licenças',
  pontos_facultativos: 'pontos facultativos',
}

function descrever(d: Dependencia): string {
  const base = ROTULOS[d.tabela] || `${d.tabela}.${d.coluna}`
  return `${d.qtd}${d.truncado ? '+' : ''} ${base}`
}

export function ExcluirSetorButton({
  setorId,
  setorNome,
  destinos,
}: {
  setorId: string
  setorNome: string
  /** Setores ATIVOS da mesma unidade que podem receber os vínculos (sem o próprio e sem os subsetores dele). */
  destinos: { id: string; nome: string }[]
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dependencias, setDependencias] = useState<Dependencia[] | null>(null)
  const [destinoId, setDestinoId] = useState('')
  const [impedimentos, setImpedimentos] = useState<Impedimento[] | null>(null)
  const [verificando, setVerificando] = useState(false)

  // As dependências são consultadas ao ABRIR: sem isso a tela só descobriria o bloqueio na
  // recusa, e quem clicou não teria o que fazer com a informação.
  useEffect(() => {
    if (!aberto) return
    let cancelado = false
    setCarregando(true)
    listarDependenciasSetor(setorId).then((r) => {
      if (cancelado) return
      if (r?.error) setErro(r.error)
      else setDependencias(r.dependencias || [])
      setCarregando(false)
    })
    return () => { cancelado = true }
  }, [aberto, setorId])

  async function escolherDestino(id: string) {
    setDestinoId(id)
    setImpedimentos(null)
    setErro(null)
    if (!id) return
    setVerificando(true)
    const r = await verificarFusaoSetor(setorId, id)
    setVerificando(false)
    if (r?.error) setErro(r.error)
    else setImpedimentos(r.impedimentos || [])
  }

  async function confirmar() {
    setExcluindo(true)
    setErro(null)

    const temVinculo = (dependencias?.length || 0) > 0
    const resultado = temVinculo
      ? await fundirEExcluirSetor(setorId, destinoId)
      : await excluirSetor(setorId)

    if (resultado?.error) {
      setErro(resultado.error)
      setExcluindo(false)
      return
    }

    // Sem redirect na action de propósito (ela precisa poder devolver o erro), então a volta
    // para a lista é feita aqui.
    router.push('/setores')
    router.refresh()
  }

  const temVinculo = (dependencias?.length || 0) > 0
  const bloqueado = (impedimentos?.length || 0) > 0
  const podeConfirmar =
    !carregando &&
    dependencias !== null &&
    (!temVinculo || (!!destinoId && !bloqueado && !verificando))

  function fechar() {
    if (excluindo) return
    setAberto(false)
    setDependencias(null)
    setDestinoId('')
    setImpedimentos(null)
    setErro(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setErro(null); setAberto(true) }}
        className="inline-flex items-center gap-2 rounded-xl border-2 border-red-200 dark:border-red-900/40 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
      >
        <Trash2 className="h-4 w-4" />
        Excluir Setor
      </button>

      <Modal isOpen={aberto} onClose={fechar} title="Excluir Setor">
        <div className="space-y-5">
          <div className="flex gap-3">
            <AlertTriangle className="h-6 w-6 text-red-500 shrink-0" />
            <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
              <p>
                O setor <strong className="text-zinc-900 dark:text-white">{setorNome}</strong> será
                apagado definitivamente. Esta ação não tem volta.
              </p>
              {carregando && (
                <p className="text-xs text-zinc-500 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Conferindo o que está vinculado…
                </p>
              )}
              {!carregando && dependencias !== null && !temVinculo && (
                <p className="text-xs text-zinc-500">
                  Este setor não tem nenhum vínculo — nenhum servidor lotado, escala, acesso,
                  relógio, terminal ou subsetor. Pode ser excluído direto.
                </p>
              )}
            </div>
          </div>

          {!carregando && temVinculo && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Este setor ainda tem vínculos
                </p>
                <ul className="text-xs text-amber-800 dark:text-amber-200 list-disc pl-4 space-y-0.5">
                  {dependencias!.map((d) => (
                    <li key={`${d.tabela}.${d.coluna}`}>{descrever(d)}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  Nada disso será apagado. Escolha um setor para <strong>receber</strong> esses
                  vínculos — servidores, escalas, ponto e histórico passam para ele, e só então
                  este setor é excluído.
                </p>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-zinc-500 mb-1">
                  Transferir tudo para
                </label>
                <select
                  value={destinoId}
                  onChange={(e) => escolherDestino(e.target.value)}
                  disabled={excluindo}
                  className="w-full rounded-xl border-2 border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 text-sm"
                >
                  <option value="">Selecione o setor de destino…</option>
                  {destinos.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Só setores ativos da mesma unidade. Subsetores deste setor não aparecem — eles
                  vão junto na transferência.
                </p>
              </div>

              {verificando && (
                <p className="text-xs text-zinc-500 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Conferindo se a transferência é possível…
                </p>
              )}

              {bloqueado && (
                <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 p-4 space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                    Não dá para transferir para este setor
                  </p>
                  <ul className="text-xs text-red-700 dark:text-red-300 list-disc pl-4 space-y-1">
                    {impedimentos!.map((i, idx) => <li key={idx}>{i.detalhe}</li>)}
                  </ul>
                </div>
              )}

              {!!destinoId && !bloqueado && !verificando && impedimentos !== null && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✓ Transferência liberada. Nada de escala ou ponto se perde — só muda de setor.
                </p>
              )}
            </div>
          )}

          {erro && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 p-4 text-xs text-red-700 dark:text-red-300 break-words">
              {erro}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={fechar}
              disabled={excluindo}
              className="px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={excluindo || !podeConfirmar}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {excluindo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : temVinculo ? (
                <ArrowRightLeft className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {excluindo
                ? (temVinculo ? 'Transferindo…' : 'Excluindo...')
                : (temVinculo ? 'Transferir e excluir' : 'Excluir definitivamente')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
