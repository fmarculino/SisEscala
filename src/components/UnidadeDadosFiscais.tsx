'use client'

import { useState } from 'react'
import { Building2, Info } from 'lucide-react'

interface UnidadeDadosFiscaisProps {
  initialCnpj?: string | null
  initialRazaoSocial?: string | null
  initialResponsavelNome?: string | null
  initialResponsavelCpf?: string | null
  initialResponsavelCargo?: string | null
}

const soDigitos = (v: string) => v.replace(/\D/g, '')

/** 18478187000107 -> 18.478.187/0001-07 (formata parcialmente enquanto o usuario digita) */
function formatarCnpj(digitos: string) {
  const d = digitos.slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** 12345678910 -> 123.456.789-10 */
function formatarCpf(digitos: string) {
  const d = digitos.slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

const inputClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm'

const labelClass = 'block text-xs font-semibold text-zinc-700 dark:text-zinc-300'

/**
 * Dados fiscais da unidade e responsavel legal pelo controle de ponto.
 *
 * CNPJ e CPF sao exibidos formatados mas enviados como SOMENTE DIGITOS, via input hidden —
 * as CHECK constraints do banco (chk_unidade_cnpj / chk_unidade_responsavel_cpf) exigem
 * exatamente 14 e 11 digitos. Guardar so digitos tambem evita o problema que existe em
 * servidores.cpf, que guarda o valor mascarado e por isso nao casa com o identificador que
 * vem do AFD do relogio de ponto.
 *
 * Componente unico para os formularios de criacao e edicao: duplicar a mascara abriria espaco
 * para divergencia entre as duas telas.
 */
export function UnidadeDadosFiscais({
  initialCnpj = '',
  initialRazaoSocial = '',
  initialResponsavelNome = '',
  initialResponsavelCpf = '',
  initialResponsavelCargo = '',
}: UnidadeDadosFiscaisProps) {
  const [cnpj, setCnpj] = useState(soDigitos(initialCnpj || ''))
  const [responsavelCpf, setResponsavelCpf] = useState(soDigitos(initialResponsavelCpf || ''))

  const cnpjIncompleto = cnpj.length > 0 && cnpj.length < 14
  const cpfIncompleto = responsavelCpf.length > 0 && responsavelCpf.length < 11

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-4">
      <div className="flex items-center space-x-3">
        <div className="rounded-md bg-blue-100 dark:bg-blue-950 p-2 text-blue-600 dark:text-blue-400">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
            Dados Fiscais e Responsável Legal
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Usados no registro do Empregador em relógios de ponto e na emissão de arquivos oficiais.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6 pt-3 border-t border-zinc-200 dark:border-zinc-800">
        <div className="sm:col-span-2">
          <label htmlFor="cnpj_visivel" className={labelClass}>
            CNPJ
          </label>
          <input
            type="text"
            id="cnpj_visivel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="00.000.000/0000-00"
            value={formatarCnpj(cnpj)}
            onChange={(e) => setCnpj(soDigitos(e.target.value).slice(0, 14))}
            className={inputClass}
          />
          <input type="hidden" name="cnpj" value={cnpj} />
          {cnpjIncompleto && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
              CNPJ incompleto — informe os 14 dígitos ou deixe em branco.
            </p>
          )}
        </div>

        <div className="sm:col-span-4">
          <label htmlFor="razao_social" className={labelClass}>
            Razão Social
          </label>
          <input
            type="text"
            id="razao_social"
            name="razao_social"
            defaultValue={initialRazaoSocial || ''}
            placeholder="Deixe em branco para usar o nome da unidade"
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-3">
          <label htmlFor="responsavel_nome" className={labelClass}>
            Responsável pelo Controle de Ponto
          </label>
          <input
            type="text"
            id="responsavel_nome"
            name="responsavel_nome"
            defaultValue={initialResponsavelNome || ''}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-1">
          <label htmlFor="responsavel_cpf_visivel" className={labelClass}>
            CPF do Responsável
          </label>
          <input
            type="text"
            id="responsavel_cpf_visivel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            value={formatarCpf(responsavelCpf)}
            onChange={(e) => setResponsavelCpf(soDigitos(e.target.value).slice(0, 11))}
            className={inputClass}
          />
          <input type="hidden" name="responsavel_cpf" value={responsavelCpf} />
          {cpfIncompleto && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
              CPF incompleto — informe os 11 dígitos ou deixe em branco.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="responsavel_cargo" className={labelClass}>
            Cargo do Responsável
          </label>
          <input
            type="text"
            id="responsavel_cargo"
            name="responsavel_cargo"
            defaultValue={initialResponsavelCargo || ''}
            className={inputClass}
          />
        </div>
      </div>

      <p className="text-[11px] text-zinc-500 flex items-start gap-1">
        <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-500" />
        O CNPJ e o CPF são gravados apenas com dígitos. Campos em branco são aceitos — só se
        tornam obrigatórios quando a unidade passar a usar relógio de ponto.
      </p>
    </div>
  )
}
