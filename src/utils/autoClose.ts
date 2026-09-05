'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { executeGerarFolhaPonto } from '@/app/(dashboard)/folha-ponto/actions'
import { registrarLog } from '@/utils/auditoria'
import { diasComFaltaPendente, promoverFaltasPendentes, isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'

/**
 * Converte em `falta` todo plantão/sobreaviso que chegou ao fechamento automático sem registro
 * completo de ponto e sem decisão do coordenador.
 *
 * 🚨 SÓ RODA COM `desfecho_obrigatorio_fechar = true`. Medido em 24/08/2026: 132 plantões de
 * 08/2026 estão `em_avaliacao`, e a maior parte NÃO é conduta — é batida de transição recusada
 * pelo terminal (armadilha 6) e plantão emendado ao Regular. Converter isso em falta sem
 * ninguém ter olhado seria acusar servidor por defeito conhecido do sistema. A chave nasce
 * false e só é ligada depois que a fila for tratada.
 *
 * Não lança: uma falha aqui não pode impedir o fechamento das escalas expiradas, que é o
 * trabalho principal desta rotina. O que ela não pode é falhar em silêncio — daí o log.
 */
async function converterPendentesEmFaltaPorDecurso(
  supabase: any,
  escalas: Array<{ id: string; mes: number; ano: number; servidor_id: string; unidade_id: string; setor_id: string }>,
  diasInativacao: number
) {
  try {
    const { data: cfg } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'desfecho_obrigatorio_fechar')
      .maybeSingle()

    if (String(cfg?.valor).replace(/"/g, '') !== 'true') return

    const { data: hojeLocal } = await supabase.rpc('fn_data_local')
    const porEscala = new Map(escalas.map(e => [e.id, e]))
    const ids = escalas.map(e => e.id)

    const pendentes: any[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.rpc('fn_desfecho_eventos_escalas', {
        p_escala_mensal_ids: ids.slice(i, i + 100),
        p_hoje: String(hojeLocal)
      })
      ;(data || []).forEach((d: any) => { if (d.estado === 'em_avaliacao') pendentes.push(d) })
    }

    if (pendentes.length === 0) return

    const agora = new Date().toISOString()
    const payloads = pendentes.map(d => {
      const e = porEscala.get(d.escala_mensal_id)!
      return {
        escala_diaria_id: d.escala_diaria_id,
        servidor_id: e.servidor_id,
        escala_mensal_id: e.id,
        unidade_id: e.unidade_id,
        setor_id: e.setor_id,
        dia: d.dia,
        mes: e.mes,
        ano: e.ano,
        categoria: d.categoria,
        texto_justificativa:
          'Convertido em falta no fechamento automático da competência: sem registro completo de '
          + 'ponto e sem decisão do coordenador dentro do prazo.',
        origem: 'coordenador',
        status: 'aprovada',
        resultado: 'falta',
        resultado_origem: 'decurso_de_prazo',
        resultado_definido_em: agora,
        updated_at: agora
      }
    })

    // `onConflict` na chave real do evento: se já houver justificativa motivacional escrita, a
    // linha é a mesma e o desfecho entra nela — nunca se cria um segundo registro do mesmo dia.
    const { error } = await supabase
      .from('justificativas_eventos')
      .upsert(payloads, { onConflict: 'servidor_id,dia,mes,ano,categoria' })

    if (error) {
      console.error('Falta por decurso: upsert recusado —', error.message)
      return
    }

    // A conversão é mais grave que o fechamento e não pode ser mais silenciosa que ele.
    // Uma linha por servidor, com os dias, para o RH saber exatamente o que reverter.
    const porServidor = new Map<string, { escala: any; dias: number[] }>()
    pendentes.forEach(d => {
      const e = porEscala.get(d.escala_mensal_id)!
      const chave = `${e.servidor_id}|${e.mes}|${e.ano}`
      if (!porServidor.has(chave)) porServidor.set(chave, { escala: e, dias: [] })
      porServidor.get(chave)!.dias.push(d.dia)
    })

    await supabase.from('logs_sistema').insert(
      Array.from(porServidor.values()).map(({ escala, dias }) => ({
        acao: 'Plantao Convertido em Falta por Decurso de Prazo',
        detalhes: {
          escala_mensal_id: escala.id,
          servidor_id: escala.servidor_id,
          mes: escala.mes,
          ano: escala.ano,
          dias: dias.sort((a, b) => a - b),
          total: dias.length,
          dias_inativacao: diasInativacao,
          reversivel_por: 'RH Geral, RH da Unidade e Administrador Geral'
        },
        unidade_id: escala.unidade_id,
        setor_id: escala.setor_id
      }))
    )
  } catch (err) {
    console.error('Falta por decurso: conversao falhou, o fechamento seguiu sem ela —', err)
  }
}

/**
 * Busca TODAS as linhas de uma consulta, paginando de 1000 em 1000.
 *
 * 🚨 O PostgREST corta em 1000 linhas EM SILÊNCIO (armadilha 8) — `limit` maior não adianta e
 * nada na resposta denuncia o corte. Medido em 05/09/2026: `escala_mensal` tem **2.160** escalas
 * abertas, então a busca sem paginação enxergava menos da metade e o fechamento automático nunca
 * alcançava o resto. Um sistema de ponto decidindo o que fechar sobre meia base é pior que não
 * fechar nada, porque o número reportado parece completo.
 */
async function buscarPaginado<T>(
  montarQuery: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ dados: T[]; error: unknown }> {
  const dados: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montarQuery(de, de + 999)
    if (error) return { dados, error }
    const pagina = data || []
    dados.push(...pagina)
    if (pagina.length < 1000) break
  }
  return { dados, error: null }
}

/**
 * Fecha escalas e folhas vencidas.
 *
 * 🚨 **`origemDeMaquina` NÃO é uma escotilha de conveniência — sem ela esta função é um no-op na
 * rota de cron, e era.** Medido em 05/09/2026, na primeira execução manual de `/api/cron`:
 * `{"autoClose":{"success":false,"error":"Não autorizado"}}`. O guard abaixo exige sessão do
 * Supabase Auth, e rota de máquina não tem nenhuma — o `CRON_SECRET` autentica a REQUISIÇÃO, não
 * cria usuário. O fechamento automático pelo cron nunca funcionou.
 *
 * ℹ️ O fechamento em si não estava parado: dos 5 chamadores, 4 são telas (`/escalas`,
 * `/escalas/unidade/[id]`, folha-ponto), e ali há sessão — escala vencida fechava **de carona**
 * quando alguém abria a tela. O que não existia era o caminho automático.
 *
 * ⚠️ O 5º chamador é o **Portal do Servidor**, que autentica por PIN com cookie HMAC e também
 * **não tem sessão Supabase Auth** (armadilha 32) — lá a chamada continua sendo um no-op, e isso
 * é deliberado: quem abre o Portal é o servidor, não alguém com autoridade para fechar
 * competência. Não passe `origemDeMaquina` de lá.
 *
 * @param origemDeMaquina só para chamadores já autenticados por segredo de máquina
 *        (`CRON_SECRET`), que é uma credencial mais forte que "existe alguém logado". As telas
 *        continuam passando pelo guard de sessão, inalteradas.
 */
export async function autoCloseExpiredScalesAndTimesheets(
  { origemDeMaquina = false }: { origemDeMaquina?: boolean } = {}
) {
  try {
    // 1. Garantir que a requisição vem de um usuário autenticado
    if (!origemDeMaquina) {
      const userSupabase = await createClient()
      const { data: { user } } = await userSupabase.auth.getUser()
      if (!user) {
        return { success: false, error: 'Não autorizado' }
      }
    }

    const supabase = await createAdminClient()

    // 2. Buscar a configuração de dias de inativação automática (padrão 5 dias)
    const { data: config } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')
      .eq('chave', 'dias_inativacao_automatica')
      .single()

    const diasInativacao = parseInt(config?.valor || '5', 10)

    // 3. Buscar escalas abertas (status != 'Fechada')
    const { dados: openScales, error: scalesError } = await buscarPaginado<any>((de, ate) =>
      supabase
        .from('escala_mensal')
        .select('id, mes, ano, status, unidade_id, setor_id, servidor_id, updated_at')
        .neq('status', 'Fechada')
        .range(de, ate)
    )

    if (scalesError) {
      console.error('Erro ao buscar escalas abertas para auto-fechamento:', scalesError)
      return { success: false, error: (scalesError as { message?: string }).message || 'falha ao buscar escalas' }
    }

    const now = new Date()
    const expiredScales = (openScales || []).filter(scale => {
      const endOfMonth = new Date(scale.ano, scale.mes, 0, 23, 59, 59, 999)
      const thresholdDate = new Date(endOfMonth)
      thresholdDate.setDate(thresholdDate.getDate() + diasInativacao)
      
      const lastUpdated = scale.updated_at ? new Date(scale.updated_at) : new Date(0)
      return now > thresholdDate && lastUpdated <= thresholdDate
    })

    // 4. Buscar folhas de ponto abertas (status != 'Revisada')
    const { dados: openTimesheets, error: timesheetsError } = await buscarPaginado<any>((de, ate) =>
      supabase
        .from('folha_ponto')
        .select('id, mes, ano, status, escala_mensal_id, servidor_id, ultima_edicao_em, created_at')
        .neq('status', 'Revisada')
        .range(de, ate)
    )

    if (timesheetsError) {
      console.error('Erro ao buscar folhas de ponto abertas para auto-fechamento:', timesheetsError)
      return { success: false, error: (timesheetsError as { message?: string }).message || 'falha ao buscar folhas' }
    }

    const expiredTimesheets = (openTimesheets || []).filter(ts => {
      const endOfMonth = new Date(ts.ano, ts.mes, 0, 23, 59, 59, 999)
      const thresholdDate = new Date(endOfMonth)
      thresholdDate.setDate(thresholdDate.getDate() + diasInativacao)

      const lastUpdated = ts.ultima_edicao_em 
        ? new Date(ts.ultima_edicao_em) 
        : (ts.created_at ? new Date(ts.created_at) : new Date(0))
        
      return now > thresholdDate && lastUpdated <= thresholdDate
    })

    // 5. Fechar escalas expiradas e gerar/promover suas folhas para definitivo (Revisada)
    let autoGeneratedTimesheetsCount = 0
    // Contadores do que REALMENTE mudou — é o que o retorno reporta. Ver o comentário do update
    // em lotes abaixo: o número da lista encontrada já foi confundido com o número fechado uma
    // vez, e o cron passou meses dizendo que fechava sem fechar.
    let escalasFechadasCount = 0
    let folhasFechadasCount = 0
    let erroParcial: string | null = null
    if (expiredScales.length > 0) {
      const scaleIds = expiredScales.map(s => s.id)

      // FALTA POR DECURSO DE PRAZO — decisão do usuário em 23/08/2026 (§5.1 do plano).
      //
      // ⚠️ ESTA FUNÇÃO É A OUTRA PORTA. Ela escreve `status = 'Revisada'` DIRETO na tabela, sem
      // passar por `salvarFolhaPonto` — então o gate que aquela action ganhou não a alcança.
      // Fechar só a porta manual deixaria o cron congelando competência com plantão pendente,
      // em silêncio, que é o modo de falha mais caro: ninguém olha.
      //
      // A conversão acontece ANTES do fechamento, de propósito: o desfecho tem que existir na
      // folha que está sendo congelada, não depois dela.
      //
      // Gravado com `resultado_origem = 'decurso_de_prazo'` — quem for reverter precisa
      // distinguir "o coordenador decidiu que faltou" de "ninguém decidiu e o prazo venceu".
      // São afirmações diferentes diante do servidor. Reversível por RH Geral e RH da Unidade.
      await converterPendentesEmFaltaPorDecurso(supabase, expiredScales, diasInativacao)

      // 🚨 UPDATE EM LOTES, E A CONTAGEM VEM DO QUE VOLTOU. Ate 05/09/2026 isto era um `.in()`
      // unico com TODOS os ids: medido naquele dia, 562 UUIDs montam uma URL de ~20 KB, o
      // PostgREST recusa, o erro caia num `console.error` invisivel e a funcao seguia devolvendo
      // `closedScales: 562` — o numero da lista ENCONTRADA. Conferido no banco na mesma hora:
      // 202 escalas `Fechada` no total e ZERO log de fechamento. Nada tinha sido fechado.
      //
      // `.select('id')` faz o PostgREST devolver as linhas afetadas, entao a contagem passa a ser
      // o que MUDOU e nao o que foi tentado (armadilha 22).
      const TAMANHO_LOTE = 100
      const idsFechados = new Set<string>()
      let updateScalesError: unknown = null
      for (let i = 0; i < scaleIds.length; i += TAMANHO_LOTE) {
        const lote = scaleIds.slice(i, i + TAMANHO_LOTE)
        const { data: atualizadas, error } = await supabase
          .from('escala_mensal')
          .update({ status: 'Fechada' })
          .in('id', lote)
          .select('id')

        if (error) {
          updateScalesError = error
          break
        }
        for (const linha of atualizadas || []) idsFechados.add(linha.id)
      }

      // Só as que de fato fecharam seguem para log e para a geração de folha. Um lote que falhou
      // no meio deixa as anteriores fechadas — registrar as posteriores criaria log de coisa que
      // não aconteceu.
      const escalasFechadas = expiredScales.filter(s => idsFechados.has(s.id))
      escalasFechadasCount = escalasFechadas.length

      if (updateScalesError) {
        console.error('Erro ao fechar escalas expiradas:', updateScalesError)
        erroParcial = `fechamento de escalas: ${(updateScalesError as { message?: string }).message || 'falhou'} (${escalasFechadas.length} de ${expiredScales.length} fecharam antes de parar)`
      }

      if (escalasFechadas.length > 0) {
        // Inserir logs do sistema para as escalas fechadas
        const scaleLogs = escalasFechadas.map(scale => ({
          acao: 'Escala Fechada Automaticamente (Prazo Expirado)',
          detalhes: {
            escala_mensal_id: scale.id,
            mes: scale.mes,
            ano: scale.ano,
            servidor_id: scale.servidor_id,
            dias_inativacao: diasInativacao
          },
          unidade_id: scale.unidade_id,
          setor_id: scale.setor_id
        }))
        
        await supabase.from('logs_sistema').insert(scaleLogs)

        // Processar folhas de ponto para essas escalas
        for (const scale of escalasFechadas) {
          const { data: existingTs, error: findTsError } = await supabase
            .from('folha_ponto')
            .select('id, status, registros, total_faltas')
            .eq('escala_mensal_id', scale.id)
            .maybeSingle()

          if (findTsError) {
            console.error(`Erro ao buscar folha para escala expirada ${scale.id}:`, findTsError)
            continue
          }

          if (existingTs) {
            if (existingTs.status !== 'Revisada') {
              // Fechar É o prazo (mesma regra do fechamento manual em salvarFolhaPonto,
              // decisão do usuário em 01/09/2026): ninguém revisitava uma folha já Revisada
              // para reavaliar "AGUARDANDO JUSTIFICATIVA" — congelava pendente para sempre,
              // contando 0 faltas indefinidamente. Aqui é automático (sem confirmação humana
              // possível), então só promove e registra no log — reversível como o resto desta
              // rotina (falta por decurso de plantão/sobreaviso, acima).
              const registros = Array.isArray(existingTs.registros) ? (existingTs.registros as any[]) : []
              const diasPromovidos = diasComFaltaPendente(registros)
              if (diasPromovidos.length > 0) promoverFaltasPendentes(registros)
              const totalFaltas = registros.filter(r => isFaltaDefinitiva(r.observacao)).length

              const { error: updateTsError } = await supabase
                .from('folha_ponto')
                .update({
                  status: 'Revisada',
                  ...(diasPromovidos.length > 0 ? { registros, total_faltas: totalFaltas } : {})
                })
                .eq('id', existingTs.id)

              if (updateTsError) {
                console.error(`Erro ao promover folha ${existingTs.id} a Revisada:`, updateTsError)
              } else {
                await supabase.from('logs_sistema').insert({
                  acao: 'Folha de Ponto Fechada Automaticamente (Prazo Expirado)',
                  detalhes: {
                    folha_ponto_id: existingTs.id,
                    escala_mensal_id: scale.id,
                    mes: scale.mes,
                    ano: scale.ano,
                    servidor_id: scale.servidor_id,
                    dias_inativacao: diasInativacao,
                    ...(diasPromovidos.length > 0 ? {
                      faltas_confirmadas_por_decurso: diasPromovidos,
                      reversivel_por: 'RH Geral, RH da Unidade e Administrador Geral'
                    } : {})
                  },
                  unidade_id: scale.unidade_id,
                  setor_id: scale.setor_id
                })
              }
            }
          } else {
            // Gerar a folha do zero e salvar como Revisada (Definitiva)
            const res = await executeGerarFolhaPonto(
              supabase,
              scale.servidor_id,
              scale.mes,
              scale.ano,
              'Revisada',
              scale.id,
              null // Gerado pelo sistema
            )

            if (res.success) {
              autoGeneratedTimesheetsCount++
              await supabase.from('logs_sistema').insert({
                acao: 'Folha de Ponto Gerada e Fechada Automaticamente (Prazo Expirado)',
                detalhes: {
                  folha_ponto_id: res.folha_id,
                  escala_mensal_id: scale.id,
                  mes: scale.mes,
                  ano: scale.ano,
                  servidor_id: scale.servidor_id,
                  dias_inativacao: diasInativacao
                },
                unidade_id: scale.unidade_id,
                setor_id: scale.setor_id
              })
            } else {
              console.error(`Erro ao gerar folha automática definitiva para escala ${scale.id}:`, res.error)
            }
          }
        }
      }
    }

    // 6. Fechar folhas de ponto expiradas remanescentes (segurança)
    if (expiredTimesheets.length > 0) {
      const tsIds = expiredTimesheets.map(t => t.id)

      // Mesma promoção de falta pendente da seção 5, buscada à parte (e só para este
      // subconjunto pequeno) porque a consulta de `openTimesheets` acima varre TODAS as folhas
      // abertas do sistema — trazer `registros` (jsonb grande) para todas seria caro à toa.
      const { data: registrosPorFolha } = await supabase
        .from('folha_ponto')
        .select('id, registros')
        .in('id', tsIds)
      const registrosMap = new Map((registrosPorFolha || []).map(f => [f.id, f]))

      // Este laço já era um por vez (por causa da promoção de faltas), então nunca sofreu o
      // problema de URL do update em lote das escalas. O que faltava era CONTAR o que fechou:
      // ao parar no meio, o retorno reportava o tamanho da lista inteira.
      const idsFolhasFechadas: string[] = []
      let updateTsError: any = null
      for (const tsId of tsIds) {
        const registros = Array.isArray(registrosMap.get(tsId)?.registros) ? (registrosMap.get(tsId)!.registros as any[]) : []
        const diasPromovidos = diasComFaltaPendente(registros)
        if (diasPromovidos.length > 0) promoverFaltasPendentes(registros)
        const totalFaltas = registros.filter(r => isFaltaDefinitiva(r.observacao)).length

        const { error } = await supabase
          .from('folha_ponto')
          .update({
            status: 'Revisada',
            ...(diasPromovidos.length > 0 ? { registros, total_faltas: totalFaltas } : {})
          })
          .eq('id', tsId)

        if (error) { updateTsError = error; break }
        idsFolhasFechadas.push(tsId)
      }

      folhasFechadasCount = idsFolhasFechadas.length

      if (updateTsError) {
        console.error('Erro ao fechar folhas de ponto expiradas:', updateTsError)
        const detalhe = `fechamento de folhas: ${updateTsError.message || 'falhou'} (${idsFolhasFechadas.length} de ${tsIds.length} fecharam antes de parar)`
        erroParcial = erroParcial ? `${erroParcial}; ${detalhe}` : detalhe
      }

      if (idsFolhasFechadas.length > 0) {
        // Obter informações extras de escalas para logs
        const scaleMap = new Map<string, any>()
        const scaleIdsToFetch = expiredTimesheets
          .map(t => t.escala_mensal_id)
          .filter(id => !openScales.find(s => s.id === id))

        if (scaleIdsToFetch.length > 0) {
          const { data: fetchedScales } = await supabase
            .from('escala_mensal')
            .select('id, mes, ano, unidade_id, setor_id, servidor_id')
            .in('id', scaleIdsToFetch)
          
          fetchedScales?.forEach(s => scaleMap.set(s.id, s))
        }
        openScales.forEach(s => scaleMap.set(s.id, s))

        const fechadas = new Set(idsFolhasFechadas)
        const logs = expiredTimesheets.filter(ts => fechadas.has(ts.id)).map(ts => {
          const scale = scaleMap.get(ts.escala_mensal_id)
          return {
            acao: 'Folha de Ponto Fechada Automaticamente (Prazo Expirado)',
            detalhes: {
              folha_ponto_id: ts.id,
              escala_mensal_id: ts.escala_mensal_id,
              mes: ts.mes,
              ano: ts.ano,
              servidor_id: ts.servidor_id,
              dias_inativacao: diasInativacao
            },
            unidade_id: scale?.unidade_id || null,
            setor_id: scale?.setor_id || null
          }
        })

        await supabase.from('logs_sistema').insert(logs)
      }
    }

    // ⚠️ closedScales/closedTimesheets são o que MUDOU, não o que foi encontrado. Antes eram
    // `expiredScales.length`/`expiredTimesheets.length` — e foi assim que o cron reportou
    // "closedScales: 562" tendo fechado zero (05/09/2026). `encontradas*` fica ao lado para o
    // caso continuar diagnosticável: encontrou muito e fechou pouco é sintoma, não silêncio.
    return {
      success: erroParcial === null,
      ...(erroParcial ? { error: erroParcial } : {}),
      closedScales: escalasFechadasCount,
      closedTimesheets: folhasFechadasCount,
      encontradasEscalas: expiredScales.length,
      encontradasFolhas: expiredTimesheets.length,
      autoGeneratedTimesheets: autoGeneratedTimesheetsCount
    }
  } catch (error: any) {
    console.error('Exceção em autoCloseExpiredScalesAndTimesheets:', error)
    return { success: false, error: error.message }
  }
}

export async function toggleCompetencyClosure(mes: number, ano: number, lock: boolean) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Não autenticado')

    // Verificar se o usuário é super_admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'super_admin') {
      throw new Error('Apenas o Administrador Geral pode gerenciar o encerramento de competências.')
    }

    const adminSupabase = await createAdminClient()
    const { data: config } = await adminSupabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'competencias_encerradas')
      .single()

    let closed = Array.isArray(config?.valor) ? config.valor : []
    if (lock) {
      if (!closed.some((p: any) => p.mes === mes && p.ano === ano)) {
        closed.push({ 
          mes, 
          ano, 
          encerrado_por: user.id, 
          encerrado_em: new Date().toISOString() 
        })
      }
    } else {
      closed = closed.filter((p: any) => !(p.mes === mes && p.ano === ano))
    }

    const { error } = await adminSupabase
      .from('configuracoes_globais')
      .upsert({
        chave: 'competencias_encerradas',
        valor: closed,
        updated_at: new Date().toISOString()
      }, { onConflict: 'chave' })

    if (error) throw error

    // Encerrar congela um mês inteiro de folha e escala; reabrir descongela. Reabrir uma
    // competência fechada é exatamente o movimento que uma auditoria quer ver documentado — e
    // até aqui era invisível: o único rastro era o `encerrado_por` dentro do jsonb, que some
    // quando a competência é reaberta.
    await registrarLog({
      acao: lock ? 'COMPETENCIA_ENCERRADA' : 'COMPETENCIA_REABERTA',
      entidade: 'competencia',
      entidadeId: `${mes}/${ano}`,
      userId: user.id,
      alteracoes: { encerrada: { de: !lock, para: lock } },
      detalhes: { mes, ano },
    })

    return { success: true }
  } catch (error: any) {
    console.error('Erro ao gerenciar encerramento de competência:', error)
    return { error: error.message }
  }
}

export async function isCompetencyClosed(mes: number, ano: number): Promise<boolean> {
  try {
    const supabase = await createAdminClient()
    const { data: config } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'competencias_encerradas')
      .single()

    const closed = Array.isArray(config?.valor) ? config.valor : []
    return closed.some((p: any) => p.mes === mes && p.ano === ano)
  } catch {
    return false;
  }
}

export async function autoGenerateMissingTimesheets(mes: number, ano: number) {
  try {
    const supabase = await createAdminClient()
    
    // 1. Fetch all active scales for this month and year
    const { data: scales, error: scaleError } = await supabase
      .from('escala_mensal')
      .select('id, servidor_id, unidade_id, setor_id')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)
    
    if (scaleError) {
      console.error('Erro ao buscar escalas para autoGenerateMissingTimesheets:', scaleError)
      return { success: false, error: scaleError.message }
    }
    
    if (!scales || scales.length === 0) {
      return { success: true, message: 'Nenhuma escala encontrada para este período.' }
    }
    
    // 2. Fetch existing timesheets for this month and year
    const { data: sheets, error: sheetsError } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id')
      .eq('mes', mes)
      .eq('ano', ano)
    
    if (sheetsError) {
      console.error('Erro ao buscar folhas de ponto para autoGenerateMissingTimesheets:', sheetsError)
      return { success: false, error: sheetsError.message }
    }
    
    const sheetsMap = new Set(sheets?.map((s: any) => s.escala_mensal_id) || [])
    
    let generatedCount = 0
    let errorsCount = 0
    
    // 3. For each scale that doesn't have a timesheet, generate one as draft
    for (const scale of scales) {
      if (!sheetsMap.has(scale.id)) {
        const res = await executeGerarFolhaPonto(
          supabase,
          scale.servidor_id,
          mes,
          ano,
          'Rascunho',
          scale.id,
          null // system-generated
        )
        
        if (res.success) {
          generatedCount++
        } else {
          console.error(`Erro ao gerar folha para escala ${scale.id}:`, res.error)
          errorsCount++
        }
      }
    }
    
    return { success: true, generated: generatedCount, errors: errorsCount }
  } catch (error: any) {
    console.error('Exceção em autoGenerateMissingTimesheets:', error)
    return { success: false, error: error.message }
  }
}
