'use client'

import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus, Calendar } from 'lucide-react'

interface MonthData {
  label: string
  regular: number
  plantao: number
  sobreaviso: number
  extra: number
}

interface Props {
  data: MonthData[]
}

export function HistoricoChart({ data }: Props) {
  if (data.length === 0) return null

  const categories = [
    { key: 'regular' as const, label: 'Regular', color: 'bg-blue-500', darkColor: 'dark:bg-blue-400', textColor: 'text-blue-600 dark:text-blue-400' },
    { key: 'plantao' as const, label: 'Plantão', color: 'bg-emerald-500', darkColor: 'dark:bg-emerald-400', textColor: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'sobreaviso' as const, label: 'Sobreaviso', color: 'bg-amber-500', darkColor: 'dark:bg-amber-400', textColor: 'text-amber-600 dark:text-amber-400' },
    { key: 'extra' as const, label: 'Extra', color: 'bg-purple-500', darkColor: 'dark:bg-purple-400', textColor: 'text-purple-600 dark:text-purple-400' },
  ]

  // Default selected month: find last month with non-zero data, or fallback to latest month
  const defaultSelectedIdx = useMemo(() => {
    for (let i = data.length - 1; i >= 0; i--) {
      const d = data[i]
      if (d.regular > 0 || d.plantao > 0 || d.sobreaviso > 0 || d.extra > 0) {
        return i
      }
    }
    return data.length - 1
  }, [data])

  const [selectedIdx, setSelectedIdx] = useState<number>(defaultSelectedIdx)

  const selectedMonth = data[selectedIdx] || data[data.length - 1]
  const previousMonth = selectedIdx > 0 ? data[selectedIdx - 1] : null

  // Find max value across all data for scaling
  const allValues = data.flatMap(d => categories.map(c => d[c.key]))
  const rawMax = Math.max(...allValues, 10)
  
  // Nice round max for Y axis
  const maxValue = Math.ceil(rawMax / 100) * 100 || 100

  // Y-axis ticks (4 intervals)
  const yTicks = [
    maxValue,
    Math.round(maxValue * 0.75),
    Math.round(maxValue * 0.5),
    Math.round(maxValue * 0.25),
    0
  ]

  const formatHours = (val: number) => {
    if (val >= 1000) {
      const k = (val / 1000).toFixed(1).replace('.0', '')
      return `${k}k h`
    }
    return `${val}h`
  }

  const getTrend = (key: 'regular' | 'plantao' | 'sobreaviso' | 'extra') => {
    if (!previousMonth || previousMonth[key] === 0) return { pct: 0, direction: 'stable' as const }
    const pct = Math.round(((selectedMonth[key] - previousMonth[key]) / previousMonth[key]) * 100)
    return {
      pct: Math.abs(pct),
      direction: pct > 2 ? 'up' as const : pct < -2 ? 'down' as const : 'stable' as const
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Comparativo Histórico de Horas
          </h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
            Clique nos meses para alternar os dados exibidos nos cartões
          </p>
        </div>
        
        {/* Month Selector Pills */}
        <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/60 p-1 rounded-xl self-start sm:self-auto">
          {data.map((m, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedIdx(idx)}
              className={`px-3 py-1 text-xs font-bold uppercase rounded-lg transition-all ${
                selectedIdx === idx
                  ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Area with Y-Axis */}
      <div className="relative flex gap-3 h-52 mb-6 pt-2">
        {/* Y-Axis Labels */}
        <div className="flex flex-col justify-between text-[10px] font-bold text-zinc-400 dark:text-zinc-500 select-none pr-1 w-12 text-right">
          {yTicks.map((tick, i) => (
            <span key={i} className="leading-none">
              {formatHours(tick)}
            </span>
          ))}
        </div>

        {/* Gridlines + Bars Container */}
        <div className="relative flex-1 flex flex-col justify-between">
          {/* Background Horizontal Grid Lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {yTicks.map((_, i) => (
              <div key={i} className="border-b border-dashed border-zinc-200 dark:border-zinc-800/80 w-full" />
            ))}
          </div>

          {/* Month Columns */}
          <div className="relative flex items-end gap-4 h-full z-10 pb-6">
            {data.map((month, i) => {
              const isSelected = selectedIdx === i
              return (
                <div
                  key={i}
                  onClick={() => setSelectedIdx(i)}
                  className={`flex-1 flex flex-col items-center justify-end h-full cursor-pointer group rounded-xl p-1 transition-all ${
                    isSelected ? 'bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-500/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                  }`}
                >
                  <div className="flex items-end gap-1 w-full h-full">
                    {categories.map(cat => {
                      const val = month[cat.key]
                      const pctHeight = maxValue > 0 ? (val / maxValue) * 100 : 0
                      return (
                        <div key={cat.key} className="flex-1 flex flex-col justify-end h-full">
                          <div
                            className={`w-full ${cat.color} ${cat.darkColor} rounded-t transition-all duration-700 ease-out group-hover:brightness-110 min-h-[3px] shadow-sm`}
                            style={{ height: `${Math.max(pctHeight, val > 0 ? 4 : 2)}%` }}
                            title={`${month.label.toUpperCase()} - ${cat.label}: ${val}h`}
                          />
                        </div>
                      )
                    })}
                  </div>
                  <span className={`text-[11px] font-bold uppercase tracking-wider mt-2 transition-colors ${
                    isSelected ? 'text-blue-600 dark:text-blue-400 font-extrabold' : 'text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300'
                  }`}>
                    {month.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Selected Month Header Indicator */}
      <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/50 pt-4 mb-4">
        <div className="flex items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">
          <Calendar className="h-4 w-4 text-blue-500" />
          <span>Detalhamento: <span className="uppercase font-black text-blue-600 dark:text-blue-400">{selectedMonth.label}</span></span>
        </div>
        {previousMonth && (
          <span className="text-[10px] text-zinc-400">
            Comparado com {previousMonth.label.toUpperCase()}
          </span>
        )}
      </div>

      {/* Legend & Selected Month Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {categories.map(cat => {
          const trend = getTrend(cat.key)
          const val = selectedMonth[cat.key]
          return (
            <div key={cat.key} className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800/50">
              <div className={`w-3 h-3 rounded-full ${cat.color} shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 truncate">
                  {cat.label}
                </p>
                <p className="text-base font-black text-zinc-900 dark:text-white">
                  {val}h
                </p>
              </div>
              {previousMonth && (
                <div className={`flex items-center gap-0.5 text-[10px] font-bold ${
                  trend.direction === 'up' ? 'text-emerald-600 dark:text-emerald-400' :
                  trend.direction === 'down' ? 'text-red-500 dark:text-red-400' :
                  'text-zinc-400'
                }`}>
                  {trend.direction === 'up' && <TrendingUp className="w-3 h-3" />}
                  {trend.direction === 'down' && <TrendingDown className="w-3 h-3" />}
                  {trend.direction === 'stable' && <Minus className="w-3 h-3" />}
                  {trend.pct > 0 ? `${trend.pct}%` : '—'}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
