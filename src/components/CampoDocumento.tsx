'use client'

import { useState } from 'react'
import { erroDocumento, formatarDoc, tamanhoDoc, type TipoDoc } from '@/utils/documentos'

/**
 * Campo de CPF / CNPJ / PIS com máscara e aviso de dígito verificador.
 *
 * POR QUE UM COMPONENTE SÓ
 *   A máscara de CPF existia **copiada literalmente** em `servidores/novo/page.tsx` e em
 *   `servidores/[id]/EditServidorForm.tsx`, e havia uma terceira cópia (CPF e CNPJ) em
 *   `UnidadeDadosFiscais.tsx`. Três cópias de uma regra é como a validação some de uma tela só —
 *   o mesmo padrão que deixou a checagem de matrícula duplicada existindo apenas no frontend.
 *
 * AVISA, NÃO BLOQUEIA
 *   O campo nunca impede a digitação nem trava o `submit`. Quem recusa é a server action, e
 *   depois dela o `CHECK` do banco. Aqui o papel é só a pessoa descobrir o erro **antes** de
 *   salvar. Bloquear no cliente daria falsa segurança: importação CSV e chamada direta à action
 *   não passam por este componente.
 *
 * QUANDO O AVISO APARECE
 *   - dígito inválido: assim que o documento fica **completo** — não adianta esperar o blur, a
 *     informação já está disponível e a pessoa ainda está olhando o campo;
 *   - incompleto: só **depois de sair do campo** — avisar "faltam dígitos" enquanto a pessoa
 *     digita o quinto de onze é ruído.
 *
 * VALOR
 *   `value` e `onChange` trafegam **somente dígitos**. A máscara é exibição. Isso importa porque
 *   `servidores.cpf` é a ponte com o identificador do AFD do relógio (`rep_vinculos_servidor`) e
 *   o CHECK de `unidades.cnpj` exige `^[0-9]{14}$`.
 */
interface CampoDocumentoProps {
  id: string
  label: string
  tipo: TipoDoc
  /** Somente dígitos. */
  value: string
  /** Recebe somente dígitos, já limitado ao tamanho do tipo. */
  onChange: (digitos: string) => void
  /**
   * Quando informado, emite um `<input type="hidden">` com esse `name` e os dígitos crus, e o
   * campo visível fica fora do FormData. Use em formulário que lê o FormData direto. Formulário
   * que já faz `formData.set(...)` no submit não precisa.
   */
  name?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  ajuda?: string
  className?: string
  /** Sobrescreve o estilo do rotulo — os formularios de unidade usam um menor que o de servidor. */
  labelClassName?: string
  /** Sobrescreve o estilo do input, exceto a borda (que carrega o estado de erro). */
  inputClassName?: string
}

const LABEL_PADRAO = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300'

const INPUT_PADRAO =
  'mt-1 block w-full rounded-md border bg-zinc-50 px-3 py-2 text-zinc-900 focus:ring-blue-500 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono'

export function CampoDocumento({
  id,
  label,
  tipo,
  value,
  onChange,
  name,
  required = false,
  disabled = false,
  placeholder,
  ajuda,
  className = '',
  labelClassName = LABEL_PADRAO,
  inputClassName = INPUT_PADRAO,
}: CampoDocumentoProps) {
  const [tocado, setTocado] = useState(false)

  const digitos = (value || '').replace(/\D/g, '')
  const completo = digitos.length === tamanhoDoc(tipo)
  const erro = erroDocumento(digitos, tipo)

  // Incompleto só incomoda depois do blur; dígito errado aparece de imediato.
  const mostrarErro = !!erro && (completo || tocado)

  const borda = mostrarErro
    ? 'border-amber-500 dark:border-amber-500'
    : 'border-zinc-300 focus:border-blue-500 dark:border-zinc-700'

  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        value={formatarDoc(digitos, tipo)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, tamanhoDoc(tipo)))}
        onBlur={() => setTocado(true)}
        aria-invalid={mostrarErro || undefined}
        aria-describedby={mostrarErro ? `${id}-erro` : undefined}
        className={`${inputClassName} ${borda} disabled:opacity-60`}
      />
      {name && <input type="hidden" name={name} value={digitos} />}
      {mostrarErro ? (
        <p id={`${id}-erro`} className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {erro}
        </p>
      ) : ajuda ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{ajuda}</p>
      ) : null}
    </div>
  )
}
