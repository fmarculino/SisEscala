'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Avisa que a aba esta rodando uma versao antiga do sistema.
 *
 * 🚨 EXISTE POR UM INCIDENTE REAL (15/09/2026). Uma correcao subiu para producao enquanto o
 *   coordenador estava com a Folha de Ponto aberta ha mais de uma hora. Ele clicou em Gerar, o
 *   servidor gravou certo, e a TELA — ainda com o codigo anterior — continuou dizendo
 *   "Nao Gerada". O relato que chegou foi "o sistema esta quebrado"; o sistema ja estava
 *   corrigido, a aba e que nao sabia. Sem este aviso, toda correcao de tela tem uma janela em
 *   que quem esta com o sistema aberto continua vendo o defeito e reportando de novo.
 *
 *   O mesmo risco ja estava registrado para o terminal de ponto (`/presenca`), que fica dias
 *   aberto. A diferenca esta no que se faz com a informacao — ver abaixo.
 *
 * ⚠️ AQUI NAO SE RECARREGA SOZINHO, E ISSO NAO E TIMIDEZ. O terminal recarrega porque a tela
 *   dele so tem matricula e PIN, e so quando esta ociosa. No dashboard existe grade de escala
 *   nao salva, folha em edicao, formulario de servidor pela metade: recarregar por conta propria
 *   apagaria trabalho de alguem. Avisar e oferecer o botao e o maximo que pode ser feito sem
 *   decidir pelo usuario.
 *
 * `NEXT_PUBLIC_APP_VERSION` e inlinada no bundle no momento do build (next.config.js), entao ela
 * e a versao que ESTA ABERTA; `/api/version` responde a que esta no ar agora. Divergiu, avisa.
 */
export function AvisoVersaoDesatualizada() {
  const [desatualizada, setDesatualizada] = useState<string | null>(null)

  useEffect(() => {
    const versaoCarregada = process.env.NEXT_PUBLIC_APP_VERSION
    if (!versaoCarregada) return

    let vivo = true
    async function conferir() {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const { version } = await r.json()
        if (vivo && version && version !== versaoCarregada) setDesatualizada(version)
      } catch {
        // Rede instavel em unidade nao e evento: sem resposta, nao se afirma nada.
      }
    }

    conferir()
    const id = setInterval(conferir, 5 * 60 * 1000)
    return () => { vivo = false; clearInterval(id) }
  }, [])

  if (!desatualizada) return null

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-amber-950">
      <span className="text-xs font-black uppercase tracking-wider">
        Esta página está desatualizada (versão {process.env.NEXT_PUBLIC_APP_VERSION} — já existe a {desatualizada})
      </span>
      <span className="text-xs font-medium">
        O que você vê aqui pode estar diferente do que o sistema já faz. Atualize antes de concluir que algo falhou.
      </span>
      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-amber-50 transition-all active:scale-95"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Atualizar agora
      </button>
    </div>
  )
}
