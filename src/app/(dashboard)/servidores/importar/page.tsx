'use client'

import { useState } from 'react'
import { importServidores } from '../actions'
import Link from 'next/link'
import { ArrowLeft, Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react'

export default function ImportarServidoresPage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null)

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
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center space-x-4">
        <Link
          href="/servidores"
          className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Importar Servidores</h1>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
          <div className="flex">
            <FileText className="h-5 w-5 text-blue-600 mr-3" />
            <div>
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">Formato Esperado</h3>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
                O arquivo CSV deve conter as colunas: <code className="font-bold">nome, matricula, cargo, vinculo, email, telefone, unidade, setor</code>
              </p>
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
          <p className="text-zinc-600 dark:text-zinc-400 font-medium">
            {file ? file.name : 'Clique ou arraste o arquivo CSV aqui'}
          </p>
        </div>

        {result?.success && (
          <div className="rounded-md bg-green-50 p-4 dark:bg-green-900/20 flex items-center">
            <CheckCircle2 className="h-5 w-5 text-green-600 mr-3" />
            <p className="text-sm text-green-700 dark:text-green-400">Importação concluída com sucesso!</p>
          </div>
        )}

        {result?.error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20 flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-3" />
            <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="inline-flex items-center rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-all"
          >
            {loading ? 'Processando...' : 'Iniciar Importação'}
          </button>
        </div>
      </div>
    </div>
  )
}
