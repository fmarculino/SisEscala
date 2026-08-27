'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { excluirSetor } from '../actions'

/**
 * Excluir setor — só aparece para o Administrador Geral, e só apaga o que não segura nada.
 *
 * Existe porque setor cadastrado errado não tinha saída: a tela só oferecia Inativar, e o
 * cadastro foi acumulando (225 dos 645 setores não têm vínculo nenhum, medido em 27/08/2026).
 *
 * ⚠️ A mensagem de recusa vem do banco e LISTA os vínculos (tabela e quantidade). Não a resuma
 * para "não foi possível excluir": é justamente ela que diz o que precisa ser transferido antes,
 * e sem isso o Administrador fica tentando de novo sem entender o motivo.
 */
export function ExcluirSetorButton({ setorId, setorNome }: { setorId: string; setorNome: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function confirmar() {
    setExcluindo(true)
    setErro(null)

    const resultado = await excluirSetor(setorId)

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

      <Modal
        isOpen={aberto}
        onClose={() => !excluindo && setAberto(false)}
        title="Excluir Setor"
      >
        <div className="space-y-5">
          <div className="flex gap-3">
            <AlertTriangle className="h-6 w-6 text-red-500 shrink-0" />
            <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
              <p>
                O setor <strong className="text-zinc-900 dark:text-white">{setorNome}</strong> será
                apagado definitivamente. Esta ação não tem volta.
              </p>
              <p className="text-xs text-zinc-500">
                Só é possível excluir setor que não tenha nenhum vínculo — servidor lotado, escala,
                perfil de acesso, dispositivo, terminal ou subsetor. Havendo qualquer um deles, o
                sistema recusa e diz quais são. Para um setor em uso, o caminho é <strong>desativar</strong>,
                que é reversível.
              </p>
            </div>
          </div>

          {erro && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 p-4 text-xs text-red-700 dark:text-red-300 break-words">
              {erro}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              disabled={excluindo}
              className="px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={excluindo}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {excluindo ? 'Excluindo...' : 'Excluir definitivamente'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
