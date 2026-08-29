/**
 * Listas de escolha (unidade, setor) — o que está INATIVO não é oferecido.
 *
 * Desativar uma unidade ou um setor significa "não use mais isto", e até 29/08/2026 essa decisão
 * não alcançava os formulários: o `<select>` de unidade do modal do Dispositivo REP, por exemplo,
 * listava as 33 unidades sempre, a inativa junto. Escolher uma delas cria vínculo novo com um
 * cadastro que alguém já tinha aposentado — e ninguém percebe, porque a tela não diz nada.
 *
 * ⚠️ A REGRA NÃO É "SUMIR". O item inativo que JÁ ESTÁ selecionado continua na lista, marcado
 * como inativo: tirá-lo faria o `<select>` mostrar valor vazio (ou o primeiro item da lista) para
 * um registro que no banco aponta para ele, e o próximo "Salvar" gravaria essa troca que ninguém
 * pediu. Some da escolha nova, permanece na escolha feita.
 *
 * ⚠️ Isto é para ESCOLHER onde algo vai ficar. Em filtro de listagem e de relatório o inativo
 * precisa continuar aparecendo — a escala, a folha e o ponto registrados naquele setor não
 * deixaram de existir porque ele foi desativado, e sem a opção no filtro eles ficam inalcançáveis
 * pela tela. Nesses lugares use `rotularInativo`, que mantém a opção e deixa o estado visível.
 */

export interface ItemAtivavel {
  id: string
  nome: string
  ativo?: boolean | null
}

/**
 * Os ativos, mais os inativos que estiverem na seleção atual (para não perder o valor gravado).
 * `selecionado` aceita o valor de um `<select>` simples ou a lista de um seletor múltiplo.
 */
export function opcoesParaEscolha<T extends ItemAtivavel>(
  itens: T[],
  selecionado?: string | string[] | null,
): T[] {
  const marcados = new Set(
    selecionado == null ? [] : Array.isArray(selecionado) ? selecionado : [selecionado],
  )
  return (itens || []).filter((i) => i.ativo !== false || marcados.has(i.id))
}

/** `NOME (inativo)` — para o item inativo que continua na lista. */
export function rotularInativo<T extends ItemAtivavel>(item: T, sufixo = ' (inativo)'): string {
  return item.ativo === false ? `${item.nome}${sufixo}` : item.nome
}
