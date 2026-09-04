'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Users, Loader2, AlertTriangle, CheckCircle2, ExternalLink, Merge, Info, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { formatarData } from '@/utils/horario'
import {
  avisosDaMesclagem, descreverPeso, ehMatriculaTemporaria, sugerirDestino, validarEscolha,
  type CadastroDuplicado, type GrupoDuplicado,
} from '@/utils/mesclagemCadastro'
import { verificarMesclagemCadastro, mesclarCadastrosServidor } from '../actions'

/**
 * Cadastros duplicados — só para o Administrador Geral.
 *
 * A tela de pendências já LISTAVA duplicidade (fn_possiveis_duplicidades_servidor) e não oferecia
 * ação nenhuma sobre ela: quem via o problema não tinha o que fazer com a informação. Esta seção
 * é a ação — escolher qual cadastro fica e mover tudo do outro para ele.
 *
 * ⚠️ Duas coisas que a tela NÃO faz de propósito:
 *
 *   1. não escolhe sozinha qual cadastro fica. Há sugestão (matrícula definitiva vence a
 *      temporária) e ela vem escrita com o motivo, mas NADA nasce marcado: o Administrador
 *      clica em "este cadastro fica" olhando os dois lados. Pré-marcar transformaria a
 *      heurística em decisão, e ela erra quando as duas matrículas são temporárias;
 *   2. não esconde o grupo já marcado como "vínculo duplo confirmado". Foi exatamente uma
 *      confirmação marcada por engano que criou o caso relatado — esconder o grupo confirmado
 *      esconderia justamente o que esta ferramenta existe para desfazer. Ele aparece por último,
 *      rotulado.
 */

interface Props {
  grupos: GrupoDuplicado[]
  erro: string | null
}

interface Impedimento { motivo: string; detalhe: string }

function formatarCpf(cpf: string): string {
  const d = (cpf || '').replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function CartaoCadastro({
  cadastro, papel, onEscolher, escolhivel,
}: {
  cadastro: CadastroDuplicado
  papel: 'fica' | 'duplicado' | null
  onEscolher: () => void
  escolhivel: boolean
}) {
  const borda = papel === 'fica'
    ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/60 dark:bg-emerald-500/10'
    : papel === 'duplicado'
      ? 'border-amber-400 dark:border-amber-600 bg-amber-50/60 dark:bg-amber-500/10'
      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'

  return (
    <div className={`rounded-lg border p-4 ${borda}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 dark:text-white truncate">{cadastro.nome?.trim()}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Matrícula <span className="font-mono">{cadastro.matricula || '—'}</span>
            {ehMatriculaTemporaria(cadastro.matricula) && (
              <span className="ml-2 rounded bg-amber-100 dark:bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                temporária
              </span>
            )}
          </p>
        </div>
        <Link
          href={`/servidores/${cadastro.id}`}
          target="_blank"
          className="shrink-0 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400"
          title="Abrir a ficha em outra aba"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400 shrink-0">Lotação:</dt>
          <dd className="text-zinc-700 dark:text-zinc-300 min-w-0">
            {cadastro.unidade || '—'}{cadastro.setor ? ` / ${cadastro.setor}` : ''}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400 shrink-0">Cargo:</dt>
          <dd className="text-zinc-700 dark:text-zinc-300 min-w-0">{cadastro.cargo || '—'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400 shrink-0">Situação:</dt>
          <dd className="text-zinc-700 dark:text-zinc-300">
            {cadastro.status}
            {cadastro.vinculo ? ` · ${cadastro.vinculo}` : ''}
            {' · cadastrado em '}
            {formatarData(cadastro.criado_em)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400 shrink-0">Vínculos:</dt>
          <dd className="text-zinc-700 dark:text-zinc-300">{descreverPeso(cadastro)}</dd>
        </div>
      </dl>

      {escolhivel && (
        <button
          type="button"
          onClick={onEscolher}
          className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            papel === 'fica'
              ? 'bg-emerald-600 text-white'
              : 'border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
          }`}
        >
          {papel === 'fica' ? '✓ Este cadastro fica' : 'Este cadastro fica'}
        </button>
      )}

      {papel === 'duplicado' && (
        <p className="mt-3 rounded-lg bg-amber-100/70 dark:bg-amber-500/15 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Será inativado e apontará para o cadastro que fica.
        </p>
      )}
    </div>
  )
}

function Grupo({ grupo }: { grupo: GrupoDuplicado }) {
  const router = useRouter()
  const sugestao = useMemo(() => sugerirDestino(grupo), [grupo])

  const [aberto, setAberto] = useState(false)
  const [destinoId, setDestinoId] = useState<string>('')
  const [origemId, setOrigemId] = useState<string>('')
  const [impedimentos, setImpedimentos] = useState<Impedimento[] | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [mesclando, setMesclando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [feito, setFeito] = useState<string[] | null>(null)

  // Com DOIS cadastros, escolher quem fica já diz quem é o duplicado. Com três ou mais, o resto
  // continua na lista e a mesclagem é feita um par por vez - juntar três de uma vez esconderia
  // qual foi para onde no log.
  useEffect(() => {
    if (!destinoId) { setOrigemId(''); return }
    const outros = grupo.cadastros.filter(c => c.id !== destinoId)
    setOrigemId(outros.length === 1 ? outros[0].id : '')
  }, [destinoId, grupo.cadastros])

  useEffect(() => {
    if (!origemId || !destinoId) { setImpedimentos(null); return }
    let cancelado = false
    setVerificando(true)
    verificarMesclagemCadastro(origemId, destinoId)
      .then(res => {
        if (cancelado) return
        if ('error' in res && res.error) setErro(res.error)
        else setImpedimentos(('impedimentos' in res ? res.impedimentos : []) || [])
      })
      .finally(() => { if (!cancelado) setVerificando(false) })
    return () => { cancelado = true }
  }, [origemId, destinoId])

  const origem = grupo.cadastros.find(c => c.id === origemId) || null
  const destino = grupo.cadastros.find(c => c.id === destinoId) || null
  const validacao = validarEscolha(grupo, { origemId, destinoId })
  const bloqueado = (impedimentos?.length || 0) > 0
  const podeMesclar = validacao.ok && !bloqueado && !verificando && impedimentos !== null

  async function confirmar() {
    if (!origem || !destino) return
    setMesclando(true)
    setErro(null)
    const res = await mesclarCadastrosServidor(origemId, destinoId, motivo)
    setMesclando(false)
    if ('error' in res && res.error) { setErro(res.error); return }
    setConfirmando(false)
    setFeito(('movimentos' in res ? res.movimentos : []) || [])
    router.refresh()
  }

  const nome = grupo.cadastros[0]?.nome?.trim() || '(sem nome)'

  if (feito) {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-500/10 p-4">
        <p className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {nome} — cadastros mesclados.
        </p>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
          {feito.length
            ? `Movido para a matrícula ${destino?.matricula}: ${feito.join(', ')}.`
            : 'O cadastro duplicado não tinha nenhum vínculo — nada precisou ser movido.'}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <div className="min-w-0">
          <p className="font-medium text-zinc-900 dark:text-white truncate">{nome}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            CPF {formatarCpf(grupo.cpf)} · {grupo.quantidade} cadastros
            {grupo.todos_confirmados && ' · marcado como vínculo duplo confirmado'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {grupo.todos_confirmados && (
            <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              confirmado
            </span>
          )}
          {aberto ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
          {grupo.todos_confirmados && (
            <p className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Este grupo está marcado como vínculo duplo legítimo (a mesma pessoa com dois cargos).
                Se for isso mesmo, <strong>não mescle</strong> — os dois vínculos precisam existir
                separados. Mescle apenas se a confirmação tiver sido marcada por engano.
              </span>
            </p>
          )}

          {sugestao && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Sugestão: fica a{' '}
              <strong className="text-zinc-800 dark:text-zinc-200">
                {grupo.cadastros.find(c => c.id === sugestao.destinoId)?.matricula}
              </strong>{' '}
              — {sugestao.razao}. Confirme abaixo.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {grupo.cadastros.map(c => (
              <CartaoCadastro
                key={c.id}
                cadastro={c}
                papel={c.id === destinoId ? 'fica' : c.id === origemId ? 'duplicado' : null}
                escolhivel
                onEscolher={() => { setDestinoId(c.id); setImpedimentos(null); setErro(null) }}
              />
            ))}
          </div>

          {destinoId && !origemId && grupo.cadastros.length > 2 && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Qual cadastro é o duplicado a mesclar agora?
              </label>
              <select
                value={origemId}
                onChange={e => setOrigemId(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              >
                <option value="">Selecione…</option>
                {grupo.cadastros.filter(c => c.id !== destinoId).map(c => (
                  <option key={c.id} value={c.id}>{c.matricula} — {c.unidade || 'sem unidade'}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Com mais de dois cadastros, mescle um por vez: o log fica dizendo qual foi para onde.
              </p>
            </div>
          )}

          {verificando && (
            <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Conferindo se a mesclagem é possível…
            </p>
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

          {impedimentos && impedimentos.length === 0 && origem && destino && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-3 space-y-2">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Tudo da matrícula <strong>{origem.matricula}</strong> passa para a{' '}
                <strong>{destino.matricula}</strong> ({descreverPeso(origem)}).
              </p>
              {avisosDaMesclagem(origem, destino).map((a, idx) => (
                <p key={idx} className="text-xs text-zinc-600 dark:text-zinc-400">• {a}</p>
              ))}
            </div>
          )}

          {erro && (
            <p className="rounded-lg bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {erro}
            </p>
          )}

          {!validacao.ok && destinoId && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{validacao.erro}</p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!podeMesclar}
              onClick={() => setConfirmando(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Merge className="h-4 w-4" /> Mesclar cadastros
            </button>
          </div>
        </div>
      )}

      <Modal isOpen={confirmando} onClose={() => setConfirmando(false)} title="Confirmar mesclagem">
        {origem && destino && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              A matrícula <strong>{origem.matricula}</strong> ({origem.unidade || 'sem unidade'}) será{' '}
              <strong>inativada</strong>, e tudo que está nela passa para a matrícula{' '}
              <strong>{destino.matricula}</strong> ({destino.unidade || 'sem unidade'}).
            </p>

            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Vai ser movido: {descreverPeso(origem)}.
            </p>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Por que este cadastro é duplicado? <span className="text-zinc-400">(opcional)</span>
              </label>
              <input
                type="text"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="ex.: cadastrado por engano pela outra unidade"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Fica gravado no motivo da inativação e no log do sistema.
              </p>
            </div>

            {erro && (
              <p className="rounded-lg bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {erro}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={mesclando}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {mesclando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
                Mesclar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export function CadastrosDuplicadosSection({ grupos, erro }: Props) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-500" /> Cadastros duplicados
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          O mesmo CPF em mais de um cadastro. Mesclar move ponto, escala e folha do cadastro errado
          para o correto e inativa o errado — nada é apagado. Só o Administrador Geral vê esta seção.
        </p>
      </div>
      <div className="p-5 space-y-3">
        {erro ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Não foi possível carregar os cadastros duplicados ({erro}).</span>
          </div>
        ) : grupos.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 py-6 justify-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Nenhum CPF com mais de um cadastro.
          </div>
        ) : (
          grupos.map(g => <Grupo key={g.cpf} grupo={g} />)
        )}
      </div>
    </section>
  )
}
