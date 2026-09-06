/**
 * O manual do SisEscala é escrito como DADOS, não como JSX.
 *
 * Por quê: três coisas dependem disso e todas as três quebram se o conteúdo virar markup solto —
 *
 *   1. **a busca**. Ela indexa o texto de cada bloco automaticamente (`textoDoBloco`). Com JSX, a
 *      alternativa seria manter uma lista de palavras-chave à mão em cada seção, que envelhece na
 *      primeira edição que alguém fizer sem lembrar de atualizá-la;
 *   2. **o visual**. Um aviso, um passo a passo e uma tabela têm exatamente uma aparência no
 *      manual inteiro, porque existe um renderizador para cada tipo — e não trinta trechos de
 *      Tailwind copiados;
 *   3. **a manutenção**. Toda atualização do sistema precisa passar por aqui (ver o cabeçalho de
 *      `conteudo.ts`), e editar um objeto é muito mais barato que editar markup.
 *
 * Ao precisar de um formato novo, acrescente um tipo de bloco aqui e o renderizador em
 * `Blocos.tsx` — nunca escreva HTML solto dentro do conteúdo.
 */

/** Quem enxerga a ferramenta. Vira etiqueta no topo da seção. */
export type Papel =
  | 'Administrador Geral'
  | 'RH Geral'
  | 'RH da Unidade'
  | 'Diretor'
  | 'Coordenador'
  | 'Ass. Administrativo'
  | 'Servidor'
  | 'Todos'

export type Tom = 'atencao' | 'cuidado' | 'dica' | 'legal'

export type Bloco =
  /** Um parágrafo. Aceita **negrito** e `código` na marcação leve de `textoRico`. */
  | { tipo: 'p'; texto: string }
  /** Subtítulo dentro da seção. */
  | { tipo: 'titulo'; texto: string }
  /** Passo a passo numerado — a forma padrão de ensinar uma tarefa. */
  | { tipo: 'passos'; itens: { titulo: string; texto?: string }[] }
  /** Lista simples, para enumerar coisas que não são sequência. */
  | { tipo: 'lista'; itens: string[] }
  /** Tabela. `colunas` define o cabeçalho; cada linha tem o mesmo número de células. */
  | { tipo: 'tabela'; colunas: string[]; linhas: string[][] }
  /** Caixa destacada. `atencao` e `cuidado` são para o que dá problema se for ignorado. */
  | { tipo: 'aviso'; tom: Tom; titulo?: string; texto: string }
  /** Cartões lado a lado — bom para "as N coisas que esta tela faz". */
  | { tipo: 'cartoes'; itens: { titulo: string; texto: string }[] }
  /** Link para outra seção do próprio manual. */
  | { tipo: 'veja'; secaoId: string; texto?: string }
  /** Caminho de menu até a tela: ['OPERAÇÃO', 'Escalas']. */
  | { tipo: 'caminho'; itens: string[]; href?: string }

export interface Secao {
  id: string
  titulo: string
  /** Uma frase que responde "para que serve", lida antes de abrir a seção. */
  resumo: string
  papeis?: Papel[]
  blocos: Bloco[]
}

export interface Capitulo {
  id: string
  titulo: string
  /** Nome do ícone em lucide-react, resolvido em `ManualClient`. */
  icone: string
  descricao: string
  secoes: Secao[]
}

/** Texto puro de um bloco — é o que alimenta a busca. */
export function textoDoBloco(b: Bloco): string {
  switch (b.tipo) {
    case 'p':
    case 'titulo':
      return b.texto
    case 'lista':
      return b.itens.join(' ')
    case 'passos':
      return b.itens.map(i => `${i.titulo} ${i.texto || ''}`).join(' ')
    case 'tabela':
      return [...b.colunas, ...b.linhas.flat()].join(' ')
    case 'aviso':
      return `${b.titulo || ''} ${b.texto}`
    case 'cartoes':
      return b.itens.map(i => `${i.titulo} ${i.texto}`).join(' ')
    case 'caminho':
      return b.itens.join(' ')
    case 'veja':
      return b.texto || ''
  }
}

/** Tudo que se pode procurar numa seção, já em minúsculas e sem acento. */
export function indiceDaSecao(s: Secao): string {
  return normalizar([s.titulo, s.resumo, ...(s.papeis || []), ...s.blocos.map(textoDoBloco)].join(' '))
}

/**
 * Busca sem acento e sem caixa: quem procura "ferias" tem que achar "Férias", e quem procura
 * "PIN" tem que achar "pin". Buscar exigindo acento numa tela de ajuda é a forma mais rápida de
 * fazer o usuário concluir que o assunto não está documentado.
 */
export function normalizar(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
