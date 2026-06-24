export interface Sector {
  id: string;
  unidade_id: string | null;
  parent_id?: string | null;
  nome: string;
}

/**
 * Organiza os setores em uma estrutura de lista plana e hierárquica (pai seguido pelos filhos),
 * adicionando recuo visual e um símbolo de ramificação (ex: "  ↳ ") nos nomes dos subsetores.
 */
export function formatSectorsHierarchy(sectors: Sector[]): Sector[] {
  if (!sectors || sectors.length === 0) return [];
  
  const parents = sectors.filter(s => !s.parent_id);
  const children = sectors.filter(s => !!s.parent_id);

  const result: Sector[] = [];

  // Ordena os setores principais alfabeticamente
  parents.sort((a, b) => a.nome.localeCompare(b.nome));

  parents.forEach(parent => {
    result.push(parent);
    
    // Filtra os filhos deste pai e ordena alfabeticamente
    const parentChildren = children.filter(c => c.parent_id === parent.id);
    parentChildren.sort((a, b) => a.nome.localeCompare(b.nome));
    
    parentChildren.forEach(child => {
      result.push({
        ...child,
        nome: `\u00A0\u00A0↳ ${child.nome}`
      });
    });
  });

  // Em caso de filhos órfãos (cujo pai não está na lista de unidades/setores acessíveis)
  const orphanChildren = children.filter(c => !parents.some(p => p.id === c.parent_id));
  orphanChildren.sort((a, b) => a.nome.localeCompare(b.nome));
  orphanChildren.forEach(orphan => {
    result.push({
      ...orphan,
      nome: `\u00A0\u00A0↳ ${orphan.nome}`
    });
  });

  return result;
}
