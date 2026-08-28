'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, UserX, Copy, Hash, CheckCircle2, Search,
  ChevronDown, ChevronUp, ExternalLink, Info, UserPlus, ArrowRightLeft,
} from 'lucide-react'
import { ImportacaoRhSection } from './ImportacaoRhSection'
import { SolicitacoesTransferenciaSection } from './SolicitacoesTransferenciaSection'

interface DocumentoInvalido {
  tabela: string
  campo: string
  registro_id: string
  nome: string
  valor: string
  problema: string
}

interface DuplicidadeServidor {
  id: string
  nome: string
  matricula: string | null
  cpf: string | null
  telefone: string | null
  email: string | null
  status: string
  unidade: string | null
}

interface Duplicidade {
  criterio: 'cpf' | 'nome' | 'telefone' | 'email'
  chave: string
  quantidade: number
  servidores: DuplicidadeServidor[]
}

interface SemCpf {
  id: string
  nome: string
  matricula: string | null
  status: string
  unidade_nome: string | null
  setor_nome: string | null
}

interface PendenteRh {
  id: string
  nome: string
  matricula: string
  classificacao: string | null
  cargo_sugerido: string | null
  unidade_id: string | null
  unidade_nome: string | null
  departamento_origem: string
  vinculo_adicional_de_cpf: boolean
}

interface PendenciasCadastroClientProps {
  documentosInvalidos: DocumentoInvalido[]
  duplicidades: Duplicidade[]
  semCpf: SemCpf[]
  totalServidores: number
  semPisCount: number
  erroDocumentos: string | null
  erroDuplicidades: string | null
  pendentesRh: PendenteRh[]
  erroPendentesRh: string | null
  unidades: { id: string; nome: string }[]
  setores: { id: string; unidade_id: string | null; nome: string }[]
  cargos: { id: string; nome: string }[]
  solicitacoesTransferencia: {
    id: string
    servidorId: string
    servidorNome: string
    servidorMatricula: string | null
    unidadeOrigemId: string | null
    setorOrigemId: string | null
    unidadeDestinoId: string | null
    setorDestinoId: string | null
    unidadeOrigemNome: string
    setorOrigemNome: string
    unidadeDestinoNome: string
    setorDestinoNome: string
    dataTransferenciaSugerida: string
    motivo: string
    solicitadoPorNome: string
    solicitadoEm: string
    podeAvaliar: boolean
    motivoSemPermissao: string | null
  }[]
  erroSolicitacoesTransferencia: string | null
  /** O papel de quem olha avalia transferência (super_admin, RH Geral ou RH da Unidade). */
  podeAvaliarTransferencia: boolean
  /**
   * true pra coordenador e RH da Unidade: a seção de importação de RH (escopada pela própria
   * unidade via RLS) é a relevante pra eles — mais a de transferências, pra quem avalia. As demais seções são `SECURITY DEFINER` e enxergam
   * a base inteira sem escopo de unidade/setor, de propósito (armadilha do CLAUDE.md sobre
   * `fn_documentos_invalidos`/`fn_possiveis_duplicidades_servidor`) — abri-las pra coordenador
   * vazaria CPF/nome de servidor de outras unidades.
   */
  escopoLimitado: boolean
}

const CRITERIO_LABEL: Record<Duplicidade['criterio'], string> = {
  cpf: 'Mesmo CPF',
  nome: 'Nome idêntico',
  telefone: 'Mesmo telefone',
  email: 'Mesmo e-mail',
}

function editLink(tabela: string, id: string) {
  return tabela === 'unidades' ? `/unidades/${id}` : `/servidores/${id}`
}

function StatCard({ icon: Icon, label, value, tone, note }: {
  icon: any; label: string; value: number; tone: 'red' | 'amber' | 'zinc' | 'green'; note?: string
}) {
  const toneClasses: Record<string, string> = {
    red: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
    zinc: 'text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800',
    green: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
  }
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-start gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-zinc-900 dark:text-white leading-none">{value}</p>
        <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
        {note && <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{note}</p>}
      </div>
    </div>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <span>Não foi possível carregar esta seção ({message}). Provavelmente uma restrição de acesso (RLS) — confirme que está logado como administrador.</span>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 py-6 justify-center">
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      {text}
    </div>
  )
}

export function PendenciasCadastroClient({
  documentosInvalidos, duplicidades, semCpf, totalServidores, semPisCount,
  erroDocumentos, erroDuplicidades,
  pendentesRh, erroPendentesRh, unidades, setores, cargos,
  solicitacoesTransferencia, erroSolicitacoesTransferencia, podeAvaliarTransferencia,
  escopoLimitado,
}: PendenciasCadastroClientProps) {
  const [buscaSemCpf, setBuscaSemCpf] = useState('')
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set())

  const semCpfFiltrado = useMemo(() => {
    const termo = buscaSemCpf.toLowerCase().trim()
    if (!termo) return semCpf
    return semCpf.filter(s =>
      s.nome.toLowerCase().includes(termo) ||
      s.matricula?.toLowerCase().includes(termo) ||
      s.unidade_nome?.toLowerCase().includes(termo)
    )
  }, [semCpf, buscaSemCpf])

  const toggleGrupo = (chave: string) => {
    setGruposAbertos(prev => {
      const next = new Set(prev)
      if (next.has(chave)) next.delete(chave)
      else next.add(chave)
      return next
    })
  }

  if (escopoLimitado) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Pendências de Cadastro</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            {podeAvaliarTransferencia
              ? 'Vínculos importados do RH aguardando virar cadastro ativo e pedidos de transferência das suas unidades.'
              : 'Vínculos importados do RH aguardando virar cadastro ativo na sua unidade.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:max-w-xs gap-4">
          <StatCard icon={UserPlus} label="Importados aguardando cadastro" value={pendentesRh.length} tone={pendentesRh.length ? 'amber' : 'green'} note="da sua unidade" />
        </div>

        {podeAvaliarTransferencia && (
          <SolicitacoesTransferenciaSection
            solicitacoes={solicitacoesTransferencia}
            erro={erroSolicitacoesTransferencia}
            avaliador={podeAvaliarTransferencia}
            unidades={unidades}
            setores={setores}
          />
        )}

        <ImportacaoRhSection
          pendentesRh={pendentesRh}
          erroPendentesRh={erroPendentesRh}
          unidades={unidades}
          setores={setores}
          cargos={cargos}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Pendências de Cadastro</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Diagnóstico — nada aqui bloqueia o cadastro. A correção é sempre manual, na ficha do servidor.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard icon={UserPlus} label="Importados aguardando cadastro" value={pendentesRh.length} tone={pendentesRh.length ? 'amber' : 'green'} note="importação de RH, v1.42.0" />
        <StatCard icon={ArrowRightLeft} label="Transferências pendentes" value={solicitacoesTransferencia.length} tone={solicitacoesTransferencia.length ? 'amber' : 'green'} note={podeAvaliarTransferencia ? 'aguardando sua avaliação' : 'aguardando o RH'} />
        <StatCard icon={AlertTriangle} label="Documentos com dígito inválido" value={documentosInvalidos.length} tone={documentosInvalidos.length ? 'red' : 'green'} />
        <StatCard icon={UserX} label="Servidores sem CPF" value={semCpf.length} tone={semCpf.length ? 'amber' : 'green'} note={totalServidores ? `${Math.round((semCpf.length / totalServidores) * 100)}% do quadro` : undefined} />
        <StatCard icon={Copy} label="Possíveis duplicidades" value={duplicidades.length} tone={duplicidades.length ? 'amber' : 'green'} note="grupos suspeitos" />
        <StatCard icon={Hash} label="Servidores sem PIS/PASEP" value={semPisCount} tone="zinc" note="projeto da Fase 9 do REP — não é anomalia" />
      </div>

      <SolicitacoesTransferenciaSection
        solicitacoes={solicitacoesTransferencia}
        erro={erroSolicitacoesTransferencia}
        avaliador={podeAvaliarTransferencia}
        unidades={unidades}
        setores={setores}
      />

      <ImportacaoRhSection
        pendentesRh={pendentesRh}
        erroPendentesRh={erroPendentesRh}
        unidades={unidades}
        setores={setores}
        cargos={cargos}
      />

      {/* Documentos inválidos */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" /> Documentos com dígito verificador inválido
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Dígito errado não diz qual algarismo está errado — a correção exige conferir a ficha, não deduzir.
          </p>
        </div>
        <div className="p-5">
          {erroDocumentos ? (
            <ErrorNotice message={erroDocumentos} />
          ) : documentosInvalidos.length === 0 ? (
            <EmptyState text="Nenhum documento inválido gravado." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase border-b border-zinc-200 dark:border-zinc-800">
                    <th className="pb-2 pr-4">Nome</th>
                    <th className="pb-2 pr-4">Campo</th>
                    <th className="pb-2 pr-4">Valor</th>
                    <th className="pb-2 pr-4">Problema</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {documentosInvalidos.map((d, i) => (
                    <tr key={`${d.registro_id}-${d.campo}-${i}`}>
                      <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-white">{d.nome}</td>
                      <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{d.tabela}.{d.campo}</td>
                      <td className="py-2 pr-4 font-mono text-zinc-600 dark:text-zinc-400">{d.valor}</td>
                      <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{d.problema}</td>
                      <td className="py-2 text-right">
                        <Link href={editLink(d.tabela, d.registro_id)} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs font-semibold">
                          Editar <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Sem CPF */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <UserX className="h-4 w-4 text-amber-500" /> Servidores sem CPF
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              O índice único de CPF não protege quem não tem CPF cadastrado — é a única porta de duplicação que sobra aberta.
            </p>
          </div>
          {semCpf.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={buscaSemCpf}
                onChange={e => setBuscaSemCpf(e.target.value)}
                placeholder="Buscar por nome, matrícula ou unidade..."
                className="pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white w-full sm:w-72"
              />
            </div>
          )}
        </div>
        <div className="p-5">
          {semCpf.length === 0 ? (
            <EmptyState text="Todos os servidores têm CPF cadastrado." />
          ) : semCpfFiltrado.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">Nenhum resultado para essa busca.</p>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase border-b border-zinc-200 dark:border-zinc-800">
                    <th className="pb-2 pr-4">Nome</th>
                    <th className="pb-2 pr-4">Matrícula</th>
                    <th className="pb-2 pr-4">Unidade</th>
                    <th className="pb-2 pr-4">Setor</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {semCpfFiltrado.map(s => (
                    <tr key={s.id}>
                      <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-white">{s.nome}</td>
                      <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{s.matricula || '—'}</td>
                      <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{s.unidade_nome || '—'}</td>
                      <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{s.setor_nome || '—'}</td>
                      <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{s.status}</td>
                      <td className="py-2 text-right">
                        <Link href={`/servidores/${s.id}`} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs font-semibold">
                          Editar <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Duplicidades */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <Copy className="h-4 w-4 text-amber-500" /> Possíveis duplicidades
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Agrupado por CPF, nome, telefone e e-mail. Diagnóstico — homônimo parcial não é duplicata; confira antes de mexer.
          </p>
        </div>
        <div className="p-5">
          {erroDuplicidades ? (
            <ErrorNotice message={erroDuplicidades} />
          ) : duplicidades.length === 0 ? (
            <EmptyState text="Nenhum grupo suspeito encontrado." />
          ) : (
            <div className="space-y-2">
              {duplicidades.map(grupo => {
                const chaveUnica = `${grupo.criterio}:${grupo.chave}`
                const aberto = gruposAbertos.has(chaveUnica)
                return (
                  <div key={chaveUnica} className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleGrupo(chaveUnica)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
                    >
                      <span className="text-sm">
                        <span className="font-semibold text-zinc-900 dark:text-white">{CRITERIO_LABEL[grupo.criterio]}</span>
                        <span className="text-zinc-500 dark:text-zinc-400"> — {grupo.chave} · {grupo.quantidade} servidores</span>
                      </span>
                      {aberto ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
                    </button>
                    {aberto && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase border-b border-zinc-200 dark:border-zinc-800">
                              <th className="px-4 py-2">Nome</th>
                              <th className="px-4 py-2">Matrícula</th>
                              <th className="px-4 py-2">CPF</th>
                              <th className="px-4 py-2">Unidade</th>
                              <th className="px-4 py-2">Status</th>
                              <th className="px-4 py-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {grupo.servidores.map(s => (
                              <tr key={s.id}>
                                <td className="px-4 py-2 font-medium text-zinc-900 dark:text-white">{s.nome}</td>
                                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{s.matricula || '—'}</td>
                                <td className="px-4 py-2 font-mono text-zinc-600 dark:text-zinc-400">{s.cpf || '—'}</td>
                                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{s.unidade || '—'}</td>
                                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{s.status}</td>
                                <td className="px-4 py-2 text-right">
                                  <Link href={`/servidores/${s.id}`} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs font-semibold">
                                    Editar <ExternalLink className="h-3 w-3" />
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
