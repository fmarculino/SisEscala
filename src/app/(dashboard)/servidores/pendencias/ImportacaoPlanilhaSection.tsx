'use client'

import { useMemo, useState } from 'react'
import { FileSpreadsheet, Upload, Loader2, CheckCircle2, XCircle, AlertTriangle, Info, Download } from 'lucide-react'
import { classificarLoteImportacaoRh, executarImportacaoLoteRh } from '../actions'
import type { LinhaClassificadaImportacao, ItemImportacaoLote, ClasseItemImportacao, ResultadoItemImportacao } from '../actions'
import { opcoesParaEscolha, rotularInativo } from '@/utils/opcoesAtivas'

interface Unidade { id: string; nome: string; ativo?: boolean }
interface Setor { id: string; unidade_id: string | null; nome: string; ativo?: boolean }

interface ImportacaoPlanilhaSectionProps {
  unidades: Unidade[]
  setores: Setor[]
}

/** Uma linha crua do CSV, como o navegador parseou — antes de qualquer classificação. */
interface LinhaCsv {
  idx: number
  nome: string
  matricula: string | null
  cargo: string
  cpf: string
  email: string | null
  telefone: string | null
  setorTexto: string
  unidadeTexto: string | null
}

const CAMPOS_OBRIGATORIOS = ['nome', 'cargo', 'cpf', 'setor'] as const

function normalizarCabecalho(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9_]/g, '')
    .trim()
}

function parseLinhaCsv(linha: string, delimitador: string): string[] {
  const resultado: string[] = []
  let atual = ''
  let entreAspas = false
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (c === '"' || c === "'") {
      entreAspas = !entreAspas
    } else if (c === delimitador && !entreAspas) {
      resultado.push(atual.trim().replace(/^["']|["']$/g, ''))
      atual = ''
    } else {
      atual += c
    }
  }
  resultado.push(atual.trim().replace(/^["']|["']$/g, ''))
  return resultado
}

/**
 * Acha a linha de cabeçalho dentro das 5 primeiras linhas (tolera título antes do cabeçalho —
 * foi exatamente o caso da planilha real de 31/08/2026, "DADOS COMPLEMENTARES DOS SERVIDORES -
 * HMM - SND" na primeira linha, cabeçalho de verdade só na segunda).
 *
 * Casamento por CONTÉM, não por igualdade exata: cabeçalho humano como "NOME COMPLETO SEM
 * ABREVIAÇÕES" normaliza para "nomecompletosemabreviacoes" (normalizarCabecalho tira espaço
 * junto com acento) — igualdade exata com "nome" nunca bateria. Seguro aqui porque o conjunto de
 * campos é pequeno e não ambíguo (diferente do importador genérico de /servidores/importar, que
 * tem dezenas de aliases e por isso usa igualdade exata).
 */
function acharCabecalho(linhas: string[], delimitador: string): { indiceLinha: number; indices: Record<string, number> } | null {
  for (let i = 0; i < Math.min(5, linhas.length); i++) {
    const colunas = parseLinhaCsv(linhas[i], delimitador).map(normalizarCabecalho)
    const indices: Record<string, number> = {}
    colunas.forEach((c, idx) => {
      if (indices.nome === undefined && c.includes('nome')) indices.nome = idx
      else if (indices.matricula === undefined && c.includes('matricul')) indices.matricula = idx
      else if (indices.cargo === undefined && c.includes('cargo')) indices.cargo = idx
      else if (indices.cpf === undefined && c.includes('cpf')) indices.cpf = idx
      else if (indices.email === undefined && c.includes('email')) indices.email = idx
      else if (indices.telefone === undefined && (c.includes('telefone') || c.includes('celular') || c.includes('fone'))) indices.telefone = idx
      else if (indices.setor === undefined && (c.includes('setor') || c.includes('escala'))) indices.setor = idx
      else if (indices.unidade === undefined && c.includes('unidade')) indices.unidade = idx
    })
    if (CAMPOS_OBRIGATORIOS.every(campo => indices[campo] !== undefined)) {
      return { indiceLinha: i, indices }
    }
  }
  return null
}

function parseArquivoCsv(texto: string): { linhas: LinhaCsv[]; erro: string | null } {
  const todasLinhas = texto.split(/\r?\n/).filter(l => l.trim() !== '')
  if (todasLinhas.length === 0) return { linhas: [], erro: 'O arquivo está vazio.' }

  const delimitador = todasLinhas[0].includes(';') ? ';' : ','
  const cabecalho = acharCabecalho(todasLinhas, delimitador)
  if (!cabecalho) {
    return {
      linhas: [],
      erro: 'Não encontrei um cabeçalho com nome, cargo, CPF e setor nas primeiras linhas do arquivo. Confira as colunas.',
    }
  }

  const { indiceLinha, indices } = cabecalho
  const linhas: LinhaCsv[] = []
  for (let i = indiceLinha + 1; i < todasLinhas.length; i++) {
    const valores = parseLinhaCsv(todasLinhas[i], delimitador)
    if (valores.length === 0) continue
    const nome = valores[indices.nome]?.trim() || ''
    if (!nome) continue

    linhas.push({
      idx: linhas.length,
      nome,
      matricula: valores[indices.matricula]?.trim() || null,
      cargo: valores[indices.cargo]?.trim() || '',
      cpf: valores[indices.cpf]?.trim() || '',
      email: indices.email !== undefined ? (valores[indices.email]?.trim() || null) : null,
      telefone: indices.telefone !== undefined ? (valores[indices.telefone]?.trim() || null) : null,
      setorTexto: valores[indices.setor]?.trim() || '',
      unidadeTexto: indices.unidade !== undefined ? (valores[indices.unidade]?.trim() || null) : null,
    })
  }

  if (linhas.length === 0) return { linhas: [], erro: 'Nenhuma linha com nome preenchido foi encontrada.' }
  return { linhas, erro: null }
}

/** Uma linha já classificada, com o que a tela decidiu oferecer. */
interface LinhaRevisao {
  csv: LinhaCsv
  classificacao: LinhaClassificadaImportacao
  classe: ClasseItemImportacao | 'sem_acao'
  motivoSemAcao: string | null
  incluida: boolean
  cargo: string
}

function decidirClasse(csv: LinhaCsv, cl: LinhaClassificadaImportacao, unidadeId: string): { classe: ClasseItemImportacao | 'sem_acao'; motivo: string | null } {
  if (cl.servidor) {
    if (cl.servidor.unidadeId === unidadeId) {
      return { classe: 'ja_servidor_mesma_unidade', motivo: null }
    }
    return { classe: 'sem_acao', motivo: `Já é servidor em outra unidade (${cl.servidor.unidadeNome || '—'}, matrícula ${cl.servidor.matricula || '—'}).` }
  }
  if (cl.pendencia) {
    if (!cl.pendencia.unidadeId || cl.pendencia.unidadeId === unidadeId) {
      return { classe: 'pronta', motivo: null }
    }
    return { classe: 'divergencia_unidade', motivo: `A pendência do RH aponta outra unidade (${cl.pendencia.unidadeNome || cl.pendencia.departamentoOrigem || '—'}).` }
  }
  if (!csv.matricula) {
    return { classe: 'sem_acao', motivo: 'Sem matrícula e sem pendência correspondente — não será importado.' }
  }
  if (!cl.cpfDigitoValido) {
    return { classe: 'sem_acao', motivo: 'CPF inválido e sem pendência correspondente para confirmar o CPF correto.' }
  }
  return { classe: 'novo_sem_pendencia', motivo: null }
}

const ROTULO_CLASSE: Record<ClasseItemImportacao, { texto: string; cor: string }> = {
  pronta: { texto: 'Pronta (pendência do RH)', cor: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' },
  divergencia_unidade: { texto: 'Unidade divergente — revisar', cor: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' },
  ja_servidor_mesma_unidade: { texto: 'Já cadastrado aqui — completar contato', cor: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10' },
  novo_sem_pendencia: { texto: 'Sem pendência — cadastro novo', cor: 'text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10' },
}

export function ImportacaoPlanilhaSection({ unidades, setores }: ImportacaoPlanilhaSectionProps) {
  const [linhasCsv, setLinhasCsv] = useState<LinhaCsv[] | null>(null)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [nomeArquivo, setNomeArquivo] = useState<string>('')

  const [unidadeId, setUnidadeId] = useState('')
  const [mapaSetor, setMapaSetor] = useState<Record<string, string>>({})

  const [classificando, setClassificando] = useState(false)
  const [revisao, setRevisao] = useState<LinhaRevisao[] | null>(null)
  const [erroClassificacao, setErroClassificacao] = useState<string | null>(null)

  const [gerarPin, setGerarPin] = useState(false)
  const [executando, setExecutando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoItemImportacao[] | null>(null)

  const setoresDaUnidade = useMemo(
    () => setores.filter(s => s.unidade_id === unidadeId && s.ativo !== false),
    [setores, unidadeId]
  )

  const setoresDistintos = useMemo(() => {
    if (!linhasCsv) return []
    return Array.from(new Set(linhasCsv.map(l => l.setorTexto).filter(Boolean)))
  }, [linhasCsv])

  const mapeamentoCompleto = setoresDistintos.length > 0 && setoresDistintos.every(s => mapaSetor[s])

  function baixarModelo() {
    const cabecalho = ['matricula', 'nome', 'cargo', 'cpf', 'email', 'telefone', 'setor']
    const linhaExemplo = ['12345', 'FULANO DA SILVA', 'AGENTE DE SERVIÇOS GERAIS', '000.111.222-33', 'fulano@exemplo.com', '(94) 99999-9999', 'COZINHA']
    const csv = `${cabecalho.join(';')}\n${linhaExemplo.join(';')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'modelo_importacao_planilha.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function handleArquivo(file: File) {
    setNomeArquivo(file.name)
    setLinhasCsv(null)
    setErroArquivo(null)
    setRevisao(null)
    setResultados(null)
    setMapaSetor({})

    const reader = new FileReader()
    reader.onload = e => {
      const texto = e.target?.result as string
      const { linhas, erro } = parseArquivoCsv(texto)
      if (erro) {
        setErroArquivo(erro)
        return
      }
      setLinhasCsv(linhas)
    }
    reader.readAsText(file)
  }

  async function handleClassificar() {
    if (!linhasCsv || !unidadeId || !mapeamentoCompleto) return
    setClassificando(true)
    setErroClassificacao(null)
    setResultados(null)

    const res = await classificarLoteImportacaoRh(
      linhasCsv.map(l => ({ idx: l.idx, cpf: l.cpf, matricula: l.matricula || '' }))
    )
    setClassificando(false)

    if ('error' in res) {
      setErroClassificacao(res.error)
      return
    }

    const porIdx = new Map(res.data.map(c => [c.idx, c]))
    const nova: LinhaRevisao[] = linhasCsv.map(csv => {
      const cl = porIdx.get(csv.idx)
      if (!cl) {
        return { csv, classificacao: { idx: csv.idx, cpfNormalizado: null, matricula: csv.matricula, cpfDigitoValido: false, servidor: null, pendencia: null }, classe: 'sem_acao', motivoSemAcao: 'Falha ao classificar esta linha.', incluida: false, cargo: csv.cargo }
      }
      const { classe, motivo } = decidirClasse(csv, cl, unidadeId)
      const incluidaPorPadrao = classe === 'pronta' || classe === 'ja_servidor_mesma_unidade'
      return { csv, classificacao: cl, classe, motivoSemAcao: motivo, incluida: incluidaPorPadrao && !!csv.cargo, cargo: csv.cargo }
    })
    setRevisao(nova)
  }

  function atualizarLinha(idx: number, patch: Partial<LinhaRevisao>) {
    setRevisao(prev => prev ? prev.map(l => l.csv.idx === idx ? { ...l, ...patch } : l) : prev)
  }

  async function handleConfirmar() {
    if (!revisao) return
    const itens: ItemImportacaoLote[] = revisao
      .filter(l => l.incluida && l.classe !== 'sem_acao')
      .map(l => ({
        idx: l.csv.idx,
        classe: l.classe as ClasseItemImportacao,
        pendenciaId: l.classificacao.pendencia?.id || null,
        servidorExistenteId: l.classificacao.servidor?.id || null,
        nome: l.classificacao.pendencia?.nome || l.classificacao.servidor?.nome || l.csv.nome,
        matricula: l.csv.matricula,
        cpf: l.csv.cpf,
        cargo: l.cargo,
        email: l.csv.email,
        telefone: l.csv.telefone,
        unidadeId,
        setorId: mapaSetor[l.csv.setorTexto] || '',
      }))

    if (itens.length === 0) return

    setExecutando(true)
    const res = await executarImportacaoLoteRh(itens, { gerarPin })
    setExecutando(false)
    setResultados(res)
  }

  const totalIncluidos = revisao?.filter(l => l.incluida && l.classe !== 'sem_acao').length || 0

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-blue-500" /> Importar planilha
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Suba um CSV com colunas de nome, cargo, CPF, setor (e opcionalmente matrícula, e-mail e
            telefone). Cada linha é cruzada contra as pendências do RH e contra os cadastros já
            existentes — nada é gravado até você revisar e confirmar.
          </p>
        </div>
        <button
          type="button"
          onClick={baixarModelo}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold rounded-lg transition-all border border-zinc-200 dark:border-zinc-700 shrink-0"
        >
          <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          Baixar modelo
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-8 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer relative">
          <input
            type="file"
            accept=".csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleArquivo(f) }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <Upload className="h-8 w-8 text-zinc-500 dark:text-zinc-400 mb-2" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400 font-medium text-center">
            {nomeArquivo || 'Clique ou arraste o arquivo CSV aqui'}
          </p>
        </div>

        {erroArquivo && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{erroArquivo}</span>
          </div>
        )}

        {linhasCsv && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
              <Info className="h-3.5 w-3.5" /> {linhasCsv.length} linha(s) lida(s) de {nomeArquivo}.
            </p>

            <div className="max-w-sm">
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Unidade (única para todo o arquivo)</label>
              <select
                value={unidadeId}
                onChange={e => { setUnidadeId(e.target.value); setMapaSetor({}); setRevisao(null); setResultados(null) }}
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white"
              >
                <option value="">Selecione...</option>
                {opcoesParaEscolha(unidades, unidadeId).map(u => <option key={u.id} value={u.id}>{rotularInativo(u)}</option>)}
              </select>
            </div>

            {unidadeId && setoresDistintos.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Para onde cada setor da planilha vai nesta unidade:
                </p>
                {setoresDistintos.map(setorTexto => (
                  <div key={setorTexto} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                    <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">{setorTexto}</span>
                    <select
                      value={mapaSetor[setorTexto] || ''}
                      onChange={e => setMapaSetor(prev => ({ ...prev, [setorTexto]: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white"
                    >
                      <option value="">Selecione o setor...</option>
                      {setoresDaUnidade.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {unidadeId && (
              <div className="flex justify-end">
                <button
                  onClick={handleClassificar}
                  disabled={!mapeamentoCompleto || classificando}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {classificando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  Classificar
                </button>
              </div>
            )}

            {erroClassificacao && (
              <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                {erroClassificacao}
              </div>
            )}
          </div>
        )}

        {revisao && (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-left text-xs text-zinc-500 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 w-10"></th>
                    <th className="px-3 py-2">Nome</th>
                    <th className="px-3 py-2">Cargo</th>
                    <th className="px-3 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {revisao.map(l => (
                    <tr key={l.csv.idx}>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={l.incluida}
                          disabled={l.classe === 'sem_acao' || !l.cargo}
                          onChange={e => atualizarLinha(l.csv.idx, { incluida: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2 align-top text-zinc-900 dark:text-white">{l.csv.nome}</td>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="text"
                          value={l.cargo}
                          onChange={e => atualizarLinha(l.csv.idx, { cargo: e.target.value })}
                          className="w-40 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs"
                        />
                        {!l.cargo && <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">Cargo obrigatório</p>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {l.classe === 'sem_acao' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> {l.motivoSemAcao}
                          </span>
                        ) : (
                          <div>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${ROTULO_CLASSE[l.classe].cor}`}>
                              {ROTULO_CLASSE[l.classe].texto}
                            </span>
                            {l.motivoSemAcao && (
                              <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">{l.motivoSemAcao}</p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={gerarPin} onChange={e => setGerarPin(e.target.checked)} />
              Gerar PIN de acesso e enviar por e-mail para quem tiver e-mail na planilha
            </label>

            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{totalIncluidos} linha(s) marcada(s) para gravar.</p>
              <button
                onClick={handleConfirmar}
                disabled={totalIncluidos === 0 || executando}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {executando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirmar importação
              </button>
            </div>
          </div>
        )}

        {resultados && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {resultados.filter(r => r.ok).length} de {resultados.length} gravado(s) com sucesso.
            </p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {resultados.map(r => {
                const linha = revisao?.find(l => l.csv.idx === r.idx)
                return (
                  <div key={r.idx} className={`flex items-start gap-2 text-xs rounded-md px-2 py-1.5 ${r.ok ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300'}`}>
                    {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                    <span>
                      <b>{linha?.csv.nome || `Linha ${r.idx}`}</b>
                      {r.ok ? (r.pinEnviado ? ' — cadastrado, PIN enviado por e-mail.' : ' — cadastrado.') : ` — ${r.erro}`}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
