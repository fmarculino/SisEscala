'use client'

import { AlertTriangle } from 'lucide-react'
import { encontrarNomeIdentico, sugerirNomesParecidos } from '@/utils/setores/nomeSetor'

interface AvisoNomeSetorParecidoProps {
  nome: string
  nomesExistentes: string[]
  confirmado: boolean
  onConfirmar: (confirmado: boolean) => void
  onUsarExistente: (nome: string) => void
}

/**
 * Avisa que o nome digitado parece ser um setor que ja existe, e so' deixa seguir depois de uma
 * confirmacao explicita.
 *
 * 🚨 O aviso nasce de um caso real (14/09/2026): `SERVIÇOS GERAIS` e `ASG AGENTE DE SERVIÇOS
 *   GERAIS` conviviam em 27 unidades, e na USF Pedro Cavalcante os DOIS existiam ao mesmo tempo —
 *   entao a arvore de setor de destino da transferencia oferecia os dois, e uma servidora foi
 *   parar sozinha no setor errado. O sistema ja pedia o destino explicitamente; o defeito era a
 *   lista ter duas opcoes onde so uma era valida.
 *
 * ⚠️ NAO avisa quando o nome digitado JA esta no dicionario — nesse caso nao ha entrada nova para
 *   criar, logo nao ha duplicidade a evitar. Sem essa condicao, abrir a tela de edicao de
 *   `CENTRO CIRÚRGICO` (que convive legitimamente com `ENF CENTRO CIRÚRGICO`) mostraria alerta
 *   sem que ninguem tivesse mexido no nome — e aviso que aparece sozinho e' aviso que se aprende
 *   a ignorar. E' a mesma condicao da action, que so' avalia parecidos quando vai CRIAR entrada.
 */
export function AvisoNomeSetorParecido({
  nome,
  nomesExistentes,
  confirmado,
  onConfirmar,
  onUsarExistente,
}: AvisoNomeSetorParecidoProps) {
  const nomeLimpo = (nome || '').trim()
  if (!nomeLimpo) return null

  // Nome que ja existe (mesmo com outra caixa/acento) nao cria entrada nova: nada a avisar.
  if (encontrarNomeIdentico(nomeLimpo, nomesExistentes)) return null

  const parecidos = sugerirNomesParecidos(nomeLimpo, nomesExistentes)
  if (parecidos.length === 0) return null

  return (
    <div className="mt-3 rounded-2xl border-2 border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-tight text-amber-800 dark:text-amber-300">
            {parecidos.length === 1 ? 'Já existe um setor parecido' : 'Já existem setores parecidos'}
          </p>
          <p className="mt-1 text-[11px] font-medium text-amber-800/90 dark:text-amber-200/90">
            Criar <strong>{nomeLimpo.toUpperCase()}</strong> como nome novo deixa os dois valendo ao
            mesmo tempo. Quem for transferir um servidor vai ver as duas opções na lista e pode
            escolher a errada.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {parecidos.map(parecido => (
              <button
                key={parecido.nome}
                type="button"
                onClick={() => onUsarExistente(parecido.nome)}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border-2 border-amber-300 dark:border-amber-700/60 text-[11px] font-black uppercase tracking-tight text-amber-900 dark:text-amber-200 hover:border-amber-500 transition-colors"
                title={
                  parecido.motivo === 'digitacao'
                    ? 'Difere por uma letra — pode ser erro de digitação'
                    : 'Um nome está contido no outro'
                }
              >
                Usar “{parecido.nome}”
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-start gap-2 cursor-pointer">
            {/*
              O input só existe enquanto o aviso está na tela, então a confirmação nunca é enviada
              sem que a lista tenha sido mostrada. Quem apaga o aviso (trocando o nome) leva o
              campo junto.
            */}
            <input
              type="checkbox"
              name="confirmar_nome_novo"
              value="true"
              checked={confirmado}
              onChange={e => onConfirmar(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
              Confirmo que este é outro setor, diferente {parecidos.length === 1 ? 'do listado' : 'dos listados'} acima.
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
