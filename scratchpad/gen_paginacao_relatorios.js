// Paginacao dos 4 relatorios agregados (05/09/2026) — armadilha 8.
// Cada bloco `let query = ...` vira uma funcao montarQuery(from, to) passada a
// buscarTodasPaginas. A ordenacao explicita NAO e detalhe: sem ORDER BY o Postgres nao garante
// ordem entre paginas, e linha pode repetir numa e faltar noutra.
const fs = require('fs')
const CR = String.fromCharCode(13), NL = String.fromCharCode(10)
let total = 0

function editar(P, edicoes) {
  let s = fs.readFileSync(P, 'utf8')
  const CRLF = s.indexOf(CR + NL) >= 0
  if (CRLF) s = s.split(CR + NL).join(NL)
  const antes = s.length
  let n = 0
  for (const [velho, novo, esperado = 1] of edicoes) {
    const c = s.split(velho).length - 1
    if (c !== esperado) {
      console.error('ABORTA em ' + P + ': ' + c + ' ocorrencia(s), esperado ' + esperado + NL + '---' + NL + velho.slice(0, 240) + NL + '---')
      process.exit(1)
    }
    s = s.split(velho).join(novo)
    n++
  }
  fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
  console.log(P + ': ' + n + ' substituicoes, ' + antes + ' -> ' + s.length + ' bytes')
  total += n
}

const AVISO = [
  '  // ⚠️ PAGINADO (armadilha 8). Sem isto o PostgREST devolvia 1000 linhas e o relatório somava',
  '  // como se fosse tudo, sem erro nenhum. A medição de cada tela está em src/utils/paginacao.ts.'
].join(NL)

// ============================ CONSOLIDADO ============================
editar('src/app/(dashboard)/relatorios/consolidado/page.tsx', [
  [
    "import { applyAccessFilters, type UserProfile } from '@/utils/permissions'",
    "import { applyAccessFilters, type UserProfile } from '@/utils/permissions'" + NL +
    "import { buscarTodasPaginas } from '@/utils/paginacao'"
  ],
  [[
    '  // Main Query',
    '  let query = supabase',
    "    .from('escala_mensal')",
    '    .select(`',
    '      id, mes, ano, status, jornada_id,',
    '      servidores(nome, matricula, cargo, vinculo),',
    '      unidades(nome),',
    '      setores(dicionario_setores(nome)),',
    '      escala_diaria(',
    '        dia,',
    '        categoria,',
    '        dicionario_turnos(codigo, horas_computadas)',
    '      )',
    '    `)',
    "    .eq('mes', mes)",
    "    .eq('ano', ano)",
    '  ',
    '  if (!previsao) {',
    "    query = query.eq('status', 'Fechada')",
    '  }',
    '  ',
    "  if (unidadeId) query = query.eq('unidade_id', unidadeId)",
    "  if (setorId) query = query.eq('setor_id', setorId)",
    '',
    '  query = applyAccessFilters(query, userProfile)',
    '  const { data: reportData } = await query'
  ].join(NL), [
    '  // Main Query',
    AVISO,
    '  // 500 por página porque cada escala traz ~30 linhas de escala_diaria embutidas.',
    '  const montarQuery = (from: number, to: number) => {',
    '    let query = supabase',
    "      .from('escala_mensal')",
    '      .select(`',
    '        id, mes, ano, status, jornada_id,',
    '        servidores(nome, matricula, cargo, vinculo),',
    '        unidades(nome),',
    '        setores(dicionario_setores(nome)),',
    '        escala_diaria(',
    '          dia,',
    '          categoria,',
    '          dicionario_turnos(codigo, horas_computadas)',
    '        )',
    '      `)',
    "      .eq('mes', mes)",
    "      .eq('ano', ano)",
    '',
    '    if (!previsao) {',
    "      query = query.eq('status', 'Fechada')",
    '    }',
    '',
    "    if (unidadeId) query = query.eq('unidade_id', unidadeId)",
    "    if (setorId) query = query.eq('setor_id', setorId)",
    '',
    '    query = applyAccessFilters(query, userProfile)',
    "    return query.order('id').range(from, to)",
    '  }',
    '  const { linhas: reportData, completo: dadosCompletos } = await buscarTodasPaginas<any>(montarQuery, 500)'
  ].join(NL)]
])

// ============================ RH ============================
editar('src/app/(dashboard)/relatorios/rh/page.tsx', [
  [
    "import { applyAccessFilters, type UserProfile } from '@/utils/permissions'",
    "import { applyAccessFilters, type UserProfile } from '@/utils/permissions'" + NL +
    "import { buscarTodasPaginas } from '@/utils/paginacao'"
  ],
  [[
    '  // Fetch closed scales data for RH',
    '  let query = supabase',
    "    .from('escala_mensal')",
    '    .select(`',
    '      *,',
    '      servidores!inner(nome, cargo),',
    '      unidades!inner(nome),',
    '      escala_diaria(',
    '        dia,',
    '        categoria,',
    '        dicionario_turnos(codigo, horas_computadas, tipo)',
    '      )',
    '    `)',
    '',
    '  if (!previsao) {',
    "    query = query.eq('status', 'Fechada')",
    '  }'
  ].join(NL), [
    '  // Fetch closed scales data for RH',
    AVISO,
    '  //',
    '  // 🚨 ESTA TELA NÃO FILTRA PERÍODO: lista TODAS as competências, uma linha por (servidor,',
    '  //   mês). Sem paginar e sem ORDER BY, o corte de 1000 pegava um recorte ARBITRÁRIO de',
    '  //   2.362 escalas — 58% ausente, e sem garantia de ser o mesmo recorte a cada',
    '  //   carregamento. A ordenação por (ano, mês) estabiliza a paginação e de quebra deixa a',
    '  //   tabela legível, que é o motivo de alguém abrir este relatório.',
    '  const montarQuery = (from: number, to: number) => {',
    '    let query = supabase',
    "      .from('escala_mensal')",
    '      .select(`',
    '        *,',
    '        servidores!inner(nome, cargo),',
    '        unidades!inner(nome),',
    '        escala_diaria(',
    '          dia,',
    '          categoria,',
    '          dicionario_turnos(codigo, horas_computadas, tipo)',
    '        )',
    '      `)',
    '',
    '    if (!previsao) {',
    "      query = query.eq('status', 'Fechada')",
    '    }'
  ].join(NL)],
  [[
    '  query = applyAccessFilters(query, userProfile)',
    '',
    '  const { data } = await query',
    '  const reportData = (data || []) as RHReportItem[]'
  ].join(NL), [
    '    query = applyAccessFilters(query, userProfile)',
    "    return query.order('ano', { ascending: false }).order('mes', { ascending: false }).order('id').range(from, to)",
    '  }',
    '',
    '  const { linhas: data, completo: dadosCompletos } = await buscarTodasPaginas<any>(montarQuery, 500)',
    '  const reportData = (data || []) as RHReportItem[]'
  ].join(NL)]
])

// ============================ DISTRIBUICAO ============================
editar('src/app/(dashboard)/relatorios/distribuicao/page.tsx', [
  [
    "import { applyAccessFilters } from '@/utils/permissions'",
    "import { applyAccessFilters } from '@/utils/permissions'" + NL +
    "import { buscarTodasPaginas } from '@/utils/paginacao'"
  ],
  [[
    '  // Fetch all Plantão shifts for the period',
    '  let query = supabase',
    "    .from('escala_diaria')",
    '    .select(`',
    '      dia,',
    '      categoria,',
    '      dicionario_turnos(codigo, horas_computadas, tipo),',
    '      escala_mensal!inner(',
    '        unidade_id,',
    '        setor_id,',
    '        status,',
    '        servidores(nome)',
    '      )',
    '    `)',
    "    .eq('escala_mensal.mes', mes)",
    "    .eq('escala_mensal.ano', ano)",
    "    .eq('categoria', 'Plantão')",
    '',
    '  if (!previsao) {',
    "    query = query.eq('escala_mensal.status', 'Fechada')",
    '  }',
    '',
    "  if (unidadeId) query = query.eq('escala_mensal.unidade_id', unidadeId)",
    "  if (setorId) query = query.eq('escala_mensal.setor_id', setorId)",
    '',
    '  // Apply access filters manually to the joined table',
    "  query = applyAccessFilters(query, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })"
  ].join(NL), [
    '  // Fetch all Plantão shifts for the period',
    AVISO,
    '  // Em 09/2026 são 2.338 plantões: a tela via 1000 e o mapa de distribuição por dia ficava',
    '  // com 57% dos plantões faltando, sem nada indicando isso.',
    '  const montarQuery = (from: number, to: number) => {',
    '    let query = supabase',
    "      .from('escala_diaria')",
    '      .select(`',
    '        id,',
    '        dia,',
    '        categoria,',
    '        dicionario_turnos(codigo, horas_computadas, tipo),',
    '        escala_mensal!inner(',
    '          unidade_id,',
    '          setor_id,',
    '          status,',
    '          servidores(nome)',
    '        )',
    '      `)',
    "      .eq('escala_mensal.mes', mes)",
    "      .eq('escala_mensal.ano', ano)",
    "      .eq('categoria', 'Plantão')",
    '',
    '    if (!previsao) {',
    "      query = query.eq('escala_mensal.status', 'Fechada')",
    '    }',
    '',
    "    if (unidadeId) query = query.eq('escala_mensal.unidade_id', unidadeId)",
    "    if (setorId) query = query.eq('escala_mensal.setor_id', setorId)",
    '',
    '    // Apply access filters manually to the joined table',
    "    query = applyAccessFilters(query, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })",
    "    return query.order('id').range(from, to)",
    '  }'
  ].join(NL)],
  [
    '  const { data: rawData } = await query',
    '  const { linhas: rawData, completo: dadosCompletos } = await buscarTodasPaginas<any>(montarQuery)'
  ]
])

// ============================ PLANTAO-SOBREAVISO ============================
editar('src/app/(dashboard)/relatorios/plantao-sobreaviso/page.tsx', [
  [
    "import { applyAccessFilters } from '@/utils/permissions'",
    "import { applyAccessFilters } from '@/utils/permissions'" + NL +
    "import { buscarTodasPaginas } from '@/utils/paginacao'"
  ],
  [[
    '  let scaleQuery = supabase',
    "    .from('escala_mensal')"
  ].join(NL), [
    AVISO,
    '  // Aqui o filtro de MESES é aplicado depois, em JS (`filteredScales`), então sem paginar o',
    '  // corte de 1000 acontecia sobre o ANO inteiro — 2.362 escalas em 2026 — e o período pedido',
    '  // era recortado de uma amostra arbitrária.',
    '  const montarScaleQuery = (from: number, to: number) => {',
    '  let scaleQuery = supabase',
    "    .from('escala_mensal')"
  ].join(NL)],
  [[
    '  // Apply access filters for coordinator or admin restriction',
    '  scaleQuery = applyAccessFilters(scaleQuery, userProfile)',
    '  const { data: rawScales } = await scaleQuery'
  ].join(NL), [
    '  // Apply access filters for coordinator or admin restriction',
    '  scaleQuery = applyAccessFilters(scaleQuery, userProfile)',
    "    return scaleQuery.order('ano').order('mes').order('id').range(from, to)",
    '  }',
    '  const { linhas: rawScales, completo: dadosCompletos } = await buscarTodasPaginas<any>(montarScaleQuery, 500)'
  ].join(NL)]
])

console.log('TOTAL: ' + total + ' substituicoes')
