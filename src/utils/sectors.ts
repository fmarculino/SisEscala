export interface Sector {
  id: string;
  unidade_id: string | null;
  parent_id?: string | null;
  nome: string;
}

const INDENT = '  ';

/**
 * Organiza os setores em uma lista plana em ordem de arvore (pai imediatamente seguido pelos
 * descendentes), com recuo visual proporcional a profundidade ("  ↳ ", "    ↳ ", ...).
 *
 * Percorre a arvore em profundidade ARBITRARIA. A versao anterior so entendia dois niveis:
 * tudo que tinha `parent_id` era "filho", e o filho cujo pai tambem era filho (nivel 3+) caia
 * num bloco de "orfaos" despejado no FIM da lista, com o mesmo recuo de um nivel 2. Resultado:
 * ADMINISTRACAO > APOIO > ENGENHARIA aparecia colado embaixo do ultimo setor raiz em ordem
 * alfabetica (RECURSOS HUMANOS, na SMS), como se pertencesse a ele. O dado sempre esteve certo
 * -- o `value` do <option> e o id do setor --, mas a lista induzia o operador a escolher errado
 * quando havia nomes repetidos em ramos diferentes (duas ENGENHARIA, na SMS).
 *
 * Um setor cujo pai nao esta na lista (fora do escopo de acesso de quem consulta) vira raiz,
 * ordenado alfabeticamente junto com as raizes de verdade, mas MANTEM o marcador "↳" para nao
 * se passar por setor de primeiro nivel.
 */
export function formatSectorsHierarchy(sectors: Sector[]): Sector[] {
  if (!sectors || sectors.length === 0) return [];

  const byId = new Map(sectors.map(s => [s.id, s]));
  const childrenOf = new Map<string, Sector[]>();
  const roots: Sector[] = [];

  sectors.forEach(s => {
    // Pai ausente da lista (ou auto-referencia) => trata como raiz, senao o setor sumiria.
    const parentId = s.parent_id && s.parent_id !== s.id && byId.has(s.parent_id) ? s.parent_id : null;
    if (!parentId) {
      roots.push(s);
      return;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(s);
    else childrenOf.set(parentId, [s]);
  });

  const byName = (a: Sector, b: Sector) => a.nome.localeCompare(b.nome);
  roots.sort(byName);
  childrenOf.forEach(list => list.sort(byName));

  const result: Sector[] = [];
  const visited = new Set<string>();

  const walk = (sector: Sector, depth: number) => {
    if (visited.has(sector.id)) return; // defesa contra ciclo em parent_id
    visited.add(sector.id);

    // Orfao adotado como raiz fica na margem das raizes -- com marcador, para nao se passar por
    // setor de primeiro nivel, mas SEM recuo, para nao parecer filho da raiz anterior da lista.
    const prefix = depth > 0
      ? `${INDENT.repeat(depth)}↳ `
      : (sector.parent_id ? '↳ ' : '');

    result.push(prefix ? { ...sector, nome: `${prefix}${sector.nome}` } : sector);
    (childrenOf.get(sector.id) || []).forEach(child => walk(child, depth + 1));
  };

  roots.forEach(root => walk(root, 0));

  return result;
}
