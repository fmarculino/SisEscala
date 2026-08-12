'use client'

import { useEffect, useState } from 'react'
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

  const porDispositivo = pendencias.reduce<Record<string, { nome: string; itens: Pendencia[] }>>((acc, p) => {
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

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : pendencias.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhuma pendência de biometria no seu escopo.</p>
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
                        Identidade enviada em {new Date(p.criado_em).toLocaleDateString('pt-BR')}
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
