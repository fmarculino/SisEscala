'use client'

import React, { useMemo } from 'react'
import { Printer, Calendar, Clock, ShieldCheck, PhoneCall, AlertCircle, Building2, Layers } from 'lucide-react'

interface PlantaoItem {
  dia: number
  dia_semana: string
  data_formatada: string
  turno_nome: string
  horario_previsto: string
  horas_computadas: number
  entrada_real: string
  saida_real: string
  confirmado: boolean
  unidade: string
  setor: string
  ajuste_manual?: boolean
  observacao?: string
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
  acionamentos: Array<{
    hora_acionamento: string
    hora_chegada: string
    hora_saida: string
    motivo: string
    status: string
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
    totalHorasSobreaviso: number
    totalAcionamentos: number
  }
  onClose?: () => void
}

export function RelatorioPlantaoSobreavisoAnexo({ dados, onClose }: Props) {
  const { servidor, mes, ano, plantoes, sobreavisos, totalHorasPlantao, totalHorasSobreaviso, totalAcionamentos } = dados

  const nomeMes = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' }).toUpperCase()
  const unidadeNome = servidor?.unidades?.nome || 'SECRETARIA MUNICIPAL DE SAÚDE'
  const setorNome = servidor?.setores?.dicionario_setores?.nome || 'SETOR GERAL'

  // Resumo agrupado por tipo individual de plantão
  const resumoTiposPlantao = useMemo(() => {
    const map = new Map<string, { nome: string; horario: string; qtd: number; horas: number }>()
    plantoes.forEach(p => {
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
  const resumoTiposSobreaviso = useMemo(() => {
    const map = new Map<string, { nome: string; horario: string; qtd: number; horas: number }>()
    sobreavisos.forEach(s => {
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

  return (
    <div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-10 max-w-5xl mx-auto rounded-3xl shadow-xl print:shadow-none print:p-0 print:max-w-none">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body {
            background: white !important;
            color: black !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .dashboard-layout-nav, .sidebar-container, header, footer, button, nav {
            display: none !important;
          }
          .print-full-width {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print-border-black {
            border-color: #333 !important;
          }
        }
      `}</style>

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
              className="px-4 py-2 text-xs font-bold rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer"
            >
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
      <div className="border border-zinc-300 dark:border-zinc-700 rounded-2xl p-6 bg-zinc-50/50 dark:bg-zinc-800/30 print:bg-white print:border-zinc-400 print:p-4 mb-6">
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 pb-4 mb-4 print:pb-3 print:mb-3">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600/10 dark:bg-blue-400/10 flex items-center justify-center print:hidden">
              <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Prefeitura Municipal de Marabá • Secretaria Municipal de Saúde</div>
              <h1 className="text-lg md:text-xl font-black uppercase text-zinc-900 dark:text-white print:text-black tracking-tight">
                Anexo à Folha de Ponto — Plantões e Sobreavisos
              </h1>
              <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
                Comprovante Oficial de Escalas Diferenciadas • Portaria MTP 671/2021
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Competência</div>
            <div className="text-base md:text-lg font-black text-zinc-900 dark:text-white print:text-black uppercase">
              {nomeMes} / {ano}
            </div>
          </div>
        </div>

        {/* Servidor Metadata */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs print:grid-cols-4 print:text-[8px]">
          <div>
            <div className="text-[9px] font-bold text-zinc-400 uppercase">Servidor</div>
            <div className="font-black text-zinc-900 dark:text-white print:text-black uppercase">{servidor?.nome}</div>
            <div className="text-[10px] text-zinc-500 font-mono font-semibold">Mat: {servidor?.matricula || '---'}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold text-zinc-400 uppercase">Cargo / Vínculo</div>
            <div className="font-bold text-zinc-900 dark:text-white print:text-black uppercase">{servidor?.cargo || '---'}</div>
            <div className="text-[10px] text-zinc-500 uppercase">{servidor?.vinculo || 'CONTRATADO/EFETIVO'}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold text-zinc-400 uppercase">Unidade de Lotação</div>
            <div className="font-bold text-zinc-900 dark:text-white print:text-black uppercase truncate">{unidadeNome}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold text-zinc-400 uppercase">Setor de Atuação</div>
            <div className="font-bold text-zinc-900 dark:text-white print:text-black uppercase truncate">{setorNome}</div>
          </div>
        </div>
      </div>

      {/* SEÇÃO 1: PLANTÕES */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white print:text-black flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            1. Escala de Plantões Executados ({plantoes.length} plantão(ões))
          </h3>
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Carga Horária Total: {totalHorasPlantao}h</span>
        </div>

        {plantoes.length > 0 ? (
          <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <table className="w-full text-xs text-left border-collapse print:text-[8px]">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-bold uppercase text-[9px] print:bg-zinc-200 print:text-black border-b border-zinc-200 dark:border-zinc-700">
                  <th className="py-2 px-3 text-center w-12">Dia</th>
                  <th className="py-2 px-3 text-center w-12">Sem</th>
                  <th className="py-2 px-3">Turno / Escala</th>
                  <th className="py-2 px-3 text-center">Horário Previsto</th>
                  <th className="py-2 px-3 text-center">Entrada Real</th>
                  <th className="py-2 px-3 text-center">Saída Real</th>
                  <th className="py-2 px-3 text-center">Horas</th>
                  <th className="py-2 px-3">Setor</th>
                  <th className="py-2 px-3">Observações / Justificativas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {plantoes.map((p, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 print:hover:bg-transparent">
                    <td className="py-2 px-3 text-center font-bold">{String(p.dia).padStart(2, '0')}</td>
                    <td className="py-2 px-3 text-center text-zinc-500 uppercase font-semibold">{p.dia_semana}</td>
                    <td className="py-2 px-3 font-bold text-zinc-900 dark:text-white print:text-black uppercase">{p.turno_nome}</td>
                    <td className="py-2 px-3 text-center font-mono text-zinc-600 dark:text-zinc-400 print:text-black">{p.horario_previsto}</td>
                    <td className="py-2 px-3 text-center font-mono font-bold text-blue-600 dark:text-blue-400 print:text-black">{p.entrada_real}</td>
                    <td className="py-2 px-3 text-center font-mono font-bold text-blue-600 dark:text-blue-400 print:text-black">{p.saida_real}</td>
                    <td className="py-2 px-3 text-center font-bold text-zinc-900 dark:text-white print:text-black">{p.horas_computadas}h</td>
                    <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400 print:text-black uppercase truncate max-w-[150px]">{p.setor}</td>
                    <td className="py-2 px-3 text-zinc-500 print:text-black italic">
                      {p.ajuste_manual ? 'Ajuste Manual Validado • ' : ''}
                      {p.observacao || (p.confirmado ? 'Presença confirmada no ponto' : 'Em validação')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400">
            Nenhum plantão regular ou extra cadastrado para este servidor nesta competência.
          </div>
        )}
      </div>

      {/* SEÇÃO 2: SOBREAVISOS */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-white print:text-black flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            2. Escala de Sobreavisos e Acionamentos Presenciais ({sobreavisos.length} escala(s))
          </h3>
          <span className="text-[10px] font-bold text-zinc-500 uppercase">
            Prontidão: {totalHorasSobreaviso}h • Acionamentos: {totalAcionamentos}
          </span>
        </div>

        {sobreavisos.length > 0 ? (
          <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <table className="w-full text-xs text-left border-collapse print:text-[8px]">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-bold uppercase text-[9px] print:bg-zinc-200 print:text-black border-b border-zinc-200 dark:border-zinc-700">
                  <th className="py-2 px-3 text-center w-12">Dia</th>
                  <th className="py-2 px-3 text-center w-12">Sem</th>
                  <th className="py-2 px-3">Escala de Prontidão</th>
                  <th className="py-2 px-3 text-center">Horário Previsto</th>
                  <th className="py-2 px-3 text-center">Horas Prontidão</th>
                  <th className="py-2 px-3">Setor</th>
                  <th className="py-2 px-3">Acionamento Presencial (Chamado / Chegada / Saída)</th>
                  <th className="py-2 px-3">Motivo / Justificativa do Atendimento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {sobreavisos.map((s, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 print:hover:bg-transparent">
                    <td className="py-2 px-3 text-center font-bold">{String(s.dia).padStart(2, '0')}</td>
                    <td className="py-2 px-3 text-center text-zinc-500 uppercase font-semibold">{s.dia_semana}</td>
                    <td className="py-2 px-3 font-bold text-zinc-900 dark:text-white print:text-black uppercase">{s.turno_nome}</td>
                    <td className="py-2 px-3 text-center font-mono text-zinc-600 dark:text-zinc-400 print:text-black">{s.horario_previsto}</td>
                    <td className="py-2 px-3 text-center font-bold text-emerald-600 dark:text-emerald-400 print:text-black">{s.horas_prontidao}h</td>
                    <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400 print:text-black uppercase truncate max-w-[140px]">{s.setor}</td>
                    <td className="py-2 px-3">
                      {s.acionamentos.length > 0 ? (
                        <div className="space-y-1">
                          {s.acionamentos.map((ac, acIdx) => (
                            <div key={acIdx} className="font-mono text-[10px] print:text-[8px] font-bold text-zinc-800 dark:text-zinc-200 print:text-black">
                              Chamado: {ac.hora_acionamento} • Chegada: {ac.hora_chegada} • Término: {ac.hora_saida}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-zinc-400 italic">Disponível sem acionamento presencial</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-zinc-500 print:text-black italic">
                      {s.acionamentos.length > 0 ? (
                        s.acionamentos.map((ac, acIdx) => <div key={acIdx}>{ac.motivo}</div>)
                      ) : (
                        'Cumprimento regular do período de prontidão'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400">
            Nenhuma escala de sobreaviso cadastrada para este servidor nesta competência.
          </div>
        )}
      </div>

      {/* TOTALIZADORES CONSOLIDADOS */}
      <div className="p-4 md:p-5 rounded-2xl bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 mb-8 print:border-zinc-300 print:p-3 print:mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 md:gap-4 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-700">
          <div className="text-center pt-2 sm:pt-0">
            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Total de Plantões</div>
            <div className="text-xl md:text-2xl font-black text-zinc-900 dark:text-white print:text-black mt-0.5">{plantoes.length}</div>
            <div className="text-[9px] font-medium text-zinc-400 uppercase">escala(s)</div>
          </div>
          <div className="text-center pt-2 sm:pt-0 sm:pl-3">
            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Horas de Plantão</div>
            <div className="text-xl md:text-2xl font-black text-blue-600 dark:text-blue-400 print:text-black mt-0.5">{totalHorasPlantao}h</div>
            <div className="text-[9px] font-medium text-zinc-400 uppercase">computadas</div>
          </div>
          <div className="text-center pt-2 sm:pt-0 sm:pl-3">
            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Total de Sobreavisos</div>
            <div className="text-xl md:text-2xl font-black text-zinc-900 dark:text-white print:text-black mt-0.5">{sobreavisos.length}</div>
            <div className="text-[9px] font-medium text-zinc-400 uppercase">escala(s)</div>
          </div>
          <div className="text-center pt-2 sm:pt-0 sm:pl-3">
            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Horas de Sobreaviso</div>
            <div className="text-xl md:text-2xl font-black text-emerald-600 dark:text-emerald-400 print:text-black mt-0.5">{totalHorasSobreaviso}h</div>
            <div className="text-[9px] font-medium text-zinc-400 uppercase">prontidão</div>
          </div>
          <div className="text-center pt-2 sm:pt-0 sm:pl-3 col-span-2 sm:col-span-1">
            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Acionamentos</div>
            <div className="text-xl md:text-2xl font-black text-violet-600 dark:text-violet-400 print:text-black mt-0.5">{totalAcionamentos}</div>
            <div className="text-[9px] font-medium text-zinc-400 uppercase">presenciais</div>
          </div>
        </div>

        {/* DETALHAMENTO DAS QUANTIDADES E HORAS INDIVIDUAIS POR TIPO */}
        {(resumoTiposPlantao.length > 0 || resumoTiposSobreaviso.length > 0) && (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700/80 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs print:text-[8px] print:pt-2 print:mt-2">
            {/* Detalhes de Plantões */}
            <div>
              <div className="text-[9px] font-black uppercase text-zinc-500 tracking-wider mb-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>
                Detalhamento dos Plantões ({plantoes.length} escala{plantoes.length !== 1 ? 's' : ''} • {totalHorasPlantao}h)
              </div>
              {resumoTiposPlantao.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {resumoTiposPlantao.map((item, idx) => (
                    <div key={idx} className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-700 dark:text-zinc-300 print:border-zinc-300 flex items-center gap-1.5 text-[10px] print:text-[8px]">
                      <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.nome}</span>
                      {item.horario && <span className="text-zinc-400 font-mono text-[9px]">({item.horario})</span>}:
                      <span className="font-bold text-blue-600 dark:text-blue-400 print:text-black">{item.qtd} escala{item.qtd > 1 ? 's' : ''}</span>
                      <span className="text-zinc-400">•</span>
                      <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.horas}h</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-zinc-400 italic">Sem plantões no período.</div>
              )}
            </div>

            {/* Detalhes de Sobreavisos */}
            <div>
              <div className="text-[9px] font-black uppercase text-zinc-500 tracking-wider mb-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                Detalhamento dos Sobreavisos ({sobreavisos.length} escala{sobreavisos.length !== 1 ? 's' : ''} • {totalHorasSobreaviso}h)
              </div>
              {resumoTiposSobreaviso.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {resumoTiposSobreaviso.map((item, idx) => (
                    <div key={idx} className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-medium text-zinc-700 dark:text-zinc-300 print:border-zinc-300 flex items-center gap-1.5 text-[10px] print:text-[8px]">
                      <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.nome}</span>
                      {item.horario && <span className="text-zinc-400 font-mono text-[9px]">({item.horario})</span>}:
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 print:text-black">{item.qtd} escala{item.qtd > 1 ? 's' : ''}</span>
                      <span className="text-zinc-400">•</span>
                      <span className="font-bold text-zinc-900 dark:text-white print:text-black">{item.horas}h</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-zinc-400 italic">Sem sobreavisos no período.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* TERMO DE DECLARAÇÃO E ASSINATURAS */}
      <div className="border-t border-zinc-300 dark:border-zinc-700 pt-6 print:pt-4">
        <p className="text-[9px] text-zinc-500 dark:text-zinc-400 print:text-zinc-600 leading-relaxed text-justify mb-8 print:mb-6">
          Atestamos que os plantões e períodos de sobreaviso acima relacionados foram efetivamente prestados e cumpridos pelo servidor, em conformidade com as escalas mensais aprovadas pela Secretaria Municipal de Saúde de Marabá e as normas da Portaria MTP nº 671/2021.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center print:grid-cols-3 print:gap-6">
          <div className="space-y-1">
            <div className="border-t border-zinc-400 dark:border-zinc-600 pt-2">
              <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white print:text-black">{servidor?.nome}</div>
              <div className="text-[8px] text-zinc-400 uppercase tracking-wider">Assinatura do Servidor / Plantonista</div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="border-t border-zinc-400 dark:border-zinc-600 pt-2">
              <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white print:text-black">Coordenação de Escalas</div>
              <div className="text-[8px] text-zinc-400 uppercase tracking-wider">Visto e Conferência</div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="border-t border-zinc-400 dark:border-zinc-600 pt-2">
              <div className="text-[10px] font-black uppercase text-zinc-900 dark:text-white print:text-black">Direção Técnica / Gerência</div>
              <div className="text-[8px] text-zinc-400 uppercase tracking-wider">Carimbo e Homologação</div>
            </div>
          </div>
        </div>

        <div className="text-right text-[7px] text-zinc-400 mt-6 print:mt-4">
          SisEscala • Documento emitido digitalmente em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}.
        </div>
      </div>
    </div>
  )
}
