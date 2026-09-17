'use client'

/**
 * Apurações do período — emitir, reimprimir, retificar e revogar.
 *
 * Plano: docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md (Fase 3)
 *
 * 🚨 A REIMPRESSÃO SAI DO SNAPSHOT, nunca da folha de hoje. É isso que faz o documento reimpresso
 * em outubro ser idêntico ao entregue em setembro. Quando a folha muda depois da emissão, a tela
 * avisa (divergência) e o caminho é RETIFICAR — versão nova, com motivo —, nunca editar o que já
 * foi entregue.
 */

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  previaApuracaoPeriodo,
  emitirApuracao,
  retificarApuracao,
  revogarApuracao,
  listarApuracoes,
  buscarApuracaoEmitida,
  servidoresComPeriodoEspecial,
} from '../../servidores/[id]/apuracaoActions'
import { h, raw } from '@/utils/htmlSeguro'
import { formatarDataBR } from '@/utils/folha/periodoApuracao'

interface Props {
  disponivel: boolean
  unidades: Array<{ id: string; nome: string }>
  mesInicial: number
  anoInicial: number
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function hhmm(min: number | null | undefined): string {
  const m = Math.round(Number(min) || 0)
  const sinal = m < 0 ? '-' : ''
  return `${sinal}${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`
}

export function ApuracoesClient({ disponivel, unidades, mesInicial, anoInicial }: Props) {
  const [mes, setMes] = useState(mesInicial)
  const [ano, setAno] = useState(anoInicial)
  const [unidadeId, setUnidadeId] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [candidatos, setCandidatos] = useState<any[] | null>(null)
  const [motivoLista, setMotivoLista] = useState<string | null>(null)
  const [emitidas, setEmitidas] = useState<any[]>([])

  const [previa, setPrevia] = useState<any>(null)
  const [confirmando, setConfirmando] = useState<{ servidor: any; motivos: string[] } | null>(null)
  const [retificando, setRetificando] = useState<any>(null)
  const [motivoTexto, setMotivoTexto] = useState('')
  const [revogando, setRevogando] = useState<any>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setAviso(null)
    setPrevia(null)

    const [cand, emit] = await Promise.all([
      servidoresComPeriodoEspecial(mes, ano, unidadeId || null),
      listarApuracoes(mes, ano, unidadeId || null),
    ])

    setCarregando(false)

    if ((cand as any).error) { setAviso({ tipo: 'erro', texto: (cand as any).error }); return }
    if ((emit as any).error) { setAviso({ tipo: 'erro', texto: (emit as any).error }); return }

    setCandidatos((cand as any).servidores || [])
    setMotivoLista((cand as any).motivo || null)
    setEmitidas((emit as any).apuracoes || [])
  }, [mes, ano, unidadeId])

  async function verPrevia(servidor: any) {
    setAviso(null)
    setCarregando(true)
    const res = await previaApuracaoPeriodo(servidor.id, mes, ano)
    setCarregando(false)
    if ((res as any).error) { setAviso({ tipo: 'erro', texto: (res as any).error }); return }
    setPrevia({ servidor, ...(res as any) })
  }

  async function emitir(servidor: any, confirmado = false) {
    setAviso(null)
    setCarregando(true)
    const res: any = await emitirApuracao(servidor.id, mes, ano, { confirmado })
    setCarregando(false)

    if (res.error) { setAviso({ tipo: 'erro', texto: res.error }); return }
    if (res.precisaConfirmar) {
      setConfirmando({ servidor, motivos: res.motivos || [] })
      return
    }
    setConfirmando(null)
    setAviso({
      tipo: 'ok',
      texto: `Apuração de ${servidor.nome} emitida (versão ${res.resultado?.versao}): `
        + `${formatarDataBR(res.resultado?.periodo_inicio)} a ${formatarDataBR(res.resultado?.periodo_fim)}, `
        + `${res.resultado?.dias_com_linha} dia(s) com lançamento.`,
    })
    await carregar()
  }

  async function retificar() {
    if (!retificando) return
    setAviso(null)
    setCarregando(true)
    const res: any = await retificarApuracao(retificando.apuracao_id, motivoTexto, { confirmado: true })
    setCarregando(false)
    if (res.error) { setAviso({ tipo: 'erro', texto: res.error }); return }
    setRetificando(null)
    setMotivoTexto('')
    setAviso({
      tipo: 'ok',
      texto: `Retificada: versão ${res.resultado?.versao_anterior} → ${res.resultado?.versao}.`
        + (res.resultado?.mudou ? ' Os números mudaram em relação à versão anterior.'
                               : ' Os números ficaram iguais aos da versão anterior.'),
    })
    await carregar()
  }

  async function revogar() {
    if (!revogando) return
    setAviso(null)
    setCarregando(true)
    const res: any = await revogarApuracao(revogando.apuracao_id, motivoTexto)
    setCarregando(false)
    if (res.error) { setAviso({ tipo: 'erro', texto: res.error }); return }
    setRevogando(null)
    setMotivoTexto('')
    setAviso({ tipo: 'ok', texto: `Apuração revogada (versão ${res.resultado?.versao}).` })
    await carregar()
  }

  /**
   * Imprime o documento a partir do SNAPSHOT emitido.
   *
   * ⚠️ HTML montado com a tag `h` (htmlSeguro): `window.open('')` abre `about:blank`, que HERDA a
   * origem da aplicação — script injetado ali roda como o SisEscala, com a sessão de quem
   * imprimiu (armadilha 37). Toda interpolação é escapada; `raw` só para o que é markup nosso.
   */
  async function imprimir(linha: any) {
    setAviso(null)
    setCarregando(true)
    const res: any = await buscarApuracaoEmitida(linha.apuracao_id)
    setCarregando(false)
    if (res.error) { setAviso({ tipo: 'erro', texto: res.error }); return }

    const ap = res.apuracao
    const srv = Array.isArray(ap.servidores) ? ap.servidores[0] : ap.servidores
    const t = ap.totais || {}
    const dias: any[] = ap.registros || []

    const win = window.open('', '_blank')
    if (!win) {
      setAviso({
        tipo: 'erro',
        texto: 'Bloqueador de pop-ups detectado. Permita pop-ups para imprimir.',
      })
      return
    }

    const linhasDias = dias.map(d => {
      const r = d.registro || {}
      return h`<tr>
        <td>${formatarDataBR(d.data)}</td>
        <td>${r.dia_semana || ''}</td>
        <td>${r.turno_codigo || ''}</td>
        <td class="c">${r.entrada || ''}</td>
        <td class="c">${r.saida_intervalo || ''}</td>
        <td class="c">${r.retorno_intervalo || ''}</td>
        <td class="c">${r.saida || ''}</td>
        <td class="c">${r.hora_extra_minutos ? hhmm(r.hora_extra_minutos) : ''}</td>
        <td>${r.observacao || (d.semRegistro ? 'sem lançamento na folha' : '')}</td>
      </tr>`
    })

    const ressalvas: string[] = Array.isArray(ap.ressalvas) ? ap.ressalvas : []

    const doc = h`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Apuração ${formatarDataBR(ap.periodo_inicio)} a ${formatarDataBR(ap.periodo_fim)} — ${srv?.nome || ''}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; margin: 18px; color: #111; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .sub { font-size: 11px; color: #444; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; }
  td.c { text-align: center; }
  .tot { margin-top: 12px; width: auto; }
  .tot td { border: none; padding: 2px 14px 2px 0; }
  .obs { margin-top: 12px; font-size: 10px; color: #333; }
  .ress { margin-top: 10px; border: 1px solid #b45309; padding: 6px 8px; font-size: 10px; }
  .ass { margin-top: 36px; display: flex; gap: 40px; }
  .ass div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 10px; }
  @media print { body { margin: 8px; } }
</style></head><body>
  <h1>Apuração de frequência — período de ${formatarDataBR(ap.periodo_inicio)} a ${formatarDataBR(ap.periodo_fim)}</h1>
  <div class="sub">
    <strong>${srv?.nome || ''}</strong> — matrícula ${srv?.matricula || ''}${srv?.cargo ? ` — ${srv.cargo}` : ''}<br>
    Competência ${String(ap.competencia_mes).padStart(2, '0')}/${ap.competencia_ano}
    · Regime: ${ap.regime_nome || ''}
    · Versão ${ap.versao}${ap.motivo_retificacao ? ' (retificação)' : ''}
    ${raw(ap.revogado_em ? ' · <strong>REVOGADA</strong>' : '')}
  </div>

  <table>
    <thead><tr>
      <th>Data</th><th>Dia</th><th>Turno</th><th>Entrada</th><th>Saída int.</th>
      <th>Retorno int.</th><th>Saída</th><th>H. extra</th><th>Observação</th>
    </tr></thead>
    <tbody>${linhasDias}</tbody>
  </table>

  <table class="tot"><tbody>
    <tr>
      <td><strong>Horas normais:</strong> ${hhmm(t.normaisMinutos)}</td>
      <td><strong>Hora extra 50%:</strong> ${hhmm(t.extra50Minutos)}</td>
      <td><strong>Hora extra 100%:</strong> ${hhmm(t.extra100Minutos)}</td>
    </tr>
    <tr>
      <td><strong>Atraso:</strong> ${hhmm(t.atrasoMinutos)}</td>
      <td><strong>Abono:</strong> ${hhmm(t.abonoMinutos)}</td>
      <td><strong>Faltas:</strong> ${t.faltas ?? 0}</td>
    </tr>
  </tbody></table>

  ${ressalvas.length
    ? h`<div class="ress"><strong>Ressalvas registradas na emissão:</strong><ul>${
        // `h` concatena array de HtmlSeguro sozinha — nunca `.join('')`, que desfaz a marcação e
        // faz o literal externo escapar as linhas (armadilha 37).
        ressalvas.map(r => h`<li>${r}</li>`)
      }</ul></div>`
    : ''}

  <div class="obs">
    ${ap.motivo_retificacao ? h`<div><strong>Motivo da retificação:</strong> ${ap.motivo_retificacao}</div>` : ''}
    ${ap.observacao ? h`<div><strong>Observação:</strong> ${ap.observacao}</div>` : ''}
    ${ap.revogado_motivo ? h`<div><strong>Motivo da revogação:</strong> ${ap.revogado_motivo}</div>` : ''}
    <div>Documento emitido em ${formatarDataBR(String(ap.emitido_em).slice(0, 10))} a partir da folha de ponto mensal.</div>
  </div>

  <div class="ass"><div>Servidor(a)</div><div>Chefia imediata</div><div>Recursos Humanos</div></div>
  <script>window.onload = function () { window.print() }</script>
</body></html>`

    win.document.write(doc.toString())
    win.document.close()

    if (res.divergencia?.divergente) {
      setAviso({
        tipo: 'erro',
        texto:
          'Atenção: a folha mudou desde a emissão deste documento — '
          + res.divergencia.diferencas.join('; ')
          + '. O documento impresso é o que foi emitido; para atualizar, retifique.',
      })
    }
  }

  if (!disponivel) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Apurações do período</h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Esta tela ainda não está disponível: a atualização do banco que cria o regime de apuração
          não foi aplicada. Nada foi perdido — a folha mensal continua funcionando normalmente.
        </p>
        <Link href="/folha-ponto" className="mt-4 inline-block text-sm font-semibold text-blue-600">
          Voltar para Folha de Ponto
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Apurações do período</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Para quem tem a folha fechada em dia diferente do último dia do mês. A folha mensal
            <strong> não muda</strong>: este documento é um recorte dela.
          </p>
        </div>
        <Link href="/folha-ponto" className="text-sm font-semibold text-blue-600">
          Folha de Ponto
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Mês</label>
          <select value={mes} onChange={e => setMes(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Ano</label>
          <input type="number" value={ano} onChange={e => setAno(Number(e.target.value))}
            className="w-24 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Unidade</label>
          <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm">
            <option value="">Todas do meu escopo</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <button type="button" onClick={carregar} disabled={carregando}
          className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-50">
          {carregando ? 'Carregando...' : 'Carregar'}
        </button>
      </div>

      {aviso && (
        <div className={`text-sm rounded-md px-3 py-2 border ${
          aviso.tipo === 'ok'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900'
            : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-900'
        }`}>{aviso.texto}</div>
      )}

      {/* Quem tem período especial e ainda não foi emitido */}
      {candidatos !== null && (
        <section>
          <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-2">
            Com período diferente do mês civil
          </h2>

          {/* Lista vazia tem MOTIVOS diferentes, e dizer qual é evita procurar defeito onde não há. */}
          {motivoLista === 'nenhum_regime_de_corte' && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Nenhum servidor tem período diferente do mês civil. O período é definido na ficha do
              servidor, em <strong>Alterações de Jornada → Período de apuração da folha</strong>.
            </p>
          )}
          {motivoLista === 'escolha_a_unidade' && (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Existe um período definido para <strong>toda a rede</strong>. Escolha a unidade acima
              para listar os servidores dela — carregar a rede inteira de uma vez travaria a tela.
            </p>
          )}

          {candidatos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                  <tr>
                    <th scope="col" className="text-left py-2 pr-4">Servidor</th>
                    <th scope="col" className="text-left py-2 pr-4">Unidade</th>
                    <th scope="col" className="text-left py-2 pr-4">Período</th>
                    <th scope="col" className="text-right py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {candidatos.map(s => {
                    const jaEmitida = emitidas.some(e => e.servidor_id === s.id)
                    return (
                      <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-2 pr-4">
                          <Link href={`/servidores/${s.id}`} className="font-medium hover:underline">
                            {s.nome}
                          </Link>
                          <span className="text-xs text-zinc-500"> · {s.matricula}</span>
                        </td>
                        <td className="py-2 pr-4 text-xs">{s.unidade_nome || '—'}</td>
                        <td className="py-2 pr-4">
                          {formatarDataBR(s.periodo_inicio)} a {formatarDataBR(s.periodo_fim)}
                          {s.atravessa_mes && (
                            <span className="text-xs text-amber-700 dark:text-amber-400"> · atravessa o mês</span>
                          )}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => verPrevia(s)} disabled={carregando}
                            className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline mr-3">
                            Prévia
                          </button>
                          {jaEmitida
                            ? <span className="text-xs text-zinc-500">já emitida</span>
                            : <button type="button" onClick={() => emitir(s)} disabled={carregando}
                                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                                Emitir
                              </button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Prévia */}
      {previa && (
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">
              Prévia — {previa.servidor.nome}
            </h2>
            <button type="button" onClick={() => setPrevia(null)} className="text-xs text-zinc-500 hover:underline">
              fechar
            </button>
          </div>
          <p className="text-sm">{previa.apuracao.janela.rotulo} · {previa.regimeNome}</p>
          <div className="text-sm text-zinc-700 dark:text-zinc-300 space-y-0.5">
            {previa.relato.map((l: string, i: number) => <p key={i}>{l}</p>)}
          </div>
          <div className="text-sm">
            <strong>Totais:</strong> normais {hhmm(previa.apuracao.totais.normaisMinutos)}
            {' '}· extra 50% {hhmm(previa.apuracao.totais.extra50Minutos)}
            {' '}· extra 100% {hhmm(previa.apuracao.totais.extra100Minutos)}
            {' '}· atraso {hhmm(previa.apuracao.totais.atrasoMinutos)}
            {' '}· abono {hhmm(previa.apuracao.totais.abonoMinutos)}
            {' '}· faltas {previa.apuracao.totais.faltas}
          </div>
          {previa.confirmacao?.precisa && (
            <div className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900 px-3 py-2">
              <strong>Ainda não está pronto para emitir:</strong>
              <ul className="list-disc pl-4 mt-1">
                {previa.confirmacao.motivos.map((m: string, i: number) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Confirmação de emissão com ressalva */}
      {confirmando && (
        <section className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
          <h2 className="text-base font-bold text-amber-900 dark:text-amber-200">
            Emitir com ressalva — {confirmando.servidor.nome}?
          </h2>
          <ul className="list-disc pl-5 text-sm text-amber-900 dark:text-amber-200">
            {confirmando.motivos.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <p className="text-xs text-amber-900 dark:text-amber-300">
            O documento pode ser emitido assim — a ressalva fica registrada nele e sai impressa.
            Se preferir resolver primeiro, corrija na folha do mês e emita depois.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => emitir(confirmando.servidor, true)} disabled={carregando}
              className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-50">
              Emitir com ressalva
            </button>
            <button type="button" onClick={() => setConfirmando(null)}
              className="px-3 py-1.5 rounded-lg border border-amber-400 text-sm">
              Cancelar
            </button>
          </div>
        </section>
      )}

      {/* Emitidas */}
      <section>
        <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-2">
          Documentos emitidos nesta competência
        </h2>
        {emitidas.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nenhuma apuração emitida em {MESES[mes - 1]}/{ano}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                <tr>
                  <th scope="col" className="text-left py-2 pr-4">Servidor</th>
                  <th scope="col" className="text-left py-2 pr-4">Período</th>
                  <th scope="col" className="text-left py-2 pr-4">Versão</th>
                  <th scope="col" className="text-left py-2 pr-4">Normais</th>
                  <th scope="col" className="text-left py-2 pr-4">Emitido</th>
                  <th scope="col" className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody>
                {emitidas.map(e => (
                  <tr key={e.apuracao_id}
                    className={`border-b border-zinc-100 dark:border-zinc-800 ${e.revogado_em ? 'opacity-60' : ''}`}>
                    <td className="py-2 pr-4">
                      <Link href={`/servidores/${e.servidor_id}`} className="font-medium hover:underline">
                        {e.servidor_nome}
                      </Link>
                      <span className="text-xs text-zinc-500"> · {e.matricula}</span>
                    </td>
                    <td className="py-2 pr-4">
                      {formatarDataBR(e.periodo_inicio)} a {formatarDataBR(e.periodo_fim)}
                    </td>
                    <td className="py-2 pr-4">
                      v{e.versao}
                      {!e.e_ultima_versao && <span className="text-xs text-zinc-500"> (superada)</span>}
                      {e.revogado_em && (
                        <span className="text-xs text-red-700 dark:text-red-400 font-semibold"> revogada</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{hhmm(e.totais?.normaisMinutos)}</td>
                    <td className="py-2 pr-4 text-xs">
                      {formatarDataBR(String(e.emitido_em).slice(0, 10))}
                      <span className="text-zinc-500"> · {e.emitido_por}</span>
                      {Array.isArray(e.ressalvas) && e.ressalvas.length > 0 && (
                        <span className="text-amber-700 dark:text-amber-400"> · {e.ressalvas.length} ressalva(s)</span>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => imprimir(e)} disabled={carregando}
                        className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline mr-3">
                        Imprimir
                      </button>
                      {e.e_ultima_versao && !e.revogado_em && (
                        <>
                          <button type="button"
                            onClick={() => { setRetificando(e); setMotivoTexto(''); setRevogando(null) }}
                            className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline mr-3">
                            Retificar
                          </button>
                          <button type="button"
                            onClick={() => { setRevogando(e); setMotivoTexto(''); setRetificando(null) }}
                            className="text-xs font-semibold text-red-700 dark:text-red-400 hover:underline">
                            Revogar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Retificar / revogar */}
      {(retificando || revogando) && (
        <section className={`rounded-lg border p-4 space-y-3 ${
          retificando
            ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30'
            : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
        }`}>
          <h2 className="text-base font-bold">
            {retificando
              ? `Retificar a apuração de ${retificando.servidor_nome}`
              : `Revogar a apuração de ${revogando.servidor_nome}`}
          </h2>
          <p className="text-xs">
            {retificando
              ? 'Uma versão nova é emitida com os números da folha de hoje. A versão anterior continua no histórico — é ela que prova o que foi entregue antes.'
              : 'O documento continua no histórico, marcado como revogado. Revogação não se desfaz.'}
          </p>
          <input type="text" value={motivoTexto} onChange={e => setMotivoTexto(e.target.value)}
            placeholder="Motivo (ao menos 10 caracteres)"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm" />
          <div className="flex gap-2">
            <button type="button" onClick={retificando ? retificar : revogar}
              disabled={carregando || motivoTexto.trim().length < 10}
              className={`px-3 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50 ${
                retificando ? 'bg-amber-600' : 'bg-red-600'}`}>
              {retificando ? 'Retificar' : 'Revogar'}
            </button>
            <button type="button" onClick={() => { setRetificando(null); setRevogando(null) }}
              className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm">
              Cancelar
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
