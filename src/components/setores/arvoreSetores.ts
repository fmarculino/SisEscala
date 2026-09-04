/**
 * Montagem da árvore de setores — fonte única dos dois seletores.
 *
 * Extraído de `SeletorSetoresArvore.tsx` em 03/09/2026, quando a tela de Pendências de Cadastro
 * precisou de uma árvore de **seleção única** (a lotação de destino de uma transferência é UM
 * setor). Duas cópias desta função divergiriam no primeiro ajuste de ordenação ou de tratamento
 * de órfão, e o sintoma seria a mesma unidade desenhando hierarquias diferentes em duas telas.
 *
 * ⚠️ As três defesas abaixo não são detalhe — cada uma já foi bug em `formatSectorsHierarchy`
 * (ver `src/utils/sectors.ts`):
 *
 * 1. **Pai fora da lista vira raiz.** A lista chega filtrada (por unidade, por `ativo`), então o
 *    pai pode simplesmente não estar nela. Sem isso o setor sumiria da tela inteira — e quem
 *    escolhe não teria como saber que ele existe.
 * 2. **Auto-referência (`parent_id = id`) vira raiz.** Senão o nó vira filho de si mesmo e o
 *    laço de renderização não termina.
 * 3. **Profundidade é arbitrária.** O HMM tem 3 níveis; a versão antiga entendia 2 e despejava
 *    o nível 3 num bloco de órfãos no fim da lista, colado no último setor raiz em ordem
 *    alfabética, como se pertencesse a ele.
 */

export interface SetorNo {
  id: string
  parent_id?: string | null
  nome: string
  ativo?: boolean | null
}

export interface No extends SetorNo {
  filhos: No[]
  profundidade: number
}

export function montarArvore<T extends SetorNo>(setores: T[]): No[] {
  const porId = new Map(setores.map((s) => [s.id, { ...s, filhos: [] as No[], profundidade: 0 }]))
  const raizes: No[] = []

  for (const s of setores) {
    const no = porId.get(s.id)!
    // Pai fora da lista (outra unidade, inativo escondido) ou auto-referência viram raiz — senão
    // o setor sumiria da tela inteira.
    const pai = s.parent_id && s.parent_id !== s.id ? porId.get(s.parent_id) : undefined
    if (pai) pai.filhos.push(no)
    else raizes.push(no)
  }

  const porNome = (a: No, b: No) => a.nome.localeCompare(b.nome)
  const aprofundar = (nos: No[], nivel: number) => {
    nos.sort(porNome)
    for (const n of nos) {
      n.profundidade = nivel
      aprofundar(n.filhos, nivel + 1)
    }
  }
  aprofundar(raizes, 0)
  return raizes
}

export function idsDaSubarvore(no: No): string[] {
  return [no.id, ...no.filhos.flatMap(idsDaSubarvore)]
}

/**
 * Ids dos nós que têm filho — os únicos que podem ser recolhidos. Recolher folha não faz nada e
 * deixaria o estado sujo (o botão "Recolher tudo" marcaria ids que nenhum chevron desmarca).
 */
export function idsComFilhos(raizes: No[]): string[] {
  const ids: string[] = []
  const visitar = (no: No) => {
    if (no.filhos.length > 0) ids.push(no.id)
    no.filhos.forEach(visitar)
  }
  raizes.forEach(visitar)
  return ids
}

/**
 * Conjunto de ids que casam com o termo — o nó entra se o nome dele casa **ou se algum
 * descendente casa**.
 *
 * ⚠️ Sem a segunda metade, a busca respondia "onde está" tirando a resposta: o pai que não casa
 * é derrubado, e o laço de montagem promove a raiz todo setor cujo pai saiu da lista — o
 * subsetor aparecia solto, sem o ramo que o identifica. Mesmo defeito já registrado na tela
 * `/setores` (armadilha 29).
 */
export function idsQueCasam(raizes: No[], termo: string): Set<string> {
  const set = new Set<string>()
  const alvo = termo.trim().toLowerCase()
  if (!alvo) return set

  const visitar = (no: No): boolean => {
    // `.map(...).some(...)` e não `.some(...)`: `some` para no primeiro true e os irmãos
    // seguintes nunca seriam visitados — eles não entrariam no conjunto e sumiriam da busca.
    const filhoCasa = no.filhos.map(visitar).some(Boolean)
    const proprio = no.nome.toLowerCase().includes(alvo)
    if (proprio || filhoCasa) set.add(no.id)
    return proprio || filhoCasa
  }
  raizes.forEach(visitar)
  return set
}

/** Ids da raiz até o nó (inclusive), para abrir o ramo de quem já está selecionado. */
export function caminhoAteONo(raizes: No[], alvo: string): string[] {
  const buscar = (no: No, acumulado: string[]): string[] | null => {
    const trilha = [...acumulado, no.id]
    if (no.id === alvo) return trilha
    for (const filho of no.filhos) {
      const achou = buscar(filho, trilha)
      if (achou) return achou
    }
    return null
  }
  for (const raiz of raizes) {
    const achou = buscar(raiz, [])
    if (achou) return achou
  }
  return []
}
