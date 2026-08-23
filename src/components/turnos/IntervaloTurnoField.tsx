import { intervaloMinimoLegal } from '@/utils/intervaloIntrajornada'

/**
 * Campo de intervalo intrajornada do turno (`dicionario_turnos.intervalo_minutos`).
 *
 * Vazio = não regulamentado, e aí vale o piso legal derivado da duração
 * (`fn_intervalo_minimo_legal`). É o estado de todos os códigos hoje, de propósito — o número
 * definitivo do plantão depende do regulamento que o Art. 17, §2º da Lei 17.331/2008 (RJU de
 * Marabá) manda existir e que ainda não existe.
 *
 * Preencher aqui só faz sentido para ELEVAR acima do piso: o CLT Art. 71, caput admite até 2h.
 * Um valor abaixo do piso não tem efeito — a resolução passa por `GREATEST` no banco.
 */
export function IntervaloTurnoField({
  horasComputadas,
  defaultValue
}: {
  horasComputadas: number | null | undefined
  defaultValue?: number | null
}) {
  // No cadastro de turno NOVO a carga horária ainda não foi digitada, então o piso é
  // desconhecido — e afirmar "turno de até 6h não tem intervalo" ali seria um palpite.
  const duracaoConhecida = horasComputadas !== null && horasComputadas !== undefined
  const piso = duracaoConhecida ? intervaloMinimoLegal(Number(horasComputadas) * 60) : null

  return (
    <div className="sm:col-span-1">
      <label htmlFor="intervalo_minutos" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Intervalo do Turno (minutos)
      </label>
      <input
        type="number"
        min="0"
        step="5"
        name="intervalo_minutos"
        id="intervalo_minutos"
        defaultValue={defaultValue ?? ''}
        placeholder={piso ? `${piso} (piso legal)` : 'vazio = piso legal'}
        className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
      />
      <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {piso === null ? (
          <>
            Deixe <strong>vazio</strong> para usar o piso legal, que sai da carga horária: acima de
            6h são 60 min (CLT Art. 71, caput); até 6h, nenhum — o turno registra só entrada e
            saída. Preencha só para elevar acima do piso; o caput admite até 120 min.
          </>
        ) : piso > 0 ? (
          <>
            Deixe <strong>vazio</strong> para usar o piso legal de <strong>{piso} min</strong>, que
            vale para todo trabalho contínuo acima de 6h (CLT Art. 71, caput). Preencha só para
            elevar — o caput admite até 120 min. Valor abaixo do piso não tem efeito.
          </>
        ) : (
          <>
            Turno de até 6h <strong>não tem intervalo de ponto</strong>: registra só entrada e
            saída. O que for digitado aqui só passa a valer se a carga horária subir acima de 6h.
          </>
        )}
        {' '}
        Este campo é o intervalo do <strong>turno</strong> e não se confunde com o da jornada do
        servidor, que continua valendo para o expediente Regular.
      </p>
    </div>
  )
}
