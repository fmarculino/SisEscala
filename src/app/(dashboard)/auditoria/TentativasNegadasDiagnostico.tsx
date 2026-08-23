'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatarDataCurta, formatarHora } from '@/utils/horario'
import { createClient } from '@/utils/supabase/client'
import {
  AlertTriangle, CalendarX, UserX, CheckCircle2, Bug, Loader2,
  ArrowRight, HelpCircle, Clock
} from 'lucide-react'

/**
 * Diagnóstico de tentativas negadas.
 *
 * POR QUE ESTA TELA EXISTE
 *   A listagem crua ordenada por data era a aba mais usada pela coordenação, e para um fim
 *   operacional: descobrir por que a batida foi recusada e **corrigir a escala**.
 *
 *   Só que, medindo as 981 tentativas de produção: 395 são `Matrícula ou PIN inválidos` (erro de
 *   digitação, não diz nada sobre escala) e 58 são `já registrou` (comportamento correto do
 *   sistema). **46% do que a tela mostrava não apontava problema nenhum** — e afogava os 423
 *   casos que apontavam. Pior: quem é recusado tenta três, quatro vezes, então um único problema
 *   aparecia como quatro linhas.
 *
 *   Aqui: agrupado por (servidor, dia, causa) — 981 tentativas viram 495 casos — e ordenado pelo
 *   **desvio em minutos**, que é o número que separa tolerância mal calibrada de escala errada.
 *
 * A CLASSIFICAÇÃO NÃO É FEITA AQUI
 *   Vem de `fn_classificar_tentativa_negada` e `fn_desvio_tentativa_minutos`. Reimplementar o
 *   `ILIKE` nesta tela criaria a segunda definição da mesma regra — o caminho pelo qual o módulo
 *   de marcações acabou com três regras de intervalo divergentes.
 */

interface CasoNegado {
  servidor_id: string | null
  servidor_nome: string
  matricula: string | null
  dia: string
  unidade_nome: string | null
  setor_nome: string | null
  classificacao: string
  tentativas: number
  primeira_em: string
  ultima_em: string
  previsto_inicio: string | null
  previsto_fim: string | null
  desvio_minutos: number | null
  previsao_incompleta: boolean
  turno_codigo: string | null
  mensagem: string | null
  algum_elegivel: boolean
}

/** Ordem = prioridade de diagnóstico. `horario_divergente` primeiro porque é o acionável. */
const CAUSAS: Record<string, {
  rotulo: string; explica: string; cor: string; corCard: string; Icone: any; acionavel: boolean
}> = {
  horario_divergente: {
    rotulo: 'Horário divergente',
    explica: 'Existe escala, mas o horário previsto não bate com a hora em que a pessoa bateu. É aqui que mora o erro de escala.',
    cor: 'text-amber-700 dark:text-amber-400',
    corCard: 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20',
    Icone: Clock, acionavel: true,
  },
  sem_escala: {
    rotulo: 'Sem escala no dia',
    explica: 'A pessoa foi trabalhar e não estava escalada. Também é problema de escala — de outro tipo.',
    cor: 'text-orange-700 dark:text-orange-400',
    corCard: 'border-orange-300 dark:border-orange-800 bg-orange-50/60 dark:bg-orange-950/20',
    Icone: CalendarX, acionavel: true,
  },
  identidade: {
    rotulo: 'Matrícula ou PIN',
    explica: 'Identidade não confirmada — pode ser outra pessoa digitando errado. Não serve como horário de ponto e não diz nada sobre a escala.',
    cor: 'text-zinc-600 dark:text-zinc-400',
    corCard: 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40',
    Icone: UserX, acionavel: false,
  },
  ja_registrado: {
    rotulo: 'Já havia registrado',
    explica: 'Comportamento correto do sistema. Não é problema.',
    cor: 'text-emerald-700 dark:text-emerald-400',
    corCard: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20',
    Icone: CheckCircle2, acionavel: false,
  },
  erro_sistema: {
    rotulo: 'Erro do sistema',
    explica: 'Falha interna ou permissão. É bug — não é escala nem digitação.',
    cor: 'text-red-700 dark:text-red-400',
    corCard: 'border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20',
    Icone: Bug, acionavel: true,
  },
  outro: {
    rotulo: 'Não classificado',
    explica: 'Mensagem nova no terminal que a classificação ainda não conhece. Se aparecer, vale investigar.',
    cor: 'text-purple-700 dark:text-purple-400',
    corCard: 'border-purple-300 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/20',
    Icone: HelpCircle, acionavel: true,
  },
}

/** Faixas de gravidade. 30 min é a tolerância padrão do terminal; acima de 4 h não é tolerância. */
function gravidadeDesvio(min: number | null) {
  if (min == null) return { texto: '—', cor: 'text-zinc-400' }
  if (min <= 30) return { texto: `${min} min`, cor: 'text-zinc-500' }
  if (min <= 120) return { texto: `${min} min`, cor: 'text-amber-600 font-bold' }
  if (min < 240) return { texto: `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`, cor: 'text-orange-600 font-black' }
  return { texto: `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`, cor: 'text-red-600 font-black' }
}

interface Props {
  dataInicio?: string
  dataFim?: string
  busca?: string
  /** Reaproveita a navegação da página, que já resolve unidade/setor a partir dos nomes. */
  onIrParaEscala?: (caso: CasoNegado) => void
  navegandoId?: string | null
}

export function TentativasNegadasDiagnostico({ dataInicio, dataFim, busca, onIrParaEscala, navegandoId }: Props) {
  const supabase = createClient()
  const [carregando, setCarregando] = useState(true)
  const [resumo, setResumo] = useState<{ classificacao: string; tentativas: number; servidores_dias: number }[]>([])
  const [casos, setCasos] = useState<CasoNegado[]>([])
  // Abre já filtrado no que é acionável — o resto é ruído para quem veio corrigir escala.
  const [causa, setCausa] = useState<string>('horario_divergente')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const args = {
      p_desde: dataInicio || null,
      p_ate: dataFim || null,
      p_unidade: null,
      p_setor: null,
      p_classificacao: causa || null,
      p_busca: busca || null,
    }
    const [r1, r2] = await Promise.all([
      supabase.rpc('fn_tentativas_negadas_resumo', { p_desde: dataInicio || null, p_ate: dataFim || null }),
      supabase.rpc('fn_tentativas_negadas_diagnostico', args),
    ])
    if (r1.data) setResumo(r1.data as any)
    if (r2.data) {
      // Desvio maior primeiro: a tela abre pelo caso mais grave, não pelo mais recente.
      const lista = (r2.data as CasoNegado[]).slice().sort((a, b) => {
        if (a.desvio_minutos == null && b.desvio_minutos == null) return b.dia.localeCompare(a.dia)
        if (a.desvio_minutos == null) return 1
        if (b.desvio_minutos == null) return -1
        return b.desvio_minutos - a.desvio_minutos
      })
      setCasos(lista)
    }
    setCarregando(false)
  }, [dataInicio, dataFim, busca, causa, supabase])

  useEffect(() => { carregar() }, [carregar])

  const totalTentativas = resumo.reduce((s, x) => s + x.tentativas, 0)
  const totalCasos = resumo.reduce((s, x) => s + x.servidores_dias, 0)

  return (
    <div className="space-y-5">
      {/* Cartões por causa. Mostram CASOS, não tentativas: a insistência de quem é recusado
          infla a contagem bruta e faz o problema parecer maior do que é. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {Object.entries(CAUSAS).map(([chave, c]) => {
          const r = resumo.find(x => x.classificacao === chave)
          if (!r && chave === 'outro') return null
          const ativo = causa === chave
          const Icone = c.Icone
          return (
            <button
              key={chave}
              onClick={() => setCausa(ativo ? '' : chave)}
              title={c.explica}
              className={`text-left p-4 rounded-2xl border-2 transition-all ${c.corCard} ${
                ativo ? 'ring-2 ring-offset-1 ring-blue-500 dark:ring-offset-zinc-900' : 'opacity-80 hover:opacity-100'
              }`}
            >
              <div className={`flex items-center gap-1.5 ${c.cor}`}>
                <Icone className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider leading-tight">{c.rotulo}</span>
              </div>
              <p className={`text-2xl font-black mt-1 ${c.cor}`}>{r?.servidores_dias ?? 0}</p>
              <p className="text-[10px] text-zinc-500">
                {r?.servidores_dias === 1 ? 'caso' : 'casos'}
                {r && r.tentativas !== r.servidores_dias && ` · ${r.tentativas} tentativas`}
              </p>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <p>
          <b>{totalTentativas}</b> tentativas agrupadas em <b>{totalCasos}</b> casos.
          {causa && <> Exibindo <b className={CAUSAS[causa]?.cor}>{CAUSAS[causa]?.rotulo}</b>.</>}
          {!causa && <> Clique num cartão para filtrar.</>}
        </p>
        {causa && (
          <button onClick={() => setCausa('')} className="font-bold text-blue-600 hover:underline">
            Ver todas as causas
          </button>
        )}
      </div>

      {causa && CAUSAS[causa] && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl">
          {CAUSAS[causa].explica}
        </p>
      )}

      {carregando ? (
        <div className="flex items-center gap-2 p-10 justify-center text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando diagnóstico…
        </div>
      ) : casos.length === 0 ? (
        <div className="p-10 text-center text-sm text-zinc-500">Nenhum caso no período.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60">
              <tr className="text-left">
                {['Servidor', 'Dia', 'Previsto', 'Tentou às', 'Desvio', 'Vezes', ''].map(h => (
                  <th key={h} className="py-3 px-3 text-[10px] font-black uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {casos.map(c => {
                const gr = gravidadeDesvio(c.desvio_minutos)
                const hora = (t: string) => formatarHora(t)
                return (
                  <tr key={`${c.servidor_id}-${c.dia}-${c.classificacao}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-3">
                      <p className="font-bold text-zinc-800 dark:text-zinc-200 leading-tight">{c.servidor_nome}</p>
                      <p className="text-[10px] text-zinc-400">
                        {c.matricula} · {c.unidade_nome || '—'}{c.setor_nome ? ` / ${c.setor_nome}` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {formatarDataCurta(c.dia)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {c.previsto_inicio || '—'} › {c.previsto_fim || '—'}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-xs text-zinc-800 dark:text-zinc-200">
                      {hora(c.primeira_em)}
                      {c.tentativas > 1 && <span className="text-zinc-400"> … {hora(c.ultima_em)}</span>}
                    </td>
                    <td className={`py-3 px-3 whitespace-nowrap ${gr.cor}`}>
                      {gr.texto}
                      {/* O desvio só é conclusivo quando se sabe qual passo era. Mensagem genérica
                          com uma borda só não permite afirmar — dizer isso é mais útil que omitir. */}
                      {c.previsao_incompleta && (
                        <span title="A mensagem não diz se era entrada ou saída, e só uma das bordas foi registrada. O número é indicativo."
                              className="ml-1 text-[10px] text-zinc-400 cursor-help">(?)</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-zinc-500">{c.tentativas}×</td>
                    <td className="py-3 px-3 text-right">
                      {CAUSAS[c.classificacao]?.acionavel && onIrParaEscala && (
                        <button
                          onClick={() => onIrParaEscala(c)}
                          disabled={navegandoId === `${c.servidor_id}-${c.dia}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                        >
                          {navegandoId === `${c.servidor_id}-${c.dia}`
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <>Ver escala <ArrowRight className="h-3 w-3" /></>}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-zinc-500 leading-relaxed">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
        <p>
          O <b>previsto</b> é histórico: foi gravado no instante da recusa e não é recalculado. É
          isso que o torna útil — mostra o que o sistema cobrava <b>naquele momento</b>, que pode
          não ser mais o que ele cobra hoje. Desvio até 30 min costuma ser tolerância; acima de 4 h,
          quase sempre é turno cadastrado no período errado.
        </p>
      </div>
    </div>
  )
}
