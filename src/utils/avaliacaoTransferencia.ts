/**
 * Quem pode APROVAR/REJEITAR uma solicitacao de transferencia de unidade/setor.
 *
 * Ate 28/08/2026 a resposta era "so o super_admin" — escrita em tres lugares que ja divergiam
 * entre si (o `if` da action, o `isSuperAdmin` que a tela usava pra mostrar os botoes e a policy
 * de UPDATE). O RH pediu que RH Geral e RH da Unidade tambem avaliassem, entao a regra virou
 * fonte unica aqui e e aplicada nos tres: tela (o que mostra), action (o que aceita) e RLS (o
 * que o banco deixa gravar). Server action e um POST cujo id sai no bundle — tela filtrada nunca
 * protegeu action nenhuma (armadilha 12 do CLAUDE.md).
 *
 * A regra:
 *   super_admin / rh (RH Geral) — avaliam qualquer solicitacao.
 *   rh_unidade  (RH da Unidade) — so' dentro das unidades vinculadas a ele.
 *   demais papeis               — nao avaliam (continuam podendo SOLICITAR).
 *
 * ⚠️ Pra `rh_unidade`, aprovar exige ORIGEM **e** DESTINO dentro do escopo dele. Nao e' rigor
 * gratuito: a policy `Scoped access for Admins and Coordinators` (20260818100000) so' deixa esse
 * papel escrever em `servidores` cuja `unidade_id` esta em `profile_unidades`, e o WITH CHECK
 * roda sobre a linha NOVA — mandar o servidor pra outra unidade seria recusado pelo banco de
 * qualquer forma, e o sintoma seria "nenhuma alteracao foi gravada" sem explicacao. Transferencia
 * ENTRE unidades continua sendo decisao do RH Geral / Administrador Geral, que enxergam as duas
 * pontas. Rejeitar nao escreve em `servidores`, entao basta a origem.
 *
 * ⚠️ `acesso_todas_unidades` NAO e' considerado pra `rh_unidade`. A policy de escrita de
 * `servidores` tem esse bypass so' no braco de admin/coordenador — o braco de `rh_unidade` olha
 * unicamente `profile_unidades`. Honrar a flag aqui liberaria na tela o que o banco recusaria.
 */

export type AcaoAvaliacaoTransferencia = 'aprovar' | 'rejeitar'

export interface EscopoAvaliador {
  role: string | null | undefined
  /** unidades de `profile_unidades` (uniao com as alcancadas por `profile_setores`). */
  unidadesPermitidas: string[]
}

export interface AlvoTransferencia {
  unidadeOrigemId: string | null
  /** destino FINAL — o escolhido na aprovacao quando o pedido veio "A definir pelo RH". */
  unidadeDestinoId: string | null
}

export type ResultadoAvaliacao = { ok: true } | { ok: false; erro: string }

const PAPEIS_AVALIADORES = ['super_admin', 'rh', 'rh_unidade'] as const
const PAPEIS_IRRESTRITOS = ['super_admin', 'rh'] as const

export const ERRO_PAPEL_SEM_PODER =
  'Só o Administrador Geral, o RH Geral ou o RH da Unidade podem avaliar solicitações de transferência.'

/** O papel, sozinho, avalia alguma coisa? Usado pra decidir se a secao aparece na tela. */
export function ehAvaliadorDeTransferencia(role: string | null | undefined): boolean {
  return PAPEIS_AVALIADORES.includes(role as (typeof PAPEIS_AVALIADORES)[number])
}

/** O papel avalia qualquer solicitacao, sem olhar unidade? */
export function avaliaSemEscopo(role: string | null | undefined): boolean {
  return PAPEIS_IRRESTRITOS.includes(role as (typeof PAPEIS_IRRESTRITOS)[number])
}

export function avaliarPermissaoTransferencia(
  escopo: EscopoAvaliador,
  alvo: AlvoTransferencia,
  acao: AcaoAvaliacaoTransferencia,
): ResultadoAvaliacao {
  if (!ehAvaliadorDeTransferencia(escopo.role)) {
    return { ok: false, erro: ERRO_PAPEL_SEM_PODER }
  }

  if (avaliaSemEscopo(escopo.role)) {
    return { ok: true }
  }

  // rh_unidade daqui pra baixo.
  const permitidas = new Set(escopo.unidadesPermitidas.filter(Boolean))

  if (!alvo.unidadeOrigemId || !permitidas.has(alvo.unidadeOrigemId)) {
    return {
      ok: false,
      erro: 'Esta solicitação é de um servidor fora das suas unidades. Só o RH Geral ou o Administrador Geral podem avaliá-la.',
    }
  }

  if (acao === 'rejeitar') {
    return { ok: true }
  }

  if (!alvo.unidadeDestinoId || !permitidas.has(alvo.unidadeDestinoId)) {
    return {
      ok: false,
      erro: 'Como RH da Unidade você aprova remanejamento dentro das suas unidades. Transferência para outra unidade precisa do RH Geral ou do Administrador Geral.',
    }
  }

  return { ok: true }
}
