'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  ShieldCheck, Send, AlertTriangle, Loader2, Clock, Ban, MessageSquare, Info
} from 'lucide-react'

/**
 * Auditoria do aviso de ponto por WhatsApp.
 *
 * Reúne três trilhas que existiam no banco sem nenhuma tela:
 *
 *   `logs_preferencia_aviso_ponto` — o **consentimento**. É a evidência que sustenta o envio:
 *     quem pediu, quando, que texto leu e a resposta que provou posse do número. Se alguém
 *     questionar "por que o sistema manda meu ponto pro WhatsApp?", a resposta está aqui.
 *
 *   `avisos_ponto_fila` — os **envios e as falhas**. Falha era invisível: quando um servidor
 *     dissesse "não recebi o aviso de ontem", ninguém respondia sem abrir o banco.
 *
 *   `servidores.aviso_ponto_status` — o **estado atual**, que diverge do efetivo de propósito
 *     depois de uma transferência (ver `fn_aviso_ponto_efetivo`).
 *
 * Só administradores leem estas tabelas desde `20260809200000` — elas guardam telefone e o texto
 * das mensagens, que inclui os horários de ponto da pessoa.
 */

interface Consentimento {
  id: string
  servidor_id: string
  acao: string
  origem: string
  registrado_em: string
  telefone_na_epoca: string | null
  termo_versao: string | null
  servidores?: { nome: string; matricula: string } | null
}

interface ItemFila {
  id: string
  tipo: string
  status: string
  evento: string | null
  telefone: string
  tentativas: number
  motivo_falha: string | null
  criado_em: string
  processado_em: string | null
  servidores?: { nome: string; matricula: string } | null
}

const ROTULO_ACAO: Record<string, { texto: string; cor: string }> = {
  solicitou: { texto: 'Pediu no Portal', cor: 'text-blue-600' },
  confirmou: { texto: 'Confirmou no WhatsApp', cor: 'text-emerald-600 font-bold' },
  desativou: { texto: 'Desativou no Portal', cor: 'text-zinc-500' },
  expirou: { texto: 'Pedido expirou', cor: 'text-amber-600' },
  parou_pelo_whatsapp: { texto: 'Respondeu PARAR', cor: 'text-red-600 font-bold' },
}

export function AvisosPontoAuditoria() {
  const supabase = createClient()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [consent, setConsent] = useState<Consentimento[]>([])
  const [fila, setFila] = useState<ItemFila[]>([])
  const [porStatus, setPorStatus] = useState<Record<string, number>>({})

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)

    const [c, f, s] = await Promise.all([
      supabase.from('logs_preferencia_aviso_ponto')
        .select('*, servidores(nome, matricula)')
        .order('registrado_em', { ascending: false }).limit(100),
      supabase.from('avisos_ponto_fila')
        .select('*, servidores(nome, matricula)')
        .order('criado_em', { ascending: false }).limit(100),
      supabase.from('servidores').select('aviso_ponto_status'),
    ])

    // Erro aqui é quase sempre RLS: a tela é super_admin, mas quem abriu pode ser admin comum.
    // Dizer isso é mais útil que uma lista vazia sem explicação.
    if (c.error || f.error) {
      setErro(c.error?.message || f.error?.message || 'Falha ao carregar')
      setCarregando(false)
      return
    }

    setConsent((c.data || []) as any)
    setFila((f.data || []) as any)

    const cont: Record<string, number> = {}
    ;(s.data || []).forEach((x: any) => { cont[x.aviso_ponto_status] = (cont[x.aviso_ponto_status] || 0) + 1 })
    setPorStatus(cont)
    setCarregando(false)
  }, [supabase])

  useEffect(() => { carregar() }, [carregar])

  const falhas = fila.filter(f => f.status === 'falha')
  const enviados = fila.filter(f => f.status === 'enviado')
  const pendentes = fila.filter(f => f.status === 'pendente')

  const hora = (t: string | null) => t
    ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-16 justify-center text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando trilha do aviso de ponto…
      </div>
    )
  }

  if (erro) {
    return (
      <div className="m-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-700 dark:text-red-400">
        <p className="font-bold">Não foi possível carregar.</p>
        <p className="text-xs mt-1">{erro}</p>
        <p className="text-xs mt-2 text-red-600/80">
          Estas tabelas são restritas a administradores desde a v1.35.0 — guardam telefone e o texto
          das mensagens, que inclui horários de ponto.
        </p>
      </div>
    )
  }

  const cards = [
    { rotulo: 'Consentiram', valor: porStatus['ativo'] || 0, Icone: ShieldCheck, cor: 'text-emerald-600', borda: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20' },
    { rotulo: 'Aguardando resposta', valor: porStatus['pendente_confirmacao'] || 0, Icone: Clock, cor: 'text-amber-600', borda: 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20' },
    { rotulo: 'Mensagens enviadas', valor: enviados.length, Icone: Send, cor: 'text-blue-600', borda: 'border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20' },
    { rotulo: 'Falhas de envio', valor: falhas.length, Icone: AlertTriangle, cor: falhas.length ? 'text-red-600' : 'text-zinc-500', borda: falhas.length ? 'border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20' : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => (
          <div key={c.rotulo} className={`p-4 rounded-2xl border-2 ${c.borda}`}>
            <div className={`flex items-center gap-1.5 ${c.cor}`}>
              <c.Icone className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-wider leading-tight">{c.rotulo}</span>
            </div>
            <p className={`text-2xl font-black mt-1 ${c.cor}`}>{c.valor}</p>
          </div>
        ))}
      </div>

      {/* Falhas primeiro: é a informação acionável. Enterrá-las embaixo da trilha de consentimento
          repetiria o erro da aba de tentativas negadas, onde o que importa ficava afogado. */}
      {falhas.length > 0 && (
        <div className="rounded-2xl border border-red-200 dark:border-red-800 overflow-hidden">
          <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <h3 className="text-xs font-black uppercase tracking-wider text-red-700 dark:text-red-400">
              Mensagens que não chegaram
            </h3>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-red-100 dark:divide-red-900/40">
              {falhas.map(f => (
                <tr key={f.id}>
                  <td className="py-2.5 px-4">
                    <p className="font-bold text-zinc-800 dark:text-zinc-200">{f.servidores?.nome || '—'}</p>
                    <p className="text-[10px] text-zinc-400">{f.telefone} · {f.tipo}</p>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-zinc-500 whitespace-nowrap">{hora(f.criado_em)}</td>
                  <td className="py-2.5 px-4 text-xs text-red-600">{f.motivo_falha || 'sem motivo registrado'}</td>
                  <td className="py-2.5 px-4 text-xs text-zinc-400 whitespace-nowrap">{f.tentativas} tentativa(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TRILHA DE CONSENTIMENTO */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/60 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <h3 className="text-xs font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            Trilha de consentimento
          </h3>
        </div>
        {consent.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">Nenhum consentimento registrado ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/50 dark:bg-zinc-800/30">
              <tr>
                {['Servidor', 'Ação', 'Origem', 'Telefone na época', 'Termo', 'Quando'].map(h => (
                  <th key={h} className="py-2 px-4 text-left text-[10px] font-black uppercase tracking-wider text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {consent.map(c => {
                const r = ROTULO_ACAO[c.acao] || { texto: c.acao, cor: 'text-zinc-500' }
                return (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-2.5 px-4">
                      <p className="font-bold text-zinc-800 dark:text-zinc-200">{c.servidores?.nome || '—'}</p>
                      <p className="text-[10px] text-zinc-400">{c.servidores?.matricula}</p>
                    </td>
                    <td className={`py-2.5 px-4 text-xs ${r.cor}`}>{r.texto}</td>
                    <td className="py-2.5 px-4 text-xs text-zinc-500">{c.origem}</td>
                    <td className="py-2.5 px-4 text-xs font-mono text-zinc-500">{c.telefone_na_epoca || '—'}</td>
                    <td className="py-2.5 px-4 text-xs text-zinc-400">{c.termo_versao || '—'}</td>
                    <td className="py-2.5 px-4 text-xs text-zinc-500 whitespace-nowrap">{hora(c.registrado_em)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ENVIOS RECENTES */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
              Envios recentes
            </h3>
          </div>
          {pendentes.length > 0 && (
            <span className="text-[10px] font-bold text-amber-600 uppercase">{pendentes.length} na fila</span>
          )}
        </div>
        {fila.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">Nenhuma mensagem enfileirada ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {fila.slice(0, 30).map(f => (
                <tr key={f.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="py-2.5 px-4">
                    <p className="font-bold text-zinc-800 dark:text-zinc-200">{f.servidores?.nome || '—'}</p>
                    <p className="text-[10px] text-zinc-400">{f.tipo}{f.evento ? ` · ${f.evento}` : ''}</p>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${
                      f.status === 'enviado' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : f.status === 'falha' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>{f.status}</span>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-zinc-500 whitespace-nowrap">{hora(f.criado_em)}</td>
                  <td className="py-2.5 px-4 text-xs text-zinc-400 whitespace-nowrap">
                    {f.processado_em ? `entregue ${hora(f.processado_em)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-start gap-2 text-[11px] text-zinc-500 leading-relaxed">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
        <p>
          <b>Consentiram</b> conta quem decidiu receber. Não é o mesmo que <b>quem recebe agora</b> —
          depois de uma transferência para lotação não habilitada, o consentimento continua válido
          (a pessoa não retirou nada) mas nada é entregue. Para contar quem recebe de fato, use
          <code className="mx-1 px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded font-mono">fn_aviso_ponto_efetivo</code>.
        </p>
      </div>
    </div>
  )
}
