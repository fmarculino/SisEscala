'use client'

import { useState } from 'react'
import { MessageSquare, Info, AlertTriangle } from 'lucide-react'

/**
 * Habilita (ou não) o aviso de ponto por WhatsApp na unidade.
 *
 * A unidade decide **se** o recurso está disponível ali. **O que** cada pessoa recebe é decisão
 * dela, no Portal do Servidor — e tem de ser, porque o consentimento é dela.
 *
 * Até 09/08/2026 havia aqui uma lista de "quais registros geram aviso" que respondia a mesma
 * pergunta do modo escolhido pelo servidor, e o filtro da unidade rodava primeiro: quem escolhesse
 * "todas as batidas" recebia só duas se a unidade tivesse desmarcado o intervalo, sem nada
 * explicando. Pior, `fora_janela` estava na lista e podia ser desmarcado, quebrando a única
 * garantia válida em todos os modos. Removida em `20260809160000`.
 *
 * São DUAS chaves independentes, e as duas precisam estar ligadas para sair mensagem:
 *   - esta, da unidade (ou a do setor, que a sobrepõe);
 *   - o double opt-in do servidor, feito por ele no Portal e confirmado no WhatsApp.
 */

interface Props {
  initialHabilitado?: boolean | null
  /** Setores desta unidade com configuração própria — não seguem esta chave. */
  sobreposicoes?: { nome: string; habilitado: boolean }[]
}

export function UnidadeAvisoPontoSettings({ initialHabilitado = true, sobreposicoes = [] }: Props) {
  const [habilitado, setHabilitado] = useState<boolean>(initialHabilitado === null ? false : initialHabilitado ?? true)

  return (
    <div className="space-y-5 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <input type="hidden" name="aviso_ponto_whatsapp" value={habilitado ? 'true' : 'false'} />

      <div className="flex items-center gap-3">
        <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 rounded-xl">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            Aviso de ponto por WhatsApp
          </h3>
          <p className="text-xs text-zinc-500">
            Libera o recurso para os servidores desta unidade.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700">
        <input
          type="checkbox"
          checked={habilitado}
          onChange={e => setHabilitado(e.target.checked)}
          className="mt-1 h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500"
        />
        <div className="space-y-1">
          <span className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight block">
            Habilitar o envio nesta unidade
          </span>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Mesmo habilitado, o servidor <b>só recebe se ele mesmo tiver ativado</b> no Portal do
            Servidor e confirmado pelo WhatsApp. Esta chave não inscreve ninguém.
          </p>
        </div>
      </label>

      {/* Sem este bloco, quem desmarca a chave acima acredita ter desligado tudo — e um setor
          marcado como habilitado continua enviando, porque a precedência é
          COALESCE(setor, unidade, false). */}
      {sobreposicoes.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            <p>
              <b>
                {sobreposicoes.length === 1
                  ? '1 setor desta unidade tem'
                  : `${sobreposicoes.length} setores desta unidade têm`}{' '}
                configuração própria
              </b>{' '}
              e <b>não seguem</b> esta chave:
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {sobreposicoes.map(s => (
                <li key={s.nome}>
                  • {s.nome} — <b>{s.habilitado ? 'habilitado' : 'desabilitado'}</b>
                </li>
              ))}
            </ul>
            <p className="mt-1.5">
              Para alterá-los, use o campo <b>Aviso de ponto por WhatsApp</b> no cadastro de cada
              setor.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 p-4 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 rounded-2xl">
        <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
          <b>A frequência é escolhida por cada servidor</b>, no Portal — resumo semanal, resumo
          diário (padrão), entrada e saída, ou todas as batidas. Registro <b>fora do horário
          previsto</b> avisa sempre, em qualquer opção.
          <br /><br />
          Para liberar só um setor, use o campo <b>Aviso de ponto por WhatsApp</b> no cadastro do
          setor — ele sobrepõe esta chave e permite um piloto sem expor a unidade inteira.
        </p>
      </div>
    </div>
  )
}
