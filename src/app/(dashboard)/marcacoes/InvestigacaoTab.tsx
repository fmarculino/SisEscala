'use client'

import { useState } from 'react'
import { Search, AlertTriangle, Loader2 } from 'lucide-react'
import { formatarData, formatarHora } from '@/utils/horario'
import {
  buscarServidorParaInvestigar, auditarPontoServidor, coletaDasUnidadesDoServidor,
  type ServidorEncontrado, type DiaAuditado,
} from './investigacaoActions'

/**
 * Investigação do ponto de uma pessoa.
 *
 * 🚨 SOMENTE LEITURA, de propósito. Ela diagnostica e diz PARA ONDE ir; quem corrige são os
 * caminhos que já existem, cada um com a prévia e o guard dele. Botão de reparo aqui seria um
 * segundo caminho de escrita sobre ponto — o padrão que este projeto já pagou caro três vezes.
 */

// ⚠️ A cor acompanha o que a pessoa precisa FAZER, não o quanto o caso é raro:
// verde = nada a fazer · âmbar = tem ação · vermelho = o ponto não chegou · zinc = não se aplica.
const ESTILO: Record<string, { cor: string; rotulo: string; acao?: string }> = {
  regular:          { cor: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900', rotulo: 'Registrado' },
  retida:           { cor: 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900', rotulo: 'Batida fora de circulação', acao: 'Grade → Ferramentas → Restaurar Batidas' },
  nao_reconciliado: { cor: 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900', rotulo: 'Batida não aplicada', acao: 'Grade → Ferramentas → Preencher pelas Batidas' },
  orfa:             { cor: 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900', rotulo: 'Batida sem dono', acao: 'Conferir CPF/PIS no cadastro' },
  outra_matricula:  { cor: 'text-blue-700 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-900', rotulo: 'Está na outra matrícula', acao: 'O acerto é na escala' },
  sem_turno:        { cor: 'text-purple-700 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-900', rotulo: 'Bateu sem turno lançado', acao: 'Lançar o turno na grade' },
  sem_batida:       { cor: 'text-red-700 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900', rotulo: 'Nenhuma batida chegou' },
  sem_escala:       { cor: 'text-zinc-500 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800', rotulo: 'Sem escala' },
}

export function InvestigacaoTab() {
  const [termo, setTermo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [achados, setAchados] = useState<ServidorEncontrado[] | null>(null)
  const [alvo, setAlvo] = useState<ServidorEncontrado | null>(null)

  const hoje = new Date()
  const há30 = new Date(hoje.getTime() - 29 * 86400000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const [inicio, setInicio] = useState(iso(há30))
  const [fim, setFim] = useState(iso(hoje))

  const [dias, setDias] = useState<DiaAuditado[] | null>(null)
  const [coleta, setColeta] = useState<any[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [soDivergencia, setSoDivergencia] = useState(true)

  async function buscar() {
    setBuscando(true); setErro(null)
    try {
      setAchados(await buscarServidorParaInvestigar(termo))
    } catch (e: any) { setErro(e.message) } finally { setBuscando(false) }
  }

  async function auditar(s: ServidorEncontrado) {
    setAlvo(s); setAchados(null); setCarregando(true); setErro(null); setDias(null)
    try {
      const [r, c] = await Promise.all([
        auditarPontoServidor(s.id, inicio, fim),
        coletaDasUnidadesDoServidor(s.id),
      ])
      if (r.error) setErro(r.error)
      setDias(r.dias)
      setColeta(c)
    } catch (e: any) { setErro(e.message) } finally { setCarregando(false) }
  }

  const visiveis = (dias || []).filter((d) => !soDivergencia || !['regular', 'sem_escala'].includes(d.diagnostico))
  const resumo = (dias || []).reduce<Record<string, number>>((a, d) => ({ ...a, [d.diagnostico]: (a[d.diagnostico] || 0) + 1 }), {})

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <p className="text-sm font-bold text-zinc-900 dark:text-white">Investigar o ponto de um servidor</p>
        <p className="text-xs text-zinc-500 mt-0.5 mb-3">
          Para quando alguém diz &quot;bati o ponto e estou com traço vermelho na escala&quot;. A tela
          mostra o que existe e o que houve — as correções continuam nos lugares de sempre.
        </p>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
              placeholder="Nome, matrícula ou CPF"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
            />
          </div>
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
          <input type="date" value={fim} onChange={(e) => setFim(e.target.value)}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
          <button onClick={buscar} disabled={buscando || termo.trim().length < 3}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-bold">
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
          </button>
        </div>
        {termo.trim().length > 0 && termo.trim().length < 3 && (
          <p className="text-[11px] text-zinc-400 mt-1">Digite ao menos 3 caracteres.</p>
        )}
      </div>

      {erro && (
        <div className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{erro}</p>
        </div>
      )}

      {achados && (
        achados.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-6">Ninguém encontrado no seu escopo com esse termo.</p>
        ) : (
          <div className="space-y-1">
            {achados.map((s) => (
              <button key={s.id} onClick={() => auditar(s)}
                className="w-full text-left p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-400">
                <p className="text-sm font-bold text-zinc-900 dark:text-white">
                  {s.nome}
                  {s.status !== 'Ativo' && <span className="ml-2 text-[10px] font-bold text-amber-600">{s.status}</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  mat. {s.matricula || '—'} · CPF {s.cpf || '—'}{s.unidade_nome ? ` · ${s.unidade_nome}` : ''}
                </p>
              </button>
            ))}
          </div>
        )
      )}

      {carregando && <p className="text-sm text-zinc-400 text-center py-8">Levantando a trilha do ponto…</p>}

      {alvo && dias && !carregando && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-zinc-900 dark:text-white">{alvo.nome}</p>
              <p className="text-xs text-zinc-500">
                mat. {alvo.matricula || '—'} · {formatarData(inicio)} a {formatarData(fim)}
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={soDivergencia} onChange={(e) => setSoDivergencia(e.target.checked)} />
              Mostrar só os dias com algo a explicar
            </label>
          </div>

          {/* 🚨 O aviso que fecha o diagnóstico "nenhuma batida chegou": sem ele, ausência de
              batida é indistinguível de falta — e foi essa dúvida que levou 38h para ser
              respondida em 18/09/2026. */}
          {coleta.length > 0 && (
            <div className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3">
              <p className="text-xs font-bold text-red-800 dark:text-red-300">
                Atenção: há ponto não coletado nos relógios das unidades desta pessoa
              </p>
              <ul className="mt-1 space-y-0.5">
                {coleta.map((c: any) => (
                  <li key={c.dispositivo_id} className="text-[11px] text-red-700 dark:text-red-400">
                    <strong>{c.dispositivo_nome}</strong> ({c.unidade_nome}) — {c.motivo}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-red-700 dark:text-red-400 mt-1">
                Enquanto isso não for resolvido, dia sem batida abaixo <strong>não</strong> significa falta.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {Object.entries(resumo).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <span key={k} className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${ESTILO[k]?.cor || ESTILO.sem_escala.cor}`}>
                {ESTILO[k]?.rotulo || k}: {n}
              </span>
            ))}
          </div>

          {visiveis.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-8">
              Nenhum dia com divergência no período. Desmarque a caixa acima para ver todos.
            </p>
          ) : (
            <div className="space-y-2">
              {visiveis.map((d) => {
                const e = ESTILO[d.diagnostico] || ESTILO.sem_escala
                return (
                  <div key={d.data} className={`rounded-2xl border p-3 ${e.cor}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-bold">
                        {formatarData(d.data)}
                        {d.turno_codigo && <span className="ml-2 font-mono text-xs">{d.turno_codigo}</span>}
                        {d.categoria && <span className="ml-1 text-[11px] opacity-70">{d.categoria}</span>}
                      </p>
                      <span className="text-[11px] font-bold uppercase tracking-wide opacity-80">{e.rotulo}</span>
                    </div>

                    <p className="text-xs mt-1 opacity-90">{d.explicacao}</p>

                    <div className="mt-2 grid gap-1 text-[11px] opacity-90">
                      <p>
                        <span className="font-bold">Na grade:</span>{' '}
                        {d.passos_preenchidos === 0 ? 'em branco' : [d.entrada_em, d.int_saida_em, d.int_retorno_em, d.saida_em]
                          .map((x) => (x ? formatarHora(x) : '—')).join('  ·  ')}
                      </p>
                      {d.batidas.length > 0 && (
                        <p>
                          <span className="font-bold">Batidas:</span>{' '}
                          {d.batidas.map((b, i) => (
                            <span key={i} className={b.desconsiderada ? 'line-through opacity-60' : ''}>
                              {i > 0 && '  ·  '}
                              {b.hora}
                              {b.relogio ? ` (${b.relogio}${b.nsr ? ` #${b.nsr}` : ''})` : ` (${b.origem})`}
                            </span>
                          ))}
                        </p>
                      )}
                      {d.batidas_irmao.length > 0 && (
                        <p>
                          <span className="font-bold">Na outra matrícula:</span>{' '}
                          {d.batidas_irmao.map((b, i) => `${i > 0 ? '  ·  ' : ''}${b.hora} (mat. ${b.matricula || '—'})`)}
                        </p>
                      )}
                      {(d.unidade_nome || d.setor_nome) && (
                        <p className="opacity-70">{[d.unidade_nome, d.setor_nome].filter(Boolean).join(' / ')}</p>
                      )}
                    </div>

                    {e.acao && (
                      <p className="mt-2 text-[11px] font-bold flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {e.acao}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
