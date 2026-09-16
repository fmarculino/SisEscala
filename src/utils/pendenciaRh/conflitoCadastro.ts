/**
 * O que a tela de Pendências de Cadastro pode OFERECER diante de um conflito.
 *
 * Fonte única da regra, espelhando o que o banco de fato aceita:
 *
 *   - `fn_promover_pendencia_rh` cria cadastro novo e exige `p_confirma_vinculo_adicional`
 *     quando o CPF já pertence a outra ficha;
 *   - `fn_atualizar_cadastro_via_pendencia_rh` completa a ficha existente e **recusa cadastro de
 *     unidade fora do escopo** de quem chama;
 *   - colisão por MATRÍCULA nunca é vínculo adicional válido (20260812110000) — é sempre o mesmo
 *     registro, então só "atualizar" resta.
 *
 * Existe porque a tela oferecia decisões que o banco recusaria depois, e escondia a decisão que
 * ele aceitaria. Em 16/09/2026 uma coordenadora do CAPS III recebeu "CPF ja cadastrado... Confirme
 * se e vinculo adicional" **sem nenhum lugar onde confirmar**: a conferência de conflito falhava
 * calada (a pendência tem `unidade_id` nulo e a RLS não a alcançava) e a tela lia o erro como
 * "não há conflito". Ver CLAUDE.md, armadilhas 31 e 44 — botão que convida ao impossível, e
 * instrução que o sistema não oferece.
 */

export type TipoConflito = 'matricula' | 'cpf'

export interface ConflitoPendencia {
  tipo: TipoConflito
  servidor_id: string
  nome: string
  matricula: string | null
  unidade_nome: string | null
  status: string | null
  /** O cadastro em conflito está no escopo de quem está olhando? Só o banco sabe. */
  alvo_no_escopo: boolean
}

/**
 * O resultado da conferência. `falhou` existe de propósito e NÃO pode ser colapsado em
 * `conflito: null`: "conferi e não há conflito" e "não consegui conferir" levam a ações opostas,
 * e confundir os dois é o defeito que este módulo fecha.
 */
export type Conferencia =
  | { estado: 'conferindo' }
  | { estado: 'falhou'; motivo: string }
  | { estado: 'ok'; cpfPendencia: string | null; conflito: ConflitoPendencia | null }

export type Escolha = 'atualizar' | 'duplo' | null

export interface OpcaoTela {
  disponivel: boolean
  /** Por que não está disponível. Botão cinza sem explicação ensina a contornar a tela. */
  motivo: string | null
}

export interface OpcoesDoConflito {
  atualizar: OpcaoTela
  vinculoAdicional: OpcaoTela
  /** Verdadeiro quando o usuário precisa escolher entre as duas antes de confirmar. */
  exigeEscolha: boolean
}

function ondeEsta(conflito: ConflitoPendencia): string {
  return conflito.unidade_nome ? `em ${conflito.unidade_nome}` : 'em outra unidade'
}

/** O que cada caminho permite, dado o conflito. */
export function opcoesDoConflito(conflito: ConflitoPendencia | null): OpcoesDoConflito {
  if (!conflito) {
    return {
      atualizar: { disponivel: false, motivo: null },
      vinculoAdicional: { disponivel: false, motivo: null },
      exigeEscolha: false,
    }
  }

  // Fora do escopo, "atualizar" seria recusado pelo banco — e a recusa está certa: completar
  // ficha de outra unidade não é decisão de quem não responde por ela.
  const atualizar: OpcaoTela = conflito.alvo_no_escopo
    ? { disponivel: true, motivo: null }
    : {
        disponivel: false,
        motivo:
          `O cadastro de ${conflito.nome} está ${ondeEsta(conflito)}, fora do seu escopo — ` +
          `só quem administra aquela unidade, o RH Geral ou o Administrador Geral pode completá-lo.`,
      }

  if (conflito.tipo === 'matricula') {
    // Matrícula é única por pessoa: cadastro novo nunca é resposta certa aqui.
    return {
      atualizar,
      vinculoAdicional: {
        disponivel: false,
        motivo:
          'Matrícula é única por pessoa — este não pode ser um vínculo adicional, ' +
          'é sempre o mesmo registro.',
      },
      exigeEscolha: false,
    }
  }

  return { atualizar, vinculoAdicional: { disponivel: true, motivo: null }, exigeEscolha: true }
}

export interface EntradaAcao {
  conferencia: Conferencia
  escolha: Escolha
  /** Unidade, setor e cargo preenchidos na linha. */
  camposCompletos: boolean
  /** CPF conhecido: o da pendência, ou o que foi digitado. */
  cpfInformado: boolean
  salvando: boolean
}

export interface Acao {
  habilitado: boolean
  rotulo: string
  /** Explicação do bloqueio, exibida ao lado do botão. */
  motivo: string | null
  /** Qual caminho o clique deve seguir. */
  caminho: 'promover' | 'promover_vinculo_adicional' | 'atualizar' | null
}

/**
 * O botão de confirmar: se está habilitado, com que texto, e para onde leva.
 *
 * A regra de ouro: nunca habilitar um caminho que o banco vai recusar, e nunca desabilitar sem
 * dizer por quê.
 */
export function avaliarAcao(e: EntradaAcao): Acao {
  if (e.salvando) {
    return { habilitado: false, rotulo: 'Gravando...', motivo: null, caminho: null }
  }

  if (e.conferencia.estado === 'conferindo') {
    return { habilitado: false, rotulo: 'Verificando...', motivo: null, caminho: null }
  }

  // Conferência que falhou NUNCA vira "pode seguir". Confirmar aqui seria decidir às cegas sobre
  // duplicidade de cadastro de servidor público.
  if (e.conferencia.estado === 'falhou') {
    return {
      habilitado: false,
      rotulo: 'Não foi possível conferir',
      motivo:
        `${e.conferencia.motivo} Sem essa conferência não dá para saber se já existe cadastro ` +
        `com esta matrícula ou CPF — recarregue a página e tente de novo.`,
      caminho: null,
    }
  }

  const { conflito } = e.conferencia
  const opcoes = opcoesDoConflito(conflito)

  if (conflito) {
    // Quando só um caminho é possível, ele é o escolhido — não se pede escolha entre uma opção
    // e um impedimento.
    const escolhaEfetiva: Escolha = opcoes.exigeEscolha
      ? e.escolha
      : opcoes.atualizar.disponivel
        ? 'atualizar'
        : opcoes.vinculoAdicional.disponivel
          ? 'duplo'
          : null

    if (!escolhaEfetiva) {
      const nenhumCaminho = !opcoes.atualizar.disponivel && !opcoes.vinculoAdicional.disponivel
      if (nenhumCaminho) {
        return {
          habilitado: false,
          rotulo: 'Nada a fazer por aqui',
          motivo:
            [opcoes.atualizar.motivo, opcoes.vinculoAdicional.motivo].filter(Boolean).join(' ') ||
            null,
          caminho: null,
        }
      }
      return {
        habilitado: false,
        rotulo: 'Escolha uma opção acima',
        motivo: null,
        caminho: null,
      }
    }

    if (escolhaEfetiva === 'atualizar') {
      if (!opcoes.atualizar.disponivel) {
        return {
          habilitado: false,
          rotulo: 'Atualizar cadastro existente',
          motivo: opcoes.atualizar.motivo,
          caminho: null,
        }
      }
      // Atualizar não cria cadastro: não exige unidade/setor/cargo nem CPF.
      return {
        habilitado: true,
        rotulo: 'Atualizar cadastro existente',
        motivo: null,
        caminho: 'atualizar',
      }
    }

    if (!opcoes.vinculoAdicional.disponivel) {
      return {
        habilitado: false,
        rotulo: 'Confirmar cadastro novo (vínculo adicional)',
        motivo: opcoes.vinculoAdicional.motivo,
        caminho: null,
      }
    }
    const faltando = faltaParaCriar(e)
    return {
      habilitado: !faltando,
      rotulo: 'Confirmar cadastro novo (vínculo adicional)',
      motivo: faltando,
      caminho: 'promover_vinculo_adicional',
    }
  }

  const faltando = faltaParaCriar(e)
  return {
    habilitado: !faltando,
    rotulo: 'Confirmar cadastro',
    motivo: faltando,
    caminho: 'promover',
  }
}

function faltaParaCriar(e: EntradaAcao): string | null {
  if (!e.camposCompletos) return 'Preencha unidade, setor e cargo.'
  if (!e.cpfInformado) return 'Preencha o CPF.'
  return null
}

/**
 * A promoção foi recusada porque o CPF já pertence a outra ficha?
 *
 * Usado para reconferir e abrir a escolha quando a recusa chega mesmo assim — o cadastro pode ter
 * nascido entre abrir a linha e confirmar. A pergunta do banco tem que virar pergunta na tela;
 * foi a falta disso que deixou o usuário sem saída.
 */
export function recusaPorCpfJaCadastrado(mensagem: string | null | undefined): boolean {
  if (!mensagem) return false
  const texto = mensagem
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  // Duas redações convivem: a da RPC ("CPF ja cadastrado como ...", sem acento, convenção das
  // migrations) e a das actions de cadastro ("Este CPF já está cadastrado para ..."). Colisão de
  // MATRÍCULA tem mensagem própria e não pode cair aqui — ela nunca vira vínculo adicional.
  return /cpf ja (esta )?cadastrado/.test(texto)
}
