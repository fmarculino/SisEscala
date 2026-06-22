'use client'

import { useState, useMemo } from 'react'
import { Save, User, Layers, Eye, EyeOff, MessageCircle, Info } from 'lucide-react'
import { updateServidor } from '../actions'

interface EditServidorFormProps {
  id: string
  servidor: any
  unidades: any[]
  setores: any[]
  cargos: any[]
  isSuperAdmin?: boolean
}

export function EditServidorForm({ id, servidor, unidades, setores, cargos, isSuperAdmin = false }: EditServidorFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedUnidade, setSelectedUnidade] = useState(servidor.unidade_id || '')
  const [selectedSetor, setSelectedSetor] = useState(servidor.setor_id || '')

  const isLotaçãoChanged = selectedUnidade !== (servidor.unidade_id || '') || selectedSetor !== (servidor.setor_id || '')

  const isTemporary = servidor.matricula ? /^T\d{7}$/.test(servidor.matricula) : false

  // Parsing existing cargo string (Level 1 / Level 2 / Level 3)
  const existingCargoParts = servidor.cargo ? servidor.cargo.split(' / ') : []
  
  // Find initial IDs based on names from existing string
  const initialNivel1 = cargos.find(c => c.nivel === 1 && c.nome === existingCargoParts[0])?.id || ''
  const initialNivel2 = cargos.find(c => c.nivel === 2 && c.nome === existingCargoParts[1] && c.parent_id === initialNivel1)?.id || ''
  const initialNivel3 = cargos.find(c => c.nivel === 3 && c.nome === existingCargoParts[2] && c.parent_id === initialNivel2)?.id || ''

  const [nivel1, setNivel1] = useState(initialNivel1)
  const [nivel2, setNivel2] = useState(initialNivel2)
  const [nivel3, setNivel3] = useState(initialNivel3)

  const filteredSetores = selectedUnidade 
    ? setores.filter(s => s.unidade_id === selectedUnidade)
    : setores

  // Lógica de filtragem de cargos (Mostra ativos + o atual caso esteja inativo)
  const cargosNivel1 = useMemo(() => cargos.filter(c => c.nivel === 1 && (c.ativo || c.id === nivel1)), [cargos, nivel1])
  const cargosNivel2 = useMemo(() => cargos.filter(c => c.nivel === 2 && c.parent_id === nivel1 && (c.ativo || c.id === nivel2)), [cargos, nivel1, nivel2])
  const cargosNivel3 = useMemo(() => cargos.filter(c => c.nivel === 3 && c.parent_id === nivel2 && (c.ativo || c.id === nivel3)), [cargos, nivel2, nivel3])

  const cargoFinal = useMemo(() => {
    const c1 = cargos.find(c => c.id === nivel1)?.nome || ''
    const c2 = cargos.find(c => c.id === nivel2)?.nome || ''
    const c3 = cargos.find(c => c.id === nivel3)?.nome || ''
    
    return [c1, c2, c3].filter(Boolean).join(' / ')
  }, [cargos, nivel1, nivel2, nivel3])

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

  return (
    <div className="rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center space-x-4 mb-6">
        <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20 text-blue-600">
          <User className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold">Editar Servidor: {servidor.nome}</h1>
      </div>
      
      <form action={handleSubmit} className="space-y-6">
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
              <Layers className="h-4 w-4" />
              Hierarquia de Cargo
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase mb-1">Nível 1 (Categoria)</label>
                <select
                  value={nivel1}
                  onChange={(e) => {
                    setNivel1(e.target.value)
                    setNivel2('')
                    setNivel3('')
                  }}
                  required
                  className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500"
                >
                  <option value="">Selecione...</option>
                  {cargosNivel1.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase mb-1">Nível 2 (Especialidade)</label>
                <select
                  value={nivel2}
                  onChange={(e) => {
                    setNivel2(e.target.value)
                    setNivel3('')
                  }}
                  disabled={!nivel1}
                  className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">Selecione...</option>
                  {cargosNivel2.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase mb-1">Nível 3 (Sub-especialidade)</label>
                <select
                  value={nivel3}
                  onChange={(e) => setNivel3(e.target.value)}
                  disabled={!nivel2}
                  className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">Selecione...</option>
                  {cargosNivel3.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
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
