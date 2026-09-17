'use server'

/**
 * Prévia da apuração do período (Fase 2 do plano do Mais Médicos).
 *
 * LEITURA PURA: não grava nada, não emite documento, não muda folha nenhuma. A emissão (com
 * snapshot, versão e retificação) é a Fase 3.
 *
 * ⚠️ Usa `createClient()`, nunca `createAdminClient()`: a folha é escopada por RLS, e é essa RLS
 * que impede um coordenador de ler a folha de quem ele não alcança. A montagem só junta o que a
 * sessão já podia ver.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { janelaDoPeriodo, metadesDoPeriodo, type RegimeApuracao } from '@/utils/folha/periodoApuracao'
import {
  montarApuracao,
  descreverApuracao,
  requerConfirmacao,
  fingerprintApuracao,
  diasComLinha,
  compararComEmitido,
  type FolhaDaCompetencia,
} from '@/utils/folha/apuracaoPeriodo'

export async function previaApuracaoPeriodo(servidorId: string, mes: number, ano: number) {
  try {
    const supabase = await createClient()

    // 1. A janela vem do BANCO — a mesma função que a emissão vai usar. A tela não deriva período.
    const { data: periodoRaw, error: erroPeriodo } = await supabase
      .rpc('fn_periodo_apuracao_servidor', { p_servidor_id: servidorId, p_mes: mes, p_ano: ano })

    if (erroPeriodo) return { error: erroPeriodo.message }
    const periodo = Array.isArray(periodoRaw) ? periodoRaw[0] : periodoRaw
    if (!periodo) return { error: 'Não foi possível resolver o período de apuração.' }

    const regime: RegimeApuracao = {
      id: periodo.regime_id,
      nome: periodo.regime_nome,
      dia_corte: periodo.dia_corte,
    }
    const janela = janelaDoPeriodo(regime, mes, ano)

    // Sanidade: o espelho do frontend tem de concordar com o banco. Divergir aqui significa que
    // uma das duas implementações da janela mudou sem a outra — e o documento sairia com um
    // recorte que a emissão não usaria.
    if (janela.inicio !== periodo.inicio || janela.fim !== periodo.fim) {
      return {
        error:
          `Divergência no período: o banco diz ${periodo.inicio} a ${periodo.fim} e a tela `
          + `calculou ${janela.inicio} a ${janela.fim}. Não é seguro apurar assim.`,
      }
    }

    // 2. As competências que o período abrange (uma, ou duas quando atravessa a virada).
    const recortes = metadesDoPeriodo(janela)
    const meses = [...new Set(recortes.map(r => r.mes))]
    const anos = [...new Set(recortes.map(r => r.ano))]

    const { data: folhasRaw, error: erroFolhas } = await supabase
      .from('folha_ponto')
      .select(
        'id, mes, ano, status, registros, escala_mensal_id, '
        + 'escala_mensal(unidades(nome), setores(dicionario_setores(nome)), '
        + 'jornadas(nome, horas_totais, intervalo_minutos))'
      )
      .eq('servidor_id', servidorId)
      .in('mes', meses)
      .in('ano', anos)
      .order('mes')

    if (erroFolhas) return { error: erroFolhas.message }

    // `any[]`: o embed aninhado (escala_mensal -> unidades/setores/jornadas) não é inferível pelos
    // tipos gerados, e src/types/database.ts está incompleto de propósito (armadilha 2).
    const folhas: FolhaDaCompetencia[] = ((folhasRaw as any[]) || [])
      // O `.in` cruzado pode trazer competência fora do período (ex.: 09/2025 num período que
      // cobre 08/2026 e 09/2026). Só entra o par (mês, ano) que a janela realmente recorta.
      .filter(f => recortes.some(r => r.mes === f.mes && r.ano === f.ano))
      .map(f => {
        const em: any = f.escala_mensal
        const setor = Array.isArray(em?.setores) ? em.setores[0] : em?.setores
        const dic = setor
          ? (Array.isArray(setor.dicionario_setores) ? setor.dicionario_setores[0] : setor.dicionario_setores)
          : null
        const jor = Array.isArray(em?.jornadas) ? em.jornadas[0] : em?.jornadas
        const uni = Array.isArray(em?.unidades) ? em.unidades[0] : em?.unidades
        return {
          id: f.id,
          mes: f.mes,
          ano: f.ano,
          status: f.status,
          registros: (f.registros as any[]) || [],
          escala_mensal_id: f.escala_mensal_id,
          unidade_nome: uni?.nome ?? null,
          setor_nome: dic?.nome ?? null,
          jornada: jor ?? null,
        }
      })

    // 3. As vigências das regras de folha vêm do BANCO, nunca do default do código: é o que faz
    // cada metade ser contada com a régua da competência dela.
    const { data: cfg } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')
      .in('chave', [
        'horas_normais_liquidas_desde',
        'compensacao_atraso_vigente_desde',
        'autorizacao_extra_vigente_desde',
        'competencias_encerradas',
      ])

    const valorDe = (chave: string) => (cfg || []).find(c => c.chave === chave)?.valor
    const texto = (v: any) => (typeof v === 'string' ? v : v == null ? null : String(v))

    const encerradasRaw = valorDe('competencias_encerradas')
    const competenciasEncerradas = Array.isArray(encerradasRaw)
      ? encerradasRaw.map((c: any) => ({ mes: Number(c.mes), ano: Number(c.ano) }))
      : []

    const apuracao = montarApuracao(janela, folhas, {
      horasLiquidasDesde: texto(valorDe('horas_normais_liquidas_desde')),
      compensacaoVigenteDesde: texto(valorDe('compensacao_atraso_vigente_desde')),
      autorizacaoExtraVigenteDesde: texto(valorDe('autorizacao_extra_vigente_desde')),
      competenciasEncerradas,
    })

    return {
      success: true,
      regimeNome: periodo.regime_nome,
      apuracao,
      relato: descreverApuracao(apuracao),
      confirmacao: requerConfirmacao(apuracao),
    }
  } catch (e: any) {
    console.error('Erro em previaApuracaoPeriodo:', e)
    return { error: e?.message || 'Falha ao montar a prévia da apuração.' }
  }
}

// ============================================================================
// Fase 3 — emitir, retificar, revogar e reimprimir
// ============================================================================
// A montagem é a MESMA da prévia (previaApuracaoPeriodo): o documento emitido é exatamente o que
// a prévia mostrou. Duas montagens diferentes fariam o RH assinar um número que não viu.

/**
 * Emite o documento do período.
 *
 * ⚠️ O cliente manda `(servidorId, mes, ano)` e a confirmação — nunca os números. Quem monta é
 * esta action, no servidor, com os dados do banco. E a RPC ainda confere a contagem de dias e de
 * dias com linha contra a folha antes de gravar: payload que não corresponde é recusado lá.
 */
export async function emitirApuracao(
  servidorId: string,
  mes: number,
  ano: number,
  opcoes: { confirmado?: boolean; observacao?: string } = {}
) {
  try {
    const previa = await previaApuracaoPeriodo(servidorId, mes, ano)
    if ((previa as any).error) return { error: (previa as any).error }

    const { apuracao, confirmacao } = previa as any

    if (confirmacao?.precisa && !opcoes.confirmado) {
      return {
        precisaConfirmar: true,
        motivos: confirmacao.motivos,
        // O RH decide olhando o que falta — nunca um "confirma?" sem conteúdo.
        relato: (previa as any).relato,
      }
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('fn_emitir_apuracao', {
      p_servidor_id: servidorId,
      p_mes: mes,
      p_ano: ano,
      p_registros: apuracao.dias,
      // Minutos, nunca horas decimais (de 0.18h não se recupera 11 min).
      p_totais: apuracao.totais,
      p_dias_com_linha: diasComLinha(apuracao),
      p_fingerprint: fingerprintApuracao(apuracao),
      p_ressalvas: confirmacao?.motivos || [],
      p_observacao: opcoes.observacao || null,
      p_confirmado: opcoes.confirmado === true,
    })

    if (error) return { error: error.message }

    revalidatePath(`/servidores/${servidorId}`)
    revalidatePath('/folha-ponto/apuracoes')
    return { success: true, resultado: data }
  } catch (e: any) {
    console.error('Erro em emitirApuracao:', e)
    return { error: e?.message || 'Falha ao emitir a apuração.' }
  }
}

/**
 * Retifica: emite a versão seguinte do MESMO período, com motivo.
 *
 * É o caminho quando a folha mudou depois da emissão — o que a Portaria 4.198/2022 art. 101-B II
 * descreve. A versão anterior continua no histórico: é ela que prova o que foi entregue antes.
 */
export async function retificarApuracao(
  apuracaoId: string,
  motivo: string,
  opcoes: { confirmado?: boolean } = {}
) {
  try {
    if (!motivo || motivo.trim().length < 10) {
      return { error: 'Informe o motivo da retificação (ao menos 10 caracteres).' }
    }

    const supabase = await createClient()
    const { data: ant, error: erroAnt } = await supabase
      .from('folha_apuracoes')
      .select('id, servidor_id, competencia_mes, competencia_ano')
      .eq('id', apuracaoId)
      .maybeSingle()

    if (erroAnt) return { error: erroAnt.message }
    if (!ant) return { error: 'Apuração não encontrada.' }

    const previa = await previaApuracaoPeriodo(
      ant.servidor_id, ant.competencia_mes, ant.competencia_ano
    )
    if ((previa as any).error) return { error: (previa as any).error }
    const { apuracao, confirmacao } = previa as any

    if (confirmacao?.precisa && !opcoes.confirmado) {
      return { precisaConfirmar: true, motivos: confirmacao.motivos, relato: (previa as any).relato }
    }

    const { data, error } = await supabase.rpc('fn_retificar_apuracao', {
      p_apuracao_id: apuracaoId,
      p_registros: apuracao.dias,
      p_totais: apuracao.totais,
      p_dias_com_linha: diasComLinha(apuracao),
      p_fingerprint: fingerprintApuracao(apuracao),
      p_motivo: motivo.trim(),
      p_ressalvas: confirmacao?.motivos || [],
      p_confirmado: opcoes.confirmado === true,
    })

    if (error) return { error: error.message }

    revalidatePath(`/servidores/${ant.servidor_id}`)
    revalidatePath('/folha-ponto/apuracoes')
    return { success: true, resultado: data }
  } catch (e: any) {
    console.error('Erro em retificarApuracao:', e)
    return { error: e?.message || 'Falha ao retificar a apuração.' }
  }
}

export async function revogarApuracao(apuracaoId: string, motivo: string) {
  try {
    if (!motivo || motivo.trim().length < 10) {
      return { error: 'Informe o motivo da revogação (ao menos 10 caracteres).' }
    }
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('fn_revogar_apuracao', {
      p_apuracao_id: apuracaoId,
      p_motivo: motivo.trim(),
    })
    if (error) return { error: error.message }
    revalidatePath('/folha-ponto/apuracoes')
    return { success: true, resultado: data }
  } catch (e: any) {
    console.error('Erro em revogarApuracao:', e)
    return { error: e?.message || 'Falha ao revogar a apuração.' }
  }
}

/** As apurações emitidas de uma competência, no escopo de quem consulta. */
export async function listarApuracoes(mes: number, ano: number, unidadeId?: string | null) {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('fn_apuracoes_competencia', {
      p_mes: mes,
      p_ano: ano,
      p_unidade_id: unidadeId || null,
    })
    if (error) return { error: error.message }
    return { success: true, apuracoes: data || [] }
  } catch (e: any) {
    console.error('Erro em listarApuracoes:', e)
    return { error: e?.message || 'Falha ao listar as apurações.' }
  }
}

/**
 * Busca uma apuração emitida — para reimprimir ou conferir divergência.
 *
 * 🚨 A REIMPRESSÃO SAI DO SNAPSHOT, nunca da folha de hoje. É isso que faz o PDF reimpresso em
 * outubro ser idêntico ao entregue em setembro. A comparação com a folha atual vem ao lado, como
 * AVISO — quem decide se retifica é o RH.
 */
export async function buscarApuracaoEmitida(apuracaoId: string) {
  try {
    const supabase = await createClient()
    const { data: ap, error } = await supabase
      .from('folha_apuracoes')
      .select('*, servidores(nome, matricula, cargo)')
      .eq('id', apuracaoId)
      .maybeSingle()

    if (error) return { error: error.message }
    if (!ap) return { error: 'Apuração não encontrada.' }

    // A folha de hoje ainda diz o mesmo? Divergência não é erro: é o gatilho de uma retificação.
    let divergencia: { divergente: boolean; diferencas: string[] } | null = null
    const previa = await previaApuracaoPeriodo(
      (ap as any).servidor_id, (ap as any).competencia_mes, (ap as any).competencia_ano
    )
    if (!(previa as any).error) {
      divergencia = compararComEmitido((previa as any).apuracao, {
        fingerprint: (ap as any).fingerprint,
        totais: (ap as any).totais,
      })
    }

    return { success: true, apuracao: ap, divergencia }
  } catch (e: any) {
    console.error('Erro em buscarApuracaoEmitida:', e)
    return { error: e?.message || 'Falha ao buscar a apuração.' }
  }
}

/**
 * Quem tem período de apuração diferente do mês civil nesta competência.
 *
 * ⚠️ Resolve pelo BANCO, servidor por servidor (`fn_periodo_apuracao_servidor`) — não deduz da
 * tabela de vigências. A diferença importa: com uma vigência GLOBAL de corte 20, a resposta é
 * "toda a rede", e ler só as linhas por servidor devolveria lista vazia justamente no caso em que
 * ela é maior.
 */
export async function servidoresComPeriodoEspecial(
  mes: number,
  ano: number,
  unidadeId?: string | null
) {
  try {
    const supabase = await createClient()

    // Há regime de corte vigente para a rede? (servidor_id null)
    const ultimoDia = new Date(ano, mes, 0).getDate()
    const dataRef = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`

    const { data: vigencias } = await supabase
      .from('folha_regime_vigencias')
      .select('servidor_id, regime_id, vigencia_inicio, vigencia_fim, folha_regimes(dia_corte)')
      .lte('vigencia_inicio', dataRef)
      .or(`vigencia_fim.is.null,vigencia_fim.gte.${dataRef}`)

    const comCorte = (v: any) => {
      const r = Array.isArray(v.folha_regimes) ? v.folha_regimes[0] : v.folha_regimes
      return r?.dia_corte !== null && r?.dia_corte !== undefined
    }

    const globalComCorte = (vigencias || []).some(v => v.servidor_id === null && comCorte(v))
    const idsPorServidor = (vigencias || [])
      .filter(v => v.servidor_id && comCorte(v))
      .map(v => v.servidor_id as string)

    // Sem regime de corte em lugar nenhum: ninguém tem período especial, e dizer isso é melhor
    // que devolver lista vazia sem explicação.
    if (!globalComCorte && idsPorServidor.length === 0) {
      return { success: true, servidores: [], motivo: 'nenhum_regime_de_corte' as const }
    }

    // Com regime global de corte a lista é a unidade inteira — e aí a unidade é obrigatória, senão
    // a tela tentaria carregar os 2.647 ativos.
    if (globalComCorte && !unidadeId) {
      return { success: true, servidores: [], motivo: 'escolha_a_unidade' as const }
    }

    let query = supabase
      .from('servidores')
      .select('id, nome, matricula, unidade_id, setor_id, unidades(nome)')
      .eq('status', 'Ativo')
      .order('nome')

    if (globalComCorte) {
      query = query.eq('unidade_id', unidadeId as string)
    } else {
      query = query.in('id', idsPorServidor)
      if (unidadeId) query = query.eq('unidade_id', unidadeId)
    }

    const { data: srv, error } = await query
    if (error) return { error: error.message }

    // Confirma servidor por servidor pelo banco: é a mesma função que a emissão usa.
    const servidores: any[] = []
    for (const s of (srv as any[]) || []) {
      const { data: perRaw } = await supabase.rpc('fn_periodo_apuracao_servidor', {
        p_servidor_id: s.id, p_mes: mes, p_ano: ano,
      })
      const per = Array.isArray(perRaw) ? perRaw[0] : perRaw
      if (!per || per.dia_corte === null) continue
      const uni = Array.isArray(s.unidades) ? s.unidades[0] : s.unidades
      servidores.push({
        id: s.id,
        nome: s.nome,
        matricula: s.matricula,
        unidade_nome: uni?.nome || null,
        regime_nome: per.regime_nome,
        periodo_inicio: per.inicio,
        periodo_fim: per.fim,
        atravessa_mes: per.atravessa_mes,
      })
    }

    return { success: true, servidores, motivo: null }
  } catch (e: any) {
    console.error('Erro em servidoresComPeriodoEspecial:', e)
    return { error: e?.message || 'Falha ao listar servidores com período especial.' }
  }
}
