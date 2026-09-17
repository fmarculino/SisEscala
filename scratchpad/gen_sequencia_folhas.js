/**
 * Extrai o miolo de `getServidoresFolhaPonto` para uma função interna, e cria
 * `getSequenciaFolhasPonto` — a MESMA consulta, sem o `autoCloseExpiredScalesAndTimesheets`.
 *
 * Por que separar: a barra de navegação da folha precisa da sequência a cada abertura de folha,
 * e o autoclose varre as escalas e folhas abertas da competência inteira (2.160 escalas em
 * 09/2026). Rodá-lo a cada seta seria pagar o fechamento automático para desenhar um contador.
 * O que NÃO pode acontecer é a barra ter uma consulta própria: aí a sequência divergiria da
 * lista que o usuário viu, que é justamente o defeito que a fonte única evita.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/folha-ponto/actions.ts'
let src = fs.readFileSync(path, 'utf8')

const CABECA = [
  "export async function getServidoresFolhaPonto(mes: number, ano: number, unidadeId?: string, setorId?: string) {",
  "  try {",
  "    await autoCloseExpiredScalesAndTimesheets()",
  "    const supabase = await createClient()"
].join('\r\n')

if (src.split(CABECA).length - 1 !== 1) {
  console.error('ABORTADO: cabeca de getServidoresFolhaPonto nao encontrada exatamente uma vez')
  process.exit(1)
}

const NOVA_CABECA = [
  "export async function getServidoresFolhaPonto(mes: number, ano: number, unidadeId?: string, setorId?: string) {",
  "  // O fechamento automatico continua atrelado a ABRIR A LISTA, como sempre esteve.",
  "  await autoCloseExpiredScalesAndTimesheets()",
  "  return listarServidoresDaCompetencia(mes, ano, unidadeId, setorId)",
  "}",
  "",
  "/**",
  " * A MESMA lista, sem o autoclose — e o que a barra de navegacao da folha consome.",
  " *",
  " * ⚠️ Ela NAO pode ganhar consulta propria: a sequencia percorrida pelas setas tem que ser",
  " * exatamente a lista de `/folha-ponto`. O filtro em memoria e a ordem ficam em",
  " * src/utils/folhaNavegacao.ts, compartilhados com a tela.",
  " */",
  "export async function getSequenciaFolhasPonto(mes: number, ano: number, unidadeId?: string, setorId?: string) {",
  "  return listarServidoresDaCompetencia(mes, ano, unidadeId, setorId)",
  "}",
  "",
  "async function listarServidoresDaCompetencia(mes: number, ano: number, unidadeId?: string, setorId?: string) {",
  "  try {",
  "    const supabase = await createClient()"
].join('\r\n')

src = src.split(CABECA).join(NOVA_CABECA)

const LOG_ANTIGO = "    console.error('Erro em getServidoresFolhaPonto:', error)"
if (src.split(LOG_ANTIGO).length - 1 !== 1) {
  console.error('ABORTADO: log do catch nao encontrado exatamente uma vez')
  process.exit(1)
}
src = src.split(LOG_ANTIGO).join("    console.error('Erro em listarServidoresDaCompetencia:', error)")

// Invariantes: o que a extracao nao pode ter deixado cair.
const invariantes = [
  ['autoclose continua em getServidoresFolhaPonto', "  await autoCloseExpiredScalesAndTimesheets()\r\n  return listarServidoresDaCompetencia"],
  ['autoclose NAO entrou na sequencia', "export async function getSequenciaFolhasPonto(mes: number, ano: number, unidadeId?: string, setorId?: string) {\r\n  return listarServidoresDaCompetencia(mes, ano, unidadeId, setorId)\r\n}"],
  ['guarda de perfil irrestrito preservada', "isAccessUnrestricted(userProfile) && !unidadeId"],
  ['guarda de acesso ao setor preservada', "hasSectorAccess(userProfile, setorId, unidadeId)"],
  ['applyAccessFilters preservado', "q = applyAccessFilters(q, userProfile)"],
  ['ordem unica preservada', "ordenarServidoresFolha(result)"],
  ['funcao interna nao e exportada', "\r\nasync function listarServidoresDaCompetencia("]
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error(`ABORTADO: invariante perdida — ${nome}`)
    process.exit(1)
  }
}
if ((src.match(/autoCloseExpiredScalesAndTimesheets\(\)/g) || []).length !== 1) {
  console.error('ABORTADO: o autoclose deve continuar sendo chamado UMA vez neste arquivo')
  process.exit(1)
}

fs.writeFileSync(path, src)
console.log('OK: miolo extraido, getSequenciaFolhasPonto criada, 7 invariantes conferidas')
