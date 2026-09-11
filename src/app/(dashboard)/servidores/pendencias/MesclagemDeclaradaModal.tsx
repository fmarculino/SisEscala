'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Merge } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import {
  avisosDaDeclaracao, conferirMotivoDeclaracao, descreverEscalasFundidas, descreverMovimentacao,
  ehMatriculaTemporaria, MOTIVO_DECLARACAO_MINIMO,
  type DivergenciaIdentidade, type ServidorSuspeito,
} from '@/utils/mesclagemCadastro'
import {
  listarDivergenciasIdentidade, verificarMesclagemCadastro, mesclarCadastrosServidor,
  listarDependenciasServidor,
} from '../actions'

/**
 * Mesclagem de dois cadastros da MESMA PESSOA cujo CPF não bate.
 *
 * 🚨 Por que existe uma tela separada da seção "Cadastros duplicados": lá o CPF igual é a prova,
 * e a decisão é só "qual dos dois fica". Aqui não há prova nenhuma — quem clica é que está
 * afirmando que são a mesma pessoa. Reaproveitar o mesmo fluxo transformaria uma declaração
 * pessoal em mais um botão azul.
 *
 * A tela inteira serve a uma pergunta: **o cadastro duplicado não foi preenchido com os dados de
 * outra pessoa?** Por isso ela mostra a identidade que diverge lado a lado, e não só o CPF — no
 * caso que motivou a funcionalidade, PIS, data de nascimento (20 anos) e nome da mãe também
 * divergiam, e era isso, não o CPF, que contava a história.
 *
 * ⚠️ Nada nasce marcado, nem o cadastro que fica, nem a declaração. Pré-marcar transforma
 * conferência em clique.
 */

interface Props {
  aberto: boolean
  onFechar: () => void
  servidores: ServidorSuspeito[]
}

interface Impedimento { motivo: string; detalhe: string }
interface Dependencia { tabela: string; coluna: string; qtd: number }

function formatarCpf(cpf: string | null): string {
  const d = (cpf || '').replace(/\D/g, '')
  if (d.length !== 11) return cpf || '—'
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

export function MesclagemDeclaradaModal({ aberto, onFechar, servidores }: Props) {
  const router = useRouter()
  const [destinoId, setDestinoId] = useState('')
  const [divergencias, setDivergencias] = useState<DivergenciaIdentidade[] | null>(null)
  const [impedimentos, setImpedimentos] = useState<Impedimento[] | null>(null)
  const [dependencias, setDependencias] = useState<Dependencia[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [declarou, setDeclarou] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [mesclando, setMesclando] = useState(false)
  const [feito, setFeito] = useState<{ movimentos: string[]; fundidas: string[] } | null>(null)

  const destino = servidores.find(s => s.id === destinoId) || null
  const origem = servidores.find(s => s.id !== destinoId) || null

  // Reabrir o modal não pode herdar a decisão da vez anterior: a escolha é sobre este par, agora.
  useEffect(() => {
    if (aberto) return
    setDestinoId(''); setDivergencias(null); setImpedimentos(null); setDependencias(null)
    setDeclarou(false); setMotivo(''); setErro(null); setFeito(null)
  }, [aberto])

  useEffect(() => {
    if (!origem || !destino) { setDivergencias(null); setImpedimentos(null); setDependencias(null); return }
    let cancelado = false
    setCarregando(true)
    setErro(null)
    Promise.all([
      listarDivergenciasIdentidade(origem.id, destino.id),
      // `true`: pergunta o que ainda impede DEPOIS de declarar a identidade. Perguntar sem isso
      // devolveria o CPF divergente, que é justamente o que esta tela existe para declarar — e
      // esconderia qualquer outro impedimento atrás dele.
      verificarMesclagemCadastro(origem.id, destino.id, true),
      listarDependenciasServidor(origem.id),
    ]).then(([div, imp, dep]) => {
      if (cancelado) return
      if ('error' in div && div.error) { setErro(div.error); return }
      if ('error' in imp && imp.error) { setErro(imp.error); return }
      setDivergencias(('divergencias' in div ? div.divergencias : []) || [])
      setImpedimentos(('impedimentos' in imp ? imp.impedimentos : []) || [])
      setDependencias(('dependencias' in dep ? dep.dependencias : []) || [])
    }).finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
    // Dependência é o ID, não o objeto: `servidores` chega por prop e um objeto novo a cada
    // render refaria as três consultas sem que nada tenha mudado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origem?.id, destino?.id])

  const motivoConferido = conferirMotivoDeclaracao(motivo)
  const bloqueado = (impedimentos?.length || 0) > 0
  const pronto = !!origem && !!destino && !carregando && !bloqueado
    && impedimentos !== null && declarou && motivoConferido.ok

  async function confirmar() {
    if (!origem || !destino) return
    setMesclando(true)
    setErro(null)
    const res = await mesclarCadastrosServidor(origem.id, destino.id, motivo, true)
    setMesclando(false)
    if ('error' in res && res.error) { setErro(res.error); return }
    setFeito({
      movimentos: ('movimentos' in res ? res.movimentos : []) || [],
      fundidas: ('escalasFundidas' in res ? res.escalasFundidas : []) || [],
    })
    router.refresh()
  }

  return (
    <Modal isOpen={aberto} onClose={onFechar} title="Mesclar cadastros com CPF diferente">
      {feito ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Cadastros mesclados.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {feito.movimentos.length
              ? `Movido para a matrícula ${destino?.matricula}: ${feito.movimentos.join(', ')}.`
              : 'O cadastro duplicado não tinha nenhum vínculo — nada precisou ser movido.'}
          </p>
          {feito.fundidas.length > 0 && (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              <p className="font-medium">Escalas fundidas:</p>
              <ul className="mt-1 list-disc pl-5">{feito.fundidas.map(e => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          <p className="rounded-lg bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            A declaração de identidade e o motivo que você escreveu ficaram gravados no motivo da
            inativação do cadastro duplicado e no log do sistema.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onFechar} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Fechar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            Estes cadastros têm <strong>CPF diferente</strong>. Se não for a mesma pessoa, mesclar
            faz o ponto de uma virar ponto da outra — e não há como desfazer. Confira as duas
            fichas antes de continuar.
          </p>

          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Qual cadastro fica? O outro será inativado.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {servidores.map(s => {
                const escolhido = s.id === destinoId
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setDestinoId(s.id); setDeclarou(false) }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      escolhido
                        ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/60 dark:bg-emerald-500/10'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <p className="font-medium text-zinc-900 dark:text-white text-sm">
                      Matrícula {s.matricula || '—'}
                      {ehMatriculaTemporaria(s.matricula) && (
                        <span className="ml-2 rounded bg-amber-100 dark:bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                          temporária
                        </span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{formatarCpf(s.cpf)}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.unidade || 'sem unidade'}</p>
                    <p className={`mt-2 text-xs font-semibold ${escolhido ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-400'}`}>
                      {escolhido ? '✓ este fica' : 'este fica'}
                    </p>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Abra as fichas para conferir:{' '}
              {servidores.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ' · '}
                  <Link href={`/servidores/${s.id}`} target="_blank" className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
                    {s.matricula || s.id.slice(0, 8)} <ExternalLink className="h-3 w-3" />
                  </Link>
                </span>
              ))}
            </p>
          </div>

          {carregando && (
            <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Conferindo as duas fichas…
            </p>
          )}

          {/* O CORAÇÃO DA TELA: a identidade inteira que diverge, lado a lado. Não é detalhe —
              é o que responde "isto é duplicidade ou ficha de outra pessoa?". */}
          {divergencias && divergencias.length > 0 && origem && destino && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 overflow-hidden">
              <p className="bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm font-medium text-red-800 dark:text-red-300">
                O que é diferente entre as duas fichas
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase border-b border-zinc-200 dark:border-zinc-800">
                      <th className="px-3 py-2">Dado</th>
                      <th className="px-3 py-2">Fica ({destino.matricula})</th>
                      <th className="px-3 py-2">Sai ({origem.matricula})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {divergencias.map(d => (
                      <tr key={d.campo}>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{d.rotulo}</td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200">{d.valor_destino || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200">{d.valor_origem || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-zinc-100 dark:border-zinc-800 px-3 py-2 space-y-1">
                {avisosDaDeclaracao(divergencias).map((a, i) => (
                  <p key={i} className="text-xs text-zinc-600 dark:text-zinc-400">• {a}</p>
                ))}
              </div>
            </div>
          )}

          {impedimentos && impedimentos.length > 0 && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-500/10 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-300">
                <AlertTriangle className="h-4 w-4" /> Não dá para mesclar assim:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-red-700 dark:text-red-400 list-disc pl-5">
                {impedimentos.map((i, idx) => <li key={idx}>{i.detalhe}</li>)}
              </ul>
            </div>
          )}

          {dependencias && origem && destino && !bloqueado && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3 text-sm">
              <p className="text-zinc-700 dark:text-zinc-300">
                Passa da matrícula <strong>{origem.matricula}</strong> para a{' '}
                <strong>{destino.matricula}</strong>:
              </p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                {dependencias.length
                  ? descreverMovimentacao(
                      Object.fromEntries(dependencias.map(d => [`${d.tabela}.${d.coluna}`, d.qtd])),
                    ).join(', ')
                  : 'nada — o cadastro duplicado está vazio.'}
              </p>
            </div>
          )}

          {impedimentos && !bloqueado && origem && destino && (
            <>
              <label className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={declarou}
                  onChange={e => setDeclarou(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  Conferi as duas fichas e <strong>declaro que são a mesma pessoa</strong>. Sei que
                  o CPF da matrícula {origem.matricula} está cadastrado errado e que esta operação
                  não tem como ser desfeita.
                </span>
              </label>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Por que são a mesma pessoa? <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  rows={2}
                  placeholder="ex.: recadastrada por engano em 08/09 com o CPF de outra servidora; conferido com o RH pela matrícula e pelo cargo"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {motivoConferido.ok
                    ? 'Fica gravado no cadastro inativado e no log do sistema.'
                    : `Obrigatório aqui (mínimo ${MOTIVO_DECLARACAO_MINIMO} caracteres): com o CPF diferente, `
                      + 'este texto é a única prova que vai ficar registrada.'}
                </p>
              </div>
            </>
          )}

          {erro && (
            <p className="rounded-lg bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{erro}</p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onFechar} className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!pronto || mesclando}
              onClick={confirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {mesclando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
              Mesclar assim mesmo
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
