/**
 * Quem pode REABRIR uma folha de ponto ja fechada (Revisada -> Gerada).
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *   A regra estava escrita a mao em DOIS lugares, como allowlist de papel:
 *     `profile?.role === 'admin' || profile?.role === 'super_admin'`   (FolhaPontoEditor.tsx)
 *     `role !== 'super_admin' && role !== 'admin'`                     (salvarFolhaPonto)
 *   E allowlist de papel envelhece em silencio — foi assim que `rh`, `rh_unidade` e `ass_adm`
 *   ficaram de fora de meia duzia de regras por meses (armadilha 44 do CLAUDE.md).
 *
 * A DECISAO (usuario, 04/09/2026)
 *   RH Geral e RH da Unidade tambem reabrem: "eles vao precisar fazer varios ajustes apos os
 *   fechamentos". Antes disso, so o Administrador Geral e o Diretor podiam — e a folha fechada
 *   e justamente onde o RH trabalha.
 *
 * ⚠️ ESTE MODULO ORIENTA A TELA; QUEM DECIDE E O SERVIDOR.
 *   `salvarFolhaPonto` chama a MESMA funcao antes de aceitar a reabertura, porque Server Action e
 *   um POST chamavel direto (armadilha 12: tela filtrada nao protege a action).
 *
 * ⚠️ O ESCOPO NAO ESTA AQUI, E NAO DEVE VIR PARA CA.
 *   Quem limita `rh_unidade` as unidades dele e o `hasSectorAccess` que ja roda antes deste teste
 *   em `salvarFolhaPonto`. Este modulo responde "tem o direito?", nunca "alcanca esta folha?" —
 *   a segunda pergunta depende do servidor e da unidade, que ele nao conhece.
 *
 * ⚠️ Competencia ENCERRADA continua fechada para todos. Reabrir folha e diferente de reabrir
 *   competencia: a primeira e trabalho de RH, a segunda descongela dado guardado para auditoria.
 *
 * ⚠️ Modulo PURO (sem React, sem Supabase) para ter portao: `node scratchpad/sim_reabertura.js`.
 */

export type PapelUsuario =
  | 'super_admin' | 'admin' | 'rh' | 'rh_unidade'
  | 'coordenador' | 'ass_adm' | 'servidor' | 'comum'
  | string | null | undefined

/**
 * Papeis que reabrem folha fechada.
 *
 * ⚠️ Continua sendo ALLOWLIST, e aqui isso e deliberado: reabrir um documento que o servidor ja
 * assinou e ato de autoridade, nao de visibilidade. Um papel novo com esse poder precisa ser
 * acrescentado de proposito — o mesmo criterio de `fn_pode_acionar_sobreaviso`, e o oposto de
 * `fn_painel_sobreaviso_dia`, que e denylist porque so mostra dado.
 *
 * `coordenador` e `ass_adm` ficam DE FORA: quem fecha a folha nao deve poder reabri-la sozinho
 * para mudar o que ja fechou. E o RH que audita.
 */
const PAPEIS_QUE_REABREM = ['super_admin', 'admin', 'rh', 'rh_unidade']

export function podeReabrirFolha(role: PapelUsuario): boolean {
  return !!role && PAPEIS_QUE_REABREM.includes(role)
}

/** Mensagem de recusa — nomeia quem procurar, em vez de so negar. */
export const MENSAGEM_SEM_PERMISSAO_REABRIR =
  'Apenas o RH ou um administrador podem reabrir uma folha de ponto fechada.'
