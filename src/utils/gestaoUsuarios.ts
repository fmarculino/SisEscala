/**
 * Quem pode gerenciar quem na tela /usuarios — FONTE ÚNICA (22/08/2026).
 *
 * Até aqui a tela era `super_admin` puro e a autorização vivia num `if` da página: as server
 * actions (`createUser`/`updateUser`/`resetPassword`/`toggleUserStatus`/`deleteUser`) não
 * conferiam papel nenhum. Server action é um POST descoberto pelo bundle — a mesma lição da
 * armadilha 12 do CLAUDE.md ("tela filtrada não protege a RPC"). Abrir o menu para o RH sem
 * fechar as actions daria a qualquer autenticado o poder de fabricar um Administrador Geral.
 *
 * As regras vivem aqui e são aplicadas nos três lugares: página (o que a lista mostra),
 * client (o que o formulário oferece) e actions (o que o servidor aceita de fato).
 */

export type PapelGestor = 'super_admin' | 'rh' | 'rh_unidade'

/** Só estes três abrem a tela. Diretor, Coordenador e Ass. Administrativo continuam de fora. */
export const PAPEIS_GESTORES: PapelGestor[] = ['super_admin', 'rh', 'rh_unidade']

export function ehPapelGestor(role: string | null | undefined): role is PapelGestor {
  return PAPEIS_GESTORES.includes(role as PapelGestor)
}

/**
 * Que papéis cada gestor pode ATRIBUIR.
 *
 * `super_admin` ("Administrador Geral") só sai da mão de outro Administrador Geral — decisão do
 * usuário em 22/08/2026, e é o que impede o RH de se promover.
 *
 * `rh_unidade` fica restrito a papéis ESCOPADOS por unidade. Fora dali estaria escalada de
 * privilégio, não permissão: `rh` tem bypass total em applyAccessFilters (enxerga a secretaria
 * inteira) e `admin` carrega poder de gestão amplo — criar uma conta dessas com senha que ele
 * mesmo define é contornar o próprio escopo em um clique.
 */
export const PAPEIS_ATRIBUIVEIS: Record<PapelGestor, string[]> = {
  super_admin: ['ass_adm', 'coordenador', 'admin', 'rh', 'rh_unidade', 'super_admin'],
  rh: ['ass_adm', 'coordenador', 'admin', 'rh', 'rh_unidade'],
  rh_unidade: ['ass_adm', 'coordenador', 'rh_unidade'],
}

/** Excluir usuário apaga do Auth e do banco, é irreversível e não gera log. Fica com o Admin Geral. */
export function podeExcluirUsuarios(role: string | null | undefined): boolean {
  return role === 'super_admin'
}

export interface Gestor {
  id: string
  role: PapelGestor
  /** Vazio para super_admin/rh — o alcance deles não é por unidade. */
  unidades: string[]
}

export interface AlvoEscopo {
  role: string
  acesso_todas_unidades: boolean
  permitted_unidades: string[]
  permitted_setores: string[]
}

/**
 * Um setor só conta como "da minha unidade" se a unidade-pai dele estiver entre as minhas.
 * O mapa é setor_id -> unidade_id. Sem ele, um alvo vinculado só por setor seria julgado
 * como se não tivesse vínculo nenhum — e é exatamente o caso do coordenador que só tem
 * `profile_setores` (ver `fn_unidade_alcancavel_por_setor` no CLAUDE.md).
 */
export type MapaSetorUnidade = Map<string, string> | Record<string, string>

function unidadeDoSetor(mapa: MapaSetorUnidade | undefined, setorId: string): string | undefined {
  if (!mapa) return undefined
  return mapa instanceof Map ? mapa.get(setorId) : mapa[setorId]
}

/**
 * O gestor alcança esta conta? Vale para VER na lista, editar, redefinir senha e ativar/inativar
 * — de propósito: o que se enxerga é o que se administra, e o contrário abriria a porta de
 * mexer no que não se vê.
 */
export function alcancaUsuario(
  gestor: Gestor,
  alvo: AlvoEscopo,
  mapaSetorUnidade?: MapaSetorUnidade
): boolean {
  if (gestor.role === 'super_admin') return true

  // Administrador Geral não aparece para o RH — nem para ver, nem para editar.
  if (alvo.role === 'super_admin') return false

  if (gestor.role === 'rh') return true

  // rh_unidade daqui para baixo.
  if (!PAPEIS_ATRIBUIVEIS.rh_unidade.includes(alvo.role)) return false

  // Conta de alcance global não é "de uma unidade" — não cabe dentro do escopo de ninguém.
  if (alvo.acesso_todas_unidades) return false

  const minhas = new Set(gestor.unidades)
  if (minhas.size === 0) return false

  const unidadesDoAlvo = alvo.permitted_unidades || []
  const setoresDoAlvo = alvo.permitted_setores || []

  // Conta sem vínculo nenhum não pertence a unidade alguma; fica com super_admin/rh.
  if (unidadesDoAlvo.length === 0 && setoresDoAlvo.length === 0) return false

  if (!unidadesDoAlvo.every(u => minhas.has(u))) return false

  // Setor sem unidade conhecida no mapa é tratado como fora do escopo — a dúvida fecha, não abre.
  if (!setoresDoAlvo.every(s => {
    const u = unidadeDoSetor(mapaSetorUnidade, s)
    return !!u && minhas.has(u)
  })) return false

  return true
}

export interface PayloadEscopo {
  role: string
  acesso_todas_unidades: boolean
  unidade_ids: string[]
  setor_ids: string[]
  acesso_todos_setores: boolean
}

/**
 * O que o gestor está tentando GRAVAR é aceitável?
 *
 * A regra é uma só e vale para criar e editar: **o gestor não pode deixar no ar uma conta que
 * ele mesmo não enxergaria**. Isso resolve de uma vez o papel atribuído, o "Acesso Total" e as
 * unidades/setores escolhidos, sem três listas de exceção para manter em sincronia.
 */
export function validarPayload(
  gestor: Gestor,
  payload: PayloadEscopo,
  mapaSetorUnidade?: MapaSetorUnidade
): string | null {
  if (!PAPEIS_ATRIBUIVEIS[gestor.role].includes(payload.role)) {
    return `Seu perfil não pode atribuir o nível de acesso selecionado.`
  }

  if (gestor.role === 'super_admin' || gestor.role === 'rh') return null

  if (payload.acesso_todas_unidades) {
    return 'RH da Unidade não pode conceder acesso a todas as unidades.'
  }

  const alcancavel = alcancaUsuario(
    gestor,
    {
      role: payload.role,
      acesso_todas_unidades: false,
      permitted_unidades: payload.unidade_ids,
      permitted_setores: payload.setor_ids,
    },
    mapaSetorUnidade
  )

  if (!alcancavel) {
    return 'Vincule o usuário a pelo menos uma unidade (ou setor) sob sua responsabilidade. ' +
      'Não é possível criar um acesso que você mesmo não poderia administrar.'
  }

  return null
}
