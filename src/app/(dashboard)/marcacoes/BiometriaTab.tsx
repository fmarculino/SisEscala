'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatarData } from '@/utils/horario'
import { Loader2, Fingerprint, RefreshCw } from 'lucide-react'
import { listarPendenciasBiometria } from './actions'

interface Pendencia {
  vinculo_id: string
  dispositivo_id: string
  dispositivo_nome: string
  servidor_id: string
  servidor_nome: string
  matricula: string
  criado_em: string
}

/**
 * Quem já teve a identidade enviada ao relógio (`fn_confirmar_cadastro_rep`) mas ainda não
 * cadastrou a digital lá — informação só, sem ação daqui: cadastrar biometria é sempre
 * presencial no equipamento, ninguém faz isso pela tela do SisEscala.
 */
export function BiometriaTab() {
  const [pendencias, setPendencias] = useState<Pendencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroDispositivo, setFiltroDispositivo] = useState('')

  async function recarregar() {
    setCarregando(true)
    setErro(null)
    try {
      setPendencias(await listarPendenciasBiometria())
    } catch (e: any) {
      setErro(e.message || 'Falha ao carregar pendências de biometria.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { recarregar() }, [])

  const dispositivos = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of pendencias) m.set(p.dispositivo_id, p.dispositivo_nome)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [pendencias])

  const porDispositivo = pendencias.reduce<Record<string, { nome: string; itens: Pendencia[] }>>((acc, p) => {
    if (filtroDispositivo && p.dispositivo_id !== filtroDispositivo) return acc
    if (!acc[p.dispositivo_id]) acc[p.dispositivo_id] = { nome: p.dispositivo_nome, itens: [] }
    acc[p.dispositivo_id].itens.push(p)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Identidade já enviada ao relógio, mas ninguém foi até o aparelho cadastrar a digital
          ainda. Sem biometria, essa pessoa não consegue bater o ponto nesse relógio.
        </p>
        <button onClick={recarregar} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500" title="Atualizar">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {erro && <p className="text-xs text-red-600 font-medium">{erro}</p>}

      {!carregando && dispositivos.length > 1 && (
        <select
          value={filtroDispositivo}
          onChange={(e) => setFiltroDispositivo(e.target.value)}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm"
        >
          <option value="">Todos os relógios ({dispositivos.length})</option>
          {dispositivos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </select>
      )}

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : pendencias.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhuma pendência de biometria no seu escopo.</p>
      ) : Object.keys(porDispositivo).length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhuma pendência para o relógio selecionado.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(porDispositivo).map(([dispositivoId, grupo]) => (
            <div key={dispositivoId}>
              <p className="text-xs font-black text-zinc-500 uppercase tracking-wide mb-2">{grupo.nome}</p>
              <div className="space-y-2">
                {grupo.itens.map((p) => (
                  <div key={p.vinculo_id} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <Fingerprint className="h-4 w-4 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-zinc-900 dark:text-white">
                        {p.servidor_nome} <span className="text-zinc-400 font-normal">({p.matricula})</span>
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        Identidade enviada em {formatarData(p.criado_em)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
