'use client'

import { useState } from 'react'
import { User, Home, FileText, Calendar, MapPin, Search, Loader2 } from 'lucide-react'

interface DadosComplementaresSectionProps {
  servidor?: any
}

export function DadosComplementaresSection({ servidor }: DadosComplementaresSectionProps) {
  // Controlled states for masked/auto-filled fields
  const [cep, setCep] = useState(servidor?.cep || '')
  const [logradouro, setLogradouro] = useState(servidor?.endereco_logradouro || '')
  const [bairro, setBairro] = useState(servidor?.bairro || '')
  const [municipio, setMunicipio] = useState(servidor?.municipio_residencia || 'Marabá - PA')
  const [telefoneResidencial, setTelefoneResidencial] = useState(servidor?.telefone_residencial || '')
  const [pisPasep, setPisPasep] = useState(servidor?.pis_pasep || '')
  const [estadoCivil, setEstadoCivil] = useState(servidor?.estado_civil || 'Solteiro(a)')
  const [loadingCep, setLoadingCep] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)

  // Máscara CEP 00000-000 com auto-busca ViaCEP
  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    let formatted = raw
    if (raw.length > 5) {
      formatted = `${raw.slice(0, 5)}-${raw.slice(5, 8)}`
    }
    setCep(formatted)
    setCepError(null)

    if (raw.length === 8) {
      setLoadingCep(true)
      try {
        const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`)
        const data = await res.json()
        if (data.erro) {
          setCepError('CEP não encontrado')
        } else {
          if (data.logradouro) setLogradouro(data.logradouro)
          if (data.bairro) setBairro(data.bairro)
          if (data.localidade && data.uf) setMunicipio(`${data.localidade} - ${data.uf}`)
        }
      } catch (err) {
        setCepError('Erro ao consultar CEP')
      } finally {
        setLoadingCep(false)
      }
    }
  }

  // Máscara Telefone Residencial (00) 0000-0000
  const handleTelefoneResidencialChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/\D/g, '')
    if (v.length > 10) v = v.slice(0, 10)
    if (v.length > 6) {
      v = v.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
    } else if (v.length > 2) {
      v = v.replace(/^(\d{2})(\d{0,4})/, '($1) $2')
    } else if (v.length > 0) {
      v = `(${v}`
    }
    setTelefoneResidencial(v)
  }

  // Máscara PIS/PASEP 000.00000.00-0
  const handlePisPasepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/\D/g, '')
    if (v.length > 11) v = v.slice(0, 11)
    if (v.length > 10) {
      v = v.replace(/^(\d{3})(\d{5})(\d{2})(\d{1})/, '$1.$2.$3-$4')
    } else if (v.length > 8) {
      v = v.replace(/^(\d{3})(\d{5})(\d{0,2})/, '$1.$2.$3')
    } else if (v.length > 3) {
      v = v.replace(/^(\d{3})(\d{0,5})/, '$1.$2')
    }
    setPisPasep(v)
  }

  return (
    <div className="space-y-8 animate-in fade-in">
      {/* 1. Dados Pessoais & Filiação */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800 text-sm font-bold text-blue-600 dark:text-blue-400">
          <User className="h-4 w-4" />
          <span>1. Dados Pessoais & Filiação</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label htmlFor="data_nascimento" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Data de Nascimento
            </label>
            <input
              type="date"
              id="data_nascimento"
              name="data_nascimento"
              defaultValue={servidor?.data_nascimento || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="sexo" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Sexo
            </label>
            <select
              id="sexo"
              name="sexo"
              defaultValue={servidor?.sexo || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="">Selecione...</option>
              <option value="Masculino">Masculino</option>
              <option value="Feminino">Feminino</option>
              <option value="Outro">Outro</option>
              <option value="Não informado">Não informado</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="nacionalidade" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Nacionalidade
            </label>
            <input
              type="text"
              id="nacionalidade"
              name="nacionalidade"
              defaultValue={servidor?.nacionalidade || 'Brasileira'}
              placeholder="ex: Brasileira"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="naturalidade" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Naturalidade (Município / UF)
            </label>
            <input
              type="text"
              id="naturalidade"
              name="naturalidade"
              defaultValue={servidor?.naturalidade || ''}
              placeholder="ex: Marabá - PA"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="escolaridade" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Escolaridade
            </label>
            <select
              id="escolaridade"
              name="escolaridade"
              defaultValue={servidor?.escolaridade || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="">Selecione...</option>
              <option value="Ensino Fundamental Incompleto">Ensino Fundamental Incompleto</option>
              <option value="Ensino Fundamental Completo">Ensino Fundamental Completo</option>
              <option value="Ensino Médio Incompleto">Ensino Médio Incompleto</option>
              <option value="Ensino Médio Completo">Ensino Médio Completo</option>
              <option value="Ensino Superior Incompleto">Ensino Superior Incompleto</option>
              <option value="Ensino Superior Completo">Ensino Superior Completo</option>
              <option value="Pós-Graduação / Especialização">Pós-Graduação / Especialização</option>
              <option value="Mestrado">Mestrado</option>
              <option value="Doutorado">Doutorado</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="nome_mae" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Nome da Mãe
            </label>
            <input
              type="text"
              id="nome_mae"
              name="nome_mae"
              defaultValue={servidor?.nome_mae || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="nome_pai" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Nome do Pai
            </label>
            <input
              type="text"
              id="nome_pai"
              name="nome_pai"
              defaultValue={servidor?.nome_pai || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="estado_civil" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Estado Civil
            </label>
            <select
              id="estado_civil"
              name="estado_civil"
              value={estadoCivil}
              onChange={(e) => setEstadoCivil(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            >
              <option value="Solteiro(a)">Solteiro(a)</option>
              <option value="Casado(a)">Casado(a)</option>
              <option value="Divorciado(a)">Divorciado(a)</option>
              <option value="Viúvo(a)">Viúvo(a)</option>
              <option value="União Estável">União Estável</option>
              <option value="Outro">Outro</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="nome_conjuge" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Nome do Cônjuge
            </label>
            <input
              type="text"
              id="nome_conjuge"
              name="nome_conjuge"
              defaultValue={servidor?.nome_conjuge || ''}
              disabled={estadoCivil !== 'Casado(a)' && estadoCivil !== 'União Estável'}
              placeholder={estadoCivil === 'Casado(a)' || estadoCivil === 'União Estável' ? 'Nome do cônjuge' : 'Não aplicável'}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm disabled:opacity-50 disabled:bg-zinc-100 dark:disabled:bg-zinc-900"
            />
          </div>
        </div>
      </div>

      {/* 2. Endereço & Contato Residencial */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800 text-sm font-bold text-blue-600 dark:text-blue-400">
          <Home className="h-4 w-4" />
          <span>2. Endereço & Contato Residencial</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label htmlFor="cep" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              CEP (Busca Automática)
            </label>
            <div className="relative mt-1">
              <input
                type="text"
                id="cep"
                name="cep"
                value={cep}
                onChange={handleCepChange}
                placeholder="00000-000"
                className="block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 pr-9 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-zinc-400">
                {loadingCep ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </div>
            </div>
            {cepError && (
              <p className="mt-1 text-[10px] text-red-500 font-medium">{cepError}</p>
            )}
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="endereco_logradouro" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Endereço (Rua / Avenida)
            </label>
            <input
              type="text"
              id="endereco_logradouro"
              name="endereco_logradouro"
              value={logradouro}
              onChange={(e) => setLogradouro(e.target.value)}
              placeholder="ex: Av. VP-8, Folha 28"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-1">
            <label htmlFor="endereco_numero" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Número
            </label>
            <input
              type="text"
              id="endereco_numero"
              name="endereco_numero"
              defaultValue={servidor?.endereco_numero || ''}
              placeholder="Nº / S/N"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="bairro" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Bairro
            </label>
            <input
              type="text"
              id="bairro"
              name="bairro"
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              placeholder="ex: Nova Marabá"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="municipio_residencia" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Município de Residência
            </label>
            <input
              type="text"
              id="municipio_residencia"
              name="municipio_residencia"
              value={municipio}
              onChange={(e) => setMunicipio(e.target.value)}
              placeholder="ex: Marabá - PA"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="telefone_residencial" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Telefone Residencial
            </label>
            <input
              type="text"
              id="telefone_residencial"
              name="telefone_residencial"
              value={telefoneResidencial}
              onChange={handleTelefoneResidencialChange}
              placeholder="(94) 3321-0000"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* 3. Documentação & Registro Profissional */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800 text-sm font-bold text-blue-600 dark:text-blue-400">
          <FileText className="h-4 w-4" />
          <span>3. Documentação & Registro Profissional</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label htmlFor="rg_numero" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              RG (Número)
            </label>
            <input
              type="text"
              id="rg_numero"
              name="rg_numero"
              defaultValue={servidor?.rg_numero || ''}
              placeholder="Nº do RG"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="rg_orgao_emissor" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Órgão Emissor (RG)
            </label>
            <input
              type="text"
              id="rg_orgao_emissor"
              name="rg_orgao_emissor"
              defaultValue={servidor?.rg_orgao_emissor || ''}
              placeholder="ex: SEGUP/PA"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm uppercase"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="rg_data_emissao" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Data de Emissão (RG)
            </label>
            <input
              type="date"
              id="rg_data_emissao"
              name="rg_data_emissao"
              defaultValue={servidor?.rg_data_emissao || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="pis_pasep" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              PIS / PASEP
            </label>
            <input
              type="text"
              id="pis_pasep"
              name="pis_pasep"
              value={pisPasep}
              onChange={handlePisPasepChange}
              placeholder="000.00000.00-0"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="registro_profissional" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Registro Profissional (Nº)
            </label>
            <input
              type="text"
              id="registro_profissional"
              name="registro_profissional"
              defaultValue={servidor?.registro_profissional || ''}
              placeholder="ex: 123456"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="registro_profissional_orgao" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Órgão Emissor (Registro)
            </label>
            <input
              type="text"
              id="registro_profissional_orgao"
              name="registro_profissional_orgao"
              defaultValue={servidor?.registro_profissional_orgao || ''}
              placeholder="ex: CRM/PA, COREN/PA"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm uppercase"
            />
          </div>
        </div>
      </div>

      {/* 4. Admissão & Observações */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800 text-sm font-bold text-blue-600 dark:text-blue-400">
          <Calendar className="h-4 w-4" />
          <span>4. Admissão & Observações</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <label htmlFor="data_admissao_hmm" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Data de Admissão no HMM
            </label>
            <input
              type="date"
              id="data_admissao_hmm"
              name="data_admissao_hmm"
              defaultValue={servidor?.data_admissao_hmm || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="data_admissao_pmm" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Data de Admissão na PMM
            </label>
            <input
              type="date"
              id="data_admissao_pmm"
              name="data_admissao_pmm"
              defaultValue={servidor?.data_admissao_pmm || ''}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>

          <div className="sm:col-span-6">
            <label htmlFor="observacao" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Observação
            </label>
            <textarea
              id="observacao"
              name="observacao"
              rows={3}
              defaultValue={servidor?.observacao || ''}
              placeholder="Anotações gerais sobre o servidor..."
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
