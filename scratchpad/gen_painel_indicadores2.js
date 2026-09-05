// Parte 2 da correcao dos indicadores do painel (05/09/2026):
// total de servidores por status e o calculo do Comparativo Historico.
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

// ---- contagem total de servidores, para nao perder status fora de Ativo/Inativo ----
sub([
  "  let servidoresInativosQuery = supabase.from('servidores').select('id', { count: 'exact', head: true }).eq('status', 'Inativo')",
  '  servidoresInativosQuery = applyAccessFilters(servidoresInativosQuery, userProfile)'
].join(NL), [
  "  let servidoresInativosQuery = supabase.from('servidores').select('id', { count: 'exact', head: true }).eq('status', 'Inativo')",
  '  servidoresInativosQuery = applyAccessFilters(servidoresInativosQuery, userProfile)',
  '  // ⚠️ O CADASTRO TEM MAIS DE DOIS STATUS. Medido em 05/09/2026: 2.065 Ativo, 5 Inativo e 10',
  '  // "Afastado" — e esses 10 não apareciam em NENHUM dos dois números do card, some de um lado',
  '  // sem entrar no outro. O total serve para derivar o resto sem precisar enumerar os status',
  '  // (um status novo no cadastro passaria a ser somado sozinho, em vez de sumir em silêncio).',
  "  let servidoresTotalQuery = supabase.from('servidores').select('id', { count: 'exact', head: true })",
  '  servidoresTotalQuery = applyAccessFilters(servidoresTotalQuery, userProfile)'
].join(NL))

sub('    { count: servidoresInativosCount },', [
  '    { count: servidoresInativosCount },',
  '    { count: servidoresTotalCount },'
].join(NL))
sub('    servidoresInativosQuery,', [
  '    servidoresInativosQuery,',
  '    servidoresTotalQuery,'
].join(NL))
sub('  const servidoresInativos = servidoresInativosCount || 0', [
  '  const servidoresInativos = servidoresInativosCount || 0',
  '  const servidoresOutrosStatus = Math.max(0, (servidoresTotalCount || 0) - servidoresAtivos - servidoresInativos)'
].join(NL))

// ---- Comparativo Historico: fonte unica e sobreaviso a parte ----
sub([
  '  const chartData = (historicalResults as any[]).map((result: any) => {',
  '    let regular = 0, plantao = 0, sobreaviso = 0, extra = 0',
  '    ;(result.data || []).forEach((d: any) => {',
  "      const horas = Number(d.dicionario_turnos?.horas_computadas || 0)",
  '      const cat = d.categoria',
  "      if (cat === 'Regular') regular += horas",
  "      else if (cat === 'Plantão') plantao += horas",
  "      else if (cat === 'Sobreaviso') sobreaviso += horas",
  "      else if (cat === 'Extra') extra += horas",
  '    })',
  '    return { label: result.label, regular: Math.round(regular), plantao: Math.round(plantao), sobreaviso: Math.round(sobreaviso), extra: Math.round(extra) }',
  '  })'
].join(NL), [
  '  // 🚨 O REGULAR SOMAVA O VÃO DO RELÓGIO, CONTANDO O INTERVALO COMO JORNADA (armadilha 46).',
  '  //   Este painel era o ÚLTIMO lugar do sistema a fazer isso: a grade (calculateTotals), o',
  '  //   /relatorios/consolidado e a folha (desde 09/2026) já descontam. Medido em produção em',
  '  //   05/09/2026, competência 09/2026: o painel exibia 163.392h de Regular contra 126.169h das',
  '  //   outras três telas — 37.223h (22,8%) de diferença na mesma competência, com o número maior',
  '  //   justamente na tela usada para decidir. A conta agora tem fonte única em',
  '  //   src/utils/escala/horasLinha.ts, compartilhada com o consolidado.',
  '  //',
  '  // ⚠️ Sobreaviso é PRONTIDÃO, não trabalho: sai por horasProntidaoSobreaviso e é exibido com',
  '  //   rótulo próprio. horasDaLinhaEscala devolve 0 para ele de propósito, para que ninguém o',
  '  //   some ao lado das horas trabalhadas por descuido.',
  '  const chartData = (historicalResults as any[]).map((result: any) => {',
  '    let regular = 0, plantao = 0, sobreaviso = 0, extra = 0',
  '    ;(result.data || []).forEach((d: any) => {',
  '      const turno = d.dicionario_turnos',
  '      const jornada = d.escala_mensal?.jornadas',
  '      const cat = d.categoria',
  "      if (cat === 'Sobreaviso') {",
  '        sobreaviso += horasProntidaoSobreaviso(turno?.horas_computadas, turno?.codigo)',
  '        return',
  '      }',
  '      const horas = horasDaLinhaEscala(cat, turno?.horas_computadas, jornada)',
  "      if (cat === 'Regular') regular += horas",
  "      else if (cat === 'Plantão') plantao += horas",
  "      else if (cat === 'Extra') extra += horas",
  '    })',
  '    return { label: result.label, regular: Math.round(regular), plantao: Math.round(plantao), sobreaviso: Math.round(sobreaviso), extra: Math.round(extra) }',
  '  })'
].join(NL))

fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
console.log(P + ': ' + n + ' substituicoes, ' + antes + ' -> ' + s.length + ' bytes')
