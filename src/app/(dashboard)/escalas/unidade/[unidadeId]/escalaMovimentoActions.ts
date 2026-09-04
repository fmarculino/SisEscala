'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Mover a escala mensal de um ou mais servidores para outro setor.
 *
 * POR QUE ISTO PRECISOU EXISTIR (03/09/2026)
 *   Transferir alguém de setor no cadastro NUNCA moveu a escala. `registrarTransferenciaEfetivada`
 *   (servidores/actions.ts) apagava os dias posteriores à data da transferência no setor de
 *   origem e nunca criava nada no destino — a metade "depois" era destruída, não movida. O
 *   resultado medido em produção: 4 servidores lotados em MAIS MEDICOS com a escala inteira ainda
 *   no AMBULATÓRIO CLÍNICO, e MAIS MEDICOS sem escala nenhuma.
 *
 * ⚠️ **Quem decide é o banco.** `fn_mover_escala_mensal` confere permissão (poder lançar escala
 * na origem E no destino), competência encerrada, escala Fechada, setor inativo, setor de outra
 * unidade e colisão com escala existente do mesmo servidor no destino. Esta action só orquestra o
 * laço e junta o relato — não repete nenhuma dessas regras (armadilha 12: server action é um POST
 * chamável direto, e replicar a regra aqui só criaria uma segunda cópia para divergir).
 *
 * ⚠️ **O laço não é atômico, e isso é deliberado.** Mover 8 servidores em que o 5º colide não
 * pode desfazer os 4 que deram certo — cada escala é uma decisão independente. Por isso o retorno
 * traz `movidas` e `falhas` separadas, e a tela relata **o que mudou**, servidor por servidor
 * (armadilha 22: nunca relatar o calculado, sempre o que mudou).
 */

export interface ResultadoMovimentoEscala {
  movidas: { escalaId: string; servidorNome: string; dias: number; diasComPonto: number }[]
  falhas: { escalaId: string; servidorNome: string; motivo: string }[]
  folhaSincronizar: boolean
}

/** Traduz o erro do Postgres para o que o coordenador precisa fazer a seguir. */
function traduzirErro(mensagem: string): string {
  const m = mensagem || 'Erro desconhecido.'
  if (m.includes('Acesso negado')) {
    return 'Você não pode lançar escala na origem e no destino ao mesmo tempo. Peça ao RH.'
  }
  if (m.includes('ja tem escala')) {
    return m.replace(/^.*?:\s*/, '')
  }
  return m.replace(/^.*?ERROR:\s*/i, '')
}

export async function moverEscalasParaSetor(params: {
  escalaIds: string[]
  unidadeDestinoId: string
  setorDestinoId: string
  justificativa: string
  /** Só para o `revalidatePath` da grade de onde a ação partiu. */
  unidadeOrigemId: string
}): Promise<{ error?: string; resultado?: ResultadoMovimentoEscala }> {
  const { escalaIds, unidadeDestinoId, setorDestinoId, justificativa, unidadeOrigemId } = params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!escalaIds || escalaIds.length === 0) {
    return { error: 'Selecione pelo menos um servidor para mover.' }
  }
  if (!unidadeDestinoId || !setorDestinoId) {
    return { error: 'Escolha a unidade e o setor de destino.' }
  }
  if (!justificativa || !justificativa.trim()) {
    return { error: 'Informe o motivo: mover escala muda a premissa de um mês inteiro de trabalho.' }
  }

  // Nome do servidor de cada escala ANTES de mover — é o que o relatório usa, e depois de mover a
  // escala pode não estar mais no escopo de leitura de quem executou.
  const { data: escalas } = await supabase
    .from('escala_mensal')
    .select('id, servidores(nome)')
    .in('id', escalaIds)

  const nomePorEscala = new Map<string, string>(
    (escalas || []).map((e: any) => {
      const s = Array.isArray(e.servidores) ? e.servidores[0] : e.servidores
      return [e.id as string, (s?.nome as string) || 'Servidor']
    })
  )

  const resultado: ResultadoMovimentoEscala = { movidas: [], falhas: [], folhaSincronizar: false }

  for (const escalaId of escalaIds) {
    const nome = nomePorEscala.get(escalaId) || 'Servidor'
    const { data, error } = await supabase.rpc('fn_mover_escala_mensal', {
      p_escala_id: escalaId,
      p_unidade_destino: unidadeDestinoId,
      p_setor_destino: setorDestinoId,
      p_justificativa: justificativa.trim(),
    })

    if (error) {
      resultado.falhas.push({ escalaId, servidorNome: nome, motivo: traduzirErro(error.message) })
      continue
    }

    const r = (data || {}) as any
    resultado.movidas.push({
      escalaId,
      servidorNome: nome,
      dias: Number(r.dias_movidos || 0),
      diasComPonto: Number(r.dias_com_ponto || 0),
    })
    if (r.folha_sincronizar) resultado.folhaSincronizar = true
  }

  // As duas grades mudaram: a de origem perdeu linhas, a de destino ganhou.
  revalidatePath(`/escalas/unidade/${unidadeOrigemId}`)
  if (unidadeDestinoId !== unidadeOrigemId) revalidatePath(`/escalas/unidade/${unidadeDestinoId}`)

  return { resultado }
}

/**
 * Divide a escala do mês: os dias a partir de `diaCorte` passam para o setor de destino, numa
 * escala mensal NOVA. Usada quando a pessoa mudou de setor no meio do mês.
 *
 * ⚠️ Produz **duas folhas parciais** no mês (decisão do usuário, 03/09/2026) — `folha_ponto` é
 * chaveada por `escala_mensal_id`. `folhaSincronizar` vem `true` justamente para a tela mandar
 * sincronizar a folha de origem, que ficou cobrindo dias que mudaram de setor.
 */
export async function dividirEscalaNoSetor(params: {
  escalaId: string
  diaCorte: number
  unidadeDestinoId: string
  setorDestinoId: string
  justificativa: string
  unidadeOrigemId: string
}): Promise<{ error?: string; escalaDestinoId?: string; dias?: number; diasComPonto?: number; folhaSincronizar?: boolean }> {
  const { escalaId, diaCorte, unidadeDestinoId, setorDestinoId, justificativa, unidadeOrigemId } = params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!justificativa || !justificativa.trim()) {
    return { error: 'Informe o motivo da divisão da escala.' }
  }

  const { data, error } = await supabase.rpc('fn_dividir_escala_mensal', {
    p_escala_id: escalaId,
    p_dia_corte: diaCorte,
    p_unidade_destino: unidadeDestinoId,
    p_setor_destino: setorDestinoId,
    p_justificativa: justificativa.trim(),
  })

  if (error) return { error: traduzirErro(error.message) }

  revalidatePath(`/escalas/unidade/${unidadeOrigemId}`)
  if (unidadeDestinoId !== unidadeOrigemId) revalidatePath(`/escalas/unidade/${unidadeDestinoId}`)

  const r = (data || {}) as any
  return {
    escalaDestinoId: r.escala_destino_id,
    dias: Number(r.dias_movidos || 0),
    diasComPonto: Number(r.dias_com_ponto || 0),
    folhaSincronizar: !!r.folha_sincronizar,
  }
}
