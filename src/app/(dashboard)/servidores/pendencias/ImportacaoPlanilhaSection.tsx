'use client'

import { useMemo, useState } from 'react'
import {
  FileSpreadsheet, Upload, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Info, Download, Check, Sparkles, RefreshCw
} from 'lucide-react'
import { classificarLoteImportacaoRh, executarImportacaoLoteRh } from '../actions'
import type { LinhaClassificadaImportacao, ItemImportacaoLote, ClasseItemImportacao, ResultadoItemImportacao } from '../actions'
import { opcoesParaEscolha, rotularInativo } from '@/utils/opcoesAtivas'

interface Unidade { id: string; nome: string; ativo?: boolean }
interface Setor { id: string; unidade_id: string | null; nome: string; ativo?: boolean }
interface Cargo { id: string; nome: string; ativo?: boolean }

interface ImportacaoPlanilhaSectionProps {
  unidades: Unidade[]
  setores: Setor[]
  cargos: Cargo[]
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

function normalizarTextoParaComparacao(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Identifica o melhor cargo correspondente cadastrado no sistema a partir do texto da planilha.
 * Suporta correspondência exata, sem acentos, com remoção de pontuação e abreviações comuns da SMS.
 */
function encontrarMelhorCargo(cargoPlanilha: string, cargos: Cargo[]): Cargo | null {
  if (!cargoPlanilha || !cargos || cargos.length === 0) return null
  const planNorm = normalizarTextoParaComparacao(cargoPlanilha)
  if (!planNorm) return null

  // 1. Casamento exato normalizado
  const exato = cargos.find(c => normalizarTextoParaComparacao(c.nome) === planNorm)
  if (exato) return exato

  // 2. Mapeamento de abreviações e variações frequentes no serviço público
  const mapaAbrevs: [RegExp, string][] = [
    [/\btec\b|\btecn\b|\btecnico\b/g, 'tecnico'],
    [/\benferm\b|\benf\b|\benfermagem\b/g, 'enfermagem'],
    [/\blabor\b|\blab\b|\blaboratorio\b/g, 'laboratorio'],
    [/\bass\b|\bassit\b|\bassist\b|\bassistente\b/g, 'assistente'],
    [/\badm\b|\badminist\b|\badministrativo\b/g, 'administrativo'],
    [/\bag\b|\bagente\b/g, 'agente'],
    [/\bcomun\b|\bcomunitario\b/g, 'comunitario'],
    [/\bsaude\b/g, 'saude'],
    [/\bregulac\w*\b|\bregulacao\b/g, 'regulacao'],
    [/\bserv\b|\bservicos\b/g, 'servicos'],
    [/\bgerais\b/g, 'gerais'],
    [/\bop\b|\boperador\b|\boperadores\b/g, 'operador'],
    [/\bmed\b|\bmedico\b/g, 'medico'],
    [/\bfisioter\b|\bfisioterapeuta\b/g, 'fisioterapeuta'],
    [/\bfarm\b|\bfarmaceutico\b/g, 'farmaceutico'],
    [/\bpsic\b|\bpsicologo\b/g, 'psicologo'],
    [/\bnutr\b|\bnutricionista\b/g, 'nutricionista'],
    [/\bodont\b|\bodontologo\b|\bdentista\b/g, 'odontologo'],
  ]

  let planCanon = planNorm
  for (const [re, rep] of mapaAbrevs) {
    planCanon = planCanon.replace(re, rep)
  }
  planCanon = planCanon.replace(/\s+/g, ' ').trim()

  const matchCanon = cargos.find(c => {
    let cCanon = normalizarTextoParaComparacao(c.nome)
    for (const [re, rep] of mapaAbrevs) {
      cCanon = cCanon.replace(re, rep)
    }
    cCanon = cCanon.replace(/\s+/g, ' ').trim()
    return cCanon === planCanon
  })
  if (matchCanon) return matchCanon

  // 3. Inclusão (um termo contém o outro)
  const matchInclusao = cargos.find(c => {
    const cNorm = normalizarTextoParaComparacao(c.nome)
    return cNorm.includes(planNorm) || (planNorm.length > 5 && planNorm.includes(cNorm))
  })
  if (matchInclusao) return matchInclusao

  return null
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
  pronta: { texto: 'Pronta (pendência do RH)', cor: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800' },
  divergencia_unidade: { texto: 'Unidade divergente — revisar', cor: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800' },
  ja_servidor_mesma_unidade: { texto: 'Já cadastrado aqui — completar contato', cor: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-800' },
  novo_sem_pendencia: { texto: 'Sem pendência — cadastro novo', cor: 'text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-800' },
}

interface ProgressoExecucao {
  total: number
  processados: number
  sucesso: number
  falhas: number
  itemAtual: string
  emExecucao: boolean
}

export function ImportacaoPlanilhaSection({ unidades, setores, cargos }: ImportacaoPlanilhaSectionProps) {
  const [linhasCsv, setLinhasCsv] = useState<LinhaCsv[] | null>(null)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [nomeArquivo, setNomeArquivo] = useState<string>('')

  const [unidadeId, setUnidadeId] = useState('')
  const [mapaSetor, setMapaSetor] = useState<Record<string, string>>({})
  const [mapaCargo, setMapaCargo] = useState<Record<string, string>>({})

  const [classificando, setClassificando] = useState(false)
  const [revisao, setRevisao] = useState<LinhaRevisao[] | null>(null)
  const [erroClassificacao, setErroClassificacao] = useState<string | null>(null)

  const [gerarPin, setGerarPin] = useState(false)
  const [progresso, setProgresso] = useState<ProgressoExecucao | null>(null)
  const [resultados, setResultados] = useState<ResultadoItemImportacao[] | null>(null)

  const setoresDaUnidade = useMemo(
    () => setores.filter(s => s.unidade_id === unidadeId && s.ativo !== false),
    [setores, unidadeId]
  )

  const setoresDistintos = useMemo(() => {
    if (!linhasCsv) return []
    return Array.from(new Set(linhasCsv.map(l => l.setorTexto).filter(Boolean)))
  }, [linhasCsv])

  const cargosDistintos = useMemo(() => {
    if (!linhasCsv) return []
    return Array.from(new Set(linhasCsv.map(l => l.cargo).filter(Boolean)))
  }, [linhasCsv])

  const mapeamentoSetoresCompleto = setoresDistintos.length > 0 && setoresDistintos.every(s => mapaSetor[s])
  const mapeamentoCargosCompleto = cargosDistintos.length > 0 && cargosDistintos.every(c => mapaCargo[c])

  function baixarModelo() {
    const cabecalho = ['matricula', 'nome', 'cargo', 'cpf', 'email', 'telefone', 'setor']
    const linhaExemplo = ['12345', 'FULANO DA SILVA', 'AGENTE DE SERVICOS GERAIS', '000.111.222-33', 'fulano@exemplo.com', '(94) 99999-9999', 'COZINHA']
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
    setProgresso(null)
    setMapaSetor({})
    setMapaCargo({})

    const reader = new FileReader()
    reader.onload = e => {
      const buffer = e.target?.result as ArrayBuffer
      if (!buffer) return

      let texto = ''
      try {
        // Tenta decodificar como UTF-8 estrito primeiro
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
        texto = utf8Decoder.decode(buffer)
      } catch {
        // Se houver bytes inválidos em UTF-8 (muito comum em planilhas Excel salvas em ANSI no Windows), usa Windows-1252 / ISO-8859-1
        const latinDecoder = new TextDecoder('windows-1252')
        texto = latinDecoder.decode(buffer)
      }

      // Remove BOM do UTF-8 caso presente
      if (texto.charCodeAt(0) === 0xFEFF) {
        texto = texto.slice(1)
      }

      const { linhas, erro } = parseArquivoCsv(texto)
      if (erro) {
        setErroArquivo(erro)
        return
      }

      setLinhasCsv(linhas)

      // Pré-popula mapeamento automático de cargos a partir do catálogo do sistema
      const distinctCargos = Array.from(new Set(linhas.map(l => l.cargo).filter(Boolean)))
      const autoMapaCargos: Record<string, string> = {}
      distinctCargos.forEach(cargoTexto => {
        const correspondente = encontrarMelhorCargo(cargoTexto, cargos)
        if (correspondente) {
          autoMapaCargos[cargoTexto] = correspondente.nome
        }
      })
      setMapaCargo(autoMapaCargos)
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleClassificar() {
    if (!linhasCsv || !unidadeId || !mapeamentoSetoresCompleto || !mapeamentoCargosCompleto) return
    setClassificando(true)
    setErroClassificacao(null)
    setResultados(null)
    setProgresso(null)

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
      const cargoMapeado = mapaCargo[csv.cargo] || csv.cargo
      if (!cl) {
        return {
          csv,
          classificacao: { idx: csv.idx, cpfNormalizado: null, matricula: csv.matricula, cpfDigitoValido: false, servidor: null, pendencia: null },
          classe: 'sem_acao',
          motivoSemAcao: 'Falha ao classificar esta linha.',
          incluida: false,
          cargo: cargoMapeado
        }
      }
      const { classe, motivo } = decidirClasse(csv, cl, unidadeId)
      const incluidaPorPadrao = classe === 'pronta' || classe === 'ja_servidor_mesma_unidade'
      return {
        csv,
        classificacao: cl,
        classe,
        motivoSemAcao: motivo,
        incluida: incluidaPorPadrao && !!cargoMapeado,
        cargo: cargoMapeado
      }
    })
    setRevisao(nova)
  }

  function atualizarLinha(idx: number, patch: Partial<LinhaRevisao>) {
    setRevisao(prev => prev ? prev.map(l => l.csv.idx === idx ? { ...l, ...patch } : l) : prev)
  }

  async function handleConfirmar() {
    if (!revisao || progresso?.emExecucao) return
    const itensParaGravar: ItemImportacaoLote[] = revisao
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

    if (itensParaGravar.length === 0) return

    const total = itensParaGravar.length
    setProgresso({
      total,
      processados: 0,
      sucesso: 0,
      falhas: 0,
      itemAtual: itensParaGravar[0]?.nome || '',
      emExecucao: true
    })
    setResultados([])

    const BATCH_SIZE = 8
    const todosResultados: ResultadoItemImportacao[] = []
    let totalSucesso = 0
    let totalFalhas = 0

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const lote = itensParaGravar.slice(i, i + BATCH_SIZE)
      const nomePrimeiro = lote[0]?.nome || ''

      setProgresso(prev => prev ? {
        ...prev,
        itemAtual: nomePrimeiro,
        processados: i,
      } : prev)

      try {
        const resBatch = await executarImportacaoLoteRh(lote, { gerarPin })
        todosResultados.push(...resBatch)
        resBatch.forEach(r => {
          if (r.ok) totalSucesso++
          else totalFalhas++
        })
      } catch (err: any) {
        lote.forEach(item => {
          totalFalhas++
          todosResultados.push({
            idx: item.idx,
            ok: false,
            erro: err?.message || 'Falha na comunicação com o servidor'
          })
        })
      }

      setResultados([...todosResultados])
      setProgresso(prev => prev ? {
        ...prev,
        processados: Math.min(i + lote.length, total),
        sucesso: totalSucesso,
        falhas: totalFalhas,
      } : prev)
    }

    setProgresso(prev => prev ? {
      ...prev,
      processados: total,
      sucesso: totalSucesso,
      falhas: totalFalhas,
      itemAtual: 'Concluído!',
      emExecucao: false
    } : null)
  }

  const totalIncluidos = revisao?.filter(l => l.incluida && l.classe !== 'sem_acao').length || 0

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 bg-zinc-50/50 dark:bg-zinc-800/30">
        <div>
          <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Importar planilha
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl">
            Suba um CSV com colunas de nome, cargo, CPF e setor. O sistema identifica automaticamente os cargos
            do catálogo oficial, corrige caracteres e cruza as informações antes de você confirmar.
          </p>
        </div>
        <button
          type="button"
          onClick={baixarModelo}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold rounded-lg transition-all border border-zinc-200 dark:border-zinc-700 shrink-0 shadow-xs"
        >
          <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          Baixar modelo CSV
        </button>
      </div>

      <div className="p-5 space-y-6">
        {/* Upload Zone */}
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl p-8 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-all cursor-pointer relative group">
          <input
            type="file"
            accept=".csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleArquivo(f) }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full mb-3 group-hover:scale-110 transition-transform">
            <Upload className="h-6 w-6" />
          </div>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 font-semibold text-center">
            {nomeArquivo || 'Clique ou arraste o arquivo CSV aqui'}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 text-center">
            Aceita arquivos CSV gerados pelo Excel ou LibreOffice (Windows ANSI ou UTF-8)
          </p>
        </div>

        {erroArquivo && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-500/10 p-3.5 text-sm text-red-700 dark:text-red-400 flex items-start gap-2.5">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{erroArquivo}</span>
          </div>
        )}

        {linhasCsv && (
          <div className="space-y-6">
            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800/60 flex items-center justify-between text-xs text-blue-800 dark:text-blue-300">
              <span className="flex items-center gap-2 font-medium">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <b>{linhasCsv.length}</b> linha(s) encontrada(s) no arquivo <b>{nomeArquivo}</b>.
              </span>
              <span className="text-[11px] text-blue-600 dark:text-blue-400">
                {setoresDistintos.length} setor(es) · {cargosDistintos.length} cargo(s)
              </span>
            </div>

            {/* Unidade */}
            <div className="max-w-md">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 mb-1.5">
                Unidade de Destino *
              </label>
              <select
                value={unidadeId}
                onChange={e => {
                  setUnidadeId(e.target.value)
                  setMapaSetor({})
                  setRevisao(null)
                  setResultados(null)
                  setProgresso(null)
                }}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white shadow-xs focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecione a unidade...</option>
                {opcoesParaEscolha(unidades, unidadeId).map(u => (
                  <option key={u.id} value={u.id}>{rotularInativo(u)}</option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-500 mt-1">Todos os servidores desta planilha serão lotados nesta unidade.</p>
            </div>

            {/* Mapeamento de Setores */}
            {unidadeId && setoresDistintos.length > 0 && (
              <div className="space-y-3 p-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    1. Mapeamento de Setores da Planilha
                  </h3>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${mapeamentoSetoresCompleto ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                    {Object.keys(mapaSetor).filter(k => mapaSetor[k]).length} de {setoresDistintos.length} mapeados
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Indique qual setor oficial da unidade corresponde a cada setor listado no arquivo:
                </p>
                <div className="grid grid-cols-1 gap-2.5">
                  {setoresDistintos.map(setorTexto => {
                    const mapped = !!mapaSetor[setorTexto]
                    return (
                      <div key={setorTexto} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center p-2.5 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-2xs">
                        <div className="flex items-center gap-2">
                          {mapped ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                          <span className="text-xs font-mono text-zinc-800 dark:text-zinc-200 font-semibold truncate" title={setorTexto}>
                            {setorTexto}
                          </span>
                        </div>
                        <select
                          value={mapaSetor[setorTexto] || ''}
                          onChange={e => setMapaSetor(prev => ({ ...prev, [setorTexto]: e.target.value }))}
                          className={`w-full rounded-md border px-3 py-1.5 text-xs text-zinc-900 dark:text-white bg-white dark:bg-zinc-800 ${mapped ? 'border-zinc-300 dark:border-zinc-600' : 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-300'}`}
                        >
                          <option value="">Selecione o setor oficial correspondente...</option>
                          {setoresDaUnidade.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Mapeamento de Cargos */}
            {unidadeId && cargosDistintos.length > 0 && (
              <div className="space-y-3 p-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    2. Mapeamento de Cargos para o Catálogo do Sistema
                  </h3>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${mapeamentoCargosCompleto ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                    {Object.keys(mapaCargo).filter(k => mapaCargo[k]).length} de {cargosDistintos.length} identificados
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  O sistema relacionou os cargos da planilha com o catálogo oficial. Confira e ajuste se necessário:
                </p>
                <div className="grid grid-cols-1 gap-2.5">
                  {cargosDistintos.map(cargoTexto => {
                    const cargoSelecionado = mapaCargo[cargoTexto]
                    const matchAutomagico = cargoSelecionado && encontrarMelhorCargo(cargoTexto, cargos)?.nome === cargoSelecionado
                    return (
                      <div key={cargoTexto} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center p-2.5 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-2xs">
                        <div className="flex items-center gap-2 min-w-0">
                          {cargoSelecionado ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                          <span className="text-xs font-mono text-zinc-800 dark:text-zinc-200 font-semibold truncate" title={cargoTexto}>
                            {cargoTexto}
                          </span>
                          {matchAutomagico && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.2 rounded font-medium shrink-0">
                              reconhecido
                            </span>
                          )}
                        </div>
                        <select
                          value={cargoSelecionado || ''}
                          onChange={e => setMapaCargo(prev => ({ ...prev, [cargoTexto]: e.target.value }))}
                          className={`w-full rounded-md border px-3 py-1.5 text-xs text-zinc-900 dark:text-white bg-white dark:bg-zinc-800 ${cargoSelecionado ? 'border-zinc-300 dark:border-zinc-600' : 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-300'}`}
                        >
                          <option value="">Selecione o cargo oficial do sistema...</option>
                          {cargos.filter(c => c.ativo !== false).map(c => (
                            <option key={c.id} value={c.nome}>{c.nome}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {unidadeId && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleClassificar}
                  disabled={!mapeamentoSetoresCompleto || !mapeamentoCargosCompleto || classificando}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md shadow-blue-500/10 cursor-pointer disabled:cursor-not-allowed"
                >
                  {classificando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  {classificando ? 'Analisando e cruzando cadastros...' : 'Classificar e Revisar Registros'}
                </button>
              </div>
            )}

            {erroClassificacao && (
              <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-500/10 p-3.5 text-sm text-red-700 dark:text-red-400">
                {erroClassificacao}
              </div>
            )}
          </div>
        )}

        {/* Tabela de Revisão */}
        {revisao && (
          <div className="space-y-5 pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                  3. Revisão dos Dados Antes de Gravar
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Desmarque os que não deseja importar ou ajuste o cargo individualmente.
                </p>
              </div>
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <b>{totalIncluidos}</b> de {revisao.length} registro(s) selecionados para importar
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 max-h-96 overflow-y-auto shadow-2xs">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-800/80 sticky top-0 z-10 text-left text-xs text-zinc-600 dark:text-zinc-300 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-700">
                  <tr>
                    <th className="px-3 py-2.5 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={revisao.filter(l => l.classe !== 'sem_acao').every(l => l.incluida)}
                        onChange={e => {
                          const marcar = e.target.checked
                          setRevisao(prev => prev ? prev.map(l => l.classe !== 'sem_acao' ? { ...l, incluida: marcar } : l) : prev)
                        }}
                        className="rounded border-zinc-300"
                        title="Marcar / Desmarcar todos válidos"
                      />
                    </th>
                    <th className="px-3 py-2.5">Nome / Matrícula</th>
                    <th className="px-3 py-2.5">Cargo Oficial do Sistema</th>
                    <th className="px-3 py-2.5">Situação Identificada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {revisao.map(l => (
                    <tr key={l.csv.idx} className={`hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 ${l.incluida ? '' : 'opacity-60 bg-zinc-50/30 dark:bg-zinc-900/40'}`}>
                      <td className="px-3 py-2.5 align-middle text-center">
                        <input
                          type="checkbox"
                          checked={l.incluida}
                          disabled={l.classe === 'sem_acao' || !l.cargo}
                          onChange={e => atualizarLinha(l.csv.idx, { incluida: e.target.checked })}
                          className="rounded border-zinc-300 text-blue-600"
                        />
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="font-semibold text-zinc-900 dark:text-white text-xs">{l.csv.nome}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                          {l.csv.matricula ? `Matrícula: ${l.csv.matricula}` : 'Sem matrícula'} · CPF: {l.csv.cpf || '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle min-w-[220px]">
                        <select
                          value={l.cargo}
                          onChange={e => atualizarLinha(l.csv.idx, { cargo: e.target.value })}
                          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-zinc-900 dark:text-white focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Selecione o cargo...</option>
                          {cargos.filter(c => c.ativo !== false).map(c => (
                            <option key={c.id} value={c.nome}>{c.nome}</option>
                          ))}
                        </select>
                        {!l.cargo && <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">Cargo obrigatório</p>}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {l.classe === 'sem_acao' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            <span>{l.motivoSemAcao}</span>
                          </span>
                        ) : (
                          <div>
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${ROTULO_CLASSE[l.classe].cor}`}>
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

            <div className="p-3.5 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3">
              <label className="flex items-center gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={gerarPin}
                  onChange={e => setGerarPin(e.target.checked)}
                  className="rounded border-zinc-300 text-blue-600 h-4 w-4"
                />
                <span>Gerar PIN de acesso e enviar por e-mail para quem tiver e-mail informado na planilha</span>
              </label>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Total a processar: <b>{totalIncluidos}</b> servidores na unidade selecionada.
                </p>
                <button
                  onClick={handleConfirmar}
                  disabled={totalIncluidos === 0 || progresso?.emExecucao}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-md shadow-emerald-500/10 cursor-pointer disabled:cursor-not-allowed"
                >
                  {progresso?.emExecucao ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {progresso?.emExecucao ? 'Processando importação...' : 'Confirmar e Gravar Cadastros'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Barra de Progresso em Tempo Real */}
        {progresso && (
          <div className="p-5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 space-y-3 animate-in fade-in duration-300">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2">
                {progresso.emExecucao ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                    Processando importação...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Processamento finalizado!
                  </>
                )}
              </span>
              <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
                {progresso.processados} de {progresso.total} ({Math.round((progresso.processados / progresso.total) * 100)}%)
              </span>
            </div>

            {/* Barra Visual de Progresso */}
            <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-3 overflow-hidden shadow-inner">
              <div
                className={`h-full transition-all duration-300 rounded-full ${progresso.emExecucao ? 'bg-blue-600 animate-pulse' : 'bg-emerald-600'}`}
                style={{ width: `${Math.max(5, Math.round((progresso.processados / progresso.total) * 100))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-400">
              <span className="truncate max-w-sm">
                {progresso.emExecucao ? `Gravando: ${progresso.itemAtual}` : `${progresso.sucesso} gravado(s) com sucesso, ${progresso.falhas} falha(s).`}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ {progresso.sucesso} sucesso</span>
                {progresso.falhas > 0 && <span className="text-red-600 dark:text-red-400 font-semibold">✗ {progresso.falhas} falhas</span>}
              </span>
            </div>
          </div>
        )}

        {/* Resultados Detalhados */}
        {resultados && resultados.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Histórico do Processamento
            </h4>
            <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 p-2 bg-zinc-50 dark:bg-zinc-900/60 shadow-inner">
              {resultados.map((r, i) => {
                const linha = revisao?.find(l => l.csv.idx === r.idx)
                return (
                  <div
                    key={`${r.idx}-${i}`}
                    className={`flex items-start gap-2.5 text-xs rounded-lg px-3 py-2 transition-all ${r.ok ? 'bg-emerald-50/80 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 border border-emerald-200/60 dark:border-emerald-800/40' : 'bg-red-50/80 dark:bg-red-500/10 text-red-900 dark:text-red-200 border border-red-200/60 dark:border-red-800/40'}`}
                  >
                    {r.ok ? (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
                    )}
                    <div className="flex-1">
                      <span className="font-bold">{linha?.csv.nome || `Linha ${r.idx + 1}`}</span>
                      {linha?.cargo && <span className="text-[11px] text-zinc-500 dark:text-zinc-400 ml-1.5 font-normal">({linha.cargo})</span>}
                      <p className="text-[11px] mt-0.5">
                        {r.ok ? (
                          r.pinEnviado ? 'Cadastro concluído e PIN de acesso enviado por e-mail.' : 'Cadastro concluído com sucesso.'
                        ) : (
                          <span className="font-semibold text-red-700 dark:text-red-400">Erro: {r.erro}</span>
                        )}
                      </p>
                    </div>
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
