/**
 * Quem pode o quê no módulo de justificativas — FONTE ÚNICA (24/08/2026).
 *
 * 🚨 POR QUE ESTE ARQUIVO EXISTE
 *   As três tabelas do módulo nasceram (`20260805000000`) com
 *   `FOR ALL USING (auth.uid() IS NOT NULL)` — qualquer conta autenticada, de qualquer unidade,
 *   lia, escrevia e apagava qualquer justificativa da rede. E `justificativas/actions.ts` não
 *   compensava: `grep -c role` naquele arquivo devolvia **0**. Todas as sete actions usam
 *   `createAdminClient()` (service_role), que passa por cima da RLS — então a tela era a única
 *   coisa entre um usuário qualquer e a tabela. É a armadilha 12 do CLAUDE.md outra vez ("tela
 *   filtrada não protege a RPC"), e a mesma que /usuarios levou em 22/08/2026.
 *
 *   Enquanto a tabela guardava texto motivacional, isso era ruim. Com a coluna `resultado`
 *   (`20260824100000`) ela passa a guardar **veredito sobre conduta de servidor público**, e a
 *   decisão de 23/08/2026 ("a falta é reversível pelo RH") não significa nada enquanto todo
 *   mundo puder reverter.
 *
 * ⚠️ ESPELHO DE SQL — as duas camadas precisam concordar
 *   `fn_pode_gerir_justificativa(unidade, setor)` e `fn_pode_reverter_desfecho(unidade)`
 *   (`20260824130000`) implementam exatamente estas mesmas regras para o acesso direto por JWT.
 *   Ao mexer numa ponta, mexa na outra — mesma disciplina de `intervaloIntrajornada.ts`.
 *   As funções SQL bypassam quando `auth.uid()` é NULL justamente porque o caminho real do app
 *   é service_role: ali quem autoriza é este arquivo.
 */

export type PapelJustificativa =
  | 'super_admin' | 'rh' | 'rh_unidade' | 'admin' | 'coordenador' | 'ass_adm'

/**
 * Quem gere justificativas: ler a fila, justificar, validar o plantão e marcar falta.
 *
 * É EXATAMENTE o conjunto que já enxerga /justificativas no menu (grupo OPERAÇÃO em
 * `src/components/layout/sidebar.tsx`). Ninguém é estreitado aqui — a migration só fecha o que
 * nunca deveria ter estado aberto (`servidor` e `comum`, os papéis do Portal, e qualquer conta
 * de outra unidade).
 */
export const PAPEIS_GEREM_JUSTIFICATIVA: PapelJustificativa[] = [
  'super_admin', 'rh', 'rh_unidade', 'admin', 'coordenador', 'ass_adm',
]

/**
 * Quem REVERTE um desfecho já gravado — inclusive a falta por decurso de prazo que o
 * auto-fechamento cria.
 *
 * Decisão do usuário em 23/08/2026. Coordenador e ass_adm decidem; não revisam a própria
 * decisão. Quem marca a falta convive com o servidor todo dia — quem desfaz precisa estar fora
 * dessa relação.
 */
export const PAPEIS_REVERTEM_DESFECHO: PapelJustificativa[] = [
  'super_admin', 'rh', 'rh_unidade',
]

/** Apagar a linha some com a trilha inteira (o histórico é ON DELETE CASCADE). */
export const PAPEIS_EXCLUEM_JUSTIFICATIVA: PapelJustificativa[] = ['super_admin', 'rh']

export interface AtorJustificativa {
  role: string
  acesso_todas_unidades?: boolean | null
  acesso_todos_setores?: boolean | null
  permitted_unidades: string[]
  permitted_setores: string[]
}

/** Alvo da ação: o par (unidade, setor) do evento, como gravado em `justificativas_eventos`. */
export interface EscopoEvento {
  unidade_id: string | null | undefined
  setor_id: string | null | undefined
}

function temPapel(role: string | null | undefined, lista: PapelJustificativa[]): boolean {
  return lista.includes(role as PapelJustificativa)
}

/**
 * O escopo, espelhando a policy de `escala_mensal` (`20260812070000`) — que é a tabela de onde
 * estes eventos vêm.
 *
 * ⚠️ `rh_unidade` NÃO exige `acesso_todos_setores`, de propósito: vincular a unidade tem que
 * garantir todos os setores dela para esse papel, sem depender de um segundo checkbox lembrado
 * no cadastro. É a mesma decisão registrada em `20260812070000`.
 */
export function alcancaEvento(ator: AtorJustificativa, evento: EscopoEvento): boolean {
  if (ator.role === 'super_admin' || ator.role === 'rh') return true

  if (ator.role === 'rh_unidade') {
    return !!evento.unidade_id && ator.permitted_unidades.includes(evento.unidade_id)
  }

  if (ator.role === 'admin' || ator.role === 'coordenador' || ator.role === 'ass_adm') {
    if (ator.acesso_todas_unidades || ator.acesso_todos_setores) return true
    if (
      evento.unidade_id &&
      ator.permitted_unidades.includes(evento.unidade_id) &&
      ator.acesso_todos_setores
    ) {
      return true
    }
    // O ramo que funciona sem a flag: setor vinculado diretamente. É por ele que passa o
    // coordenador cujo acesso vem inteiramente de `profile_setores`, sem a unidade-pai
    // vinculada (o caso do piloto da TI — ver `fn_unidade_alcancavel_por_setor`).
    return !!evento.setor_id && ator.permitted_setores.includes(evento.setor_id)
  }

  return false
}

/** Ler a fila, justificar, validar, marcar falta — dentro do escopo. */
export function podeGerirJustificativa(ator: AtorJustificativa, evento: EscopoEvento): boolean {
  return temPapel(ator.role, PAPEIS_GEREM_JUSTIFICATIVA) && alcancaEvento(ator, evento)
}

/** Abrir a tela / listar. Sem alvo ainda — o escopo por linha é aplicado depois. */
export function podeAbrirJustificativas(role: string | null | undefined): boolean {
  return temPapel(role, PAPEIS_GEREM_JUSTIFICATIVA)
}

/**
 * Mexer num desfecho que JÁ existe — trocar `falta` por `validado`, o contrário, ou apagá-lo.
 * Gravar onde não havia nada não é reversão: para isso basta `podeGerirJustificativa`.
 */
export function podeReverterDesfecho(ator: AtorJustificativa, evento: EscopoEvento): boolean {
  return temPapel(ator.role, PAPEIS_REVERTEM_DESFECHO) && alcancaEvento(ator, evento)
}

export function podeExcluirJustificativa(role: string | null | undefined): boolean {
  return temPapel(role, PAPEIS_EXCLUEM_JUSTIFICATIVA)
}

/**
 * A decisão que a fila oferece. `null` = a justificativa motivacional de sempre, sem veredito
 * sobre cumprimento (o caso do evento que o ponto já provou).
 */
export type Desfecho = 'validado' | 'falta' | null

/**
 * Regra única de gravação, aplicada na página, no client e na action.
 *
 * `desfechoAtual` é o que já está no banco — é ele, e não o novo valor, que decide se a
 * operação é reversão.
 */
export function validarGravacaoDesfecho(params: {
  ator: AtorJustificativa
  evento: EscopoEvento
  desfechoAtual: Desfecho
  desfechoNovo: Desfecho
  texto: string
}): { ok: true } | { ok: false; erro: string } {
  const { ator, evento, desfechoAtual, desfechoNovo, texto } = params

  if (!podeGerirJustificativa(ator, evento)) {
    return { ok: false, erro: 'Sem permissão para justificar eventos desta unidade.' }
  }

  if (!texto || texto.trim().length < 10) {
    return { ok: false, erro: 'A justificativa deve conter pelo menos 10 caracteres.' }
  }

  // Marcar falta é registro sobre a conduta de um servidor público: não pode sair de um clique
  // sem texto, nem herdar um texto motivacional escrito para outra finalidade.
  if (desfechoNovo === 'falta' && texto.trim().length < 10) {
    return { ok: false, erro: 'Registrar falta exige a descrição do que aconteceu.' }
  }

  const ehReversao = desfechoAtual !== null && desfechoNovo !== desfechoAtual
  if (ehReversao && !podeReverterDesfecho(ator, evento)) {
    return {
      ok: false,
      erro: 'Este evento já tem desfecho registrado. Apenas o RH pode revertê-lo.',
    }
  }

  return { ok: true }
}
