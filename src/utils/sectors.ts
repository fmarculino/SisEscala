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

/**
 * Separador do caminho de setor. Barra INVERTIDA de proposito: a tela ja usa " / " entre unidade
 * e setor ("HMI - Hospital Materno Infantil / BLOCO A"), entao repetir a barra normal apagaria a
 * fronteira entre as duas coisas.
 */
export const SECTOR_PATH_SEPARATOR = ' \\ ';

/**
 * Caminho completo de cada setor, da raiz ate ele ("SHL \ BLOCO A").
 *
 * Existe porque nome de setor sozinho nao identifica nada: "BLOCO A" aparece embaixo de mais de
 * um pai, e quem le a lista de transferencia (ou escolhe um destino) nao tem como saber de qual
 * se trata. A saida ate 28/08/2026 era batizar o setor no dicionario de "BLOCO A SHL" -- ou
 * seja, escrever a hierarquia dentro do nome, duplicando no cadastro o que o `parent_id` ja sabe.
 *
 * NAO substitui `formatSectorsHierarchy`: aquela ordena em arvore e recua com "↳", o que serve
 * para lista curta, onde o pai fica visivel na linha de cima. Esta serve para texto solto e para
 * <select> longo, onde o pai sai da tela assim que se rola a lista.
 *
 * Setor cujo pai nao esta na lista (fora do escopo de quem consulta) comeca o caminho nele mesmo
 * -- inventar ancestral que nao se pode ler seria pior que mostrar o caminho curto. Ciclo em
 * `parent_id` para de subir e devolve o que ja montou.
 */
export function buildSectorPathMap(
  sectors: Sector[],
  separator: string = SECTOR_PATH_SEPARATOR,
): Map<string, string> {
  const byId = new Map(sectors.map(s => [s.id, s]));
  const cache = new Map<string, string>();

  const caminho = (sector: Sector): string => {
    const pronto = cache.get(sector.id);
    if (pronto !== undefined) return pronto;

    // Marca ANTES de subir: se um ancestral voltar a este id (ciclo em parent_id), ele encontra
    // o proprio nome ja no cache e a recursao para, em vez de estourar a pilha.
    cache.set(sector.id, sector.nome);

    const parentId = sector.parent_id && sector.parent_id !== sector.id ? sector.parent_id : null;
    const parent = parentId ? byId.get(parentId) : undefined;
    const valor = parent ? `${caminho(parent)}${separator}${sector.nome}` : sector.nome;

    cache.set(sector.id, valor);
    return valor;
  };

  sectors.forEach(caminho);
  return cache;
}

/**
 * A mesma lista, com `nome` trocado pelo caminho completo e ordenada POR caminho -- filhos do
 * mesmo pai ficam juntos sem precisar de recuo. Para alimentar <select>.
 *
 * Generica de proposito: `ativo`, `parent_id` e o que mais vier junto no objeto sobrevivem. A
 * tela que filtra por `ativo` depende disso (`.filter(s => s.ativo !== false)` em
 * ImportacaoRhSection e SolicitacoesTransferenciaSection).
 */
export function formatSectorPaths<T extends Sector>(
  sectors: T[],
  separator: string = SECTOR_PATH_SEPARATOR,
): T[] {
  if (!sectors || sectors.length === 0) return [];
  const caminhos = buildSectorPathMap(sectors, separator);
  return sectors
    .map(s => ({ ...s, nome: caminhos.get(s.id) || s.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

const PAGINA_SETORES = 1000;

/**
 * Busca a arvore de setores e devolve o mapa `id -> caminho completo`, pronto para resolver o
 * nome de um setor que veio de outra consulta (embed `setores(dicionario_setores(nome))` so'
 * traz a FOLHA -- por isso a lista de escalas mostrava "BLOCO A" sem dizer de qual pai).
 *
 * ⚠️ PAGINA por `Range` (armadilha 8 do CLAUDE.md): o PostgREST corta em 1000 linhas **em
 * silencio**, e sao 645 setores em 08/2026 -- perto demais do teto para confiar. Aqui truncar
 * seria pior que numa lista comum: pai que ficasse de fora sumiria do caminho dos filhos dele,
 * e o resultado pareceria certo.
 *
 * Traz setor INATIVO tambem, de proposito -- ele nao e' oferecido para escolha nova, mas
 * continua sendo o pai de quem esta escalado hoje, e sem ele o caminho ficaria quebrado.
 *
 * ⚠️ SEM filtro por unidade, de proposito. Filtrar parece economia e e' risco: bastaria um pai
 * cadastrado em outra unidade para o caminho do filho ficar curto, e o resultado continuaria
 * parecendo certo. Sao 645 linhas de tres colunas -- uma consulta.
 *
 * `supabase` sem tipo pelo mesmo motivo de `escalasNavegacao.ts`: serve ao client e ao server
 * component, que constroem clientes diferentes.
 */
export async function buscarCaminhosDeSetor(
  supabase: any,
  opts: { separator?: string } = {},
): Promise<Map<string, string>> {
  const linhas: Sector[] = [];

  for (let inicio = 0; ; inicio += PAGINA_SETORES) {
    const { data, error } = await supabase
      .from('setores')
      .select('id, unidade_id, parent_id, dicionario_setores(nome)')
      .order('id')
      .range(inicio, inicio + PAGINA_SETORES - 1);

    if (error) return buildSectorPathMap(linhas, opts.separator);

    const pagina = (data || []).map((s: any) => {
      const dict = Array.isArray(s.dicionario_setores) ? s.dicionario_setores[0] : s.dicionario_setores;
      return {
        id: s.id,
        unidade_id: s.unidade_id,
        parent_id: s.parent_id,
        nome: dict?.nome || 'SETOR SEM NOME',
      } as Sector;
    });

    linhas.push(...pagina);
    if (pagina.length < PAGINA_SETORES) break;
  }

  return buildSectorPathMap(linhas, opts.separator);
}
