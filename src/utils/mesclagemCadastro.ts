/**
 * Mesclagem de cadastros duplicados de servidor — regras de TELA, fonte única.
 *
 * A decisão de verdade mora no banco (`fn_impedimentos_mesclagem_servidor` e
 * `fn_mesclar_servidores`, migration 20260904130000). O que vive aqui é só o que a tela precisa
 * para apresentar a escolha: rótulo do que será movido, peso de cada lado e uma SUGESTÃO de qual
 * cadastro deve absorver o outro.
 *
 * ⚠️ Sugestão nunca é escolha. A tela obriga o Administrador a marcar qual cadastro fica, mesmo
 * quando a sugestão é óbvia — a mesclagem move ponto de servidor público e não tem desfazer
 * automático. Isto aqui ordena a informação; quem decide é quem clica.
 */

export interface CadastroDuplicado {
  id: string
  nome: string
  matricula: string | null
  status: string
  cargo: string | null
  vinculo: string | null
  unidade: string | null
  setor: string | null
  vinculo_multiplo_confirmado: boolean
  criado_em: string
  escalas: number
  batidas: number
  folhas: number
  vinculos_rep: number
}

export interface GrupoDuplicado {
  cpf: string
  quantidade: number
  todos_confirmados: boolean
  cadastros: CadastroDuplicado[]
}

/** Nome de tabela → o que aquilo significa para quem está na tela. */
const ROTULOS_VINCULO: Record<string, string> = {
  escala_mensal: 'escalas mensais',
  marcacoes_ponto: 'marcações de ponto',
  folha_ponto: 'folhas de ponto',
  servidores_eventos: 'afastamentos',
  servidores_jornadas_temporarias: 'jornadas temporárias',
  justificativas_eventos: 'justificativas',
  justificativas_assinaturas: 'assinaturas de justificativa',
  logs_sobreaviso: 'acionamentos de sobreaviso',
  logs_tentativas_presenca: 'tentativas de ponto recusadas',
  logs_troca_pin: 'trocas de PIN',
  logs_preferencia_aviso_ponto: 'preferências de aviso de ponto',
  avisos_ponto_fila: 'avisos de ponto na fila',
  rep_vinculos_servidor: 'vínculos com relógio de ponto',
  rep_cadastros_fila: 'cadastros na fila do relógio',
  rep_usuarios_dispositivo: 'cadastros lidos do relógio',
  rep_excecoes_ponto: 'exceções de ponto do relógio',
  rep_biometria_copias: 'cópias de biometria',
  rep_administradores_parque: 'permissões de administrador do parque',
  marcacoes_tratamentos: 'tratamentos de marcação',
  excecoes_escala_servidor: 'autorizações de carga horária',
  solicitacoes_excecao_carga: 'pedidos de autorização de carga',
  solicitacoes_transferencia_servidor: 'pedidos de transferência',
  solicitacoes_ferias_licencas: 'pedidos de férias e licenças',
  solicitacoes_troca: 'pedidos de troca de plantão',
  historico_transferencias: 'histórico de transferências',
  escala_mensal_movimentos: 'movimentações de escala',
  importacao_rh_pendentes: 'importações do RH',
  autorizacoes_ponto_coletivo: 'autorizações de ponto coletivo',
  profiles: 'conta de acesso ao sistema',
  servidores: 'cadastros que apontam para este',
}

/**
 * "escala_mensal.servidor_id" (a chave que o banco devolve em `movidos`) → texto legível.
 * A coluna faz parte da chave porque uma tabela pode apontar para servidores por mais de uma
 * coluna (solicitacoes_troca tem solicitante e destinatário) — e aí "pedidos de troca" duas
 * vezes na mesma lista seria confuso.
 */
export function rotularVinculo(chave: string): string {
  const [tabela, coluna] = chave.split('.')
  const base = ROTULOS_VINCULO[tabela]
  if (!base) return chave
  if (tabela === 'solicitacoes_troca') {
    return coluna === 'solicitante_id' ? 'pedidos de troca (como solicitante)' : 'pedidos de troca (como destinatário)'
  }
  return base
}

/** Uma linha por vínculo movido, já em português: "2 escalas mensais", "67 marcações de ponto". */
export function descreverMovimentacao(movidos: Record<string, number> | null | undefined): string[] {
  if (!movidos) return []
  return Object.entries(movidos)
    .filter(([chave]) => chave !== 'servidores.mesclado_em_servidor_id')
    .sort((a, b) => b[1] - a[1])
    .map(([chave, qtd]) => `${qtd} ${rotularVinculo(chave)}`)
}

/** Matrícula temporária do RH: "T2600103". Vira número no relógio removendo o T (convenção da Fase 7). */
export function ehMatriculaTemporaria(matricula: string | null): boolean {
  return /^T\d/i.test((matricula || '').trim())
}

/** Quanto dado está pendurado neste cadastro — é o que a mesclagem vai mover. */
export function pesoDoCadastro(c: CadastroDuplicado): number {
  return (c.escalas || 0) + (c.batidas || 0) + (c.folhas || 0) + (c.vinculos_rep || 0)
}

/** "2 escalas · 67 batidas · 1 folha" — vazio vira o texto explícito, que é o caso mais fácil. */
export function descreverPeso(c: CadastroDuplicado): string {
  const partes: string[] = []
  if (c.escalas) partes.push(`${c.escalas} escala${c.escalas > 1 ? 's' : ''}`)
  if (c.batidas) partes.push(`${c.batidas} batida${c.batidas > 1 ? 's' : ''}`)
  if (c.folhas) partes.push(`${c.folhas} folha${c.folhas > 1 ? 's' : ''}`)
  if (c.vinculos_rep) partes.push(`${c.vinculos_rep} vínculo${c.vinculos_rep > 1 ? 's' : ''} de relógio`)
  return partes.length ? partes.join(' · ') : 'nenhum vínculo — cadastro vazio'
}

export interface Sugestao {
  /** Cadastro que a heurística acha que deve FICAR (absorver os outros). */
  destinoId: string
  razao: string
}

/**
 * Qual cadastro parece ser o correto.
 *
 * A ordem das regras vem do que foi medido em produção em 04/09/2026, nos 17 grupos existentes:
 *
 *   1. matrícula DEFINITIVA vence a temporária. A temporária (T26xxxxx) é a que o RH emite antes
 *      do número oficial sair — quando existem as duas para o mesmo CPF, a definitiva é o vínculo
 *      de verdade. Foi exatamente o caso relatado (65567 x T2600103);
 *   2. sem isso, vence quem tem MAIS vínculo pendurado — mover menos coisa erra menos, e o lado
 *      com ponto e folha costuma ser o que a unidade usa de fato;
 *   3. empate real não recebe sugestão. Chutar aqui seria pior que calar: a tela pede a escolha.
 */
export function sugerirDestino(grupo: GrupoDuplicado): Sugestao | null {
  const cadastros = grupo.cadastros || []
  if (cadastros.length < 2) return null

  const definitivos = cadastros.filter(c => !ehMatriculaTemporaria(c.matricula))
  if (definitivos.length === 1 && cadastros.length > definitivos.length) {
    return {
      destinoId: definitivos[0].id,
      razao: `matrícula ${definitivos[0].matricula} é definitiva; a outra é temporária`,
    }
  }

  const ordenados = [...cadastros].sort((a, b) => pesoDoCadastro(b) - pesoDoCadastro(a))
  const [maior, segundo] = ordenados
  if (pesoDoCadastro(maior) > pesoDoCadastro(segundo)) {
    return {
      destinoId: maior.id,
      razao: `matrícula ${maior.matricula} concentra o histórico (${descreverPeso(maior)})`,
    }
  }

  return null
}

export interface EscolhaMesclagem {
  /** Cadastro duplicado, que será inativado. */
  origemId: string
  /** Cadastro que fica e absorve tudo. */
  destinoId: string
}

/**
 * Recusa o que a tela consegue recusar sozinha, com mensagem legível.
 *
 * ⚠️ Não substitui `fn_impedimentos_mesclagem_servidor`: aqui só entra o que não depende do
 * banco. Tela filtrada não protege a RPC (armadilha 12 do CLAUDE.md) — a action confere o papel e
 * a função confere tudo de novo antes de escrever.
 */
export function validarEscolha(
  grupo: GrupoDuplicado,
  escolha: Partial<EscolhaMesclagem>,
): { ok: true } | { ok: false; erro: string } {
  const { origemId, destinoId } = escolha

  if (!destinoId) return { ok: false, erro: 'Escolha qual cadastro fica.' }
  if (!origemId) return { ok: false, erro: 'Escolha qual cadastro é o duplicado.' }
  if (origemId === destinoId) {
    return { ok: false, erro: 'O cadastro duplicado e o que fica precisam ser diferentes.' }
  }

  const ids = new Set((grupo.cadastros || []).map(c => c.id))
  if (!ids.has(origemId) || !ids.has(destinoId)) {
    return { ok: false, erro: 'Os dois cadastros precisam ser do mesmo CPF.' }
  }

  return { ok: true }
}

/**
 * O aviso que a tela mostra antes de confirmar. Não é enfeite: são as duas consequências que não
 * aparecem sozinhas na lista de vínculos, e a segunda já surpreendeu na fusão de setor.
 */
export function avisosDaMesclagem(origem: CadastroDuplicado, destino: CadastroDuplicado): string[] {
  const avisos: string[] = []

  if (origem.escalas > 0) {
    avisos.push(
      `As ${origem.escalas} escala(s) da matrícula ${origem.matricula} continuam no setor onde foram `
      + `lançadas (${origem.setor || 'setor não informado'}) — agora sob a matrícula ${destino.matricula}. `
      + 'Se aquela escala não deveria existir, apague-a na grade depois de mesclar.',
    )
  }

  if (origem.batidas > 0) {
    avisos.push(
      `As ${origem.batidas} marcação(ões) de ponto passam a pertencer à matrícula ${destino.matricula}. `
      + 'O horário, o equipamento e a origem de cada batida não mudam — só o dono.',
    )
  }

  if (destino.status !== 'Ativo') {
    avisos.push(
      `A matrícula ${destino.matricula} está ${destino.status}. Confirme que é mesmo ela que deve ficar.`,
    )
  }

  return avisos
}
