'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

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
    { key: 'regular' as const, label: 'Regular', color: 'bg-blue-500', darkColor: 'dark:bg-blue-400' },
    { key: 'plantao' as const, label: 'Plantão', color: 'bg-emerald-500', darkColor: 'dark:bg-emerald-400' },
    { key: 'sobreaviso' as const, label: 'Sobreaviso', color: 'bg-amber-500', darkColor: 'dark:bg-amber-400' },
    { key: 'extra' as const, label: 'Extra', color: 'bg-purple-500', darkColor: 'dark:bg-purple-400' },
  ]

  // Find max value across all data for scaling
  const allValues = data.flatMap(d => categories.map(c => d[c.key]))
  const maxValue = Math.max(...allValues, 1)

  // Calculate trends (last vs second-to-last)
  const current = data[data.length - 1]
  const previous = data.length >= 2 ? data[data.length - 2] : null

  const getTrend = (key: 'regular' | 'plantao' | 'sobreaviso' | 'extra') => {
    if (!previous || previous[key] === 0) return { pct: 0, direction: 'stable' as const }
    const pct = Math.round(((current[key] - previous[key]) / previous[key]) * 100)
    return {
      pct: Math.abs(pct),
      direction: pct > 2 ? 'up' as const : pct < -2 ? 'down' as const : 'stable' as const
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
      <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-6">
        Comparativo Histórico de Horas
      </h3>

      {/* Chart */}
      <div className="flex items-end gap-3 h-48 mb-6">
        {data.map((month, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="flex items-end gap-0.5 w-full h-40">
              {categories.map(cat => {
                const height = maxValue > 0 ? (month[cat.key] / maxValue) * 100 : 0
                return (
                  <div key={cat.key} className="flex-1 flex flex-col justify-end">
                    <div
                      className={`w-full ${cat.color} ${cat.darkColor} rounded-t transition-all duration-700 ease-out min-h-[2px]`}
                      style={{ height: `${Math.max(height, 1)}%` }}
                      title={`${cat.label}: ${month[cat.key]}h`}
                    />
                  </div>
                )
              })}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mt-1">
              {month.label}
            </span>
          </div>
        ))}
      </div>

      {/* Legend & Trends */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {categories.map(cat => {
          const trend = getTrend(cat.key)
          return (
            <div key={cat.key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <div className={`w-2.5 h-2.5 rounded-full ${cat.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 truncate">
                  {cat.label}
                </p>
                <p className="text-sm font-bold text-zinc-900 dark:text-white">
                  {current[cat.key]}h
                </p>
              </div>
              {previous && (
                <div className={`flex items-center gap-0.5 text-[10px] font-bold ${
                  trend.direction === 'up' ? 'text-emerald-600' :
                  trend.direction === 'down' ? 'text-red-500' :
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
