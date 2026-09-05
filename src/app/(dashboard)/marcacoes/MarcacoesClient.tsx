'use client'

import { useEffect, useState } from 'react'
import { formatarDataHoraComSegundos } from '@/utils/horario'
import { Monitor, Fingerprint, ListChecks, Plus, Pencil, Trash2, ShieldCheck, UploadCloud, HeartPulse, FileCheck2 } from 'lucide-react'
import { listarTerminaisLocais, listarDispositivosRep, excluirTerminalLocal, excluirDispositivoRep, listarCoberturaResumo } from './actions'
import { TerminalLocalModal } from './TerminalLocalModal'
import { DispositivoRepModal } from './DispositivoRepModal'
import { PendenciasTab } from './PendenciasTab'
import { BiometriaTab } from './BiometriaTab'
import { HigieneDispositivoTab } from './HigieneDispositivoTab'
import { ImportarPendriveTab } from './ImportarPendriveTab'
import { CoberturaTab } from './CoberturaTab'
import { AutorizacoesPontoTab } from './AutorizacoesPontoTab'
import { IdCopyBadge } from './IdCopyBadge'

type Aba = 'terminais' | 'dispositivos' | 'cobertura' | 'pendencias' | 'biometria' | 'higiene' | 'pendrive' | 'autorizacoes'

interface Opcoes {
  unidades: { id: string; nome: string }[]
  setores: { id: string; unidade_id: string | null; nome: string }[]
  coordenadores: { id: string; full_name: string; role: string }[]
}

const CLASSES_STATUS_COLETA = {
  verde: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
  ambar: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
  vermelho: 'text-red-600 bg-red-50 dark:bg-red-900/20',
  neutro: 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800',
}

// Mesma comparação numérica campo a campo de `compararVersoes` em ciclo/ciclo.go — é o próprio
// coletor que decide se atualiza, aqui só se mostra a mesma conclusão na tela.
function compararVersoes(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i] || '0', 10) || 0
    const nb = parseInt(pb[i] || '0', 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

// Versão do coletor instalado na máquina daquela unidade, comparada com a que o servidor publica
// em /api/coletor-rep/tray-version (o mesmo endpoint que o app de bandeja consulta pra se
// oferecer pra atualizar). Dispositivo "somente pendrive" não tem coletor rodando continuamente:
// devolve null e o card não mostra badge nenhum, em vez de dizer "desatualizado" pra sempre.
function statusColetorDispositivo(d: any, versaoServidor: string | null): { texto: string; classe: string; titulo: string } | null {
  if (d.modo_operacao === 'usb') return null

  if (!d.coletor_versao) {
    return {
      texto: 'Coletor: versão desconhecida',
      classe: CLASSES_STATUS_COLETA.neutro,
      titulo: 'Nenhum coletor reportou versão ainda neste dispositivo — só o heartbeat (0.8.0+) e o envio de lote de AFD informam.',
    }
  }

  const desde = d.coletor_versao_em ? ` · informada há ${formatarDuracao(d.coletor_versao_em).texto}` : ''
  const host = d.coletor_host ? ` · ${d.coletor_host}` : ''
  const base = `Coletor v${d.coletor_versao}`

  if (!versaoServidor) {
    return { texto: base, classe: CLASSES_STATUS_COLETA.neutro, titulo: `Versão publicada no servidor indisponível no momento.${host}${desde}` }
  }

  const cmp = compararVersoes(d.coletor_versao, versaoServidor)
  if (cmp < 0) {
    return {
      texto: `${base} · atualizar para ${versaoServidor}`,
      classe: CLASSES_STATUS_COLETA.ambar,
      titulo: `O app de bandeja avisa sozinho e espera clique em "Atualização disponível".${host}${desde}`,
    }
  }
  if (cmp > 0) {
    return {
      texto: `${base} · à frente do servidor (${versaoServidor})`,
      classe: CLASSES_STATUS_COLETA.neutro,
      titulo: `O servidor publica ${versaoServidor} — provavelmente o dist/VERSION não foi atualizado no último release.${host}${desde}`,
    }
  }
  return { texto: `${base} · atualizado`, classe: CLASSES_STATUS_COLETA.verde, titulo: `Igual à versão publicada no servidor.${host}${desde}` }
}

function formatarDuracao(desde: string): { texto: string; horas: number } {
  const ms = Date.now() - new Date(desde).getTime()
  const minutos = Math.floor(ms / 60000)
  const horas = Math.floor(minutos / 60)
  const dias = Math.floor(horas / 24)
  if (dias >= 1) return { texto: `${dias} dia${dias > 1 ? 's' : ''}`, horas }
  if (horas >= 1) return { texto: `${horas}h`, horas }
  return { texto: `${Math.max(minutos, 1)} min`, horas }
}

// Dispositivo "somente pendrive" nao tem heartbeat (fn_ingerir_afd via importarPendriveAfd nunca
// atualiza ultimo_contato_em - so' fn_autenticar_dispositivo_rep, usada pelas rotas do coletor via
// token, atualiza) - por isso usa a ultima sincronizacao por canal pendrive como sinal, nao
// "online/offline". Dispositivo pull/fallback usa o contato do coletor (ciclo de ~5 min).
function statusColetaDispositivo(d: any): { texto: string; classe: string } {
  if (d.modo_operacao === 'usb') {
    if (!d.ultima_coleta_pendrive) {
      return { texto: 'Coleta por pendrive nunca realizada', classe: CLASSES_STATUS_COLETA.vermelho }
    }
    const { texto, horas } = formatarDuracao(d.ultima_coleta_pendrive)
    if (horas < 72) return { texto: `Última coleta há ${texto}`, classe: CLASSES_STATUS_COLETA.verde }
    if (horas < 168) return { texto: `Coleta não realizada há ${texto}`, classe: CLASSES_STATUS_COLETA.ambar }
    return { texto: `Coleta não realizada há ${texto}`, classe: CLASSES_STATUS_COLETA.vermelho }
  }

  if (!d.ultimo_contato_em) return { texto: 'Nunca conectado', classe: CLASSES_STATUS_COLETA.vermelho }
  const minutosDesde = (Date.now() - new Date(d.ultimo_contato_em).getTime()) / 60000
  if (minutosDesde <= 10) return { texto: 'Online', classe: CLASSES_STATUS_COLETA.verde }
  const { texto, horas } = formatarDuracao(d.ultimo_contato_em)
  if (horas < 24) return { texto: `Offline há ${texto}`, classe: CLASSES_STATUS_COLETA.ambar }
  return { texto: `Offline há ${texto}`, classe: CLASSES_STATUS_COLETA.vermelho }
}

export function MarcacoesClient({ isAdmin, podeAutorizar, opcoes }: { isAdmin: boolean; podeAutorizar: boolean; opcoes: Opcoes }) {
  const [aba, setAba] = useState<Aba>(isAdmin ? 'terminais' : 'pendencias')

  const [terminais, setTerminais] = useState<any[]>([])
  const [dispositivos, setDispositivos] = useState<any[]>([])
  const [carregandoLista, setCarregandoLista] = useState(false)
  const [versaoColetorServidor, setVersaoColetorServidor] = useState<string | null>(null)

  const [alertaCobertura, setAlertaCobertura] = useState<number | null>(null)

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

  // Versão do coletor publicada no servidor agora — mesma fonte que o app de bandeja consulta
  // (dist/VERSION). Falha em silêncio: sem ela o card mostra a versão instalada sem julgar se
  // está atrasada, que é melhor do que dizer "desatualizado" por indisponibilidade do endpoint.
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/coletor-rep/tray-version', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setVersaoColetorServidor(j?.versao || null))
      .catch(() => setVersaoColetorServidor(null))
  }, [isAdmin])

  // O alerta de cobertura carrega junto com a página, não quando a aba é aberta: o valor dele é
  // justamente avisar quem não ia clicar. Falha em silêncio — um erro aqui não pode derrubar o
  // resto da tela de Marcações.
  useEffect(() => {
    listarCoberturaResumo()
      .then((res) => setAlertaCobertura(res.error ? null : res.dados.reduce((s, d) => s + d.nao_conseguem_bater, 0)))
      .catch(() => setAlertaCobertura(null))
  }, [])

  const abas: { id: Aba; label: string; icon: any; visivel: boolean; alerta?: number | null }[] = [
    { id: 'terminais', label: 'Terminais Locais', icon: Monitor, visivel: isAdmin },
    { id: 'dispositivos', label: 'Dispositivos REP', icon: Fingerprint, visivel: isAdmin },
    { id: 'cobertura', label: 'Cobertura de Ponto', icon: HeartPulse, visivel: true, alerta: alertaCobertura },
    { id: 'pendencias', label: 'Pendências', icon: ListChecks, visivel: true },
    { id: 'biometria', label: 'Biometria Pendente', icon: Fingerprint, visivel: true },
    { id: 'higiene', label: 'Higiene do Relógio', icon: ShieldCheck, visivel: isAdmin },
    { id: 'pendrive', label: 'Importar por Pendrive', icon: UploadCloud, visivel: isAdmin },
    // Visível para todo gestor: o coordenador precisa conferir a vigência antes de declarar em
    // massa. Conceder e revogar é que ficam com o RH Geral (podeAutorizar).
    { id: 'autorizacoes', label: 'Autorizações do RH', icon: FileCheck2, visivel: true },
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
            {!!a.alerta && (
              <span className="text-[10px] font-black bg-red-600 text-white rounded-full px-1.5 py-0.5 leading-none">
                {a.alerta}
              </span>
            )}
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
                      {t.ultimo_contato_em ? formatarDataHoraComSegundos(t.ultimo_contato_em) : 'nunca'}
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
                    <p className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2 flex-wrap">
                      {d.nome}
                      {!d.ativo && <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">DESATIVADO</span>}
                      {d.ativo && (() => {
                        const s = statusColetaDispositivo(d)
                        return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.classe}`}>{s.texto}</span>
                      })()}
                      {d.ativo && (() => {
                        const c = statusColetorDispositivo(d, versaoColetorServidor)
                        if (!c) return null
                        return (
                          <span title={c.titulo} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.classe}`}>
                            {c.texto}
                          </span>
                        )
                      })()}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {d.unidades?.nome}
                      {(() => {
                        const nomes = (d.dispositivos_rep_setores || [])
                          .map((x: any) => x.setores?.dicionario_setores?.nome)
                          .filter(Boolean)
                        return nomes.length > 0 ? ` — ${nomes.join(', ')}` : ''
                      })()}
                      {d.endereco_ip ? ` · ${d.endereco_ip}` : ''}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      NSR: {d.ultimo_nsr} · Último contato: {d.ultimo_contato_em ? formatarDataHoraComSegundos(d.ultimo_contato_em) : 'nunca'}
                      {d.coletor_host && ` · máquina: ${d.coletor_host}`}
                      {/* IP da máquina do coletor na rede da unidade — é por ele que se acessa
                          o computador do comunicador; o do relógio já aparece na linha de cima. */}
                      {d.coletor_ip && ` (${d.coletor_ip})`}
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
              outrosDispositivos={dispositivos}
            />
          )}
        </div>
      )}

      {aba === 'cobertura' && <CoberturaTab isAdmin={isAdmin} />}
      {aba === 'pendencias' && <PendenciasTab opcoes={opcoes} />}
      {aba === 'biometria' && <BiometriaTab />}
      {aba === 'higiene' && isAdmin && <HigieneDispositivoTab />}
      {aba === 'pendrive' && isAdmin && <ImportarPendriveTab />}
      {aba === 'autorizacoes' && <AutorizacoesPontoTab podeAutorizar={podeAutorizar} />}
    </div>
  )
}
