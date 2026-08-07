'use client'

import { useEffect } from 'react'
import { Info } from 'lucide-react'

interface UnidadeIntervalo {
  id: string
  nome?: string
  permite_marca_intervalo?: boolean | null
  tipo_intervalo?: string | null
}

interface IntervaloPersonalizadoFieldsProps {
  unidades: UnidadeIntervalo[]
  unidadeSelecionadaId: string
  intervaloInicio: string
  setIntervaloInicio: (v: string) => void
  intervaloFim: string
  setIntervaloFim: (v: string) => void
  intervaloFlexivel: boolean
  setIntervaloFlexivel: (v: boolean) => void
}

/**
 * Campos de intervalo do servidor (horário personalizado + intervalo flexível).
 *
 * Só fazem sentido quando a unidade de lotação registra intervalo no terminal E opera em
 * modo rígido — o horário personalizado é a exceção dentro do modo rígido, e o "intervalo
 * flexível" existe justamente para liberar o servidor do horário fixo da unidade rígida.
 * Fora disso os campos não têm efeito nenhum na apuração e viram ruído no cadastro.
 *
 * Componente único para os formulários de criação e edição: a regra é a mesma nos dois e
 * duplicá-la abriria espaço para divergência.
 */
export function IntervaloPersonalizadoFields({
  unidades,
  unidadeSelecionadaId,
  intervaloInicio,
  setIntervaloInicio,
  intervaloFim,
  setIntervaloFim,
  intervaloFlexivel,
  setIntervaloFlexivel,
}: IntervaloPersonalizadoFieldsProps) {
  const unidade = unidades?.find((u) => u.id === unidadeSelecionadaId)

  const marcaIntervalo = !!unidade?.permite_marca_intervalo
  const modoRigido = unidade?.tipo_intervalo === 'rigido'
  const aplicavel = !!unidade && marcaIntervalo && modoRigido

  const motivoIndisponivel = !unidade
    ? 'Selecione a unidade de lotação para configurar o intervalo.'
    : !marcaIntervalo
      ? `${unidade.nome || 'Esta unidade'} não registra intervalo no terminal de ponto, então estes campos não afetam a apuração.`
      : !modoRigido
        ? `${unidade.nome || 'Esta unidade'} opera com intervalo flexível — não há horário fixo a definir por servidor.`
        : ''

  // Ao mudar para uma unidade que não usa intervalo, zera o que estava preenchido para não
  // deixar dado inerte gravado no cadastro. Campos desabilitados não vão no FormData, então
  // salvar nesse estado também limpa os valores no banco.
  useEffect(() => {
    if (!aplicavel && (intervaloInicio || intervaloFim || intervaloFlexivel)) {
      setIntervaloInicio('')
      setIntervaloFim('')
      setIntervaloFlexivel(false)
    }
  }, [aplicavel])

  const temHorarioPersonalizado = !intervaloFlexivel && (!!intervaloInicio || !!intervaloFim)

  const inputClass = `mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm ${
    !aplicavel || intervaloFlexivel ? 'opacity-50 cursor-not-allowed' : ''
  }`

  const legendaCampo = !aplicavel
    ? 'Não se aplica a esta unidade'
    : intervaloFlexivel
      ? 'Desative o intervalo flexível para definir'
      : 'Opcional (Modo Rígido)'

  return (
    <>
      {!aplicavel && (
        <div className="sm:col-span-6">
          <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <span>
              <strong className="font-semibold">Intervalo não configurável.</strong> {motivoIndisponivel}
            </span>
          </div>
        </div>
      )}

      <div className="sm:col-span-2">
        <label
          htmlFor="intervalo_inicio_personalizado"
          className={`block text-sm font-medium truncate ${aplicavel ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'}`}
        >
          Intervalo — Início (Pausas)
        </label>
        <input
          type="time"
          id="intervalo_inicio_personalizado"
          name="intervalo_inicio_personalizado"
          value={intervaloInicio}
          onChange={(e) => setIntervaloInicio(e.target.value)}
          disabled={!aplicavel}
          readOnly={intervaloFlexivel}
          tabIndex={!aplicavel || intervaloFlexivel ? -1 : undefined}
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-zinc-500 truncate">{legendaCampo}</p>
      </div>

      <div className="sm:col-span-2">
        <label
          htmlFor="intervalo_fim_personalizado"
          className={`block text-sm font-medium truncate ${aplicavel ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'}`}
        >
          Intervalo — Fim (Pausas)
        </label>
        <input
          type="time"
          id="intervalo_fim_personalizado"
          name="intervalo_fim_personalizado"
          value={intervaloFim}
          onChange={(e) => setIntervaloFim(e.target.value)}
          disabled={!aplicavel}
          readOnly={intervaloFlexivel}
          tabIndex={!aplicavel || intervaloFlexivel ? -1 : undefined}
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-zinc-500 truncate">{legendaCampo}</p>
      </div>

      <div className="sm:col-span-6">
        <label
          className={`flex items-start gap-2 ${
            !aplicavel || temHorarioPersonalizado ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
        >
          <input
            type="checkbox"
            name="intervalo_flexivel"
            value="true"
            checked={intervaloFlexivel}
            disabled={!aplicavel || temHorarioPersonalizado}
            onChange={(e) => {
              setIntervaloFlexivel(e.target.checked)
              if (e.target.checked) {
                setIntervaloInicio('')
                setIntervaloFim('')
              }
            }}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
          />
          <span className={`text-sm ${aplicavel ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'}`}>
            Intervalo flexível
            <span className="block text-[10px] text-zinc-500">
              {!aplicavel
                ? motivoIndisponivel
                : temHorarioPersonalizado
                  ? 'Limpe os horários de Início/Fim acima para habilitar.'
                  : 'Permite gozar o intervalo em qualquer horário, mesmo em unidade de intervalo rígido, desde que cumpra a carga horária. Os horários acima passam a valer apenas como duração prevista: o excedente adia a saída, e o tempo a menos antecipa.'}
            </span>
          </span>
        </label>
      </div>
    </>
  )
}
