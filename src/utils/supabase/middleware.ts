import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake can make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Rotas de API que NÃO podem depender de sessão de navegador. Cada uma tem autenticação
  // própria — segredo de cron/webhook — ou é pública por natureza.
  //
  // Redirecionar uma dessas para /login não devolve erro: devolve HTTP 307 e a página de login.
  // Quem chama é máquina, não gente, então o sintoma é a chamada "dar certo" e não fazer nada.
  // Foi o que aconteceu com /api/version: a auto-atualização do terminal (v1.27.0) faz
  // `fetch('/api/version')`, recebia o HTML do login, o `r.json()` estourava e o `catch` engolia —
  // o terminal nunca se atualizou em produção, exatamente a falha que a v1.27.0 existia para
  // corrigir. Conferido em 09/08/2026: `curl /api/version` devolvia 307 para /login.
  const rotasApiPublicas = [
    '/api/templates',      // link de recuperação de senha
    '/api/version',        // auto-atualização do terminal de ponto — pública por natureza
    '/api/cron',           // protegida por CRON_SECRET
    '/api/avisos-ponto',   // despachar (CRON_SECRET) e webhook (WHATSAPP_WEBHOOK_SECRET)
    '/api/rep',            // chamada pelo coletor-rep — token de dispositivo + assinatura HMAC
    '/implantacao',        // painel PUBLICO de acompanhamento da implantacao — sem login por
                           // desenho (link para a diretoria e a Secretaria). So dado agregado:
                           // a consulta vive em src/app/implantacao/dados.ts e nao devolve nome,
                           // matricula, CPF nem horario de servidor.
    '/api/folha-ponto',    // regerar-competencia — protegida por CRON_SECRET ou service role key
                           // dentro da própria rota. Quem chama é máquina (sem cookie de sessão),
                           // então o redirect daqui devolveria 307 + HTML do login e a chamada
                           // "daria certo" sem fazer nada — o mesmo sintoma silencioso de
                           // /api/version (09/08) e de /api/coletor-rep (13/08).
    '/api/presenca-local', // chamada pelo terminal local — token de dispositivo ou cookie assinado
    '/api/coletor-rep',    // tray-version/tray-download sao publicas por natureza (o app de
                           // bandeja nao tem sessao de navegador); download/download-cli tem
                           // checagem propria de admin/super_admin dentro da rota (createClient +
                           // profiles.role), entao ficar fora do redirect daqui nao os deixa
                           // abertos. Mesmo bug ja documentado e corrigido para /api/version em
                           // 09/08/2026 (comentario acima) - essas rotas nasceram depois (Fase 4,
                           // 11/08/2026) e nunca entraram nesta lista. Confirmado em producao em
                           // 13/08/2026: curl em tray-version e tray-download devolvia 307 para
                           // /login, e e' por isso que "Verificar atualizacao" nunca funcionou.
  ]

  // TERMINAL CLASSICO DESATIVADO — a rota nem chega a ser servida.
  //
  // Até 27/08/2026 `configuracoes_globais.terminal_classico_habilitado = false` só escondia os
  // botões da sidebar e da tela de login. A página continuava respondendo, então quem guardou
  // /presenca nos favoritos seguiu batendo ponto: 97 batidas de 18 servidores depois de a chave
  // ser desligada, medido em produção. Esconder o caminho nunca fechou o caminho.
  //
  // Esta é a camada de conveniência (a pessoa vê o motivo em vez de um formulário que falha); a
  // defesa de verdade é `fn_registrar_ponto`, que recusa a marcação no banco — a página é HTML
  // estático servido de cache, e a RPC é chamável direto por quem tiver sessão.
  //
  // /presenca-local NÃO entra aqui: é outro canal, com token de dispositivo próprio.
  const ehTerminalClassico = request.nextUrl.pathname === '/presenca' ||
    request.nextUrl.pathname.startsWith('/presenca/')

  if (ehTerminalClassico) {
    const { data: cfg } = await supabase
      .from('configuracoes_globais')
      .select('valor')
      .eq('chave', 'terminal_classico_habilitado')
      .maybeSingle()

    // Chave ausente = habilitado, o mesmo default do resto do sistema. Falha de leitura devolve
    // `undefined` e também deixa passar: derrubar o terminal de ponto por instabilidade de rede
    // seria pior que o problema que esta trava resolve — o banco recusa de qualquer forma.
    if (cfg?.valor === false) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('terminal', 'desativado')
      return NextResponse.redirect(url)
    }
  }

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !request.nextUrl.pathname.startsWith('/esqueci-a-senha') &&
    !request.nextUrl.pathname.startsWith('/resetar-senha') &&
    !request.nextUrl.pathname.startsWith('/sobreaviso') &&
    !request.nextUrl.pathname.startsWith('/presenca') &&
    !request.nextUrl.pathname.startsWith('/consultar-escala') &&
    !rotasApiPublicas.some(rota => request.nextUrl.pathname.startsWith(rota))
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
