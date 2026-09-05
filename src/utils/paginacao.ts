/**
 * Paginacao de consultas PostgREST — armadilha 8 do CLAUDE.md.
 *
 * 🚨 O PostgREST devolve no maximo 1000 linhas e NAO avisa. Nao e erro, nao vem cabecalho de
 *   truncamento, nao ha excecao: a pagina seguinte simplesmente nunca e buscada. `limit=2000`
 *   nao adianta. Num sistema de ponto isso vira relatorio que parece completo e nao esta.
 *
 * Medido em producao em 05/09/2026, competencia 09/2026 — o que cada relatorio via SEM paginar:
 *
 *   /relatorios/rh                 1.000 de 2.362 escalas (58% ausente)
 *   /relatorios/plantao-sobreaviso 1.000 de 2.362 escalas do ano (58% ausente)
 *   /relatorios/distribuicao       1.000 de 2.338 plantoes  (57% ausente)
 *   /relatorios/consolidado        1.000 de 1.384 escalas   (28% ausente)
 *
 * Em 08/2026 os quatro cabiam em 1000 e pareciam corretos — foi a entrada do HMI em 09/2026 que
 * revelou o corte. **Um relatorio que hoje cabe nao esta seguro; ele so ainda nao estourou.**
 *
 * ⚠️ ORDENE SEMPRE. Sem ORDER BY o Postgres nao garante ordem entre paginas, entao linha pode
 *   repetir numa pagina e faltar na outra — o resultado fica errado *com* paginacao. Por isso
 *   `montarQuery` deve incluir `.order(...)` por uma coluna estavel (id serve).
 */

/**
 * Percorre todas as paginas de uma consulta PostgREST.
 *
 * `montarQuery(from, to)` deve devolver a query ja com `.order(...).range(from, to)`.
 *
 * `tamanhoPagina` menor existe para consulta com embed pesado (uma escala traz ~30 linhas de
 * escala_diaria): 500 escalas por pagina sao ~15 mil linhas por requisicao.
 *
 * ⚠️ Erro no meio da paginacao INTERROMPE e devolve o que veio — o mesmo comportamento do
 *   painel. Quem exibe numero total deve conferir `completo`, que e falso quando isso acontece:
 *   relatorio incompleto tem de dizer que esta incompleto, nunca somar como se fosse tudo
 *   (armadilha 22 — relatar o que foi calculado em vez do que realmente ha).
 */
export async function buscarTodasPaginas<T = any>(
  montarQuery: (from: number, to: number) => any,
  tamanhoPagina = 1000
): Promise<{ linhas: T[]; completo: boolean; erro?: any }> {
  const linhas: T[] = []
  for (let from = 0; ; from += tamanhoPagina) {
    const { data, error } = await montarQuery(from, from + tamanhoPagina - 1)
    if (error) {
      console.error('Falha ao paginar consulta:', error)
      return { linhas, completo: false, erro: error }
    }
    linhas.push(...((data || []) as T[]))
    if (!data || data.length < tamanhoPagina) break
  }
  return { linhas, completo: true }
}
