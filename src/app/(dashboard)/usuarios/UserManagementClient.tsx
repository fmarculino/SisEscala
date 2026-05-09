'use client'

import { useState, useEffect } from 'react'
import { Users, Plus, Shield, Building2, Pencil, X, Mail, Key, Check, AlertCircle, Loader2, GitBranch, Trash2, Power, PowerOff } from 'lucide-react'
import { createUser, updateUser, resetPassword, deleteUser, toggleUserStatus } from './actions'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { ROLE_LABELS, getRoleLabel } from '@/utils/roles'

interface UserManagementClientProps {
  initialProfiles: any[]
  unidades: any[]
  setores: any[]
  currentUserRole: string
}

export default function UserManagementClient({
  initialProfiles,
  unidades,
  setores,
  currentUserRole
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

  const handleEdit = (user: any) => {
    setEditingUser(user)
    setSelectedUnidades(user.permitted_unidades || [])
    setSelectedSetores(user.permitted_setores || [])
    setAcessoTodasUnidades(user.acesso_todas_unidades || false)
    setAcessoTodosSetores(user.acesso_todos_setores || false)
    setResetStatus(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancel = () => {
    setEditingUser(null)
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

  const handleSubmit = async (formData: FormData) => {
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

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Nome Completo</label>
                <input 
                  required 
                  type="text" 
                  name="full_name" 
                  defaultValue={editingUser?.full_name || ''}
                  key={editingUser?.id + '-name'}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800" 
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                <input 
                  required 
                  type="email" 
                  name="email" 
                  defaultValue={editingUser?.email || ''}
                  disabled={!!editingUser}
                  key={editingUser?.id + '-email'}
                  className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 px-3 text-sm focus:border-blue-500 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed" 
                />
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
                  <div className="mt-1 max-h-32 overflow-y-auto p-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-zinc-50 dark:bg-zinc-800/50 space-y-1">
                    {setores
                      .filter(s => selectedUnidades.length === 0 || selectedUnidades.includes(s.unidade_id))
                      .map(s => (
                        <label key={s.id} className="flex items-center p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded cursor-pointer text-xs">
                          <input 
                            type="checkbox"
                            className="mr-2 h-3.5 w-3.5 rounded text-blue-600 border-zinc-300"
                            checked={selectedSetores.includes(s.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedSetores([...selectedSetores, s.id])
                              else setSelectedSetores(selectedSetores.filter(id => id !== s.id))
                            }}
                          />
                          <span className="flex flex-col">
                            <span>{s.nome}</span>
                            <span className="text-[10px] text-zinc-400">{unidades.find(u => u.id === s.unidade_id)?.nome}</span>
                          </span>
                        </label>
                      ))}
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
                  disabled={isLoading}
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
            
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {initialProfiles?.map((p) => (
                <div key={p.id} className="p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between group">
                  <div className="flex items-center space-x-4">
                    <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold">
                      {p.full_name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <div className={`h-2 w-2 rounded-full ${p.ativo ? 'bg-green-500' : 'bg-red-500'}`} />
                        <h3 className={`text-sm font-medium text-zinc-900 dark:text-white ${!p.ativo ? 'opacity-50' : ''}`}>{p.full_name || 'Sem nome'}</h3>
                      </div>
                      <div className="flex items-center flex-wrap gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        <Shield className="mr-1 h-3 w-3" />
                        <span className="uppercase">{getRoleLabel(p.role)}</span>
                        
                        {p.isOrphaned && (
                          <span className="ml-2 bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200 animate-pulse">
                            CONFLITO DE CADASTRO (ÓRFÃO)
                          </span>
                        )}
                        
                        {(p.acesso_todas_unidades || p.unidades_nomes?.length > 0) && (
                          <>
                            <span className="mx-2">•</span>
                            <Building2 className="mr-1 h-3 w-3" />
                            {p.acesso_todas_unidades ? (
                              <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-blue-100">TODAS UNIDADES</span>
                            ) : (
                              <span className="truncate max-w-[150px]">{p.unidades_nomes.join(', ')}</span>
                            )}
                          </>
                        )}
                        
                        {(p.acesso_todos_setores || p.setores_nomes?.length > 0) && (
                          <>
                            <span className="mx-2">•</span>
                            <GitBranch className="mr-1 h-3 w-3" />
                            {p.acesso_todos_setores ? (
                              <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-purple-100">TODOS SETORES</span>
                            ) : (
                              <span className="truncate max-w-[150px]">{p.setores_nomes.join(', ')}</span>
                            )}
                          </>
                        )}

                        <span className="mx-2">•</span>
                        <Mail className="mr-1 h-3 w-3" />
                        {p.email}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
