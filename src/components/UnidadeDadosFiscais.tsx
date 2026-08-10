'use client'

import { useState } from 'react'
import { Building2, Info } from 'lucide-react'
import { CampoDocumento } from '@/components/CampoDocumento'

interface UnidadeDadosFiscaisProps {
  initialCnpj?: string | null
  initialRazaoSocial?: string | null
  initialResponsavelNome?: string | null
  initialResponsavelCpf?: string | null
  initialResponsavelCargo?: string | null
}

const soDigitos = (v: string) => v.replace(/\D/g, '')

const inputClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm'

const labelClass = 'block text-xs font-semibold text-zinc-700 dark:text-zinc-300'

/**
 * Dados fiscais da unidade e responsavel legal pelo controle de ponto.
 *
 * CNPJ e CPF sao exibidos formatados mas enviados como SOMENTE DIGITOS, via input hidden —
 * as CHECK constraints do banco (chk_unidade_cnpj / chk_unidade_responsavel_cpf) exigem
 * exatamente 14 e 11 digitos.
 *
 * A mascara e o aviso de digito verificador vivem em CampoDocumento, nao aqui: este arquivo
 * tinha copia propria de formatarCpf/formatarCnpj, e havia mais duas copias nos formularios de
 * servidor. Ver src/utils/documentos.ts.
 *
 * ℹ️ Uma nota anterior aqui dizia que `servidores.cpf` "guarda o valor mascarado". Conferido em
 * producao em 09/08/2026: dos 126 CPFs preenchidos, ZERO tem mascara — os dois formularios de
 * servidor tambem so guardam digitos. O problema real medido ali e outro: 4 CPFs com digito
 * verificador invalido.
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
        <CampoDocumento
          className="sm:col-span-2"
          id="cnpj_visivel"
          name="cnpj"
          label="CNPJ"
          tipo="cnpj"
          value={cnpj}
          onChange={setCnpj}
          placeholder="00.000.000/0000-00"
          labelClassName={labelClass}
          inputClassName={inputClass}
        />

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

        <CampoDocumento
          className="sm:col-span-1"
          id="responsavel_cpf_visivel"
          name="responsavel_cpf"
          label="CPF do Responsável"
          tipo="cpf"
          value={responsavelCpf}
          onChange={setResponsavelCpf}
          placeholder="000.000.000-00"
          labelClassName={labelClass}
          inputClassName={inputClass}
        />

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
