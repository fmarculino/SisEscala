'use client'

import { useEffect, useState } from 'react'
import { Monitor, Fingerprint, ListChecks, Plus, Pencil, Trash2, ShieldCheck, UploadCloud } from 'lucide-react'
import { listarTerminaisLocais, listarDispositivosRep, excluirTerminalLocal, excluirDispositivoRep } from './actions'
import { TerminalLocalModal } from './TerminalLocalModal'
import { DispositivoRepModal } from './DispositivoRepModal'
import { PendenciasTab } from './PendenciasTab'
import { BiometriaTab } from './BiometriaTab'
import { HigieneDispositivoTab } from './HigieneDispositivoTab'
import { ImportarPendriveTab } from './ImportarPendriveTab'
import { IdCopyBadge } from './IdCopyBadge'

type Aba = 'terminais' | 'dispositivos' | 'pendencias' | 'biometria' | 'higiene' | 'pendrive'

interface Opcoes {
  unidades: { id: string; nome: string }[]
  setores: { id: string; unidade_id: string; nome: string }[]
  coordenadores: { id: string; full_name: string; role: string }[]
}

export function MarcacoesClient({ isAdmin, opcoes }: { isAdmin: boolean; opcoes: Opcoes }) {
  const [aba, setAba] = useState<Aba>(isAdmin ? 'terminais' : 'pendencias')

  const [terminais, setTerminais] = useState<any[]>([])
  const [dispositivos, setDispositivos] = useState<any[]>([])
  const [carregandoLista, setCarregandoLista] = useState(false)

  const [modalTerminal, setModalTerminal] = useState<{ aberto: boolean; terminal: any | null }>({ aberto: false, terminal: null })
  const [modalDispositivo, setModalDispositivo] = useState<{ aberto: boolean; dispositivo: any | null }>({ aberto: false, dispositivo: null })

  async function recarregarTerminais() {
    setCarregandoLista(true)
    try { setTerminais(await listarTerminaisLocais()) } finally { setCarregandoLista(false) }
  }

  async function recarregarDispositivos() {
    setCarregandoLista(true)
    try { setDispositivos(await listarDispositivosRep()) } finally { setCarregandoLista(false) }
  }

  async function handleExcluirTerminal(t: any) {
    if (!confirm(`Excluir o terminal "${t.nome}"? Esta ação não pode ser desfeita.`)) return
    const res = await excluirTerminalLocal(t.id)
    if (res?.error) { alert(res.error); return }
    recarregarTerminais()
  }

  async function handleExcluirDispositivo(d: any) {
    if (!confirm(`Excluir o dispositivo "${d.nome}"? Esta ação não pode ser desfeita.`)) return
    const res = await excluirDispositivoRep(d.id)
    if (res?.error) { alert(res.error); return }
    recarregarDispositivos()
  }

  useEffect(() => {
    if (!isAdmin) return
    if (aba === 'terminais') recarregarTerminais()
    if (aba === 'dispositivos') recarregarDispositivos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, isAdmin])

  const abas: { id: Aba; label: string; icon: any; visivel: boolean }[] = [
    { id: 'terminais', label: 'Terminais Locais', icon: Monitor, visivel: isAdmin },
    { id: 'dispositivos', label: 'Dispositivos REP', icon: Fingerprint, visivel: isAdmin },
    { id: 'pendencias', label: 'Pendências', icon: ListChecks, visivel: true },
    { id: 'biometria', label: 'Biometria Pendente', icon: Fingerprint, visivel: true },
    { id: 'higiene', label: 'Higiene do Relógio', icon: ShieldCheck, visivel: isAdmin },
    { id: 'pendrive', label: 'Importar por Pendrive', icon: UploadCloud, visivel: isAdmin },
  ]

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {abas.filter((a) => a.visivel).map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 -mb-px transition-colors ${
              aba === a.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <a.icon className="h-4 w-4" />
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'terminais' && isAdmin && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setModalTerminal({ aberto: true, terminal: null })}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold"
            >
              <Plus className="h-4 w-4" /> Novo terminal
            </button>
          </div>

          {carregandoLista ? (
            <p className="text-sm text-zinc-400 text-center py-8">Carregando…</p>
          ) : terminais.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-8">Nenhum terminal local cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {terminais.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                  <div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                      {t.nome}
                      {!t.ativo && <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">DESATIVADO</span>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t.unidades?.nome}{t.setores?.dicionario_setores?.nome ? ` — ${t.setores.dicionario_setores.nome}` : ' — toda a unidade'}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Responsável: {t.profiles?.full_name || '—'} · Último contato:{' '}
                      {t.ultimo_contato_em ? new Date(t.ultimo_contato_em).toLocaleString('pt-BR') : 'nunca'}
                    </p>
                    <div className="mt-1">
                      <IdCopyBadge id={t.id} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setModalTerminal({ aberto: true, terminal: t })}
                      className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                      title="Editar / gerar token"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleExcluirTerminal(t)}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-500 hover:text-red-600"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {modalTerminal.aberto && (
            <TerminalLocalModal
              isOpen
              onClose={() => setModalTerminal({ aberto: false, terminal: null })}
              onSaved={recarregarTerminais}
              opcoes={opcoes}
              terminal={modalTerminal.terminal}
            />
          )}
        </div>
      )}

      {aba === 'dispositivos' && isAdmin && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setModalDispositivo({ aberto: true, dispositivo: null })}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold"
            >
              <Plus className="h-4 w-4" /> Novo dispositivo
            </button>
          </div>

          {carregandoLista ? (
            <p className="text-sm text-zinc-400 text-center py-8">Carregando…</p>
          ) : dispositivos.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-8">Nenhum relógio de ponto cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {dispositivos.map((d) => (
                <div key={d.id} className="flex items-center justify-between p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                  <div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                      {d.nome}
                      {!d.ativo && <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">DESATIVADO</span>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {d.unidades?.nome}{d.setores?.dicionario_setores?.nome ? ` — ${d.setores.dicionario_setores.nome}` : ''}
                      {d.endereco_ip ? ` · ${d.endereco_ip}` : ''}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      NSR: {d.ultimo_nsr} · Último contato: {d.ultimo_contato_em ? new Date(d.ultimo_contato_em).toLocaleString('pt-BR') : 'nunca'}
                      {typeof d.deriva_segundos === 'number' && Math.abs(d.deriva_segundos) > 60 && (
                        <span className="text-amber-600 font-bold"> · deriva de relógio: {d.deriva_segundos}s</span>
                      )}
                    </p>
                    <div className="mt-1">
                      <IdCopyBadge id={d.id} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setModalDispositivo({ aberto: true, dispositivo: d })}
                      className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                      title="Editar / gerar token"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleExcluirDispositivo(d)}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-500 hover:text-red-600"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {modalDispositivo.aberto && (
            <DispositivoRepModal
              isOpen
              onClose={() => setModalDispositivo({ aberto: false, dispositivo: null })}
              onSaved={recarregarDispositivos}
              opcoes={opcoes}
              dispositivo={modalDispositivo.dispositivo}
            />
          )}
        </div>
      )}

      {aba === 'pendencias' && <PendenciasTab />}
      {aba === 'biometria' && <BiometriaTab />}
      {aba === 'higiene' && isAdmin && <HigieneDispositivoTab />}
      {aba === 'pendrive' && isAdmin && <ImportarPendriveTab />}
    </div>
  )
}
