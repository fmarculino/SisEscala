'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Zap, Users, Clock, Building2, Phone, ArrowRight, Navigation2,
  CheckCircle2, AlertTriangle, MapPin, Lock, Globe2
} from 'lucide-react'
import { AcionarSobreavisoModal, formatarJanela } from '@/components/sobreaviso/AcionarSobreavisoModal'
import type { PainelSobreavisoItem, DestinoUnidade } from '@/app/actions/sobreaviso'

/**
 * Painel de sobreaviso — Fase 6 do plano
 * docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md
 *
 * Mostra o sobreaviso de TODA a secretaria para qualquer coordenador/admin: quem está de
 * sobreaviso atende várias unidades, e antes só o coordenador do próprio setor enxergava.
 *
 * Este componente NÃO decide quem pode acionar nem qual é a janela do plantão. As duas coisas
 * vêm prontas de `fn_painel_sobreaviso_dia`, que usa exatamente as mesmas funções que
 * `fn_acionar_sobreaviso` aplica ao gravar. Recalcular aqui faria o botão prometer o que o
 * banco pode recusar.
 */
export function SobreavisoPanel({
  itens,
  destinos,
  lotacao
}: {
  itens: PainelSobreavisoItem[]
  destinos: DestinoUnidade[]
  lotacao: { unidadeId: string | null; setorId: string | null }
}) {
  const router = useRouter()
  const [acionando, setAcionando] = useState<PainelSobreavisoItem | null>(null)

  const ativos = itens.filter(i => i.ativo_agora).length

  return (
    <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500 rounded-xl text-white shadow-lg shadow-amber-500/30">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">
              Sobreaviso Hoje — Toda a Secretaria
            </h2>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/60">
              <span className="font-bold text-amber-800 dark:text-amber-200">
                {ativos} ativo{ativos !== 1 ? 's' : ''} agora
              </span>{' '}
              • {itens.length} escalado{itens.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Link
          href="/relatorios/plantao-sobreaviso"
          className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 transition-colors flex items-center gap-1"
        >
          Histórico <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {itens.length === 0 ? (
        <div className="text-center py-8">
          <Phone className="h-10 w-10 text-amber-300 dark:text-amber-700 mx-auto mb-3 opacity-50" />
          <p className="text-sm font-semibold text-amber-700/60 dark:text-amber-400/40">
            Nenhum servidor escalado para sobreaviso hoje.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map(item => (
            <div
              key={item.escala_diaria_id}
              className={`flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-zinc-900 rounded-xl p-4 border transition-all ${
                item.ativo_agora
                  ? 'border-emerald-400/80 dark:border-emerald-700/80 shadow-md ring-1 ring-emerald-500/20'
                  : 'border-amber-100 dark:border-zinc-800 shadow-sm hover:shadow-md'
              }`}
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                  item.ativo_agora
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                }`}>
                  <Users className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                      {item.servidor_nome}
                    </p>

                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      item.ativo_agora
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                        : 'bg-amber-100/80 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    }`}>
                      {item.ativo_agora ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Ativo agora
                        </>
                      ) : (
                        <>
                          <Clock className="h-2.5 w-2.5" />
                          Inicia {formatarJanela(item.janela_inicio_local, item.janela_fim_local).split(' → ')[0]}
                        </>
                      )}
                    </span>

                    {/* Abrangência: quem atende a rede inteira aparece marcado, porque é o que
                        explica por que qualquer coordenador pode acionar aquela pessoa. */}
                    {item.abrangencia === 'geral' && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                        title="Atende toda a secretaria"
                      >
                        <Globe2 className="h-2.5 w-2.5" /> Rede
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {item.unidade_nome}
                      {item.setor_nome ? ` — ${item.setor_nome}` : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {item.turno_codigo} ({item.turno_horas}h)
                      {' · '}
                      {/* O período INTEIRO. Quem vai acionar precisa saber até quando aquela
                          pessoa está disponível, não só quando ela começa. */}
                      {formatarJanela(item.janela_inicio_local, item.janela_fim_local)}
                    </span>
                  </p>

                  {/* Para onde a pessoa foi mandada no chamado em curso */}
                  {item.log_destino_unidade && item.log_status && ['Aguardando', 'Aceito', 'Chegou'].includes(item.log_status) && (
                    <p className="text-[10px] text-orange-600 dark:text-orange-400 flex items-center gap-1 mt-1 font-semibold">
                      <MapPin className="h-3 w-3" />
                      {item.log_destino_unidade}
                      {item.log_destino_setor ? ` — ${item.log_destino_setor}` : ''}
                      {item.log_destino_referencia ? ` (${item.log_destino_referencia})` : ''}
                      {item.log_acionado_por ? ` · por ${item.log_acionado_por}` : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {item.chamados_no_dia > 1 && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                    title={`${item.chamados_no_dia} chamados registrados neste dia`}
                  >
                    ⚡ {item.chamados_no_dia} Chamados
                  </span>
                )}

                {item.log_status && (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    item.log_status === 'Aceito'
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30 animate-pulse'
                      : item.log_status === 'Chegou'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                      : item.log_status === 'Aguardando'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                      : item.log_status === 'Recusado' || item.log_status === 'Falhou' || item.log_status === 'Timeout'
                      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    {item.log_status === 'Aceito' && <Navigation2 className="h-3 w-3 fill-current" />}
                    {item.log_status === 'Chegou' && <CheckCircle2 className="h-3 w-3" />}
                    {item.log_status === 'Aguardando' && <Clock className="h-3 w-3" />}
                    {['Recusado', 'Falhou', 'Timeout'].includes(item.log_status) && <AlertTriangle className="h-3 w-3" />}
                    {item.log_status === 'Aceito' ? 'Em deslocamento' : item.log_status === 'Chegou' ? 'No local' : item.log_status}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setAcionando(item)}
                  disabled={!item.pode_acionar}
                  title={item.motivo_bloqueio || 'Acionar este sobreaviso'}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all ${
                    item.pode_acionar
                      ? 'bg-amber-500 hover:bg-amber-600 text-white hover:shadow-md'
                      : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  {item.pode_acionar ? <Zap className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  Acionar
                </button>
              </div>

              {/* O motivo do bloqueio fica visível, não escondido no title: "ver e não poder
                  acionar" é informação útil, e sem a explicação vira bug aparente. */}
              {!item.pode_acionar && item.motivo_bloqueio && (
                <p className="w-full text-[10px] text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-800 pt-2">
                  {item.motivo_bloqueio}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {acionando && (
        <AcionarSobreavisoModal
          alvo={{
            escalaMensalId: acionando.escala_mensal_id,
            dia: acionando.dia,
            servidorNome: acionando.servidor_nome,
            unidadeOrigemId: acionando.unidade_id,
            contexto: `Plantão de ${acionando.unidade_nome}`
              + (acionando.setor_nome ? ` — ${acionando.setor_nome}` : '')
              + ` · ${acionando.turno_codigo} (${acionando.turno_horas}h) · `
              + formatarJanela(acionando.janela_inicio_local, acionando.janela_fim_local)
          }}
          destinos={destinos}
          lotacao={lotacao}
          onClose={() => { setAcionando(null); router.refresh() }}
          onSucesso={() => router.refresh()}
        />
      )}
    </div>
  )
}
