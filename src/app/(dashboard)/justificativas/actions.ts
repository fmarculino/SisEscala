'use server'

import { createClient, createAdminClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { UserProfile, applyAccessFilters } from '@/utils/permissions'
import {
  AtorJustificativa,
  Desfecho,
  podeAbrirJustificativas,
  podeGerirJustificativa,
  validarGravacaoDesfecho,
} from '@/utils/gestaoJustificativas'

async function getUserProfile(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, profile_unidades(unidade_id), setores_no_escopo')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Perfil de usuário não encontrado')

  return {
    ...profile,
    userEmail: user.email || '',
    permitted_unidades: profile.profile_unidades?.map((pu: any) => pu.unidade_id) || [],
    permitted_setores: profile.setores_no_escopo || []
  }
}

/**
 * AUTORIZAÇÃO DESTE ARQUIVO — 24/08/2026.
 *
 * 🚨 Até aqui NENHUMA das sete actions conferia papel (`grep -c role` devolvia 0), e todas usam
 * `createAdminClient()` (service_role), que passa por cima da RLS — que por sua vez era
 * `FOR ALL USING (auth.uid() IS NOT NULL)` desde `20260805000000`. A tela era a única coisa
 * entre um usuário qualquer e a tabela. Armadilha 12 do CLAUDE.md, a mesma de /usuarios.
 *
 * A régua vive em `src/utils/gestaoJustificativas.ts` e é espelhada em SQL por
 * `fn_pode_gerir_justificativa` / `fn_pode_reverter_desfecho` (`20260824130000`), que fecham o
 * acesso direto por JWT. Aqui é o lado que vale para o caminho service_role.
 */
function atorDe(profile: any): AtorJustificativa {
  return {
    role: profile.role,
    acesso_todas_unidades: profile.acesso_todas_unidades,
    acesso_todos_setores: profile.acesso_todos_setores,
    permitted_unidades: profile.permitted_unidades || [],
    permitted_setores: profile.permitted_setores || [],
  }
}

/** Papel que sequer abre o módulo. Erro explícito, não lista vazia — vazio esconde o motivo. */
function exigirAcessoAoModulo(profile: any): { error: string } | null {
  if (!podeAbrirJustificativas(profile?.role)) {
    return { error: 'Sem permissão para acessar o módulo de justificativas.' }
  }
  return null
}

/**
 * "Hoje" segundo o BANCO, não segundo o processo Node.
 *
 * `fn_data_local()` (`20260822210000`) resolve a data no fuso de `configuracoes_globais`. O
 * container do Coolify sobe em UTC, então `new Date().getDate()` no servidor erra por 3 horas —
 * nas últimas 3 horas de todo dia ele já é amanhã (armadilha 12 do CLAUDE.md). Num módulo que
 * decide se um dia "já passou" para virar falta, esse erro é caro: adiantaria o julgamento de
 * um plantão que ainda está correndo.
 */
async function dataLocalISO(supabase: any): Promise<string> {
  const { data, error } = await supabase.rpc('fn_data_local')
  if (error || !data) throw new Error(error?.message || 'Data local indisponível')
  return String(data)
}

export async function getEventosPendentes(params: {
  unidadeId: string
  setorId?: string
  servidorId?: string
  mes?: number
  ano?: number
  categoria?: string
  status?: string
  page?: number
  perPage?: number
}) {
  try {
    const supabaseUser = await createClient()
    const userProfile = await getUserProfile(supabaseUser)

    const negado = exigirAcessoAoModulo(userProfile)
    if (negado) return negado

    const supabase = await createAdminClient()

    // 1. Fetch monthly scales matching unit, sector (if provided), month, year
    let queryMensal = supabase
      .from('escala_mensal')
      .select(`
        id, unidade_id, setor_id, mes, ano, servidor_id,
        servidores(id, nome, matricula),
        unidades(nome),
        setores(dicionario_setores(nome))
      `)

    // Apply strict access permissions (Super Admin = tudo, Coordenador/Admin = apenas suas unidades/setores)
    queryMensal = applyAccessFilters(queryMensal, userProfile)

    if (params.unidadeId) {
      queryMensal = queryMensal.eq('unidade_id', params.unidadeId)
    }

    if (params.setorId && params.setorId !== 'todos') {
      queryMensal = queryMensal.eq('setor_id', params.setorId)
    }

    if (params.servidorId && params.servidorId !== 'todos') {
      queryMensal = queryMensal.eq('servidor_id', params.servidorId)
    }
    if (params.mes) {
      queryMensal = queryMensal.eq('mes', params.mes)
    }
    if (params.ano) {
      queryMensal = queryMensal.eq('ano', params.ano)
    }

    const { data: escalasMensais, error: errMensal } = await queryMensal

    if (errMensal) {
      console.error('Erro ao buscar escalas mensais:', errMensal)
      return { error: errMensal.message }
    }

    if (!escalasMensais || escalasMensais.length === 0) {
      return {
        data: {
          total: 0,
          justificados: 0,
          pendentes: 0,
          sugestoes: 0,
          page: params.page || 1,
          per_page: params.perPage || 20,
          items: []
        }
      }
    }

    const escalaMensalIds = escalasMensais.map(em => em.id)
    const emMap = new Map(escalasMensais.map(em => [em.id, em]))

    // 2. Fetch daily scale entries for these monthly scale IDs
    //
    // Os horários de presença entram aqui desde 24/08/2026: a fila mostrava
    // `Servidor · Dia · Categoria · Turno · Status` e NÃO dizia se houve batida. Quem abria
    // "Justificar" no dia 08 da ANDRESA não tinha como saber, ali, que não existia registro
    // nenhum — e agora essa é a decisão que a tela pede. Decidir no escuro seria pior do que
    // não decidir.
    const { data: diarias, error: errDiarias } = await supabase
      .from('escala_diaria')
      .select(`
        id, dia, categoria, escala_mensal_id, dicionario_turnos_id,
        presenca_entrada_em, presenca_saida_em,
        dicionario_turnos(codigo)
      `)
      .in('escala_mensal_id', escalaMensalIds)
      .order('dia', { ascending: true })

    if (errDiarias) {
      console.error('Erro ao buscar escala diaria:', errDiarias)
      return { error: errDiarias.message }
    }

    // 2-B. O estado de cada evento vem de fn_desfecho_evento_dia — FONTE ÚNICA (20260824120000).
    // A tela não reclassifica nada: se ela derivasse por conta própria, o que o coordenador vê
    // ao decidir deixaria de ser o que o anexo vai imprimir. Mesma disciplina de
    // fn_projecao_marcacoes_dia entre reconciliar e conferir.
    //
    // `p_hoje` é resolvido no fuso configurado, nunca por getDate() do processo — o container
    // roda em UTC e nas últimas 3 horas de todo dia ele já é amanhã (armadilha 12).
    const desfechoPorLinha = new Map<string, { estado: string; motivo: string | null }>()
    try {
      const hojeLocal = await dataLocalISO(supabase)
      for (let i = 0; i < escalaMensalIds.length; i += 100) {
        const { data: desfechos } = await supabase.rpc('fn_desfecho_eventos_escalas', {
          p_escala_mensal_ids: escalaMensalIds.slice(i, i + 100),
          p_hoje: hojeLocal,
        })
        ;(desfechos || []).forEach((d: any) => {
          desfechoPorLinha.set(d.escala_diaria_id, { estado: d.estado, motivo: d.motivo })
        })
      }
    } catch (err) {
      // A fila continua útil sem o estado (era assim até 24/08/2026); o que ela não pode é
      // deixar de carregar. O modal trata `estado` ausente como "não sei" e não oferece a
      // decisão — nunca oferece a decisão errada.
      console.warn('Desfecho dos eventos indisponível; a fila segue sem ele:', err)
    }

    // Filter categories: Extra, Plantão, Sobreaviso (case and accent insensitive)
    const eventosDiarios = diarias?.filter(ed => {
      const cat = String(ed.categoria || '').toLowerCase()
      return cat.includes('extra') || cat.includes('plant') || cat.includes('sobreaviso')
    }) || []

    // Filter by specific category dropdown if selected
    const filteredByCategory = eventosDiarios.filter(ed => {
      if (!params.categoria || params.categoria === 'todos') return true
      const cat = String(ed.categoria || '').toLowerCase()
      const reqCat = String(params.categoria).toLowerCase()
      return cat.includes(reqCat) || reqCat.includes(cat)
    })

    // 3. Fetch existing justificativas_eventos for unit, month, year
    let queryJust = supabase
      .from('justificativas_eventos')
      .select('*')
      .eq('unidade_id', params.unidadeId)

    if (params.mes) queryJust = queryJust.eq('mes', params.mes)
    if (params.ano) queryJust = queryJust.eq('ano', params.ano)

    const { data: justificativas } = await queryJust

    const justMap = new Map()
    justificativas?.forEach(j => {
      const catStr = String(j.categoria || '').toLowerCase()
      justMap.set(`${j.servidor_id}-${j.dia}-${j.mes}-${j.ano}-${catStr}`, j)
    })

    // 4. Combine events with justification records
    const allCombinedItems = filteredByCategory.map(ed => {
      const em = emMap.get(ed.escala_mensal_id)
      const catStr = String(ed.categoria || '')
      const catLower = catStr.toLowerCase()
      const key = `${em?.servidor_id}-${ed.dia}-${em?.mes}-${em?.ano}-${catLower}`
      const just = justMap.get(key)

      const desfechoDaLinha = desfechoPorLinha.get(ed.id)

      // SOBREAVISO CUMPRIDO NÃO É PENDÊNCIA (24/08/2026).
      //
      // Até aqui, TODO sobreaviso escalado entrava na fila como pendente — 72 dos 79 de
      // 08/2026 sem acionamento nenhum. Cobrar justificativa de quem ficou de prontidão e não
      // foi chamado é pedir texto sobre um não-evento, e o volume disso é o que faz a fila
      // deixar de ser lida.
      //
      // A regra (decisão do usuário em 23/08/2026): sem acionamento, ou acionado e atendido,
      // o sobreaviso é válido e conta no relatório — nada a fazer. Só a FALHA vai para a fila,
      // e vai como `falta`, para o coordenador poder reverter.
      //
      // ⚠️ Vale só para Sobreaviso. Plantão e Extra continuam exigindo a justificativa
      // motivacional de sempre, que é outra coisa: o porquê do serviço extraordinário.
      const resolvidoSozinho =
        catLower.includes('sobreaviso') && desfechoDaLinha?.estado === 'validado'

      const status = resolvidoSozinho
        ? 'auto_validado'
        : just ? just.status : 'pendente'

      const dictSetor = (em?.setores as any)?.dicionario_setores
      const setorNome = Array.isArray(dictSetor)
        ? dictSetor[0]?.nome
        : dictSetor?.nome

      const desf = desfechoDaLinha

      return {
        escala_diaria_id: ed.id,
        escala_mensal_id: ed.escala_mensal_id,
        servidor_id: em?.servidor_id,
        servidor_nome: (em?.servidores as any)?.nome || '—',
        servidor_matricula: (em?.servidores as any)?.matricula || '—',
        dia: ed.dia,
        mes: em?.mes,
        ano: em?.ano,
        categoria: catStr,
        dicionario_turnos_id: ed.dicionario_turnos_id,
        turno_codigo: (ed.dicionario_turnos as any)?.codigo || '—',
        unidade_id: em?.unidade_id,
        setor_id: em?.setor_id,
        unidade_nome: (em?.unidades as any)?.nome || '—',
        setor_nome: setorNome || 'SETOR SEM NOME',
        justificativa_id: just?.id || null,
        texto_justificativa: just?.texto_justificativa || null,
        justificativa_origem: just?.origem || null,
        justificativa_status: status,
        registrado_por_nome: just?.registrado_por_nome || null,
        justificativa_created_at: just?.created_at || null,

        // O desfecho e o ponto — o que a tela precisa para pedir uma decisão informada.
        // `resultado` é o que ESTÁ gravado; `estado` é o que a fonte única diz que o evento é.
        resultado: just?.resultado ?? null,
        resultado_origem: just?.resultado_origem ?? null,
        estado: desf?.estado ?? null,
        estado_motivo: desf?.motivo ?? null,
        presenca_entrada_em: ed.presenca_entrada_em || null,
        presenca_saida_em: ed.presenca_saida_em || null
      }
    })

    // Aggregated KPI counts
    const total = allCombinedItems.length
    // `auto_validado` conta como resolvido: e sobreaviso cumprido, nao ha nada a fazer com ele.
    // Sem isto o "Progresso (%)" nunca chegaria a 100% num setor de sobreaviso, e a barra
    // passaria a medir burocracia em vez de pendencia.
    const justificados = allCombinedItems.filter(
      i => i.justificativa_status === 'aprovada' || i.justificativa_status === 'auto_validado'
    ).length
    const pendentes = allCombinedItems.filter(i => i.justificativa_status === 'pendente').length
    const sugestoes = allCombinedItems.filter(i => i.justificativa_status === 'sugestao_pendente').length
    const emAvaliacao = allCombinedItems.filter(i => i.estado === 'em_avaliacao').length
    const faltas = allCombinedItems.filter(i => i.resultado === 'falta').length

    // Filter by tab status if selected
    let finalItems = allCombinedItems
    if (params.status === 'pendentes') {
      finalItems = allCombinedItems.filter(i => i.justificativa_status === 'pendente')
    } else if (params.status === 'preenchidas') {
      finalItems = allCombinedItems.filter(
        i => i.justificativa_status === 'aprovada' || i.justificativa_status === 'auto_validado'
      )
    } else if (params.status === 'sugestoes') {
      finalItems = allCombinedItems.filter(i => i.justificativa_status === 'sugestao_pendente')
    } else if (params.status === 'em_avaliacao') {
      // Corta por DESFECHO, não por status de justificativa. São eixos diferentes: um evento
      // pode ter texto escrito (`aprovada`) e continuar sem decisão sobre o cumprimento — em
      // 08/2026 são 6 casos, todos justificativas antigas escritas como motivação em dias sem
      // registro completo de ponto. Filtrar por `pendente` nunca os encontraria.
      finalItems = allCombinedItems.filter(i => i.estado === 'em_avaliacao')
    } else if (params.status === 'falta') {
      finalItems = allCombinedItems.filter(i => i.resultado === 'falta')
    }

    // Sort by day ASC, then server name
    finalItems.sort((a, b) => a.dia - b.dia || a.servidor_nome.localeCompare(b.servidor_nome))

    // Pagination
    const page = params.page || 1
    const perPage = params.perPage || 20
    const startIndex = (page - 1) * perPage
    const paginatedItems = finalItems.slice(startIndex, startIndex + perPage)

    return {
      data: {
        total,
        justificados,
        pendentes,
        sugestoes,
        em_avaliacao: emAvaliacao,
        faltas,
        page,
        per_page: perPage,
        items: paginatedItems
      }
    }
  } catch (err: any) {
    console.error('Erro em getEventosPendentes:', err)
    return { error: err.message }
  }
}

export async function salvarJustificativa(dados: {
  escalaDiariaId: string
  servidorId: string
  escalaMensalId: string
  dia: number
  mes: number
  ano: number
  categoria: string
  texto: string
  justificativaPadraoId?: string
  /**
   * O desfecho do evento. `undefined` = a justificativa motivacional de sempre, sem veredito
   * sobre cumprimento — é o que o modal manda para evento que o ponto já provou.
   */
  resultado?: Desfecho
}) {
  try {
    const supabaseUser = await createClient()
    const profile = await getUserProfile(supabaseUser)
    const supabase = await createAdminClient()

    const negado = exigirAcessoAoModulo(profile)
    if (negado) return negado

    const userName = profile.full_name || profile.userEmail || profile.id

    // Fetch unit and sector from monthly scale
    const { data: mensal } = await supabase
      .from('escala_mensal')
      .select('unidade_id, setor_id')
      .eq('id', dados.escalaMensalId)
      .single()

    // O escopo é conferido contra a escala REAL buscada do banco, nunca contra o que o cliente
    // mandou: a action é um POST cujo id sai no bundle, e `escalaMensalId` é escolha de quem
    // chama. Sem isto, o papel certo em outra unidade ainda passaria.
    if (!podeGerirJustificativa(atorDe(profile), {
      unidade_id: mensal?.unidade_id,
      setor_id: mensal?.setor_id,
    })) {
      return { error: 'Sem permissão para justificar eventos desta unidade.' }
    }

    // Reverter é diferente de decidir, e quem decide isso é o que JÁ ESTÁ no banco — nunca o
    // que o cliente afirma. Sem esta leitura, um coordenador desfaria a falta que o RH manteve
    // só mandando `resultado: 'validado'` no POST.
    const { data: atual } = await supabase
      .from('justificativas_eventos')
      .select('resultado')
      .eq('servidor_id', dados.servidorId)
      .eq('dia', dados.dia).eq('mes', dados.mes).eq('ano', dados.ano)
      .eq('categoria', dados.categoria)
      .maybeSingle()

    const desfechoNovo: Desfecho = dados.resultado ?? null
    const validacao = validarGravacaoDesfecho({
      ator: atorDe(profile),
      evento: { unidade_id: mensal?.unidade_id, setor_id: mensal?.setor_id },
      desfechoAtual: (atual?.resultado as Desfecho) ?? null,
      desfechoNovo,
      texto: dados.texto,
    })
    if (!validacao.ok) return { error: validacao.erro }

    const payload = {
      escala_diaria_id: dados.escalaDiariaId,
      servidor_id: dados.servidorId,
      escala_mensal_id: dados.escalaMensalId,
      unidade_id: mensal?.unidade_id || null,
      setor_id: mensal?.setor_id || null,
      dia: dados.dia,
      mes: dados.mes,
      ano: dados.ano,
      categoria: dados.categoria,
      texto_justificativa: dados.texto,
      justificativa_padrao_id: dados.justificativaPadraoId || null,
      origem: 'coordenador',
      status: 'aprovada',
      registrado_por_id: profile.id,
      registrado_por_nome: userName,
      validado_por_id: profile.id,
      validado_por_nome: userName,
      data_validacao: new Date().toISOString(),
      updated_at: new Date().toISOString(),

      // O desfecho. `null` não é "limpar por acidente": o modal só manda `resultado` para
      // evento em avaliação, e para os demais o campo continua nulo — que é o estado correto
      // de um plantão cujo cumprimento quem provou foi o relógio, não uma pessoa.
      resultado: desfechoNovo,
      resultado_origem: desfechoNovo ? 'coordenador' : null,
      resultado_definido_por_id: desfechoNovo ? profile.id : null,
      resultado_definido_por_nome: desfechoNovo ? userName : null,
      resultado_definido_em: desfechoNovo ? new Date().toISOString() : null,
    }

    const { data, error } = await supabase
      .from('justificativas_eventos')
      .upsert(payload, { onConflict: 'servidor_id,dia,mes,ano,categoria' })
      .select()

    if (error) {
      return { error: error.message }
    }

    // Try logging silently
    try {
      await supabase.from('logs_sistema').insert({
        user_id: profile.id,
        acao: 'JUSTIFICATIVA_REGISTRADA',
        unidade_id: mensal?.unidade_id || null,
        setor_id: mensal?.setor_id || null,
        detalhes: {
          servidor_id: dados.servidorId,
          dia: dados.dia,
          mes: dados.mes,
          ano: dados.ano,
          categoria: dados.categoria,
          registrado_por: userName
        }
      })
    } catch (logErr) {
      console.warn('Erro ao gravar log de auditoria:', logErr)
    }

    revalidatePath('/justificativas')
    return { success: true, data }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function salvarJustificativasBulk(eventos: Array<{
  escala_diaria_id: string
  servidor_id: string
  escala_mensal_id: string
  dia: number
  mes: number
  ano: number
  categoria: string
  texto: string
  justificativa_padrao_id?: string
}>) {
  try {
    const supabaseUser = await createClient()
    const profile = await getUserProfile(supabaseUser)
    const supabase = await createAdminClient()

    const negado = exigirAcessoAoModulo(profile)
    if (negado) return negado

    const userName = profile.full_name || profile.userEmail || profile.id
    const nowIso = new Date().toISOString()

    // Map monthly scale IDs to get unit_id and setor_id
    const mensalIds = Array.from(new Set(eventos.map(e => e.escala_mensal_id)))
    const { data: mensais } = await supabase
      .from('escala_mensal')
      .select('id, unidade_id, setor_id')
      .in('id', mensalIds)

    const mensalMap = new Map((mensais || []).map(m => [m.id, m]))

    // Um único evento fora do escopo recusa o lote inteiro, em vez de gravar os "válidos" e
    // pular o resto em silêncio: quem clicou selecionou aquele conjunto, e um lote parcialmente
    // aplicado é pior de auditar do que um lote recusado.
    const ator = atorDe(profile)
    const foraDoEscopo = eventos.find(e => {
      const m = mensalMap.get(e.escala_mensal_id)
      return !podeGerirJustificativa(ator, { unidade_id: m?.unidade_id, setor_id: m?.setor_id })
    })
    if (foraDoEscopo) {
      return { error: 'A seleção inclui evento fora do seu escopo. Nenhuma justificativa foi gravada.' }
    }

    // O LOTE SÓ VALIDA — nunca marca falta.
    //
    // Marcar falta é registro sobre a conduta de uma pessoa; sai de uma decisão individual, com
    // texto próprio, olhando o ponto daquele dia. Um botão que faz isso em 20 eventos de uma vez
    // seria a forma mais fácil de produzir acusação em massa sem ninguém ler nenhuma.
    //
    // E só grava desfecho onde há decisão a tomar: evento que o ponto já provou (`registrado`)
    // continua com `resultado` nulo, porque quem provou foi o relógio, não o coordenador.
    // Estado desconhecido (RPC indisponível) também não recebe desfecho — na dúvida, não decide.
    const desfechoDoEvento = new Map<string, string>()
    try {
      const hojeLocal = await dataLocalISO(supabase)
      for (let i = 0; i < mensalIds.length; i += 100) {
        const { data: desfechos } = await supabase.rpc('fn_desfecho_eventos_escalas', {
          p_escala_mensal_ids: mensalIds.slice(i, i + 100),
          p_hoje: hojeLocal,
        })
        ;(desfechos || []).forEach((d: any) => desfechoDoEvento.set(d.escala_diaria_id, d.estado))
      }
    } catch (err) {
      console.warn('Desfecho indisponível no lote; nenhum evento será validado explicitamente:', err)
    }

    const textoCurto = eventos.find(e => !e.texto || e.texto.trim().length < 10)
    if (textoCurto) {
      return { error: 'A justificativa deve conter pelo menos 10 caracteres.' }
    }

    let validadosNoLote = 0
    const payloads = eventos.map(e => {
      const m = mensalMap.get(e.escala_mensal_id)
      const valida = desfechoDoEvento.get(e.escala_diaria_id) === 'em_avaliacao'
      if (valida) validadosNoLote++
      return {
        escala_diaria_id: e.escala_diaria_id,
        servidor_id: e.servidor_id,
        escala_mensal_id: e.escala_mensal_id,
        unidade_id: m?.unidade_id || null,
        setor_id: m?.setor_id || null,
        dia: e.dia,
        mes: e.mes,
        ano: e.ano,
        categoria: e.categoria,
        texto_justificativa: e.texto,
        justificativa_padrao_id: e.justificativa_padrao_id || null,
        origem: 'coordenador',
        status: 'aprovada',
        registrado_por_id: profile.id,
        registrado_por_nome: userName,
        validado_por_id: profile.id,
        validado_por_nome: userName,
        data_validacao: nowIso,
        updated_at: nowIso,
        resultado: valida ? 'validado' : null,
        resultado_origem: valida ? 'coordenador' : null,
        resultado_definido_por_id: valida ? profile.id : null,
        resultado_definido_por_nome: valida ? userName : null,
        resultado_definido_em: valida ? nowIso : null,
      }
    })

    const { data, error } = await supabase
      .from('justificativas_eventos')
      .upsert(payloads, { onConflict: 'servidor_id,dia,mes,ano,categoria' })
      .select()

    if (error) {
      return { error: error.message }
    }

    // Try logging audit
    try {
      await supabase.from('logs_sistema').insert({
        user_id: profile.id,
        acao: 'JUSTIFICATIVAS_BULK_REGISTRADAS',
        detalhes: {
          total: eventos.length,
          plantoes_validados: validadosNoLote,
          registrado_por: userName
        }
      })
    } catch (logErr) {
      console.warn('Erro log bulk:', logErr)
    }

    revalidatePath('/justificativas')
    return { success: true, data, validados: validadosNoLote }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function validarSugestao(params: {
  justificativaId: string
  acao: 'aprovar' | 'rejeitar'
  textoEditado?: string
  motivoRejeicao?: string
}) {
  try {
    const supabaseUser = await createClient()
    const profile = await getUserProfile(supabaseUser)
    const supabase = await createAdminClient()

    const negado = exigirAcessoAoModulo(profile)
    if (negado) return negado

    // A sugestão vem do Portal do servidor e carrega o próprio escopo. Ler a linha ANTES de
    // decidir é o que impede aprovar/rejeitar sugestão de outra unidade só com o UUID dela.
    const { data: alvo } = await supabase
      .from('justificativas_eventos')
      .select('unidade_id, setor_id')
      .eq('id', params.justificativaId)
      .maybeSingle()

    if (!alvo) return { error: 'Justificativa não encontrada.' }

    if (!podeGerirJustificativa(atorDe(profile), {
      unidade_id: alvo.unidade_id,
      setor_id: alvo.setor_id,
    })) {
      return { error: 'Sem permissão para validar sugestões desta unidade.' }
    }

    const userName = profile.full_name || profile.userEmail || profile.id
    const nowIso = new Date().toISOString()

    const updatePayload: any = {
      status: params.acao === 'aprovar' ? 'aprovada' : 'rejeitada',
      validado_por_id: profile.id,
      validado_por_nome: userName,
      data_validacao: nowIso,
      updated_at: nowIso
    }

    if (params.acao === 'aprovar' && params.textoEditado) {
      updatePayload.texto_justificativa = params.textoEditado
    }

    if (params.acao === 'rejeitar' && params.motivoRejeicao) {
      updatePayload.motivo_rejeicao = params.motivoRejeicao
    }

    const { data, error } = await supabase
      .from('justificativas_eventos')
      .update(updatePayload)
      .eq('id', params.justificativaId)
      .select()

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/justificativas')
    return { success: true, data }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function getTemplatesPadrao(unidadeId?: string, setorId?: string) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    const negado = exigirAcessoAoModulo(profile)
    if (negado) return negado

    let query = supabase
      .from('justificativas_padrao')
      .select('*, unidades(nome), setores(dicionario_setores(nome))')
      .eq('ativo', true)
      .order('titulo')

    if (unidadeId) {
      query = query.or(`unidade_id.is.null,unidade_id.eq.${unidadeId}`)
    }

    let { data, error } = await query

    if (error) {
      return { error: error.message }
    }

    // Auto-seed 3 default templates for each category (Hora Extra, Plantão, Sobreaviso) if none exist
    if (!data || data.length === 0) {
      const adminClient = await createAdminClient()
      const defaultTemplates = [
        // HORA EXTRA
        {
          titulo: 'Demanda Emergencial / Pico de Atendimento',
          texto: 'Convocação extraordinária para cobertura de alta demanda e atendimento emergencial durante período de pico assistencial.',
          categoria: 'Extra',
          ativo: true
        },
        {
          titulo: 'Substituição por Afastamento Médico',
          texto: 'Realização de jornada extraordinária para substituição de servidor afastado por motivo de atestado médico ou licença de saúde.',
          categoria: 'Extra',
          ativo: true
        },
        {
          titulo: 'Mutirão de Exames / Procedimentos',
          texto: 'Execução de horas extraordinárias para mutirão assistencial visando redução da fila de espera e cumprimento de metas.',
          categoria: 'Extra',
          ativo: true
        },
        // PLANTÃO
        {
          titulo: 'Plantão de Reforço em Finais de Semana / Feriados',
          texto: 'Cumprimento de escala de plantão presencial complementar para reforço da equipe assistencial em finais de semana ou feriados.',
          categoria: 'Plantão',
          ativo: true
        },
        {
          titulo: 'Substituição de Plantonista Faltoso',
          texto: 'Plantão extraordinário realizado para cobertura de ausência imprevisível de profissional plantonista, assegurando a escala mínima.',
          categoria: 'Plantão',
          ativo: true
        },
        {
          titulo: 'Ações Integradas de Saúde Pública',
          texto: 'Escala de plantão presencial direcionada ao atendimento em campanhas especiais de vacinação e ações integradas do município.',
          categoria: 'Plantão',
          ativo: true
        },
        // SOBREAVISO
        {
          titulo: 'Suporte de Prontidão à Distância',
          texto: 'Permanência do servidor em regime de sobreaviso à distância para pronto atendimento a chamados de urgência do setor.',
          categoria: 'Sobreaviso',
          ativo: true
        },
        {
          titulo: 'Sobreaviso Noturno e Finais de Semana',
          texto: 'Disponibilidade em regime de sobreaviso durante o período noturno e finais de semana para chamados emergenciais.',
          categoria: 'Sobreaviso',
          ativo: true
        },
        {
          titulo: 'Sobreaviso de Infraestrutura e TI',
          texto: 'Permanência de prontidão técnica em sobreaviso para atendimento a falhas críticas de infraestrutura, logística ou sistemas.',
          categoria: 'Sobreaviso',
          ativo: true
        }
      ]

      await adminClient.from('justificativas_padrao').insert(defaultTemplates)

      // Re-fetch after seeding
      const refetched = await query
      data = refetched.data || []
    }

    return { templates: data || [] }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function salvarTemplatePadrao(dados: {
  id?: string
  unidadeId?: string
  setorId?: string
  titulo: string
  texto: string
  categoria?: string
  ativo?: boolean
}) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    const negado = exigirAcessoAoModulo(profile)
    if (negado) return negado

    // Template global (unidade_id NULL) é catálogo da secretaria — 9 dos 12 em produção, e são
    // os que aparecem para todo coordenador. Editá-los é decisão de quem responde pela rede.
    if (!dados.unidadeId) {
      if (profile.role !== 'super_admin' && profile.role !== 'rh') {
        return { error: 'Apenas o RH Geral edita modelos globais de justificativa.' }
      }
    } else if (!podeGerirJustificativa(atorDe(profile), {
      unidade_id: dados.unidadeId,
      setor_id: dados.setorId,
    })) {
      return { error: 'Sem permissão para editar modelos desta unidade.' }
    }

    const payload = {
      unidade_id: dados.unidadeId || null,
      setor_id: dados.setorId || null,
      titulo: dados.titulo,
      texto: dados.texto,
      categoria: dados.categoria || null,
      ativo: dados.ativo ?? true,
      criado_por_id: profile.id,
      updated_at: new Date().toISOString()
    }

    let result
    if (dados.id) {
      result = await supabase
        .from('justificativas_padrao')
        .update(payload)
        .eq('id', dados.id)
    } else {
      result = await supabase
        .from('justificativas_padrao')
        .insert(payload)
    }

    if (result.error) {
      return { error: result.error.message }
    }

    revalidatePath('/justificativas')
    return { success: true }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function toggleTemplatePadrao(id: string, ativo: boolean) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    const negado = exigirAcessoAoModulo(profile)
    if (negado) return negado

    // Esta action usa createClient() (sessão do usuário), então a policy de
    // justificativas_padrao (20260824130000) já recusaria o global para quem não é RH. O
    // `if` aqui existe para a mensagem: erro de RLS chega ao coordenador como texto de banco.
    const { data: alvo } = await supabase
      .from('justificativas_padrao')
      .select('unidade_id, setor_id')
      .eq('id', id)
      .maybeSingle()

    if (!alvo) return { error: 'Modelo não encontrado.' }

    if (!alvo.unidade_id) {
      if (profile.role !== 'super_admin' && profile.role !== 'rh') {
        return { error: 'Apenas o RH Geral ativa ou desativa modelos globais.' }
      }
    } else if (!podeGerirJustificativa(atorDe(profile), {
      unidade_id: alvo.unidade_id,
      setor_id: alvo.setor_id,
    })) {
      return { error: 'Sem permissão para alterar modelos desta unidade.' }
    }

    const { error } = await supabase
      .from('justificativas_padrao')
      .update({ ativo, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/justificativas')
    return { success: true }
  } catch (err: any) {
    return { error: err.message }
  }
}
