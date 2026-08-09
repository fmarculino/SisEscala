'use client'

import { useState } from 'react'
import { MessageSquare, Info } from 'lucide-react'

/**
 * Habilita (ou não) o aviso de ponto por WhatsApp na unidade, e escolhe quais passos avisam.
 *
 * São DUAS chaves independentes, e as duas precisam estar ligadas para sair mensagem:
 *   - esta, da unidade, ligada pela coordenação;
 *   - o double opt-in do servidor, feito por ele no Portal e confirmado no WhatsApp.
 *
 * Nasce desligada de propósito (`DEFAULT false` na migration 20260809120000): aplicar a migration
 * não envia nada a ninguém. Ligar uma unidade é ato deliberado.
 */

const EVENTOS: { chave: string; rotulo: string; dica: string }[] = [
  { chave: 'entrada', rotulo: 'Entrada', dica: 'Primeira batida do turno' },
  { chave: 'saida', rotulo: 'Saída', dica: 'Última batida do turno' },
  { chave: 'saida_intervalo', rotulo: 'Saída para intervalo', dica: 'Só em unidade que marca intervalo' },
  { chave: 'retorno_intervalo', rotulo: 'Retorno do intervalo', dica: 'Só em unidade que marca intervalo' },
  { chave: 'fora_janela', rotulo: 'Fora do horário previsto', dica: 'A batida que vai para revisão do coordenador' },
]

interface Props {
  initialHabilitado?: boolean | null
  initialEventos?: string[] | null
  permiteMarcaIntervalo?: boolean | null
}

export function UnidadeAvisoPontoSettings({
  initialHabilitado,
  initialEventos,
  permiteMarcaIntervalo,
}: Props) {
  const [habilitado, setHabilitado] = useState<boolean>(!!initialHabilitado)
  const [eventos, setEventos] = useState<string[]>(
    initialEventos && initialEventos.length ? initialEventos : ['entrada', 'saida', 'fora_janela']
  )

  const alternar = (chave: string) =>
    setEventos(prev => (prev.includes(chave) ? prev.filter(e => e !== chave) : [...prev, chave]))

  return (
    <div className="space-y-5 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <input type="hidden" name="aviso_ponto_whatsapp" value={habilitado ? 'true' : 'false'} />
      <input type="hidden" name="aviso_ponto_eventos" value={eventos.join(',')} />

      <div className="flex items-center gap-3">
        <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 rounded-xl">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            Aviso de ponto por WhatsApp
          </h3>
          <p className="text-xs text-zinc-500">
            Envia uma mensagem ao servidor a cada registro no terminal desta unidade.
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

      {habilitado && (
        <div className="space-y-3 p-5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-3xl animate-in fade-in duration-200">
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
            Quais registros geram aviso
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {EVENTOS.map(ev => {
              // Passos de intervalo não existem onde a unidade não marca intervalo — deixá-los
              // marcáveis prometeria uma mensagem que nunca sairia.
              const inaplicavel =
                !permiteMarcaIntervalo &&
                (ev.chave === 'saida_intervalo' || ev.chave === 'retorno_intervalo')

              return (
                <label
                  key={ev.chave}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                    inaplicavel
                      ? 'border-zinc-100 dark:border-zinc-800 opacity-40 cursor-not-allowed'
                      : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 cursor-pointer hover:border-emerald-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={inaplicavel}
                    checked={!inaplicavel && eventos.includes(ev.chave)}
                    onChange={() => alternar(ev.chave)}
                    className="mt-0.5 h-3.5 w-3.5 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">
                      {ev.rotulo}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {inaplicavel ? 'Esta unidade não marca intervalo' : ev.dica}
                    </span>
                  </div>
                </label>
              )
            })}
          </div>

          <div className="flex items-start gap-2 pt-2">
            <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Manter <b>Fora do horário previsto</b> marcado é o mais importante: é a batida que vai
              para revisão, e o servidor fica sem nada na mão se não for avisado. Quanto mais
              eventos marcados, mais mensagens por dia — e mensagem demais vira ruído ignorado.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
