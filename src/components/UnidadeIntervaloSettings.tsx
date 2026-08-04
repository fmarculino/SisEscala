'use client'

import { useState } from 'react'
import { Clock, Info } from 'lucide-react'

interface UnidadeIntervaloSettingsProps {
  initialPermiteIntervalo?: boolean
  initialTipoIntervalo?: 'flexivel' | 'rigido'
  initialToleranciaMinutos?: number
}

export function UnidadeIntervaloSettings({
  initialPermiteIntervalo = false,
  initialTipoIntervalo = 'flexivel',
  initialToleranciaMinutos = 5
}: UnidadeIntervaloSettingsProps) {
  const [permiteIntervalo, setPermiteIntervalo] = useState(initialPermiteIntervalo)
  const [tipoIntervalo, setTipoIntervalo] = useState<'flexivel' | 'rigido'>(initialTipoIntervalo)
  const [toleranciaMinutos, setToleranciaMinutos] = useState(initialToleranciaMinutos)

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="rounded-md bg-blue-100 dark:bg-blue-950 p-2 text-blue-600 dark:text-blue-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
              Controle de Marcação de Intervalo (Pausas)
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Exige que os servidores desta unidade registrem a saída e retorno da pausa.
            </p>
          </div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox"
            name="permite_marca_intervalo_checkbox"
            checked={permiteIntervalo}
            onChange={(e) => setPermiteIntervalo(e.target.checked)}
            className="sr-only peer"
          />
          <input 
            type="hidden" 
            name="permite_marca_intervalo" 
            value={permiteIntervalo ? 'true' : 'false'} 
          />
          <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-zinc-600 peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {permiteIntervalo && (
        <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-4 animate-in fade-in duration-200">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-2">
              Tipo de Intervalo
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${tipoIntervalo === 'flexivel' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-200' : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}>
                <input 
                  type="radio" 
                  name="tipo_intervalo" 
                  value="flexivel"
                  checked={tipoIntervalo === 'flexivel'}
                  onChange={() => setTipoIntervalo('flexivel')}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div className="ml-2">
                  <span className="block text-xs font-bold">Flexível</span>
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    O servidor pode sair a qualquer momento dentro do expediente. O retorno é calculado somando a duração da jornada.
                  </span>
                </div>
              </label>

              <label className={`flex items-start p-3 rounded-lg border cursor-pointer transition-colors ${tipoIntervalo === 'rigido' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-200' : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}>
                <input 
                  type="radio" 
                  name="tipo_intervalo" 
                  value="rigido"
                  checked={tipoIntervalo === 'rigido'}
                  onChange={() => setTipoIntervalo('rigido')}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div className="ml-2">
                  <span className="block text-xs font-bold">Rígido</span>
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    Valida a saída e retorno em horários fixados (servidor $\rightarrow$ jornada $\rightarrow$ padrão).
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="tolerancia_intervalo_minutos" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Tolerância de Intervalo (Minutos)
            </label>
            <div className="mt-1 flex items-center space-x-2">
              <input 
                type="number"
                id="tolerancia_intervalo_minutos"
                name="tolerancia_intervalo_minutos"
                value={toleranciaMinutos}
                onChange={(e) => setToleranciaMinutos(parseInt(e.target.value) || 0)}
                min={0}
                max={60}
                className="w-24 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-blue-500 focus:ring-blue-500"
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">minutos de tolerância</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500 flex items-center gap-1">
              <Info className="h-3 w-3 text-blue-500" />
              {tipoIntervalo === 'flexivel' 
                ? 'No modo flexível, a tolerância se aplica apenas à validação do retorno do intervalo.'
                : 'No modo rígido, a tolerância se aplica tanto à saída quanto ao retorno do intervalo.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
