'use client'

/**
 * Regime de apuracao da folha, na ficha do servidor.
 *
 * Plano: docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md (Fase 1)
 *
 * A folha continua mensal. O que esta secao define e o PERIODO em que a apuracao daquela pessoa
 * fecha — para o Mais Medicos, de 21 de um mes a 20 do seguinte.
 *
 * ⚠️ O rotulo NUNCA e so "09/2026": periodo que atravessa a virada precisa das duas datas
 * escritas, senao ninguem sabe se "setembro" comeca no dia 1 ou no dia 21.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { atribuirRegimeApuracao, encerrarRegimeApuracao } from '../actions'
import { previaApuracaoPeriodo } from './apuracaoActions'
import {
  janelaDoPeriodo,
  descreverJanela,
  formatarDataBR,
  metadesDoPeriodo,
  type RegimeApuracao,
  type VigenciaRegime,
} from '@/utils/folha/periodoApuracao'

interface Props {
  servidorId: string
  regimes: RegimeApuracao[]
  vigencias: VigenciaRegime[]
  /** O regime que o banco resolveu para a competencia corrente. */
  regimeVigente: RegimeApuracao | null
  /** De onde ele veio: linha do servidor, linha da rede, ou o padrao. */
  origemRegime: 'servidor' | 'rede' | 'padrao'
  competencia: { mes: number; ano: number }
  podeEditar: boolean
}

export function RegimeApuracaoSection({
  servidorId,
  regimes,
  vigencias,
  regimeVigente,
  origemRegime,
  competencia,
  podeEditar,
}: Props) {
  const router = useRouter()
  const [regimeEscolhido, setRegimeEscolhido] = useState('')
  const [vigenciaInicio, setVigenciaInicio] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [encerrando, setEncerrando] = useState<VigenciaRegime | null>(null)
  const [motivoFim, setMotivoFim] = useState('')
  // Prévia da apuração (Fase 2): leitura pura, nada é gravado.
  const [previa, setPrevia] = useState<any>(null)
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)

  const doServidor = vigencias.filter(v => v.servidor_id === servidorId)
  const abertaDoServidor = doServidor.find(v => v.vigencia_fim === null)
  const nomeRegime = (id: string) => regimes.find(r => r.id === id)?.nome || 'Regime removido'

  // A janela do regime vigente, para a competencia que a tela esta mostrando.
  const janela = regimeVigente ? janelaDoPeriodo(regimeVigente, competencia.mes, competencia.ano) : null
  const metades = janela ? metadesDoPeriodo(janela) : []

  // A previa da janela do regime que a pessoa acabou de escolher no <select>, antes de salvar.
  const regimePrevia = regimes.find(r => r.id === regimeEscolhido) || null
  const janelaPrevia = regimePrevia
    ? janelaDoPeriodo(regimePrevia, competencia.mes, competencia.ano)
    : null

  const rotuloOrigem = {
    servidor: 'definido para este servidor',
    rede: 'herdado do regime da rede',
    padrao: 'padrão do sistema',
  }[origemRegime]

  async function handleAtribuir(e: React.FormEvent) {
    e.preventDefault()
    setAviso(null)
    if (!regimeEscolhido) { setAviso({ tipo: 'erro', texto: 'Escolha o regime de apuração.' }); return }
    if (motivo.trim().length < 5) {
      setAviso({ tipo: 'erro', texto: 'Informe o motivo (ao menos 5 caracteres).' }); return
    }
    setEnviando(true)
    const res = await atribuirRegimeApuracao(servidorId, regimeEscolhido, vigenciaInicio, motivo)
    setEnviando(false)
    if (res.error) { setAviso({ tipo: 'erro', texto: res.error }); return }
    const r: any = res.resultado
    setAviso({
      tipo: 'ok',
      texto: r?.status === 'sem_mudanca'
        ? 'Este já era o regime vigente; nada foi alterado.'
        : `Regime "${r?.regime_nome}" passa a valer a partir de ${formatarDataBR(r?.vigencia_inicio)}.`,
    })
    setRegimeEscolhido(''); setVigenciaInicio(''); setMotivo('')
    router.refresh()
  }

  async function handlePrevia() {
    setAviso(null)
    setCarregandoPrevia(true)
    const res = await previaApuracaoPeriodo(servidorId, competencia.mes, competencia.ano)
    setCarregandoPrevia(false)
    if ((res as any).error) { setAviso({ tipo: 'erro', texto: (res as any).error }); return }
    setPrevia(res)
  }

  async function handleEncerrar() {
    if (!encerrando) return
    setAviso(null)
    if (motivoFim.trim().length < 5) {
      setAviso({ tipo: 'erro', texto: 'Informe o motivo do encerramento (ao menos 5 caracteres).' }); return
    }
    setEnviando(true)
    const res = await encerrarRegimeApuracao(encerrando.id, motivoFim, servidorId)
    setEnviando(false)
    if (res.error) { setAviso({ tipo: 'erro', texto: res.error }); return }
    const r: any = res.resultado
    setAviso({
      tipo: 'ok',
      texto: `Encerrado em ${formatarDataBR(r?.vigencia_fim)}. A partir do dia seguinte vale "${r?.volta_para}".`,
    })
    setEncerrando(null); setMotivoFim('')
    router.refresh()
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
          Período de apuração da folha
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Define em que período a folha deste servidor é apurada. A folha mensal
          <strong> não muda</strong>: o que muda é a janela do documento de apuração.
        </p>
      </div>

      {/* O que vale hoje */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Vigente
          </span>
          <span className="font-semibold text-zinc-900 dark:text-white">
            {regimeVigente?.nome || 'não resolvido'}
          </span>
          <span className="text-xs text-zinc-500">({rotuloOrigem})</span>
        </div>

        {janela && (
          <>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              Competência {String(competencia.mes).padStart(2, '0')}/{competencia.ano}:{' '}
              <strong>{formatarDataBR(janela.inicio)} a {formatarDataBR(janela.fim)}</strong>
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">{descreverJanela(janela)}</p>

            {/* 🚨 O periodo que atravessa a virada soma duas competencias de folha, e as regras
                de folha tem vigencia por competencia. Dizer isso na tela e o que evita alguem
                comparar o documento com a folha de um mes so e achar que um dos dois esta errado. */}
            {janela.atravessaMes && (
              <p className="mt-3 text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900 px-3 py-2">
                Este período atravessa a virada do mês: soma{' '}
                {metades.map(m => `${m.diaInicio} a ${m.diaFim}/${String(m.mes).padStart(2, '0')}`).join(' + ')}.
                Cada metade é contada com as regras da competência dela, exatamente como está na
                folha mensal correspondente.
              </p>
            )}
          </>
        )}
      </div>

      {/* Prévia da apuração — leitura pura. Emitir documento é a Fase 3. */}
      <div>
        <button
          type="button"
          onClick={handlePrevia}
          disabled={carregandoPrevia}
          className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-semibold disabled:opacity-50"
        >
          {carregandoPrevia ? 'Calculando...' : 'Ver apuração deste período'}
        </button>
        <p className="mt-1 text-xs text-zinc-500">
          Só mostra os números do período. Nada é gravado e nenhuma folha muda.
        </p>

        {previa?.apuracao && (
          <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {previa.apuracao.janela.rotulo} — {previa.regimeNome}
            </p>

            {/*
              Uma linha por competência, com a carga por dia de CADA UMA. É a parte que não pode
              sair da tela: quando o período atravessa a virada, as duas metades são contadas com
              as regras da competência delas, e é isso que explica por que o total do período não
              bate com a folha de um mês só.
            */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                  <tr>
                    <th scope="col" className="text-left py-2 pr-4">Competência</th>
                    <th scope="col" className="text-left py-2 pr-4">Dias</th>
                    <th scope="col" className="text-left py-2 pr-4">Por dia</th>
                    <th scope="col" className="text-left py-2 pr-4">Horas normais</th>
                    <th scope="col" className="text-left py-2">Folha</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.apuracao.metades.map((m: any) => (
                    <tr key={m.competencia} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-4 font-medium">{m.competencia}</td>
                      <td className="py-2 pr-4">{m.diaInicio} a {m.diaFim}</td>
                      <td className="py-2 pr-4">
                        {m.semFolha ? '—' : `${m.horasNormaisPorDia}h`}
                        {!m.semFolha && (
                          <span className="text-xs text-zinc-500">
                            {' '}({m.descontaIntervalo ? 'líquido' : 'com intervalo'})
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {m.totais ? `${Math.floor(m.totais.normaisMinutos / 60)}h${String(m.totais.normaisMinutos % 60).padStart(2, '0')}` : '—'}
                      </td>
                      <td className="py-2 text-xs">
                        {m.semFolha
                          ? <span className="text-red-700 dark:text-red-400 font-semibold">sem folha</span>
                          : m.folhas.map((f: any) => f.status).join(', ')}
                        {m.congelada && <span className="text-zinc-500"> · encerrada</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-sm text-zinc-700 dark:text-zinc-300 space-y-0.5">
              {previa.relato.map((l: string, i: number) => <p key={i}>{l}</p>)}
            </div>

            {previa.confirmacao?.precisa && (
              <div className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900 px-3 py-2">
                <strong>Este período ainda não está pronto para emitir:</strong>
                <ul className="list-disc pl-4 mt-1">
                  {previa.confirmacao.motivos.map((m: string, i: number) => <li key={i}>{m}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {aviso && (
        <div className={`text-sm rounded-md px-3 py-2 border ${
          aviso.tipo === 'ok'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900'
            : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-900'
        }`}>
          {aviso.texto}
        </div>
      )}

      {podeEditar ? (
        <form onSubmit={handleAtribuir} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                Regime *
              </label>
              <select
                value={regimeEscolhido}
                onChange={e => setRegimeEscolhido(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
              >
                <option value="">Selecione o regime...</option>
                {regimes.filter(r => r.ativo !== false).map(r => (
                  <option key={r.id} value={r.id}>
                    {r.nome}{r.dia_corte === null ? '' : ` — fecha no dia ${r.dia_corte}`}
                  </option>
                ))}
              </select>
              {janelaPrevia && (
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                  Nesta competência ficaria{' '}
                  <strong>{formatarDataBR(janelaPrevia.inicio)} a {formatarDataBR(janelaPrevia.fim)}</strong>.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                A partir de
              </label>
              <input
                type="date"
                value={vigenciaInicio}
                onChange={e => setVigenciaInicio(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
              />
              <p className="mt-1 text-xs text-zinc-500">Em branco = hoje.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
              Motivo *
            </label>
            <input
              type="text"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ex.: Mais Médicos — frequência fechada no dia 20"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Fica no histórico, com o seu nome. A vigência anterior é encerrada no dia anterior —
              o passado não é reescrito.
            </p>
          </div>

          <button
            type="submit"
            disabled={enviando}
            className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-50"
          >
            {enviando ? 'Salvando...' : 'Definir regime'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 rounded-md bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
          Somente RH ou Administrador com escopo nesta unidade define o período de apuração.
        </p>
      )}

      {/* Histórico das vigências desta pessoa */}
      <div>
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">
          Vigências deste servidor
        </h3>
        {doServidor.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Nenhuma vigência própria — vale o regime {origemRegime === 'rede' ? 'da rede' : 'padrão'}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                <tr>
                  <th scope="col" className="text-left py-2 pr-4">Regime</th>
                  <th scope="col" className="text-left py-2 pr-4">Início</th>
                  <th scope="col" className="text-left py-2 pr-4">Fim</th>
                  <th scope="col" className="text-right py-2"></th>
                </tr>
              </thead>
              <tbody>
                {doServidor.map(v => (
                  <tr key={v.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-white">
                      {nomeRegime(v.regime_id)}
                    </td>
                    <td className="py-2 pr-4">{formatarDataBR(v.vigencia_inicio)}</td>
                    <td className="py-2 pr-4">
                      {v.vigencia_fim
                        ? formatarDataBR(v.vigencia_fim)
                        : <span className="text-emerald-700 dark:text-emerald-400 font-semibold">em vigor</span>}
                    </td>
                    <td className="py-2 text-right">
                      {podeEditar && v.vigencia_fim === null && (
                        <button
                          type="button"
                          onClick={() => { setEncerrando(v); setMotivoFim(''); setAviso(null) }}
                          className="text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
                        >
                          Encerrar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {encerrando && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
          <p className="text-sm text-red-900 dark:text-red-200">
            Encerrar a vigência de <strong>{nomeRegime(encerrando.regime_id)}</strong> hoje. A
            partir de amanhã volta a valer o regime {abertaDoServidor === encerrando && origemRegime === 'servidor' ? 'da rede ou o padrão' : 'de baixo'}.
          </p>
          <input
            type="text"
            value={motivoFim}
            onChange={e => setMotivoFim(e.target.value)}
            placeholder="Motivo do encerramento"
            className="w-full px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-zinc-900 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleEncerrar}
              disabled={enviando}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {enviando ? 'Encerrando...' : 'Confirmar encerramento'}
            </button>
            <button
              type="button"
              onClick={() => setEncerrando(null)}
              className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
