'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Users, Plus, Shield, Building2, Pencil, X, Mail, Key, Check, AlertCircle, Loader2, GitBranch, Trash2, Power, PowerOff, Search, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { createUser, updateUser, resetPassword, deleteUser, toggleUserStatus } from './actions'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { ROLE_LABELS, getRoleLabel } from '@/utils/roles'

interface UserManagementClientProps {
  initialProfiles: any[]
  unidades: any[]
  setores: any[]
  currentUserRole: string
  servidores: any[]
}

export default function UserManagementClient({
  initialProfiles,
  unidades,
  setores,
  currentUserRole,
  servidores
}: UserManagementClientProps) {
  const router = useRouter()
  const [editingUser, setEditingUser] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [resetStatus, setResetStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  
  // Password Reset Modal State
  const [showResetModal, setShowResetModal] = useState(false)
  const [newPassword, setNewPassword] = useState('sisEscala2026')
  
  // Alert Modal State
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean, title: string, message: string, type: 'default' | 'danger' | 'success' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'default'
  })
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null)

  const [selectedUnidades, setSelectedUnidades] = useState<string[]>([])
  const [selectedSetores, setSelectedSetores] = useState<string[]>([])
  const [acessoTodasUnidades, setAcessoTodasUnidades] = useState(false)
  const [acessoTodosSetores, setAcessoTodosSetores] = useState(false)

  // Form input field states
  const [formFullName, setFormFullName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [selectedServidor, setSelectedServidor] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Filters for User List
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterUnidade, setFilterUnidade] = useState('')
  const [filterSetor, setFilterSetor] = useState('')

  // Pagination for User List
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // Click outside listener for searchable dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleEdit = (user: any) => {
    setEditingUser(user)
    setFormFullName(user.full_name || '')
    setFormEmail(user.email || '')
    setSelectedUnidades(user.permitted_unidades || [])
    setSelectedSetores(user.permitted_setores || [])
    setAcessoTodasUnidades(user.acesso_todas_unidades || false)
    setAcessoTodosSetores(user.acesso_todos_setores || false)
    setResetStatus(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancel = () => {
    setEditingUser(null)
    setFormFullName('')
    setFormEmail('')
    setSelectedServidor('')
    setSearchTerm('')
    setIsDropdownOpen(false)
    setSelectedUnidades([])
    setSelectedSetores([])
    setAcessoTodasUnidades(false)
    setAcessoTodosSetores(false)
    setResetStatus(null)
  }

  const handleResetPassword = async () => {
    if (!editingUser) return
    
    if (newPassword.length < 6) {
      setAlertModal({
        isOpen: true,
        title: 'Senha Curta',
        message: 'A senha deve ter pelo menos 6 caracteres.',
        type: 'danger'
      })
      return
    }

    setIsLoading(true)
    try {
      const result = await resetPassword(editingUser.id, newPassword)
      if (result.success) {
        setResetStatus({ type: 'success', message: 'Senha redefinida com sucesso!' })
        setShowResetModal(false)
      } else {
        setAlertModal({
          isOpen: true,
          title: 'Erro na Redefinição',
          message: result.error || 'Não foi possível redefinir a senha.',
          type: 'danger'
        })
      }
    } catch (error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro Inesperado',
        message: 'Ocorreu um erro ao processar sua solicitação.',
        type: 'danger'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleStatus = async (user: any) => {
    const action = user.ativo ? 'inativar' : 'ativar'
    setConfirmModal({
      isOpen: true,
      title: user.ativo ? 'Inativar Usuário' : 'Reativar Usuário',
      message: `Deseja realmente ${action} o acesso de ${user.full_name}?`,
      onConfirm: async () => {
        setIsLoading(true)
        try {
          const result = await toggleUserStatus(user.id, user.ativo)
          if (result.success) {
            setConfirmModal(null)
            router.refresh()
          } else {
            setAlertModal({
              isOpen: true,
              title: 'Erro',
              message: result.error || 'Erro ao alterar status.',
              type: 'danger'
            })
          }
        } catch (error) {
          setAlertModal({
            isOpen: true,
            title: 'Erro',
            message: 'Erro inesperado.',
            type: 'danger'
          })
        } finally {
          setIsLoading(false)
        }
      }
    })
  }

  const startDelete = (user: any) => {
    setConfirmModal({
      isOpen: true,
      title: 'Excluir Usuário',
      message: `Você está prestes a excluir o acesso de ${user.full_name} (${user.email}). Esta ação é irreversível e removerá o usuário do sistema de autenticação e do banco de dados. Deseja continuar?`,
      onConfirm: () => confirmDelete(user.id)
    })
  }

  const confirmDelete = async (userId: string) => {
    setIsLoading(true)
    try {
      const result = await deleteUser(userId)
      if (result.success) {
        setConfirmModal(null)
        router.refresh()
      } else {
        setAlertModal({
          isOpen: true,
          title: 'Erro na Exclusão',
          message: result.error || 'Não foi possível excluir o usuário.',
          type: 'danger'
        })
      }
    } catch (error) {
      setAlertModal({
        isOpen: true,
        title: 'Erro Inesperado',
        message: 'Ocorreu um erro ao excluir o usuário.',
        type: 'danger'
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [userSearchTerm, filterRole, filterUnidade, filterSetor])

  // Filter sectors based on selected unit for search filter dropdown
  const filteredSetoresOptions = useMemo(() => {
    if (!filterUnidade) return setores
    return setores.filter(s => s.unidade_id === filterUnidade)
  }, [filterUnidade, setores])

  // Filter profiles based on search and selected options
  const filteredProfiles = useMemo(() => {
    return initialProfiles.filter(p => {
      const cleanSearch = userSearchTerm.toLowerCase().trim()
      const matchesSearch = !cleanSearch || 
        p.full_name?.toLowerCase().includes(cleanSearch) || 
        p.email?.toLowerCase().includes(cleanSearch)

      const matchesRole = !filterRole || p.role === filterRole

      const matchesUnidade = !filterUnidade || p.acesso_todas_unidades || p.permitted_unidades?.includes(filterUnidade)

      const matchesSetor = !filterSetor || (() => {
        if (p.acesso_todos_setores || p.acesso_todas_unidades) return true
        if (p.permitted_setores?.includes(filterSetor)) return true
        const sectorObj = setores.find(s => s.id === filterSetor)
        if (sectorObj && p.permitted_unidades?.includes(sectorObj.unidade_id)) return true
        return false
      })()

      return matchesSearch && matchesRole && matchesUnidade && matchesSetor
    })
  }, [initialProfiles, userSearchTerm, filterRole, filterUnidade, filterSetor, setores])

  const totalCount = filteredProfiles.length
  const totalPages = Math.ceil(totalCount / pageSize)

  const paginatedProfiles = useMemo(() => {
    const from = (page - 1) * pageSize
    const to = from + pageSize
    return filteredProfiles.slice(from, to)
  }, [filteredProfiles, page, pageSize])

  const isEmailDuplicate = useMemo(() => {
    if (editingUser) return false
    if (!formEmail.trim()) return false
    return initialProfiles.some(p => p.email.toLowerCase() === formEmail.trim().toLowerCase())
  }, [formEmail, initialProfiles, editingUser])

  const handleSubmit = async (formData: FormData) => {
    if (isEmailDuplicate) return
    setIsLoading(true)
    try {
      if (editingUser) {
        formData.append('userId', editingUser.id)
        const result = await updateUser(formData)
        if (result.error) {
           setAlertModal({
             isOpen: true,
             title: 'Erro na Atualização',
             message: result.error,
             type: 'danger'
           })
           return
        }
        setEditingUser(null)
        setFormFullName('')
        setFormEmail('')
        setSelectedServidor('')
        setSearchTerm('')
        setIsDropdownOpen(false)
      } else {
        const result = await createUser(formData)
        if (result.error) {
           setAlertModal({
             isOpen: true,
             title: 'Erro no Cadastro',
             message: result.error,
             type: 'danger'
           })
           return
        }
        setFormFullName('')
        setFormEmail('')
        setSelectedServidor('')
        setSearchTerm('')
        setIsDropdownOpen(false)
      }
      router.refresh()
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const getFilteredSetores = (unidadeId: string | null) => {
    if (!unidadeId) return []
    return setores.filter(s => s.unidade_id === unidadeId)
  }

  // Organizar setores em estrutura de árvore por unidade
  const setoresTree = useMemo(() => {
    const tree: Record<string, any[]> = {}
    
    unidades.forEach(u => {
      const unitSetores = setores.filter(s => s.unidade_id === u.id)
      const sectorMap: Record<string, any> = {}
      const rootSectors: any[] = []
      
      unitSetores.forEach(s => {
        sectorMap[s.id] = { ...s, children: [] }
      })
      
      unitSetores.forEach(s => {
        if (s.parent_id && sectorMap[s.parent_id]) {
          sectorMap[s.parent_id].children.push(sectorMap[s.id])
        } else {
          rootSectors.push(sectorMap[s.id])
        }
      })
      tree[u.id] = rootSectors
    })
    return tree
  }, [setores, unidades])

  // Filtered servidores based on search input (checks name, email, matricula, and cpf)
  const filteredServidores = useMemo(() => {
    const normalizeStr = (str: string) => {
      if (!str) return ''
      return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    }
    const term = normalizeStr(searchTerm).replace(/[.\-/]/g, '').trim()
    if (!term) return servidores

    return servidores.filter(s => {
      const normNome = normalizeStr(s.nome || '')
      const normMatricula = normalizeStr(s.matricula || '')
      const normCpf = normalizeStr(s.cpf || '').replace(/[.\-/]/g, '')
      const normEmail = normalizeStr(s.email || '')
      return normNome.includes(term) || 
             normMatricula.includes(term) || 
             normCpf.includes(term) ||
             normEmail.includes(term)
    })
  }, [servidores, searchTerm])

  const toggleSectorRecursive = (sector: any, checked: boolean) => {
    let newSelected = [...selectedSetores]
    
    const collectIds = (s: any, ids: string[]) => {
      ids.push(s.id)
      s.children?.forEach((child: any) => collectIds(child, ids))
    }
    
    const idsToToggle: string[] = []
    collectIds(sector, idsToToggle)
    
    if (checked) {
      idsToToggle.forEach(id => {
        if (!newSelected.includes(id)) newSelected.push(id)
      })
    } else {
      newSelected = newSelected.filter(id => !idsToToggle.includes(id))
    }
    
    setSelectedSetores(newSelected)
  }

  const renderSectorTree = (sectors: any[], level = 0) => {
    return sectors.map(s => {
      const hasChildren = s.children && s.children.length > 0
      const isChecked = selectedSetores.includes(s.id)
      
      return (
        <div key={s.id} className="space-y-1">
          <label 
            className={`flex items-center p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded cursor-pointer transition-colors ${isChecked ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
            style={{ marginLeft: `${level * 1.25}rem` }}
          >
            <input 
              type="checkbox"
              className="mr-2 h-4 w-4 rounded text-blue-600 border-zinc-300 focus:ring-blue-500"
              checked={isChecked}
              onChange={(e) => toggleSectorRecursive(s, e.target.checked)}
            />
            <div className="flex flex-col">
              <span className={`text-[11px] font-bold uppercase tracking-tight ${isChecked ? 'text-blue-700 dark:text-blue-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                {s.nome}
              </span>
              {hasChildren && (
                <span className="text-[8px] text-zinc-400 uppercase tracking-widest leading-none">
                  Contém subdivisões
                </span>
              )}
            </div>
          </label>
          {hasChildren && renderSectorTree(s.children, level + 1)}
        </div>
      )
    })
  }

  return (
    <div className="space-y-8">
      {/* Modal de Redefinição de Senha */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="Redefinir Senha"
        type="warning"
        footer={
          <>
            <button
              onClick={() => setShowResetModal(false)}
              className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
            >
              Cancelar
            </button>
            <button
              onClick={handleResetPassword}
              disabled={isLoading || newPassword.length < 6}
              className="flex-1 px-4 py-2 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Redefinir Agora'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Você está prestes a redefinir a senha do usuário <strong>{editingUser?.full_name}</strong>.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase">Nova Senha:</label>
            <input 
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Modal de Alerta Genérico */}
      <Modal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
        title={alertModal.title}
        type={alertModal.type as any}
        footer={
          <button
            onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
            className="w-full px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-bold"
          >
            Entendido
          </button>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{alertModal.message}</p>
      </Modal>

      {/* Modal de Confirmação */}
      {confirmModal && (
        <Modal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal(null)}
          title={confirmModal.title}
          type="danger"
          footer={
            <>
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={confirmModal.onConfirm}
                disabled={isLoading}
                className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar Exclusão'}
              </button>
            </>
          }
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{confirmModal.message}</p>
        </Modal>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulário */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden sticky top-8">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
              <h2 className="text-lg font-semibold flex items-center justify-between">
                <span className="flex items-center">
                  {editingUser ? (
                    <Pencil className="mr-2 h-5 w-5 text-blue-600" />
                  ) : (
                    <Plus className="mr-2 h-5 w-5 text-blue-600" />
                  )}
                  {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
                </span>
                {editingUser && (
                  <button 
                    onClick={handleCancel}
                    className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </h2>
            </div>
            
            <form action={handleSubmit} className="p-6 space-y-4">
              {resetStatus && (
                <div className={`p-3 rounded-lg flex items-start space-x-2 text-sm ${
                  resetStatus.type === 'success' 
                    ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' 
                    : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
                }`}>
                  {resetStatus.type === 'success' ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span>{resetStatus.message}</span>
                </div>
              )}

              {!editingUser && (
                <div className="relative" ref={dropdownRef}>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Vincular a Servidor existente (Opcional)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Pesquisar por nome, matrícula ou CPF..."
                      value={searchTerm}
                      onFocus={() => setIsDropdownOpen(true)}
                      onChange={(e) => {
                        setSearchTerm(e.target.value)
                        setIsDropdownOpen(true)
                        if (selectedServidor) {
                          setSelectedServidor('')
                          setFormFullName(e.target.value)
                        } else {
                          setFormFullName(e.target.value)
                        }
                      }}
                      className="w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 pl-3 pr-10 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 outline-none"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <Search className="h-4 w-4 text-zinc-400" />
                    </div>
                  </div>

                  <input type="hidden" name="servidor_id" value={selectedServidor} />

                  {isDropdownOpen && (
                    <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:bg-zinc-800 dark:ring-zinc-700 sm:text-sm">
                      {filteredServidores.length === 0 ? (
                        <div className="relative cursor-default select-none py-2 px-4 text-zinc-500 dark:text-zinc-400">
                          Nenhum servidor encontrado.
                        </div>
                      ) : (
                        filteredServidores.map((s) => {
                          const isSelected = selectedServidor === s.id
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setSelectedServidor(s.id)
                                setSearchTerm(s.nome)
                                setFormFullName(s.nome || '')
                                setFormEmail(s.email || '')
                                setIsDropdownOpen(false)
                              }}
                              className={`relative w-full text-left cursor-pointer select-none py-2.5 pl-3 pr-9 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${
                                isSelected ? 'bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200' : 'text-zinc-900 dark:text-zinc-100'
                              }`}
                            >
                              <div className="font-semibold text-sm truncate">{s.nome}</div>
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-wrap gap-x-2 mt-0.5">
                                {s.email && <span className="truncate">{s.email}</span>}
                                {s.matricula && <span>• Matrícula: {s.matricula}</span>}
                                {s.cpf && <span>• CPF: {s.cpf}</span>}
                              </div>
                              {isSelected && (
                                <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-blue-600 dark:text-blue-400">
                                  <Check className="h-4 w-4" />
                                </span>
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}

                  {selectedServidor && (
                    <div className="mt-1 flex items-center justify-between text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 p-2 rounded-md border border-blue-100 dark:border-blue-900/30">
                      <span className="truncate">
                        Vinculado a: <strong>{servidores.find(s => s.id === selectedServidor)?.nome}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedServidor('')
                          setSearchTerm('')
                          setFormFullName('')
                          setFormEmail('')
                        }}
                        className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 ml-2"
                        title="Desvincular servidor"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nome Completo</label>
                <input 
                  required 
                  type="text" 
                  name="full_name" 
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800" 
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                <input 
                  required 
                  type="email" 
                  name="email" 
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  disabled={!!editingUser}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed" 
                />
                {isEmailDuplicate && (
                  <p className="mt-1.5 text-xs font-bold text-red-500 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Este e-mail já possui um usuário cadastrado no sistema.
                  </p>
                )}
                {editingUser && (
                  <p className="mt-1 text-xs text-zinc-500 italic">O email não pode ser alterado.</p>
                )}
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Senha Padrão</label>
                  <input required type="text" name="password" defaultValue="sisEscala2026" className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800" />
                </div>
              )}

              {/* Hidden Inputs para Multi-Seleção */}
              {acessoTodasUnidades ? (
                <input type="hidden" name="acesso_todas_unidades" value="true" />
              ) : (
                selectedUnidades.map(id => <input key={id} type="hidden" name="unidade_ids" value={id} />)
              )}
              
              {acessoTodosSetores ? (
                <input type="hidden" name="acesso_todos_setores" value="true" />
              ) : (
                selectedSetores.map(id => <input key={id} type="hidden" name="setor_ids" value={id} />)
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nível de Acesso</label>
                <select 
                  required 
                  name="role" 
                  defaultValue={editingUser?.role || 'coordenador'}
                  key={editingUser?.id + '-role'}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <option value="coordenador">{ROLE_LABELS.coordenador}</option>
                  <option value="admin">{ROLE_LABELS.admin}</option>
                  {currentUserRole === 'super_admin' && <option value="super_admin">{ROLE_LABELS.super_admin}</option>}
                </select>
              </div>

              {/* Unidades Vinculadas */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Unidades Vinculadas</label>
                  <label className="flex items-center text-xs text-zinc-500 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="mr-1 h-3 w-3 rounded border-zinc-300" 
                      checked={acessoTodasUnidades}
                      onChange={(e) => {
                        setAcessoTodasUnidades(e.target.checked)
                        if (e.target.checked) setSelectedUnidades([])
                      }}
                    />
                    Acesso Total
                  </label>
                </div>
                
                {!acessoTodasUnidades && (
                  <div className="mt-1 max-h-32 overflow-y-auto p-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-zinc-50 dark:bg-zinc-800/50 space-y-1">
                    {unidades?.map(u => (
                      <label key={u.id} className="flex items-center p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded cursor-pointer text-xs">
                        <input 
                          type="checkbox"
                          className="mr-2 h-3.5 w-3.5 rounded text-blue-600 border-zinc-300"
                          checked={selectedUnidades.includes(u.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedUnidades([...selectedUnidades, u.id])
                            else setSelectedUnidades(selectedUnidades.filter(id => id !== u.id))
                          }}
                        />
                        {u.nome}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Setores Vinculados */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Setores Específicos</label>
                  <label className="flex items-center text-xs text-zinc-500 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="mr-1 h-3 w-3 rounded border-zinc-300" 
                      checked={acessoTodosSetores}
                      onChange={(e) => {
                        setAcessoTodosSetores(e.target.checked)
                        if (e.target.checked) setSelectedSetores([])
                      }}
                    />
                    Acesso Total
                  </label>
                </div>
                
                {!acessoTodosSetores && (
                  <div className="mt-1 max-h-64 overflow-y-auto p-3 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 space-y-4">
                    {unidades
                      .filter(u => selectedUnidades.length === 0 || selectedUnidades.includes(u.id))
                      .map(u => {
                        const unitTree = setoresTree[u.id] || []
                        if (unitTree.length === 0) return null
                        
                        return (
                          <div key={u.id} className="space-y-2 border-b border-zinc-200 dark:border-zinc-800 last:border-0 pb-3">
                            <div className="flex items-center text-[10px] font-black uppercase text-zinc-400 tracking-widest bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                              <Building2 className="h-3 w-3 mr-1" />
                              {u.nome}
                            </div>
                            <div className="space-y-1">
                              {renderSectorTree(unitTree)}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
                <p className="text-[10px] text-zinc-500 italic">
                  * Vincular a uma unidade garante acesso a todos os setores dela automaticamente.
                </p>
              </div>

              {editingUser && (
                <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowResetModal(true)}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center space-x-2 py-2 px-4 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  >
                    <Key className="h-4 w-4" />
                    <span>Redefinir Senha do Usuário</span>
                  </button>
                  <p className="mt-1 text-[10px] text-zinc-500 text-center">
                    Use esta opção se o usuário esqueceu a senha ou perdeu acesso ao email.
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                {editingUser && (
                  <button 
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 flex justify-center rounded-md border border-zinc-300 dark:border-zinc-700 py-2 px-4 text-sm font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Cancelar
                  </button>
                )}
                <button 
                  type="submit" 
                  disabled={isLoading || isEmailDuplicate}
                  className="flex-1 flex justify-center rounded-md bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {isLoading ? 'Salvando...' : editingUser ? 'Salvar Alterações' : 'Cadastrar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Lista de Usuários */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
              <h2 className="text-lg font-semibold flex items-center">
                <Users className="mr-2 h-5 w-5 text-blue-600" />
                Usuários Cadastrados
              </h2>
            </div>

            {/* Filtros de Pesquisa */}
            <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/20 border-b border-zinc-200 dark:border-zinc-800/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Buscar por nome ou email..."
                  value={userSearchTerm}
                  onChange={(e) => setUserSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                <option value="">Todos os Níveis de Acesso</option>
                <option value="coordenador">{ROLE_LABELS.coordenador}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
                <option value="super_admin">{ROLE_LABELS.super_admin}</option>
              </select>

              <select
                value={filterUnidade}
                onChange={(e) => {
                  setFilterUnidade(e.target.value)
                  setFilterSetor('') // Reset sector when unit changes
                }}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                <option value="">Todas as Unidades</option>
                {unidades.map(u => (
                  <option key={u.id} value={u.id}>{u.nome}</option>
                ))}
              </select>

              <div className="flex gap-2">
                <select
                  value={filterSetor}
                  onChange={(e) => setFilterSetor(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                >
                  <option value="">Todos os Setores</option>
                  {filteredSetoresOptions.map(s => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>

                {(userSearchTerm || filterRole || filterUnidade || filterSetor) && (
                  <button
                    onClick={() => {
                      setUserSearchTerm('')
                      setFilterRole('')
                      setFilterUnidade('')
                      setFilterSetor('')
                    }}
                    className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-300 transition-colors shrink-0"
                    title="Limpar Filtros"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>
            
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {paginatedProfiles.length === 0 ? (
                <div className="p-12 text-center select-none">
                  <Users className="mx-auto h-12 w-12 text-zinc-300 dark:text-zinc-600" />
                  <h3 className="mt-4 text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Nenhum usuário encontrado</h3>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Experimente ajustar os filtros ou o termo de busca.
                  </p>
                </div>
              ) : (
                paginatedProfiles.map((p) => (
                  <div key={p.id} className="p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between group">
                    <div className="flex items-center space-x-4 min-w-0 flex-1">
                      <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold shrink-0">
                        {p.full_name?.charAt(0).toUpperCase() || 'U'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${p.ativo ? 'bg-green-500' : 'bg-red-500'}`} />
                          <h3 className={`text-sm font-medium text-zinc-900 dark:text-white truncate ${!p.ativo ? 'opacity-50' : ''}`}>{p.full_name || 'Sem nome'}</h3>
                        </div>
                        <div className="flex items-center flex-wrap gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                          <Shield className="mr-1 h-3 w-3 shrink-0" />
                          <span className="uppercase shrink-0">{getRoleLabel(p.role)}</span>
                          
                          {p.isOrphaned && (
                            <span className="ml-2 bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200 animate-pulse shrink-0">
                              CONFLITO DE CADASTRO (ÓRFÃO)
                            </span>
                          )}
                          
                          {(p.acesso_todas_unidades || p.unidades_nomes?.length > 0) && (
                            <>
                              <span className="mx-2">•</span>
                              <Building2 className="mr-1 h-3 w-3 shrink-0" />
                              {p.acesso_todas_unidades ? (
                                <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-blue-100 shrink-0">TODAS UNIDADES</span>
                              ) : (
                                <span className="truncate max-w-[150px]">{p.unidades_nomes.join(', ')}</span>
                              )}
                            </>
                          )}
                          
                          {(p.acesso_todos_setores || p.setores_nomes?.length > 0) && (
                            <>
                              <span className="mx-2">•</span>
                              <GitBranch className="mr-1 h-3 w-3 shrink-0" />
                              {p.acesso_todos_setores ? (
                                <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-purple-100 shrink-0">TODOS SETORES</span>
                              ) : (
                                <span className="truncate max-w-[150px]">{p.setores_nomes.join(', ')}</span>
                              )}
                            </>
                          )}

                          <span className="mx-2">•</span>
                          <Mail className="mr-1 h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[150px] sm:max-w-none">{p.email}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">
                      <button
                        onClick={() => handleEdit(p)}
                        className="p-2 text-zinc-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
                        title="Editar usuário"
                      >
                        <Pencil className="h-5 w-5" />
                      </button>
                      
                      {p.isOrphaned && currentUserRole === 'super_admin' ? (
                        <button
                          onClick={() => startDelete(p)}
                          className="p-2 text-zinc-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400"
                          title="Excluir cadastro órfão"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      ) : (
                        currentUserRole === 'super_admin' && (
                          <button
                            onClick={() => handleToggleStatus(p)}
                            className={`p-2 ${p.ativo ? 'text-zinc-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400' : 'text-green-500 hover:text-green-600'}`}
                            title={p.ativo ? 'Inativar usuário' : 'Ativar usuário'}
                          >
                            {p.ativo ? <Power className="h-5 w-5" /> : <PowerOff className="h-5 w-5" />}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Paginação */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-zinc-50/50 dark:bg-zinc-800/20 border-t border-zinc-100 dark:border-zinc-800/80 print:hidden select-none">
              <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                Mostrando <span className="text-zinc-800 dark:text-zinc-200">{totalCount === 0 ? 0 : (page - 1) * pageSize + 1}</span> - <span className="text-zinc-800 dark:text-zinc-200">{Math.min(page * pageSize, totalCount)}</span> de <span className="text-zinc-800 dark:text-zinc-200">{totalCount}</span> registros
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Exibir</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer shadow-sm hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
                >
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button 
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
                  title="Primeira página"
                >
                  <ChevronsLeft className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                </button>
                <button 
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
                  title="Página anterior"
                >
                  <ChevronLeft className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                </button>
                
                <div className="bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 rounded-full px-4 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 min-w-[70px] text-center shadow-sm">
                  {page} <span className="text-zinc-400 dark:text-zinc-500 text-[10px] font-normal mx-1">DE</span> {totalPages || 1}
                </div>

                <button 
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || totalPages === 0}
                  className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
                  title="Próxima página"
                >
                  <ChevronRight className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                </button>
                <button 
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages || totalPages === 0}
                  className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-zinc-900 transition-all shadow-sm"
                  title="Última página"
                >
                  <ChevronsRight className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
