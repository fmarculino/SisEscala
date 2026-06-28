'use client'

import { useState } from 'react'
import { TrendingUp, Award, BarChart3, AlertCircle } from 'lucide-react'

export interface MonthData {
  monthYearLabel: string
  monthVal: number
  anoVal: number
  plantaoHours: number
  sobreavisoScheduledHours: number
  sobreavisoActivatedHours: number
  overloadCount: number
}

export interface CargoData {
  cargo: string
  plantaoHours: number
  sobreavisoHours: number
}

interface ChartsProps {
  monthlyTrend: MonthData[]
  cargoDistribution: CargoData[]
  totalSobreavisoScheduled: number
  totalSobreavisoActivated: number
  focusRegime: string
}

export function DiagnosticsCharts({ monthlyTrend, cargoDistribution, totalSobreavisoScheduled, totalSobreavisoActivated, focusRegime }: ChartsProps) {
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number
    y: number
    label: string
    value: string
    type: string
  } | null>(null)

  // 1. Line Chart Setup (Trend over time)
  const chartHeight = 220
  const chartWidth = 500
  const paddingLeft = 50
  const paddingRight = 20
  const paddingTop = 20
  const paddingBottom = 40

  const xRange = chartWidth - paddingLeft - paddingRight
  const yRange = chartHeight - paddingTop - paddingBottom

  // Find max value to scale Y axis
  const maxVal = Math.max(
    ...monthlyTrend.map(d => {
      const vals = []
      if (focusRegime === 'todos' || focusRegime === 'plantoes') vals.push(d.plantaoHours)
      if (focusRegime === 'todos' || focusRegime === 'sobreavisos') {
        vals.push(d.sobreavisoScheduledHours)
        vals.push(d.sobreavisoActivatedHours)
      }
      return Math.max(...vals, 100)
    })
  )

  const stepsY = 4
  const yGridValues = Array.from({ length: stepsY + 1 }, (_, i) => Math.round((maxVal / stepsY) * i))

  const getCoordinates = (index: number, value: number) => {
    if (monthlyTrend.length <= 1) {
      return {
        x: paddingLeft + xRange / 2,
        y: chartHeight - paddingBottom - (value / maxVal) * yRange
      }
    }
    const x = paddingLeft + (index / (monthlyTrend.length - 1)) * xRange
    const y = chartHeight - paddingBottom - (value / maxVal) * yRange
    return { x, y }
  }

  // Draw paths
  const generatePath = (key: 'plantaoHours' | 'sobreavisoScheduledHours' | 'sobreavisoActivatedHours') => {
    if (monthlyTrend.length === 0) return ''
    return monthlyTrend.map((d, i) => {
      const { x, y } = getCoordinates(i, d[key])
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')
  }

  const plantaoPath = generatePath('plantaoHours')
  const sobreavisoScheduledPath = generatePath('sobreavisoScheduledHours')
  const sobreavisoActivatedPath = generatePath('sobreavisoActivatedHours')

  // 2. Bar Chart Setup (Cargo Distribution)
  const maxCargoVal = Math.max(
    ...cargoDistribution.map(c => c.plantaoHours + c.sobreavisoHours),
    50
  )

  // 3. Activation rate donut logic
  const activationRate = totalSobreavisoScheduled > 0 
    ? (totalSobreavisoActivated / totalSobreavisoScheduled) * 100 
    : 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Trend chart */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-600" />
            <h3 className="font-black text-zinc-900 dark:text-white uppercase text-xs tracking-widest">Evolução Mensal de Horas</h3>
          </div>
          <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-zinc-500">
            {(focusRegime === 'todos' || focusRegime === 'plantoes') && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                <span>Plantões</span>
              </div>
            )}
            {(focusRegime === 'todos' || focusRegime === 'sobreavisos') && (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                  <span>Sobreaviso (Escalado)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
                  <span>Sobreaviso (Acionado)</span>
                </div>
              </>
            )}
          </div>
        </div>

        {monthlyTrend.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-zinc-400 text-xs uppercase font-bold tracking-widest">
            Sem dados no período
          </div>
        ) : (
          <div className="relative">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto overflow-visible">
              {/* Y Axis Grid Lines */}
              {yGridValues.map((val, i) => {
                const y = chartHeight - paddingBottom - (val / maxVal) * yRange
                return (
                  <g key={i} className="opacity-40">
                    <line 
                      x1={paddingLeft} 
                      y1={y} 
                      x2={chartWidth - paddingRight} 
                      y2={y} 
                      stroke="currentColor" 
                      strokeDasharray="4 4" 
                      className="text-zinc-200 dark:text-zinc-800"
                    />
                    <text 
                      x={paddingLeft - 8} 
                      y={y + 4} 
                      textAnchor="end" 
                      className="fill-zinc-400 font-mono text-[9px]"
                    >
                      {val}h
                    </text>
                  </g>
                )
              })}

              {/* X Axis labels */}
              {monthlyTrend.map((d, i) => {
                const { x } = getCoordinates(i, 0)
                return (
                  <text 
                    key={i} 
                    x={x} 
                    y={chartHeight - paddingBottom + 16} 
                    textAnchor="middle" 
                    className="fill-zinc-500 font-bold text-[9px]"
                  >
                    {d.monthYearLabel}
                  </text>
                )
              })}

              {/* Trend Lines */}
              {(focusRegime === 'todos' || focusRegime === 'plantoes') && (
                <path 
                  d={plantaoPath} 
                  fill="none" 
                  stroke="#10B981" 
                  strokeWidth="2.5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
              )}

              {(focusRegime === 'todos' || focusRegime === 'sobreavisos') && (
                <>
                  <path 
                    d={sobreavisoScheduledPath} 
                    fill="none" 
                    stroke="#3B82F6" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />
                  <path 
                    d={sobreavisoActivatedPath} 
                    fill="none" 
                    stroke="#F43F5E" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />
                </>
              )}

              {/* Hover circles */}
              {monthlyTrend.map((d, i) => {
                const coordPlantao = getCoordinates(i, d.plantaoHours)
                const coordSch = getCoordinates(i, d.sobreavisoScheduledHours)
                const coordAct = getCoordinates(i, d.sobreavisoActivatedHours)

                return (
                  <g key={i}>
                    {/* Plantão interactive points */}
                    {(focusRegime === 'todos' || focusRegime === 'plantoes') && (
                      <circle 
                        cx={coordPlantao.x} 
                        cy={coordPlantao.y} 
                        r="4" 
                        className="fill-emerald-500 stroke-white dark:stroke-zinc-950 stroke-2 hover:r-6 transition-all cursor-pointer"
                        onMouseEnter={(e) => setHoveredPoint({
                          x: coordPlantao.x,
                          y: coordPlantao.y,
                          label: d.monthYearLabel,
                          value: `${d.plantaoHours}h`,
                          type: 'Plantões'
                        })}
                        onMouseLeave={() => setHoveredPoint(null)}
                      />
                    )}

                    {/* Sobreaviso Scheduled points */}
                    {(focusRegime === 'todos' || focusRegime === 'sobreavisos') && (
                      <>
                        <circle 
                          cx={coordSch.x} 
                          cy={coordSch.y} 
                          r="4" 
                          className="fill-blue-500 stroke-white dark:stroke-zinc-950 stroke-2 hover:r-6 transition-all cursor-pointer"
                          onMouseEnter={(e) => setHoveredPoint({
                            x: coordSch.x,
                            y: coordSch.y,
                            label: d.monthYearLabel,
                            value: `${d.sobreavisoScheduledHours}h`,
                            type: 'Sobreaviso Escalado'
                          })}
                          onMouseLeave={() => setHoveredPoint(null)}
                        />
                        <circle 
                          cx={coordAct.x} 
                          cy={coordAct.y} 
                          r="4" 
                          className="fill-rose-500 stroke-white dark:stroke-zinc-950 stroke-2 hover:r-6 transition-all cursor-pointer"
                          onMouseEnter={(e) => setHoveredPoint({
                            x: coordAct.x,
                            y: coordAct.y,
                            label: d.monthYearLabel,
                            value: `${d.sobreavisoActivatedHours}h`,
                            type: 'Sobreaviso Acionado'
                          })}
                          onMouseLeave={() => setHoveredPoint(null)}
                        />
                      </>
                    )}
                  </g>
                )
              })}
            </svg>

            {/* Custom Tooltip */}
            {hoveredPoint && (
              <div 
                className="absolute z-10 bg-zinc-950/90 text-white px-3 py-2 rounded-xl text-[10px] space-y-0.5 shadow-xl pointer-events-none -translate-x-1/2 -translate-y-full mb-2"
                style={{ left: `${(hoveredPoint.x / chartWidth) * 100}%`, top: `${(hoveredPoint.y / chartHeight) * 100}%` }}
              >
                <div className="font-black text-zinc-400 uppercase tracking-widest">{hoveredPoint.label}</div>
                <div className="flex items-center gap-1.5 font-bold">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    hoveredPoint.type === 'Plantões' ? 'bg-emerald-500' :
                    hoveredPoint.type === 'Sobreaviso Escalado' ? 'bg-blue-500' : 'bg-rose-500'
                  }`}></span>
                  <span>{hoveredPoint.type}: {hoveredPoint.value}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Activation rate analysis / diagnostics */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm flex flex-col justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-indigo-600" />
            <h3 className="font-black text-zinc-900 dark:text-white uppercase text-xs tracking-widest">Taxa de Acionamento</h3>
          </div>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Mede o percentual de horas de sobreaviso planejadas que foram convertidas em trabalho efetivo.
          </p>
        </div>

        {totalSobreavisoScheduled === 0 ? (
          <div className="py-8 text-center text-zinc-400 text-xs font-bold uppercase tracking-widest">
            Sem horas de sobreaviso
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 gap-6">
            {/* Donut Chart representation */}
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                <path
                  className="text-zinc-100 dark:text-zinc-800"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className={activationRate > 30 ? "text-rose-500" : "text-indigo-600"}
                  strokeDasharray={`${activationRate}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-black text-zinc-900 dark:text-white">{activationRate.toFixed(1)}%</span>
                <span className="text-[7px] text-zinc-400 uppercase font-bold">Acionamentos</span>
              </div>
            </div>

            <div className="space-y-3 text-[10px]">
              <div>
                <span className="block text-zinc-400 uppercase font-black tracking-widest">Escalado</span>
                <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{totalSobreavisoScheduled} horas</span>
              </div>
              <div>
                <span className="block text-zinc-400 uppercase font-black tracking-widest">Acionado</span>
                <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{totalSobreavisoActivated} horas</span>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 flex gap-2">
          {activationRate > 30 ? (
            <div className="flex gap-2 text-rose-600 bg-rose-50 dark:bg-rose-950/20 p-3 rounded-2xl w-full">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <div className="text-[10px] leading-snug">
                <strong className="block uppercase font-black">Foco de Risco de RH</strong>
                Taxa de acionamento acima de 30% indica sobreuso do sobreaviso. Recomendamos abrir mais vagas de plantão efetivo.
              </div>
            </div>
          ) : (
            <div className="flex gap-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 p-3 rounded-2xl w-full">
              <Award className="h-5 w-5 shrink-0" />
              <div className="text-[10px] leading-snug">
                <strong className="block uppercase font-black">Sobreaviso Saudável</strong>
                Acionamentos sob controle no período. Menor fadiga e conformidade orçamentária mantida.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cargo distribution chart */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl shadow-sm lg:col-span-3 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-indigo-600" />
          <h3 className="font-black text-zinc-900 dark:text-white uppercase text-xs tracking-widest">Distribuição por Categoria/Cargo</h3>
        </div>

        {cargoDistribution.length === 0 ? (
          <div className="py-12 text-center text-zinc-400 text-xs font-bold uppercase tracking-widest">
            Nenhum cargo encontrado
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {cargoDistribution.map((item, i) => {
                const total = item.plantaoHours + item.sobreavisoHours
                const pctPlantao = total > 0 ? (item.plantaoHours / total) * 100 : 0
                const pctSobreaviso = total > 0 ? (item.sobreavisoHours / total) * 100 : 0
                const barWidth = (total / maxCargoVal) * 100

                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200 uppercase truncate max-w-[200px]">{item.cargo}</span>
                      <span className="font-black text-zinc-500 font-mono">{total}h <span className="text-[9px] font-normal">({item.plantaoHours}h PL / {item.sobreavisoHours}h SO)</span></span>
                    </div>
                    <div className="h-3 bg-zinc-50 dark:bg-zinc-800 rounded-full overflow-hidden flex" style={{ width: `${barWidth}%`, minWidth: '10%' }}>
                      <div className="bg-emerald-500 h-full" style={{ width: `${pctPlantao}%` }} title={`Plantão: ${item.plantaoHours}h`}></div>
                      <div className="bg-blue-500 h-full" style={{ width: `${pctSobreaviso}%` }} title={`Sobreaviso: ${item.sobreavisoHours}h`}></div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-2xl flex flex-col justify-center gap-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Guia de Gestão</h4>
              <p className="text-[10.5px] text-zinc-500 leading-relaxed">
                Este gráfico compara a distribuição de horas especiais entre os cargos profissionais. Identifique desequilíbrios setoriais onde determinadas funções acumulam grande volume de trabalho enquanto outras permanecem subutilizadas.
              </p>
              <div className="flex gap-4 text-[9px] font-black uppercase tracking-widest">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500"></span> Plantão (PL)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500"></span> Sobreaviso (SO)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
