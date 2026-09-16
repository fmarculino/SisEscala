'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { conferirSetorSemRelogio } from './actions'
import { vincularSetorARelogios } from '../marcacoes/actions'
import {
  preMarcadas,
  textoIntroducao,
  avisoPalpite,
} from '@/utils/setores/sugestaoRelogio'

/**
 * Avisa, logo depois de criar um setor, que ele nasceu SEM RELÓGIO.
 *
 * Numa unidade cujo relógio trabalha com lista de setores, todo setor novo nasce fora dele — e
 * ninguém é avisado. Medido em 15/09/2026: 37 setores órfãos, 115 lotados, 113 sem uma batida,
 * todos criados DEPOIS de o relógio da unidade estar configurado.
 *
 * ⚠️ Isto NÃO substitui a aba Marcações → Setores sem Relógio: o formulário não é o único
 * caminho de criação (fusão, correção de hierarquia, script) e o `parent_id` muda depois.
 */
export function AvisoSetorSemRelogio() {
  const params = useSearchParams()
  const criado = params.get('criado')

  const [estado, setEstado] = useState<{ orfao: boolean; sugestoes: any[] } | null>(null)
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!criado) return
    conferirSetorSemRelogio(criado).then((r) => {
      setEstado(r)
      // Mesma fonte única da aba Marcações → Setores sem Relógio.
      setEscolhidos(preMarcadas(r.sugestoes || []))
    })
  }, [criado])

  if (!criado || !estado?.orfao || pronto) return null

  async function aplicar() {
    setSalvando(true); setErro(null)
    const r = await vincularSetorARelogios(criado!, escolhidos)
    setSalvando(false)
    if ('error' in r && r.error) { setErro(r.error); return }
    setPronto(true)
  }

  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
      <p className="text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>O setor foi criado, mas nenhum relógio da unidade atende a ele.</strong>{' '}
          Os relógios dessa unidade trabalham com uma lista de setores, e o setor novo não entra
          nela sozinho — quem for lotado aqui não vai conseguir registrar ponto.
        </span>
      </p>

      {estado.sugestoes.length === 0 ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Não dá para sugerir o equipamento: nenhum setor acima deste é atendido. Escolha o relógio
          do prédio onde essas pessoas trabalham em <strong>Marcações → Dispositivos REP</strong>.
        </p>
      ) : (
        <>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {textoIntroducao(estado.sugestoes || [])}
          </p>
          <div className="space-y-1">
            {estado.sugestoes.map((s: any) => (
              <label key={s.dispositivo_id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={escolhidos.includes(s.dispositivo_id)}
                  onChange={(e) =>
                    setEscolhidos(
                      e.target.checked
                        ? [...escolhidos, s.dispositivo_id]
                        : escolhidos.filter((x) => x !== s.dispositivo_id),
                    )
                  }
                />
                <span>
                  <span className="font-medium">{s.dispositivo_nome}</span>
                  <span className="text-zinc-500"> · {s.unidade_nome}</span>
                  <span className="block text-[11px] text-zinc-500">{s.motivo}</span>
                </span>
              </label>
            ))}
          </div>
          {avisoPalpite(estado.sugestoes || []) && (
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              ⚠️ {avisoPalpite(estado.sugestoes || [])}
            </p>
          )}
        </>
      )}

      {erro && <p className="text-xs text-red-600">{erro}</p>}

      <div className="flex items-center gap-3">
        {estado.sugestoes.length > 0 && (
          <button
            type="button"
            disabled={salvando || escolhidos.length === 0}
            onClick={aplicar}
            className="text-sm px-3 py-1.5 rounded-lg bg-amber-600 text-white disabled:opacity-40 hover:bg-amber-700"
          >
            {salvando ? 'Vinculando…' : `Vincular a ${escolhidos.length} relógio(s)`}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPronto(true)}
          className="text-sm text-amber-800 dark:text-amber-300 underline"
        >
          Deixar para depois
        </button>
        <Link href="/marcacoes" className="text-xs text-zinc-500 underline ml-auto">
          ver todos os setores sem relógio
        </Link>
      </div>
    </div>
  )
}
