// Gerador da mudanca de autorizacao da avaliacao de transferencia (28/08/2026).
// Substituicoes pontuais com contagem — aborta na divergencia (CLAUDE.md, armadilha 1).
const fs = require('fs')
const p = 'src/app/(dashboard)/servidores/actions.ts'
let s = fs.readFileSync(p, 'utf8')

function rep(old, novo, n = 1) {
  const partes = s.split(old)
  if (partes.length - 1 !== n) {
    console.error(`ABORTA: esperava ${n} ocorrencia(s), achei ${partes.length - 1} de:\n${old.slice(0, 200)}`)
    process.exit(1)
  }
  s = partes.join(novo)
}

rep(
  "import { validarDataTransferencia } from '@/utils/transferValidation'\r\n",
  "import { validarDataTransferencia } from '@/utils/transferValidation'\r\n" +
  "import { avaliarPermissaoTransferencia, ehAvaliadorDeTransferencia, ERRO_PAPEL_SEM_PODER } from '@/utils/avaliacaoTransferencia'\r\n",
)

rep(
`/**\r
 * Aprova ou rejeita um pedido de transferência de unidade/setor (v1.43.0). Só \`super_admin\` —\r
 * a RLS de \`solicitacoes_transferencia_servidor\` (20260811110000) já recusaria o \`UPDATE\` de\r
 * qualquer outro papel, mas a checagem aqui dá mensagem legível em vez do erro cru da policy.\r
 *\r
 * Aprovar reaproveita \`registrarTransferenciaEfetivada\` — a mesma função que \`updateServidor\`\r
 * usa pra transferência direta do super_admin — pra não ter duas cópias da limpeza de escala.\r
 */\r
`,
`/**\r
 * Aprova ou rejeita um pedido de transferência de unidade/setor (v1.43.0). Desde 28/08/2026\r
 * também o RH Geral (\`rh\`) e o RH da Unidade (\`rh_unidade\`, dentro das unidades dele) — a regra\r
 * é \`src/utils/avaliacaoTransferencia.ts\`, a MESMA que a tela usa pra decidir os botões e que a\r
 * policy de UPDATE (20260828100000) aplica no banco.\r
 *\r
 * A checagem aqui não é redundante com a RLS: é ela que dá mensagem legível em vez do erro cru\r
 * da policy, e é a única camada que distingue "não é seu papel" de "não é sua unidade". Server\r
 * action é um POST cujo id sai no bundle — a tela nunca protegeu nada (armadilha 12).\r
 *\r
 * Aprovar reaproveita \`registrarTransferenciaEfetivada\` — a mesma função que \`updateServidor\`\r
 * usa pra transferência direta — pra não ter duas cópias da limpeza de escala.\r
 */\r
`,
)

rep(
`  const { data: { user: avaliador } } = await supabase.auth.getUser()\r
  const { data: perfilAvaliador } = await supabase\r
    .from('profiles')\r
    .select('role')\r
    .eq('id', avaliador?.id)\r
    .single()\r
\r
  if (perfilAvaliador?.role !== 'super_admin') {\r
    return { error: 'Só o administrador geral pode avaliar solicitações de transferência.' }\r
  }\r
`,
`  const { data: { user: avaliador } } = await supabase.auth.getUser()\r
  const { data: perfilAvaliador } = await supabase\r
    .from('profiles')\r
    .select('role, profile_unidades(unidade_id), profile_setores(setores(unidade_id))')\r
    .eq('id', avaliador?.id)\r
    .single()\r
\r
  if (!ehAvaliadorDeTransferencia(perfilAvaliador?.role)) {\r
    return { error: ERRO_PAPEL_SEM_PODER }\r
  }\r
\r
  // Une a unidade vinculada direto com a alcançada só por um setor — quem tem acesso inteiramente\r
  // por \`profile_setores\` (sem a unidade-pai vinculada) ficaria com escopo vazio aqui, o mesmo\r
  // buraco que \`fn_unidade_no_escopo\` tem e \`fn_unidade_alcancavel_por_setor\` cobre no SQL.\r
  const escopoAvaliador = {\r
    role: perfilAvaliador?.role as string | null | undefined,\r
    unidadesPermitidas: Array.from(new Set([\r
      ...(((perfilAvaliador as any)?.profile_unidades || []) as any[]).map(pu => pu.unidade_id),\r
      ...(((perfilAvaliador as any)?.profile_setores || []) as any[])\r
        .map(ps => (Array.isArray(ps.setores) ? ps.setores[0] : ps.setores)?.unidade_id),\r
    ].filter(Boolean))) as string[],\r
  }\r
`,
)

rep(
`  if (acao === 'rejeitar') {\r
    if (!parecer || parecer.trim().length < 5) {\r
      return { error: 'Informe o motivo da rejeição (mínimo 5 caracteres).' }\r
    }\r
`,
`  if (acao === 'rejeitar') {\r
    // Rejeitar não escreve em \`servidores\`, então basta a origem estar no escopo de quem avalia.\r
    const permissaoRejeitar = avaliarPermissaoTransferencia(\r
      escopoAvaliador,\r
      { unidadeOrigemId: solicitacao.unidade_origem_id, unidadeDestinoId: solicitacao.unidade_destino_id },\r
      'rejeitar',\r
    )\r
    if (!permissaoRejeitar.ok) {\r
      return { error: permissaoRejeitar.erro }\r
    }\r
\r
    if (!parecer || parecer.trim().length < 5) {\r
      return { error: 'Informe o motivo da rejeição (mínimo 5 caracteres).' }\r
    }\r
`,
)

rep(
`  if (!finalUnidadeDestinoId || !finalSetorDestinoId) {\r
    return { error: 'Para aprovar a transferência, por favor selecione a unidade e o setor de destino do servidor.' }\r
  }\r
`,
`  if (!finalUnidadeDestinoId || !finalSetorDestinoId) {\r
    return { error: 'Para aprovar a transferência, por favor selecione a unidade e o setor de destino do servidor.' }\r
  }\r
\r
  // Escopo conferido sobre o destino FINAL (o do pedido OU o que o avaliador acabou de escolher)\r
  // — checar só o do pedido deixaria o RH da Unidade mandar alguém pra fora do escopo dele pelo\r
  // \`<select>\` da própria aprovação.\r
  const permissaoAprovar = avaliarPermissaoTransferencia(\r
    escopoAvaliador,\r
    { unidadeOrigemId: solicitacao.unidade_origem_id, unidadeDestinoId: finalUnidadeDestinoId },\r
    'aprovar',\r
  )\r
  if (!permissaoAprovar.ok) {\r
    return { error: permissaoAprovar.erro }\r
  }\r
`,
)

// Invariantes estruturais do arquivo inteiro.
const invariantes = [
  ["avaliarPermissaoTransferencia(", 2],
  ["export async function avaliarSolicitacaoTransferencia(", 1],
  ["registrarTransferenciaEfetivada(supabase, {", 2],
]
for (const [alvo, esperado] of invariantes) {
  const achou = s.split(alvo).length - 1
  if (achou !== esperado) {
    console.error(`ABORTA (invariante): "${alvo}" aparece ${achou}x, esperado ${esperado}x`)
    process.exit(1)
  }
}

fs.writeFileSync(p, s)
console.log('actions.ts atualizado')
