'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, ShieldCheck, AlertTriangle, Loader2, Check, X, Info } from 'lucide-react'
import { getPreferenciaAvisoPonto, definirPreferenciaAvisoPonto, definirModoAvisoPonto, definirCanalAvisoPonto } from './actions'
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
   *
   * "Entrada e saída" e "Todas as batidas" foram desativados em 14/08/2026 — o número usado
   * pelo aviso foi restringido pela Meta/WhatsApp por volume de mensagem. `fn_definir_modo_
   * aviso_ponto` (migration 20260814130000) recusa esses dois valores mesmo se alguém chamar a
   * RPC direto; não é só a tela que os escondeu.
   */
  const MODOS: { chave: string; titulo: string; detalhe: string; volume: string }[] = [
    { chave: 'resumo_semanal', titulo: 'Resumo semanal (recomendado)', detalhe: 'Toda segunda-feira, com os registros da semana anterior e o link da sua folha.', volume: '~4 por mês' },
    { chave: 'resumo_diario', titulo: 'Resumo diário', detalhe: 'Uma mensagem ao fim do expediente, com todas as batidas do dia.', volume: '~22 por mês' },
  ]

  async function salvarModo(modo: string) {
    setSalvando(true)
    setFeedback(null)
    const res: any = await definirModoAvisoPonto(modo)
    if (res?.error) setErro(res.error)
    else { setErro(null); setFeedback(res.message); setEstado((e: any) => ({ ...e, modo: res.modo })) }
    setSalvando(false)
  }

  /**
   * Canal de entrega. **E-mail é o padrão desde 30/08/2026.**
   *
   * ⚠️ O motivo não é preferência: o número de WhatsApp foi restringido pela Meta **duas vezes**,
   * a segunda com apenas 25 servidores ativos — o que descarta volume como causa. Como o aviso de
   * ponto (informativo) e o acionamento de sobreaviso (emergência) saem pelo mesmo número, cada
   * bloqueio derruba os dois. Tirar o informativo do WhatsApp é o que protege o urgente.
   *
   * A opção só é oferecida quando há endereço para ela — escolher um canal sem endereço faria o
   * servidor achar que trocou enquanto o sistema entrega pelo outro. A RPC também recusa, então
   * esconder aqui é conveniência, não a defesa.
   */
  const CANAIS: { chave: string; titulo: string; detalhe: string; disponivel: boolean }[] = [
    {
      chave: 'email',
      titulo: 'E-mail (recomendado)',
      detalhe: estado?.email
        ? `Chega em ${estado.email}. É o canal mais estável e não depende do WhatsApp.`
        : 'Você ainda não tem e-mail cadastrado. Peça ao seu coordenador para cadastrar.',
      disponivel: !!estado?.email,
    },
    {
      chave: 'whatsapp',
      titulo: 'WhatsApp',
      detalhe: estado?.telefone
        ? 'Chega no telefone cadastrado. Pode atrasar ou falhar quando o número da Secretaria está com restrição.'
        : 'Você ainda não tem telefone cadastrado.',
      disponivel: !!estado?.telefone,
    },
  ]

  async function salvarCanal(canal: string) {
    setSalvando(true)
    setFeedback(null)
    const res: any = await definirCanalAvisoPonto(canal)
    if (res?.error) setErro(res.error)
    else { setErro(null); setFeedback(res.message); setEstado((e: any) => ({ ...e, canal: res.canal })) }
    setSalvando(false)
  }

  /**
   * O rótulo distingue consentimento de efetividade. Depois de uma transferência para lotação não
   * habilitada, o status continua `ativo` — a pessoa não retirou nada — mas nada é entregue.
   * Mostrar só "Ativado" ali seria o sistema afirmando algo que não cumpre.
   */
  const rotuloSituacao = (status: string, efetivo: boolean) => {
    if (status === 'pendente_confirmacao') {
      return { texto: 'Aguardando sua resposta no WhatsApp', cor: 'text-amber-600' }
    }
    if (status === 'ativo') {
      return efetivo
        ? { texto: 'Ativado', cor: 'text-emerald-600' }
        : { texto: 'Ativado — indisponível na sua lotação atual', cor: 'text-amber-600' }
    }
    return { texto: 'Desativado', cor: 'text-zinc-500' }
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

      {/* Lotação fora do escopo: o botão nasce desabilitado, e não deixando clicar para falhar
          depois. Antes da v1.31.0 o clique já disparava a mensagem de confirmação por WhatsApp —
          furando o portão de rollout, no mesmo número que serve o acionamento de sobreaviso. */}
      {!estado?.unidadeHabilitada && status === 'inativo' && (
        <div className="flex items-start gap-3 p-4 bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-2xl">
          <Info className="h-4 w-4 text-zinc-500 mt-0.5 shrink-0" />
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            O aviso de ponto <b>ainda não está disponível na sua lotação</b>. O recurso está sendo
            liberado aos poucos, setor por setor. Fale com seu coordenador se quiser usá-lo.
          </p>
        </div>
      )}

      {bloqueado && estado?.unidadeHabilitada && (
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
          <p className={`text-sm font-black ${rotuloSituacao(status, !!estado?.efetivo).cor}`}>
            {rotuloSituacao(status, !!estado?.efetivo).texto}
          </p>
          {estado?.telefone && (
            <p className="text-[11px] text-zinc-400 mt-0.5">Telefone: {estado.telefone}</p>
          )}
        </div>

        {/* Com pedido pendente o botão só oferece cancelar: reenviar a confirmação é exatamente
            a insistência que gera bloqueio, e o banco recusaria de qualquer forma. */}
        {/* Desativar NUNCA é bloqueado, mesmo fora do escopo: amarrar a saída à habilitação
            prenderia a pessoa numa preferência que ela não pode mudar. Só o ATIVAR é gateado. */}
        <button
          type="button"
          disabled={salvando || (status === 'inativo' && (bloqueado || !estado?.unidadeHabilitada))}
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
       <>
        <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-zinc-400">
              Por onde você quer receber
            </p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              O e-mail é o canal padrão por ser mais estável. O WhatsApp continua disponível.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {CANAIS.map(c => {
              const escolhido = (estado?.canal || 'email') === c.chave
              return (
                <label
                  key={c.chave}
                  className={`flex items-start gap-3 p-4 rounded-2xl border-2 transition-all ${
                    !c.disponivel
                      ? 'border-zinc-200 dark:border-zinc-800 opacity-60 cursor-not-allowed'
                      : escolhido
                        ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20 cursor-pointer'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="aviso_ponto_canal"
                    checked={escolhido}
                    disabled={salvando || !c.disponivel}
                    onChange={() => salvarCanal(c.chave)}
                    className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-black text-zinc-900 dark:text-white">{c.titulo}</span>
                    <p className="text-xs text-zinc-500 leading-relaxed">{c.detalhe}</p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-zinc-400">
              Com que frequência você quer receber
            </p>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Registro fora do horário previsto também entra no resumo do dia, junto com os
              demais.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {MODOS.map(m => {
              const escolhido = (estado?.modo || 'resumo_semanal') === m.chave
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
       </>
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
