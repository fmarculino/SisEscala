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

async function contar(supabase: any, tabela: string, filtro?: (q: any) => any): Promise<number> {
  let q = supabase.from(tabela).select('id', { count: 'exact', head: true })
  if (filtro) q = filtro(q)
  const { count } = await q
  return count || 0
}

export async function obterPainel(): Promise<PainelImplantacao> {
  const supabase = await createAdminClient()

  const [{ data: unidades }, { data: setores }, { data: servidores }, { data: disp }] = await Promise.all([
    supabase.from('unidades').select('id, nome, ativo, fonte_ponto_oficial').order('nome'),
    supabase.from('setores').select('id, unidade_id'),
    supabase.from('servidores').select('id, unidade_id, status'),
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
      supabase.from('escala_mensal').select('id, unidade_id, servidor_id').eq('mes', c.mes).eq('ano', c.ano)
    )
  )

  const marcacoes = await Promise.all(
    comps.map(async c => {
      const ini = `${c.ano}-${String(c.mes).padStart(2, '0')}-01`
      const prox = new Date(c.ano, c.mes, 1)
      const fim = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}-01`
      const { data } = await supabase
        .from('marcacoes_ponto')
        .select('origem')
        .gte('ocorrido_em', ini)
        .lt('ocorrido_em', fim)
      const rows = data || []
      return {
        mes: `${MESES[c.mes - 1]}/${String(c.ano).slice(2)}`,
        total: rows.length,
        rep: rows.filter((r: any) => r.origem === 'rep').length,
        terminal: rows.filter((r: any) => r.origem === 'terminal').length,
        ajuste: rows.filter((r: any) => String(r.origem).startsWith('ajuste')).length,
      }
    })
  )

  // Uso real do mês corrente, por unidade. `marcacoes_ponto` já carrega unidade_id, então o
  // ranking sai de uma consulta só — e devolve CONTAGEM, nunca a lista de quem bateu.
  const compAtual = comps[comps.length - 1]
  const iniAtual = `${compAtual.ano}-${String(compAtual.mes).padStart(2, '0')}-01`
  const proxAtual = new Date(compAtual.ano, compAtual.mes, 1)
  const fimAtual = `${proxAtual.getFullYear()}-${String(proxAtual.getMonth() + 1).padStart(2, '0')}-01`
  const { data: marcAtual } = await supabase
    .from('marcacoes_ponto')
    .select('unidade_id, servidor_id')
    .gte('ocorrido_em', iniAtual)
    .lt('ocorrido_em', fimAtual)

  const usoPorUn = new Map<string, { n: number; servs: Set<string> }>()
  for (const m of (marcAtual || []) as any[]) {
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
