export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Administrador Geral',
  rh: 'Recursos Humanos',
  admin: 'Diretor',
  coordenador: 'Coordenador',
  servidor: 'Servidor'
}

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role] || 'Usuário'
}
