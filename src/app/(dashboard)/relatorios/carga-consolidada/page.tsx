import { createClient } from '@/utils/supabase/server'
import { AlertTriangle, ArrowLeft, ExternalLink, Layers, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { AcessoNegado } from '@/components/AcessoNegado'
import { ReportActions } from '@/app/(dashboard)/relatorios/_components/ReportActions'
import { formatarHoras } from '@/utils/limiteCargaMensal'
import { CompetenciaFilter } from './CompetenciaFilter'

/**
 * Carga Consolidada do Mês — quem está em mais de uma escala na competência, quanto dá no total,
 * e onde estão as horas.
 *
 * ⚠️ Por que a tela existe: a checagem de teto dentro da grade (`ScaleGrid.tsx`) resolve para quem
 * está lançando, e só ali. A informação "esta pessoa tem 409h somando dois setores" só aparecia se
 * alguém abrisse justamente uma das duas grades — quem confere o mês teria que abrir 96 setores
 * para achar 3 pessoas. Ver docs/planos/2026-08-28-limite-de-horas-consolidado-entre-escalas.md.
 *
 * A conta não é refeita aqui: `fn_carga_mensal_consolidada` (migration `20260828130000`) usa
 * `fn_carga_mensal_servidor` e `fn_teto_carga_servidor`, as mesmas da grade. A tela não
 * reclassifica nada.
 */

interface Props {
  searchParams: Promise<{ mes?: string; ano?: string }>
}

interface EscalaDaCarga {
  escala_mensal_id: string
  // Ids para o link da grade. Opcionais de propósito: até a 20260829130000 ser aplicada a RPC não
  // os devolve, e a linha continua renderizando — só sem virar link.
  unidade_id?: string | null
  setor_id?: string | null
  unidade_nome: string
  setor_caminho: string
  status: string
  horas: number
  sobreavisos: number
}

interface LinhaCarga {
  servidor_id: string
  servidor_nome: string
  matricula: string | null
  total_horas: number
  total_sobreavisos: number
  teto_horas: number
  teto_sobreavisos: number
  horas_autorizadas: number
  sobreavisos_autorizados: number
  motivo_justificativa: string | null
  escalas_com_carga: number
  excede_horas: boolean
  excede_sobreavisos: boolean
  escalas: EscalaDaCarga[]
}

export default async function CargaConsolidadaPage({ searchParams }: Props) {
  const params = await searchParams
  const mes = Number(params.mes) || new Date().getMonth() + 1
  const ano = Number(params.ano) || new Date().getFullYear()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id)
    .single()

  // Mesma régua dos demais relatórios.
  if (profile?.role === 'coordenador' || profile?.role === 'ass_adm') {
    return <AcessoNegado />
  }

  const { data, error } = await supabase.rpc('fn_carga_mensal_consolidada', { p_mes: mes, p_ano: ano })
  const linhas = ((data as LinhaCarga[]) || [])

  const acimaDoTeto = linhas.filter(l => l.excede_horas || l.excede_sobreavisos)
  const comAutorizacao = linhas.filter(l => Number(l.horas_autorizadas) > 0 || Number(l.sobreavisos_autorizados) > 0)
  const nomeMes = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' })

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-6 print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href="/relatorios"
            className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="p-3 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-600/20">
            <Layers className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white uppercase">
              Carga Consolidada do Mês
            </h1>
            <p className="text-zinc-500 text-sm">
              Servidores em mais de uma escala na competência, e o total de horas somando todas elas.
            </p>
          </div>
        </div>
        <ReportActions showExport={false} />
      </div>

      <CompetenciaFilter mes={mes} ano={ano} />

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-2xl flex items-start gap-3 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Não foi possível carregar o relatório.</p>
            <p className="text-xs mt-1">{error.message}</p>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Em 2+ escalas</span>
          <p className="text-3xl font-black text-zinc-900 dark:text-white mt-1">{linhas.length}</p>
        </div>
        <div className={`p-5 rounded-2xl border ${
          acimaDoTeto.length > 0
            ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40'
            : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
        }`}>
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Acima do teto</span>
          <p className={`text-3xl font-black mt-1 ${acimaDoTeto.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-white'}`}>
            {acimaDoTeto.length}
          </p>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Com autorização</span>
          <p className="text-3xl font-black text-zinc-900 dark:text-white mt-1">{comAutorizacao.length}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40">
          <h2 className="text-sm font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
            {nomeMes} de {ano}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Só aparece quem está em mais de uma escala com carga, ou acima do teto mensal.
            Sobreaviso é contado em unidades e não entra nas horas.
          </p>
        </div>

        {linhas.length === 0 ? (
          <div className="p-12 text-center">
            <ShieldCheck className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
              Nenhum servidor em mais de uma escala nesta competência.
            </p>
            <p className="text-xs text-zinc-500 mt-1">E ninguém acima do teto mensal de horas ou de sobreavisos.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-[10px] uppercase tracking-widest text-zinc-500">
                <tr>
                  <th className="px-6 py-3 text-left font-black">Servidor</th>
                  <th className="px-4 py-3 text-left font-black">Onde estão as horas</th>
                  <th className="px-4 py-3 text-right font-black whitespace-nowrap">Total do mês</th>
                  <th className="px-4 py-3 text-right font-black whitespace-nowrap">Teto</th>
                  <th className="px-6 py-3 text-left font-black whitespace-nowrap">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {linhas.map(l => {
                  const excede = l.excede_horas || l.excede_sobreavisos
                  const temAutorizacao = Number(l.horas_autorizadas) > 0 || Number(l.sobreavisos_autorizados) > 0
                  return (
                    <tr
                      key={l.servidor_id}
                      className={`align-top print:break-inside-avoid ${excede ? 'bg-red-50/50 dark:bg-red-950/10' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <p className="font-bold text-zinc-900 dark:text-white leading-tight">{l.servidor_nome}</p>
                        <p className="text-[11px] text-zinc-500">Matrícula {l.matricula || '—'}</p>
                      </td>
                      <td className="px-4 py-4">
                        <ul className="space-y-1">
                          {(l.escalas || []).map(e => {
                            // Quem aparece nesta lista está acima do teto, ou seja: alguém precisa
                            // ABRIR a escala para reduzir. Levar direto para a grade daquela
                            // competência poupa decorar unidade + setor e procurar em /escalas.
                            const conteudo = (
                              <>
                                <span className="font-bold text-zinc-900 dark:text-white">
                                  {formatarHoras(e.horas)}h
                                  {Number(e.sobreavisos) > 0 && <> · {e.sobreavisos} un</>}
                                </span>
                                {' — '}
                                {e.unidade_nome} / {e.setor_caminho}
                                {e.status === 'Fechada' && (
                                  <span className="ml-1 text-[10px] font-black uppercase text-zinc-400">Fechada</span>
                                )}
                              </>
                            )
                            const destino = e.unidade_id && e.setor_id
                              ? `/escalas/unidade/${e.unidade_id}?setor=${e.setor_id}&mes=${mes}&ano=${ano}`
                              : null

                            return (
                              <li key={e.escala_mensal_id} className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-snug">
                                {destino ? (
                                  <Link
                                    href={destino}
                                    title={`Abrir a escala de ${e.setor_caminho} em ${mes}/${ano}`}
                                    className="group inline-flex items-start gap-1 rounded hover:text-blue-600 dark:hover:text-blue-400 transition-colors print:no-underline"
                                  >
                                    <span className="underline decoration-dotted underline-offset-2 decoration-zinc-300 group-hover:decoration-blue-500 print:no-underline">
                                      {conteudo}
                                    </span>
                                    <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity print:hidden" />
                                  </Link>
                                ) : conteudo}
                              </li>
                            )
                          })}
                        </ul>
                      </td>
                      <td className="px-4 py-4 text-right whitespace-nowrap">
                        <p className={`font-black ${excede ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-white'}`}>
                          {formatarHoras(l.total_horas)}h
                        </p>
                        {Number(l.total_sobreavisos) > 0 && (
                          <p className={`text-[11px] font-bold ${l.excede_sobreavisos ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'}`}>
                            {l.total_sobreavisos} un
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right whitespace-nowrap text-zinc-500">
                        <p>{formatarHoras(l.teto_horas)}h</p>
                        {Number(l.total_sobreavisos) > 0 && <p className="text-[11px]">{l.teto_sobreavisos} un</p>}
                      </td>
                      <td className="px-6 py-4">
                        {excede ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                              <AlertTriangle className="h-3 w-3" />
                              Acima do teto
                            </span>
                            <p className="text-[10px] text-zinc-500 leading-snug max-w-[16rem]">
                              Reduza a escala ou registre uma Autorização Extraordinária pela grade.
                            </p>
                          </div>
                        ) : temAutorizacao ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                            title={l.motivo_justificativa || ''}
                          >
                            <ShieldCheck className="h-3 w-3" />
                            Autorizado (+{formatarHoras(l.horas_autorizadas)}h)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                            Dentro do teto
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-400 leading-relaxed">
        O teto vem de <strong>Configurações → max_horas_escala_servidor</strong>, somado à Autorização
        Extraordinária do servidor naquele mês. Escalas inativadas não entram na conta. A soma segue a
        mesma fórmula da grade: hora de Regular limitada ao líquido da jornada, Extra e Plantão pelo
        que o turno computa.
      </p>
    </div>
  )
}
