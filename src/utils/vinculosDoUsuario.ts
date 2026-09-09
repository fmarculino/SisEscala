/**
 * "Esta pessoa tem outro vínculo que o escopo desta conta não alcança."
 *
 * O PROBLEMA QUE ISTO RESOLVE (09/09/2026)
 *   `servidores` é "1 linha = 1 vínculo" (armadilha 50), e uma pessoa pode ter dois — mesmo CPF,
 *   matrículas diferentes, unidades diferentes. Mas a CONTA de usuário é uma só: o índice
 *   `uq_profiles_servidor_id` permite no máximo um usuário por servidor, então `profiles.servidor_id`
 *   aponta para UM dos vínculos e o outro fica sem conta.
 *
 *   E o escopo da conta (`profile_unidades` / `profile_setores`) **nunca é derivado da lotação** —
 *   ele vem do formulário desta tela (`formData.getAll('unidade_ids')`). Ninguém é avisado quando o
 *   segundo vínculo fica de fora.
 *
 * 🚨 CASO REAL: LUCILIA LIMA AZEVEDO tem vínculo na SMS / CAF e no HMI / FARMACÊUTICOS. A conta
 *   dela tinha escopo só do HMI. Ela era a coordenadora responsável pelo terminal de ponto do CAF,
 *   e por isso **59 batidas em 4 dias úteis foram recusadas** — as 6 pessoas lotadas ali batiam o
 *   ponto e o coordenador validava ~20 por dia à mão. Medido no parque: 19 CPFs com 2+ cadastros
 *   ativos, 2 com conta de usuário, e **nos 2 o escopo não cobre um dos vínculos**.
 *
 * ⚠️ ISTO AVISA, NUNCA CORRIGE — e a distinção é o ponto todo.
 *   Derivar escopo da lotação seria dar acesso que ninguém autorizou: escopo é **autoridade**,
 *   lotação é **onde a pessoa trabalha**, e as duas não coincidem por desenho (um coordenador pode
 *   ser lotado num setor e coordenar outro; RH e admin têm escopo amplo sem lotação correspondente).
 *   Quem decide continua sendo quem cadastra.
 *
 * ⚠️ NA DÚVIDA, NÃO ACUSA. Sem CPF no cadastro não há como saber se existe outro vínculo, e
 *   servidor sem CPF é comum na base. Aviso que grita à toa é o caminho mais curto para ninguém
 *   mais ler nenhum — a mesma assimetria de `classificarLugarDaBatida` (armadilha 55).
 */

export type VinculoServidor = {
  id: string
  cpf?: string | null
  matricula?: string | null
  nome?: string | null
  unidade_id?: string | null
  unidade_nome?: string | null
  setor_id?: string | null
}

export type EscopoConta = {
  /** "Acesso Total" — a conta enxerga todas as unidades, então não há lacuna possível. */
  acessoTodasUnidades: boolean
  unidadeIds: string[]
  setorIds: string[]
}

/** Só dígitos: `123.456.789-00` e `12345678900` são o mesmo CPF. */
function cpfNormalizado(cpf?: string | null): string | null {
  if (!cpf) return null
  const d = String(cpf).replace(/\D/g, '')
  return d.length ? d : null
}

/**
 * O escopo alcança esta unidade? Por vínculo direto à unidade, ou por um setor dela.
 *
 * ⚠️ Setor conta como alcance da unidade de propósito: é o caso do coordenador cujo acesso vem
 * inteiramente de `profile_setores`, sem a unidade-pai (o que `fn_unidade_alcancavel_por_esetor`
 * existe para resolver no banco). Ignorar isso encheria a tela de aviso falso.
 */
function escopoAlcancaUnidade(
  unidadeId: string | null | undefined,
  escopo: EscopoConta,
  setorParaUnidade: Map<string, string>,
): boolean {
  if (!unidadeId) return true // lugar desconhecido não acusa
  if (escopo.acessoTodasUnidades) return true
  if (escopo.unidadeIds.includes(unidadeId)) return true
  for (const setorId of escopo.setorIds) {
    if (setorParaUnidade.get(setorId) === unidadeId) return true
  }
  return false
}

/**
 * Os vínculos DA MESMA PESSOA que o escopo desta conta não alcança.
 *
 * @param servidorSelecionadoId  o vínculo ao qual a conta está sendo ligada
 * @param vinculos               todos os cadastros ativos conhecidos (a busca não pode ser
 *                               filtrada por unidade, senão o vínculo de fora — justamente o que
 *                               se quer avisar — nunca apareceria)
 * @param escopo                 o que está marcado no formulário AGORA, não o que está salvo
 * @param setorParaUnidade       setor → unidade, para o alcance por setor
 */
export function vinculosForaDoEscopo(
  servidorSelecionadoId: string | null | undefined,
  vinculos: VinculoServidor[],
  escopo: EscopoConta,
  setorParaUnidade: Map<string, string>,
): VinculoServidor[] {
  if (!servidorSelecionadoId) return []
  if (escopo.acessoTodasUnidades) return []

  const selecionado = vinculos.find(v => v.id === servidorSelecionadoId)
  const cpf = cpfNormalizado(selecionado?.cpf)
  if (!cpf) return [] // sem CPF não se afirma nada

  return vinculos.filter(v =>
    v.id !== servidorSelecionadoId
    && cpfNormalizado(v.cpf) === cpf
    && !escopoAlcancaUnidade(v.unidade_id, escopo, setorParaUnidade))
}

/** Uma frase para a tela. `null` quando não há o que dizer. */
export function descreverVinculosForaDoEscopo(fora: VinculoServidor[]): string | null {
  if (!fora.length) return null
  const partes = fora.map(v => {
    const onde = v.unidade_nome || 'outra unidade'
    return v.matricula ? `${onde} (mat. ${v.matricula})` : onde
  })
  const lista = partes.length === 1
    ? partes[0]
    : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
  return fora.length === 1
    ? `Esta pessoa também tem vínculo em ${lista}, que não está no escopo desta conta.`
    : `Esta pessoa também tem vínculos em ${lista}, que não estão no escopo desta conta.`
}
