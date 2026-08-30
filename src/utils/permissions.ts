import { PostgrestFilterBuilder } from '@supabase/postgrest-js'

export interface UserProfile {
  id: string
  role: 'super_admin' | 'rh' | 'rh_unidade' | 'admin' | 'coordenador' | 'ass_adm' | 'servidor' | 'comum'
  acesso_todas_unidades: boolean
  acesso_todos_setores: boolean
  permitted_unidades: string[]
  permitted_setores: string[]
}

/** Id impossível, usado para transformar uma query em "nenhuma linha" sem quebrar o encadeamento. */
const NENHUMA_LINHA = '00000000-0000-0000-0000-000000000000'

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
  // ⚠️ SEM PERFIL, NEGA (achado 20 da auditoria de 30/08/2026). Antes esta linha era
  // `if (!profile) return query`, devolvendo a query SEM FILTRO NENHUM.
  //
  // Na maioria dos sítios isso era inofensivo, porque a query vinha de `createClient()` e a RLS
  // ainda restringia por baixo. Mas em `justificativas/actions.ts:169-182` a função é aplicada
  // sobre uma query de `createAdminClient()` — service_role, que tem BYPASSRLS. Ali, perfil
  // nulo significava a tabela inteira.
  //
  // Hoje aquele sítio está protegido por `exigirAcessoAoModulo` antes da chamada, então o furo
  // não era explorável. Mas a proteção depende de um guard EXTERNO, e o próximo sítio que
  // combinar admin client + este helper não terá esse guard por acaso. O default certo para
  // uma função de segurança é negar.
  if (!profile) return query.eq('id', NENHUMA_LINHA)

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

  // Super Admin e RH Geral (role 'rh') têm acesso irrestrito a dados — é a definição do papel
  // ("RH Geral" enxerga tudo). RH da Unidade (role 'rh_unidade') NÃO entra aqui de propósito:
  // cai no fluxo normal abaixo, escopado por permitted_unidades/permitted_setores como
  // admin/coordenador — só funciona certo se acesso_todos_setores estiver true junto da unidade
  // vinculada (createUser/updateUser em src/app/(dashboard)/usuarios/actions.ts força isso para
  // esse papel).
  if (bypassSuperAdmin && (profile.role === 'super_admin' || profile.role === 'rh')) {
    return query
  }

  // Se setorField não estiver definido ou for nulo (ex: consultas na tabela de unidades)
  if (!setorField) {
    if (profile.role === 'super_admin' || profile.role === 'rh' || profile.acesso_todas_unidades) {
      return query
    }
    if (profile.permitted_unidades.length > 0) {
      return query.in(unidadeField, profile.permitted_unidades)
    }
    return query.eq('id', NENHUMA_LINHA)
  }

  // 1. Caso: Acesso a todas as unidades (Admin/SuperAdmin/RH geralmente)
  if (profile.acesso_todas_unidades) {
    if (profile.acesso_todos_setores) return query
    
    if (profile.permitted_setores.length > 0) {
      return query.in(setorField, profile.permitted_setores)
    }
    return query
  }

  // 2. Caso: Usuário tem unidades específicas (Herança de Unidade -> Setores)
  // REGRA: Usuários herdam acesso a todos os setores da unidade vinculada apenas se tiverem acesso_todos_setores = true.
  // Caso contrário, precisam estar vinculados aos setores especificamente.
  const hasAllSectorsAccess = profile.acesso_todos_setores

  if (profile.permitted_unidades.length > 0) {
    if (hasAllSectorsAccess) {
      // Usuário com acesso total a setores vê tudo da unidade OU setores extras
      if (profile.permitted_setores.length > 0) {
        return query.or(`${unidadeField}.in.(${profile.permitted_unidades.join(',')}),${setorField}.in.(${profile.permitted_setores.join(',')})`)
      }
      return query.in(unidadeField, profile.permitted_unidades)
    } else {
      // Usuário sem acesso total a setores: Vê apenas os setores vinculados
      if (profile.permitted_setores.length > 0) {
        return query.in(setorField, profile.permitted_setores)
      }
      
      // Se não tem setores vinculados, mas tem unidade:
      // Retorna vazio para escalas/setores, pois ele deve ser vinculado ao setor.
      return query.eq('id', NENHUMA_LINHA)
    }
  }

  // 3. Caso: Apenas setores vinculados
  if (profile.permitted_setores.length > 0) {
    return query.in(setorField, profile.permitted_setores)
  }

  // Se não tem acesso a nada, retorna um filtro que não trará nada (segurança máxima)
  return query.eq('id', NENHUMA_LINHA)
}

/**
 * Verifica se o usuário tem acesso a uma unidade específica.
 */
export function hasUnitAccess(profile: UserProfile | null, unidadeId: string) {
  if (!profile) return false
  if (profile.role === 'super_admin' || profile.role === 'rh' || profile.acesso_todas_unidades) return true
  return profile.permitted_unidades.includes(unidadeId)
}

/**
 * Verifica se o perfil tem acesso irrestrito (sem limite de unidade/setor) — a mesma
 * condição que faz applyAccessFilters devolver a query sem filtro nenhum. Telas que buscam
 * "tudo" quando nenhum filtro é escolhido devem usar isto para exigir um filtro manual desses
 * perfis, já que são os únicos capazes de gerar uma busca sem limite de escopo.
 */
export function isAccessUnrestricted(profile: UserProfile | null): boolean {
  if (!profile) return false
  if (profile.role === 'super_admin' || profile.role === 'rh') return true
  return profile.acesso_todas_unidades && profile.acesso_todos_setores
}

/**
 * Verifica se o usuário tem acesso a um setor específico.
 */
export function hasSectorAccess(profile: UserProfile | null, setorId: string, unidadeId?: string) {
  if (!profile) return false
  if (profile.role === 'super_admin' || profile.role === 'rh') return true
  
  // Se tem acesso a todos os setores globalmente (todas as unidades)
  if (profile.acesso_todos_setores && profile.acesso_todas_unidades) return true
  
  // Se o usuário tem acesso total aos setores da sua unidade, ele tem acesso a qualquer setor da unidade à qual ele tem acesso
  if (profile.acesso_todos_setores && unidadeId && hasUnitAccess(profile, unidadeId)) return true
  
  // Caso contrário, precisa estar explicitamente listado nos setores permitidos
  return profile.permitted_setores.includes(setorId)
}
