/**
 * Quem pode mexer numa batida REAL — FONTE ÚNICA (17/09/2026).
 *
 * 🚨 POR QUE ESTE ARQUIVO EXISTE
 *   A mesma pergunta tinha DUAS respostas diferentes no sistema:
 *
 *     · grade  (`ScaleGrid.handleSegmentClick`): `admin` ou `super_admin`
 *     · folha  (`salvarFolhaPonto`):              só `super_admin`
 *
 *   Então o Diretor corrigia na grade e a folha recusava a mesma correção, com uma mensagem que
 *   não explicava por quê. E o RH — que é quem apura a folha — não passava em nenhuma das duas:
 *   medido em 17/09/2026, a rede tem 5 contas que passavam no gate da grade (2 super_admin + 3
 *   admin) contra 18 de RH (8 `rh` + 10 `rh_unidade`) e 124 coordenadores. Corrigir ponto era
 *   uma fila num gargalo de cinco pessoas.
 *
 * 🚨 O PRINCÍPIO, E ELE NÃO PODE SER AFROUXADO
 *   **O RH rearranja FATOS; declarar horário onde há fato continua sendo ato restrito.**
 *
 *   Escolher qual batida real vai em qual passo, ou retirar a que não pertence àquele turno, é
 *   apurar: o horário continua sendo o que o relógio gravou. DIGITAR um horário por cima de uma
 *   batida existente é outra coisa — é substituir o registro do empregado pelo do gestor, que é
 *   a vedação 4 da Portaria 671/2021 ("qualquer dispositivo que permita alterar o dado
 *   registrado pelo empregado"). Por isso a terceira coluna da matriz não abre para o RH.
 *
 * ⚠️ ESPELHO DE SQL — as duas camadas precisam concordar
 *   `fn_pode_corrigir_batida_real(p_role)` (20260917130000) implementa a mesma matriz para quem
 *   chama a RPC direto. Ao mexer numa ponta, mexa na outra — mesma disciplina de
 *   `intervaloIntrajornada.ts` e `gestaoJustificativas.ts`.
 *
 * ⚠️ ESTE MÓDULO NÃO RESPONDE "ALCANÇA ESTA LINHA?"
 *   Escopo de unidade/setor continua sendo do `hasSectorAccess` da folha e da RLS de
 *   `escala_diaria`. Aqui é só o direito; lá é o alcance. Misturar os dois foi o que fez
 *   `fn_unidade_no_escopo` virar armadilha 62.
 */

export type PapelCorrecao =
  | 'super_admin' | 'rh' | 'rh_unidade' | 'admin' | 'coordenador' | 'ass_adm'
  | 'servidor' | 'comum'

/** Preencher um passo VAZIO — selecionando batida ou declarando horário. O trabalho de sempre. */
export const PAPEIS_VALIDAM_PASSO_VAZIO: PapelCorrecao[] = [
  'super_admin', 'admin', 'rh', 'rh_unidade', 'coordenador', 'ass_adm',
]

/**
 * Rearranjar batidas REAIS entre os passos, e retirar a que não pertence ao turno.
 *
 * O RH entra aqui em 17/09/2026. Coordenador e ass_adm continuam de fora: quem convive com o
 * servidor todo dia valida o que faltou, não remaneja o que o relógio gravou — mesma régua que
 * já separa quem marca falta de quem reverte falta (`PAPEIS_REVERTEM_DESFECHO`).
 */
export const PAPEIS_REARRANJAM_BATIDA_REAL: PapelCorrecao[] = [
  'super_admin', 'admin', 'rh', 'rh_unidade',
]

/**
 * DIGITAR um horário por cima de um passo que já tem batida real.
 *
 * Continua restrito ao Administrador. Não é desconfiança do RH: é que este é o único caminho do
 * sistema que substitui o dado do relógio por um dado de gestor, e ele precisa ser raro,
 * nomeado e excepcional.
 */
export const PAPEIS_DIGITAM_SOBRE_BATIDA_REAL: PapelCorrecao[] = [
  'super_admin', 'admin',
]

const tem = (lista: PapelCorrecao[], role?: string | null): boolean =>
  !!role && (lista as string[]).includes(role)

export function podeValidarPassoVazio(role?: string | null): boolean {
  return tem(PAPEIS_VALIDAM_PASSO_VAZIO, role)
}

export function podeRearranjarBatidaReal(role?: string | null): boolean {
  return tem(PAPEIS_REARRANJAM_BATIDA_REAL, role)
}

export function podeDigitarSobreBatidaReal(role?: string | null): boolean {
  return tem(PAPEIS_DIGITAM_SOBRE_BATIDA_REAL, role)
}

/** As origens que significam "o relógio (ou o terminal) registrou isto". */
export type OrigemPasso =
  | 'rep' | 'terminal' | 'ajuste_coordenador' | 'ajuste_servidor' | 'pre_assinalado' | 'real'
  | null | undefined

/**
 * É batida real?
 *
 * ⚠️ `'real'` está na lista porque a FOLHA usa esse rótulo (`registros[].origem_entrada`),
 * enquanto `escala_diaria` usa `rep`/`terminal`. São dois vocabulários para o mesmo fato, e
 * quem chama daqui pode vir de qualquer um dos dois. Tratar só um dos nomes deixaria metade do
 * sistema sem proteção — foi o que a régua duplicada já custava.
 */
export function ehBatidaReal(origem: OrigemPasso): boolean {
  return origem === 'rep' || origem === 'terminal' || origem === 'real'
}

export type AcaoNoPasso = 'preencher_vazio' | 'rearranjar' | 'digitar_sobre_real'

/**
 * O que a pessoa está tentando fazer neste passo, dado o estado dele.
 *
 * `preenchido` é o que existe HOJE no passo; `novoHorarioDigitado` diz se a intenção é escrever
 * um horário à mão (e não escolher uma batida).
 */
export function acaoNoPasso(params: {
  preenchido: boolean
  origemAtual: OrigemPasso
  novoHorarioDigitado: boolean
}): AcaoNoPasso {
  if (!params.preenchido) return 'preencher_vazio'
  if (!ehBatidaReal(params.origemAtual)) {
    // Passo preenchido por declaração (ajuste do coordenador, pré-assinalação): refazer isso é
    // o trabalho normal de quem apura, não mexer em batida.
    return 'preencher_vazio'
  }
  return params.novoHorarioDigitado ? 'digitar_sobre_real' : 'rearranjar'
}

export function podeExecutar(acao: AcaoNoPasso, role?: string | null): boolean {
  switch (acao) {
    case 'preencher_vazio':     return podeValidarPassoVazio(role)
    case 'rearranjar':          return podeRearranjarBatidaReal(role)
    case 'digitar_sobre_real':  return podeDigitarSobreBatidaReal(role)
  }
}

/**
 * A recusa, em texto que diz o que fazer — nunca só "acesso negado".
 *
 * Mensagem que não indica caminho ensina a contornar a tela (armadilha 31/44): é o que a régua
 * antiga fazia ao responder "Apenas administradores podem alterar ou reverter batidas
 * presenciais" para um RH que é, justamente, quem apura aquela folha.
 */
export function mensagemRecusa(acao: AcaoNoPasso, role?: string | null): string | null {
  if (podeExecutar(acao, role)) return null

  if (acao === 'rearranjar') {
    return 'Só o RH (Geral ou da Unidade) e o Administrador podem remanejar batidas registradas '
      + 'em terminal ou relógio. Para validar um passo que ficou VAZIO, o caminho continua aberto '
      + 'para você.'
  }
  if (acao === 'digitar_sobre_real') {
    return 'Este passo tem batida registrada pelo relógio. Escolher OUTRA batida real é possível '
      + 'para o RH; digitar um horário por cima de uma batida é ato exclusivo do Administrador, '
      + 'porque substitui o registro do servidor pelo do gestor.'
  }
  return 'Sem permissão para validar presença nesta escala.'
}
