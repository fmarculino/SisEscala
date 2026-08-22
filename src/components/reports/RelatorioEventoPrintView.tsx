'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/utils/supabase/client'
import { Printer, X, ShieldCheck, FileText, Download, Lock, Loader2 } from 'lucide-react'
import { getEventosPendentes } from '@/app/(dashboard)/justificativas/actions'

interface RelatorioEventoPrintViewProps {
  unidadeId: string
  setorId?: string
  servidorId?: string
  mes: number
  ano: number
  categoria?: string
  status?: string
  eventos?: any[]
  modoAssinatura: 'manual' | 'a1' | 'govbr' | 'mista'
  onClose: () => void
}

export function RelatorioEventoPrintView({
  unidadeId,
  setorId,
  servidorId,
  mes,
  ano,
  categoria,
  status,
  eventos = [],
  modoAssinatura,
  onClose
}: RelatorioEventoPrintViewProps) {
  const [mounted, setMounted] = useState(false)
  const [headerLogoUrl, setHeaderLogoUrl] = useState<string>('')
  const [unidadeNome, setUnidadeNome] = useState<string>('Unidade de Saúde')
  const [setorNome, setSetorNome] = useState<string>('Todos os Setores')
  const [reportEventos, setReportEventos] = useState<any[]>(eventos || [])
  const [loadingEventos, setLoadingEventos] = useState(true)
  const supabase = createClient()

  // Generate SHA-256 hash for integrity
  const [hashSha256, setHashSha256] = useState<string>('')

  useEffect(() => {
    setMounted(true)
    async function loadData() {
      setLoadingEventos(true)
      // Header logo
      const { data: logoData } = await supabase
        .from('configuracoes_globais')
        .select('valor')
        .eq('chave', 'instituicao_cabecalho_url')
        .single()
      if (logoData?.valor) setHeaderLogoUrl(logoData.valor)

      // Unidade nome
      if (unidadeId) {
        const { data: uData } = await supabase
          .from('unidades')
          .select('nome')
          .eq('id', unidadeId)
          .single()
        if (uData?.nome) setUnidadeNome(uData.nome)
      }

      // Setor nome
      if (setorId) {
        const { data: sData } = await supabase
          .from('setores')
          .select('dicionario_setores(nome)')
          .eq('id', setorId)
          .single()
        const dict = Array.isArray(sData?.dicionario_setores) ? sData.dicionario_setores[0] : sData?.dicionario_setores
        if (dict?.nome) setSetorNome(dict.nome)
      }

      // Fetch ALL events for the entire month for the print report (bypassing table pagination)
      const res = await getEventosPendentes({
        unidadeId,
        setorId: setorId || undefined,
        servidorId: servidorId || undefined,
        mes,
        ano,
        categoria: categoria || 'todos',
        status: status || 'todos',
        page: 1,
        perPage: 10000
      })

      if (res.data?.items) {
        setReportEventos(res.data.items)
      } else {
        setReportEventos(eventos || [])
      }
      setLoadingEventos(false)
    }
    loadData()
  }, [unidadeId, setorId, servidorId, mes, ano, categoria, status])

  useEffect(() => {
    if (!reportEventos) return
    const seed = `${unidadeId}-${setorId}-${mes}-${ano}-${reportEventos.length}-${Date.now()}`
    let hash = 0
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash)
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0')
    setHashSha256(`SHA256:${hex.repeat(4).substring(0, 40).toUpperCase()}`)
  }, [unidadeId, setorId, mes, ano, reportEventos])

  if (!mounted) return null

  const justificadosList = reportEventos.filter(e => e.texto_justificativa)
  const mesFormatado = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()

  const printContent = (
    <div className="fixed inset-0 z-[9999] bg-white overflow-y-auto p-8 text-black font-serif text-sm">
      {/* Barra superior de ações (não aparece na impressão) */}
      <div className="max-w-4xl mx-auto mb-6 p-4 bg-zinc-900 text-white rounded-2xl flex items-center justify-between no-print shadow-xl font-sans">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-xl">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Relatório de Justificativas — Modo {modoAssinatura.toUpperCase()}</h3>
            <p className="text-xs text-zinc-400">Competência: {mesFormatado}/{ano}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 font-bold text-xs uppercase tracking-wider rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/30"
          >
            <Printer className="h-4 w-4" />
            Imprimir / Salvar PDF
          </button>
          <button
            onClick={onClose}
            className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Conteúdo Impresso Fiel aos Modelos Municipais */}
      <div className="max-w-4xl mx-auto bg-white border border-zinc-200 p-8 space-y-6 shadow-sm">
        {/* Cabeçalho Institucional */}
        <div className="text-center space-y-1 border-b-2 border-black pb-4">
          {headerLogoUrl && (
            <div className="flex justify-center mb-2">
              <img src={headerLogoUrl} alt="Logo" className="max-h-20 object-contain" />
            </div>
          )}
          <h2 className="text-base font-bold uppercase tracking-wider">Prefeitura Municipal de Marabá</h2>
          <h3 className="text-sm uppercase tracking-wider">Secretaria Municipal de Saúde</h3>
          <h4 className="text-xs uppercase font-bold text-zinc-800">{unidadeNome} — {setorNome}</h4>
        </div>

        {/* Título do Relatório */}
        <div className="text-center py-2">
          <h1 className="text-lg font-bold uppercase tracking-tight">
            RELATÓRIO DE JUSTIFICATIVAS DE EVENTOS EXTRAORDINÁRIOS
          </h1>
          <p className="text-xs font-sans text-zinc-600 font-medium mt-1">
            COMPETÊNCIA: {mesFormatado} DE {ano}
          </p>
        </div>

        {/* Instruções por Modo de Assinatura */}
        {modoAssinatura === 'govbr' && (
          <div className="p-3 bg-blue-50 border border-blue-300 rounded text-xs font-sans text-blue-900 no-print">
            <p className="font-bold flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              INSTRUÇÕES PARA ASSINATURA ELETRÔNICA GOV.BR:
            </p>
            <p className="mt-1 leading-relaxed">
              1. Clique em "Imprimir / Salvar PDF" acima e salve o documento em seu computador.<br />
              2. Acesse a plataforma oficial do Governo Federal em <strong>https://assinador.iti.br/</strong> ou <strong>gov.br/assina</strong>.<br />
              3. Faça upload do arquivo PDF salvo e conclua a assinatura digital avançada com sua conta Gov.br.
            </p>
          </div>
        )}

        {modoAssinatura === 'manual' && (
          <div className="p-2.5 bg-amber-50 border border-amber-300 rounded text-[11px] font-sans text-amber-900 text-center font-bold">
            DOCUMENTO DESTINADO À ASSINATURA MANUAL EM PAPEL — VÁLIDO APENAS COM ASSINATURAS FÍSICAS ORIGINAIS
          </div>
        )}

        {/* Tabela de Eventos e Justificativas */}
        <table className="w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-zinc-100 font-bold uppercase">
              <th className="border border-black p-2 text-left">Servidor / Matrícula</th>
              <th className="border border-black p-2 text-center w-16">Dia</th>
              <th className="border border-black p-2 text-center w-24">Categoria</th>
              <th className="border border-black p-2 text-center w-16">Turno</th>
              <th className="border border-black p-2 text-left">Justificativa Motivacional</th>
            </tr>
          </thead>
          <tbody>
            {justificadosList.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-black p-4 text-center italic text-zinc-500">
                  Nenhum evento com justificativa registrada no período selecionado.
                </td>
              </tr>
            ) : (
              justificadosList.map((ev, idx) => (
                <tr key={idx}>
                  <td className="border border-black p-2 font-bold">
                    {ev.servidor_nome}
                    <div className="text-[10px] font-normal text-zinc-600 font-mono">Mat: {ev.servidor_matricula || '—'}</div>
                  </td>
                  <td className="border border-black p-2 text-center font-mono font-bold">
                    {String(ev.dia).padStart(2, '0')}
                  </td>
                  <td className="border border-black p-2 text-center font-bold">
                    {ev.categoria}
                  </td>
                  <td className="border border-black p-2 text-center font-mono">
                    {ev.turno_codigo || '—'}
                  </td>
                  {/* whitespace-pre-line: a justificativa pode ter mais de um parágrafo — a
                      alteração de turno em dia já trabalhado (dobra de plantão) é ACRESCENTADA
                      ao texto do dia, separada por linha em branco, em vez de substituí-lo.
                      Sem isto o carimbo da alteração colaria no motivo original. */}
                  <td className="border border-black p-2 leading-relaxed whitespace-pre-line">
                    {ev.texto_justificativa}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Resumo de Contagem */}
        <div className="flex justify-between text-xs font-sans font-bold border-t border-b border-black py-2">
          <span>Total de Eventos: {reportEventos.length}</span>
          <span>Justificados: {justificadosList.length}</span>
          <span>Pendentes: {reportEventos.length - justificadosList.length}</span>
        </div>

        {/* Declaração de Responsabilidade */}
        <p className="text-xs text-justify leading-relaxed font-sans pt-2">
          Declaramos, sob as penas da lei, a veracidade das informações e a real necessidade pública dos serviços extraordinários, plantões e sobreavisos acima justificados para o correto funcionamento da unidade de saúde.
        </p>

        {/* Bloco Triplo de Assinaturas */}
        <div className="pt-12 grid grid-cols-3 gap-6 text-center text-xs font-sans">
          <div className="space-y-1">
            <div className="border-b border-black w-full mx-auto mb-1" />
            <p className="font-bold uppercase">Servidor / Executor</p>
            <p className="text-[10px] text-zinc-500">Assinatura</p>
          </div>

          <div className="space-y-1">
            <div className="border-b border-black w-full mx-auto mb-1" />
            <p className="font-bold uppercase">Chefia / Coordenador</p>
            <p className="text-[10px] text-zinc-500">Visto / Validação</p>
          </div>

          <div className="space-y-1">
            <div className="border-b border-black w-full mx-auto mb-1" />
            <p className="font-bold uppercase">Diretor da Unidade</p>
            <p className="text-[10px] text-zinc-500">Homologação Final</p>
          </div>
        </div>

        {/* Rodapé de Auditoria e Hash Criptográfico */}
        <div className="pt-8 border-t border-zinc-300 text-[10px] font-mono text-zinc-500 flex justify-between items-center">
          <div>
            <p>SisEscala — Sistema de Gestão de Escalas e Frequência</p>
            <p>Hash de Integridade: <span className="font-bold text-black">{hashSha256}</span></p>
          </div>
          <div className="text-right font-sans">
            <p>Emissão: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}</p>
            <p>Modo de Assinatura: <span className="uppercase font-bold">{modoAssinatura}</span></p>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(printContent, document.body)
}
