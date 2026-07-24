'use client'

import { useState } from 'react'
import { importServidores } from '../actions'
import Link from 'next/link'
import { ArrowLeft, Upload, FileText, CheckCircle2, AlertCircle, Download } from 'lucide-react'

export default function ImportarServidoresPage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null)

  function downloadSampleCSV() {
    const headers = [
      'nome', 'matricula', 'cpf', 'rg', 'rg_orgao', 'rg_emissao', 'pis_pasep',
      'data_nascimento', 'sexo', 'estado_civil', 'nome_mae', 'nome_pai', 'escolaridade',
      'cargo', 'vinculo', 'carga_horaria_semanal', 'email', 'telefone', 'telefone_residencial',
      'unidade', 'setor', 'cep', 'logradouro', 'numero', 'bairro', 'municipio',
      'banco', 'agencia', 'conta', 'tipo_conta', 'pix', 'observacao'
    ]

    const sampleRow = [
      'FERNANDO MARCULINO GUIMARAES JUNIOR', '68008', '000.111.222-33', '1234567', 'SSP/PA',
      '2010-01-01', '123.45678.90-1', '1985-05-15', 'Masculino', 'Casado(a)',
      'GIZELIA VILAÇA GUIMARAES', 'FERNANDO MARCULINO GUIMARAES', 'Superior Completo',
      'COORD. DE INFRAESTRUTURA EM TI', 'Comissionada', '40', 'fernando@exemplo.com',
      '(94) 99111-2222', '(94) 3322-1100', 'SMS - SECRETARIA MUNICIPAL DE SAÚDE',
      'TECNOLOGIA DA INFORMAÇÃO', '68501-538', 'Rua Miguel Basílio', '357',
      'Cidade Nova', 'Marabá - PA', 'BANCO DO BRASIL', '0123-4', '12345-6',
      'Corrente', 'fernando@exemplo.com', 'Servidor importado via sistema'
    ]

    const csvContent = `${headers.join(';')}\n${sampleRow.join(';')}`
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', 'modelo_importacao_servidores.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async function handleUpload() {
    if (!file) return
    setLoading(true)
    setResult(null)

    const reader = new FileReader()
    reader.onload = async (e) => {
      const text = e.target?.result as string
      const res = await importServidores(text)
      setResult(res)
      setLoading(false)
    }
    reader.readAsText(file)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            href="/servidores"
            className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Importar Servidores</h1>
        </div>

        <button
          type="button"
          onClick={downloadSampleCSV}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold rounded-xl transition-all border border-zinc-200 dark:border-zinc-700"
        >
          <Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Baixar Modelo CSV Exemplo
        </button>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="rounded-xl bg-blue-50/70 dark:bg-blue-900/20 p-5 border border-blue-100 dark:border-blue-800 space-y-3">
          <div className="flex items-start gap-3">
            <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-blue-900 dark:text-blue-300">Formato e Colunas Suportadas</h3>
              <p className="mt-1 text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
                O arquivo pode usar delimitadores vírgula (<code>,</code>) ou ponto e vírgula (<code>;</code>). Se a coluna <code>matricula</code> for deixada em branco, uma matrícula temporária automática será gerada.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-blue-200/60 dark:border-blue-800/60 text-xs text-blue-900 dark:text-blue-300 space-y-2">
            <div>
              <span className="font-bold text-blue-950 dark:text-blue-200 uppercase block mb-1">Colunas Principais:</span>
              <div className="flex flex-wrap gap-1 font-mono text-[11px]">
                {['nome', 'matricula', 'cargo', 'vinculo', 'carga_horaria', 'email', 'telefone', 'unidade', 'setor'].map(col => (
                  <span key={col} className="bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 rounded font-semibold text-blue-900 dark:text-blue-300">{col}</span>
                ))}
              </div>
            </div>

            <div>
              <span className="font-bold text-blue-950 dark:text-blue-200 uppercase block mb-1">Documentos & Dados Complementares:</span>
              <div className="flex flex-wrap gap-1 font-mono text-[11px]">
                {['cpf', 'rg', 'rg_orgao', 'rg_emissao', 'pis_pasep', 'data_nascimento', 'sexo', 'estado_civil', 'nome_mae', 'nome_pai', 'escolaridade', 'cep', 'logradouro', 'numero', 'bairro', 'municipio', 'banco', 'agencia', 'conta', 'tipo_conta', 'pix', 'observacao'].map(col => (
                  <span key={col} className="bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-700 dark:text-zinc-300">{col}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-12 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer relative">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <Upload className="h-12 w-12 text-zinc-500 dark:text-zinc-400 mb-4" />
          <p className="text-zinc-600 dark:text-zinc-400 font-medium text-center">
            {file ? file.name : 'Clique ou arraste o arquivo CSV aqui'}
          </p>
        </div>

        {result?.success && (
          <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20 flex items-center">
            <CheckCircle2 className="h-5 w-5 text-green-600 mr-3 shrink-0" />
            <p className="text-sm text-green-700 dark:text-green-400">Importação de servidores concluída com sucesso!</p>
          </div>
        )}

        {result?.error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20 flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-3 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="inline-flex items-center rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-all"
          >
            {loading ? 'Processando...' : 'Iniciar Importação'}
          </button>
        </div>
      </div>
    </div>
  )
}
