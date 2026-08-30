import { createAdminClient } from '@/utils/supabase/server'

/**
 * Dados do painel público de acompanhamento da implantação.
 *
 * ⚠️ SÓ AGREGADO. Nenhum dado pessoal sai daqui — nem nome, nem matrícula, nem CPF, nem horário
 * de servidor. A página é pública (sem login), então o que ela não puder mostrar numa reunião de
 * diretoria não pode ser consultado aqui. Nome de UNIDADE é informação pública; nome de pessoa,
 * não. Ver docs/planos/2026-08-23-auditoria-de-seguranca-e-lgpd.md.
 *
 * Usa `createAdminClient` porque a página não tem sessão. É o mesmo padrão de /api/cron: a
 * consulta é fechada aqui dentro e devolve só contagens.
 */

export interface UnidadeStatus {
  nome: string
  temRelogio: boolean
  relogios: number
  ativadoEm: string | null
  ultimoContato: string | null
  servidores: number
  setores: number
  escalados: number
  fonte: string | null
  /** operando = tem escala E relógio · preparando = tem escala · cadastrada = só cadastro */
  fase: 'operando' | 'preparando' | 'cadastrada'
}

/** Ranking de uso real no mês corrente. Só contagem — nenhum servidor é identificado. */
export interface UsoUnidade {
  nome: string
  registros: number
  /** Quantos servidores distintos bateram ponto — número, nunca quem. */
  servidoresAtivos: number
  escalados: number
  adesao: number
}

export interface PainelImplantacao {
  atualizadoEm: string
  unidades: UnidadeStatus[]
  totais: {
    unidades: number
    operando: number
    preparando: number
    cadastradas: number
    servidores: number
    setores: number
    relogios: number
    escalados: number
    /** Registros de AFD DO PERÍODO da implantação. Nunca o total da tabela. */
    afd: number
    /** Histórico que veio dentro dos equipamentos reaproveitados. Preservado, mas não é resultado. */
    afdHerdado: number
    sincronizacoes: number
    sincOk: number
  }
  marcacoesPorMes: { mes: string; total: number; rep: number; terminal: number; ajuste: number }[]
  escalasPorMes: { mes: string; total: number }[]
  ativacoes: { data: string; unidade: string }[]
  ranking: UsoUnidade[]
}

/**
 * Marco zero da implantação. Tudo que o painel conta começa aqui.
 *
 * ⚠️ SEM ISTO O NÚMERO MENTE. Vários relógios foram REAPROVEITADOS de outros sistemas e chegaram
 * com o AFD cheio — há registro de 2019. Medido em 23/08/2026: de 895.406 linhas de AFD, apenas
 * 6.061 são do período da implantação; 889.304 são histórico alheio. Exibir o total como
 * "registros coletados" infla o resultado em 147x e credita ao projeto trabalho que não é dele.
 * Ver a armadilha 20 do CLAUDE.md (`dispositivos_rep.ponto_valido_desde`).
 */
const INICIO_IMPLANTACAO = '2026-06-01'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * ⚠️ ARMADILHA 8 DO CLAUDE.md: o PostgREST devolve no máximo 1.000 linhas e NÃO avisa.
 *
 * Foi exatamente o que aconteceu na primeira versão deste painel: os três meses do gráfico
 * apareceram com "1.000" cravado, e o ranking contava no máximo mil marcações. O número não
 * parecia errado — parecia redondo.
 *
 * Onde só se precisa de QUANTOS, a saída certa nem é paginar: é `count: 'exact', head: true`,
 * que conta no banco e não traz linha nenhuma. Paginar fica para quando as linhas são
 * necessárias de fato (o ranking precisa saber quais servidores são distintos).
 */
async function contar(supabase: any, tabela: string, filtro?: (q: any) => any): Promise<number> {
  let q = supabase.from(tabela).select('id', { count: 'exact', head: true })
  if (filtro) q = filtro(q)
  const { count } = await q
  return count || 0
}

/** Traz TODAS as linhas, em páginas de 1.000. Use só quando as linhas importam. */
async function todas(supabase: any, tabela: string, colunas: string, filtro?: (q: any) => any): Promise<any[]> {
  const out: any[] = []
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas).range(de, de + 999)
    if (filtro) q = filtro(q)
    const { data } = await q
    const p = data || []
    out.push(...p)
    if (p.length < 1000) break
  }
  return out
}

/** Início e fim (exclusivo) de uma competência, em ISO. */
function janela(mes: number, ano: number) {
  const prox = new Date(ano, mes, 1)
  return {
    ini: `${ano}-${String(mes).padStart(2, '0')}-01`,
    fim: `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}-01`,
  }
}

/**
 * Painel completo. Devolve `null` quando o banco não responde — **e quem chama tem que tratar**.
 *
 * ⚠️ POR QUE `null` E NÃO ZEROS (corrigido em 30/08/2026)
 * Esta página tem `revalidate = 300`, o que faz o Next **PRÉ-RENDERIZÁ-LA NO BUILD**. No CI não
 * existe banco: as variáveis são `http://localhost:54321` e uma chave falsa. O fetch pendurava,
 * o Next tentava 3× com 60s cada e **o build inteiro morria**:
 *
 *     Failed to build /implantacao/page after 3 attempts.
 *     ⨯ Next.js build worker exited with code: 1
 *
 * 🚨 Isso deixou o CI VERMELHO por uma semana — do dia em que esta página entrou (23/08/2026,
 * `3c848e5`) até 30/08. 58 execuções seguidas falhando, e ninguém viu, porque o `tsc` e o
 * `build` locais passavam: a máquina de desenvolvimento tem `.env.production` e o build
 * **alcançava o banco de produção de verdade**. CI vermelho constante é CI mudo — durante toda
 * a auditoria de segurança ele não teria acusado regressão nenhuma.
 *
 * ⚠️ **`null`, nunca um objeto de zeros.** Um painel público mostrando "0 unidades operando"
 * é um NÚMERO, e quem lê acredita nele — é a armadilha 22 do CLAUDE.md (relatar o que se
 * calculou como se fosse o que aconteceu), na forma mais cara: um painel de acompanhamento para
 * a diretoria afirmando que a implantação não saiu do lugar. A página distingue "não sei" de
 * "zero" e diz qual dos dois é.
 */
/**
 * Teto de tempo da consulta.
 *
 * ⚠️ `try/catch` SOZINHO NÃO RESOLVE, e essa foi a parte que quase escapou: o que derrubava o
 * build não era uma exceção, era **pendurar** — e `catch` não pega o que nunca rejeita. O Next
 * desiste sozinho aos 60s e mata o worker; o teto precisa vir **antes** disso.
 *
 * 15s é folgado para um banco que responde em milissegundos e curto o bastante para o build
 * seguir em frente. Ao mexer aqui, mantenha bem abaixo dos 60s do Next.
 */
const TIMEOUT_MS = 15_000

export async function obterPainel(): Promise<PainelImplantacao | null> {
  let expirar: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      consultarPainel(),
      new Promise<never>((_, rej) => {
        expirar = setTimeout(() => rej(new Error(`consulta excedeu ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    // Log com contexto: no build do CI isto é esperado; em runtime é incidente de verdade.
    console.error('[implantacao] painel indisponivel (banco nao respondeu):', err)
    return null
  } finally {
    // Sem isto o timer segura o processo vivo depois de a consulta ter vencido a corrida —
    // num build, é o comando que não termina.
    if (expirar) clearTimeout(expirar)
  }
}

async function consultarPainel(): Promise<PainelImplantacao> {
  const supabase = await createAdminClient()

  const [{ data: unidades }, { data: setores }, { data: servidores }, { data: disp }] = await Promise.all([
    supabase.from('unidades').select('id, nome, ativo, fonte_ponto_oficial').order('nome'),
    // Paginados: hoje cabem em 1.000, mas o painel não pode passar a mentir quando crescerem.
    Promise.resolve({ data: await todas(supabase, 'setores', 'id, unidade_id') }),
    Promise.resolve({ data: await todas(supabase, 'servidores', 'id, unidade_id, status') }),
    supabase.from('dispositivos_rep').select('id, unidade_id, ativo, created_at, ultimo_contato_em'),
  ])

  // Competência corrente e as duas anteriores.
  const hoje = new Date()
  const comps: { mes: number; ano: number }[] = []
  for (let i = 2; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    comps.push({ mes: d.getMonth() + 1, ano: d.getFullYear() })
  }

  const escalas = await Promise.all(
    comps.map(c =>
      todas(supabase, 'escala_mensal', 'id, unidade_id, servidor_id',
        (q: any) => q.eq('mes', c.mes).eq('ano', c.ano)).then(data => ({ data }))
    )
  )

  const marcacoes = await Promise.all(
    comps.map(async c => {
      const { ini, fim } = janela(c.mes, c.ano)
      const noMes = (q: any) => q.gte('ocorrido_em', ini).lt('ocorrido_em', fim)
      const [total, rep, terminal, ajusteCoord, ajusteServ] = await Promise.all([
        contar(supabase, 'marcacoes_ponto', noMes),
        contar(supabase, 'marcacoes_ponto', (q: any) => noMes(q).eq('origem', 'rep')),
        contar(supabase, 'marcacoes_ponto', (q: any) => noMes(q).eq('origem', 'terminal')),
        contar(supabase, 'marcacoes_ponto', (q: any) => noMes(q).eq('origem', 'ajuste_coordenador')),
        contar(supabase, 'marcacoes_ponto', (q: any) => noMes(q).eq('origem', 'ajuste_servidor')),
      ])
      return {
        mes: `${MESES[c.mes - 1]}/${String(c.ano).slice(2)}`,
        total, rep, terminal, ajuste: ajusteCoord + ajusteServ,
      }
    })
  )

  // Uso real do mês corrente, por unidade. `marcacoes_ponto` já carrega unidade_id, então o
  // ranking sai de uma consulta só — e devolve CONTAGEM, nunca a lista de quem bateu.
  const compAtual = comps[comps.length - 1]
  const jAtual = janela(compAtual.mes, compAtual.ano)
  // Aqui as LINHAS importam: o ranking precisa de servidores DISTINTOS por unidade, e isso não
  // sai de um count. Então pagina — nunca um select cru, que pararia em 1.000.
  const marcAtual = await todas(supabase, 'marcacoes_ponto', 'unidade_id, servidor_id',
    (q: any) => q.gte('ocorrido_em', jAtual.ini).lt('ocorrido_em', jAtual.fim))

  const usoPorUn = new Map<string, { n: number; servs: Set<string> }>()
  for (const m of marcAtual as any[]) {
    if (!m.unidade_id) continue
    if (!usoPorUn.has(m.unidade_id)) usoPorUn.set(m.unidade_id, { n: 0, servs: new Set() })
    const u = usoPorUn.get(m.unidade_id)!
    u.n++
    if (m.servidor_id) u.servs.add(m.servidor_id)
  }

  const afd = await contar(supabase, 'rep_afd_registros', (q: any) => q.gte('ocorrido_em', INICIO_IMPLANTACAO))
  const afdHerdado = await contar(supabase, 'rep_afd_registros', (q: any) => q.lt('ocorrido_em', INICIO_IMPLANTACAO))
  const sincronizacoes = await contar(supabase, 'rep_sincronizacoes')
  const sincOk = await contar(supabase, 'rep_sincronizacoes', (q: any) => q.eq('status', 'concluida'))

  // A competência mais recente define quem está "operando".
  const escalaAtual = escalas[escalas.length - 1].data || []
  const escalaAnterior = escalas[escalas.length - 2]?.data || []
  const comEscala = new Set([...escalaAtual, ...escalaAnterior].map((e: any) => e.unidade_id))

  const dispPorUn = new Map<string, any[]>()
  for (const d of disp || []) {
    if (d.ativo === false) continue
    if (!dispPorUn.has(d.unidade_id)) dispPorUn.set(d.unidade_id, [])
    dispPorUn.get(d.unidade_id)!.push(d)
  }

  const escaladosPorUn = new Map<string, Set<string>>()
  for (const e of [...escalaAtual, ...escalaAnterior] as any[]) {
    if (!escaladosPorUn.has(e.unidade_id)) escaladosPorUn.set(e.unidade_id, new Set())
    escaladosPorUn.get(e.unidade_id)!.add(e.servidor_id)
  }

  const lista: UnidadeStatus[] = (unidades || [])
    .filter((u: any) => u.ativo !== false)
    .map((u: any): UnidadeStatus => {
      const ds = dispPorUn.get(u.id) || []
      const temRelogio = ds.length > 0
      const temEscala = comEscala.has(u.id)
      return {
        nome: u.nome,
        temRelogio,
        relogios: ds.length,
        ativadoEm: ds.length ? ds.map(d => d.created_at).sort()[0] : null,
        ultimoContato: ds.length
          ? ds.map(d => d.ultimo_contato_em).filter(Boolean).sort().slice(-1)[0] || null
          : null,
        servidores: (servidores || []).filter((s: any) => s.unidade_id === u.id && s.status === 'Ativo').length,
        setores: (setores || []).filter((s: any) => s.unidade_id === u.id).length,
        escalados: escaladosPorUn.get(u.id)?.size || 0,
        fonte: u.fonte_ponto_oficial,
        fase: temRelogio && temEscala ? 'operando' : temEscala ? 'preparando' : 'cadastrada',
      }
    })
    .sort((a: UnidadeStatus, b: UnidadeStatus) => {
      const ordem = { operando: 0, preparando: 1, cadastrada: 2 }
      if (ordem[a.fase] !== ordem[b.fase]) return ordem[a.fase] - ordem[b.fase]
      return b.escalados - a.escalados || a.nome.localeCompare(b.nome)
    })

  const ativacoes = (disp || [])
    .filter((d: any) => d.ativo !== false && d.created_at)
    .map((d: any) => ({
      data: String(d.created_at).slice(0, 10),
      unidade: (unidades || []).find((u: any) => u.id === d.unidade_id)?.nome || '—',
    }))
    .sort((a, b) => a.data.localeCompare(b.data))

  return {
    atualizadoEm: new Date().toISOString(),
    unidades: lista,
    totais: {
      unidades: lista.length,
      operando: lista.filter(u => u.fase === 'operando').length,
      preparando: lista.filter(u => u.fase === 'preparando').length,
      cadastradas: lista.filter(u => u.fase === 'cadastrada').length,
      servidores: (servidores || []).filter((s: any) => s.status === 'Ativo').length,
      setores: (setores || []).length,
      relogios: (disp || []).filter((d: any) => d.ativo !== false).length,
      escalados: new Set(([...escalaAtual, ...escalaAnterior] as any[]).map(e => e.servidor_id)).size,
      afd,
      afdHerdado,
      sincronizacoes,
      sincOk,
    },
    marcacoesPorMes: marcacoes,
    escalasPorMes: comps.map((c, i) => ({
      mes: `${MESES[c.mes - 1]}/${String(c.ano).slice(2)}`,
      total: (escalas[i].data || []).length,
    })),
    ativacoes,
    ranking: (unidades || [])
      .filter((u: any) => u.ativo !== false && usoPorUn.has(u.id))
      .map((u: any): UsoUnidade => {
        const uso = usoPorUn.get(u.id)!
        const esc = escaladosPorUn.get(u.id)?.size || 0
        return {
          nome: u.nome,
          registros: uso.n,
          servidoresAtivos: uso.servs.size,
          escalados: esc,
          adesao: esc > 0 ? Math.min(100, Math.round((uso.servs.size / esc) * 100)) : 0,
        }
      })
      .sort((a, b) => b.registros - a.registros),
  }
}
