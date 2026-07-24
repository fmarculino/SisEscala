'use client'

import { useState, useEffect } from 'react'
import { User } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface FichaServidorPrintViewProps {
  servidor: any
  unidades: any[]
  setores: any[]
  cargos: any[]
  logoUrl?: string | null
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  if (dateStr.includes('/')) return dateStr
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export function FichaServidorPrintView({
  servidor,
  unidades,
  setores,
  cargos,
  logoUrl
}: FichaServidorPrintViewProps) {
  const [headerLogoUrl, setHeaderLogoUrl] = useState<string>(logoUrl || '')

  useEffect(() => {
    if (logoUrl) {
      setHeaderLogoUrl(logoUrl)
      return
    }
    async function fetchHeaderLogo() {
      const supabase = createClient()
      const { data } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'instituicao_cabecalho_url')
        .single()
      if (data?.valor) {
        setHeaderLogoUrl(data.valor)
      }
    }
    fetchHeaderLogo()
  }, [logoUrl])

  if (!servidor) return null

  const unidadeNome = unidades.find(u => u.id === servidor.unidade_id)?.nome || 'Não informada'
  
  const setorObj = setores.find(s => s.id === servidor.setor_id)
  const setorNome = setorObj?.nome || setorObj?.dicionario_setores?.nome || 'Não informado'

  const cargoNome = cargos.find(c => c.id === servidor.cargo_id)?.nome || servidor.cargo || 'Não informado'

  return (
    <div className="hidden print:block fixed inset-0 bg-white text-black p-8 z-[9999] overflow-visible text-xs font-sans">
      {/* Document Header */}
      <div className="flex items-center justify-between border-b-2 border-zinc-800 pb-4 mb-6">
        <div className="flex items-center gap-4">
          {headerLogoUrl ? (
            <img src={headerLogoUrl} alt="Logo Prefeitura Municipal de Marabá" className="h-16 max-w-[220px] object-contain" />
          ) : (
            <div className="w-16 h-16 rounded-full border-2 border-zinc-800 flex items-center justify-center font-black text-xl bg-zinc-100 shrink-0">
              PMM
            </div>
          )}
          <div>
            <h1 className="text-base font-bold uppercase tracking-wider">Prefeitura Municipal de Marabá</h1>
            <h2 className="text-xs font-semibold text-zinc-700 uppercase">Secretaria Municipal de Saúde — SMS</h2>
            <h3 className="text-sm font-black text-zinc-900 mt-1 uppercase tracking-widest bg-zinc-200 px-2 py-0.5 rounded inline-block">
              Ficha Cadastral do Servidor
            </h3>
          </div>
        </div>

        {/* Servidor Photo Frame */}
        <div className="w-28 h-36 border-2 border-zinc-800 rounded bg-zinc-50 flex items-center justify-center overflow-hidden shrink-0">
          {servidor.foto_url ? (
            <img src={servidor.foto_url} alt={servidor.nome} className="w-full h-full object-cover" />
          ) : (
            <div className="text-center text-zinc-400 p-2">
              <User className="h-10 w-10 mx-auto text-zinc-300 mb-1" />
              <span className="text-[9px] uppercase font-bold block">Foto 3x4</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Sections */}
      <div className="space-y-4">
        {/* 1. DADOS PESSOAIS E DOCUMENTOS */}
        <div className="border border-zinc-800 rounded overflow-hidden">
          <div className="bg-zinc-800 text-white px-3 py-1 font-bold uppercase tracking-wider text-[11px]">
            1. Identificação Pessoal & Documentos
          </div>
          <div className="p-3 grid grid-cols-3 gap-y-2 gap-x-4">
            <div className="col-span-2">
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Nome Completo:</span>
              <span className="font-bold text-sm uppercase">{servidor.nome}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">CPF:</span>
              <span className="font-bold font-mono">{servidor.cpf || '—'}</span>
            </div>

            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">RG / Órgão Emissor:</span>
              <span className="font-semibold">{servidor.rg_numero || '—'} {servidor.rg_orgao_emissor ? `(${servidor.rg_orgao_emissor})` : ''}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Data de Emissão RG:</span>
              <span className="font-semibold">{formatDate(servidor.rg_data_emissao)}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">PIS / PASEP:</span>
              <span className="font-semibold font-mono">{servidor.pis_pasep || '—'}</span>
            </div>

            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Data de Nascimento:</span>
              <span className="font-semibold">{formatDate(servidor.data_nascimento)}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Sexo:</span>
              <span className="font-semibold">{servidor.sexo || '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Estado Civil:</span>
              <span className="font-semibold">{servidor.estado_civil || '—'}</span>
            </div>

            <div className="col-span-2">
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Nome da Mãe:</span>
              <span className="font-semibold uppercase">{servidor.nome_mae || '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Nome do Pai:</span>
              <span className="font-semibold uppercase">{servidor.nome_pai || '—'}</span>
            </div>
          </div>
        </div>

        {/* 2. DADOS FUNCIONAIS E LOTAÇÃO */}
        <div className="border border-zinc-800 rounded overflow-hidden">
          <div className="bg-zinc-800 text-white px-3 py-1 font-bold uppercase tracking-wider text-[11px]">
            2. Dados Funcionais & Lotação
          </div>
          <div className="p-3 grid grid-cols-3 gap-y-2 gap-x-4">
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Matrícula:</span>
              <span className="font-bold font-mono text-sm">{servidor.matricula || '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Cargo:</span>
              <span className="font-bold uppercase">{cargoNome}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Vínculo Empregatício:</span>
              <span className="font-semibold uppercase">{servidor.vinculo || '—'}</span>
            </div>

            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Unidade de Lotação:</span>
              <span className="font-bold uppercase">{unidadeNome}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Setor / Serviço:</span>
              <span className="font-bold uppercase">{setorNome}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Carga Horária Semanal:</span>
              <span className="font-semibold">{servidor.carga_horaria_semanal || 40}h semanais</span>
            </div>

            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Data Admissão (PMM/HMM):</span>
              <span className="font-semibold">{formatDate(servidor.data_admissao_pmm || servidor.data_admissao_hmm)}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Registro Profissional:</span>
              <span className="font-semibold">{servidor.registro_profissional ? `${servidor.registro_profissional} (${servidor.registro_profissional_orgao || ''})` : '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Situação no Sistema:</span>
              <span className="font-bold uppercase">{servidor.status || 'Ativo'}</span>
            </div>
          </div>
        </div>

        {/* 3. ENDEREÇO E CONTATOS */}
        <div className="border border-zinc-800 rounded overflow-hidden">
          <div className="bg-zinc-800 text-white px-3 py-1 font-bold uppercase tracking-wider text-[11px]">
            3. Endereço Residencial & Contatos
          </div>
          <div className="p-3 grid grid-cols-3 gap-y-2 gap-x-4">
            <div className="col-span-2">
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Logradouro / Endereço:</span>
              <span className="font-semibold">{servidor.endereco_logradouro ? `${servidor.endereco_logradouro}, N° ${servidor.endereco_numero || 'S/N'}` : '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Bairro:</span>
              <span className="font-semibold">{servidor.bairro || '—'}</span>
            </div>

            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">CEP:</span>
              <span className="font-mono">{servidor.cep || '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Município / UF:</span>
              <span className="font-semibold">{servidor.municipio_residencia || 'Marabá - PA'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">E-mail:</span>
              <span className="font-semibold">{servidor.email || '—'}</span>
            </div>

            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Telefone Celular:</span>
              <span className="font-semibold font-mono">{servidor.telefone || '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Telefone Residencial:</span>
              <span className="font-semibold font-mono">{servidor.telefone_residencial || '—'}</span>
            </div>
          </div>
        </div>

        {/* 4. DADOS BANCÁRIOS */}
        <div className="border border-zinc-800 rounded overflow-hidden">
          <div className="bg-zinc-800 text-white px-3 py-1 font-bold uppercase tracking-wider text-[11px]">
            4. Dados Bancários (Folha de Pagamento)
          </div>
          <div className="p-3 grid grid-cols-4 gap-2">
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Banco:</span>
              <span className="font-semibold">{servidor.banco_nome || '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Agência:</span>
              <span className="font-mono">{servidor.agencia_numero || '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Conta Corrente / Tipo:</span>
              <span className="font-mono">{servidor.conta_numero ? `${servidor.conta_numero} (${servidor.conta_tipo || 'Corrente'})` : '—'}</span>
            </div>
            <div>
              <span className="text-zinc-500 font-bold uppercase text-[10px] block">Chave PIX:</span>
              <span className="font-mono">{servidor.chave_pix || '—'}</span>
            </div>
          </div>
        </div>

        {/* Termo de Responsabilidade */}
        <div className="p-3 bg-zinc-50 border border-zinc-300 rounded text-[10px] text-zinc-700 leading-tight">
          <strong>DECLARAÇÃO DE VERACIDADE:</strong> Declaro para os devidos fins de direito que todas as informações prestadas neste formulário cadastral são verdadeiras, exatas e autênticas, comprometendo-me a comunicar imediatamente ao setor de Recursos Humanos / Gestão de Pessoas qualquer alteração em meus dados pessoais ou funcionais.
        </div>

        {/* Signature Fields */}
        <div className="pt-12 grid grid-cols-2 gap-12 text-center text-xs">
          <div>
            <div className="border-t border-zinc-800 pt-1 font-bold uppercase">
              Assinatura do Servidor
            </div>
            <span className="text-[10px] text-zinc-500 block mt-0.5">CPF: {servidor.cpf || '—'}</span>
            <span className="text-[10px] text-zinc-500 block">Data: _____ / _____ / ________</span>
          </div>

          <div>
            <div className="border-t border-zinc-800 pt-1 font-bold uppercase">
              Responsável pelo Cadastro / RH
            </div>
            <span className="text-[10px] text-zinc-500 block mt-0.5">Carimbo & Assinatura</span>
            <span className="text-[10px] text-zinc-500 block">Data: _____ / _____ / ________</span>
          </div>
        </div>
      </div>
    </div>
  )
}
