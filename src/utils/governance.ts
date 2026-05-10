export type UserRole = 'super_admin' | 'admin' | 'coordenador' | 'servidor' | 'comum';

interface CheckScaleAccessProps {
  role: UserRole;
  scaleMonth: number;
  scaleYear: number;
  deadlineDay: number;
  currentDate?: Date;
}

export function canEditScale({
  role,
  scaleMonth,
  scaleYear,
  deadlineDay,
  currentDate = new Date()
}: CheckScaleAccessProps): { canEdit: boolean; reason?: string } {
  // Super Admin and Admin can always edit
  if (role === 'super_admin' || role === 'admin') {
    return { canEdit: true };
  }

  const now = currentDate;
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentDay = now.getDate();

  // 1. Past years are locked for non-admins
  if (scaleYear < currentYear) {
    return { canEdit: false, reason: 'Escalas de anos anteriores estão bloqueadas para edição.' };
  }

  // 2. Past months of the current year are locked for non-admins
  if (scaleYear === currentYear && scaleMonth < currentMonth) {
    return { canEdit: false, reason: 'Escalas de meses anteriores estão bloqueadas para edição.' };
  }

  // 3. Current month planning deadline check
  if (scaleYear === currentYear && scaleMonth === currentMonth) {
    if (currentDay > deadlineDay) {
      return { 
        canEdit: false, 
        reason: `O prazo de planejamento para este mês encerrou no dia ${deadlineDay}. Apenas administradores podem fazer alterações agora.` 
      };
    }
  }

  // 4. Future months are open for planning
  return { canEdit: true };
}
