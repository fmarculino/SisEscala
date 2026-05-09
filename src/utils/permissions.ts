import { PostgrestFilterBuilder } from '@supabase/postgrest-js'

export interface UserProfile {
  id: string
  role: 'super_admin' | 'admin' | 'coordenador' | 'servidor' | 'comum'
  acesso_todas_unidades: boolean
  acesso_todos_setores: boolean
  permitted_unidades: string[]
  permitted_setores: string[]
}

/**
 * Aplica filtros de segurança baseados no perfil do usuário a uma query do Supabase.
 * @param query A query do Supabase (ex: supabase.from('escalas').select('*'))
 * @param profile O perfil do usuário com as permissões carregadas
 * @param options Opções de campo (unidadeField, setorField)
 */
export function applyAccessFilters(
  query: any,
  profile: UserProfile | null,
  options: { 
    unidadeField?: string, 
    setorField?: string,
    bypassSuperAdmin?: boolean 
  } = {}
) {
  if (!profile) return query
  
  const { 
    unidadeField = 'unidade_id', 
    setorField = 'setor_id',
    bypassSuperAdmin = true 
  } = options

  // Super Admin tem acesso irrestrito
  if (bypassSuperAdmin && profile.role === 'super_admin') {
    return query
  }

  // 1. Caso: Acesso a todas as unidades (Admin/SuperAdmin geralmente)
  if (profile.acesso_todas_unidades) {
    if (profile.acesso_todos_setores) return query
    
    if (profile.permitted_setores.length > 0) {
      return query.in(setorField, profile.permitted_setores)
    }
    return query
  }

  // 2. Caso: Usuário tem unidades específicas (Herança de Unidade -> Setores)
  // REGRA: Somente ADMIN herda acesso a todos os setores de uma unidade vinculada.
  // COORDENADOR precisa estar vinculado ao setor especificamente para ver dados do setor.
  const isAdminOrSuper = profile.role === 'admin' || profile.role === 'super_admin'

  if (profile.permitted_unidades.length > 0) {
    if (isAdminOrSuper) {
      // Admin vê tudo da unidade OU setores extras
      if (profile.permitted_setores.length > 0) {
        return query.or(`${unidadeField}.in.(${profile.permitted_unidades.join(',')}),${setorField}.in.(${profile.permitted_setores.join(',')})`)
      }
      return query.in(unidadeField, profile.permitted_unidades)
    } else {
      // Coordenador (ou outros): Vê apenas os setores vinculados, 
      // mesmo que a unidade esteja vinculada (a unidade serve para filtros de UI e servidores)
      if (profile.permitted_setores.length > 0) {
        return query.in(setorField, profile.permitted_setores)
      }
      
      // Se não tem setores vinculados, mas tem unidade, e é coordenador:
      // Retorna vazio para escalas/setores, pois ele deve ser vinculado ao setor.
      return query.eq('id', '00000000-0000-0000-0000-000000000000')
    }
  }

  // 3. Caso: Apenas setores vinculados
  if (profile.permitted_setores.length > 0) {
    return query.in(setorField, profile.permitted_setores)
  }

  // Se não tem acesso a nada, retorna um filtro que não trará nada (segurança máxima)
  return query.eq('id', '00000000-0000-0000-0000-000000000000')
}

/**
 * Verifica se o usuário tem acesso a uma unidade específica.
 */
export function hasUnitAccess(profile: UserProfile | null, unidadeId: string) {
  if (!profile) return false
  if (profile.role === 'super_admin' || profile.acesso_todas_unidades) return true
  return profile.permitted_unidades.includes(unidadeId)
}

/**
 * Verifica se o usuário tem acesso a um setor específico.
 */
export function hasSectorAccess(profile: UserProfile | null, setorId: string, unidadeId?: string) {
  if (!profile) return false
  if (profile.role === 'super_admin' || profile.acesso_todos_setores) return true
  
  // Se tem acesso à unidade do setor, tem acesso ao setor (Herança)
  if (unidadeId && hasUnitAccess(profile, unidadeId)) return true
  
  return profile.permitted_setores.includes(setorId)
}
