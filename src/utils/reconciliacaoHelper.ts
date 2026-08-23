import { createAdminClient } from '@/utils/supabase/server'
import { dataISOLocal } from '@/utils/horario'

/**
 * Reconcilia automaticamente as marcações de uma sincronização de AFD recente,
 * atualizando escala_diaria (presença_entrada, saída, confirmada) para todos os
 * servidores que tiveram batidas no lote.
 */
export async function reconciliarSincronizacaoAfd(sincronizacaoId: string) {
  if (!sincronizacaoId) return

  try {
    const supabase = await createAdminClient()

    // 1. Busca os registros AFD da sincronização
    const { data: afdRegs, error: errAfd } = await supabase
      .from('rep_afd_registros')
      .select('id')
      .eq('sincronizacao_id', sincronizacaoId)

    if (errAfd || !afdRegs || afdRegs.length === 0) return

    const afdIds = afdRegs.map((a) => a.id)

    // 2. Busca as marcações de ponto associadas com servidor identificado
    const { data: marcacoes, error: errMarc } = await supabase
      .from('marcacoes_ponto')
      .select('servidor_id, ocorrido_em')
      .in('afd_registro_id', afdIds)
      .not('servidor_id', 'is', null)

    if (errMarc || !marcacoes || marcacoes.length === 0) return

    // 3. Agrupa por servidor e data local (America/Sao_Paulo / fuso UTC-3)
    const pares = new Map<string, { servidor_id: string; data: string }>()
    for (const m of marcacoes) {
      if (!m.servidor_id || !m.ocorrido_em) continue
      // A data de domínio da batida é a do fuso CONFIGURADO, não a do processo (a VPS roda em
      // UTC: as últimas 3 horas de todo dia já seriam "amanhã"). Ver src/utils/horario.ts.
      const localDateStr = dataISOLocal(m.ocorrido_em) || ''
      if (!localDateStr) continue

      const key = `${m.servidor_id}|${localDateStr}`
      if (!pares.has(key)) {
        pares.set(key, { servidor_id: m.servidor_id, data: localDateStr })
      }
    }

    // 4. Executa fn_reconciliar_marcacoes_dia para cada servidor/data
    for (const item of pares.values()) {
      try {
        await supabase.rpc('fn_reconciliar_marcacoes_dia', {
          p_servidor_id: item.servidor_id,
          p_data: item.data,
        })
      } catch (err: any) {
        console.warn(`[reconciliacao] Falha ao reconciliar servidor ${item.servidor_id} na data ${item.data}:`, err?.message)
      }
    }
  } catch (err: any) {
    console.error('[reconciliacao] Erro geral ao reconciliar sincronização:', err?.message)
  }
}
