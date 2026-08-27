export type UserRole = 'super_admin' | 'rh' | 'rh_unidade' | 'admin' | 'coordenador' | 'ass_adm' | 'servidor' | 'comum';

interface CheckScaleAccessProps {
  role: UserRole;
  scaleMonth: number;
  scaleYear: number;
  deadlineDay: number;
  currentDate?: Date;
}

/**
 * Quem edita escala fora da janela normal de planejamento.
 *
 * FONTE ÚNICA — a mesma lista governa `canEditScale` aqui e os guards de tela da grade
 * (ScaleGrid). Antes eram duas listas escritas à mão, e `role !== 'admin' && role !==
 * 'super_admin'` aparecia repetido em seis lugares de um arquivo de 5.000 linhas: acrescentar
 * um papel exigia achar todos, e esquecer um deixava o botão liberado com o campo travado.
 *
 * RH Geral e RH da Unidade entraram em 27/08/2026, por decisão do usuário — o gatilho foi não
 * conseguirem trocar a jornada de um servidor depois do dia limite. `rh_unidade` continua
 * escopado por unidade pela RLS: liberar o prazo não amplia o que ele enxerga, só quando pode
 * mexer no que já é dele.
 */
export const PAPEIS_EDITAM_FORA_DO_PRAZO: UserRole[] = ['super_admin', 'admin', 'rh', 'rh_unidade'];

export function podeEditarForaDoPrazo(role: string | null | undefined): boolean {
  return PAPEIS_EDITAM_FORA_DO_PRAZO.includes(role as UserRole);
}

export function canEditScale({
  role,
  scaleMonth,
  scaleYear,
  deadlineDay,
  currentDate = new Date()
}: CheckScaleAccessProps): { canEdit: boolean; reason?: string } {
  // Administrador Geral, Diretor e os dois perfis de RH editam a qualquer momento.
  if (podeEditarForaDoPrazo(role)) {
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
        reason: `O prazo de planejamento para este mês encerrou no dia ${deadlineDay}. Apenas administradores e o RH podem fazer alterações agora.` 
      };
    }
  }

  // 4. Future months are open for planning
  return { canEdit: true };
}
