/**
 * Motor de Geração de Escala Inteligente — SisEscala
 *
 * Sugere a escala de uma ou mais competências a partir do que os coordenadores lançaram nas
 * competências anteriores, nas QUATRO linhas da grade (Regular, Extra, Plantão, Sobreaviso).
 *
 * ============================================================================
 * O QUE MUDOU EM 25/08/2026, E POR QUÊ
 * ============================================================================
 *
 * A versão anterior fazia três coisas que a medição contra a produção reprovou:
 *
 * 1. **Só escrevia na linha `Regular`** e só lia histórico `categoria = 'Regular'`. Setor que
 *    trabalha em plantão nunca recebia nada — é o que explicava os sete registros de
 *    `GERAR_ESCALA_INTELIGENTE` com `celulas_preenchidas: 0` em `logs_sistema`.
 *
 * 2. **Baixava `escala_diaria` crua e contava no cliente, sem paginar.** O maior setor tem 692
 *    linhas em um mês; três meses dariam 2.076 e o PostgREST corta em 1000 EM SILÊNCIO
 *    (armadilha 8 do CLAUDE.md). A estatística sairia errada sem erro nenhum na tela. Agora a
 *    agregação é `fn_estatistica_escala_setor` e o que trafega é o resumo.
 *
 * 3. **Escolhia UM turno para o mês inteiro** (preferência cadastrada, senão o mais frequente),
 *    e decidia trabalhar/folgar por padrão detectado. Agora a decisão é por DIA DA SEMANA, que
 *    foi o que mediu melhor.
 *
 * ============================================================================
 * A MEDIÇÃO QUE DEFINE OS LIMIARES — não mexer sem refazer o backtest
 * ============================================================================
 *
 * Backtest de 25/08/2026: prever 08/2026 a partir do que foi lançado em 07/2026, sobre os 63
 * servidores com as duas competências completas. "Cobertura" é quanto da escala real o motor
 * acerta; "precisão" é quanto do que ele sugere está certo.
 *
 *   categoria    melhor cobertura / precisão   veredito
 *   Regular      83,7% / 84,6%                 funciona — é o caso central
 *   Plantão      50,8% / 72,0% (limiar 0,75)   funciona com limiar alto
 *   Extra        86,7% / 57,5% (limiar baixo)  43% do que sugeriria nunca aconteceu
 *   Sobreaviso   18,2% / 33,3%                 ruído: 79 células no sistema inteiro
 *
 * Daí os limiares abaixo. **Precisão vale mais que cobertura aqui**, e não por gosto: célula
 * que falta o coordenador preenche, que é o trabalho normal dele; célula sugerida a mais em
 * Plantão ou Extra é hora paga que ninguém decidiu, e ele precisa CAÇAR para apagar. Num
 * sistema de ponto os dois erros não custam a mesma coisa.
 *
 * Resultado deste motor, medido de ponta a ponta (o backtest carrega ESTE módulo e chama
 * `gerarEscalaInteligente` com as estatísticas reais; padrões de fábrica, 96 setores, contando
 * só os 11 que tinham competência anterior):
 *
 *   Regular      76,1% cobertura / 94,1% precisão
 *   Plantão      50,6% / 75,8%
 *   Extra        39,8% / 66,2%
 *   Sobreaviso   33,3% / 68,8%
 *
 * Contra o motor antigo no Regular (89,3% / 82,8%): troca 13 pontos de cobertura por 11 de
 * precisão — de ~17 sugestões erradas em 100 para ~6 — e passa a cobrir as outras três linhas,
 * que antes não existiam. A opção "Respeitar Continuidade Histórica" é o que faz o Sobreaviso
 * sair de 0 para 16 sugestões: sem ela, nenhum padrão de sobreaviso alcança o limiar.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { afastamentoBloqueiaEscala, afastamentoConflitaComSlots } from '@/utils/afastamentos'

export type RowCategory = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'

export const CATEGORIAS_GERAVEIS: RowCategory[] = ['Regular', 'Extra', 'Plantão', 'Sobreaviso']

/**
 * Confiança mínima para o motor lançar a célula, por categoria. Ver o backtest no cabeçalho:
 * onde errar custa dinheiro (Plantão, Extra) o motor só age com quase certeza; onde errar custa
 * uma digitação (Regular) ele ajuda mais.
 *
 * `1` significa "só o que se repetiu em TODAS as ocorrências daquele dia da semana no histórico".
 */
export const LIMIAR_CONFIANCA: Record<RowCategory, number> = {
  'Regular': 0.5,
  'Plantão': 0.75,
  'Extra': 1,
  'Sobreaviso': 1
}

/**
 * Quantos meses de histórico a RPC pondera, por padrão. Peso por recência 5/2/1.
 *
 * ⚠️ **É 1, e isso foi medido, não presumido.** A intuição diz que olhar 3 competências dá
 * mais dados e mais acerto. O backtest de ponta a ponta contra a produção (25/08/2026, prever
 * 08/2026, só os setores que tinham competência anterior) diz o contrário, em TODAS as linhas:
 *
 *   histórico    Regular            Plantão            Extra
 *   1 mês        76,1% / 94,1%      50,6% / 75,8%      39,8% / 66,2%
 *   3 meses      68,7% / 93,4%      45,0% / 73,6%      36,7% / 69,1%
 *                (cobertura / precisão)
 *
 * O motivo é o denominador da confiança: cada mês a mais aumenta o total de ocorrências
 * daquele dia da semana, então quem foi consistente no mês passado mas diferente dois meses
 * atrás CAI ABAIXO DO LIMIAR e deixa de ser sugerido. Mais histórico não vira mais acerto —
 * vira mais silêncio. E o quadro muda mesmo: servidor troca de setor, jornada muda.
 *
 * A opção de 2 e 3 meses continua na tela para setor de rotina muito estável, onde o mês
 * antigo confirma em vez de contradizer. Mas o padrão é o que mediu melhor.
 *
 * ⚠️ Ressalva honesta: o sistema só tem 3 competências (06, 07 e 08/2026) e agosto teve
 * entrada em massa de UBS/USF. É uma observação, não uma lei. Refaça o backtest quando houver
 * mais histórico antes de mexer nestes números.
 */
export const MESES_HISTORICO_PADRAO = 1
export const MESES_HISTORICO_MAX = 3

export interface GeneratorOptions {
  /** Continuar ciclo de passo fixo (12x36 e parentes) na virada do mês. */
  respectContinuity: boolean
  /** Não lançar em dia de afastamento. */
  respectEvents: boolean
  /**
   * Aceitar o vencedor abaixo do limiar quando o código dele for exatamente a preferência
   * cadastrada do servidor (`servidores.preferenca_turno`). NUNCA cria célula onde não houve
   * histórico — só baixa a barra para o que o próprio servidor já costuma fazer.
   */
  respectPreferences: boolean
  /** Quais linhas da grade gerar. */
  categorias: RowCategory[]
  /** Meses de histórico ponderados (1..3). */
  mesesHistorico: number
}

type GridData = Record<string, Record<RowCategory, Record<number, string>>>

/** Uma linha do resumo devolvido por `fn_estatistica_escala_setor`. */
interface LinhaEstatistica {
  servidor_id: string
  categoria: string
  dia_semana: number
  dicionario_turnos_id: string
  peso: number
  peso_total: number
  confianca: number
  meses_com_escala: number
  ciclo_passo: number | null
  ciclo_consistencia: number | null
  ciclo_ultimo_dia: number | null
  ciclo_dias_no_mes: number | null
}

export interface ContagemCategoria {
  sugeridas: number
  /** Caiu fora por confiança abaixo do limiar. */
  abaixoDoLimiar: number
  /** Removida por afastamento cadastrado. */
  afastamento: number
}

export interface MesGerado {
  mes: number
  ano: number
  /** É o mês que está aberto na grade (rascunho local) ou um mês extra (gravado)? */
  naGrade: boolean
  grid: GridData
  porCategoria: Record<RowCategory, ContagemCategoria>
  /** Total de células propostas neste mês, depois de todos os filtros do motor. */
  total: number
}

export interface IntelligentScaleResult {
  meses: MesGerado[]
  /** servidor_id -> jornada_id herdada da competência anterior. */
  jornadas: Record<string, string>
  /** Quantos servidores da grade não tinham histórico nenhum no setor. */
  servidoresSemHistorico: number
  /** Quantos meses de origem a estatística realmente encontrou. */
  mesesDeOrigemEncontrados: number
}

/**
 * Texto do resultado. É deliberadamente detalhado, e a razão é um bug real.
 *
 * Até 25/08/2026 a tela dizia "N turnos preenchidos" contando a SAÍDA DO MOTOR, enquanto o
 * merge descartava célula em silêncio. Caso medido (TI da SMS, 08/2026): a mensagem anunciou
 * 111 turnos, 81 caíram por já ter ponto batido, as outras 30 já estavam lançadas com o mesmo
 * turno, e **nenhuma célula da tela mudou**. O usuário procurou a escala e não achou — não
 * porque o gerador falhou, mas porque a mensagem media a coisa errada.
 *
 * Regra que fica: nunca relatar o que foi calculado. Relatar o que MUDOU, e por que o resto não.
 */
export function montarResumoGerador(dados: {
  mesDaGrade: MesGerado | undefined
  aplicadas: number
  jaIguais: number
  puladasPorPonto: number
  puladasPorAfastamento: number
  extrasGravadas: { rotulo: string; celulas: number }[]
  extrasErro: string
  servidoresSemHistorico: number
  mesesDeOrigem: number
  mesRef: number
  anoRef: number
}): string {
  const linhas: string[] = []
  const { mesDaGrade } = dados

  if (dados.mesesDeOrigem === 0) {
    const { mes: pm, ano: pa } = getPreviousMonth(dados.mesRef, dados.anoRef)
    const nome = new Date(pa, pm - 1, 1).toLocaleString('pt-BR', { month: 'long' })
    return `Não há histórico de escala salva para os servidores deste setor nas competências anteriores `
      + `(a mais recente seria ${nome} de ${pa}).\n\n`
      + `Para um setor novo, a primeira competência precisa ser montada à mão ou por "Aplicar Template" — `
      + `o gerador aprende com o que já foi lançado, então ele não tem o que copiar ainda.`
  }

  if (dados.aplicadas > 0) {
    linhas.push(`${dados.aplicadas} ${dados.aplicadas === 1 ? 'turno foi preenchido' : 'turnos foram preenchidos'} na grade desta competência, como rascunho. Lembre-se de clicar em "Salvar Previsão".`)
  } else {
    linhas.push('Nenhuma célula desta competência mudou.')
  }

  if (mesDaGrade) {
    const detalhe = CATEGORIAS_GERAVEIS
      .filter(c => mesDaGrade.porCategoria[c].sugeridas > 0)
      .map(c => `${c}: ${mesDaGrade.porCategoria[c].sugeridas}`)
    if (detalhe.length > 0) linhas.push(`\nSugestões por linha — ${detalhe.join(' · ')}.`)
  }

  const motivos: string[] = []
  if (dados.jaIguais > 0) motivos.push(`${dados.jaIguais} já ${dados.jaIguais === 1 ? 'estava lançado' : 'estavam lançados'} exatamente com o mesmo turno`)
  if (dados.puladasPorPonto > 0) motivos.push(`${dados.puladasPorPonto} ${dados.puladasPorPonto === 1 ? 'caiu' : 'caíram'} em dia que já tem ponto registrado (não são sobrescritos)`)
  if (dados.puladasPorAfastamento > 0) motivos.push(`${dados.puladasPorAfastamento} ${dados.puladasPorAfastamento === 1 ? 'caiu' : 'caíram'} em dia de afastamento`)
  if (motivos.length > 0) linhas.push(`\nO gerador propôs mais do que aplicou: ${motivos.join('; ')}.`)

  if (mesDaGrade) {
    const abaixo = CATEGORIAS_GERAVEIS.reduce((a, c) => a + mesDaGrade.porCategoria[c].abaixoDoLimiar, 0)
    if (abaixo > 0) {
      linhas.push(`\n${abaixo} ${abaixo === 1 ? 'dia ficou' : 'dias ficaram'} em branco por padrão pouco consistente no histórico — o gerador prefere deixar para você do que chutar.`)
    }
  }

  if (dados.servidoresSemHistorico > 0) {
    linhas.push(`\n${dados.servidoresSemHistorico} ${dados.servidoresSemHistorico === 1 ? 'servidor não tinha' : 'servidores não tinham'} histórico neste setor e ${dados.servidoresSemHistorico === 1 ? 'ficou' : 'ficaram'} em branco.`)
  }

  if (dados.extrasGravadas.length > 0) {
    const feitas = dados.extrasGravadas.map(e => `${e.rotulo}: ${e.celulas}`).join(' · ')
    linhas.push(`\nCompetências seguintes, criadas no banco como Rascunho — ${feitas}. Abra cada uma e revise antes de fechar.`)
  }
  if (dados.extrasErro) {
    linhas.push(`\n⚠️ As competências seguintes NÃO foram gravadas: ${dados.extrasErro}`)
  }

  return linhas.join('\n')
}

export function getPreviousMonth(mes: number, ano: number) {
  return { mes: mes === 1 ? 12 : mes - 1, ano: mes === 1 ? ano - 1 : ano }
}

export function getNextMonth(mes: number, ano: number) {
  return { mes: mes === 12 ? 1 : mes + 1, ano: mes === 12 ? ano + 1 : ano }
}

const diasNoMes = (mes: number, ano: number) => new Date(ano, mes, 0).getDate()

/** Data de calendário como texto, sem passar por Date — armadilha 12 do CLAUDE.md. */
const dataISO = (ano: number, mes: number, dia: number) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

/**
 * Dia da semana de uma data de calendário. `new Date(ano, mes-1, dia)` é construção em horário
 * LOCAL (não é parse de string ISO), então é imune ao fuso do processo — o mesmo motivo pelo
 * qual `new Date(ano, mes, 0).getDate()` é seguro. Ver armadilha 12.
 */
const diaDaSemana = (ano: number, mes: number, dia: number) => new Date(ano, mes - 1, dia).getDay()

const gridVazio = (): Record<RowCategory, Record<number, string>> => ({
  'Regular': {},
  'Extra': {},
  'Plantão': {},
  'Sobreaviso': {}
})

const contagemVazia = (): Record<RowCategory, ContagemCategoria> => ({
  'Regular': { sugeridas: 0, abaixoDoLimiar: 0, afastamento: 0 },
  'Extra': { sugeridas: 0, abaixoDoLimiar: 0, afastamento: 0 },
  'Plantão': { sugeridas: 0, abaixoDoLimiar: 0, afastamento: 0 },
  'Sobreaviso': { sugeridas: 0, abaixoDoLimiar: 0, afastamento: 0 }
})

/**
 * Busca o resumo estatístico e o que mais o motor precisa.
 *
 * A estatística é pedida UMA VEZ, ancorada na primeira competência alvo. Os meses seguintes
 * reusam o mesmo resumo de propósito: prever outubro a partir do setembro que o próprio motor
 * acabou de inventar encadeia erro em cima de erro (~85% → 72% → 61% em três meses) e congela
 * um engano de setembro dentro de outubro e novembro. Cada mês é previsto a partir do último
 * mês REAL. A exceção é o ciclo de passo fixo, que é determinístico e precisa mesmo andar.
 */
async function buscarDados(
  supabase: SupabaseClient,
  servidorIds: string[],
  setorId: string,
  mes: number,
  ano: number,
  mesesHistorico: number,
  ultimoMesAlvo: { mes: number; ano: number }
) {
  const { data: estatistica, error: errEstat } = await supabase.rpc('fn_estatistica_escala_setor', {
    p_setor_id: setorId,
    p_mes: mes,
    p_ano: ano,
    p_meses: Math.min(Math.max(mesesHistorico, 1), MESES_HISTORICO_MAX)
  })

  if (errEstat) {
    throw new Error(`Não foi possível ler a estatística das escalas anteriores: ${errEstat.message}`)
  }

  const { mes: prevMes, ano: prevAno } = getPreviousMonth(mes, ano)

  // Jornada a herdar: a do mês anterior, com a vigência temporária do ÚLTIMO DIA daquele mês
  // vencendo o padrão. Sem isso, quem mudou de horário por redução judicial ou acordo voltava
  // silenciosamente ao horário antigo no mês seguinte. Ver CLAUDE.md, "A jornada do mês não tem
  // vigência". O critério do último dia é deliberado: vigência curta no meio do mês (um curso de
  // 5 dias) corretamente NÃO é herdada.
  const { data: prevScales, error: errScales } = await supabase
    .from('escala_mensal')
    .select('servidor_id, jornada_id')
    .eq('setor_id', setorId)
    .eq('mes', prevMes)
    .eq('ano', prevAno)
    .in('servidor_id', servidorIds)

  if (errScales) {
    throw new Error(`Erro ao ler as jornadas do mês anterior: ${errScales.message}`)
  }

  const jornadas: Record<string, string> = {}
  prevScales?.forEach(ps => {
    if (ps.servidor_id && ps.jornada_id) jornadas[ps.servidor_id] = ps.jornada_id
  })

  const ultimoDiaPrev = dataISO(prevAno, prevMes, diasNoMes(prevMes, prevAno))
  const { data: vigencias } = await supabase
    .from('servidores_jornadas_temporarias')
    .select('servidor_id, jornada_id, data_inicio, created_at')
    .in('servidor_id', servidorIds)
    .lte('data_inicio', ultimoDiaPrev)
    .gte('data_fim', ultimoDiaPrev)

  // Mesmo desempate de obter_jornada_servidor_data: a vigência registrada por último vence.
  ;[...(vigencias || [])]
    .sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
      String(a.data_inicio || '').localeCompare(String(b.data_inicio || ''))
    )
    .forEach(v => {
      if (v.servidor_id && v.jornada_id) jornadas[v.servidor_id] = v.jornada_id
    })

  // Afastamentos que cruzam QUALQUER competência alvo. O filtro correto de sobreposição é
  // (início <= fim_da_janela E fim >= início_da_janela) — a versão anterior usava `.or(...)`,
  // que é a disjunção e trazia praticamente todo evento já cadastrado.
  const inicioJanela = dataISO(ano, mes, 1)
  const fimJanela = dataISO(
    ultimoMesAlvo.ano,
    ultimoMesAlvo.mes,
    diasNoMes(ultimoMesAlvo.mes, ultimoMesAlvo.ano)
  )

  const { data: eventos, error: errEventos } = await supabase
    .from('servidores_eventos')
    .select('*, tipos_eventos(*)')
    .in('servidor_id', servidorIds)
    .lte('data_inicio', fimJanela)
    .gte('data_fim', inicioJanela)

  if (errEventos) {
    throw new Error(`Erro ao ler os afastamentos: ${errEventos.message}`)
  }

  const { data: servidores } = await supabase
    .from('servidores')
    .select('id, preferenca_turno')
    .in('id', servidorIds)

  return {
    estatistica: (estatistica || []) as LinhaEstatistica[],
    jornadas,
    eventos: eventos || [],
    preferencias: Object.fromEntries(
      (servidores || []).map(s => [s.id, s.preferenca_turno as string | null])
    ) as Record<string, string | null>
  }
}

/** (servidor, categoria) -> (dia da semana) -> linha da estatística. */
type Indice = Map<string, Map<number, LinhaEstatistica>>

function indexar(linhas: LinhaEstatistica[]): Indice {
  const idx: Indice = new Map()
  for (const l of linhas) {
    const chave = `${l.servidor_id}|${l.categoria}`
    if (!idx.has(chave)) idx.set(chave, new Map())
    idx.get(chave)!.set(l.dia_semana, l)
  }
  return idx
}

/**
 * Um ciclo de passo fixo (12x36 e parentes) não se descreve por dia da semana: ele anda pelo
 * calendário e faz a confiança de todo dia da semana cair para perto de 0,50, o que levaria o
 * motor a escalar dia sim, dia sim. Quando o passo do mês mais recente é consistente, o ciclo
 * manda — e a fase atravessa a virada do mês.
 *
 * ⚠️ Medido em 25/08/2026: apenas 2 dos 63 servidores tinham 12x36 detectável, e nem ciclo nem
 * dia da semana acertam bem neles (50% e 48% de precisão). Isto existe para NÃO REGREDIR o
 * comportamento que já havia, não porque esteja calibrado.
 */
const CICLO_CONSISTENCIA_MINIMA = 0.6

function ehCiclo(l: LinhaEstatistica | undefined): boolean {
  return !!l
    && l.ciclo_passo !== null && l.ciclo_passo >= 2 && l.ciclo_passo <= 7
    && l.ciclo_consistencia !== null && l.ciclo_consistencia >= CICLO_CONSISTENCIA_MINIMA
    && (l.ciclo_dias_no_mes ?? 0) >= 4
}

/** Estado da fase do ciclo entre um mês gerado e o seguinte. Chave: `servidor|categoria`. */
type FaseCiclo = Map<string, { proximoDia: number; passo: number; turnoId: string }>

function preverMes(
  idx: Indice,
  servidorIds: string[],
  mes: number,
  ano: number,
  options: GeneratorOptions,
  turnos: any[],
  preferencias: Record<string, string | null>,
  fase: FaseCiclo,
  primeiroMes: boolean,
  diasNoMesAnterior: number
): { grid: GridData; contagem: Record<RowCategory, ContagemCategoria> } {
  const grid: GridData = {}
  const contagem = contagemVazia()
  const dias = diasNoMes(mes, ano)
  const codigoPorId = new Map(turnos.map(t => [t.id, t.codigo]))

  for (const sId of servidorIds) {
    grid[sId] = gridVazio()

    for (const cat of options.categorias) {
      const porDow = idx.get(`${sId}|${cat}`)
      const chaveFase = `${sId}|${cat}`
      const amostra = porDow ? [...porDow.values()][0] : undefined

      // --- caminho A: ciclo de passo fixo ---
      if (options.respectContinuity && ehCiclo(amostra)) {
        const passo = amostra!.ciclo_passo!
        // O turno do ciclo é o mais pesado entre os dias da semana observados.
        const turnoId = [...porDow!.values()].sort((a, b) => b.peso - a.peso)[0].dicionario_turnos_id

        let proximo: number
        if (primeiroMes) {
          // Continua a partir do último dia trabalhado no mês de origem, atravessando a virada.
          proximo = amostra!.ciclo_ultimo_dia! + passo - diasNoMesAnterior
        } else {
          const guardado = fase.get(chaveFase)
          proximo = guardado ? guardado.proximoDia : 1
        }
        while (proximo < 1) proximo += passo

        for (let d = proximo; d <= dias; d += passo) {
          grid[sId][cat][d] = turnoId
          contagem[cat].sugeridas++
          proximo = d + passo
        }
        fase.set(chaveFase, { proximoDia: proximo - dias, passo, turnoId })
        continue
      }

      if (!porDow) continue

      // --- caminho B: dia da semana + confiança ---
      const limiar = LIMIAR_CONFIANCA[cat]
      const preferencia = options.respectPreferences ? preferencias[sId] : null

      for (let d = 1; d <= dias; d++) {
        const linha = porDow.get(diaDaSemana(ano, mes, d))
        if (!linha) continue

        if (linha.confianca >= limiar) {
          grid[sId][cat][d] = linha.dicionario_turnos_id
          contagem[cat].sugeridas++
          continue
        }

        // Preferência cadastrada baixa a barra — nunca cria célula sem histórico, só aceita o
        // vencedor quando ele já é o turno que o próprio servidor prefere.
        if (preferencia && preferencia !== 'Flexivel'
            && codigoPorId.get(linha.dicionario_turnos_id) === preferencia) {
          grid[sId][cat][d] = linha.dicionario_turnos_id
          contagem[cat].sugeridas++
          continue
        }

        contagem[cat].abaixoDoLimiar++
      }
    }
  }

  return { grid, contagem }
}

/**
 * Remove do rascunho tudo que cai em dia de afastamento.
 *
 * Roda mesmo com "Evitar Dias de Afastamento" desmarcado, e isso é deliberado: a opção governa
 * o padrão de folgas sugerido, não a regra do banco. `fn_prevent_shift_during_event` recusa
 * essas linhas de qualquer jeito, e o upsert vai em LOTE — uma linha inválida derruba o mês
 * inteiro de todos os servidores com uma exceção crua do Postgres (armadilha 14 do CLAUDE.md).
 */
function limparAfastamentos(
  grid: GridData,
  contagem: Record<RowCategory, ContagemCategoria>,
  eventos: any[],
  mes: number,
  ano: number,
  turnos: any[]
) {
  const dias = diasNoMes(mes, ano)
  const turnoPorId = new Map(turnos.map(t => [t.id, t]))

  for (const [sId, categorias] of Object.entries(grid)) {
    const doServidor = eventos.filter(ev => ev.servidor_id === sId && afastamentoBloqueiaEscala(ev))
    if (doServidor.length === 0) continue

    for (const ev of doServidor) {
      for (let d = 1; d <= dias; d++) {
        const iso = dataISO(ano, mes, d)
        if (iso < ev.data_inicio || iso > ev.data_fim) continue

        for (const cat of CATEGORIAS_GERAVEIS) {
          const turnoId = categorias[cat][d]
          if (!turnoId) continue
          const turno = turnoPorId.get(turnoId)
          if (afastamentoConflitaComSlots(ev, turno?.slots || [])) {
            delete categorias[cat][d]
            contagem[cat].sugeridas--
            contagem[cat].afastamento++
          }
        }
      }
    }
  }
}

export async function gerarEscalaInteligente(
  supabase: SupabaseClient,
  params: {
    unidadeId: string
    setorId: string
    mes: number
    ano: number
    escalaMensal: any[]
    turnos: any[]
    options: GeneratorOptions
    /** 1 = só o mês aberto na grade. 2+ acrescenta os meses seguintes. */
    quantidadeMeses: number
  }
): Promise<IntelligentScaleResult> {
  const { setorId, mes, ano, escalaMensal, turnos, options } = params
  const quantidade = Math.min(Math.max(params.quantidadeMeses || 1, 1), 12)
  const servidorIds = [...new Set(escalaMensal.map(em => em.servidor_id).filter(Boolean))] as string[]

  if (servidorIds.length === 0 || options.categorias.length === 0) {
    return { meses: [], jornadas: {}, servidoresSemHistorico: 0, mesesDeOrigemEncontrados: 0 }
  }

  // Lista das competências alvo, para a janela de afastamentos cobrir todas de uma vez.
  const alvos: { mes: number; ano: number }[] = [{ mes, ano }]
  for (let i = 1; i < quantidade; i++) {
    alvos.push(getNextMonth(alvos[i - 1].mes, alvos[i - 1].ano))
  }

  const dados = await buscarDados(
    supabase, servidorIds, setorId, mes, ano,
    options.mesesHistorico, alvos[alvos.length - 1]
  )

  const idx = indexar(dados.estatistica)
  const comHistorico = new Set(dados.estatistica.map(l => l.servidor_id))
  const mesesDeOrigemEncontrados = dados.estatistica.length > 0
    ? Math.max(...dados.estatistica.map(l => l.meses_com_escala))
    : 0

  const { mes: prevMes, ano: prevAno } = getPreviousMonth(mes, ano)
  const fase: FaseCiclo = new Map()
  const meses: MesGerado[] = []

  for (let i = 0; i < alvos.length; i++) {
    const alvo = alvos[i]
    const { grid, contagem } = preverMes(
      idx, servidorIds, alvo.mes, alvo.ano, options, turnos, dados.preferencias,
      fase, i === 0, diasNoMes(prevMes, prevAno)
    )

    limparAfastamentos(grid, contagem, dados.eventos, alvo.mes, alvo.ano, turnos)

    meses.push({
      mes: alvo.mes,
      ano: alvo.ano,
      naGrade: i === 0,
      grid,
      porCategoria: contagem,
      total: Object.values(contagem).reduce((a, c) => a + c.sugeridas, 0)
    })
  }

  return {
    meses,
    jornadas: dados.jornadas,
    servidoresSemHistorico: servidorIds.filter(s => !comHistorico.has(s)).length,
    mesesDeOrigemEncontrados
  }
}
