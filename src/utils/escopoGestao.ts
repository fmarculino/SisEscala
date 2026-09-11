/**
 * Quem gerencia O QUE, e dentro de quais unidades — a regra compartilhada por `/marcacoes` e
 * `/servidores/pendencias`.
 *
 * Ate 10/09/2026 as duas telas escreviam papel a mao, cada uma do seu jeito:
 *
 *   /marcacoes                 `const isAdmin = ['admin','super_admin'].includes(role)`
 *   /servidores/pendencias     `const isFullAdmin = role === 'super_admin' || 'admin' || 'rh'`
 *
 * Resultado medido: as 4 abas de infraestrutura de `/marcacoes` (Terminais, Dispositivos REP,
 * Higiene, Pendrive) ficavam invisiveis para os 8 RH Geral e os 9 RH da Unidade, e o ramo
 * escopado de `/servidores/pendencias` mandava `[]` LITERAL em documentos invalidos, sem CPF,
 * duplicidades e contadores — o RH da Unidade abria a tela sem nenhum diagnostico. Allowlist de
 * papel envelhece em silencio (armadilha 44 do CLAUDE.md): `rh` e `rh_unidade` nasceram depois
 * de quase todas essas condicoes.
 *
 * A regra, decidida com o usuario em 10/09/2026 — "RH Geral acesso total, RH da Unidade acesso
 * as respectivas unidades":
 *
 *   super_admin · admin · rh   irrestrito (a mesma lista que `fn_unidade_no_escopo` ja trata
 *                              como irrestrita no banco — `rh` entra aqui por PAPEL, e nao pela
 *                              caixa "Acesso Total", que e' de onde ele tira o alcance hoje)
 *   rh_unidade                 as unidades de `profile_unidades`, somadas as alcancadas por um
 *                              setor vinculado (`profile_setores` → `setores.unidade_id`)
 *   demais papeis              nao gerenciam infraestrutura nem veem diagnostico de cadastro
 *
 * ⚠️ Isto NAO e' defesa. Server action e' um POST cujo id sai no bundle e RPC e' chamavel direto
 * (armadilhas 12 e 33): a mesma regra vive em `fn_pode_gerir_marcacoes` /
 * `fn_pode_ver_diagnostico_cadastro` no banco, e e' o banco que recusa. Este modulo decide o que
 * a TELA mostra e o que a ACTION aceita antes de chamar — as tres pontas, uma regra so'.
 *
 * ⚠️ `acesso_todas_unidades` NAO amplia `rh_unidade`. E' a mesma assimetria de
 * `avaliacaoTransferencia.ts`: o braco de `rh_unidade` na RLS de `servidores` olha unicamente
 * `profile_unidades`, entao honrar a flag aqui liberaria na tela o que o banco recusaria.
 */

export interface EscopoGestao {
  role: string | null | undefined
  /** `profile_unidades` unido com as unidades alcancadas por `profile_setores`. */
  unidadesPermitidas: string[]
}

/** Papeis que enxergam o parque inteiro, sem filtro de unidade. */
const PAPEIS_IRRESTRITOS = ['super_admin', 'admin', 'rh'] as const
/** Papeis escopados por unidade. */
const PAPEIS_ESCOPADOS = ['rh_unidade'] as const
/** Quem mescla dois cadastros de servidor — ver `podeMesclarCadastros`. */
const PAPEIS_MESCLAGEM = ['super_admin', 'rh'] as const

export const ERRO_SEM_GESTAO_MARCACOES =
  'Só o Administrador Geral, o Diretor, o RH Geral ou o RH da Unidade podem gerenciar relógios e terminais.'

export const ERRO_UNIDADE_FORA_DO_ESCOPO =
  'Este equipamento é de uma unidade fora do seu escopo. Só o RH Geral ou o Administrador Geral alcançam as outras unidades.'

export const ERRO_SEM_DIAGNOSTICO_CADASTRO =
  'Só o Administrador Geral, o Diretor, o RH Geral ou o RH da Unidade podem ver as pendências de cadastro.'

export const ERRO_SEM_MESCLAGEM =
  'Só o RH Geral ou o Administrador Geral podem mesclar cadastros: a mesclagem move ponto, escala e folha entre unidades.'

function ehIrrestrito(role: string | null | undefined): boolean {
  return PAPEIS_IRRESTRITOS.includes(role as (typeof PAPEIS_IRRESTRITOS)[number])
}

function ehEscopado(role: string | null | undefined): boolean {
  return PAPEIS_ESCOPADOS.includes(role as (typeof PAPEIS_ESCOPADOS)[number])
}

/** O papel enxerga o parque/base inteiro, sem filtro de unidade? */
export function gerenciaSemEscopo(role: string | null | undefined): boolean {
  return ehIrrestrito(role)
}

/**
 * O papel e' recortado por unidade (hoje so' `rh_unidade`)?
 *
 * ⚠️ Existe para NAO estreitar de lado quem nunca esteve neste modelo. Em telas que ja eram
 * visiveis ao coordenador/ass_adm antes desta mudanca (a aba Autorizacoes de /marcacoes, por
 * exemplo, que ele abre para conferir a vigencia antes de declarar em massa), `filtrarPorUnidade`
 * devolveria lista VAZIA para eles — uma regressao silenciosa, e fora do que foi pedido. O
 * recorte novo se aplica a quem o recorte novo descreve; o resto fica como estava. Estreitar
 * coordenador e' decisao propria, com medicao propria.
 */
export function ehEscopadoPorUnidade(role: string | null | undefined): boolean {
  return ehEscopado(role)
}

/** Ve as abas de infraestrutura de `/marcacoes` (Terminais, Dispositivos, Higiene, Pendrive)? */
export function podeGerirMarcacoes(role: string | null | undefined): boolean {
  return ehIrrestrito(role) || ehEscopado(role)
}

/** Ve o diagnostico de `/servidores/pendencias` (documentos, sem CPF, duplicidades)? */
export function podeVerDiagnosticoCadastro(role: string | null | undefined): boolean {
  return ehIrrestrito(role) || ehEscopado(role)
}

/**
 * Mescla dois cadastros de servidor?
 *
 * ⚠️ NAO segue a regra dos outros: `rh_unidade` VE a lista e o diagnostico, mas nao mescla —
 * decisao do usuario em 10/09/2026, com o numero na frente. Medido em producao: dos 62 grupos
 * mesclaveis, **27 atravessam unidade** e **31 ja tem ponto, escala ou folha** em pelo menos um
 * lado. Mesclar move esses registros de um cadastro para o outro e inativa o que sai — num grupo
 * cruzado isso e' mover ponto de uma unidade que nao e' a dele. Ele identifica e escala; quem
 * executa e' o RH Geral. O botao vem desabilitado COM o motivo escrito, nunca cinza e mudo
 * (armadilha 31).
 */
export function podeMesclarCadastros(role: string | null | undefined): boolean {
  return PAPEIS_MESCLAGEM.includes(role as (typeof PAPEIS_MESCLAGEM)[number])
}

/** A unidade esta no alcance deste perfil? `null` nunca passa para quem e' escopado. */
export function unidadeNoEscopo(escopo: EscopoGestao, unidadeId: string | null | undefined): boolean {
  if (ehIrrestrito(escopo.role)) return true
  if (!ehEscopado(escopo.role)) return false
  if (!unidadeId) return false
  return escopo.unidadesPermitidas.includes(unidadeId)
}

/** Filtra uma lista pelo escopo. Item sem unidade some para quem e' escopado — na duvida, fecha. */
export function filtrarPorUnidade<T>(
  escopo: EscopoGestao,
  itens: T[],
  obterUnidadeId: (item: T) => string | null | undefined,
): T[] {
  if (ehIrrestrito(escopo.role)) return itens
  if (!ehEscopado(escopo.role)) return []
  return itens.filter((i) => unidadeNoEscopo(escopo, obterUnidadeId(i)))
}

/**
 * Um GRUPO de duplicidade aparece quando ao menos um cadastro dele esta no escopo — e aparece
 * INTEIRO, com o cadastro da outra unidade visivel.
 *
 * ⚠️ Decisao do usuario em 10/09/2026, com o numero na frente: no HMI, **40 dos 52** grupos de
 * possiveis duplicidades tem membro de outra unidade (no HMM, 43 de 120). Exigir que o grupo
 * inteiro estivesse no escopo deixaria o RH do HMI com 12 grupos de 52 — e os 63 grupos cruzados
 * da base continuariam sem dono na ponta. Esconder metade do grupo tambem nao serve: a duplicata
 * E' o mesmo CPF em dois lugares, e sem o outro lado nao ha como julgar se e' a mesma pessoa.
 */
export function grupoNoEscopo(escopo: EscopoGestao, unidadesDoGrupo: (string | null | undefined)[]): boolean {
  if (ehIrrestrito(escopo.role)) return true
  if (!ehEscopado(escopo.role)) return false
  return unidadesDoGrupo.some((u) => unidadeNoEscopo(escopo, u))
}

/**
 * Monta o escopo a partir do `profiles` ja carregado pela pagina.
 *
 * ⚠️ A uniao com `profile_setores` nao e' zelo: `fn_unidade_no_escopo` sozinha so' olha
 * `profile_unidades`, e um perfil cujo acesso vem inteiramente de setor vinculado abriria a tela
 * vazia sem nenhuma mensagem (e' o mesmo bug que `fn_unidade_alcancavel_por_setor` existe para
 * complementar — CLAUDE.md).
 */
export function montarEscopoGestao(perfil: any): EscopoGestao {
  const porSetor = ((perfil?.profile_setores || []) as any[])
    .map((ps: any) => (Array.isArray(ps.setores) ? ps.setores[0] : ps.setores)?.unidade_id)
    .filter(Boolean)
  const diretas = ((perfil?.profile_unidades || []) as any[])
    .map((pu: any) => pu.unidade_id)
    .filter(Boolean)
  return {
    role: perfil?.role ?? null,
    unidadesPermitidas: Array.from(new Set<string>([...diretas, ...porSetor])),
  }
}
