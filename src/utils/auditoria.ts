import { createAdminClient } from '@/utils/supabase/server'

/**
 * Ponto único de escrita da trilha de auditoria.
 *
 * POR QUE UM HELPER
 *   Antes desta função havia **sete** implementações soltas de `.from('logs_sistema').insert()`,
 *   cada uma com um formato de `detalhes` próprio. O efeito prático, medido em 09/08/2026: não há
 *   como perguntar "tudo que aconteceu com o servidor X" sem varrer jsonb e torcer para a chave ter
 *   o mesmo nome nos sete lugares.
 *
 * O QUE MERECE LOG
 *   Registra-se o que altera **direito, dinheiro ou acesso** — e o que alguém pode precisar
 *   contestar. Consulta e navegação não entram: são ruído e não alteram nada.
 *
 * NUNCA DERRUBA A OPERAÇÃO
 *   Falha ao registrar vira `console.error` e a ação segue. Perder uma linha de log é ruim;
 *   impedir um coordenador de fechar uma folha porque o log falhou é pior.
 */

export type EntidadeAuditavel =
  | 'servidor'
  | 'profile'
  | 'folha_ponto'
  | 'configuracao'
  | 'competencia'
  | 'unidade'
  | 'setor'
  | 'escala'
  | 'aviso_ponto'

export type OrigemLog = 'humano' | 'rotina' | 'portal'

interface RegistrarLogParams {
  acao: string
  entidade: EntidadeAuditavel
  entidadeId: string
  /** Quem fez. Omitir só quando `origem` for 'rotina'. */
  userId?: string | null
  origem?: OrigemLog
  /** Apenas os campos que mudaram — use `calcularAlteracoes`. */
  alteracoes?: Record<string, { de: unknown; para: unknown }> | null
  /** Contexto livre: motivo, ip, quantidade afetada. Não é lugar de valor anterior. */
  detalhes?: Record<string, unknown>
  unidadeId?: string | null
  setorId?: string | null
}

export async function registrarLog(p: RegistrarLogParams): Promise<void> {
  try {
    const supabase = await createAdminClient()
    const { error } = await supabase.from('logs_sistema').insert({
      acao: p.acao,
      entidade: p.entidade,
      entidade_id: p.entidadeId,
      user_id: p.userId || null,
      origem: p.origem || 'humano',
      // Objeto vazio vira null: `alteracoes = {}` mentiria dizendo "olhei e nada mudou" quando
      // na verdade quem chamou não passou o antes.
      alteracoes: p.alteracoes && Object.keys(p.alteracoes).length > 0 ? p.alteracoes : null,
      detalhes: p.detalhes || {},
      unidade_id: p.unidadeId || null,
      setor_id: p.setorId || null,
    })
    if (error) console.error(`[auditoria] falha ao registrar ${p.acao}:`, error.message)
  } catch (err) {
    console.error(`[auditoria] exceção ao registrar ${p.acao}:`, err)
  }
}

/**
 * Diferença entre dois estados, **só os campos que mudaram**.
 *
 * Guardar a linha inteira infla o log e esconde a mudança no meio do que ficou igual — numa tela
 * de auditoria, "o que mudou" é a informação, e o resto é ruído.
 *
 * `camposSensiveis` são registrados como alterados, **sem os valores**: o log precisa provar que o
 * PIN mudou, e não pode conter o PIN.
 */
export function calcularAlteracoes(
  antes: Record<string, any> | null | undefined,
  depois: Record<string, any> | null | undefined,
  opcoes?: { ignorar?: string[]; camposSensiveis?: string[] }
): Record<string, { de: unknown; para: unknown }> {
  const resultado: Record<string, { de: unknown; para: unknown }> = {}
  if (!antes || !depois) return resultado

  const ignorar = new Set(opcoes?.ignorar || ['updated_at', 'created_at'])
  const sensiveis = new Set(opcoes?.camposSensiveis || [])

  // Só campos presentes em `depois`: um UPDATE parcial não deve reportar como "removido" tudo
  // que simplesmente não foi enviado no formulário.
  for (const campo of Object.keys(depois)) {
    if (ignorar.has(campo)) continue

    const de = antes[campo]
    const para = depois[campo]

    // Comparação por JSON cobre objeto e array; null e '' são tratados como equivalentes porque
    // formulário HTML devolve string vazia onde o banco tem NULL — sem isso todo salvamento
    // reportaria alterações fantasma.
    const norm = (v: unknown) => (v === '' || v === undefined ? null : v)
    if (JSON.stringify(norm(de)) === JSON.stringify(norm(para))) continue

    resultado[campo] = sensiveis.has(campo)
      ? { de: '(valor anterior omitido)', para: '(novo valor omitido)' }
      : { de: norm(de), para: norm(para) }
  }

  return resultado
}

/** Campos de horário da folha. Fora destes, o resto de um registro é derivado ou de apoio. */
const CAMPOS_FOLHA = ['entrada', 'saida_intervalo', 'retorno_intervalo', 'saida', 'observacao'] as const

/**
 * Diff da folha de ponto — **por dia e por campo**.
 *
 * `folha_ponto.registros` é um `jsonb` sobrescrito inteiro a cada salvamento. Guardar o array como
 * valor anterior tornaria o log pesado e inútil: numa folha de 31 dias, a mudança de um horário
 * ficaria escondida no meio de 30 dias idênticos.
 *
 * O que a auditoria precisa responder é "a entrada do dia 12 era 08:03 e virou 08:00, e quem fez".
 * É isso que sai daqui — e nada além.
 */
export function calcularAlteracoesFolha(
  antes: any[] | null | undefined,
  depois: any[] | null | undefined
): Record<string, { de: unknown; para: unknown }> {
  const mudou: Record<string, { de: unknown; para: unknown }> = {}
  if (!Array.isArray(depois)) return mudou

  const porDia = new Map<number, any>()
  ;(antes || []).forEach(r => { if (r?.dia != null) porDia.set(Number(r.dia), r) })

  for (const novo of depois) {
    if (novo?.dia == null) continue
    const velho = porDia.get(Number(novo.dia))
    for (const campo of CAMPOS_FOLHA) {
      const de = velho?.[campo] ?? null
      const para = novo?.[campo] ?? null
      const norm = (v: unknown) => (v === '' || v === undefined ? null : v)
      if (JSON.stringify(norm(de)) === JSON.stringify(norm(para))) continue
      // Chave "dia 12 · entrada": legível na tela sem precisar decifrar índice de array.
      mudou[`dia ${novo.dia} · ${campo}`] = { de: norm(de), para: norm(para) }
    }
  }
  return mudou
}

/**
 * Rótulos legíveis. A tela de auditoria mostra a ação para gente, não para máquina — e um
 * `CONFIGURACAO_ALTERADA` cru obriga quem lê a decifrar convenção interna.
 */
export const ROTULOS_ACAO: Record<string, string> = {
  SERVIDOR_CRIADO: 'Servidor cadastrado',
  SERVIDOR_EDITADO: 'Servidor editado',
  SERVIDOR_STATUS_ALTERADO: 'Status do servidor alterado',
  SERVIDORES_IMPORTADOS: 'Servidores importados via CSV',
  USUARIO_CRIADO: 'Usuário criado',
  USUARIO_EDITADO: 'Usuário editado',
  USUARIO_PAPEL_ALTERADO: 'Papel do usuário alterado',
  USUARIO_PERMISSOES_ALTERADAS: 'Permissões de acesso alteradas',
  USUARIO_STATUS_ALTERADO: 'Status do usuário alterado',
  CONFIGURACAO_ALTERADA: 'Configuração global alterada',
  COMPETENCIA_ENCERRADA: 'Competência encerrada',
  COMPETENCIA_REABERTA: 'Competência reaberta',
  FOLHA_EDITADA: 'Folha de ponto editada',
  FOLHA_STATUS_ALTERADO: 'Status da folha alterado',
  FOLHA_REGERADA: 'Folha de ponto regerada',
  PRESENCA_RECLASSIFICADA: 'Marcação de presença reclassificada',
  UNIDADE_EDITADA: 'Unidade editada',
  SETOR_EDITADO: 'Setor editado',
}
