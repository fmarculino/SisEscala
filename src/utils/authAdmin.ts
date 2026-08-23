/**
 * `supabase.auth.admin.listUsers()` devolve no maximo **50** usuarios (perPage padrao do
 * supabase-js) — silenciosamente, exatamente como o corte de 1000 linhas do PostgREST
 * (armadilha 8 do CLAUDE.md). Com 63 contas em producao em 22/08/2026, toda chamada crua
 * enxergava so as 50 primeiras: a tela /usuarios escondia 13 pessoas, e a checagem de e-mail
 * duplicado de `updateServidor` deixava passar um conflito que o Auth recusaria logo depois.
 *
 * Fonte unica: pagine sempre.
 */
export async function listarTodosUsuariosAuth(supabaseAdmin: any): Promise<any[]> {
  const todos: any[] = []
  const porPagina = 200

  for (let pagina = 1; ; pagina++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: pagina, perPage: porPagina })
    if (error) break

    const lote = data?.users || []
    todos.push(...lote)

    if (lote.length < porPagina) break
    // Guarda contra laco infinito se a API mudar o contrato de paginacao.
    if (pagina >= 50) break
  }

  return todos
}
