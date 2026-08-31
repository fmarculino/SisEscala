/**
 * Quem AUTORIZA e quem SOLICITA a Autorização Extraordinária de carga mensal.
 *
 * O teto do mês (300h / 20 unidades de sobreaviso, `configuracoes_globais`) só é ultrapassado
 * com uma linha em `excecoes_escala_servidor`. Até 31/08/2026 a condição estava escrita à mão em
 * três pontos de `ScaleGrid.tsx` como `role === 'super_admin' || role === 'admin'`, e a policy
 * do banco dizia a mesma coisa em SQL — as duas cópias envelheceram juntas, sem que nenhum papel
 * criado depois (`rh`, `rh_unidade`, `ass_adm`) fosse considerado.
 *
 * Medido em produção em 31/08/2026: **5 pessoas** podiam conceder (2 super_admin + 3 admin)
 * contra **96** que lançam escala. E a mensagem que os outros recebiam — "Solicite a um
 * Administrador a concessão de uma Autorização Extraordinária" — mandava fazer algo que o
 * sistema não oferecia: não havia pedido, tela nem registro. O combinado passava por WhatsApp.
 *
 * ⚠️ **Este módulo orienta a TELA; quem decide é o banco.** `fn_pode_autorizar_excecao_carga`
 * (migration `20260831120000`) é a fonte única de verdade — ela é avaliada dentro da policy de
 * escrita de `excecoes_escala_servidor` e dentro de `fn_avaliar_solicitacao_excecao_carga`.
 * Aqui só se decide **o que oferecer**, porque a resposta por linha exigiria uma consulta por
 * render. O caso em que as duas divergem é conhecido e tratado: `rh_unidade` recebe `true`
 * abaixo, mas o banco ainda exige que o servidor esteja no escopo dele — a tela, ao receber a
 * recusa, oferece o caminho do pedido em vez de repetir o erro.
 *
 * ⚠️ Módulo **puro** (sem React, sem Supabase) para ter portão:
 * `node scratchpad/sim_autorizacao_carga.js`.
 */

export type PapelUsuario =
  | 'super_admin' | 'admin' | 'rh' | 'rh_unidade'
  | 'coordenador' | 'ass_adm' | 'servidor' | 'comum'
  | string | null | undefined

/**
 * Concede a autorização. RH Geral e RH da Unidade entraram em 31/08/2026 por decisão do usuário:
 * é o RH que autoriza carga horária na prática, e mandá-lo pedir a um Administrador invertia a
 * hierarquia real.
 */
const PAPEIS_QUE_AUTORIZAM = ['super_admin', 'admin', 'rh', 'rh_unidade']

/**
 * Papéis do Portal do Servidor — não enxergam a grade e não pedem nada por ela.
 *
 * ⚠️ É **denylist**, e isso é deliberado: allowlist de papel envelhece em silêncio a cada papel
 * novo (foi assim que `rh`, `rh_unidade` e `ass_adm` ficaram de fora por três meses). Mesma
 * escolha de `fn_painel_sobreaviso_dia` e de `fn_pode_escalar_servidor_externo`.
 */
const PAPEIS_DO_PORTAL = ['servidor', 'comum']

export function podeAutorizarCarga(role: PapelUsuario): boolean {
  return !!role && PAPEIS_QUE_AUTORIZAM.includes(role)
}

export function podeSolicitarCarga(role: PapelUsuario): boolean {
  return !!role && !PAPEIS_DO_PORTAL.includes(role)
}

/** O que a tela oferece a quem esbarrou no teto. */
export type AcaoTeto = 'autorizar' | 'solicitar' | 'nada'

export function acaoParaTetoExcedido(role: PapelUsuario): AcaoTeto {
  if (podeAutorizarCarga(role)) return 'autorizar'
  if (podeSolicitarCarga(role)) return 'solicitar'
  return 'nada'
}

/** Um pedido em aberto para o mesmo servidor/competência, como a grade o conhece. */
export interface PedidoPendente {
  id: string
  solicitado_por_nome?: string | null
  solicitado_em?: string | null
  horas_solicitadas?: number | null
  sobreavisos_solicitados?: number | null
}

/**
 * Texto do aviso de teto estourado, já com o próximo passo REAL de quem está lendo.
 *
 * ⚠️ A regra que este texto carrega: **nunca instruir uma ação que o sistema não oferece.** A
 * mensagem antiga mandava "solicite a um Administrador" sem que houvesse como solicitar, e o
 * efeito prático foi ensinar a resolver o teto por fora do sistema.
 */
export function mensagemTetoExcedido(
  detalhe: string,
  role: PapelUsuario,
  pendente?: PedidoPendente | null
): { titulo: string; mensagem: string; acao: AcaoTeto } {
  const acao = acaoParaTetoExcedido(role)

  if (pendente) {
    const quem = pendente.solicitado_por_nome || 'outro usuário'
    const quando = pendente.solicitado_em
      ? new Date(pendente.solicitado_em).toLocaleDateString('pt-BR')
      : null
    return {
      titulo: '⚠️ Teto Mensal Excedido — pedido em análise',
      mensagem: `${detalhe}\n\nJá existe uma solicitação de Autorização Extraordinária em análise para este servidor nesta competência, aberta por ${quem}${quando ? ` em ${quando}` : ''}.${
        acao === 'autorizar'
          ? '\n\nComo RH/Administrador, você pode decidi-la em "Autorizações de Escala".'
          : '\n\nO lançamento continua bloqueado até o RH decidir.'
      }`,
      acao,
    }
  }

  if (acao === 'autorizar') {
    return {
      titulo: '⚠️ Teto Mensal Excedido (Bloqueio de Escala)',
      mensagem: `${detalhe}\n\nVocê pode conceder uma Autorização Extraordinária para este servidor neste mês. Deseja abrir a tela de autorização?`,
      acao,
    }
  }

  if (acao === 'solicitar') {
    return {
      titulo: '⚠️ Teto Mensal Excedido',
      mensagem: `${detalhe}\n\nVocê pode solicitar ao RH uma Autorização Extraordinária, com justificativa. Deseja abrir o pedido agora?`,
      acao,
    }
  }

  return {
    titulo: '⚠️ Teto Mensal Excedido',
    mensagem: `${detalhe}\n\nReduza a escala: este perfil não solicita nem concede autorização de carga.`,
    acao,
  }
}

/**
 * Complemento da mensagem de "não foi possível salvar" (o lote inteiro), onde não há um servidor
 * único para abrir pedido. Mesma regra: o próximo passo tem de existir.
 */
export function instrucaoSalvarBloqueado(role: PapelUsuario): string {
  if (podeAutorizarCarga(role)) {
    return 'Reduza a escala ou clique no escudo vermelho ao lado do nome para autorizar excepcionalmente.'
  }
  if (podeSolicitarCarga(role)) {
    return 'Reduza a escala ou clique no escudo vermelho ao lado do nome para solicitar ao RH uma Autorização Extraordinária.'
  }
  return 'Reduza a escala para ficar dentro do teto do mês.'
}

/** Rótulo do estado do pedido, usado na grade e na tela de Autorizações de Escala. */
export function rotuloStatusSolicitacao(status: string): string {
  switch (status) {
    case 'pendente': return 'Pendente'
    case 'aprovada': return 'Aprovada'
    case 'rejeitada': return 'Rejeitada'
    case 'cancelada': return 'Cancelada'
    default: return status
  }
}
