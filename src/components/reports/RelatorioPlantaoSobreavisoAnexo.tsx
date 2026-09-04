'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { formatarData, formatarHoraComSegundos } from '@/utils/horario'
import { createPortal } from 'react-dom'
import { Printer, Clock, ShieldCheck, PhoneCall, Building2, X } from 'lucide-react'

interface PlantaoItem {
  dia: number
  dia_semana: string
  data_formatada: string
  turno_nome: string
  horario_previsto: string
  horas_computadas: number
  horas_realizadas?: string
  minutos_realizados?: number | null
  entrada_real: string
  saida_real: string
  confirmado: boolean
  unidade: string
  setor: string
  ajuste_manual?: boolean
  justificativa?: string
  observacao?: string
  /** Estado vindo de fn_desfecho_evento_dia. `null` = a RPC nao respondeu. */
  estado?: string | null
  estado_motivo?: string | null
  resultado_origem?: string | null
}

interface SobreavisoItem {
  dia: number
  dia_semana: string
  data_formatada: string
  turno_nome: string
  horario_previsto: string
  horas_prontidao: number
  unidade: string
  setor: string
  estado?: string | null
  estado_motivo?: string | null
  acionamentos: Array<{
    hora_acionamento: string
    hora_chegada: string
    hora_saida: string
    motivo: string
    status: string
    destino?: string
  }>
}

interface Props {
  dados: {
    servidor: {
      id: string
      nome: string
      matricula: string
      cargo: string
      vinculo?: string
      unidades?: { nome: string }
      setores?: { dicionario_setores?: { nome: string } }
    }
    mes: number
    ano: number
    plantoes: PlantaoItem[]
    sobreavisos: SobreavisoItem[]
    totalHorasPlantao: number
    totalHorasPlantaoCumpridas?: number
    totalHorasPlantaoRealizadas?: string
    totalMinutosPlantaoRealizados?: number
    totalHorasPlantaoEmAvaliacao?: number
    totalHorasPlantaoFaltas?: number
    totalPlantoesFaltas?: number
    totalPlantoesEmAvaliacao?: number
    desfechoIndisponivel?: boolean
    totalHorasSobreaviso: number
    totalHorasSobreavisoEscalado?: number
    totalSobreavisosCumpridos?: number
    totalSobreavisosFaltas?: number
    totalAcionamentos: number
  }
  onClose?: () => void
}

export function RelatorioPlantaoSobreavisoAnexo({ dados, onClose }: Props) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const { servidor, mes, ano, plantoes, sobreavisos, totalHorasPlantao, totalHorasSobreaviso, totalAcionamentos } = dados

  // O anexo e comprobatorio: e o que o servidor assina e o que o RH usa para pagar a unidade de
  // plantao. Ate 24/08/2026 ele somava TODA linha escalada, com ou sem ponto — 65% das horas
  // impressas em 08/2026 nao tinham registro completo. A reparticao vem pronta da action; aqui
  // so se exibe. Os `??` cobrem o anexo aberto antes do deploy da action nova.
  const cumpridas = dados.totalHorasPlantaoCumpridas ?? totalHorasPlantao
  const emAvaliacaoHoras = dados.totalHorasPlantaoEmAvaliacao ?? 0
  const faltasHoras = dados.totalHorasPlantaoFaltas ?? 0
  const qtdFaltas = dados.totalPlantoesFaltas ?? 0
  const qtdEmAvaliacao = dados.totalPlantoesEmAvaliacao ?? 0

  const rotuloSituacao = (p: PlantaoItem) => {
    if (p.estado === 'falta') return { texto: 'FALTA', cor: 'text-red-700 dark:text-red-400' }
    if (p.estado === 'em_avaliacao') return { texto: 'EM AVALIAÇÃO', cor: 'text-orange-700 dark:text-orange-400' }
    if (p.estado === 'validado') return { texto: 'VALIDADO', cor: 'text-emerald-700 dark:text-emerald-400' }
    if (p.estado === 'previsto') return { texto: 'PREVISTO', cor: 'text-zinc-500' }
    if (p.estado === 'registrado') return { texto: 'REGISTRADO', cor: 'text-emerald-700 dark:text-emerald-400' }
    return { texto: '—', cor: 'text-zinc-400' }
  }

  const nomeMes = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()
  const unidadeNome = servidor?.unidades?.nome || 'SECRETARIA MUNICIPAL DE SAÚDE'
  const setorNome = servidor?.setores?.dicionario_setores?.nome || 'SETOR GERAL'

  // Resumo agrupado por tipo individual de plantão
  // ⚠️ O RESUMO CONTA SÓ O QUE FOI CUMPRIDO (24/08/2026).
  //
  // Até aqui ele agrupava TODAS as linhas escaladas, e o resultado contradizia o número grande
  // do próprio documento: a ANDRESA aparecia com "48h cumpridas" no topo e, logo abaixo,
  // "5 escalas • 60h" + "10 escalas • 60h" = 120h no detalhamento. Num anexo comprobatório, dois
  // totais diferentes para a mesma coisa é pior do que um total errado — quem confere não sabe
  // qual acreditar.
  //
  // `ehCumprido` é o MESMO critério das linhas da seção 1 e do rodapé de subtotais. Estado
  // ausente (a RPC não respondeu) conta como cumprido, para o documento cair no comportamento
  // antigo em vez de zerar — e o aviso de indisponibilidade diz que foi isso que aconteceu.
  const ehCumprido = (p: PlantaoItem) =>
    !p.estado || p.estado === 'registrado' || p.estado === 'validado'
  const plantoesCumpridos = plantoes.filter(ehCumprido)

  const formatarHorasRealizadas = (p: PlantaoItem): string => {
    let min: number | null = null
    if (typeof p.minutos_realizados === 'number' && p.minutos_realizados > 0) {
      min = p.minutos_realizados
    } else if (p.horas_realizadas && p.horas_realizadas !== '-') {
      const match = p.horas_realizadas.match(/(\d+)h\s*(\d+)m/)
      if (match) {
        min = Number(match[1]) * 60 + Number(match[2])
      } else if (p.horas_realizadas.includes(':')) {
        return p.horas_realizadas
      }
    }
    if (min === null) {
      if (!p.entrada_real || !p.saida_real || p.entrada_real === '-' || p.saida_real === '-') {
        return '-'
      }
      const [hE, mE] = p.entrada_real.split(':').map(Number)
      const [hS, mS] = p.saida_real.split(':').map(Number)
      if (!Number.isFinite(hE) || !Number.isFinite(mE) || !Number.isFinite(hS) || !Number.isFinite(mS)) {
        return '-'
      }
      let diff = (hS * 60 + mS) - (hE * 60 + mE)
      if (diff < 0) {
        diff += 1440 // Cruzou a meia-noite (plantão noturno)
      }
      min = diff
    }
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const formatarHorasPrevistas = (p: PlantaoItem): string => {
    const totalMin = Math.round((p.horas_computadas || 0) * 60)
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const totalRealizadas = useMemo(() => {
    let minTotal = 0
    let temAlgum = false
    if (dados.totalHorasPlantaoRealizadas) {
      const match = dados.totalHorasPlantaoRealizadas.match(/(\d+)h\s*(\d+)m/)
      if (match) {
        minTotal = Number(match[1]) * 60 + Number(match[2])
        temAlgum = true
      } else if (dados.totalHorasPlantaoRealizadas.includes(':')) {
        return dados.totalHorasPlantaoRealizadas
      }
    }
    if (!temAlgum) {
      plantoesCumpridos.forEach(p => {
        if (typeof p.minutos_realizados === 'number' && p.minutos_realizados > 0) {
          minTotal += p.minutos_realizados
          temAlgum = true
        } else if (p.entrada_real && p.saida_real && p.entrada_real !== '-' && p.saida_real !== '-') {
          const [hE, mE] = p.entrada_real.split(':').map(Number)
          const [hS, mS] = p.saida_real.split(':').map(Number)
          if (Number.isFinite(hE) && Number.isFinite(mE) && Number.isFinite(hS) && Number.isFinite(mS)) {
            let diff = (hS * 60 + mS) - (hE * 60 + mE)
            if (diff < 0) diff += 1440
            minTotal += diff
            temAlgum = true
          }
        }
      })
    }
    if (!temAlgum || minTotal <= 0) return null
    return `${Math.floor(minTotal / 60)}:${String(minTotal % 60).padStart(2, '0')}`
  }, [dados.totalHorasPlantaoRealizadas, plantoesCumpridos])

  const resumoTiposPlantao = useMemo(() => {
    const map = new Map<string, { nome: string; horario: string; qtd: number; horas: number }>()
    plantoes.filter(p => !p.estado || p.estado === 'registrado' || p.estado === 'validado').forEach(p => {
      const key = `${p.turno_nome || 'Plantão'}__${p.horario_previsto || ''}`
      const curr = map.get(key) || { 
        nome: p.turno_nome || 'Plantão', 
        horario: p.horario_previsto || '', 
        qtd: 0, 
        horas: 0 
      }
      curr.qtd += 1
      curr.horas += (p.horas_computadas || 0)
      map.set(key, curr)
    })
    return Array.from(map.values())
  }, [plantoes])

  // Resumo agrupado por tipo individual de sobreaviso
  const sobreavisosCumpridos = sobreavisos.filter(s => !s.estado || s.estado === 'validado')

  const resumoTiposSobreaviso = useMemo(() => {
    const map = new Map<string, { nome: string; horario: string; qtd: number; horas: number }>()
    sobreavisos.filter(s => !s.estado || s.estado === 'validado').forEach(s => {
      const key = `${s.turno_nome || 'Sobreaviso'}__${s.horario_previsto || ''}`
      const curr = map.get(key) || { 
        nome: s.turno_nome || 'Sobreaviso', 
        horario: s.horario_previsto || '', 
        qtd: 0, 
        horas: 0 
      }
      curr.qtd += 1
      curr.horas += (s.horas_prontidao || 0)
      map.set(key, curr)
    })
    return Array.from(map.values())
  }, [sobreavisos])

  const handlePrint = () => {
    window.print()
  }

  if (!mounted) return null

  return createPortal(
    <div 
      className="anexo-modal-portal fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-center items-start p-4 sm:p-6 md:p-8 overflow-y-auto print:p-0 print:bg-transparent print:overflow-visible print:static print:block"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose()
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 8mm 8mm 8mm;
          }
          
          /* Hide the entire Next.js application tree and everything else during print */
          body > *:not(.anexo-modal-portal) {
            display: none !important;
          }

          /* Reset page-level styles */
          html, body {
            height: auto !important;
            min-height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            background-color: #fff !important;
            color: #000 !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Portal container reset - avoid fixed positioning overlap */
          .anexo-modal-portal {
            display: block !important;
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            min-height: auto !important;
            overflow: visible !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }

          .anexo-modal-content {
            display: block !important;
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            border: none !important;
          }

          /* Headers and Cards Page Break Control */
          .anexo-header-box {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            border: 1px solid #71717a !important;
            background: #fafafa !important;
            margin-bottom: 12px !important;
            padding: 10px 14px !important;
            border-radius: 8px !important;
          }

          .anexo-section {
            margin-bottom: 16px !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
          }

          .anexo-section-title {
            page-break-after: avoid !important;
            break-after: avoid !important;
            margin-bottom: 6px !important;
          }

          .anexo-table-wrap {
            overflow: visible !important;
            display: block !important;
            width: 100% !important;
            border: 1px solid #71717a !important;
            border-radius: 6px !important;
          }

          .anexo-table {
            width: 100% !important;
            border-collapse: collapse !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
            font-size: 8pt !important;
            table-layout: auto !important;
          }

          .anexo-table thead {
            display: table-header-group !important;
          }

          .anexo-table thead tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            background-color: #f4f4f5 !important;
          }

          .anexo-table tbody tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .anexo-table th, .anexo-table td {
            border: 0.5pt solid #a1a1aa !important;
            padding: 3.5px 5px !important;
            color: #000 !important;
            vertical-align: middle !important;
          }

          .anexo-summary-box {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            border: 1px solid #71717a !important;
            background: #fafafa !important;
            border-radius: 8px !important;
            padding: 10px 14px !important;
            margin-bottom: 14px !important;
          }

          .anexo-signatures-box {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            border-top: 1px solid #71717a !important;
            padding-top: 12px !important;
          }

          .print-full-text {
            white-space: normal !important;
            max-width: none !important;
            overflow: visible !important;
            text-overflow: clip !important;
          }
        }
      `}} />

      <div className="anexo-modal-content relative w-full max-w-5xl my-4 print:my-0 print:max-w-none bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-10 rounded-3xl shadow-2xl print:shadow-none print:p-0 print:bg-transparent print:rounded-none">
        
        {/* Action Bar (Hidden on Print) */}
        <div className="sticky top-0 z-20 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md flex items-center justify-between gap-4 pb-4 pt-1 mb-6 border-b border-zinc-200 dark:border-zinc-800 print:hidden">
          <div>
            <h2 className="text-lg md:text-xl font-black uppercase tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-blue-600 dark:text-blue-400 shrink-0" />
              Demonstrativo de Plantões e Sobreavisos
            </h2>
            <p className="text-xs text-zinc-500 font-medium">Relatório comprobatório anexo à folha de ponto de {nomeMes} / {ano}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <X className="h-4 w-4" />
                Fechar
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2 text-xs font-black rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2 uppercase tracking-wider cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              Imprimir Anexo
            </button>
          </div>
        </div>

        {/* Document Header */}
        <div className="anexo-header-box border border-zinc-300 dark:border-zinc-700 rounded-2xl p-6 bg-zinc-50/60 dark:bg-zinc-800/30 print:bg-white print:border-zinc-400 print:p-4 mb-6">
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 pb-4 mb-4 print:pb-3 print:mb-3">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-600/10 dark:bg-blue-400/10 flex items-center justify-center print:hidden">
                <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-zinc-500 print:text-zinc-700 tracking-wider">
                  Prefeitura Municipal de Marabá • Secretaria Municipal de Saúde
                </div>
                <h1 className="text-lg md:text-xl font-black uppercase text-zinc-900 dark:text-white print:text-black tracking-tight">
                  Anexo à Folha de Ponto — Plantões e Sobreavisos
                </h1>
                <div className="text-[9px] font-bold text-zinc-400 print:text-zinc-600 uppercase tracking-widest">
                  Comprovante Oficial de Escalas Diferenciadas • Portaria MTP 671/2021
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] font-black text-zinc-400 print:text-zinc-600 uppercase tracking-widest">Competência</div>
              <div className="text-base md:text-lg font-black text-zinc-900 dark:text-white print:text-black uppercase">
                {nomeMes} / {ano}
              </div>
            </div>
          </div>

          {/* Servidor Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs print:grid-cols-4 print:text-[8pt]">
            <div>
              <div className="text-[9px] print:text-[7pt] font-bold text-zinc-400 print:text-zinc-600 uppercase">Servidor</div>
              <div className="font-black text-zinc-900 dark:text-white print:text-black uppercase">{servidor?.nome}</div>
              <div className="text-[10px] print:text-[7.5pt] text-zinc-500 print:text-zinc-700 font-mono font-semibold">Mat: {servidor?.matricula || '---'}</div>
            </div>
            <div>
              <div className="text-[9px] print:text-[7pt] font-bold text-zinc-400 print:text-zinc-600 uppercase">Cargo / Vínculo</div>
              <div className="font-bold text-zinc-900 dark:text-white print:text-black uppercase">{servidor?.cargo || '---'}</div>
              <div className="text-[10px] print:text-[7.5pt] text-zinc-500 print:text-zinc-700 uppercase">{servidor?.vinculo || 'CONTRATADO/EFETIVO'}</div>
            </div>
            <div>
              <div className="text-[9px] print:text-[7pt] font-bold text-zinc-400 print:text-zinc-600 uppercase">Unidade de Lotação</div>
              <div className="font-bold text-zinc-900 dark:text-white print:text-black uppercase print-full-text truncate">{unidadeNome}</div>
            </div>
            <div>
              <div className="text-[9px] print:text-[7pt] font-bold text-zinc-400 print:text-zinc-600 uppercase">Setor de Atuação</div>
              <div className="font-bold text-zinc-900 dark:text-white print:text-black uppercase print-full-text truncate">{setorNome}</div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 1: PLANTÕES */}
        <div className="anexo-section mb-8 print:mb-6">
          <div className="anexo-section-title flex items-center justify-between mb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white print:text-black flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400 print:hidden" />
              1. Escala de Plantões Executados ({plantoes.length} plantão(ões))
            </h3>
            <span className="text-[10px] font-bold text-zinc-500 print:text-black uppercase">
              Carga horária cumprida: <strong className="text-zinc-900 dark:text-white print:text-black">{cumpridas}h</strong>
              {totalHorasPlantao !== cumpridas && <> de {totalHorasPlantao}h escaladas</>}
              {totalRealizadas && <> • Realizado no ponto: <strong className="text-blue-600 dark:text-blue-400 print:text-black">{totalRealizadas}</strong></>}
            </span>
          </div>

          {plantoes.length > 0 ? (
            <div className="anexo-table-wrap overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
              <table className="anexo-table w-full text-xs text-left border-collapse print:text-[8pt]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-bold uppercase text-[9px] print:text-[7.5pt] print:bg-zinc-200 print:text-black border-b border-zinc-200 dark:border-zinc-700">
                    <th className="py-2 px-3 text-center w-10">Dia</th>
                    <th className="py-2 px-3 text-center w-10">Sem</th>
                    <th className="py-2 px-3">Turno / Escala</th>
                    <th className="py-2 px-3 text-center">Horário Previsto</th>
                    <th className="py-2 px-3 text-center">Entrada Real</th>
                    <th className="py-2 px-3 text-center">Saída Real</th>
                    <th className="py-2 px-1.5 text-center leading-tight">
                      <div>Horas</div>
                      <div>Previstas</div>
                    </th>
                    <th className="py-2 px-1.5 text-center leading-tight">
                      <div>Horas</div>
                      <div>Realizadas</div>
                    </th>
                    <th className="py-2 px-3 text-center w-24">Situação</th>
                    <th className="py-2 px-2 w-28">Setor</th>
                    <th className="py-2 px-3">Observações / Justificativas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {plantoes.map((p, idx) => {
                    const sit = rotuloSituacao(p)
                    const naoSoma = p.estado === 'falta' || p.estado === 'em_avaliacao' || p.estado === 'previsto'
                    const horaRealizada = formatarHorasRealizadas(p)
                    return (
                    <tr key={idx} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 print:hover:bg-transparent ${
                      p.estado === 'falta' ? 'bg-red-50/70 dark:bg-red-950/20 print:bg-transparent' : ''
                    }`}>
                      <td className="py-2 px-3 text-center font-bold">{String(p.dia).padStart(2, '0')}</td>
                      <td className="py-2 px-3 text-center text-zinc-500 print:text-black uppercase font-semibold">{p.dia_semana}</td>
                      <td className="py-2 px-3 font-bold text-zinc-900 dark:text-white print:text-black uppercase">{p.turno_nome}</td>
                      <td className="py-2 px-3 text-center font-mono text-zinc-600 dark:text-zinc-400 print:text-black">{p.horario_previsto}</td>
                      <td className="py-2 px-3 text-center font-mono font-bold text-blue-600 dark:text-blue-400 print:text-black">{p.entrada_real}</td>
                      <td className="py-2 px-3 text-center font-mono font-bold text-blue-600 dark:text-blue-400 print:text-black">{p.saida_real}</td>
                      {/* Horas Previstas */}
                      <td className={`py-2 px-1.5 text-center font-mono font-bold print:text-black whitespace-nowrap ${
                        naoSoma ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-white'
                      }`}>{formatarHorasPrevistas(p)}</td>
                      {/* Horas Realizadas */}
                      <td className={`py-2 px-1.5 text-center font-mono font-bold print:text-black whitespace-nowrap ${
                        naoSoma ? 'text-zinc-400 line-through' : (horaRealizada === '-' ? 'text-zinc-400' : 'text-blue-600 dark:text-blue-400')
                      }`}>{horaRealizada}</td>
                      <td className={`py-2 px-3 text-center font-black text-[9px] print:text-[7.5pt] uppercase tracking-wider print:text-black ${sit.cor}`}>
                        {sit.texto}
                      </td>
                      <td className="py-2 px-2 text-zinc-600 dark:text-zinc-400 print:text-black uppercase text-[10px] print:text-[7.5pt] font-medium leading-tight break-words max-w-[110px]">
                        {p.setor}
                      </td>
                      <td className="py-2 px-3 text-zinc-500 print:text-black italic leading-tight">
                        {p.estado === 'falta' && (
                          <span className="not-italic font-bold text-red-700 dark:text-red-400 print:text-black">
                            {p.resultado_origem === 'decurso_de_prazo'
                              ? 'Falta por decurso de prazo — sem registro e sem justificativa até o fechamento. '
                              : 'Plantão não cumprido. '}
                          </span>
                        )}
                        {p.justificativa ? (
                          <span>
                            {p.ajuste_manual ? <span className="font-semibold not-italic">Ajuste Manual Validado • </span> : ''}
                            {p.justificativa}
                          </span>
                        ) : (
                          <>
                            {p.ajuste_manual ? 'Ajuste Manual Validado • ' : ''}
                            {p.observacao
                              || (p.estado === 'em_avaliacao'
                                    ? (p.estado_motivo || 'Em avaliação')
                                    : p.confirmado ? 'Presença confirmada no ponto' : 'Em validação')}
                          </>
                        )}
                      </td>
                    </tr>
                  )})}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-100/90 dark:bg-zinc-800/90 font-bold border-t-2 border-zinc-300 dark:border-zinc-700 print:bg-zinc-200">
                    <td colSpan={6} className="py-2 px-3 text-right font-black uppercase text-[9px] print:text-[7.5pt] text-zinc-700 dark:text-zinc-300 print:text-black">
                      Total Cumprido:
                    </td>
                    <td className="py-2 px-1.5 text-center font-mono font-black text-zinc-900 dark:text-white print:text-black whitespace-nowrap">
                      {cumpridas > 0 ? `${cumpridas}:00` : '0:00'}
                    </td>
                    <td className="py-2 px-1.5 text-center font-mono font-black text-blue-600 dark:text-blue-400 print:text-black whitespace-nowrap">
                      {totalRealizadas || '-'}
                    </td>
                    <td colSpan={3} className="py-2 px-3 text-left text-[9px] print:text-[7pt] text-zinc-500 print:text-black italic">
                      {plantoesCumpridos.length} de {plantoes.length} escala(s)
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400 print:text-zinc-600">
              Nenhum plantão regular ou extra cadastrado para este servidor nesta competência.
            </div>
          )}

          {/*
            OS TRES SUBTOTAIS.
            A conta tem que FECHAR contra o total escalado — cumpridas + em avaliacao + faltas
            (+ dias ainda por acontecer) = escaladas. Sem isso o leitor nao consegue conferir o
            documento, e um anexo que nao se confere nao serve como comprovante.
          */}
          {plantoes.length > 0 && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 print:grid-cols-3 print:gap-1">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 print:bg-transparent p-2.5 print:p-1.5">
                <div className="text-[9px] print:text-[7pt] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 print:text-black">Cumpridos</div>
                <div className="text-base print:text-[9pt] font-black text-emerald-700 dark:text-emerald-400 print:text-black flex flex-wrap items-baseline gap-1.5">
                  <span>{cumpridas}h</span>
                  <span className="text-[10px] print:text-[7pt] font-normal text-zinc-500 print:text-black uppercase">previstas</span>
                  {totalRealizadas && (
                    <span className="text-sm print:text-[8.5pt] font-mono font-bold text-blue-600 dark:text-blue-400 print:text-black ml-1">
                      • {totalRealizadas} <span className="text-[9px] print:text-[6.5pt] font-sans font-normal text-zinc-500 print:text-black uppercase">realizadas</span>
                    </span>
                  )}
                </div>
                <div className="text-[9px] print:text-[6.5pt] text-zinc-500 print:text-black leading-tight">Registrados no ponto ou validados pelo coordenador</div>
              </div>
              <div className="rounded-xl border border-orange-200 dark:border-orange-900/50 bg-orange-50/60 dark:bg-orange-950/20 print:bg-transparent p-2.5 print:p-1.5">
                <div className="text-[9px] print:text-[7pt] font-black uppercase tracking-wider text-orange-700 dark:text-orange-400 print:text-black">Em avaliação</div>
                <div className="text-base print:text-[9pt] font-black text-orange-700 dark:text-orange-400 print:text-black">{emAvaliacaoHoras}h</div>
                <div className="text-[9px] print:text-[6.5pt] text-zinc-500 print:text-black leading-tight">
                  {qtdEmAvaliacao} plantão(ões) sem registro completo — não entram na carga
                </div>
              </div>
              <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 print:bg-transparent p-2.5 print:p-1.5">
                <div className="text-[9px] print:text-[7pt] font-black uppercase tracking-wider text-red-700 dark:text-red-400 print:text-black">Faltas</div>
                <div className="text-base print:text-[9pt] font-black text-red-700 dark:text-red-400 print:text-black">{qtdFaltas}</div>
                <div className="text-[9px] print:text-[6.5pt] text-zinc-500 print:text-black leading-tight">
                  {faltasHoras}h de plantão escalado e não cumprido
                </div>
              </div>
            </div>
          )}

          {/*
            Sem o desfecho, o documento volta a ser o de antes (soma tudo). Isso precisa estar
            ESCRITO nele: quem assina tem que saber qual dos dois anexos tem na mao.
          */}
          {dados.desfechoIndisponivel && (
            <p className="mt-2 text-[10px] print:text-[7pt] font-bold text-amber-700 dark:text-amber-400 print:text-black">
              ⚠️ A conferência de cumprimento não pôde ser calculada nesta emissão. A carga acima
              corresponde ao total ESCALADO, sem separar o que foi efetivamente registrado.
            </p>
          )}
        </div>

        {/* SEÇÃO 2: SOBREAVISOS */}
        <div className="anexo-section mb-8 print:mb-6">
          <div className="anexo-section-title flex items-center justify-between mb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white print:text-black flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-emerald-600 dark:text-emerald-400 print:hidden" />
              2. Escala de Sobreavisos e Acionamentos Presenciais ({sobreavisos.length} escala(s))
            </h3>
            <span className="text-[10px] font-bold text-zinc-500 print:text-black uppercase">
              Prontidão cumprida: {totalHorasSobreaviso}h
              {(dados.totalHorasSobreavisoEscalado ?? totalHorasSobreaviso) !== totalHorasSobreaviso &&
                <> de {dados.totalHorasSobreavisoEscalado}h</>} • Acionamentos: {totalAcionamentos}
            </span>
          </div>

          {sobreavisos.length > 0 ? (
            <div className="anexo-table-wrap overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
              <table className="anexo-table w-full text-xs text-left border-collapse print:text-[8pt]">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-bold uppercase text-[9px] print:text-[7.5pt] print:bg-zinc-200 print:text-black border-b border-zinc-200 dark:border-zinc-700">
                    <th className="py-2 px-3 text-center w-9">Dia</th>
                    <th className="py-2 px-3 text-center w-9">Sem</th>
                    <th className="py-2 px-3">Escala de Prontidão</th>
                    <th className="py-2 px-3 text-center">Horário Previsto</th>
                    <th className="py-2 px-3 text-center w-14">Horas Prontidão</th>
                    <th className="py-2 px-2 w-28">Setor</th>
                    <th className="py-2 px-3 min-w-[180px]">Acionamento Presencial (Chamado / Chegada / Saída)</th>
                    <th className="py-2 px-3">Motivo / Justificativa do Atendimento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {sobreavisos.map((s, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 print:hover:bg-transparent">
                      <td className="py-2 px-3 text-center font-bold">{String(s.dia).padStart(2, '0')}</td>
                      <td className="py-2 px-3 text-center text-zinc-500 print:text-black uppercase font-semibold">{s.dia_semana}</td>
                      <td className="py-2 px-3 font-bold text-zinc-900 dark:text-white print:text-black uppercase">{s.turno_nome}</td>
                      <td className="py-2 px-3 text-center font-mono text-zinc-600 dark:text-zinc-400 print:text-black">{s.horario_previsto}</td>
                      <td className="py-2 px-3 text-center font-bold text-emerald-600 dark:text-emerald-400 print:text-black">{s.horas_prontidao}h</td>
                      <td className="py-2 px-2 text-zinc-600 dark:text-zinc-400 print:text-black uppercase text-[10px] print:text-[7.5pt] font-medium leading-tight break-words max-w-[110px]">{s.setor}</td>
                      <td className="py-2 px-3">
                        {s.acionamentos.length > 0 ? (
                          <div className="space-y-1.5 print:space-y-1">
                            {s.acionamentos.map((ac: any, acIdx: number) => (
                              <div key={acIdx} className="bg-zinc-50 dark:bg-zinc-800/60 print:bg-transparent p-1.5 rounded-lg border border-zinc-200/80 dark:border-zinc-700/80 print:border-none print:p-0">
                                <div className="font-mono text-[10px] print:text-[7.5pt] font-bold text-zinc-800 dark:text-zinc-200 print:text-black flex flex-wrap items-center gap-x-2">
                                  <span className="text-violet-600 dark:text-violet-400 print:text-black">Chamado: {ac.hora_acionamento}</span>
                                  {ac.hora_chegada && ac.hora_chegada !== '-' && (
                                    <span className="text-emerald-600 dark:text-emerald-400 print:text-black">• Chegada: {ac.hora_chegada}</span>
                                  )}
                                  {ac.hora_saida && ac.hora_saida !== '-' && (
                                    <span className="text-blue-600 dark:text-blue-400 print:text-black">• Saída: {ac.hora_saida}</span>
                                  )}
                                </div>
                                {ac.destino && (
                                  <div className="text-[9px] print:text-[7pt] text-zinc-500 print:text-zinc-700 font-sans font-medium mt-0.5">
                                    Destino: {ac.destino}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-zinc-400 print:text-zinc-600 italic">Disponível sem acionamento presencial</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-zinc-600 dark:text-zinc-300 print:text-black leading-tight">
                        {s.acionamentos.length > 0 ? (
                          <div className="space-y-1">
                            {s.acionamentos.map((ac: any, acIdx: number) => (
                              <div key={acIdx} className="text-xs print:text-[7.5pt]">
                                <span className="font-semibold text-zinc-900 dark:text-white print:text-black">{ac.motivo}</span>
                                {ac.status && (
                                  <span className="ml-1 text-[9px] print:text-[7pt] font-bold text-emerald-600 dark:text-emerald-400 print:text-black uppercase">({ac.status})</span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-zinc-400 print:text-zinc-600 italic">Cumprimento regular do período de prontidão</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400 print:text-zinc-600">
              Nenhuma escala de sobreaviso cadastrada para este servidor nesta competência.
            </div>
          )}
        </div>

        {/* TOTALIZADORES CONSOLIDADOS */}
        <div className="anexo-summary-box p-4 md:p-5 rounded-2xl bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 mb-8 print:border-zinc-300 print:p-3 print:mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-700 print:grid-cols-6 print:divide-y-0 print:divide-x print:divide-zinc-300">
            <div className="text-center pt-2 sm:pt-0">
              <div className="text-[9px] print:text-[7.5pt] font-bold text-zinc-500 print:text-zinc-700 uppercase tracking-wider">Plantões Cumpridos</div>
              {/* Contava TODAS as escalas ao lado de um total de horas que já era só o cumprido.
                  A contagem tem que fechar com as horas — e o "de N escaladas" mantém a
                  conferência possível sem afirmar que as N foram prestadas. */}
              <div className="text-xl md:text-2xl print:text-lg font-black text-zinc-900 dark:text-white print:text-black mt-0.5">{plantoesCumpridos.length}</div>
              <div className="text-[9px] print:text-[7pt] font-medium text-zinc-400 print:text-zinc-600 uppercase">
                {plantoes.length !== plantoesCumpridos.length ? <>de {plantoes.length} escalada(s)</> : <>escala(s)</>}
              </div>
            </div>
            <div className="text-center pt-2 sm:pt-0 sm:pl-3 print:pl-2">
              <div className="text-[9px] print:text-[7.5pt] font-bold text-zinc-500 print:text-zinc-700 uppercase tracking-wider">Horas Previstas</div>
              <div className="text-xl md:text-2xl print:text-lg font-black text-zinc-900 dark:text-white print:text-black mt-0.5">{cumpridas}h</div>
              <div className="text-[9px] print:text-[7pt] font-medium text-zinc-400 print:text-zinc-600 uppercase">
                cumpridas{totalHorasPlantao !== cumpridas && <> de {totalHorasPlantao}h</>}
              </div>
            </div>
            <div className="text-center pt-2 sm:pt-0 sm:pl-3 print:pl-2">
              <div className="text-[9px] print:text-[7.5pt] font-bold text-zinc-500 print:text-zinc-700 uppercase tracking-wider">Horas Realizadas</div>
              <div className="text-xl md:text-2xl print:text-lg font-black font-mono text-blue-600 dark:text-blue-400 print:text-black mt-0.5">{totalRealizadas || '0h'}</div>
              <div className="text-[9px] print:text-[7pt] font-medium text-zinc-400 print:text-zinc-600 uppercase">
                apuradas no ponto
              </div>
            </div>
            <div className="text-center pt-2 sm:pt-0 sm:pl-3 print:pl-2">
              <div className="text-[9px] print:text-[7.5pt] font-bold text-zinc-500 print:text-zinc-700 uppercase tracking-wider">Sobreavisos Cumpridos</div>
              <div className="text-xl md:text-2xl print:text-lg font-black text-zinc-900 dark:text-white print:text-black mt-0.5">{sobreavisosCumpridos.length}</div>
              <div className="text-[9px] print:text-[7pt] font-medium text-zinc-400 print:text-zinc-600 uppercase">
                {sobreavisos.length !== sobreavisosCumpridos.length ? <>de {sobreavisos.length} escalada(s)</> : <>escala(s)</>}
              </div>
            </div>
            <div className="text-center pt-2 sm:pt-0 sm:pl-3 print:pl-2">
              <div className="text-[9px] print:text-[7.5pt] font-bold text-zinc-500 print:text-zinc-700 uppercase tracking-wider">Horas de Sobreaviso</div>
              <div className="text-xl md:text-2xl print:text-lg font-black text-emerald-600 dark:text-emerald-400 print:text-black mt-0.5">{totalHorasSobreaviso}h</div>
              <div className="text-[9px] print:text-[7pt] font-medium text-zinc-400 print:text-zinc-600 uppercase">prontidão</div>
            </div>
            <div className="text-center pt-2 sm:pt-0 sm:pl-3 print:pl-2 col-span-2 sm:col-span-1 print:col-span-1">
              <div className="text-[9px] print:text-[7.5pt] font-bold text-zinc-500 print:text-zinc-700 uppercase tracking-wider">Acionamentos</div>
              <div className="text-xl md:text-2xl print:text-lg font-black text-violet-600 dark:text-violet-400 print:text-black mt-0.5">{totalAcionamentos}</div>
              <div className="text-[9px] print:text-[7pt] font-medium text-zinc-400 print:text-zinc-600 uppercase">presenciais</div>
            </div>
          </div>

          {/* DETALHAMENTO DAS QUANTIDADES E HORAS INDIVIDUAIS POR TIPO */}
          {(resumoTiposPlantao.length > 0 || resumoTiposSobreaviso.length > 0) && (
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700/80 print:border-zinc-300 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-3 text-xs print:text-[7.5pt] print:pt-2 print:mt-2">
              {/* Detalhes de Plantões */}
              <div>
                <div className="text-[9px] print:text-[7pt] font-black uppercase text-zinc-500 print:text-zinc-700 tracking-wider mb-1.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 print:bg-black inline-block"></span>
                  Detalhamento dos Plantões ({plantoesCumpridos.length} escala{plantoesCumpridos.length !== 1 ? 's' : ''} cumprida{plantoesCumpridos.length !== 1 ? 's' : ''} • {cumpridas}h previstas{totalRealizadas ? ` • ${totalRealizadas} no ponto` : ''})
                </div>
                {resumoTiposPlantao.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {resumoTiposPlantao.map((item, idx) => (
                      <div key={idx} className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-700 dark:text-zinc-300 print:bg-white print:border-zinc-400 flex items-center gap-1.5 text-[10px] print:text-[7.5pt]">
                        <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.nome}</span>
                        {item.horario && <span className="text-zinc-400 print:text-zinc-600 font-mono text-[9px] print:text-[7pt]">({item.horario})</span>}:
                        <span className="font-bold text-blue-600 dark:text-blue-400 print:text-black">{item.qtd} escala{item.qtd > 1 ? 's' : ''}</span>
                        <span className="text-zinc-400 print:text-zinc-600">•</span>
                        <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.horas}h</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] print:text-[7.5pt] text-zinc-400 print:text-zinc-600 italic">Sem plantões no período.</div>
                )}
              </div>

              {/* Detalhes de Sobreavisos */}
              <div>
                <div className="text-[9px] print:text-[7pt] font-black uppercase text-zinc-500 print:text-zinc-700 tracking-wider mb-1.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 print:bg-black inline-block"></span>
                  Detalhamento dos Sobreavisos ({sobreavisosCumpridos.length} escala{sobreavisosCumpridos.length !== 1 ? 's' : ''} cumprida{sobreavisosCumpridos.length !== 1 ? 's' : ''} • {totalHorasSobreaviso}h)
                </div>
                {resumoTiposSobreaviso.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {resumoTiposSobreaviso.map((item, idx) => (
                      <div key={idx} className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-700 dark:text-zinc-300 print:bg-white print:border-zinc-400 flex items-center gap-1.5 text-[10px] print:text-[7.5pt]">
                        <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.nome}</span>
                        {item.horario && <span className="text-zinc-400 print:text-zinc-600 font-mono text-[9px] print:text-[7pt]">({item.horario})</span>}:
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 print:text-black">{item.qtd} escala{item.qtd > 1 ? 's' : ''}</span>
                        <span className="text-zinc-400 print:text-zinc-600">•</span>
                        <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.horas}h</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] print:text-[7.5pt] text-zinc-400 print:text-zinc-600 italic">Sem sobreavisos no período.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* TERMO DE DECLARAÇÃO E ASSINATURAS */}
        <div className="anexo-signatures-box border-t border-zinc-300 dark:border-zinc-700 pt-6 print:pt-4">
          <p className="text-[9px] print:text-[7.5pt] text-zinc-500 dark:text-zinc-400 print:text-zinc-700 leading-relaxed text-justify mb-8 print:mb-6">
            Atestamos que os plantões e períodos de sobreaviso acima relacionados foram efetivamente prestados e cumpridos pelo servidor, em conformidade com as escalas mensais aprovadas pela Secretaria Municipal de Saúde de Marabá e as normas da Portaria MTP nº 671/2021.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center print:grid-cols-3 print:gap-6">
            <div className="space-y-1">
              <div className="border-t border-zinc-400 dark:border-zinc-600 print:border-zinc-600 pt-2">
                <div className="text-[10px] print:text-[8pt] font-black uppercase text-zinc-900 dark:text-white print:text-black">{servidor?.nome}</div>
                <div className="text-[8px] print:text-[6.5pt] text-zinc-400 print:text-zinc-600 uppercase tracking-wider">Assinatura do Servidor / Plantonista</div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="border-t border-zinc-400 dark:border-zinc-600 print:border-zinc-600 pt-2">
                <div className="text-[10px] print:text-[8pt] font-black uppercase text-zinc-900 dark:text-white print:text-black">Coordenação de Escalas</div>
                <div className="text-[8px] print:text-[6.5pt] text-zinc-400 print:text-zinc-600 uppercase tracking-wider">Visto e Conferência</div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="border-t border-zinc-400 dark:border-zinc-600 print:border-zinc-600 pt-2">
                <div className="text-[10px] print:text-[8pt] font-black uppercase text-zinc-900 dark:text-white print:text-black">Direção Técnica / Gerência</div>
                <div className="text-[8px] print:text-[6.5pt] text-zinc-400 print:text-zinc-600 uppercase tracking-wider">Carimbo e Homologação</div>
              </div>
            </div>
          </div>

          <div className="text-right text-[7px] print:text-[6pt] text-zinc-400 print:text-zinc-500 mt-6 print:mt-4">
            SisEscala • Documento emitido digitalmente em {formatarData(new Date())} às {formatarHoraComSegundos(new Date())}.
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
