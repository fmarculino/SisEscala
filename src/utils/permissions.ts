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
    setorField?: string | null,
    bypassSuperAdmin?: boolean 
  } = {}
) {
  if (!profile) return query
  
  // Detectar o nome da tabela a partir da URL da query para mapear os campos automaticamente
  let tableName = ''
  if (query && query.url) {
    const urlStr = typeof query.url === 'string' ? query.url : (query.url.pathname || query.url.href || String(query.url))
    const match = urlStr.match(/\/rest\/v1\/([^?\/]+)/)
    if (match) {
      tableName = match[1]
    }
  }

  // Mapeamento automático inteligente caso os campos não sejam fornecidos
  const detectedUnidadeField = tableName === 'unidades' ? 'id' : 'unidade_id'
  const detectedSetorField = tableName === 'unidades' ? null : (tableName === 'setores' ? 'id' : 'setor_id')

  const { 
    unidadeField = detectedUnidadeField, 
    setorField = detectedSetorField,
    bypassSuperAdmin = true 
  } = options

  // Super Admin tem acesso irrestrito
  if (bypassSuperAdmin && profile.role === 'super_admin') {
    return query
  }

  // Se setorField não estiver definido ou for nulo (ex: consultas na tabela de unidades)
  if (!setorField) {
    if (profile.role === 'super_admin' || profile.acesso_todas_unidades) {
      return query
    }
    if (profile.permitted_unidades.length > 0) {
      return query.in(unidadeField, profile.permitted_unidades)
    }
    return query.eq('id', '00000000-0000-0000-0000-000000000000')
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
  // COORDENADOR precisa estar vinculado ao setor especificamente para ver dados do setor,
  // a menos que ele tenha acesso total aos setores (acesso_todos_setores = true).
  const isAdminOrSuper = profile.role === 'admin' || profile.role === 'super_admin'
  const isAdminOrSuperOrAllSectors = isAdminOrSuper || profile.acesso_todos_setores

  if (profile.permitted_unidades.length > 0) {
    if (isAdminOrSuperOrAllSectors) {
      // Admin ou usuário com acesso total a setores vê tudo da unidade OU setores extras
      if (profile.permitted_setores.length > 0) {
        return query.or(`${unidadeField}.in.(${profile.permitted_unidades.join(',')}),${setorField}.in.(${profile.permitted_setores.join(',')})`)
      }
      return query.in(unidadeField, profile.permitted_unidades)
    } else {
      // Coordenador (ou outros) sem acesso total a setores: Vê apenas os setores vinculados, 
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
  if (profile.role === 'super_admin') return true
  
  // Se tem acesso a todos os setores globalmente (todas as unidades)
  if (profile.acesso_todos_setores && profile.acesso_todas_unidades) return true
  
  // Se o usuário tem acesso total aos setores da sua unidade, ele tem acesso a qualquer setor da unidade à qual ele tem acesso
  if (profile.acesso_todos_setores && unidadeId && hasUnitAccess(profile, unidadeId)) return true

  // Se tem acesso à unidade do setor e é admin, tem acesso a todos os setores da unidade (Herança de admin)
  if (profile.role === 'admin' && unidadeId && hasUnitAccess(profile, unidadeId)) return true
  
  // Caso contrário, precisa estar explicitamente listado nos setores permitidos
  return profile.permitted_setores.includes(setorId)
}
