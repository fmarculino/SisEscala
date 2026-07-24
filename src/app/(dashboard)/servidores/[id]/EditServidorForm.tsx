'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Save, User, Layers, Eye, EyeOff, MessageCircle, Info, Briefcase, Search, Check, ChevronsUpDown, FileText, Printer, Camera, ZoomIn } from 'lucide-react'
import { updateServidor } from '../actions'
import { DadosComplementaresSection } from '@/components/servidores/DadosComplementaresSection'
import { WebcamPhotoCaptureModal } from '@/components/servidores/WebcamPhotoCaptureModal'
import { FichaServidorPrintView } from '@/components/servidores/FichaServidorPrintView'
import { PhotoPreviewModal } from '@/components/servidores/PhotoPreviewModal'

interface EditServidorFormProps {
  id: string
  servidor: any
  unidades: any[]
  setores: any[]
  cargos: any[]
  isSuperAdmin?: boolean
}

export function EditServidorForm({ id, servidor, unidades, setores, cargos, isSuperAdmin = false }: EditServidorFormProps) {
  const [formTab, setFormTab] = useState<'principal' | 'complementar'>('principal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedUnidade, setSelectedUnidade] = useState(servidor.unidade_id || '')
  const [selectedSetor, setSelectedSetor] = useState(servidor.setor_id || '')
  const [fotoUrl, setFotoUrl] = useState<string>(servidor.foto_url || '')
  const [showWebcamModal, setShowWebcamModal] = useState(false)
  const [showPhotoPreviewModal, setShowPhotoPreviewModal] = useState(false)

  const isLotaçãoChanged = selectedUnidade !== (servidor.unidade_id || '') || selectedSetor !== (servidor.setor_id || '')

  const isTemporary = servidor.matricula ? /^T\d{7}$/.test(servidor.matricula) : false

  // Find initial cargo ID based on cargo_id or name
  const initialCargo = cargos.find(c => c.id === servidor.cargo_id || c.nome === (servidor.cargo || ''))?.id || ''
  const [selectedCargo, setSelectedCargo] = useState(initialCargo)
  const [cargoSearch, setCargoSearch] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredSetores = selectedUnidade 
    ? setores.filter(s => s.unidade_id === selectedUnidade)
    : setores

  // Lógica de filtragem de cargos (Mostra ativos + o atual caso esteja inativo)
  const filteredCargos = useMemo(() => {
    return cargos.filter(c => c.ativo || c.id === initialCargo)
  }, [cargos, initialCargo])

  const cargoFinal = useMemo(() => {
    return cargos.find(c => c.id === selectedCargo)?.nome || ''
  }, [cargos, selectedCargo])

  const selectedCargoObj = useMemo(() => {
    return cargos.find(c => c.id === selectedCargo)
  }, [cargos, selectedCargo])

  // Lógica de busca incremental para o select
  const filteredCargosForSelect = useMemo(() => {
    return filteredCargos.filter(c => 
      c.nome.toLowerCase().includes(cargoSearch.toLowerCase()) ||
      (c.codigo && c.codigo.toLowerCase().includes(cargoSearch.toLowerCase()))
    )
  }, [filteredCargos, cargoSearch])

  const [showPin, setShowPin] = useState(false)
  const [currentPin, setCurrentPin] = useState(
    servidor.pin_acesso && (servidor.pin_acesso.startsWith('$2a$') || servidor.pin_acesso.startsWith('$2b$'))
      ? '****'
      : (servidor.pin_acesso || '')
  )
  const [currentTelefone, setCurrentTelefone] = useState(servidor.telefone || '')
  const [currentCpf, setCurrentCpf] = useState(servidor.cpf || '')

  const sharePinWhatsApp = () => {
    if (!currentPin) return
    const phone = currentTelefone.replace(/\D/g, '')
    const message = encodeURIComponent(`Olá *${servidor.nome}*, seu PIN de acesso ao Portal do Servidor SisEscala é: *${currentPin}*`)
    window.open(`https://wa.me/55${phone}?text=${message}`, '_blank')
  }

  const handleSubmit = async (formData: FormData) => {
    setLoading(true)
    formData.set('cargo', cargoFinal)
    formData.set('pin_acesso', currentPin)
    formData.set('cpf', currentCpf)
    formData.set('foto_url', fotoUrl)
    if (isSuperAdmin) {
      const checkbox = document.getElementById('ignora_janela_presenca') as HTMLInputElement
      formData.set('ignora_janela_presenca', checkbox?.checked ? 'true' : 'false')
    }
    const result = await updateServidor(id, formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  const mergedServidor = useMemo(() => ({
    ...servidor,
    foto_url: fotoUrl
  }), [servidor, fotoUrl])

  return (
    <div className="rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      {/* Printable Ficha Cadastral Component */}
      <FichaServidorPrintView
        servidor={mergedServidor}
        unidades={unidades}
        setores={setores}
        cargos={cargos}
      />

      {/* Webcam Photo Capture Modal */}
      <WebcamPhotoCaptureModal
        isOpen={showWebcamModal}
        onClose={() => setShowWebcamModal(false)}
        onPhotoCaptured={(newPhotoDataUrl) => setFotoUrl(newPhotoDataUrl)}
        currentPhotoUrl={fotoUrl}
      />

      {/* Photo Preview Modal (Ampliar Foto) */}
      <PhotoPreviewModal
        isOpen={showPhotoPreviewModal}
        onClose={() => setShowPhotoPreviewModal(false)}
        photoUrl={fotoUrl}
        servidorNome={servidor.nome}
        matricula={servidor.matricula}
        cargo={cargoFinal}
        onOpenWebcam={() => setShowWebcamModal(true)}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center space-x-4">
          <div className="relative group shrink-0">
            <button
              type="button"
              onClick={() => setShowPhotoPreviewModal(true)}
              className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 overflow-hidden flex items-center justify-center shadow-sm hover:opacity-90 hover:ring-2 hover:ring-blue-500/40 transition-all cursor-pointer block relative group/avatar"
              title="Clique para ampliar foto do servidor"
            >
              {fotoUrl ? (
                <img src={fotoUrl} alt={servidor.nome} className="w-full h-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center text-white">
                <ZoomIn className="h-5 w-5" />
              </div>
            </button>
            <button
              type="button"
              onClick={() => setShowWebcamModal(true)}
              className="absolute -bottom-1 -right-1 p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-md transition-all active:scale-95 print:hidden"
              title="Fotografar via Webcam / Alterar Foto"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Editar Servidor: {servidor.nome}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono">
                Matrícula: {servidor.matricula || 'Sem Matrícula'}
              </span>
              <button
                type="button"
                onClick={() => setShowWebcamModal(true)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-bold flex items-center gap-1 print:hidden"
              >
                <Camera className="h-3 w-3" />
                {fotoUrl ? 'Alterar Foto (Webcam)' : 'Fotografar Servidor (Webcam)'}
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <form action={handleSubmit} className="space-y-6">
        <input type="hidden" name="foto_url" value={fotoUrl} />

        {/* Navigation Tabs Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-zinc-200 dark:border-zinc-800 gap-2 pb-1 sm:pb-0">
          <div className="flex border-b sm:border-b-0 border-zinc-200 dark:border-zinc-800 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setFormTab('principal')}
              className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-sm transition-all ${
                formTab === 'principal'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:hover:text-zinc-300'
              }`}
            >
              <User className="h-4 w-4" />
              Cadastro Principal
            </button>
            <button
              type="button"
              onClick={() => setFormTab('complementar')}
              className={`flex items-center gap-2 px-6 py-3 border-b-2 font-bold text-sm transition-all ${
                formTab === 'complementar'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:hover:text-zinc-300'
              }`}
            >
              <FileText className="h-4 w-4" />
              Dados Complementares
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 my-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 print:hidden self-end sm:self-auto"
          >
            <Printer className="h-4 w-4" />
            Imprimir Ficha Cadastral (PDF)
          </button>
        </div>

        {/* Tab 1: Cadastro Principal */}
        <div className={formTab === 'principal' ? 'space-y-6 animate-in fade-in' : 'hidden'}>
          {isTemporary && (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <div className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                Este servidor possui uma <strong>Matrícula Temporária</strong>. Lembre-se de atualizá-la para a matrícula definitiva assim que gerada pela folha de pagamento.
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label htmlFor="nome" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nome Completo
            </label>
            <input
              type="text"
              name="nome"
              id="nome"
              defaultValue={servidor.nome}
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="cpf" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              CPF
            </label>
            <input
              id="cpf"
              name="cpf"
              type="text"
              value={(() => {
                let v = currentCpf.replace(/\D/g, "")
                if (v.length > 9) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2})/, "$1.$2.$3-$4")
                if (v.length > 6) return v.replace(/^(\d{3})(\d{3})(\d{0,3})/, "$1.$2.$3")
                if (v.length > 3) return v.replace(/^(\d{3})(\d{0,3})/, "$1.$2")
                return v
              })()}
              placeholder="000.000.000-00"
              onChange={(e) => {
                let value = e.target.value.replace(/\D/g, "")
                if (value.length > 11) value = value.slice(0, 11)
                setCurrentCpf(value)
              }}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white sm:text-sm font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="matricula" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Matrícula
            </label>
            <input
              type="text"
              name="matricula"
              id="matricula"
              defaultValue={servidor.matricula}
              className={`mt-1 block w-full rounded-md border px-3 py-2 sm:text-sm font-mono focus:ring-blue-500 focus:border-blue-500 ${
                isTemporary
                  ? 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/10 dark:border-amber-900/30 dark:text-amber-300'
                  : 'bg-zinc-50 border-zinc-300 text-zinc-900 dark:bg-zinc-800 dark:text-white'
              }`}
            />
            {isTemporary && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                Matrícula temporária. Altere para a definitiva assim que gerada.
              </p>
            )}
          </div>

          <div className="sm:col-span-6 space-y-4 pt-2">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-600 dark:text-blue-400">
              <Briefcase className="h-4 w-4" />
              Seleção de Cargo
            </div>
            
            <div className="relative" ref={dropdownRef}>
              <label className="block text-xs font-medium text-zinc-500 uppercase mb-1">Cargo</label>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full flex items-center justify-between rounded-md border border-zinc-300 bg-white dark:bg-zinc-800 px-3 py-2 text-left text-zinc-900 dark:text-white sm:text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <span className="truncate">
                  {selectedCargoObj 
                    ? `${selectedCargoObj.codigo ? `[${selectedCargoObj.codigo}] ` : ''}${selectedCargoObj.nome}`
                    : 'Selecione...'}
                </span>
                <ChevronsUpDown className="h-4 w-4 text-zinc-400 shrink-0 ml-2" />
              </button>

              {isDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg max-h-60 overflow-y-auto">
                  <div className="sticky top-0 bg-white dark:bg-zinc-800 p-2 border-b border-zinc-100 dark:border-zinc-700">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Buscar..."
                        value={cargoSearch}
                        onChange={(e) => setCargoSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md text-xs outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <ul className="py-1">
                    {filteredCargosForSelect.map(c => {
                      const isSelected = c.id === selectedCargo
                      return (
                        <li
                          key={c.id}
                          onClick={() => {
                            setSelectedCargo(c.id)
                            setIsDropdownOpen(false)
                            setCargoSearch('')
                          }}
                          className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50 ${
                            isSelected ? 'bg-blue-50/50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-semibold' : 'text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          <span className="truncate">
                            {c.codigo ? `[${c.codigo}] ` : ''}{c.nome}
                          </span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0 ml-2" />}
                        </li>
                      )
                    })}
                    {filteredCargosForSelect.length === 0 && (
                      <li className="px-3 py-2 text-xs text-zinc-500 italic text-center">
                        Nenhum cargo encontrado
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {cargoFinal && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30 flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                <span className="font-bold">Cargo Atualizado:</span>
                <span>{cargoFinal}</span>
              </div>
            )}
            <input type="hidden" name="cargo" value={cargoFinal} />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="vinculo" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Vínculo
            </label>
            <select
              id="vinculo"
              name="vinculo"
              defaultValue={servidor.vinculo}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="Efetiva">Efetiva</option>
              <option value="Concursada">Concursada</option>
              <option value="Contratada">Contratada</option>
              <option value="Comissionada">Comissionada</option>
              <option value="Estagiária">Estagiária</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="preferenca_turno" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Preferência de Turno
            </label>
            <select
              id="preferenca_turno"
              name="preferenca_turno"
              defaultValue={servidor.preferenca_turno || 'Flexivel'}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="Flexivel">Flexível</option>
              <option value="M">Manhã</option>
              <option value="T">Tarde</option>
              <option value="N">Noite</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="carga_horaria_semanal" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Carga Horária Semanal (horas)
            </label>
            <input
              type="number"
              id="carga_horaria_semanal"
              name="carga_horaria_semanal"
              defaultValue={servidor.carga_horaria_semanal || 40}
              min={1}
              max={168}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="unidade_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Unidade de Lotação
            </label>
            <select
              id="unidade_id"
              name="unidade_id"
              value={selectedUnidade}
              onChange={(e) => {
                const nextUnit = e.target.value
                setSelectedUnidade(nextUnit)
                const belongs = setores.some(s => s.id === selectedSetor && s.unidade_id === nextUnit)
                if (!belongs) {
                  setSelectedSetor('')
                }
              }}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Sem Unidade</option>
              {unidades?.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-6">
            <label htmlFor="setor_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center">
              <Layers className="h-4 w-4 mr-1 text-blue-500" />
              Setor / Serviço
            </label>
            <select
              id="setor_id"
              name="setor_id"
              value={selectedSetor}
              onChange={(e) => setSelectedSetor(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Sem Setor</option>
              {filteredSetores?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} {!selectedUnidade && `(${unidades.find(u => u.id === s.unidade_id)?.nome})`}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              A escala será gerada com base no setor selecionado aqui.
            </p>
          </div>

          {isLotaçãoChanged && (
            <div className="sm:col-span-6 p-5 bg-amber-50 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/40 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
                <Info className="h-5 w-5 text-amber-500" />
                Registrar Transferência de Servidor
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                Você alterou a lotação deste servidor. Para salvar essa transferência, por favor informe a data de efetivação e o motivo da mudança para registro no histórico.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="data_transferencia" className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">
                    Data de Transferência *
                  </label>
                  <input
                    type="date"
                    id="data_transferencia"
                    name="data_transferencia"
                    required={isLotaçãoChanged}
                    max={new Date().toISOString().split('T')[0]}
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="motivo_transferencia" className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">
                    Motivo / Justificativa *
                  </label>
                  <textarea
                    id="motivo_transferencia"
                    name="motivo_transferencia"
                    required={isLotaçãoChanged}
                    rows={2}
                    placeholder="Ex: Remanejamento devido a aumento de demanda..."
                    className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="sm:col-span-6 space-y-4 pt-6 border-t border-zinc-100 dark:border-zinc-800">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center">
              <div className="w-1.5 h-4 bg-amber-500 rounded-full mr-2" />
              Portal do Servidor (Consulta de Escala)
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-zinc-500 uppercase">E-mail</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={servidor.email || ''}
                  placeholder="email@servidor.com"
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
              <div>
                <label htmlFor="telefone" className="block text-xs font-medium text-zinc-500 uppercase">Telefone / WhatsApp</label>
                <input
                  id="telefone"
                  name="telefone"
                  type="text"
                  value={(() => {
                    let v = currentTelefone.replace(/\D/g, "")
                    if (v.length > 10) return v.replace(/^(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
                    if (v.length > 5) return v.replace(/^(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3")
                    if (v.length > 2) return v.replace(/^(\d{2})(\d{0,5})/, "($1) $2")
                    if (v.length > 0) return v.replace(/^(\d*)/, "($1")
                    return v
                  })()}
                  placeholder="(00) 00000-0000"
                  onChange={(e) => {
                    let value = e.target.value.replace(/\D/g, "")
                    if (value.length > 11) value = value.slice(0, 11)
                    setCurrentTelefone(value)
                  }}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>
              <div className="sm:col-span-1">
                <label htmlFor="pin_acesso" className="block text-xs font-medium text-zinc-500 uppercase">PIN de Acesso</label>
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="pin_acesso"
                      type={showPin ? 'text' : 'password'}
                      maxLength={6}
                      value={currentPin}
                      onChange={(e) => setCurrentPin(e.target.value)}
                      placeholder="Ex: 1234"
                      className="block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    >
                      {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const pin = Math.floor(1000 + Math.random() * 9000).toString()
                      setCurrentPin(pin)
                      setShowPin(true)
                    }}
                    className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-xs font-bold rounded-md hover:bg-zinc-200 border border-zinc-200 dark:border-zinc-700"
                  >
                    Gerar PIN
                  </button>
                  <button
                    type="button"
                    onClick={sharePinWhatsApp}
                    disabled={!currentPin || currentPin === '****' || !currentTelefone}
                    className="p-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 disabled:bg-zinc-300 transition-colors shadow-sm flex items-center justify-center"
                    title="Enviar PIN via WhatsApp"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">Este PIN permitirá ao servidor consultar sua escala sem senha.</p>
              </div>
            </div>
          </div>

          {isSuperAdmin && (
            <div className="sm:col-span-6 space-y-4 pt-6 border-t border-zinc-100 dark:border-zinc-800 animate-in fade-in slide-in-from-top-2">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center">
                <div className="w-1.5 h-4 bg-yellow-500 rounded-full mr-2" />
                Configurações Especiais (Apenas Administrador Geral)
              </h3>
              <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 rounded-xl">
                <input
                  id="ignora_janela_presenca"
                  name="ignora_janela_presenca"
                  type="checkbox"
                  defaultChecked={servidor.ignora_janela_presenca}
                  className="mt-1 h-4 w-4 rounded border-zinc-300 text-yellow-600 focus:ring-yellow-500 dark:border-zinc-700 dark:bg-zinc-800"
                />
                <div>
                  <label htmlFor="ignora_janela_presenca" className="text-sm font-bold text-yellow-850 dark:text-yellow-300 block cursor-pointer">
                    Condição Especial (Horário Livre)
                  </label>
                  <span className="text-xs text-yellow-700 dark:text-yellow-400 block mt-1">
                    Permite que o servidor registre entrada e saída em qualquer horário, ignorando as restrições da janela de presença padrão, desde que esteja escalado para o dia.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>

        {/* Tab 2: Dados Complementares */}
        <div className={formTab === 'complementar' ? 'block animate-in fade-in' : 'hidden'}>
          <DadosComplementaresSection servidor={servidor} />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="pt-4">
          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center items-center rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-all disabled:opacity-50"
          >
            <Save className="mr-2 h-4 w-4" />
            {loading ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>
    </div>
  )
}
