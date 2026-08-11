export const ROLE_LABELS: Record<string, string> = {
  ass_adm: 'Ass. Administrativo',
  coordenador: 'Coordenador',
  admin: 'Diretor',
  rh: 'Recursos Humanos',
  super_admin: 'Administrador Geral',
  servidor: 'Servidor'
}

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role] || 'Usuário'
}
