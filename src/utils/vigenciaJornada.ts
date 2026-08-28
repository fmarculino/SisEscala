/**
 * Regras compartilhadas pelas DUAS portas que gravam `servidores_jornadas_temporarias`:
 * a ficha do servidor (`servidores/actions.ts`) e a grade de escala (`jornadaActions.ts`).
 *
 * Elas divergiam: a grade exigia justificativa, a ficha aceitava nulo — mesma tabela, mesma
 * consequência jurídica (a vigência muda como cada dia trabalhado é julgado), duas regras.
 * A fonte única de verdade continua sendo o banco (`chk_vigencia_jornada_motivo` e as policies
 * de `20260828140000`); o que mora aqui é só o que transforma a recusa do banco em frase que o
 * coordenador entende.
 */

export const MOTIVO_OBRIGATORIO =
  'Informe o motivo da alteração de jornada. A justificativa é obrigatória — ela é o que separa a mudança legítima do engano.'

/**
 * Traduz a recusa do Postgres para mensagem de tela.
 *
 * ⚠️ A mensagem crua da RLS ("new row violates row-level security policy for table ...") foi
 * exatamente o que apareceu para o RH da Unidade em 28/08/2026: o formulário era oferecido a
 * quem o banco nunca deixaria gravar. A tela passou a esconder o formulário (`podeGerirVigencia`),
 * mas a tradução fica como rede — server action é um POST chamável direto.
 */
export function traduzirErroVigencia(mensagem: string): string {
  const m = (mensagem || '').toLowerCase()

  if (m.includes('row-level security') || m.includes('row level security')) {
    return 'Seu perfil não permite alterar a jornada deste servidor. RH da Unidade só alcança servidores lotados nas unidades vinculadas ao seu usuário.'
  }

  if (m.includes('chk_vigencia_jornada_motivo')) {
    return MOTIVO_OBRIGATORIO
  }

  // A trigger de sobreposição (trg_vigencia_jornada_sem_sobreposicao) já devolve texto legível.
  return mensagem
}
