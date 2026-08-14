'use client'

import { useEffect, useState } from 'react'
import { UploadCloud, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { listarDispositivosRep, importarPendriveAfd } from './actions'

interface Resultado {
  recebidas: number
  novas: number
  duplicadas: number
  marcacoes: number
  orfas: number
  aviso: string | null
}

/**
 * Import de AFD por `.sisrep` — unidade sem rede até o relógio (`coletor-rep afd-exportar` numa
 * máquina offline, arquivo levado fisicamente até aqui). Reenviar o mesmo arquivo depois não
 * duplica nada: a ingestão é a mesma `fn_ingerir_afd` do sync online, idempotente por
 * (dispositivo_id, nsr).
 */
export function ImportarPendriveTab() {
  const [dispositivos, setDispositivos] = useState<any[]>([])
  const [dispositivoId, setDispositivoId] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [carregandoDispositivos, setCarregandoDispositivos] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  useEffect(() => {
    listarDispositivosRep()
      .then((lista: any[]) => {
        setDispositivos(lista)
        if (lista.length > 0) setDispositivoId(lista[0].id)
      })
      .catch((e: any) => setErro(e.message))
      .finally(() => setCarregandoDispositivos(false))
  }, [])

  async function handleImportar() {
    if (!dispositivoId || !arquivo) return
    setEnviando(true)
    setErro(null)
    setResultado(null)

    const formData = new FormData()
    formData.set('arquivo', arquivo)
    const res = await importarPendriveAfd(dispositivoId, formData)
    setEnviando(false)

    if ('error' in res && res.error) { setErro(res.error); return }
    setResultado(res as Resultado)
    setArquivo(null)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Para unidades sem rede até o relógio: rode <code className="font-mono">coletor-rep afd-exportar
        arquivo.sisrep</code> numa máquina que enxergue o equipamento, leve o arquivo até aqui num
        pendrive e importe abaixo. Só grava o que ainda não existia — reenviar o mesmo arquivo
        depois não duplica nada.
      </p>

      <p className="text-sm text-zinc-500">
        <b>Relógio sem rede nenhuma</b> (nem o coletor alcança o equipamento): use a exportação de
        AFD do próprio relógio para pendrive e envie esse arquivo aqui do mesmo jeito. Ele vem sem
        cabeçalho, então <b>não há como conferir de qual equipamento veio</b> — o dispositivo
        escolhido acima é a única fonte, confira antes de importar.
      </p>

      {carregandoDispositivos ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : dispositivos.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-10">Nenhum dispositivo REP cadastrado.</p>
      ) : (
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
              Dispositivo de origem do arquivo
            </label>
            <select
              value={dispositivoId}
              onChange={(e) => setDispositivoId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white"
            >
              {dispositivos.map((d) => (
                <option key={d.id} value={d.id}>{d.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
              Arquivo .sisrep ou AFD exportado pelo relógio
            </label>
            <input
              type="file"
              accept=".sisrep,.txt,.afd"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              className="w-full text-sm text-zinc-600 dark:text-zinc-400 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-300 hover:file:bg-blue-100"
            />
          </div>

          {erro && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {erro}
            </p>
          )}

          {resultado && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-500/10 p-4 space-y-1">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Importado
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {resultado.recebidas} linha(s) lida(s) · {resultado.novas} nova(s) ·{' '}
                {resultado.duplicadas} já existiam · {resultado.marcacoes} marcação(ões) de ponto
                {resultado.orfas > 0 ? ` (${resultado.orfas} sem servidor identificado)` : ''}.
              </p>
              {resultado.aviso && (
                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2 pt-1">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {resultado.aviso}
                </p>
              )}
            </div>
          )}

          <button
            onClick={handleImportar}
            disabled={!arquivo || enviando}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Importar
          </button>
        </div>
      )}
    </div>
  )
}
