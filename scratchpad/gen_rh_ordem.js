// Conserta a ordem do /relatorios/rh depois da paginacao (05/09/2026): as declaracoes de
// jornadas/feriados/data/userProfile ficavam ENTRE a montagem da query e o applyAccessFilters,
// e ao envolver aquilo numa closure elas foram parar dentro dela. Sobem para antes.
const fs = require('fs')
const P = 'src/app/(dashboard)/relatorios/rh/page.tsx'
const CR = String.fromCharCode(13), NL = String.fromCharCode(10)
let s = fs.readFileSync(P, 'utf8')
const CRLF = s.indexOf(CR + NL) >= 0
if (CRLF) s = s.split(CR + NL).join(NL)
const antes = s.length

const DECL = [
  "  const { data: jornadas } = await supabase.from('jornadas').select('*')",
  "  const { data: feriados } = await supabase.from('feriados').select('*')",
  '',
  '  const today = new Date()',
  '  const currentDay = today.getDate()',
  '  const currentMonth = today.getMonth() + 1',
  '  const currentYear = today.getFullYear()',
  '',
  '  const userProfile = profile ? {',
  '    ...profile,',
  '    permitted_unidades: (profile as any).profile_unidades?.map((pu: any) => pu.unidade_id) || [],',
  '    permitted_setores: (profile as any).setores_no_escopo || []',
  '  } as UserProfile : null'
].join(NL)

const c = s.split(DECL).length - 1
if (c !== 1) { console.error('ABORTA: bloco de declaracoes achado ' + c + 'x, esperado 1'); process.exit(1) }

// 1. remove de onde esta (dentro da closure), com a linha em branco que o precede e a que o segue
const DENTRO = NL + NL + DECL + NL + NL
if (s.split(DENTRO).length - 1 !== 1) { console.error('ABORTA: contexto da remocao nao bate'); process.exit(1) }
s = s.split(DENTRO).join(NL + NL)

// 2. reinsere ANTES do comentario que abre a montagem da query
const ANCORA = '  // Fetch closed scales data for RH'
if (s.split(ANCORA).length - 1 !== 1) { console.error('ABORTA: ancora nao unica'); process.exit(1) }
s = s.split(ANCORA).join(DECL + NL + NL + ANCORA)

fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
console.log(P + ': declaracoes movidas para fora da closure, ' + antes + ' -> ' + s.length + ' bytes')
