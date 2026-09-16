'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, MapPin } from 'lucide-react'
import {
  listarSetoresSemRelogio,
  listarRelogiosSugeridos,
  vincularSetorARelogios,
  type SetorSemRelogio,
  type RelogioSugerido,
} from './actions'
import {
  preMarcadas,
  textoIntroducao,
  avisoPalpite,
} from '@/utils/setores/sugestaoRelogio'

/**
 * Setores que nenhum relógio atende.
 *
 * Existe porque setor criado numa unidade cujo relógio trabalha com LISTA nasce fora do relógio,
 * em silêncio — ninguém é avisado, e o sintoma aparece semanas depois como "o ponto daquele
 * pessoal não vem". Medido em 15/09/2026: 37 setores órfãos, 115 lotados, 113 sem uma batida.
 *
 * 🚨 A sugestão NUNCA é aplicada sozinha. Ela carrega a força do sinal, e a tela só pré-marca o
 * forte: o palpite pela hierarquia erra justamente no setor que funciona em outro prédio (os
 * polos do CAF "herdariam" o relógio da sede, que fica longe deles).
 */
export function SetoresSemRelogioTab() {
  const [carregando, setCarregando] = useState(true)
  const [linhas, setLinhas] = useState<SetorSemRelogio[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    const r = await listarSetoresSemRelogio()
    if (r.error) setErro(r.error)
    else { setLinhas(r.dados); setErro(null) }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [])

  if (carregando) {
    return (
      <p className="text-sm text-zinc-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Procurando setores sem relógio…
      </p>
    )
  }

  if (erro) {
    return <p className="text-sm text-red-600">{erro}</p>
  }

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 p-4">
        <p className="text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4" />
          Todo setor com gente está coberto por algum relógio da unidade.
        </p>
      </div>
    )
  }

  const comGente = linhas.filter((l) => l.lotados + l.escalados > 0)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 p-4">
        <p className="text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>{linhas.length} setor(es)</strong> em unidades que têm relógio não são
            atendidos por nenhum equipamento
            {comGente.length > 0 && <> — <strong>{comGente.length} com gente lotada ou escalada</strong></>}.
            Quem está neles não consegue registrar ponto, e nada avisa.
          </span>
        </p>
      </div>

      <div className="space-y-2">
        {linhas.map((l) => (
          <LinhaSetor
            key={l.setor_id}
            linha={l}
            aberto={aberto === l.setor_id}
            onAbrir={() => setAberto(aberto === l.setor_id ? null : l.setor_id)}
            onVinculado={carregar}
          />
        ))}
      </div>
    </div>
  )
}

function LinhaSetor({
  linha, aberto, onAbrir, onVinculado,
}: {
  linha: SetorSemRelogio
  aberto: boolean
  onAbrir: () => void
  onVinculado: () => void
}) {
  const [sugestoes, setSugestoes] = useState<RelogioSugerido[] | null>(null)
  const [escolhidos, setEscolhidos] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto || sugestoes) return
    listarRelogiosSugeridos(linha.setor_id).then((r) => {
      const dados = r.error ? [] : r.dados
      setSugestoes(dados)
      // A regra de o que vem pré-marcado vive em src/utils/setores/sugestaoRelogio.ts: este
      // caminho e o aviso de criação de setor precisam decidir igual, e é uma regra que dá
      // vontade de afrouxar depois sem lembrar o que ela protege.
      setEscolhidos(preMarcadas(dados))
      if (r.error) setErro(r.error)
    })
  }, [aberto, sugestoes, linha.setor_id])

  async function aplicar() {
    setSalvando(true); setErro(null)
    const r = await vincularSetorARelogios(linha.setor_id, escolhidos)
    setSalvando(false)
    if ('error' in r && r.error) { setErro(r.error); return }
    onVinculado()
  }

  const gente = linha.lotados + linha.escalados

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <button
        type="button"
        onClick={onAbrir}
        className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 flex items-center gap-3"
      >
        <MapPin className="w-4 h-4 text-zinc-400 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium truncate">{linha.setor_caminho}</span>
          <span className="block text-[11px] text-zinc-500">{linha.unidade_nome}</span>
        </span>
        <span className="text-[11px] text-zinc-500 shrink-0 text-right">
          {gente > 0 ? (
            <span className="text-amber-700 dark:text-amber-400 font-medium">
              {linha.lotados} lotado(s) · {linha.escalados} escalado(s)
            </span>
          ) : (
            <span>sem gente</span>
          )}
        </span>
      </button>

      {aberto && (
        <div className="px-4 pb-4 pt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          {sugestoes === null ? (
            <p className="text-xs text-zinc-500 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Procurando o relógio provável…
            </p>
          ) : sugestoes.length === 0 ? (
            // Sem evidência e sem ancestral atendido: é o caso dos polos, e dizer "não sei" é a
            // resposta honesta. Chutar aqui mandaria cadastrar gente num prédio onde ela não está.
            <p className="text-xs text-zinc-500">
              Não dá para sugerir: ninguém deste setor bateu em relógio nenhum nos últimos 60 dias
              e nenhum setor acima dele é atendido. <strong>Escolha o relógio do prédio onde
              essas pessoas trabalham</strong> em Dispositivos REP — se for outro prédio, use
              “Setores de outras unidades”.
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-500">{textoIntroducao(sugestoes)}</p>
              <div className="space-y-1">
                {sugestoes.map((s) => (
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
                      <span className="block text-[11px] text-zinc-400">{s.motivo}</span>
                    </span>
                  </label>
                ))}
              </div>

              {avisoPalpite(sugestoes) && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠️ {avisoPalpite(sugestoes)}
                </p>
              )}

              {erro && <p className="text-xs text-red-600">{erro}</p>}

              <button
                type="button"
                disabled={salvando || escolhidos.length === 0}
                onClick={aplicar}
                className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700"
              >
                {salvando ? 'Vinculando…' : `Vincular a ${escolhidos.length} relógio(s)`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
