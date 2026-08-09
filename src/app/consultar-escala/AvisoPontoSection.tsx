'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, ShieldCheck, AlertTriangle, Loader2, Check, X } from 'lucide-react'
import { getPreferenciaAvisoPonto, definirPreferenciaAvisoPonto, definirModoAvisoPonto } from './actions'
import { TERMO_ATIVACAO, TERMO_DESATIVACAO } from '@/utils/avisoPonto'

/**
 * Opção do servidor para receber (ou não) o aviso de ponto por WhatsApp.
 *
 * É OPT-IN: nasce desligado e só o próprio servidor liga. O termo é exibido ANTES de confirmar,
 * e o texto mostrado aqui é literalmente o mesmo que a action grava em
 * `logs_preferencia_aviso_ponto` — os dois vêm de `@/utils/avisoPonto`. Se divergissem, o
 * registro provaria ciência de um texto que a pessoa não leu.
 */
export function AvisoPontoSection() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [estado, setEstado] = useState<any>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<null | boolean>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    const res: any = await getPreferenciaAvisoPonto()
    if (res?.error) setErro(res.error)
    else { setEstado(res); setErro(null) }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [])

  async function confirmar(ativar: boolean) {
    setSalvando(true)
    setFeedback(null)
    const res: any = await definirPreferenciaAvisoPonto(ativar)
    if (res?.error) {
      setErro(res.error)
    } else {
      setErro(null)
      setFeedback(res.message)
      setEstado((e: any) => ({ ...e, status: res.status }))
    }
    setSalvando(false)
    setConfirmando(null)
  }

  /**
   * Ordenado do menos ao mais incômodo. `resumo_diario` é o padrão do banco e vem destacado:
   * uma mensagem com todas as batidas do dia é registro melhor que quatro fragmentos soltos —
   * é uma peça só, que a pessoa consegue achar depois.
   */
  const MODOS: { chave: string; titulo: string; detalhe: string; volume: string }[] = [
    { chave: 'resumo_semanal', titulo: 'Resumo semanal', detalhe: 'Toda segunda-feira, com os registros da semana anterior e o link da sua folha.', volume: '~4 por mês' },
    { chave: 'resumo_diario', titulo: 'Resumo diário (recomendado)', detalhe: 'Uma mensagem ao fim do expediente, com todas as batidas do dia.', volume: '~22 por mês' },
    { chave: 'entrada_saida', titulo: 'Entrada e saída', detalhe: 'Uma mensagem ao entrar e outra ao sair. Não avisa nas batidas de intervalo.', volume: '~44 por mês' },
    { chave: 'todas', titulo: 'Todas as batidas', detalhe: 'Confirmação imediata de cada registro, inclusive as de intervalo.', volume: 'até 88 por mês' },
  ]

  async function salvarModo(modo: string) {
    setSalvando(true)
    setFeedback(null)
    const res: any = await definirModoAvisoPonto(modo)
    if (res?.error) setErro(res.error)
    else { setErro(null); setFeedback(res.message); setEstado((e: any) => ({ ...e, modo: res.modo })) }
    setSalvando(false)
  }

  const ROTULO: Record<string, { texto: string; cor: string }> = {
    ativo: { texto: 'Ativado', cor: 'text-emerald-600' },
    pendente_confirmacao: { texto: 'Aguardando sua resposta no WhatsApp', cor: 'text-amber-600' },
    inativo: { texto: 'Desativado', cor: 'text-zinc-500' },
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando sua preferência…
      </div>
    )
  }

  if (erro && !estado) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-400 font-medium">
        {erro}
      </div>
    )
  }

  const status: string = estado?.status || 'inativo'
  const ativo = status === 'ativo'
  const pendente = status === 'pendente_confirmacao'
  const bloqueado = !estado?.telefoneUtilizavel

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 space-y-5">
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-2xl shrink-0 ${ativo
          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600'
          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            Aviso de ponto no WhatsApp
          </h3>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Receba uma mensagem no seu WhatsApp a cada vez que registrar o ponto no terminal, com a
            data, o horário e o local do registro.
          </p>
        </div>
      </div>

      {/* O enquadramento legal fica visível, não escondido no termo: o aviso não é o comprovante,
          e prometer o que não se entrega é pior que não oferecer. */}
      <div className="flex items-start gap-3 p-4 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 rounded-2xl">
        <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
          É um <b>aviso informativo</b>. Não é o Comprovante de Registro de Ponto e não substitui a
          sua folha. <b>Ativar ou não ativar não altera em nada o registro do seu ponto</b> — suas
          batidas continuam sendo gravadas do mesmo jeito.
        </p>
      </div>

      {bloqueado && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Não há um telefone válido e exclusivo no seu cadastro. Procure seu coordenador para
            atualizar antes de ativar o aviso.
          </p>
        </div>
      )}

      {pendente && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <MessageSquare className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Enviamos uma mensagem para o seu WhatsApp. <b>Responda SIM naquela conversa</b> para
            ativar o aviso — é essa resposta que confirma que o número é seu. Se você não responder,
            o pedido expira e nada é enviado; não insistiremos.
          </p>
        </div>
      )}

      {!bloqueado && ativo && !estado?.unidadeHabilitada && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Sua preferência está salva, mas o envio ainda não foi habilitado na sua unidade. Você
            passará a receber assim que a coordenação ativar.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-zinc-400">Situação atual</p>
          <p className={`text-sm font-black ${ROTULO[status]?.cor || 'text-zinc-500'}`}>
            {ROTULO[status]?.texto || 'Desativado'}
          </p>
          {estado?.telefone && (
            <p className="text-[11px] text-zinc-400 mt-0.5">Telefone: {estado.telefone}</p>
          )}
        </div>

        {/* Com pedido pendente o botão só oferece cancelar: reenviar a confirmação é exatamente
            a insistência que gera bloqueio, e o banco recusaria de qualquer forma. */}
        <button
          type="button"
          disabled={salvando || (bloqueado && status === 'inativo')}
          onClick={() => setConfirmando(status === 'inativo')}
          className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40 ${status !== 'inativo'
            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700'
            : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
        >
          {status === 'inativo' ? 'Ativar aviso' : pendente ? 'Cancelar pedido' : 'Desativar aviso'}
        </button>
      </div>

      {/* A frequência só aparece depois de o aviso estar valendo — oferecer a escolha a quem ainda
          não ativou seria pedir uma decisão sobre algo que não está acontecendo. */}
      {ativo && (
        <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-zinc-400">
              Com que frequência você quer receber
            </p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Registro fora do horário previsto avisa <b>sempre</b>, em qualquer opção — é quando
              você mais precisa saber.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {MODOS.map(m => {
              const escolhido = (estado?.modo || 'resumo_diario') === m.chave
              return (
                <label
                  key={m.chave}
                  className={`flex items-start gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-all ${escolhido
                    ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}
                >
                  <input
                    type="radio"
                    name="aviso_ponto_modo"
                    checked={escolhido}
                    disabled={salvando}
                    onChange={() => salvarModo(m.chave)}
                    className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-black text-zinc-900 dark:text-white">{m.titulo}</span>
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{m.volume}</span>
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">{m.detalhe}</p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {feedback && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4 shrink-0" /> {feedback}
        </div>
      )}

      {erro && estado && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-xs font-bold text-red-700 dark:text-red-400">
          <X className="h-4 w-4 shrink-0" /> {erro}
        </div>
      )}

      {/* TERMO DE CIÊNCIA — exibido antes de qualquer alteração. */}
      {confirmando !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h4 className="font-black text-sm uppercase tracking-tight text-zinc-900 dark:text-white">
              {confirmando ? 'Ativar aviso de ponto' : 'Desativar aviso de ponto'}
            </h4>

            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl">
              <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                {confirmando ? TERMO_ATIVACAO : TERMO_DESATIVACAO}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmando(null)}
                disabled={salvando}
                className="flex-1 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-black uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => confirmar(confirmando)}
                disabled={salvando}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Li e concordo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
