'use server'

import { createAdminClient } from '@/utils/supabase/server'

/**
 * Envia ao ponto, automaticamente, todo servidor Ativo que já tem unidade e setor definidos.
 *
 * POR QUE EXISTE. Até 05/09/2026 o enfileiramento era 100% manual: `fn_enfileirar_cadastros_rep`
 * e `fn_enfileirar_cadastros_por_escala` só rodavam quando alguém clicava em "Sincronizar
 * cadastros" na tela de Marcações. Não havia trigger nem cron. Um servidor recém-cadastrado com
 * lotação definida **nunca chegava ao relógio sozinho** — dependia de alguém lembrar de clicar,
 * numa tela que a maior parte das unidades não abre.
 *
 * ⚠️ AS DUAS RPCs, NUNCA UMA SÓ. Elas escolhem por critérios diferentes e nenhuma cobre a outra:
 *   - `fn_enfileirar_cadastros_rep`        -> por LOTAÇÃO (unidade/setores do dispositivo)
 *   - `fn_enfileirar_cadastros_por_escala` -> por ESCALA no mês, o que alcança o "Servidor
 *     Externo" (escalado aqui, lotado em outra unidade), que a de lotação nunca pega.
 * É a mesma união que `enfileirarCadastrosEmLote` já fazia na tela, agora sem depender do clique.
 *
 * ⚠️ RODA COM service_role, E ISSO É O QUE A FAZ FUNCIONAR. As duas RPCs só aplicam o guard de
 * papel e o de escopo quando `auth.uid() IS NOT NULL`; o cron não tem sessão de usuário, então
 * passa por todos os dispositivos do parque. Com `createClient()` a rotina veria zero.
 *
 * ⚠️ NÃO ESCREVE NO EQUIPAMENTO. Ela só popula `rep_cadastros_fila`; quem grava no relógio é o
 * coletor da unidade, no ciclo dele, com teto de 20 por ciclo. Uma corrida aqui não vira dezenas
 * de escritas simultâneas em hardware.
 *
 * Idempotente por construção: as RPCs pulam quem já tem vínculo vigente, quem já está no snapshot
 * do equipamento e quem já está na fila. Medido em produção em 05/09/2026, antes de ligar: só
 * **24 pessoas** no parque inteiro seriam enfileiradas — o botão manual já havia sido usado, e o
 * gargalo real é biometria presencial, não cadastro.
 *
 * Não lança: falha num dispositivo não pode impedir os outros, nem derrubar o resto do cron
 * (fechamento de escalas e geração de folhas), que é trabalho mais crítico que este.
 */
export async function enfileirarCadastrosDoParque(): Promise<{
  dispositivos: number
  enfileirados: number
  ja_na_fila: number
  /** Dispositivos em que alguém foi realmente enfileirado — o que MUDOU, não o que foi varrido. */
  detalhe: { dispositivo: string; enfileirados: number }[]
  erros: string[]
}> {
  const supabase = await createAdminClient()
  const erros: string[] = []
  const detalhe: { dispositivo: string; enfileirados: number }[] = []
  let enfileirados = 0
  let jaNaFila = 0

  const { data: dispositivos, error: erroLista } = await supabase
    .from('dispositivos_rep')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')

  if (erroLista) {
    return { dispositivos: 0, enfileirados: 0, ja_na_fila: 0, detalhe: [], erros: [erroLista.message] }
  }

  // Mês corrente NO FUSO CONFIGURADO. O processo Node roda em UTC (armadilha 12): derivar o mês
  // com getMonth() puro erra nas últimas 3 horas de todo dia 31 e faria a varredura por escala
  // olhar o mês seguinte, que ainda não tem nada lançado.
  const { data: cfg } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'timezone')
    .maybeSingle()
  const timezone = (cfg?.valor as string) || 'America/Sao_Paulo'
  const agoraLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
  const mes = agoraLocal.getMonth() + 1
  const ano = agoraLocal.getFullYear()

  for (const d of dispositivos || []) {
    let doDispositivo = 0

    const { data: porEscala, error: erroEscala } = await supabase.rpc('fn_enfileirar_cadastros_por_escala', {
      p_dispositivo_id: d.id,
      p_mes: mes,
      p_ano: ano,
    })
    if (erroEscala) {
      erros.push(`${d.nome} (por escala): ${erroEscala.message}`)
    } else if (porEscala) {
      doDispositivo += Number((porEscala as { enfileirados?: number }).enfileirados || 0)
      jaNaFila += Number((porEscala as { ja_na_fila?: number }).ja_na_fila || 0)
    }

    const { data: porLotacao, error: erroLotacao } = await supabase.rpc('fn_enfileirar_cadastros_rep', {
      p_dispositivo_id: d.id,
    })
    if (erroLotacao) {
      erros.push(`${d.nome} (por lotação): ${erroLotacao.message}`)
    } else if (porLotacao) {
      doDispositivo += Number((porLotacao as { enfileirados?: number }).enfileirados || 0)
    }

    enfileirados += doDispositivo
    // Só entra no detalhe quem de fato ganhou gente na fila. Listar os 29 dispositivos com
    // "0 enfileirados" faria o relatório parecer trabalho onde não houve nenhum — é a armadilha
    // 22 (relatar o que foi calculado em vez do que mudou) na forma mais fácil de cometer.
    if (doDispositivo > 0) detalhe.push({ dispositivo: d.nome, enfileirados: doDispositivo })
  }

  return { dispositivos: (dispositivos || []).length, enfileirados, ja_na_fila: jaNaFila, detalhe, erros }
}
