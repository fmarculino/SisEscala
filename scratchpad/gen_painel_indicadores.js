// Gerador da correcao dos indicadores do painel (05/09/2026).
// Substituicoes pontuais com contagem conferida — nada redigitado a mao (CLAUDE.md, armadilha 1).
// Os arquivos do projeto usam CRLF: normaliza na leitura e devolve como estava.
const fs = require('fs')
const P = 'src/app/(dashboard)/home/page.tsx'
const CR = String.fromCharCode(13), NL = String.fromCharCode(10)
let s = fs.readFileSync(P, 'utf8')
const CRLF = s.indexOf(CR + NL) >= 0
if (CRLF) s = s.split(CR + NL).join(NL)
const antes = s.length
let n = 0
function sub(velho, novo, esperado = 1) {
  const c = s.split(velho).length - 1
  if (c !== esperado) {
    console.error('ABORTA: ' + c + ' ocorrencia(s), esperado ' + esperado + NL + '---' + NL + velho.slice(0, 200) + NL + '---')
    process.exit(1)
  }
  s = s.split(velho).join(novo)
  n++
}

sub(
  "import { HistoricoChart } from './_components/HistoricoChart'",
  "import { HistoricoChart } from './_components/HistoricoChart'" + NL +
  "import { horasDaLinhaEscala, horasProntidaoSobreaviso } from '@/utils/escala/horasLinha'"
)

// ---------------- Em servico hoje: PESSOAS, nao linhas de escala ----------------
sub([
  '  // 3b. Em serviço hoje. "Ontem" saiu daqui junto com o painel de sobreaviso: quem cobre',
  '  // o turno noturno que atravessa a meia-noite agora é fn_painel_sobreaviso_dia. Só o NÚMERO',
  '  // importa aqui (exclui Sobreaviso) — head:true evita buscar e paginar linha nenhuma.',
  "  let emServicoQuery = supabase.from('escala_diaria')",
  "    .select('id, escala_mensal!inner(id, unidade_id, setor_id, mes, ano)', { count: 'exact', head: true })",
  "    .eq('dia', todayDay)",
  "    .eq('escala_mensal.mes', currentMonth)",
  "    .eq('escala_mensal.ano', currentYear)",
  "    .neq('categoria', 'Sobreaviso')",
  "  emServicoQuery = applyAccessFilters(emServicoQuery, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })"
].join(NL), [
  '  // 3b. Em serviço hoje. "Ontem" saiu daqui junto com o painel de sobreaviso: quem cobre',
  '  // o turno noturno que atravessa a meia-noite agora é fn_painel_sobreaviso_dia.',
  '  //',
  '  // ⚠️ ISTO CONTA PESSOAS, NÃO LINHAS DE ESCALA. Era uma contagem exata sobre escala_diaria,',
  '  // e quem tem Regular + Plantão no mesmo dia contava DUAS vezes: medido em produção em',
  '  // 05/09/2026, o card exibia 207 onde havia 188 servidores (+10%). O rótulo diz "em serviço",',
  '  // e isso é gente. Por isso deixou de ser head:true e passou a buscar servidor_id — paginado,',
  '  // porque agora traz LINHAS e o PostgREST corta em 1000 em silêncio (armadilha 8).',
  '  const emServicoPromise = buscarTodasPaginas<any>((from, to) => {',
  "    const q = supabase.from('escala_diaria')",
  "      .select('id, escala_mensal!inner(servidor_id, unidade_id, setor_id, mes, ano)')",
  "      .eq('dia', todayDay)",
  "      .eq('escala_mensal.mes', currentMonth)",
  "      .eq('escala_mensal.ano', currentYear)",
  "      .neq('categoria', 'Sobreaviso')",
  "      .order('id')",
  '      .range(from, to)',
  "    return applyAccessFilters(q, userProfile, { unidadeField: 'escala_mensal.unidade_id', setorField: 'escala_mensal.setor_id' })",
  '  })'
].join(NL))

// ---------------- consulta do grafico: jornada da escala + codigo do turno ----------------
sub([
  '        id, categoria,',
  '        dicionario_turnos(horas_computadas),',
  '        escala_mensal!inner(mes, ano, status, unidade_id, setor_id)'
].join(NL), [
  '        id, categoria,',
  '        dicionario_turnos(codigo, horas_computadas),',
  '        escala_mensal!inner(mes, ano, status, unidade_id, setor_id, jornadas(horas_totais, intervalo_minutos))'
].join(NL))

sub('    { count: emServicoHojeCount },', '    emServicoData,')
sub('    emServicoQuery,', '    emServicoPromise,')

sub([
  '  // Em serviço hoje (todos escalados para turnos ativos/regulares/plantão/extra hoje, excluindo sobreaviso)',
  '  const emServicoHoje = emServicoHojeCount || 0'
].join(NL), [
  '  // Em serviço hoje: SERVIDORES distintos, nunca linhas de escala (ver a consulta acima).',
  '  const emServicoHoje = new Set(',
  '    ((emServicoData || []) as any[]).map((l: any) => l.escala_mensal?.servidor_id).filter(Boolean)',
  '  ).size'
].join(NL))

// ---------------- Escalas Ativas: as duas contagens na MESMA grandeza ----------------
sub([
  "  const escalasAbertas = escalas.filter((e: any) => e.status !== 'Fechada').length",
  "  const escalasFechadas = escalas.filter((e: any) => e.status === 'Fechada').length",
  '  const totalEscalasCriadas = new Set(escalas.map((e: any) => `${e.unidade_id}|${e.setor_id}`)).size'
].join(NL), [
  '  // ⚠️ O CARD MISTURAVA DUAS GRANDEZAS NA MESMA FRASE. O número grande conta GRADES (pares',
  '  // unidade|setor); o subtítulo contava LINHAS de escala_mensal, que é uma por SERVIDOR. Medido',
  '  // em produção em 05/09/2026, competência 08/2026: o card dizia "113 Escalas Ativas" e, logo',
  '  // abaixo, "694 fechadas" — 694 de 113. As duas contagens estavam certas e respondiam',
  '  // perguntas diferentes. Agora as duas são de grades, e uma grade só conta como fechada quando',
  '  // TODAS as escalas dela estão Fechadas: fechar 3 servidores de 40 não fecha o setor.',
  '  const gradesPorSetor = new Map<string, { total: number; fechadas: number }>()',
  '  escalas.forEach((e: any) => {',
  '    const k = `${e.unidade_id}|${e.setor_id}`',
  '    const a = gradesPorSetor.get(k) || { total: 0, fechadas: 0 }',
  '    a.total++',
  "    if (e.status === 'Fechada') a.fechadas++",
  '    gradesPorSetor.set(k, a)',
  '  })',
  '  const totalEscalasCriadas = gradesPorSetor.size',
  '  const escalasFechadas = Array.from(gradesPorSetor.values()).filter(a => a.total === a.fechadas).length',
  '  const servidoresEscalados = new Set(escalas.map((e: any) => e.servidor_id)).size'
].join(NL))

sub(
  'sub: `De ${setoresCount} setores | ${escalasFechadas} fechadas` },',
  'sub: `${totalEscalasCriadas} de ${setoresCount} setores | ${escalasFechadas} com tudo fechado | ${servidoresEscalados} servidores escalados` },'
)

// ---------------- card Servidores: status fora de Ativo/Inativo sumiam dos dois ----------------
sub(
  'sub: `Hoje: ${emServicoHoje} em serviço | Inativos: ${servidoresInativos}` },',
  "sub: `Hoje: ${emServicoHoje} em serviço | Inativos: ${servidoresInativos}${servidoresOutrosStatus > 0 ? ` | Outros status: ${servidoresOutrosStatus}` : ''}` },"
)

fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
console.log(P + ': ' + n + ' substituicoes, ' + antes + ' -> ' + s.length + ' bytes')
