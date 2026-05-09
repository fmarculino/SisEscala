export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Administrador Geral',
  admin: 'Administrador',
  coordenador: 'Coordenador',
  servidor: 'Servidor'
}

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role] || 'Usuário'
}
